// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * A Note's tags as chips with an input at the end. Space or Enter commits the
 * typed tag, Backspace in an empty input takes the last tag back for editing,
 * and suggestions come from the collection's tags.
 */
import { Tag, X } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

import { cn } from "@/components/ui";
import * as core from "@/lib/anki/generated/core";
import { tr } from "@/lib/i18n";
import { te } from "@/lib/strings/editor";

import { addTags, normalizeTag, splitTags, tagLevels } from "./tags";

export interface TagEditorHandle {
  focus(): void;
  /** Commits whatever is typed; returns the resulting tags. */
  commit(): string[];
}

interface Props {
  tags: string[];
  onChange: (tags: string[]) => void;
  onBlur?: () => void;
  className?: string;
}

function TagText({ tag }: { tag: string }) {
  const levels = tagLevels(tag);
  return (
    <span className="truncate">
      {levels.map((level, i) => (
        <span key={i} className={i < levels.length - 1 ? "text-ink-3" : undefined}>
          {level}
          {i < levels.length - 1 && <span className="px-px text-ink-3">::</span>}
        </span>
      ))}
    </span>
  );
}

export const TagEditor = forwardRef<TagEditorHandle, Props>(function TagEditor({ tags, onChange, onBlur, className }, ref) {
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [highlight, setHighlight] = useState(-1);
  const [focused, setFocused] = useState(false);
  const composing = useRef(false);
  const latest = useRef({ tags, text });
  latest.current = { tags, text };

  const commitText = (value: string, base = latest.current.tags): string[] => {
    const added = splitTags(value);
    setText("");
    setSuggestions([]);
    setHighlight(-1);
    if (!added.length) return base;
    const next = addTags(base, added);
    if (next.length !== base.length) onChange(next);
    return next;
  };

  useImperativeHandle(ref, () => ({
    focus: () => input.current?.focus(),
    commit: () => (latest.current.text.trim() ? commitText(latest.current.text) : latest.current.tags),
  }));

  // Suggestions for the tag being typed.
  useEffect(() => {
    const typed = normalizeTag(text);
    if (!typed || !focused) {
      setSuggestions([]);
      return;
    }
    let live = true;
    const timer = window.setTimeout(() => {
      core
        .completeTag({ input: typed, matchLimit: 12 })
        .then((reply) => {
          if (!live) return;
          const present = new Set(latest.current.tags.map((t) => t.toLowerCase()));
          setSuggestions(reply.tags.filter((t) => !present.has(t.toLowerCase())));
          setHighlight(-1);
        })
        .catch(() => live && setSuggestions([]));
    }, 90);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [text, focused]);

  const remove = (index: number) => onChange(tags.filter((_, i) => i !== index));

  const edit = (index: number) => {
    const pending = latest.current.text.trim();
    const rest = tags.filter((_, i) => i !== index);
    onChange(pending ? addTags(rest, splitTags(pending)) : rest);
    setText(tags[index]);
    requestAnimationFrame(() => input.current?.focus());
  };

  const open = focused && suggestions.length > 0;

  return (
    <div className={cn("relative", className)}>
      <div
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) {
            e.preventDefault();
            input.current?.focus();
          }
        }}
        className={cn(
          "flex min-h-9 flex-wrap items-center gap-1.5 rounded-[10px] border bg-surface px-2 py-1.5",
          "transition-[border-color,box-shadow] duration-[var(--dur-fast)]",
          focused ? "border-accent shadow-ring" : "border-line hover:border-line-strong",
        )}
      >
        <Tag aria-hidden className="ms-0.5 size-3.5 shrink-0 text-ink-3" />
        {tags.map((tag, i) => (
          <span
            key={`${tag}-${i}`}
            className="group/tag inline-flex h-6 max-w-[260px] items-center gap-0.5 rounded-[6px] bg-surface-3 ps-2 pe-0.5 text-caption text-ink"
          >
            <button
              type="button"
              tabIndex={-1}
              className="min-w-0 truncate text-start"
              title={te("editTag", { tag })}
              onClick={() => edit(i)}
            >
              <TagText tag={tag} />
            </button>
            <button
              type="button"
              tabIndex={-1}
              aria-label={te("removeTag", { tag })}
              onClick={() => remove(i)}
              className="grid size-5 place-items-center rounded-[4px] text-ink-3 hover:bg-line hover:text-ink"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          ref={input}
          value={text}
          aria-label={tr("editing-tags")}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls="tag-suggestions"
          role="combobox"
          placeholder={tags.length ? "" : tr("editing-tags-add")}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className="h-6 min-w-[90px] flex-1 bg-transparent text-control text-ink outline-none placeholder:text-ink-3"
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            if (latest.current.text.trim()) commitText(latest.current.text);
            onBlur?.();
          }}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onChange={(e) => {
            const value = e.target.value;
            // A space typed (or pasted) ends a tag.
            if (!composing.current && /[\s　]/.test(value)) {
              const parts = value.split(/[\s　]+/);
              const last = parts.pop() ?? "";
              commitText(parts.join(" "));
              setText(last);
              return;
            }
            setText(value);
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || composing.current) return;
            if (open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              const step = e.key === "ArrowDown" ? 1 : -1;
              setHighlight((h) => {
                const next = h + step;
                return next >= suggestions.length ? -1 : next < -1 ? suggestions.length - 1 : next;
              });
              return;
            }
            if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
              e.preventDefault();
              commitText(open && highlight >= 0 ? suggestions[highlight] : text);
              return;
            }
            if (e.key === "Enter") {
              // Ctrl+Enter adds the Note; the typed tag goes with it.
              if (text.trim()) commitText(text);
              return;
            }
            if (e.key === "Tab" && open && !e.shiftKey) {
              e.preventDefault();
              const pick = suggestions[highlight >= 0 ? highlight : 0];
              setText(pick);
              setSuggestions([]);
              return;
            }
            if (e.key === "Escape" && (open || text)) {
              e.preventDefault();
              e.stopPropagation();
              if (open) setSuggestions([]);
              else setText("");
              return;
            }
            if (e.key === "Backspace" && text === "" && tags.length) {
              e.preventDefault();
              const last = tags[tags.length - 1];
              onChange(tags.slice(0, -1));
              setText(last);
            }
          }}
        />
      </div>
      {open && (
        <ul
          id="tag-suggestions"
          data-tag-suggestions=""
          role="listbox"
          className="absolute inset-x-0 bottom-full z-30 mb-1.5 max-h-[220px] overflow-auto rounded-[10px] border border-line bg-raised p-1 shadow-pop animate-pop-in"
        >
          {suggestions.map((tag, i) => (
            <li
              key={tag}
              role="option"
              aria-selected={i === highlight}
              onMouseDown={(e) => {
                e.preventDefault();
                commitText(tag);
              }}
              onMouseEnter={() => setHighlight(i)}
              className={cn(
                "flex h-7 items-center rounded-[6px] px-2.5 text-control text-ink",
                i === highlight && "bg-accent-soft",
              )}
            >
              <TagText tag={tag} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
