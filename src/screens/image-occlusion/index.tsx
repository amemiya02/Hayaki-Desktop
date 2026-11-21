// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Create or edit an Image Occlusion Note: the mask editor beside the Note's
 * Header, Back Extra and Tags, with the Deck and Anki's two occlusion modes.
 * Adding stores the image and the masks' cloze text in a new Note of the
 * Image Occlusion Note Type; editing updates the Note's masks and fields.
 */
import { create } from "@bufbuild/protobuf";
import { useQuery } from "@tanstack/react-query";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ClipboardPaste, ImageOff, ImagePlus, ImageUp } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { confirm } from "@/components/confirm";
import { Chooser } from "@/components/editor/Chooser";
import { FieldsEditor } from "@/components/editor/FieldsEditor";
import { Button, cn, Kbd, Segmented, Spinner } from "@/components/ui";
import * as core from "@/lib/anki/generated/core";
import {
  Notetype_Config_Kind,
  NotetypeSchema,
  StockNotetype_OriginalStockKind,
  type Notetype,
} from "@/lib/anki/proto/anki/notetypes_pb";
import { localeCompare, tr } from "@/lib/i18n";
import { addMediaBytes } from "@/lib/media";
import { setLeaveGuard, useNav } from "@/lib/nav";
import { te } from "@/lib/strings/editor";
import { tio } from "@/lib/strings/image-occlusion";

import { commit, initHistory, redo, undo, type History } from "./editing";
import { MaskEditor } from "./MaskEditor";
import { exportOcclusions, occlusionsFromStored, TEXT_FONT_SIZE, type Occlusion, type Size } from "./shapes";
import { scaleShape } from "./geometry";
import { measureText } from "./text-measure";

export type ImageOcclusionMode = { kind: "add"; imagePath?: string; notetypeId?: bigint } | { kind: "edit"; noteId: bigint };

const ORIGIN = "image-occlusion";

/** Upstream's `pics` (aqt/editor.py). */
export const IMAGE_EXTENSIONS = ["avif", "gif", "ico", "jpeg", "jpg", "png", "svg", "webp"];

const MIME: Record<string, string> = {
  avif: "image/avif",
  gif: "image/gif",
  ico: "image/x-icon",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
};

function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.includes(path.split(".").pop()?.toLowerCase() ?? "");
}

async function chooseImage(): Promise<string | null> {
  const chosen = await openDialog({
    multiple: false,
    directory: false,
    title: tr("editing-add-media"),
    filters: [{ name: tr("editing-media"), extensions: IMAGE_EXTENSIONS }],
  });
  return typeof chosen === "string" ? chosen : null;
}

/** Opens the image dialog, then the Image Occlusion screen for a new Note. */
export async function startImageOcclusion(notetypeId?: bigint): Promise<void> {
  const imagePath = await chooseImage();
  if (!imagePath) return;
  useNav.getState().go({ name: "image-occlusion", mode: { kind: "add", imagePath, notetypeId } });
}

/* ------------------------------ Loading ------------------------------ */

interface LoadedImage {
  name: string;
  bytes: Uint8Array;
  url: string;
  size: Size;
}

async function decodeImage(name: string, bytes: Uint8Array): Promise<LoadedImage> {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: MIME[ext] ?? "image/png" }));
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new Error(tio("imageFailed"));
  }
  // SVGs without a size report zero.
  const size = { width: img.naturalWidth || 600, height: img.naturalHeight || 400 };
  return { name, bytes, url, size };
}

async function imageFromPath(path: string): Promise<LoadedImage> {
  const resp = await core.getImageForOcclusion({ path });
  return decodeImage(resp.name || path.split(/[\\/]/).pop() || "image.png", resp.data);
}

function isIoNotetype(nt: Notetype): boolean {
  return nt.config?.originalStockKind === StockNotetype_OriginalStockKind.IMAGE_OCCLUSION;
}

/** The Note Type to add with: the one asked for, the Add screen's if it is Image Occlusion, or the first one (adding it if needed). */
async function findIoNotetype(preferred?: bigint): Promise<Notetype> {
  if (preferred) {
    const nt = await core.getNotetype({ ntid: preferred });
    if (isIoNotetype(nt)) return nt;
  }
  try {
    const defaults = await core.defaultsForAdding({ homeDeckOfCurrentReviewCard: 0n });
    const nt = await core.getNotetype({ ntid: defaults.notetypeId });
    if (isIoNotetype(nt)) return nt;
  } catch {
    // fall through to the list
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const names = (await core.getNotetypeNames()).entries;
    const all = await Promise.all(names.map((e) => core.getNotetype({ ntid: e.id })));
    const found = all.find(isIoNotetype);
    if (found) return found;
    if (attempt === 0) await core.addImageOcclusionNotetype({ origin: ORIGIN });
  }
  throw new Error(tio("noNotetype"));
}

