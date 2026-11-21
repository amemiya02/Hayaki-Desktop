// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** The grouped rows and compact controls the Deck options screen is built from. */
import { AlertTriangle, Check, ChevronDown, Globe, Info, RotateCcw } from "lucide-react";
import { Popover, Select } from "radix-ui";
import { useState, type ReactNode } from "react";

import { cn, IconButton, TextField, Tooltip } from "@/components/ui";
import { tr } from "@/lib/i18n";
import { td } from "@/lib/strings/deck-options";

import { stepsToString, stringToSteps } from "./steps";
import type { Warning } from "./warnings";

/* ------------------------------ Layout ------------------------------ */

export function Section({ id, title, children, footer }: { id: string; title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-6 pt-8 first:pt-0">
      <h2 id={`${id}-title`} tabIndex={-1} className="mb-2.5 px-1 text-[13px] font-semibold text-ink-2">
        {title}
      </h2>
      <div className="divide-y divide-line overflow-hidden rounded-[12px] border border-line bg-surface">{children}</div>
      {footer}
    </section>
  );
}

export interface RowProps {
  label: ReactNode;
  /** Plain-text name, for the help button and the control's accessible name. */
  name: string;
  help?: string;
  /** The option applies to the whole collection, not only this preset. */
  global?: boolean;
  messages?: (Warning | null | undefined)[];
  /** Shows a restore button when the value differs from Anki's default. */
  onRestore?: () => void;
  children?: ReactNode;
  /** Content shown under the row, full width. */
  below?: ReactNode;
  id?: string;
}

export function Row({ label, name, help, global, messages, onRestore, children, below, id }: RowProps) {
  const shown = (messages ?? []).filter((m): m is Warning => !!m);
  return (
    <div>
      <div className="flex min-h-[52px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5">
        <div className="flex min-w-[180px] flex-1 items-center gap-1.5">
          {typeof label === "string" ? (
            <label htmlFor={id} className="text-[13.5px] text-ink">
              {label}
            </label>
          ) : (
            <div className="text-[13.5px] text-ink">{label}</div>
          )}
          {global && <GlobalMark />}
          {help && <HelpButton title={name} text={help} />}
        </div>
        {(children || onRestore) && (
          <div className="ml-auto flex items-center gap-1.5">
            {onRestore && (
              <IconButton label={tr("deck-config-revert-button-tooltip")} size="sm" onClick={onRestore} className="text-ink-3">
                <RotateCcw />
              </IconButton>
            )}
            {children}
          </div>
        )}
      </div>
      {below && <div className="px-4 pb-3">{below}</div>}
      {shown.length > 0 && (
        <div className="space-y-1.5 px-4 pb-3" aria-live="polite">
          {shown.map((m) => (
            <Message key={m.key} warning={m} />
          ))}
        </div>
      )}
    </div>
  );
}

export function Message({ warning }: { warning: Warning }) {
  const Icon = warning.level === "info" ? Info : AlertTriangle;
  return (
    <p
      className={cn(
        "flex items-start gap-2 text-[12.5px] leading-snug whitespace-pre-line",
        warning.level === "info" ? "text-ink-2" : "text-danger",
      )}
    >
      <Icon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      <span>{warning.text ?? tr(warning.key, warning.args)}</span>
    </p>
  );
}

export function GlobalMark() {
  return (
    <Tooltip content={tr("deck-config-affects-entire-collection")}>
      <span tabIndex={0} aria-label={tr("deck-config-affects-entire-collection")} className="inline-grid size-5 place-items-center rounded-[5px] text-ink-3">
        <Globe className="size-3.5" />
      </span>
    </Tooltip>
  );
}

