// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** Hayaki's base controls, built on Radix primitives with the app's tokens. */
import { clsx, type ClassValue } from "clsx";
import { Check, ChevronDown, ChevronRight, ChevronUp, X } from "lucide-react";
import { DropdownMenu, Dialog as RadixDialog, Tooltip as RadixTooltip } from "radix-ui";
import { forwardRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { Toaster } from "sonner";
import { extendTailwindMerge } from "tailwind-merge";

import { displayChord } from "@/lib/chord";
import { t } from "@/lib/i18n";

import { clampTo, parseNumber, placesOf, stepFrom } from "./number-field";

/** The app's own scale names, so `cn` keeps a size and a colour side by side. */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["micro", "caption", "control", "body", "title", "heading", "headline", "display"],
      shadow: ["pop", "thumb", "knob", "ring", "ring-danger", "ring-inset"],
      animate: ["fade-in", "pop-in", "dialog-in", "rise-in", "rise-quick"],
    },
  },
});

export function cn(...values: ClassValue[]): string {
  return twMerge(clsx(values));
}

/* ------------------------------ Motion tokens ------------------------------ */

function cssToken(name: string): string {
  if (typeof document === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function seconds(name: string, fallbackMs: number): number {
  const value = cssToken(name);
  const ms = value.endsWith("ms") ? Number.parseFloat(value) : value.endsWith("s") ? Number.parseFloat(value) * 1000 : Number.NaN;
  return (Number.isFinite(ms) ? ms : fallbackMs) / 1000;
}

function bezier(name: string, fallback: [number, number, number, number]): [number, number, number, number] {
  const match = /cubic-bezier\(([^)]+)\)/.exec(cssToken(name));
  const parts = match?.[1].split(",").map((p) => Number.parseFloat(p));
  return parts && parts.length === 4 && parts.every(Number.isFinite) ? (parts as [number, number, number, number]) : fallback;
}

let tokens: ReturnType<typeof readMotion> | null = null;
function readMotion() {
  return {
    fast: seconds("--dur-fast", 90),
    quick: seconds("--dur-quick", 140),
    base: seconds("--dur", 200),
    slow: seconds("--dur-slow", 320),
    easeOut: bezier("--ease-out", [0.16, 1, 0.3, 1]),
    easeStandard: bezier("--ease-standard", [0.2, 0, 0, 1]),
  };
}

/** Durations (seconds) and easings for Motion, read from the CSS tokens in app.css. */
export function motionTokens() {
  tokens ??= readMotion();
  return tokens;
}

/* ------------------------------ Buttons ------------------------------ */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

const buttonBase =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium select-none " +
  "transition-[background-color,border-color,color,box-shadow,transform,opacity] duration-[var(--dur-fast)] ease-standard " +
  "active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-on-accent hover:bg-accent-hover",
  secondary: "bg-surface text-ink border border-line hover:bg-surface-2 hover:border-line-strong",
  ghost: "text-ink-2 hover:bg-sidebar-hover hover:text-ink",
  danger: "bg-danger text-on-danger hover:opacity-90",
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-control rounded-[7px]",
  md: "h-8 px-3.5 text-control rounded-[8px]",
  lg: "h-10 px-5 text-body rounded-[10px]",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", className, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(buttonBase, buttonVariants[variant], buttonSizes[size], className)}
      {...props}
    />
  );
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonProps & { label: string }>(function IconButton(
  { label, className, size = "md", variant = "ghost", ...props },
  ref,
) {
  const box = size === "sm" ? "size-7" : size === "lg" ? "size-10" : "size-8";
  return (
    <Tooltip content={label}>
      <Button
        ref={ref}
        aria-label={label}
        variant={variant}
        size={size}
        className={cn(box, "px-0", className)}
        {...props}
      />
    </Tooltip>
  );
});

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] border border-line px-1",
        "font-sans text-micro font-medium text-ink-3 bg-surface-2",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/** A Kbd inside a primary button. */
export const onAccentKbd = "border-transparent bg-[color-mix(in_oklab,var(--on-accent)_18%,transparent)] text-on-accent";

/* ------------------------------ Tooltip ------------------------------ */

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RadixTooltip.Provider delayDuration={500} skipDelayDuration={200}>
      {children}
    </RadixTooltip.Provider>
  );
}