/** A Note Type holding only the Header and Back Extra fields, for the shared fields editor. */
function fieldsNotetype(nt: Notetype, header: number, backExtra: number): Notetype {
  const fields = [nt.fields[header], nt.fields[backExtra]].filter(Boolean);
  return create(NotetypeSchema, {
    ...nt,
    fields,
    config: nt.config ? { ...nt.config, kind: Notetype_Config_Kind.NORMAL } : undefined,
  });
}

interface Session {
  notetype: Notetype;
  /** Field order of the Note Type: occlusions, image, header, back extra. */
  indexes: { occlusions: number; image: number; header: number; backExtra: number };
  image: LoadedImage | null;
  occlusions: Occlusion[];
  header: string;
  backExtra: string;
  tags: string[];
  occludeInactive: boolean;
}

async function loadSession(mode: ImageOcclusionMode): Promise<Session> {
  if (mode.kind === "edit") {
    const [resp, note] = await Promise.all([core.getImageOcclusionNote({ noteId: mode.noteId }), core.getNote({ nid: mode.noteId })]);
    if (resp.value.case !== "note") throw new Error(resp.value.case === "error" ? resp.value.value : tr("notetypes-error-getting-imagecloze"));
    const io = resp.value.value;
    const [notetype, fields] = await Promise.all([
      core.getNotetype({ ntid: note.notetypeId }),
      core.getImageOcclusionFields({ notetypeId: note.notetypeId }),
    ]);
    const image = await decodeImage(io.imageFileName || "image.png", io.imageData);
    return {
      notetype,
      indexes: indexesOf(fields.fields),
      image,
      occlusions: occlusionsFromStored(io.occlusions, image.size, TEXT_FONT_SIZE),
      header: io.header,
      backExtra: io.backExtra,
      tags: io.tags,
      occludeInactive: io.occludeInactive,
    };
  }
  const notetype = await findIoNotetype(mode.notetypeId);
  const fields = await core.getImageOcclusionFields({ notetypeId: notetype.id });
  const image = mode.imagePath ? await imageFromPath(mode.imagePath) : null;
  return {
    notetype,
    indexes: indexesOf(fields.fields),
    image,
    occlusions: [],
    header: "",
    backExtra: "",
    tags: [],
    occludeInactive: true,
  };
}

