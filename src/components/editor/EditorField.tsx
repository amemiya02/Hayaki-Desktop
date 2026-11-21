// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * One field of a Note: its name, an optional description, a collapse toggle,
 * a sticky pin (Add only), the rich-text input and the HTML source below it.
 */
import { ChevronRight, Code, Pin } from "lucide-react";
import type { ReactNode } from "react";

import { cn, Tooltip } from "@/components/ui";
import { withChord } from "@/lib/chord";
import { tr } from "@/lib/i18n";

import { PlainTextInput } from "./PlainTextInput";
import { RichTextInput } from "./RichTextInput";
import { htmlToText } from "./sanitize";

export interface FieldConfigView {
  name: string;
  description: string;
  fontName: string;
  fontSize: number;
  rtl: boolean;
  plainText: boolean;
}

export interface EditorFieldProps {
  index: number;
  config: FieldConfigView;
  value: string;
  onChange: (value: string) => void;
  /** Rich text shown (off for plain-text fields until toggled). */
  richOpen: boolean;
  /** HTML source shown. */
  htmlOpen: boolean;
  onToggleHtml: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  sticky?: boolean;
  onToggleSticky?: () => void;
  focused: boolean;
  dropTarget: boolean;
  onFocusInput: (kind: "rich" | "plain") => void;
  onBlurInput: () => void;
  onFiles: (files: File[]) => Promise<string[]>;
  registerRich: (element: HTMLDivElement | null) => void;
  registerPlain: (element: HTMLTextAreaElement | null) => void;
  notice?: ReactNode;
}

const badge =
  "grid size-6 place-items-center rounded-[6px] text-ink-3 transition-[color,background-color,opacity] duration-[var(--dur-fast)] " +
  "hover:bg-surface-3 hover:text-ink [&_svg]:size-3.5";

export function EditorField({
  index,
  config,
  value,
  onChange,
  richOpen,
  htmlOpen,
  onToggleHtml,
  collapsed,
  onToggleCollapsed,
  sticky,
  onToggleSticky,
  focused,
  dropTarget,
  onFocusInput,
  onBlurInput,
  onFiles,
  registerRich,
  registerPlain,
  notice,
}: EditorFieldProps) {
  const summary = collapsed ? htmlToText(value) : "";
  const htmlLabel = `${tr("editing-html-editor")}: ${config.name}`;

  return (
    <section data-field-index={index} className="group/field">
      <div className="flex h-7 items-center gap-1 ps-0.5">
        <button
          type="button"
          tabIndex={-1}
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? tr("editing-expand-field") : tr("editing-collapse-field")}
          className="flex min-w-0 items-center gap-1 rounded-[6px] py-0.5 pe-1.5 text-start"
        >
          <ChevronRight
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 text-ink-3 transition-transform duration-[var(--dur)] ease-out",
              !collapsed && "rotate-90 rtl:-rotate-90",
              collapsed && "rtl:rotate-180",
            )}
          />
          <span className={cn("truncate text-caption font-medium", focused ? "text-accent-ink" : "text-ink-2")}>
            {config.name}
          </span>
        </button>
        {summary && <span className="min-w-0 flex-1 truncate text-caption text-ink-3">{summary}</span>}
        <div className="ms-auto flex items-center gap-0.5">
          <Tooltip content={withChord(tr("editing-toggle-html-editor"), "Ctrl+Shift+X")}>
            <button
              type="button"
              tabIndex={-1}
              aria-pressed={htmlOpen}
              aria-label={tr("editing-toggle-html-editor")}
              onMouseDown={(e) => e.preventDefault()}
              onClick={onToggleHtml}
              className={cn(
                badge,
                htmlOpen ? "text-accent-ink opacity-100" : "opacity-0 group-hover/field:opacity-100 group-focus-within/field:opacity-100",
              )}
            >
              <Code />
            </button>
          </Tooltip>
          {onToggleSticky && (
            <Tooltip content={`${tr("editing-toggle-sticky")} (F9)`}>
              <button
                type="button"
                tabIndex={-1}
                aria-pressed={!!sticky}
                aria-label={tr("editing-toggle-sticky")}
                onMouseDown={(e) => e.preventDefault()}
                onClick={onToggleSticky}
                className={cn(
                  badge,
                  sticky ? "text-accent-ink opacity-100" : "opacity-0 group-hover/field:opacity-100 group-focus-within/field:opacity-100",
                )}
              >
                <Pin className={cn(sticky && "fill-current")} />
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      {!collapsed && (
        <div
          className={cn(
            "overflow-hidden rounded-[10px] border bg-surface transition-[border-color,box-shadow] duration-[var(--dur-fast)]",
            focused || dropTarget
              ? "border-accent shadow-ring"
              : "border-line hover:border-line-strong",
            dropTarget && "bg-accent-softer",
          )}
        >
          {richOpen && (
            <RichTextInput
              value={value}
              onChange={onChange}
              label={config.name}
              placeholder={config.description}
              fontFamily={config.fontName}
              fontSize={config.fontSize}
              rtl={config.rtl}
              onFocus={() => onFocusInput("rich")}
              onBlur={onBlurInput}
              onFiles={onFiles}
              elementRef={registerRich}
            />
          )}
          {htmlOpen && (
            <div className={cn(richOpen && "border-t border-dashed border-line bg-surface-2")}>
              <PlainTextInput
                value={value}
                onChange={onChange}
                label={htmlLabel}
                rtl={config.rtl}
                placeholder={richOpen ? undefined : config.description}
                onFocus={() => onFocusInput("plain")}
                onBlur={onBlurInput}
                elementRef={registerPlain}
              />
            </div>
          )}
        </div>
      )}
      {notice && !collapsed && <div className="mt-1.5 ps-1">{notice}</div>}
    </section>
  );
}
