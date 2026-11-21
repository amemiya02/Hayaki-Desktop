// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { cn } from "./ui";

const tint = {
  new: "text-new bg-[color-mix(in_oklab,var(--count-new)_var(--tint-pill),transparent)]",
  learn: "text-learn bg-[color-mix(in_oklab,var(--count-learn)_var(--tint-pill),transparent)]",
  due: "text-due bg-[color-mix(in_oklab,var(--count-due)_var(--tint-pill),transparent)]",
} as const;

/**
 * A new, learning or due count. A count above zero wears its Anki colour on a
 * tinted pill; a zero is muted with no pill, so work to do stands out.
 */
export function Count({ value, kind, className }: { value: number; kind: keyof typeof tint; className?: string }) {
  return (
    <span className={cn("flex justify-center", className)}>
      <span
        className={cn(
          "tabular inline-flex h-[22px] min-w-[30px] items-center justify-center rounded-full px-2 text-control",
          value > 0 ? cn("font-semibold", tint[kind]) : "font-normal text-ink-3",
        )}
      >
        {value.toLocaleString()}
      </span>
    </span>
  );
}
