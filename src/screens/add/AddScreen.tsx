// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Anki's Add dialog as a screen: choose a Note Type and a Deck, fill in the
 * fields and tags, and add. Sticky fields keep their content for the next
 * Note; a side panel shows the history of added Notes or a live Card preview.
 */
import { clone } from "@bufbuild/protobuf";
import { useQuery } from "@tanstack/react-query";
import { ImagePlus, PanelRightClose, PanelRightOpen } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { CardPreview, type PreviewSide } from "@/components/editor/CardPreview";
import { isImageOcclusion } from "@/components/editor/markup";
import { ts } from "@/lib/strings/shell";
import { startImageOcclusion as startIO } from "@/screens/image-occlusion";
import { Chooser } from "@/components/editor/Chooser";
import { CheckState, FieldsCheckNotice, useFieldsCheck } from "@/components/editor/FieldsCheck";
import { FieldsEditor, type FieldsEditorHandle } from "@/components/editor/FieldsEditor";
import { carryFields } from "@/components/editor/markup";
import { htmlToText } from "@/components/editor/sanitize";
import { Button, cn, Dialog, IconButton, Kbd, onAccentKbd, Segmented, Spinner } from "@/components/ui";
import * as core from "@/lib/anki/generated/core";
import type { Note } from "@/lib/anki/proto/anki/notes_pb";
import { NotetypeSchema, type Notetype } from "@/lib/anki/proto/anki/notetypes_pb";
import { localeCompare, t, tr } from "@/lib/i18n";
import { useNav } from "@/lib/nav";
import { displayChord } from "@/shell/shortcuts";
import { te } from "@/lib/strings/editor";

import { useAddHistory } from "./history";
import { guardUnsavedAdd } from "./leave";
import { takeAddPrefill, type AddPrefill } from "./prefill";

const ORIGIN = "add";

/* ------------------------------ Panel preference ------------------------------ */

type PanelTab = "history" | "preview";
const PANEL_KEY = "hayaki.add.panel";

function loadPanel(): { open: boolean; tab: PanelTab } {
  try {
    const saved = JSON.parse(localStorage.getItem(PANEL_KEY) ?? "null") as { open?: boolean; tab?: PanelTab } | null;
    return { open: saved?.open ?? true, tab: saved?.tab === "history" ? "history" : "preview" };
  } catch {
    return { open: true, tab: "preview" };
  }
}

function savePanel(value: { open: boolean; tab: PanelTab }) {
  try {
    localStorage.setItem(PANEL_KEY, JSON.stringify(value));
  } catch {
    // A convenience only.
  }
}

/* ------------------------------ Screen ------------------------------ */

/** Image Occlusion opens its own editor, after the image is chosen. */
function startImageOcclusion(notetypeId?: bigint): Promise<void> {
  return startIO(notetypeId);
}