export function Tooltip({ content, children, side = "bottom" }: { content: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          className="z-50 rounded-[6px] bg-ink px-2 py-1 text-caption font-medium text-bg shadow-pop data-[state=delayed-open]:animate-pop-in"
        >
          {content}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}

/* ------------------------------ Fields ------------------------------ */

/** The field look, shared by inputs, selects and other one-line controls. */
export const fieldClass =
  "h-8 w-full rounded-[8px] border border-line bg-surface px-2.5 text-control text-ink " +
  "placeholder:text-ink-3 outline-none transition-[border-color,box-shadow] duration-[var(--dur-fast)] " +
  "hover:border-line-strong focus:border-accent focus:shadow-ring focus-visible:outline-none " +
  "aria-[invalid=true]:border-danger aria-[invalid=true]:focus:border-danger aria-[invalid=true]:focus:shadow-ring-danger " +
  "disabled:opacity-45";

export const TextField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextField(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(fieldClass, className)} {...props} />;
});

export interface NumberFieldProps {
  value: number;
  onChange: (value: number) => void;
  label: string;
  id?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Shown as a percentage, stored as a proportion. */
  percentage?: boolean;
  disabled?: boolean;
  onFocus?: () => void;
  className?: string;
}

/**
 * A spin box like Anki's: type a number and it commits on blur or Enter,
 * clamped to its range; the arrow keys and the steppers move one step, ten
 * with Shift (PageUp and PageDown too). Figures are tabular so values do not
 * shift as they change.
 */
export function NumberField({ value, onChange, label, id, min = 0, max = 9999, step = 1, percentage, disabled, onFocus, className }: NumberFieldProps) {
  const multiplier = percentage ? 100 : 1;
  const range = { min, max, step };
  const shownPlaces = Math.max(0, placesOf(step) - (percentage ? 2 : 0));
  const text = (value * multiplier).toFixed(shownPlaces);
  const [draft, setDraft] = useState<string | null>(null);

  const set = (next: number) => {
    const clamped = clampTo(next, range);
    if (!Number.isNaN(clamped) && clamped !== value) onChange(clamped);
  };
  const current = () => {
    const typed = draft !== null ? parseNumber(draft) / multiplier : Number.NaN;
    return Number.isNaN(typed) ? value : typed;
  };
  const commit = () => {
    if (draft !== null) set(parseNumber(draft) / multiplier);
    setDraft(null);
  };
  const nudge = (direction: 1 | -1, big: boolean) => {
    const next = stepFrom(current(), direction, range, big);
    setDraft(null);
    set(next);
  };

  const stepper = (direction: 1 | -1) => {
    const atEnd = direction === 1 ? value >= max : value <= min;
    return (
      <button
        type="button"
        tabIndex={-1}
        aria-label={t(direction === 1 ? "common.increase" : "common.decrease")}
        disabled={disabled || atEnd}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => nudge(direction, e.shiftKey)}
        className={cn(
          "grid size-6 place-items-center rounded-[6px] text-ink-3",
          "transition-colors duration-[var(--dur-fast)] hover:bg-surface-3 hover:text-ink active:bg-line",
          "disabled:pointer-events-none disabled:opacity-40",
        )}
      >
        {direction === 1 ? <ChevronUp className="size-3.5" strokeWidth={2.25} /> : <ChevronDown className="size-3.5" strokeWidth={2.25} />}
      </button>
    );
  };

  return (
    <div className={cn("relative", percentage ? "w-[136px]" : "w-[124px]", className)}>
      <TextField
        id={id}
        inputMode={placesOf(step) ? "decimal" : "numeric"}
        role="spinbutton"
        aria-label={label}
        aria-valuemin={min * multiplier}
        aria-valuemax={max * multiplier}
        aria-valuenow={Number(text)}
        aria-valuetext={percentage ? `${text}%` : undefined}
        disabled={disabled}
        value={draft ?? text}
        onFocus={onFocus}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          else if (e.key === "ArrowUp" || e.key === "PageUp") (e.preventDefault(), nudge(1, e.shiftKey || e.key === "PageUp"));
          else if (e.key === "ArrowDown" || e.key === "PageDown") (e.preventDefault(), nudge(-1, e.shiftKey || e.key === "PageDown"));
          else if (e.key === "Escape" && draft !== null) (e.stopPropagation(), setDraft(null));
        }}
        className={cn("tabular pe-[58px] text-end", percentage && "pe-[72px]")}
      />
      {percentage && (
        <span aria-hidden className="pointer-events-none absolute end-[58px] top-1/2 -translate-y-1/2 text-control text-ink-3">
          %
        </span>
      )}
      <div className="absolute inset-y-0 end-1 flex items-center gap-px">
        {stepper(-1)}
        {stepper(1)}
      </div>
    </div>
  );
}

