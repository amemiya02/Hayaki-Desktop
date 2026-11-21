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
import { useLayoutEffect, useRef, type CSSProperties } from "react";

import { cn } from "@/components/ui";
import { mediaUrl } from "@/lib/study/audio";

import { insertHtml, rememberSelection } from "./dom";
import { displayToField, fieldToDisplay, normalizeEmpty } from "./media-src";
import { sanitizeHtml, textToHtml } from "./sanitize";

const MEDIA_PREFIX = mediaUrl("");

/** Set while text dragged from inside the app is in flight; the browser moves it without help. */
let internalDrag = false;

export const toDisplay = (html: string) => fieldToDisplay(html, mediaUrl);
export const toStored = (html: string) => normalizeEmpty(displayToField(html, MEDIA_PREFIX));

/** Shared look of field content, so lists, headings and images read as they will on the Card. */
export const fieldContentClass =
  "[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:ps-6 [&_ol]:ps-6 [&_h1]:text-[1.6em] [&_h2]:text-[1.35em] [&_h3]:text-[1.15em] " +
  "[&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_img]:inline [&_img]:max-w-full [&_img]:h-auto [&_img]:max-h-[320px] " +
  "[&_a]:text-accent-ink [&_a]:underline [&_blockquote]:border-s-2 [&_blockquote]:border-line-strong [&_blockquote]:ps-3 " +
  "[&_pre]:font-mono [&_code]:font-mono [&_table]:border-collapse [&_td]:border [&_td]:border-line [&_td]:px-1.5 " +
  "[&_th]:border [&_th]:border-line [&_th]:px-1.5 [&_hr]:my-2 [&_hr]:border-line";

function clipboardFragment(html: string): string {
  const start = html.indexOf("<!--StartFragment-->");
  const end = html.indexOf("<!--EndFragment-->");
  return start >= 0 && end > start ? html.slice(start + 20, end) : html;
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
  const plainPaste = useRef(false);
  const handlers = useRef({ onChange, value });
  handlers.current = { onChange, value };

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

  const insertFiles = (files: File[]) => {
    const el = element.current;
    if (!el) return;
    rememberSelection(el);
    void onFiles(files).then((snippets) => {
      if (snippets.length) insertHtml(el, snippets.join(""));
    });
  };

  const style: CSSProperties = {
    fontFamily: fontFamily ? `"${fontFamily.replace(/["\\]/g, "")}", var(--font-ui)` : undefined,
    fontSize: fontSize ? `${fontSize}px` : undefined,
  };

  return (
    <div
      ref={(el) => {
        element.current = el;
        elementRef?.(el);
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
        if (element.current) rememberSelection(element.current);
        onBlur?.();
      }}
      onKeyDown={(e) => {
        plainPaste.current = (e.ctrlKey || e.metaKey) && e.shiftKey && e.code === "KeyV";
      }}
      onPaste={(e) => {
        const data = e.clipboardData;
        const files = mediaFiles(data.files);
        if (files.length) {
          e.preventDefault();
          insertFiles(files);
          return;
        }
        const html = data.getData("text/html");
        const text = data.getData("text/plain");
        const plain = plainPaste.current;
        plainPaste.current = false;
        if (html && !plain) {
          e.preventDefault();
          insertHtml(e.currentTarget, sanitizeHtml(clipboardFragment(html)));
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
        else insertHtml(el, sanitizeHtml(clipboardFragment(html)));
      }}
    />
  );
}
