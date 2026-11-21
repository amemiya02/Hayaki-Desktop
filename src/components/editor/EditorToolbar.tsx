// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The formatting toolbar above the fields, with Anki's shortcuts. Buttons never
 * take focus, so the selection in the field stays where it was.
 */
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  Brackets,
  ChevronDown,
  Highlighter,
  IndentDecrease,
  IndentIncrease,
  Italic,
  List,
  ListOrdered,
  Paperclip,
  RemoveFormatting,
  Sigma,
  SquareDashed,
  Subscript,
  Superscript,
  Underline,
} from "lucide-react";
import { Popover } from "radix-ui";
import { useRef, type ReactNode } from "react";

import { cn, Tooltip } from "@/components/ui";
import { displayChord, withChord } from "@/lib/chord";
import { tr } from "@/lib/i18n";
import { te } from "@/lib/strings/editor";

import { RecordButton } from "./AudioRecorder";
import type { MathKind } from "./markup";

/** Colours offered for text and highlight. They are written into Card Content, so they are literal values. */
export const TEXT_COLOURS = ["#000000", "#c92a2a", "#e8590c", "#2b8a3e", "#0b7285", "#1864ab", "#5f3dc4", "#a61e4d", "#868e96"];
export const HIGHLIGHT_COLOURS = ["#ffec99", "#ffd8a8", "#ffc9c9", "#b2f2bb", "#99e9f2", "#a5d8ff", "#d0bfff", "#fcc2d7", "#e9ecef"];

export type ColourKind = "text" | "highlight";

export interface ToolbarProps {
  active: ReadonlySet<string>;
  /** False when the focused input is HTML source, where formatting commands do not apply. */
  richTarget: boolean;
  onCommand: (command: string, value?: string) => void;
  onCloze: (increment: boolean) => void;
  onMath: (kind: MathKind) => void;
  onAttach: () => void;
  colours: Record<ColourKind, string>;
  onColour: (kind: ColourKind, colour: string) => void;
  colourOpen: ColourKind | null;
  onColourOpen: (kind: ColourKind | null) => void;
  clozeEnabled: boolean;
}

