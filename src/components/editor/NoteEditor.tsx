// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Edits one existing Note in place, as Anki's editor does in Browse and Edit
 * Current: changes save on their own shortly after typing stops, when a field
 * loses focus, and before another Note is shown.
 */
import { Check, CircleAlert, ImagePlus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button, cn, Spinner, Tooltip } from "@/components/ui";
import * as core from "@/lib/anki/generated/core";
import { BackendError_Kind } from "@/lib/anki/proto/anki/backend_pb";
import type { Note } from "@/lib/anki/proto/anki/notes_pb";
import type { Notetype } from "@/lib/anki/proto/anki/notetypes_pb";
import { CoreError, onCollectionChange } from "@/lib/anki/transport";
import { t, tr } from "@/lib/i18n";
import { useNav } from "@/lib/nav";
import { ts } from "@/lib/strings/shell";
import { cardCount, te } from "@/lib/strings/editor";

import { FieldsCheckNotice, useFieldsCheck } from "./FieldsCheck";
import { FieldsEditor, type FieldsEditorHandle } from "./FieldsEditor";
import { isImageOcclusion } from "./markup";
import { sameTags } from "./tags";

/** The mask and image fields of an Image Occlusion Note Type, as the engine reports them. */
function useHiddenIoFields(notetype: Notetype | null): number[] | undefined {
  const io = !!notetype && isImageOcclusion(notetype);
  const { data } = useQuery({
    queryKey: ["ioFields", String(notetype?.id ?? 0)],
    queryFn: () => core.getImageOcclusionFields({ notetypeId: notetype!.id }),
    enabled: io,
  });
  if (!io || !data?.fields) return undefined;
  return [data.fields.occlusions, data.fields.image];
}

/** Changes from this editor carry this origin. */
export const EDITOR_ORIGIN = "editor";

const SAVE_DELAY = 600;

type Phase = "loading" | "ready" | "error" | "deleted";
type SaveState = "idle" | "saving" | "saved" | "error";

interface Loaded {
  note: Note;
  notetype: Notetype;
  cards: number;
}

async function load(noteId: bigint): Promise<Loaded> {
  const note = await core.getNote({ nid: noteId });
  const [notetype, cards] = await Promise.all([
    core.getNotetype({ ntid: note.notetypeId }),
    core.cardsOfNote({ nid: noteId }),
  ]);
  return { note, notetype, cards: cards.cids.length };
}

function sameFields(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((f, i) => f === b[i]);
}