/** An on/off setting: accent track when on, the strong hairline when off. */
export function Switch({
  checked,
  onChange,
  label,
  id,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  id?: string;
  disabled?: boolean;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-[var(--dur)] ease-standard",
        "disabled:opacity-45",
        checked ? "bg-accent" : "bg-line-strong",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute left-[3px] top-[3px] size-4 rounded-full bg-knob shadow-knob",
          "transition-transform duration-[var(--dur)] ease-out",
          checked && "translate-x-4 rtl:-translate-x-4",
        )}
      />
    </button>
  );
}

/* ------------------------------ Menus ------------------------------ */

export const Menu = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;

export const menuSurface =
  "z-50 min-w-[200px] rounded-[10px] border border-line bg-raised p-1 shadow-pop " +
  "data-[state=open]:animate-pop-in";

export function MenuContent({ children, align = "end", side }: { children: ReactNode; align?: "start" | "end" | "center"; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content align={align} side={side} sideOffset={6} className={menuSurface}>
        {children}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  );
}

export const menuItemClass =
  "relative flex h-8 cursor-default select-none items-center gap-2.5 rounded-[6px] px-2.5 text-control text-ink outline-none " +
  "data-[highlighted]:bg-accent-soft data-[disabled]:opacity-40 [&_svg]:size-4 [&_svg]:text-ink-2";

export function MenuShortcut({ children }: { children: ReactNode }) {
  return <span className="tabular ms-auto ps-6 text-caption text-ink-3">{typeof children === "string" ? displayChord(children) : children}</span>;
}

export function MenuItem({
  children,
  shortcut,
  onSelect,
  danger,
  disabled,
}: {
  children: ReactNode;
  shortcut?: string;
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      disabled={disabled}
      className={cn(menuItemClass, danger && "text-danger [&_svg]:text-danger")}
    >
      {children}
      {shortcut && <MenuShortcut>{shortcut}</MenuShortcut>}
    </DropdownMenu.Item>
  );
}

/** A toggle row. With an `icon` the check trails the row, so the icon column lines up with plain items. */
export function MenuCheckItem({
  children,
  checked,
  onSelect,
  shortcut,
  icon,
}: {
  children: ReactNode;
  checked: boolean;
  onSelect: () => void;
  shortcut?: string;
  icon?: ReactNode;
}) {
  return (
    <DropdownMenu.CheckboxItem checked={checked} onSelect={onSelect} className={cn(menuItemClass, !icon && "ps-8")}>
      {icon ? (
        <>
          {icon}
          {children}
          {shortcut && <MenuShortcut>{shortcut}</MenuShortcut>}
          <span className={cn("grid size-4 shrink-0 place-items-center", shortcut ? "ms-2" : "ms-auto")}>
            <DropdownMenu.ItemIndicator className="inline-flex">
              <Check />
            </DropdownMenu.ItemIndicator>
          </span>
        </>
      ) : (
        <>
          <DropdownMenu.ItemIndicator className="absolute start-2.5 inline-flex">
            <Check />
          </DropdownMenu.ItemIndicator>
          {children}
          {shortcut && <MenuShortcut>{shortcut}</MenuShortcut>}
        </>
      )}
    </DropdownMenu.CheckboxItem>
  );
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="my-1 h-px bg-line" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <DropdownMenu.Label className="px-2.5 pb-1 pt-1.5 text-caption font-medium text-ink-3">{children}</DropdownMenu.Label>;
}