function ToolButton({
  label,
  shortcut,
  pressed,
  disabled,
  onClick,
  children,
  className,
}: {
  label: string;
  shortcut?: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Tooltip content={withChord(label, shortcut)}>
      <button
        type="button"
        tabIndex={-1}
        aria-label={label}
        aria-pressed={pressed}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        className={cn(
          "grid h-7 min-w-7 place-items-center rounded-[7px] px-1 text-ink-2 transition-colors duration-[var(--dur-fast)]",
          "hover:bg-sidebar-hover hover:text-ink disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4",
          pressed && "bg-accent-soft text-accent-ink hover:bg-accent-soft hover:text-accent-ink",
          className,
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

function Divider() {
  return <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-line" />;
}

const popoverSurface =
  "z-50 rounded-[10px] border border-line bg-raised p-1.5 shadow-pop data-[state=open]:animate-[pop-in_120ms_var(--ease-out)]";

/** A popover that leaves focus, and so the selection, in the field. */
function ToolPopover({
  open,
  onOpenChange,
  trigger,
  children,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger: ReactNode;
  children: ReactNode;
}) {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Anchor asChild>{trigger}</Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          className={popoverSurface}
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function MenuRow({ label, shortcut, onClick, icon }: { label: string; shortcut?: string; onClick: () => void; icon: ReactNode }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="flex h-8 w-full items-center gap-2.5 rounded-[6px] px-2.5 text-start text-[13px] text-ink hover:bg-accent-soft [&_svg]:size-4 [&_svg]:text-ink-2"
    >
      {icon}
      <span className="flex-1">{label}</span>
      {shortcut && <span className="tabular ps-6 text-[12px] text-ink-3">{displayChord(shortcut)}</span>}
    </button>
  );
}

function ColourControl({
  kind,
  colour,
  open,
  onOpen,
  onColour,
  disabled,
}: {
  kind: ColourKind;
  colour: string;
  open: boolean;
  onOpen: (open: boolean) => void;
  onColour: (colour: string) => void;
  disabled: boolean;
}) {
  const custom = useRef<HTMLInputElement>(null);
  const label = kind === "text" ? tr("editing-text-color") : tr("editing-text-highlight-color");
  const swatches = kind === "text" ? TEXT_COLOURS : HIGHLIGHT_COLOURS;
  return (
    <ToolPopover
      open={open}
      onOpenChange={onOpen}
      trigger={
        <div className="flex items-center">
          <ToolButton
            label={label}
            shortcut={kind === "text" ? "F7" : undefined}
            disabled={disabled}
            onClick={() => onColour(colour)}
            className="rounded-e-none pe-0.5"
          >
            <span className="relative grid place-items-center">
              {kind === "text" ? <Baseline /> : <Highlighter />}
              <span aria-hidden className="absolute -bottom-1 h-[3px] w-4 rounded-full" style={{ background: colour }} />
            </span>
          </ToolButton>
          <ToolButton
            label={tr("editing-change-color")}
            shortcut={kind === "text" ? "F8" : undefined}
            disabled={disabled}
            pressed={open}
            onClick={() => onOpen(!open)}
            className="min-w-4 rounded-s-none px-0 [&_svg]:size-3"
          >
            <ChevronDown />
          </ToolButton>
        </div>
      }
    >
      <div role="group" aria-label={label} className="grid grid-cols-5 gap-1.5 p-1">
        {swatches.map((swatch) => (
          <button
            key={swatch}
            type="button"
            tabIndex={-1}
            aria-label={swatch}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onColour(swatch);
              onOpen(false);
            }}
            className={cn(
              "size-6 rounded-full border border-line-strong transition-transform duration-[var(--dur-fast)] hover:scale-110",
              swatch === colour && "ring-2 ring-accent ring-offset-2 ring-offset-raised",
            )}
            style={{ background: swatch }}
          />
        ))}
        <label
          className="relative grid size-6 cursor-default place-items-center overflow-hidden rounded-full border border-dashed border-line-strong text-ink-3 hover:text-ink"
          title={te("colourCustom")}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => custom.current?.click()}
        >
          <span aria-hidden className="text-[14px] leading-none">+</span>
          <input
            ref={custom}
            type="color"
            tabIndex={-1}
            aria-label={te("colourCustom")}
            defaultValue={colour}
            className="absolute inset-0 opacity-0"
            onChange={(e) => onColour(e.target.value)}
          />
        </label>
      </div>
    </ToolPopover>
  );
}

export function EditorToolbar({
  active,
  richTarget,
  onCommand,
  onCloze,
  onMath,
  onAttach,
  colours,
  onColour,
  colourOpen,
  onColourOpen,
  clozeEnabled,
}: ToolbarProps) {
  const off = !richTarget;
  return (
    <div role="toolbar" aria-label={te("format")} className="flex flex-wrap items-center gap-y-1">
      <ToolButton label={tr("editing-bold-text")} shortcut="Ctrl+B" pressed={active.has("bold")} disabled={off} onClick={() => onCommand("bold")}>
        <Bold />
      </ToolButton>
      <ToolButton label={tr("editing-italic-text")} shortcut="Ctrl+I" pressed={active.has("italic")} disabled={off} onClick={() => onCommand("italic")}>
        <Italic />
      </ToolButton>
      <ToolButton label={tr("editing-underline-text")} shortcut="Ctrl+U" pressed={active.has("underline")} disabled={off} onClick={() => onCommand("underline")}>
        <Underline />
      </ToolButton>
      <ToolButton label={tr("editing-superscript")} shortcut="Ctrl+Shift+=" pressed={active.has("superscript")} disabled={off} onClick={() => onCommand("superscript")}>
        <Superscript />
      </ToolButton>
      <ToolButton label={tr("editing-subscript")} shortcut="Ctrl+=" pressed={active.has("subscript")} disabled={off} onClick={() => onCommand("subscript")}>
        <Subscript />
      </ToolButton>
      <Divider />
      <ColourControl
        kind="text"
        colour={colours.text}
        open={colourOpen === "text"}
        onOpen={(open) => onColourOpen(open ? "text" : null)}
        onColour={(c) => onColour("text", c)}
        disabled={off}
      />
      <ColourControl
        kind="highlight"
        colour={colours.highlight}
        open={colourOpen === "highlight"}
        onOpen={(open) => onColourOpen(open ? "highlight" : null)}
        onColour={(c) => onColour("highlight", c)}
        disabled={off}
      />
      <ToolButton label={tr("editing-remove-formatting")} shortcut="Ctrl+R" disabled={off} onClick={() => onCommand("removeFormat")}>
        <RemoveFormatting />
      </ToolButton>
      <Divider />
      <ToolButton label={tr("editing-unordered-list")} shortcut="Ctrl+," pressed={active.has("insertUnorderedList")} disabled={off} onClick={() => onCommand("insertUnorderedList")}>
        <List />
      </ToolButton>
      <ToolButton label={tr("editing-ordered-list")} shortcut="Ctrl+." pressed={active.has("insertOrderedList")} disabled={off} onClick={() => onCommand("insertOrderedList")}>
        <ListOrdered />
      </ToolButton>
      <AlignmentControl disabled={off} active={active} onCommand={onCommand} />
      <Divider />
      <ToolButton
        label={tr("editing-cloze-deletion")}
        shortcut="Ctrl+Shift+C"
        disabled={!clozeEnabled}
        onClick={() => onCloze(true)}
      >
        <Brackets />
      </ToolButton>
      <ToolButton
        label={tr("editing-cloze-deletion-repeat")}
        shortcut="Ctrl+Alt+Shift+C"
        disabled={!clozeEnabled}
        onClick={() => onCloze(false)}
      >
        <SquareDashed />
      </ToolButton>
      <ToolPopover
        trigger={
          <span className="inline-flex">
            <Popover.Trigger asChild>
              <button
                type="button"
                tabIndex={-1}
                aria-label={tr("editing-equations")}
                title={tr("editing-equations")}
                onMouseDown={(e) => e.preventDefault()}
                className="grid h-7 min-w-7 place-items-center rounded-[7px] px-1 text-ink-2 hover:bg-sidebar-hover hover:text-ink data-[state=open]:bg-accent-soft data-[state=open]:text-accent-ink [&_svg]:size-4"
              >
                <Sigma />
              </button>
            </Popover.Trigger>
          </span>
        }
      >
        <div className="min-w-[230px]">
          <Popover.Close asChild>
            <div>
              <MenuRow label={tr("editing-mathjax-inline")} shortcut="Ctrl+M, M" onClick={() => onMath("inline")} icon={<Sigma />} />
              <MenuRow label={tr("editing-mathjax-block")} shortcut="Ctrl+M, E" onClick={() => onMath("block")} icon={<Sigma />} />
              <MenuRow label={tr("editing-mathjax-chemistry")} shortcut="Ctrl+M, C" onClick={() => onMath("chemistry")} icon={<Sigma />} />
              <div role="separator" className="my-1 h-px bg-line" />
              <MenuRow label={tr("editing-latex")} shortcut="Ctrl+T, T" onClick={() => onMath("latex")} icon={<Sigma />} />
              <MenuRow label={tr("editing-latex-equation")} shortcut="Ctrl+T, E" onClick={() => onMath("latexEquation")} icon={<Sigma />} />
              <MenuRow label={tr("editing-latex-math-env")} shortcut="Ctrl+T, M" onClick={() => onMath("latexMathEnv")} icon={<Sigma />} />
            </div>
          </Popover.Close>
        </div>
      </ToolPopover>
      <ToolButton label={tr("editing-attach-picturesaudiovideo")} shortcut="F3" onClick={onAttach}>
        <Paperclip />
      </ToolButton>
      <RecordButton />
    </div>
  );
}

function AlignmentControl({
  disabled,
  active,
  onCommand,
}: {
  disabled: boolean;
  active: ReadonlySet<string>;
  onCommand: (command: string) => void;
}) {
  const current = active.has("justifyCenter")
    ? AlignCenter
    : active.has("justifyRight")
      ? AlignRight
      : active.has("justifyFull")
        ? AlignJustify
        : AlignLeft;
  const Icon = current;
  return (
    <ToolPopover
      trigger={
        <span className="inline-flex">
          <Popover.Trigger asChild disabled={disabled}>
            <button
              type="button"
              tabIndex={-1}
              aria-label={tr("editing-alignment")}
              title={tr("editing-alignment")}
              onMouseDown={(e) => e.preventDefault()}
              className="flex h-7 items-center gap-0.5 rounded-[7px] px-1 text-ink-2 hover:bg-sidebar-hover hover:text-ink disabled:pointer-events-none disabled:opacity-40 data-[state=open]:bg-accent-soft data-[state=open]:text-accent-ink [&_svg]:size-4"
            >
              <Icon />
              <ChevronDown className="!size-3" />
            </button>
          </Popover.Trigger>
        </span>
      }
    >
      <Popover.Close asChild>
        <div className="min-w-[210px]">
          <MenuRow label={tr("editing-align-left")} onClick={() => onCommand("justifyLeft")} icon={<AlignLeft />} />
          <MenuRow label={tr("editing-center")} onClick={() => onCommand("justifyCenter")} icon={<AlignCenter />} />
          <MenuRow label={tr("editing-align-right")} onClick={() => onCommand("justifyRight")} icon={<AlignRight />} />
          <MenuRow label={tr("editing-justify")} onClick={() => onCommand("justifyFull")} icon={<AlignJustify />} />
          <div className="my-1 h-px bg-line" />
          <MenuRow label={tr("editing-outdent")} shortcut="Ctrl+Shift+," onClick={() => onCommand("outdent")} icon={<IndentDecrease />} />
          <MenuRow label={tr("editing-indent")} shortcut="Ctrl+Shift+." onClick={() => onCommand("indent")} icon={<IndentIncrease />} />
        </div>
      </Popover.Close>
    </ToolPopover>
  );
}
