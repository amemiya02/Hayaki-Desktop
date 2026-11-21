// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The small editor that opens on a MathJax chip, like Anki's MathjaxOverlay:
 * the expression's source, a typeset preview, and an inline / block switch.
 * Edits go straight to the chip, so the field already holds them when the
 * popover closes.
 */
import { Trash2 } from "lucide-react";
import { Popover } from "radix-ui";
import { useMemo, useState } from "react";

import { CardFrame, type CardFrameContent } from "@/components/CardFrame";
import { Button, fieldClass, IconButton, Segmented } from "@/components/ui";
import { direction, firstLanguage, tr } from "@/lib/i18n";
import { cardFrameVars, usePrefs } from "@/lib/prefs";
import { te } from "@/lib/strings/editor";
import { useResolvedAppearance } from "@/lib/useAppearance";

import { mathSource, mathStored } from "./mathjax";

type Mode = "inline" | "block";

export interface MathjaxPopoverProps {
  chip: HTMLElement;
  /** Called after the chip changes, so the field saves it. */
  onChange: () => void;
  onRemove: () => void;
  onClose: () => void;
}

export function MathjaxPopover({ chip, onChange, onRemove, onClose }: MathjaxPopoverProps) {
  const [source, setSource] = useState(() => mathSource(chip.dataset.mathjax ?? ""));
  const [mode, setMode] = useState<Mode>(chip.dataset.block === "true" ? "block" : "inline");
  const theme = usePrefs((s) => s.theme);
  const resolved = useResolvedAppearance();
  const night = resolved !== "light";

  const update = (nextSource: string, nextMode: Mode) => {
    setSource(nextSource);
    setMode(nextMode);
    chip.dataset.mathjax = mathStored(nextSource);
    chip.dataset.block = String(nextMode === "block");
    chip.textContent = nextSource;
    onChange();
  };

  const content = useMemo<CardFrameContent | null>(() => {
    if (!source.trim()) return null;
    return {
      html: mode === "block" ? `\\[${mathStored(source)}\\]` : `\\(${mathStored(source)}\\)`,
      css: "body { margin: 12px; font-size: 22px; text-align: center; }",
      bodyClass: ["card", night ? "nightMode night_mode" : ""].filter(Boolean).join(" "),
      side: "question",
      frame: { dark: night, vars: cardFrameVars(theme, resolved), dir: direction(), lang: firstLanguage() },
    };
  }, [source, mode, night, theme, resolved]);

  return (
    <Popover.Root open onOpenChange={(open) => !open && onClose()}>
      <Popover.Anchor virtualRef={{ current: chip }} />
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={8}
          collisionPadding={12}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            const input = (e.currentTarget as HTMLElement).querySelector("textarea");
            input?.focus();
            if (input) {
              // A new chemistry formula puts the caret inside \ce{ }.
              const caret = /^\\ce\{.*\}$/s.test(input.value) ? input.value.length - 1 : input.value.length;
              input.setSelectionRange(caret, caret);
            }
          }}
          onCloseAutoFocus={(e) => e.preventDefault()}
          aria-label={te("mathSource")}
          className="z-50 w-[340px] rounded-[10px] border border-line bg-raised p-3 shadow-pop data-[state=open]:animate-pop-in"
        >
          <textarea
            value={source}
            aria-label={te("mathSource")}
            placeholder={tr("editing-mathjax-placeholder", { accept: "Enter", newline: "Shift+Enter" })}
            spellCheck={false}
            rows={3}
            dir="ltr"
            onChange={(e) => update(e.target.value, mode)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                onClose();
              }
            }}
            className={`${fieldClass} h-auto min-h-[72px] resize-y py-2 font-mono text-control`}
          />
          <div
            aria-label={tr("editing-mathjax-preview")}
            className="mt-2.5 grid h-[92px] place-items-center overflow-hidden rounded-[8px] border border-line bg-surface"
          >
            {content ? (
              <CardFrame content={content} title={tr("editing-mathjax-preview")} className="size-full border-0 bg-transparent" />
            ) : (
              <p className="px-4 text-center text-caption text-ink-3">{te("mathEmpty")}</p>
            )}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Segmented<Mode>
              label={te("mathSource")}
              size="sm"
              value={mode}
              onChange={(next) => update(source, next)}
              options={[
                { value: "inline", label: tr("editing-mathjax-inline") },
                { value: "block", label: tr("editing-mathjax-block") },
              ]}
            />
            <span className="flex-1" />
            <IconButton label={te("mathRemove")} onClick={onRemove}>
              <Trash2 />
            </IconButton>
            <Button variant="primary" onClick={onClose}>
              {te("mathDone")}
            </Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
