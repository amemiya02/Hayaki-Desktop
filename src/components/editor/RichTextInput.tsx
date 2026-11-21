// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * A field's rich-text input: a `contenteditable` holding the field's HTML.
 *
 * The element owns its DOM. The stored HTML is written into it only when the
 * value changes from outside (another input, a reload, a reset after Add),
 * never in answer to its own typing, so the caret, the undo history and IME
 * composition are left alone. Nothing is emitted while a composition is open.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type CSSProperties } from "react";

import { cn } from "@/components/ui";
import { mediaUrl } from "@/lib/study/audio";

import { insertHtml, rememberSelection } from "./dom";
import { ImageHandle } from "./ImageHandle";
import { displayToField, fieldToDisplay, normalizeEmpty } from "./media-src";
import { copiedMath, displayToMath, mathToDisplay } from "./mathjax";
import { MathjaxPopover } from "./MathjaxPopover";
import { encodePastedImage, isClipboardBitmap, stripsFormatting, useEditingPrefs } from "./paste";
import { sanitizeHtml, textToHtml } from "./sanitize";

const MEDIA_PREFIX = mediaUrl("");

/** Set while text dragged from inside the app is in flight; the browser moves it without help. */
let internalDrag = false;

/** Raised on a field's element after a MathJax chip is inserted, so its editor opens on it. */
export const MATH_INSERTED_EVENT = "hayaki-math-inserted";

const MATH_CHIP = '[data-anki="mathjax"]';

export const toDisplay = (html: string) => mathToDisplay(fieldToDisplay(html, mediaUrl));
export const toStored = (html: string) => normalizeEmpty(displayToField(displayToMath(html), MEDIA_PREFIX));

/** Shared look of field content, so lists, headings and images read as they will on the Card. */
export const fieldContentClass =
  "[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:ps-6 [&_ol]:ps-6 [&_h1]:text-[1.6em] [&_h2]:text-[1.35em] [&_h3]:text-[1.15em] " +
  "[&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_img]:inline [&_img]:max-w-full [&_img]:h-auto [&_img]:max-h-[320px] " +
  "[&_a]:text-accent-ink [&_a]:underline [&_blockquote]:border-s-2 [&_blockquote]:border-line-strong [&_blockquote]:ps-3 " +
  "[&_pre]:font-mono [&_code]:font-mono [&_table]:border-collapse [&_td]:border [&_td]:border-line [&_td]:px-1.5 " +
  "[&_th]:border [&_th]:border-line [&_th]:px-1.5 [&_hr]:my-2 [&_hr]:border-line " +
  // An image the person expanded keeps its own size; a MathJax chip is one atom you click to edit.
  "[&_img[data-editor-shrink=false]]:max-h-none [&_img[data-editor-shrink=false]]:max-w-none " +
  "[&_[data-anki=mathjax]]:mx-0.5 [&_[data-anki=mathjax]]:cursor-pointer [&_[data-anki=mathjax]]:rounded-[6px] [&_[data-anki=mathjax]]:bg-accent-soft " +
  "[&_[data-anki=mathjax]]:px-1.5 [&_[data-anki=mathjax]]:font-mono [&_[data-anki=mathjax]]:text-[0.9em] [&_[data-anki=mathjax]]:text-accent-ink " +
  "[&_[data-anki=mathjax]]:select-none [&_[data-anki=mathjax]:empty]:before:content-['…'] " +
  "[&_[data-anki=mathjax][data-block=true]]:my-1 [&_[data-anki=mathjax][data-block=true]]:block [&_[data-anki=mathjax][data-block=true]]:w-fit";

function clipboardFragment(html: string): string {
  const start = html.indexOf("<!--StartFragment-->");
  const end = html.indexOf("<!--EndFragment-->");
  return start >= 0 && end > start ? html.slice(start + 20, end) : html;
}

/** Pasted or dropped HTML, cleaned. MathJax chips copied from a field turn back into text first, then into chips again. */
function fromClipboardHtml(html: string): string {
  return mathToDisplay(sanitizeHtml(displayToMath(clipboardFragment(html))));
}