export function NoteEditor({
  noteId,
  autoFocus = false,
  className,
}: {
  noteId: bigint;
  /** Puts the caret in the first field once the Note is shown. */
  autoFocus?: boolean;
  className?: string;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [fields, setFields] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [save, setSave] = useState<SaveState>("idle");
  const [attempt, setAttempt] = useState(0);

  const editor = useRef<FieldsEditorHandle>(null);
  const composing = useRef(false);
  const dirty = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  /** What the editor holds right now, read by saves that run after a render. */
  const latest = useRef<{ note: Note | null; fields: string[]; tags: string[] }>({ note: null, fields: [], tags: [] });

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    if (!dirty.current) return;
    if (composing.current) {
      timer.current = window.setTimeout(flush, SAVE_DELAY);
      return;
    }
    const { note, fields, tags } = latest.current;
    if (!note) return;
    dirty.current = false;
    setSave("saving");
    core
      .updateNotes({ notes: [{ ...note, fields: [...fields], tags: [...tags] }], skipUndoEntry: false }, { origin: EDITOR_ORIGIN })
      .then(() => {
        if (latest.current.note?.id === note.id) setSave(dirty.current ? "saving" : "saved");
      })
      .catch(() => {
        if (latest.current.note?.id === note.id) setSave("error");
      });
  }, []);

  const schedule = useCallback(() => {
    dirty.current = true;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, SAVE_DELAY);
  }, [flush]);

  const apply = useCallback((value: Loaded) => {
    latest.current = { note: value.note, fields: [...value.note.fields], tags: [...value.note.tags] };
    setLoaded(value);
    setFields(latest.current.fields);
    setTags(latest.current.tags);
  }, []);

  // Load the Note; before switching to another, save this one.
  useEffect(() => {
    let live = true;
    setSave("idle");
    if (latest.current.note?.id !== noteId) setPhase((p) => (p === "ready" ? "ready" : "loading"));
    load(noteId)
      .then((value) => {
        if (!live) return;
        apply(value);
        setPhase("ready");
      })
      .catch((err: unknown) => {
        if (!live) return;
        latest.current = { note: null, fields: [], tags: [] };
        setLoaded(null);
        if (err instanceof CoreError && err.kind === BackendError_Kind.NOT_FOUND_ERROR) {
          setPhase("deleted");
        } else {
          setError(err instanceof Error ? err.message : String(err));
          setPhase("error");
        }
      });
    return () => {
      live = false;
      flush();
    };
  }, [noteId, attempt, apply, flush]);

  // Changes made elsewhere (undo, find and replace, another window) are shown
  // unless there are edits here still waiting to be saved.
  useEffect(() => {
    return onCollectionChange(({ changes, origin }) => {
      if (origin === EDITOR_ORIGIN) return;
      if (!changes.note && !changes.noteText && !changes.notetype && !changes.card) return;
      if (dirty.current) return;
      load(noteId)
        .then((value) => {
          if (dirty.current || latest.current.note?.id !== noteId) return;
          const current = latest.current;
          if (sameFields(current.fields, value.note.fields) && sameTags(current.tags, value.note.tags)) {
            latest.current = { ...current, note: value.note };
            setLoaded(value);
            return;
          }
          apply(value);
        })
        .catch((err: unknown) => {
          if (err instanceof CoreError && err.kind === BackendError_Kind.NOT_FOUND_ERROR) {
            latest.current = { note: null, fields: [], tags: [] };
            setPhase("deleted");
          }
        });
    });
  }, [noteId, apply]);

  const check = useFieldsCheck(noteId, loaded?.note.notetypeId, fields);
  const hiddenIoFields = useHiddenIoFields(loaded?.notetype ?? null);

  useEffect(() => {
    if (autoFocus && phase === "ready") editor.current?.focusField(0);
  }, [autoFocus, phase, noteId]);

  if (phase === "loading" && !loaded) {
    return (
      <div className={cn("grid h-full place-items-center", className)}>
        <Spinner className="size-5" />
      </div>
    );
  }

  if (phase === "error" || phase === "deleted" || !loaded) {
    return (
      <div className={cn("grid h-full place-items-center px-8", className)}>
        <div className="max-w-[340px] text-center">
          <p className="text-control text-ink-2">{phase === "deleted" ? tr("adding-note-deleted") : te("loadFailed")}</p>
          {phase === "error" && (
            <>
              <p className="selectable mt-1.5 text-caption text-ink-3">{error}</p>
              <Button size="sm" className="mt-4" onClick={() => setAttempt((n) => n + 1)}>
                {t("common.retry")}
              </Button>
            </>
          )}
        </div>
      </div>
    );
  }

  const { notetype, cards } = loaded;

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)} inert={phase === "loading"}>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-5 text-caption">
        <span className="truncate font-medium text-ink" title={notetype.name}>
          {notetype.name}
        </span>
        <span aria-hidden className="text-ink-3">
          ·
        </span>
        <span className="shrink-0 text-ink-3 tabular">{cardCount(cards)}</span>
        <SaveStatus state={save} />
      </div>
      {isImageOcclusion(notetype) && (
        <div className="flex shrink-0 items-center gap-3 border-b border-line-soft px-5 py-2.5">
          <Button
            size="sm"
            variant="primary"
            onClick={() => useNav.getState().go({ name: "image-occlusion", mode: { kind: "edit", noteId: loaded.note.id } })}
          >
            <ImagePlus />
            {ts("editImageOcclusion")}
          </Button>
        </div>
      )}
      <FieldsEditor
        key={String(loaded.note.id)}
        ref={editor}
        // The masks and the image are edited in the Image Occlusion editor.
        hiddenFields={hiddenIoFields}
        className="flex-1"
        mode="edit"
        notetype={notetype}
        fields={fields}
        onFieldChange={(index, value) => {
          const next = [...latest.current.fields];
          next[index] = value;
          latest.current = { ...latest.current, fields: next };
          setFields(next);
          schedule();
        }}
        tags={tags}
        onTagsChange={(next) => {
          latest.current = { ...latest.current, tags: next };
          setTags(next);
          schedule();
        }}
        notices={[
          <FieldsCheckNotice
            key="check"
            state={check}
            notetypeId={notetype.id}
            firstField={fields[0] ?? ""}
            showEmpty
          />,
        ]}
        onInputBlur={flush}
        composingRef={composing}
      />
    </div>
  );
}

function SaveStatus({ state }: { state: SaveState }) {
  if (state === "idle") return null;
  if (state === "error") {
    return (
      <Tooltip content={te("saveFailed")}>
        <span role="status" className="ms-auto flex shrink-0 items-center gap-1 text-danger">
          <CircleAlert aria-hidden className="size-3.5" />
          {te("notSaved")}
        </span>
      </Tooltip>
    );
  }
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        "ms-auto flex shrink-0 items-center gap-1 text-ink-3 transition-opacity duration-[var(--dur)]",
        state === "saving" && "opacity-70",
      )}
    >
      {state === "saving" ? <Spinner className="size-3" /> : <Check aria-hidden className="size-3.5" />}
      {state === "saving" ? te("saving") : te("saved")}
    </span>
  );
}