function hasContent(fields: string[], sticky: boolean[]): boolean {
  return fields.some((f, i) => !sticky[i] && htmlToText(f) !== "") || fields.some((f, i) => !sticky[i] && /<img|\[sound:/i.test(f));
}

export function AddScreen() {
  const back = useNav((s) => s.back);
  const go = useNav((s) => s.go);

  const notetypes = useQuery({
    queryKey: ["editor", "notetypeNames"],
    queryFn: async () => (await core.getNotetypeNames()).entries.map((e) => ({ id: e.id, name: e.name })),
  });
  const decks = useQuery({
    queryKey: ["editor", "deckNames"],
    queryFn: async () =>
      (await core.getDeckNames({ skipEmptyDefault: true, includeFiltered: false })).entries
        .map((e) => ({ id: e.id, name: e.name }))
        .sort((a, b) => localeCompare(a.name, b.name)),
  });

  const [notetypeId, setNotetypeId] = useState<bigint | null>(null);
  const [deckId, setDeckId] = useState<bigint | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  // The history carries over from earlier sessions; Notes deleted since drop out of it.
  useEffect(() => {
    const history = useAddHistory.getState();
    history.load();
    void history.prune();
  }, []);
  const [notetype, setNotetype] = useState<Notetype | null>(null);
  const [template, setTemplate] = useState<Note | null>(null);
  const [fields, setFields] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [sticky, setSticky] = useState<boolean[]>([]);
  const [adding, setAdding] = useState(false);
  const [triedAdd, setTriedAdd] = useState(false);
  const [confirmCloze, setConfirmCloze] = useState<Note | null>(null);
  const [discard, setDiscard] = useState<(() => void) | null>(null);
  const [chooser, setChooser] = useState<"notetype" | "deck" | null>(null);
  const [panel, setPanelState] = useState(loadPanel);
  const [wide, setWide] = useState(true);
  const [side, setSide] = useState<PreviewSide>("question");

  const editor = useRef<FieldsEditorHandle>(null);
  const container = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const latest = useRef({ fields, tags, sticky, notetype, template, deckId });
  const prefill = useRef<AddPrefill | null>(null);
  latest.current = { ...latest.current, sticky, notetype, template, deckId };

  const setPanel = (next: { open: boolean; tab: PanelTab }) => {
    setPanelState(next);
    savePanel(next);
  };

  // The Deck and Note Type Anki would choose.
  useEffect(() => {
    // Create Copy in the browser opens this screen with a Note to start from.
    // (Strict Mode runs this twice; the second run reuses what the first took.)
    const copy = prefill.current ?? takeAddPrefill();
    if (copy) {
      prefill.current = copy;
      setDeckId(copy.deckId);
      setNotetypeId(copy.notetypeId);
      return;
    }
    core
      .defaultsForAdding({ homeDeckOfCurrentReviewCard: 0n })
      .then((d) => {
        setDeckId(d.deckId);
        setNotetypeId(d.notetypeId);
      })
      .catch((err: unknown) => setStartError(err instanceof Error ? err.message : String(err)));
  }, []);

  // A new Note of the chosen type, carrying over what was already typed.
  useEffect(() => {
    if (notetypeId === null) return;
    let live = true;
    Promise.all([core.getNotetype({ ntid: notetypeId }), core.newNote({ ntid: notetypeId })])
      .then(([nt, note]) => {
        if (!live) return;
        const previous = latest.current.notetype;
        let next = previous
          ? carryFields(
              previous.fields.map((f) => f.name),
              latest.current.fields,
              nt.fields.map((f) => f.name),
              note.fields,
            )
          : [...note.fields];
        const copy = prefill.current;
        prefill.current = null;
        if (copy && copy.notetypeId === nt.id) {
          next = copy.fields.map((value, i) => (i < nt.fields.length ? value : ""));
          while (next.length < nt.fields.length) next.push("");
          latest.current.tags = copy.tags;
          setTags(copy.tags);
        }
        latest.current.fields = next;
        setNotetype(nt);
        setTemplate(note);
        setFields(next);
        setSticky(nt.fields.map((f) => !!f.config?.sticky));
        setTriedAdd(false);
      })
      .catch((err: unknown) => live && setStartError(err instanceof Error ? err.message : String(err)));
    return () => {
      live = false;
    };
  }, [notetypeId]);

  const chooseNotetype = async (id: bigint) => {
    if (id === notetypeId) return;
    setNotetypeId(id);
    try {
      const deck = await core.defaultDeckForNotetype({ ntid: id });
      if (deck.did) setDeckId(deck.did);
    } catch {
      // Keep the current Deck.
    }
  };

  // The side panel floats over the fields when the window is narrow.
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWide(entry.contentRect.width >= 860));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const check = useFieldsCheck(0n, notetype?.id, fields);

  const resetAfterAdd = useCallback(() => {
    const { template: base, sticky: keep, fields: current } = latest.current;
    const next = current.map((value, i) => (keep[i] ? value : (base?.fields[i] ?? "")));
    latest.current.fields = next;
    setFields(next);
    setTriedAdd(false);
    editor.current?.focusField(0);
  }, []);

  const commitAdd = useCallback(
    async (note: Note) => {
      const deck = latest.current.deckId;
      if (deck === null) return;
      setAdding(true);
      try {
        const result = await core.addNote({ note, deckId: deck }, { origin: ORIGIN });
        const nt = latest.current.notetype;
        useAddHistory.getState().push({
          id: result.noteId,
          text: htmlToText(note.fields[0] ?? "") || htmlToText(note.fields.join(" ")),
          notetype: nt?.name ?? "",
          deck: decks.data?.find((d) => d.id === deck)?.name ?? "",
        });
        const noteId = result.noteId;
        toast(tr("adding-added"), {
          action: {
            label: tr("undo-undo"),
            onClick: () => {
              void core.undo({ origin: ORIGIN }).then(() => useAddHistory.getState().remove(noteId));
            },
          },
        });
        resetAfterAdd();
      } catch (err) {
        toast.error(te("addFailed"), { description: err instanceof Error ? err.message : String(err) });
      } finally {
        setAdding(false);
      }
    },
    [decks.data, resetAfterAdd],
  );

  const add = useCallback(async () => {
    const { template: base, notetype: nt } = latest.current;
    if (!base || !nt || isImageOcclusion(nt) || adding || composing.current) return;
    const committedTags = editor.current?.commitTags() ?? latest.current.tags;
    const note: Note = { ...base, fields: [...latest.current.fields], tags: [...committedTags] };
    setTriedAdd(true);
    let state: CheckState;
    try {
      state = (await core.noteFieldsCheck(note)).state;
    } catch {
      state = CheckState.NORMAL;
    }
    switch (state) {
      case CheckState.EMPTY:
        toast.error(tr("adding-the-first-field-is-empty"));
        editor.current?.focusField(0);
        return;
      case CheckState.NOTETYPE_NOT_CLOZE:
        toast.error(tr("adding-cloze-outside-cloze-notetype"));
        return;
      case CheckState.FIELD_NOT_CLOZE:
        toast.error(tr("adding-cloze-outside-cloze-field"));
        return;
      case CheckState.MISSING_CLOZE:
        setConfirmCloze(note);
        return;
      default:
        await commitAdd(note);
    }
  }, [adding, commitAdd]);

  // Typed or prefilled content asks before any route away; Add and Discard both
  // empty it, which removes the guard.
  const dirty = hasContent(fields, sticky);
  useEffect(() => {
    if (!dirty) return;
    return guardUnsavedAdd((proceed) => setDiscard(() => proceed));
  }, [dirty]);

  const close = back;

  // Anki's Add shortcuts.
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      const mod = e.ctrlKey || e.metaKey;
      const overlay = document.querySelector("[role=dialog], [role=menu], [role=listbox]");
      if (mod && e.key === "Enter") {
        if (overlay && !overlay.closest("[data-tag-suggestions]")) return;
        e.preventDefault();
        void add();
        return;
      }
      if (mod && !e.shiftKey && !e.altKey && e.code === "KeyN") {
        e.preventDefault();
        setChooser("notetype");
        return;
      }
      if (mod && !e.shiftKey && !e.altKey && e.code === "KeyD") {
        e.preventDefault();
        setChooser("deck");
        return;
      }
      if (mod && e.shiftKey && e.code === "KeyP") {
        e.preventDefault();
        setPanelState((p) => {
          const next = p.open && p.tab === "preview" ? { open: false, tab: p.tab } : { open: true, tab: "preview" as const };
          savePanel(next);
          return next;
        });
        return;
      }
      if (mod && !e.shiftKey && e.code === "KeyH") {
        e.preventDefault();
        setPanelState((p) => {
          const next = p.open && p.tab === "history" ? { open: false, tab: p.tab } : { open: true, tab: "history" as const };
          savePanel(next);
          return next;
        });
        return;
      }
      if (e.key === "Escape" && !mod && !overlay) {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [add, close]);

  const toggleSticky = async (index: number) => {
    const nt = latest.current.notetype;
    if (!nt) return;
    const value = !sticky[index];
    setSticky((prev) => prev.map((v, i) => (i === index ? value : v)));
    // Anki keeps the pin on the Note Type, so it lasts between sessions.
    const next = clone(NotetypeSchema, nt);
    const config = next.fields[index]?.config;
    if (!config) return;
    config.sticky = value;
    try {
      await core.updateNotetype(next, { origin: ORIGIN });
      setNotetype((current) => (current?.id === next.id ? next : current));
    } catch {
      setSticky((prev) => prev.map((v, i) => (i === index ? !value : v)));
    }
  };

  const notetypeItems = notetypes.data ?? [];
  const deckItems = decks.data ?? [];
  const panelOpen = panel.open;
  const notices = useMemo(
    () =>
      notetype
        ? [
            <FieldsCheckNotice
              key="check"
              state={check}
              notetypeId={notetype.id}
              firstField={fields[0] ?? ""}
              showEmpty={triedAdd}
            />,
          ]
        : [],
    [check, notetype, fields, triedAdd],
  );

  if (startError) {
    return (
      <div className="grid h-full place-items-center px-8">
        <div className="max-w-[420px] text-center">
          <p className="text-body font-medium text-ink">{t("error.title")}</p>
          <p className="selectable mt-1.5 text-control text-ink-2">{startError}</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={container} className="relative flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-2 px-5 pb-2.5 pt-3.5">
          <Chooser
            label={tr("notetypes-type")}
            shortcut={displayChord("Ctrl+N")}
            items={notetypeItems}
            value={notetypeId}
            onSelect={(id) => void chooseNotetype(id)}
            open={chooser === "notetype"}
            onOpenChange={(open) => setChooser(open ? "notetype" : null)}
            searchLabel={te("searchNotetypes")}
          />
          <Chooser
            label={tr("decks-deck")}
            shortcut={displayChord("Ctrl+D")}
            items={deckItems}
            value={deckId}
            onSelect={setDeckId}
            open={chooser === "deck"}
            onOpenChange={(open) => setChooser(open ? "deck" : null)}
            searchLabel={te("searchDecks")}
            hierarchical
          />
          <Button
            size="sm"
            variant="ghost"
            className="h-8"
            title={tr("notetypes-image-occlusion-name")}
            onClick={() => void startImageOcclusion()}
          >
            <ImagePlus />
            {tr("notetypes-image-occlusion-name")}
          </Button>
          <div className="ms-auto">
            <IconButton
              label={panelOpen ? te("hidePanel") : te("showPanel")}
              size="sm"
              aria-pressed={panelOpen}
              onClick={() => setPanel({ ...panel, open: !panelOpen })}
            >
              {panelOpen ? <PanelRightClose /> : <PanelRightOpen />}
            </IconButton>
          </div>
        </div>

        {notetype && isImageOcclusion(notetype) ? (
          // An Image Occlusion Note is drawn on its image, not typed into fields.
          <div className="grid flex-1 place-items-center border-t border-line px-8">
            <div className="flex max-w-[400px] flex-col items-center text-center">
              <span className="mb-4 grid size-12 place-items-center rounded-full bg-accent-soft text-accent-ink">
                <ImagePlus className="size-5" />
              </span>
              <h2 className="text-heading font-semibold text-ink">{tr("notetypes-image-occlusion-name")}</h2>
              <p className="mt-2 text-body text-ink-2 text-pretty">{ts("imageOcclusionLead")}</p>
              <Button variant="primary" size="lg" className="mt-6" autoFocus onClick={() => void startImageOcclusion(notetype.id)}>
                <ImagePlus />
                {ts("openImageOcclusion")}
              </Button>
            </div>
          </div>
        ) : notetype && template ? (
          <FieldsEditor
            ref={editor}
            className="flex-1 border-t border-line"
            mode="add"
            notetype={notetype}
            fields={fields}
            onFieldChange={(index, value) => {
              const next = [...latest.current.fields];
              next[index] = value;
              latest.current.fields = next;
              setFields(next);
            }}
            tags={tags}
            onTagsChange={(next) => {
              latest.current.tags = next;
              setTags(next);
            }}
            sticky={sticky}
            onToggleSticky={(index) => void toggleSticky(index)}
            notices={notices}
            composingRef={composing}
            autoFocus
          />
        ) : (
          <div className="grid flex-1 place-items-center border-t border-line">
            <Spinner className="size-5" />
          </div>
        )}

        {!isImageOcclusion(notetype) && (
          <footer className="flex shrink-0 items-center gap-3 border-t border-line px-5 py-3">
            <p className="hidden min-w-0 truncate text-caption text-ink-3 sm:block">{tr("editing-jump-to-tags-with-ctrlandshiftandt").replace("Ctrl+Shift+T", displayChord("Ctrl+Shift+T"))}</p>
            <Button
              variant="primary"
              className="ms-auto"
              disabled={!template || adding}
              onClick={() => void add()}
              title={tr("adding-add-shortcut-ctrlandenter").replace("Ctrl+Enter", displayChord("Ctrl+Enter"))}
            >
              {adding && <Spinner className="text-on-accent" />}
              {tr("actions-add")}
              <Kbd className={onAccentKbd}>{displayChord("Ctrl+Enter")}</Kbd>
            </Button>
          </footer>
        )}
      </div>

      {panelOpen && (
        <aside
          aria-label={te("sidePanel")}
          className={cn(
            "flex w-[340px] shrink-0 flex-col border-s border-line bg-bg",
            !wide && "absolute inset-y-0 end-0 z-30 shadow-pop",
          )}
        >
          {/* One pane header: the preview's two sides and the history share one switch. */}
          <div className="flex h-12 shrink-0 items-center px-4">
            <Segmented
              label={te("sidePanel")}
              size="sm"
              stretch
              value={panel.tab === "history" ? "history" : side}
              onChange={(value) => {
                if (value === "history") setPanel({ open: true, tab: "history" });
                else {
                  setSide(value);
                  setPanel({ open: true, tab: "preview" });
                }
              }}
              options={[
                { value: "question", label: te("question") },
                { value: "answer", label: te("answer") },
                { value: "history", label: tr("adding-history"), title: displayChord("Ctrl+H") },
              ]}
            />
          </div>
          <div className="min-h-0 flex-1">
            {panel.tab === "preview" ? (
              notetype ? (
                <CardPreview notetype={notetype} fields={fields} tags={tags} side={side} />
              ) : null
            ) : (
              <HistoryList onOpen={(id) => go({ name: "browse", search: `nid:${id}` })} />
            )}
          </div>
        </aside>
      )}

      <Dialog
        open={confirmCloze !== null}
        onOpenChange={(open) => !open && setConfirmCloze(null)}
        title={tr("actions-add-note")}
        description={tr("adding-you-have-a-cloze-deletion-note")}
        footer={
          <>
            <Button onClick={() => setConfirmCloze(null)}>{tr("adding-keep-editing")}</Button>
            <Button
              variant="primary"
              autoFocus
              onClick={() => {
                const note = confirmCloze;
                setConfirmCloze(null);
                if (note) void commitAdd(note);
              }}
            >
              {tr("actions-add")}
            </Button>
          </>
        }
      />

      <Dialog
        open={discard !== null}
        onOpenChange={(open) => !open && setDiscard(null)}
        title={tr("adding-discard-current-input")}
        footer={
          <>
            <Button autoFocus data-autofocus onClick={() => setDiscard(null)}>
              {tr("adding-keep-editing")}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const proceed = discard;
                setDiscard(null);
                proceed?.();
              }}
            >
              {tr("actions-discard")}
            </Button>
          </>
        }
      />
    </div>
  );
}

function HistoryList({ onOpen }: { onOpen: (id: bigint) => void }) {
  const entries = useAddHistory((s) => s.entries);
  if (!entries.length) {
    return <p className="px-5 pt-6 text-center text-caption leading-relaxed text-ink-3">{te("historyEmpty")}</p>;
  }
  return (
    <ul className="h-full overflow-auto px-2 pb-4">
      {entries.map((entry) => (
        <li key={String(entry.id)}>
          <button
            type="button"
            onClick={() => onOpen(entry.id)}
            className="flex w-full flex-col items-start gap-0.5 rounded-[8px] px-3 py-2 text-start hover:bg-surface-2 focus-visible:bg-accent-softer"
          >
            <span className="w-full truncate text-control text-ink">{entry.text || te("emptyField")}</span>
            <span className="w-full truncate text-caption text-ink-3">
              {entry.notetype}
              {entry.deck && ` · ${entry.deck}`}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