function indexesOf(fields: { occlusions: number; image: number; header: number; backExtra: number } | undefined) {
  return { occlusions: fields?.occlusions ?? 0, image: fields?.image ?? 1, header: fields?.header ?? 2, backExtra: fields?.backExtra ?? 3 };
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/* ------------------------------ Screen ------------------------------ */

type OcclusionMode = "all" | "one";

export function ImageOcclusionScreen({ mode }: { mode: ImageOcclusionMode }) {
  const key = mode.kind === "edit" ? `edit-${mode.noteId}` : `add-${mode.imagePath ?? ""}-${mode.notetypeId ?? ""}`;
  return <ImageOcclusionView key={key} mode={mode} />;
}

function ImageOcclusionView({ mode }: { mode: ImageOcclusionMode }) {
  const back = useNav((s) => s.back);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [session, setSession] = useState<Session | null>(null);
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [history, setHistory] = useState<History<Occlusion[]>>(() => initHistory([]));
  const [header, setHeader] = useState("");
  const [backExtra, setBackExtra] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [occlusionMode, setOcclusionMode] = useState<OcclusionMode>("all");
  const [deckId, setDeckId] = useState<bigint | null>(null);
  const [deckOpen, setDeckOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingImage, setLoadingImage] = useState(false);
  const [tab, setTab] = useState<"mask" | "note">("mask");
  const [wide, setWide] = useState(true);
  const fit = useRef(1);
  const root = useRef<HTMLDivElement>(null);
  const baseline = useRef("");

  const decks = useQuery({
    queryKey: ["editor", "deckNames"],
    queryFn: async () =>
      (await core.getDeckNames({ skipEmptyDefault: true, includeFiltered: false })).entries
        .map((e) => ({ id: e.id, name: e.name }))
        .sort((a, b) => localeCompare(a.name, b.name)),
    enabled: mode.kind === "add",
  });

  const apply = useCallback((s: Session) => {
    setSession(s);
    setImage(s.image);
    setHistory(initHistory(s.occlusions));
    setHeader(s.header);
    setBackExtra(s.backExtra);
    setTags(s.tags);
    setOcclusionMode(s.occludeInactive ? "all" : "one");
    baseline.current = JSON.stringify([s.header, s.backExtra, s.tags]);
  }, []);

  useEffect(() => {
    let live = true;
    setPhase("loading");
    loadSession(mode)
      .then(async (s) => {
        if (!live) return;
        apply(s);
        if (mode.kind === "add") {
          try {
            const defaults = await core.defaultsForAdding({ homeDeckOfCurrentReviewCard: 0n });
            const deck = await core.defaultDeckForNotetype({ ntid: s.notetype.id }).catch(() => ({ did: 0n }));
            if (live) setDeckId(deck.did || defaults.deckId);
          } catch {
            if (live) setDeckId(1n);
          }
        }
        if (live) setPhase("ready");
      })
      .catch((err: unknown) => {
        if (!live) return;
        setError(err instanceof Error ? err.message : String(err));
        setPhase("error");
      });
    return () => {
      live = false;
    };
  }, [mode, attempt, apply]);

  // Blob URLs are freed when the image is replaced or the screen closes.
  useEffect(() => {
    if (!image) return;
    return () => URL.revokeObjectURL(image.url);
  }, [image]);

  // Side by side when there is room; tabs otherwise.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWide(entry.contentRect.width >= 900));
    observer.observe(el);
    return () => observer.disconnect();
  }, [phase]);

  const occlusions = history.present;
  const dirty =
    phase === "ready" &&
    (history.past.length > 0 ||
      JSON.stringify([header, backExtra, tags]) !== baseline.current ||
      (mode.kind === "add" && !!image && occlusions.length > 0));

  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    return setLeaveGuard((proceed) => {
      if (!dirtyRef.current) return true;
      void confirm({
        title: tr("card-templates-discard-changes"),
        message: tio("discardLead"),
        confirm: tr("actions-discard"),
        danger: true,
      }).then((ok) => ok && proceed());
      return false;
    });
  }, []);

  const change = useCallback((next: Occlusion[]) => setHistory((h) => commit(h, next)), []);

  const imageRef = useRef<LoadedImage | null>(null);
  imageRef.current = image;
  const loadImage = useCallback(async (load: () => Promise<LoadedImage>) => {
    setLoadingImage(true);
    try {
      const next = await load();
      const previous = imageRef.current;
      // Masks drawn on an earlier image keep their place relative to it.
      if (previous && (previous.size.width !== next.size.width || previous.size.height !== next.size.height)) {
        const sx = next.size.width / previous.size.width;
        const sy = next.size.height / previous.size.height;
        setHistory((h) => commit(h, h.present.map((o) => ({ ...o, shapes: o.shapes.map((s) => scaleShape(s, { x: 0, y: 0 }, sx, sy)) }))));
      }
      setImage(next);
    } catch (err) {
      toast.error(tio("imageFailed"), { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoadingImage(false);
    }
  }, []);

  const pickFile = useCallback(async () => {
    const path = await chooseImage();
    if (path) await loadImage(() => imageFromPath(path));
  }, [loadImage]);

  const pasteImage = useCallback(async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (!type) continue;
        const blob = await item.getType(type);
        const ext = type.split("/")[1].replace("jpeg", "jpg").replace("svg+xml", "svg");
        await loadImage(async () => decodeImage(`paste-${Date.now().toString(36)}.${ext}`, new Uint8Array(await blob.arrayBuffer())));
        return;
      }
    } catch {
      // permission refused or nothing readable
    }
    toast(tr("editing-no-image-found-on-clipboard"));
  }, [loadImage]);

  // Without an image, Ctrl+V pastes one and a dropped file is used.
  const needsImage = phase === "ready" && mode.kind === "add" && !image;
  useEffect(() => {
    if (!needsImage) return;
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (!file) return;
      e.preventDefault();
      const ext = file.type.split("/")[1].replace("jpeg", "jpg").replace("svg+xml", "svg");
      void loadImage(async () => decodeImage(file.name && file.name !== "image.png" ? file.name : `paste-${Date.now().toString(36)}.${ext}`, new Uint8Array(await file.arrayBuffer())));
    };
    window.addEventListener("paste", onPaste);
    let unlisten: (() => void) | undefined;
    let disposed = false;
    try {
      getCurrentWebview()
        .onDragDropEvent((event) => {
          if (event.payload.type !== "drop") return;
          const path = event.payload.paths.find(isImagePath);
          if (path) void loadImage(() => imageFromPath(path));
        })
        .then((fn) => (disposed ? fn() : (unlisten = fn)))
        .catch(() => {});
    } catch {
      // Not running inside the desktop shell.
    }
    return () => {
      window.removeEventListener("paste", onPaste);
      disposed = true;
      unlisten?.();
    };
  }, [needsImage, loadImage]);

  const save = useCallback(async () => {
    if (!session || !image || saving) return;
    const minSize = 5 / fit.current;
    const out = exportOcclusions(occlusions, image.size, occlusionMode === "all", minSize, measureText);
    if (out.noteCount === 0) {
      toast(tio("noMasks"));
      return;
    }
    setSaving(true);
    try {
      if (mode.kind === "edit") {
        await core.updateImageOcclusionNote(
          { noteId: mode.noteId, occlusions: out.clozes, header, backExtra, tags },
          { origin: ORIGIN },
        );
        toast.success(tr("browsing-cards-updated", { count: out.noteCount }));
        baseline.current = JSON.stringify([header, backExtra, tags]);
        setHistory(initHistory(occlusions.map((o, i) => ({ ...o, ordinal: o.ordinal ?? out.ordinals[i] }))));
        dirtyRef.current = false;
        back();
        return;
      }
      if (deckId === null) return;
      const { indexes, notetype } = session;
      const name = await addMediaBytes(image.name, image.bytes);
      const note = await core.newNote({ ntid: notetype.id });
      const fields = [...note.fields];
      fields[indexes.occlusions] = out.clozes;
      fields[indexes.image] = `<img src="${escapeAttribute(name)}">`;
      fields[indexes.header] = header;
      fields[indexes.backExtra] = backExtra;
      await core.addNote({ note: { ...note, fields, tags }, deckId }, { origin: ORIGIN });
      toast.success(tr("importing-cards-added", { count: out.noteCount }));
      // Ready for the next image; the Deck and Tags stay, as in Add.
      setImage(null);
      setHistory(initHistory([]));
      setHeader("");
      setBackExtra("");
      baseline.current = JSON.stringify(["", "", tags]);
      setTab("mask");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [session, image, saving, occlusions, occlusionMode, mode, header, backExtra, tags, deckId, back]);

  // Ctrl+Enter adds or saves from anywhere on the screen; Escape leaves.
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (e.isComposing || document.querySelector("[role=dialog]")) return;
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        void save();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.code === "KeyD" && mode.kind === "add") {
        e.preventDefault();
        setDeckOpen(true);
        return;
      }
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (e.key === "Escape" && !typing && !e.defaultPrevented) {
        e.preventDefault();
        back();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [save, back, mode.kind]);

  const editorNotetype = useMemo(
    () => (session ? fieldsNotetype(session.notetype, session.indexes.header, session.indexes.backExtra) : null),
    [session],
  );

  if (phase === "loading") {
    return (
      <div ref={root} className="grid h-full place-items-center">
        <Spinner className="size-5" />
      </div>
    );
  }

  if (phase === "error" || !session || !editorNotetype) {
    return (
      <div ref={root} className="grid h-full place-items-center px-8">
        <div className="flex max-w-[400px] flex-col items-center text-center">
          <span className="mb-4 grid size-12 place-items-center rounded-full bg-surface-3 text-ink-2">
            <ImageOff className="size-5" />
          </span>
          <p className="text-[14px] font-medium text-ink">{mode.kind === "edit" ? tio("loadFailed") : tio("imageFailed")}</p>
          <p className="selectable mt-1.5 text-[12.5px] text-ink-3">{error}</p>
          <div className="mt-5 flex gap-2">
            <Button onClick={back}>{tr("actions-close")}</Button>
            <Button variant="primary" onClick={() => setAttempt((n) => n + 1)}>
              {tio("retry")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const modeControl = (
    <Segmented<OcclusionMode>
      label={tr("editing-image-occlusion-mode")}
      value={occlusionMode}
      onChange={setOcclusionMode}
      options={[
        { value: "all", label: tr("notetypes-hide-all-guess-one") },
        { value: "one", label: tr("notetypes-hide-one-guess-one") },
      ]}
    />
  );

  const maskArea = image ? (
    <MaskEditor
      imageUrl={image.url}
      size={image.size}
      value={occlusions}
      onChange={change}
      canUndo={history.past.length > 0}
      canRedo={history.future.length > 0}
      onUndo={() => setHistory(undo)}
      onRedo={() => setHistory(redo)}
      active={wide || tab === "mask"}
      onFit={(f) => (fit.current = f)}
      toolbarEnd={
        mode.kind === "add" ? (
          <Button size="sm" variant="ghost" onClick={() => void pickFile()} disabled={loadingImage}>
            {loadingImage ? <Spinner /> : <ImageUp />}
            {tio("changeImage")}
          </Button>
        ) : undefined
      }
    />
  ) : (
    <ImagePicker loading={loadingImage} onPick={() => void pickFile()} onPaste={() => void pasteImage()} />
  );

  const notePanel = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-3 border-b border-line px-5 pb-3.5 pt-3.5">
        {mode.kind === "add" && (
          <Chooser
            label={tr("decks-deck")}
            shortcut="Ctrl+D"
            items={decks.data ?? []}
            value={deckId}
            onSelect={setDeckId}
            open={deckOpen}
            onOpenChange={setDeckOpen}
            searchLabel={te("searchDecks")}
            hierarchical
          />
        )}
        <div className="space-y-1.5">
          <div className="text-[12px] font-medium text-ink-2">{tr("editing-image-occlusion-mode")}</div>
          {modeControl}
        </div>
      </div>
      <FieldsEditor
        className="flex-1"
        mode="edit"
        notetype={editorNotetype}
        fields={[header, backExtra]}
        onFieldChange={(index, value) => (index === 0 ? setHeader(value) : setBackExtra(value))}
        tags={tags}
        onTagsChange={setTags}
      />
    </div>
  );

  const footer = (
    <div className="flex shrink-0 items-center justify-end gap-3 border-t border-line bg-bg px-5 py-3">
      <span className="flex items-center gap-1 text-[12px] text-ink-3" aria-hidden>
        <Kbd>Ctrl</Kbd>
        <Kbd>Enter</Kbd>
      </span>
      <Button variant="primary" onClick={() => void save()} disabled={saving || !image || (mode.kind === "add" && deckId === null)}>
        {saving && <Spinner className="text-on-accent" />}
        {mode.kind === "add" ? tr("actions-add") : tr("actions-save")}
      </Button>
    </div>
  );

  return (
    <div ref={root} className="flex h-full min-h-0 flex-col">
      {!wide && (
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2">
          <Segmented<"mask" | "note">
            label={tr("notetypes-image-occlusion-name")}
            value={tab}
            onChange={setTab}
            options={[
              { value: "mask", label: tr("notetypes-occlusion-mask") },
              { value: "note", label: tr("notetypes-occlusion-note") },
            ]}
          />
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <div className={cn("flex min-h-0 min-w-0 flex-1", !wide && tab !== "mask" && "hidden")}>{maskArea}</div>
        <aside
          aria-label={tio("notePanel")}
          className={cn(
            "flex min-h-0 flex-col bg-bg",
            wide ? "w-[400px] shrink-0 border-s border-line" : tab === "note" ? "flex-1" : "hidden",
          )}
        >
          {notePanel}
          {wide && footer}
        </aside>
      </div>
      {!wide && footer}
    </div>
  );
}

function ImagePicker({ loading, onPick, onPaste }: { loading: boolean; onPick: () => void; onPaste: () => void }) {
  return (
    <div className="grid min-h-0 flex-1 place-items-center bg-surface-3 px-8">
      <div className="flex w-full max-w-[420px] flex-col items-center rounded-[14px] border border-dashed border-line-strong bg-surface px-8 py-10 text-center">
        <span className="mb-4 grid size-12 place-items-center rounded-full bg-accent-soft text-accent-ink">
          {loading ? <Spinner className="size-5 text-accent-ink" /> : <ImagePlus className="size-5" />}
        </span>
        <h2 className="text-[15px] font-semibold text-ink">{tr("notetypes-image-occlusion-name")}</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{tio("chooseLead")}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button variant="primary" onClick={onPick} disabled={loading} autoFocus>
            <ImagePlus />
            {tr("notetypes-io-select-image")}
          </Button>
          <Button onClick={onPaste} disabled={loading}>
            <ClipboardPaste />
            {tr("notetypes-io-paste-image-from-clipboard")}
          </Button>
        </div>
        <p className="mt-4 text-[12px] text-ink-3">{tio("dropHint")}</p>
      </div>
    </div>
  );
}
