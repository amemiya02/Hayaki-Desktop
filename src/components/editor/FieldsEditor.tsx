// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The editing surface shared by Add and Edit: the sticky toolbar, one block
 * per field, and the tags. It owns how fields look and respond to keys; the
 * screen that hosts it owns the Note and when it is saved.
 */
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { cn } from "@/components/ui";
import * as core from "@/lib/anki/generated/core";
import { Notetype_Config_Kind, type Notetype } from "@/lib/anki/proto/anki/notetypes_pb";
import { tr } from "@/lib/i18n";
import { addMediaBytes, addMediaFromPath } from "@/lib/media";
import { te } from "@/lib/strings/editor";
import { mediaUrl } from "@/lib/study/audio";

import { exec, focusAtEnd, insertHtml, insertText, isCommandActive, rememberSelection, surround } from "./dom";
import { EditorField, type FieldConfigView } from "./EditorField";
import { EditorToolbar, HIGHLIGHT_COLOURS, TEXT_COLOURS, type ColourKind } from "./EditorToolbar";
import { clozeNumbersIn, clozeSurround, mathSurround, nextClozeNumber, type MathKind } from "./markup";
import { isMediaPath, MEDIA_EXTENSIONS, mediaReference } from "./media-src";
import { TagEditor, type TagEditorHandle } from "./TagEditor";

export interface FieldsEditorHandle {
  focusField(index: number): void;
  focusTags(): void;
  /** Commits a tag still being typed; returns the tags. */
  commitTags(): string[];
}

export interface FieldsEditorProps {
  notetype: Notetype;
  /** "add" allows cloze deletions on any Note Type (with a warning) and shows sticky pins. */
  mode: "add" | "edit";
  fields: string[];
  onFieldChange: (index: number, value: string) => void;
  tags: string[];
  onTagsChange: (tags: string[]) => void;
  sticky?: boolean[];
  onToggleSticky?: (index: number) => void;
  /** A notice under a field, such as the duplicate warning under the first. */
  notices?: (ReactNode | undefined)[];
  /** Called when an input loses focus, so the host can save at once. */
  onInputBlur?: () => void;
  /** Set while an IME composition is open in any input. */
  composingRef?: MutableRefObject<boolean>;
  autoFocus?: boolean;
  /** Content after the tags, inside the scrolling area. */
  footer?: ReactNode;
  /** Field indexes not shown, such as an Image Occlusion Note's mask and image fields. */
  hiddenFields?: number[];
  className?: string;
}

type InputKind = "rich" | "plain";

const COMMANDS_SHOWN = ["bold", "italic", "underline", "superscript", "subscript", "insertUnorderedList", "insertOrderedList", "justifyCenter", "justifyRight", "justifyFull"];

const COLOUR_KEY = "hayaki.editor.colours";

function loadColours(): Record<ColourKind, string> {
  try {
    const saved = JSON.parse(localStorage.getItem(COLOUR_KEY) ?? "null") as Partial<Record<ColourKind, string>> | null;
    return { text: saved?.text ?? TEXT_COLOURS[1], highlight: saved?.highlight ?? HIGHLIGHT_COLOURS[0] };
  } catch {
    return { text: TEXT_COLOURS[1], highlight: HIGHLIGHT_COLOURS[0] };
  }
}

function fieldViews(notetype: Notetype): FieldConfigView[] {
  return notetype.fields.map((f) => ({
    name: f.name,
    description: f.config?.description ?? "",
    fontName: f.config?.fontName || "Arial",
    fontSize: f.config?.fontSize || 20,
    rtl: !!f.config?.rtl,
    plainText: !!f.config?.plainText,
  }));
}

function pastedName(file: File): string {
  const ext = file.type.split("/")[1]?.replace("jpeg", "jpg").replace(/[^a-z0-9]/g, "") || "bin";
  if (file.name && file.name !== "image.png" && file.name !== "blob") return file.name;
  return `paste-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.${ext}`;
}