export function HelpButton({ title, text }: { title: string; text: string }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={td("about", { setting: title })}
          className="inline-grid size-5 place-items-center rounded-full text-ink-3 transition-colors duration-[var(--dur-fast)] hover:bg-sidebar-hover hover:text-ink"
        >
          <Info className="size-3.5" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={16}
          className="z-50 w-[360px] max-w-[calc(100vw-32px)] rounded-[10px] border border-line bg-raised p-4 shadow-pop outline-none data-[state=open]:animate-[pop-in_120ms_var(--ease-out)]"
        >
          <p className="mb-1.5 text-[13px] font-semibold text-ink">{title}</p>
          <p className="selectable max-h-[50vh] overflow-y-auto whitespace-pre-line text-[12.5px] leading-relaxed text-ink-2">{text}</p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/* ------------------------------ Controls ------------------------------ */

export function Switch({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; id?: string }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-[var(--dur)]",
        checked ? "bg-accent" : "bg-line-strong",
      )}
    >
      <span
        className={cn(
          "absolute top-[3px] size-4 rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.25)] transition-[left] duration-[var(--dur)] ease-[var(--ease-out)]",
          checked ? "left-[19px]" : "left-[3px]",
        )}
      />
    </button>
  );
}

// The spin box is shared by every screen; Deck options keeps exporting it.
export { NumberField, type NumberFieldProps } from "@/components/ui";

/** Learning steps typed as "1m 10m 1d"; parsed on blur exactly as Anki does. */
export function StepsField({ value, onChange, label, id }: { value: number[]; onChange: (v: number[]) => void; label: string; id?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null) onChange(stringToSteps(draft));
    setDraft(null);
  };
  return (
    <TextField
      id={id}
      aria-label={label}
      spellCheck={false}
      value={draft ?? stepsToString(value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
      className="tabular w-[200px]"
    />
  );
}

export interface Choice<T extends number> {
  value: T;
  label: string;
  disabled?: boolean;
}

export function SelectField<T extends number>({
  value,
  choices,
  onChange,
  label,
  id,
}: {
  value: T;
  choices: Choice<T>[];
  onChange: (value: T) => void;
  label: string;
  id?: string;
}) {
  return (
    <Select.Root value={String(value)} onValueChange={(v) => onChange(Number(v) as T)}>
      <Select.Trigger
        id={id}
        aria-label={label}
        className={cn(
          "inline-flex h-8 w-[260px] max-w-full items-center justify-between gap-2 rounded-[8px] border border-line bg-surface px-2.5 text-left text-[13px] text-ink outline-none",
          "transition-[border-color,box-shadow] duration-[var(--dur-fast)] hover:border-line-strong",
          "focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_var(--accent-soft)] focus-visible:outline-none data-[state=open]:border-accent",
        )}
      >
        <span className="min-w-0 truncate">
          <Select.Value />
        </span>
        <Select.Icon>
          <ChevronDown className="size-4 shrink-0 text-ink-3" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          position="popper"
          sideOffset={4}
          align="end"
          className="z-50 max-h-[var(--radix-select-content-available-height)] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-[10px] border border-line bg-raised p-1 shadow-pop data-[state=open]:animate-[pop-in_120ms_var(--ease-out)]"
        >
          <Select.Viewport>
            {choices.map((choice) => (
              <Select.Item
                key={choice.value}
                value={String(choice.value)}
                disabled={choice.disabled}
                className="relative flex min-h-8 cursor-default select-none items-center rounded-[6px] py-1.5 pl-8 pr-3 text-[13px] text-ink outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-accent-soft"
              >
                <Select.ItemIndicator className="absolute left-2.5 inline-flex">
                  <Check className="size-4 text-accent-ink" />
                </Select.ItemIndicator>
                <Select.ItemText>{choice.label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

/** A compact segmented control, for the limit tabs and easy days. */
export function MiniSegmented({
  value,
  options,
  onChange,
  label,
}: {
  value: number;
  options: string[];
  onChange: (index: number) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-[8px] bg-surface-3 p-[2px]">
      {options.map((option, index) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === index}
          tabIndex={value === index ? 0 : -1}
          onClick={() => onChange(index)}
          onKeyDown={(e) => {
            const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
            if (!delta) return;
            e.preventDefault();
            const next = (index + delta + options.length) % options.length;
            onChange(next);
            const buttons = e.currentTarget.parentElement?.querySelectorAll("button");
            buttons?.[next]?.focus();
          }}
          className={cn(
            "h-6 whitespace-nowrap rounded-[6px] px-2.5 text-[12px] font-medium text-ink-2 transition-colors duration-[var(--dur-fast)]",
            value === index ? "bg-raised text-ink shadow-[0_1px_2px_rgb(0_0_0/0.12)]" : "hover:text-ink",
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
