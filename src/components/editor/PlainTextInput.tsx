// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** A field's HTML source, edited as text in a monospace textarea that grows with its content. */
import { useLayoutEffect, useRef } from "react";

import { cn } from "@/components/ui";

export interface PlainTextInputProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  rtl?: boolean;
  placeholder?: string;
  onFocus?: () => void;
  onBlur?: () => void;
  elementRef?: (element: HTMLTextAreaElement | null) => void;
  className?: string;
}

export function PlainTextInput({ value, onChange, label, rtl, placeholder, onFocus, onBlur, elementRef, className }: PlainTextInputProps) {
  const element = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const el = element.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={(el) => {
        element.current = el;
        elementRef?.(el);
      }}
      aria-label={label}
      value={value}
      rows={1}
      dir={rtl ? "rtl" : undefined}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      placeholder={placeholder}
      data-plain-input=""
      onChange={(e) => onChange(e.target.value)}
      onFocus={onFocus}
      onBlur={onBlur}
      className={cn(
        "block w-full resize-none overflow-hidden bg-transparent px-3 py-2 font-mono text-caption leading-[1.55] text-ink outline-none",
        "placeholder:text-ink-3",
        className,
      )}
    />
  );
}