export const FieldsEditor = forwardRef<FieldsEditorHandle, FieldsEditorProps>(function FieldsEditor(
  {
    notetype,
    mode,
    fields,
    onFieldChange,
    tags,
    onTagsChange,
    sticky,
    onToggleSticky,
    notices,
    onInputBlur,
    composingRef,
    autoFocus,
    footer,
    hiddenFields,
    className,
  },
  ref,
) {
  const views = useMemo(() => fieldViews(notetype), [notetype]);
  const isCloze = notetype.config?.kind === Notetype_Config_Kind.CLOZE;

  const [collapsed, setCollapsed] = useState<boolean[]>([]);
  const [htmlOpen, setHtmlOpen] = useState<boolean[]>([]);
  const [richOpen, setRichOpen] = useState<boolean[]>([]);
  const [layoutFor, setLayoutFor] = useState<bigint | null>(null);
  if (layoutFor !== notetype.id) {
    // A different Note Type starts from its fields' own defaults.
    setLayoutFor(notetype.id);
    const cfg = notetype.fields.map((f) => f.config);
    setCollapsed(cfg.map((c) => !!c?.collapsed));
    setHtmlOpen(cfg.map((c) => !!c?.plainText));
    setRichOpen(cfg.map((c) => !c?.plainText));
  }

  const rich = useRef<(HTMLDivElement | null)[]>([]);
  const plain = useRef<(HTMLTextAreaElement | null)[]>([]);
  const active = useRef<{ index: number; kind: InputKind }>({ index: 0, kind: "rich" });
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [activeKind, setActiveKind] = useState<InputKind>("rich");
  const [commandState, setCommandState] = useState<ReadonlySet<string>>(new Set());
  const [colours, setColours] = useState(loadColours);
  const [colourOpen, setColourOpen] = useState<ColourKind | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const chord = useRef<number>(0);
  const tagEditor = useRef<TagEditorHandle>(null);
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef({ fields, collapsed, richOpen, htmlOpen });
  latest.current = { fields, collapsed, richOpen, htmlOpen };
  const localComposing = useRef(false);
  const composing = composingRef ?? localComposing;

  /** The element commands go to: the last focused input, or the first field. */
  const target = useCallback((): { element: HTMLElement; kind: InputKind; index: number } | null => {
    const { index, kind } = active.current;
    const element = kind === "rich" ? rich.current[index] : plain.current[index];
    if (element) return { element, kind, index };
    const other = kind === "rich" ? plain.current[index] : rich.current[index];
    if (other) return { element: other, kind: kind === "rich" ? "plain" : "rich", index };
    const first = rich.current.findIndex(Boolean);
    if (first >= 0) return { element: rich.current[first]!, kind: "rich", index: first };
    const firstPlain = plain.current.findIndex(Boolean);
    return firstPlain >= 0 ? { element: plain.current[firstPlain]!, kind: "plain", index: firstPlain } : null;
  }, []);

  const focusField = useCallback((index: number) => {
    const { collapsed: c, richOpen: r } = latest.current;
    if (c[index]) setCollapsed((prev) => prev.map((v, i) => (i === index ? false : v)));
    requestAnimationFrame(() => {
      const element = r[index] !== false ? rich.current[index] : plain.current[index];
      const fallback = element ?? plain.current[index] ?? rich.current[index];
      if (fallback) focusAtEnd(fallback);
    });
  }, []);

  useImperativeHandle(ref, () => ({
    focusField,
    focusTags: () => tagEditor.current?.focus(),
    commitTags: () => tagEditor.current?.commit() ?? tags,
  }));

  useEffect(() => {
    if (autoFocus) focusField(0);
    // Only on mount and when the Note Type changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus, notetype.id]);

  // Which formatting applies at the caret, for the toolbar's pressed states.
  useEffect(() => {
    const update = () => {
      const el = document.activeElement as HTMLElement | null;
      if (!el?.hasAttribute("data-rich-input") || !root.current?.contains(el)) return;
      rememberSelection(el);
      const next = new Set(COMMANDS_SHOWN.filter(isCommandActive));
      setCommandState((prev) => (prev.size === next.size && [...next].every((c) => prev.has(c)) ? prev : next));
    };
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, []);

  // Ctrl+Shift+T reaches the tags from anywhere on the screen.
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === "KeyT") {
        e.preventDefault();
        tagEditor.current?.focus();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const runCommand = (command: string, value?: string) => {
    const t = target();
    if (!t || t.kind !== "rich") return;
    exec(t.element, command, value);
  };

  const applyColour = (kind: ColourKind, colour: string) => {
    setColours((prev) => {
      const next = { ...prev, [kind]: colour };
      try {
        localStorage.setItem(COLOUR_KEY, JSON.stringify(next));
      } catch {
        // Remembering the colour is a convenience only.
      }
      return next;
    });
    runCommand(kind === "text" ? "foreColor" : "hiliteColor", colour);
  };

  const cloze = async (increment: boolean) => {
    const t = target();
    if (!t) return;
    if (!isCloze) {
      if (mode === "edit") {
        toast(tr("editing-to-make-a-cloze-deletion-on"));
        return;
      }
      toast(tr("editing-warning-cloze-deletions-will-not-work"));
    }
    const current = latest.current.fields;
    let numbers: number[];
    try {
      numbers = (await core.clozeNumbersInNote({ notetypeId: notetype.id, fields: current })).numbers;
    } catch {
      numbers = clozeNumbersIn(current);
    }
    surround(t.element, clozeSurround(nextClozeNumber(numbers, increment)));
  };

  const math = (kind: MathKind) => {
    const t = target();
    if (t) surround(t.element, mathSurround(kind));
  };

  /** Stores files and returns references to insert: display URLs for rich text, bare names for HTML. */
  const storeFiles = async (store: () => Promise<string>[], kind: InputKind, names: string[]): Promise<string[]> => {
    const results = await Promise.allSettled(store());
    const refs: string[] = [];
    results.forEach((result, i) => {
      if (result.status === "fulfilled") refs.push(mediaReference(result.value, kind === "rich" ? mediaUrl : undefined));
      else toast.error(te("attachFailed", { name: names[i] }), { description: String(result.reason) });
    });
    return refs;
  };

  const onFiles = (files: File[]) =>
    storeFiles(
      () => files.map(async (file) => addMediaBytes(pastedName(file), new Uint8Array(await file.arrayBuffer()))),
      "rich",
      files.map((f) => f.name),
    );

  const insertPaths = async (paths: string[], into: { element: HTMLElement; kind: InputKind }) => {
    if (into.kind === "rich") rememberSelection(into.element);
    const refs = await storeFiles(() => paths.map((p) => addMediaFromPath(p)), into.kind, paths.map((p) => p.split(/[\\/]/).pop() ?? p));
    if (!refs.length) return;
    if (into.kind === "rich") insertHtml(into.element, refs.join(""));
    else insertText(into.element as HTMLTextAreaElement, refs.join(""));
  };

  const attach = async () => {
    const into = target();
    if (!into) return;
    if (into.kind === "rich") rememberSelection(into.element);
    const chosen = await openDialog({
      multiple: true,
      directory: false,
      title: tr("editing-attach-picturesaudiovideo"),
      filters: [{ name: tr("editing-media"), extensions: MEDIA_EXTENSIONS }],
    });
    const paths = chosen === null ? [] : Array.isArray(chosen) ? chosen : [chosen];
    if (paths.length) await insertPaths(paths, into);
    else into.element.focus();
  };

  // Files dropped from the desktop arrive through the window, not the page.
  const dropHandler = useRef<(paths: string[], x: number, y: number) => void>(() => {});
  dropHandler.current = (paths, x, y) => {
    const section = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-field-index]");
    if (!section || !root.current?.contains(section)) return;
    const index = Number(section.dataset.fieldIndex);
    const usePlain = !!document.elementFromPoint(x, y)?.closest("[data-plain-input]");
    const element = usePlain ? plain.current[index] : (rich.current[index] ?? plain.current[index]);
    if (!element) return;
    const kind: InputKind = element instanceof HTMLTextAreaElement ? "plain" : "rich";
    element.focus();
    if (kind === "rich") {
      const range = document.caretRangeFromPoint?.(x, y);
      if (range && element.contains(range.startContainer)) {
        const selection = document.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }
    active.current = { index, kind };
    void insertPaths(paths.filter(isMediaPath), { element, kind });
  };

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    let dragging: string[] = [];
    const indexAt = (x: number, y: number) => {
      const section = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-field-index]");
      return section && root.current?.contains(section) ? Number(section.dataset.fieldIndex) : null;
    };
    try {
      getCurrentWebview()
        .onDragDropEvent((event) => {
          const payload = event.payload;
          const scale = window.devicePixelRatio || 1;
          if (payload.type === "leave") {
            dragging = [];
            setDropIndex(null);
            return;
          }
          const x = payload.position.x / scale;
          const y = payload.position.y / scale;
          if (payload.type === "enter") dragging = payload.paths.filter(isMediaPath);
          if (payload.type === "drop") {
            setDropIndex(null);
            const media = payload.paths.filter(isMediaPath);
            dragging = [];
            if (media.length) dropHandler.current(media, x, y);
            return;
          }
          setDropIndex(dragging.length ? indexAt(x, y) : null);
        })
        .then((fn) => (disposed ? fn() : (unlisten = fn)))
        .catch(() => {});
    } catch {
      // Not running inside the desktop shell.
    }
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const toggleHtml = (index: number) => {
    const plainField = views[index]?.plainText;
    if (plainField) {
      // A plain-text field always shows its HTML; the toggle shows the rich text too.
      const show = !latest.current.richOpen[index];
      setRichOpen((prev) => prev.map((v, i) => (i === index ? show : v)));
      requestAnimationFrame(() => {
        const el = show ? rich.current[index] : plain.current[index];
        if (el) focusAtEnd(el);
      });
      return;
    }
    const show = !latest.current.htmlOpen[index];
    setHtmlOpen((prev) => prev.map((v, i) => (i === index ? show : v)));
    requestAnimationFrame(() => {
      const el = show ? plain.current[index] : rich.current[index];
      if (el) focusAtEnd(el);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing || composing.current) return;
    // Field shortcuts apply only while a field has focus, not in the tags.
    if (!(e.target as HTMLElement).closest?.("[data-field-index]")) return;
    const mod = e.ctrlKey || e.metaKey;
    const t = active.current;

    if (chord.current && Date.now() - chord.current < 1500) {
      chord.current = 0;
      const kind = e.code === "KeyM" ? "inline" : e.code === "KeyE" ? "block" : e.code === "KeyC" ? "chemistry" : null;
      if (kind) {
        e.preventDefault();
        math(kind);
        return;
      }
    }
    chord.current = 0;

    if (e.key === "F3") {
      e.preventDefault();
      void attach();
      return;
    }
    if (e.key === "F7") {
      e.preventDefault();
      applyColour("text", colours.text);
      return;
    }
    if (e.key === "F8") {
      e.preventDefault();
      setColourOpen((open) => (open === "text" ? null : "text"));
      return;
    }
    if (e.key === "F9" && onToggleSticky) {
      e.preventDefault();
      onToggleSticky(t.index);
      return;
    }
    if (!mod) return;

    const code = e.code;
    const press = (fn: () => void) => {
      e.preventDefault();
      e.stopPropagation();
      fn();
    };
    if (e.shiftKey && code === "KeyX") return press(() => toggleHtml(t.index));
    if (e.shiftKey && code === "KeyC") return press(() => void cloze(!e.altKey));
    if (!e.shiftKey && !e.altKey && code === "KeyM") return press(() => (chord.current = Date.now()));
    if (t.kind !== "rich") return;
    if (!e.shiftKey && !e.altKey) {
      if (code === "KeyB") return press(() => runCommand("bold"));
      if (code === "KeyI") return press(() => runCommand("italic"));
      if (code === "KeyU") return press(() => runCommand("underline"));
      if (code === "KeyR") return press(() => runCommand("removeFormat"));
      if (code === "Comma") return press(() => runCommand("insertUnorderedList"));
      if (code === "Period") return press(() => runCommand("insertOrderedList"));
    }
    if (code === "Equal" || e.key === "=" || e.key === "+") {
      return press(() => runCommand(e.shiftKey || e.key === "+" ? "superscript" : "subscript"));
    }
    if (e.shiftKey && code === "Comma") return press(() => runCommand("outdent"));
    if (e.shiftKey && code === "Period") return press(() => runCommand("indent"));
  };

  return (
    <div
      ref={root}
      className={cn("min-h-0 overflow-auto", className)}
      onKeyDown={onKeyDown}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
      }}
    >
      <div className="sticky top-0 z-20 border-b border-line bg-bg/95 px-5 py-1.5 backdrop-blur-sm">
        <EditorToolbar
          active={commandState}
          richTarget={activeKind === "rich"}
          onCommand={runCommand}
          onCloze={(increment) => void cloze(increment)}
          onMath={math}
          onAttach={() => void attach()}
          colours={colours}
          onColour={applyColour}
          colourOpen={colourOpen}
          onColourOpen={setColourOpen}
          clozeEnabled={isCloze || mode === "add"}
        />
      </div>
      <div className="flex flex-col gap-3.5 px-5 pb-6 pt-4">
        {views.map((view, index) => hiddenFields?.includes(index) ? null : (
          <EditorField
            key={`${String(notetype.id)}-${index}`}
            index={index}
            config={view}
            value={fields[index] ?? ""}
            onChange={(value) => onFieldChange(index, value)}
            richOpen={richOpen[index] ?? true}
            htmlOpen={htmlOpen[index] ?? false}
            onToggleHtml={() => toggleHtml(index)}
            collapsed={collapsed[index] ?? false}
            onToggleCollapsed={() => setCollapsed((prev) => views.map((_, i) => (i === index ? !prev[i] : !!prev[i])))}
            sticky={sticky?.[index]}
            onToggleSticky={onToggleSticky ? () => onToggleSticky(index) : undefined}
            focused={focusedIndex === index}
            dropTarget={dropIndex === index}
            onFocusInput={(kind) => {
              active.current = { index, kind };
              setFocusedIndex(index);
              setActiveKind(kind);
            }}
            onBlurInput={() => {
              setFocusedIndex((current) => (current === index ? null : current));
              onInputBlur?.();
            }}
            onFiles={onFiles}
            registerRich={(el) => {
              rich.current[index] = el;
            }}
            registerPlain={(el) => {
              plain.current[index] = el;
            }}
            notice={notices?.[index]}
          />
        ))}
        <div className="pt-1">
          <div className="mb-1 flex h-7 items-center ps-0.5 text-caption font-medium text-ink-2">{tr("editing-tags")}</div>
          <TagEditor ref={tagEditor} tags={tags} onChange={onTagsChange} onBlur={onInputBlur} />
        </div>
        {footer}
      </div>
    </div>
  );
});