export function SubMenu({ label, icon, children }: { label: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger className={cn(menuItemClass, "data-[state=open]:bg-accent-soft")}>
        {icon}
        {label}
        <ChevronRight className="ms-auto rtl:rotate-180" />
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent sideOffset={4} className={menuSurface}>
          {children}
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
}

/* ------------------------------ Dialogs ------------------------------ */

/**
 * A dialog opens with focus on its first real control, never on the close
 * button: an explicit `autoFocus` or `data-autofocus` wins, then the first
 * field, then the primary action.
 */
function focusFirstControl(event: Event): void {
  const content = event.currentTarget as HTMLElement | null;
  if (!content) return;
  const pick =
    content.querySelector<HTMLElement>("[data-autofocus], [autofocus]") ??
    content.querySelector<HTMLElement>(
      "input:not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled]), [role=radio][aria-checked=true], [contenteditable=true]",
    ) ??
    content.querySelector<HTMLElement>("[data-dialog-footer] button:last-of-type:not([disabled])");
  // Content that is still loading has no control yet: hold focus on the dialog
  // itself rather than the close button.
  event.preventDefault();
  (pick ?? content).focus();
}

export const scrimClass = "fixed inset-0 z-40 bg-[var(--scrim)] data-[state=open]:animate-fade-in";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = 440,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={scrimClass} />
        <RadixDialog.Content
          style={{ width }}
          onOpenAutoFocus={focusFirstControl}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 max-h-[86vh] max-w-[calc(100vw-48px)] -translate-x-1/2 -translate-y-1/2",
            "flex flex-col rounded-[14px] border border-line bg-raised shadow-pop outline-none",
            "data-[state=open]:animate-dialog-in",
          )}
        >
          <div className="flex items-start gap-3 px-5 pb-2 pt-5">
            <div className="min-w-0 flex-1">
              <RadixDialog.Title className="text-title font-semibold text-ink">{title}</RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="mt-1.5 text-control text-ink-2">{description}</RadixDialog.Description>
              ) : (
                <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>
              )}
            </div>
            <RadixDialog.Close asChild>
              <IconButton label={t("common.close")} size="sm" className="-me-1 -mt-1">
                <X />
              </IconButton>
            </RadixDialog.Close>
          </div>
          {children && <div className="min-h-0 overflow-auto px-5 py-2">{children}</div>}
          {footer && <div data-dialog-footer className="flex justify-end gap-2 px-5 pb-5 pt-3">{footer}</div>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/* ------------------------------ Toasts ------------------------------ */

/** Sonner, unstyled and dressed in the app's tokens (one floating surface, Pop). */
export function AppToaster() {
  return (
    <Toaster
      position="bottom-center"
      gap={8}
      // Sonner centres its loader with position:absolute, so the icon slot is `relative`.
      icons={{ loading: <Spinner className="text-accent" /> }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "group flex w-[var(--width)] items-start gap-3 rounded-[10px] border border-line bg-raised px-4 py-3 text-control text-ink shadow-pop",
          content: "flex min-w-0 flex-1 flex-col gap-0.5",
          title: "font-medium text-ink",
          description: "text-caption tabular-nums text-ink-2",
          icon: "relative flex h-[1lh] w-4 shrink-0 items-center justify-center text-ink-2 [&_svg]:size-4",
          success: "[&_[data-icon]]:text-due",
          error: "[&_[data-icon]]:text-danger",
          warning: "[&_[data-icon]]:text-hard",
          actionButton:
            "h-7 shrink-0 self-center rounded-[7px] px-2.5 text-control font-medium text-accent-ink transition-colors duration-[var(--dur-fast)] hover:bg-accent-soft",
          cancelButton:
            "h-7 shrink-0 self-center rounded-[7px] px-2.5 text-control font-medium text-ink-2 transition-colors duration-[var(--dur-fast)] hover:bg-sidebar-hover",
        },
      }}
    />
  );
}

/* ------------------------------ Misc ------------------------------ */

export function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-4 animate-spin text-ink-3", className)} aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = "md",
  stretch,
  className,
}: {
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (value: T) => void;
  label: string;
  size?: "sm" | "md";
  /** Fill the available width, options sharing it equally. */
  stretch?: boolean;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("shrink-0 rounded-[9px] bg-surface-3 p-[3px]", stretch ? "flex w-full" : "inline-flex", className)}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          title={option.title}
          onClick={() => onChange(option.value)}
          className={cn(
            "shrink-0 whitespace-nowrap rounded-[7px] font-medium text-ink-2 transition-[background-color,color,box-shadow] duration-[var(--dur-fast)]",
            size === "sm" ? "h-6 px-2.5 text-caption" : "h-7 px-3 text-control",
            stretch && "min-w-0 flex-1 truncate",
            value === option.value ? "bg-raised text-ink shadow-thumb" : "hover:text-ink",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