function mediaFiles(list: FileList | undefined | null): File[] {
  return [...(list ?? [])].filter((f) => /^(image|audio|video)\//.test(f.type));
}

export interface RichTextInputProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  fontFamily?: string;
  fontSize?: number;
  rtl?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  /** Stores pasted or dropped files; resolves to the HTML to insert for each. */
  onFiles: (files: File[]) => Promise<string[]>;
  elementRef?: (element: HTMLDivElement | null) => void;
  className?: string;
}

export function RichTextInput({
  value,
  onChange,
  label,
  placeholder,
  fontFamily,
  fontSize,
  rtl,
  onFocus,
  onBlur,
  onFiles,
  elementRef,
  className,
}: RichTextInputProps) {
  const element = useRef<HTMLDivElement | null>(null);
  /** The stored value the DOM currently represents. */
  const shown = useRef<string | null>(null);
  const composing = useRef(false);
  const shiftPaste = useRef(false);
  /** Chips inserted in this session; only these are removed when closed empty. */
  const fresh = useRef(new WeakSet<HTMLElement>());
  const handlers = useRef({ onChange, value });
  handlers.current = { onChange, value };
  const prefs = useEditingPrefs();
  const latestPrefs = useRef(prefs);
  latestPrefs.current = prefs;
  const [chip, setChip] = useState<HTMLElement | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  const markEmpty = (el: HTMLElement) => {
    const empty = el.textContent === "" && !el.querySelector("img,video,audio,hr,table");
    el.toggleAttribute("data-empty", empty);
  };

  useLayoutEffect(() => {
    const el = element.current;
    if (!el || value === shown.current) return;
    el.innerHTML = toDisplay(value);
    shown.current = value;
    markEmpty(el);
  }, [value]);

  const emit = () => {
    const el = element.current;
    if (!el || composing.current) return;
    markEmpty(el);
    const next = toStored(el.innerHTML);
    shown.current = next;
    if (next !== handlers.current.value) handlers.current.onChange(next);
  };

  /** Pasted bitmaps are saved as PNG or JPEG as Anki's preference says; other files are stored as they are. */
  const insertFiles = (files: File[], pasted = false) => {
    const el = element.current;
    if (!el) return;
    rememberSelection(el);
    const prepared = files.map((file) =>
      pasted && isClipboardBitmap(file) ? encodePastedImage(file, latestPrefs.current.imagesAsPng).catch(() => file) : file,
    );
    void Promise.all(prepared)
      .then(onFiles)
      .then((snippets) => {
        if (snippets.length) insertHtml(el, snippets.join(""));
      });
  };

  /** Copy and cut keep a MathJax chip's `\\( \\)` form on the clipboard, as text and as HTML. */
  const copyMath = (e: ClipboardEvent<HTMLDivElement>, cut: boolean) => {
    const selection = document.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return;
    const holder = document.createElement("div");
    holder.append(selection.getRangeAt(0).cloneContents());
    const copied = copiedMath(holder.innerHTML);
    if (!copied) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", copied.text);
    e.clipboardData.setData("text/html", copied.html);
    if (cut) document.execCommand("delete");
  };

  const closeChip = () => {
    const el = element.current;
    if (chip && el) {
      if (chip.isConnected && fresh.current.has(chip) && !chip.dataset.mathjax) {
        chip.remove();
        emit();
      }
      el.focus({ preventScroll: true });
      if (chip.isConnected) {
        const range = document.createRange();
        range.setStartAfter(chip);
        range.collapse(true);
        const selection = document.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }
    setChip(null);
  };

  const openInsertedChip = () => {
    const inserted = element.current?.querySelector<HTMLElement>("[data-autofocus]");
    inserted?.removeAttribute("data-autofocus");
    if (inserted) {
      fresh.current.add(inserted);
      setChip(inserted);
    }
  };

  useEffect(() => {
    const el = element.current;
    el?.addEventListener(MATH_INSERTED_EVENT, openInsertedChip);
    return () => el?.removeEventListener(MATH_INSERTED_EVENT, openInsertedChip);
    // The handler reads only refs and a stable setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style: CSSProperties = {
    fontFamily: fontFamily ? `"${fontFamily.replace(/["\\]/g, "")}", var(--font-ui)` : undefined,
    fontSize: fontSize ? `${fontSize}px` : undefined,
  };

  return (
    <>
    <div
      ref={(el) => {
        element.current = el;
        elementRef?.(el);
      }}
      onClickCapture={(e) => {
        const target = e.target as HTMLElement;
        const math = target.closest<HTMLElement>(MATH_CHIP);
        setChip(math);
        setImage(!math && target instanceof HTMLImageElement && !target.dataset.anki ? target : null);
      }}
      role="textbox"
      aria-multiline="true"
      aria-label={label}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      dir={rtl ? "rtl" : undefined}
      data-placeholder={placeholder}
      data-rich-input=""
      style={style}
      className={cn(
        "selectable min-h-[1.5em] break-words px-3 py-2 leading-[1.45] text-ink outline-none",
        "caret-[var(--accent)] data-[empty]:before:pointer-events-none data-[empty]:before:text-ink-3",
        "data-[empty]:before:content-[attr(data-placeholder)]",
        fieldContentClass,
        className,
      )}
      onInput={(e) => {
        if ((e.nativeEvent as InputEvent).isComposing) return;
        setImage(null);
        emit();
      }}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
        // Let the browser finish committing the text before it is read.
        queueMicrotask(emit);
      }}
      onFocus={onFocus}
      onBlur={() => {
        shiftPaste.current = false;
        if (element.current) rememberSelection(element.current);
        onBlur?.();
      }}
      onKeyDown={(e) => {
        shiftPaste.current = (e.ctrlKey || e.metaKey) && e.shiftKey && e.code === "KeyV";
      }}
      // A paste fires during keydown; whatever is left after the key goes up belongs to no paste.
      onKeyUp={() => {
        shiftPaste.current = false;
      }}
      onCopy={(e) => copyMath(e, false)}
      onCut={(e) => copyMath(e, true)}
      onPaste={(e) => {
        const data = e.clipboardData;
        const files = mediaFiles(data.files);
        if (files.length) {
          e.preventDefault();
          insertFiles(files, true);
          return;
        }
        const html = data.getData("text/html");
        const text = data.getData("text/plain");
        // Shift inverts "paste without Shift key strips formatting".
        const strip = stripsFormatting(latestPrefs.current.stripsFormatting, shiftPaste.current);
        shiftPaste.current = false;
        if (html && !strip) {
          e.preventDefault();
          insertHtml(e.currentTarget, fromClipboardHtml(html));
        } else if (text) {
          e.preventDefault();
          insertHtml(e.currentTarget, textToHtml(text));
        }
      }}
      onDragStart={() => {
        internalDrag = true;
      }}
      onDragEnd={() => {
        internalDrag = false;
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files") || e.dataTransfer.types.includes("text/html")) e.preventDefault();
      }}
      onDrop={(e) => {
        const files = mediaFiles(e.dataTransfer.files);
        const html = e.dataTransfer.getData("text/html");
        if (!files.length && (!html || internalDrag)) return;
        e.preventDefault();
        const el = e.currentTarget;
        const range = document.caretRangeFromPoint?.(e.clientX, e.clientY);
        el.focus();
        if (range && el.contains(range.startContainer)) {
          const selection = document.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
        }
        if (files.length) insertFiles(files);
        else insertHtml(el, fromClipboardHtml(html));
      }}
    />
    {chip && (
      <MathjaxPopover
        chip={chip}
        onChange={emit}
        onRemove={() => {
          chip.remove();
          emit();
          closeChip();
        }}
        onClose={closeChip}
      />
    )}
    {image && (
      <ImageHandle
        image={image}
        onChange={emit}
        onClose={() => setImage(null)}
      />
    )}
    </>
  );
}
