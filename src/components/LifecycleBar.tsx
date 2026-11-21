// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { tr } from "@/lib/i18n";

import { cn } from "./ui";

/**
 * Today's work split by queue, always in the same order and colours:
 * new, learning, review. The same bar appears wherever a Deck's work is shown.
 */
export function LifecycleBar({
  newCount,
  learnCount,
  reviewCount,
  className,
}: {
  newCount: number;
  learnCount: number;
  reviewCount: number;
  className?: string;
}) {
  const total = Math.max(1, newCount + learnCount + reviewCount);
  const parts = [
    { key: "new", label: tr("actions-new"), value: newCount, color: "var(--count-new)" },
    { key: "learn", label: tr("scheduling-learning"), value: learnCount, color: "var(--count-learn)" },
    { key: "due", label: tr("statistics-due-count"), value: reviewCount, color: "var(--count-due)" },
  ];
  return (
    <div className={className}>
      <div className="flex h-1.5 gap-[3px] overflow-hidden rounded-full" aria-hidden="true">
        {parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <span
              key={p.key}
              className="h-full rounded-full transition-[flex-grow] duration-[var(--dur-slow)] ease-out"
              style={{ flexGrow: p.value / total, background: p.color }}
            />
          ))}
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-caption text-ink-2">
        {parts.map((p) => (
          <li key={p.key} className={cn("inline-flex items-center gap-1.5", p.value === 0 && "text-ink-3")}>
            <span className="size-2 rounded-full" style={{ background: p.value ? p.color : "var(--line-strong)" }} />
            {p.label}
            <span className="tabular font-semibold text-ink">{p.value.toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
