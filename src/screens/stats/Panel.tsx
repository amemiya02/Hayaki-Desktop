// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import type { ReactNode } from "react";

import { cn } from "@/components/ui";

/** One titled section of the Statistics screen. */
export function Panel({
  title,
  description,
  controls,
  children,
  wide,
  className,
}: {
  title: string;
  description?: string;
  controls?: ReactNode;
  children: ReactNode;
  wide?: boolean;
  className?: string;
}) {
  return (
    <section
      aria-label={title}
      className={cn(
        "flex min-w-0 flex-col rounded-[12px] border border-line bg-surface p-5",
        wide && "@min-[1000px]:col-span-2",
        className,
      )}
    >
      <header className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2.5">
        <div className="min-w-0">
          <h2 className="text-title font-semibold leading-tight text-ink">{title}</h2>
          {description && <p className="mt-1 text-caption leading-snug text-ink-3">{description}</p>}
        </div>
        {controls && <div className="flex flex-wrap items-center gap-2">{controls}</div>}
      </header>
      {children}
    </section>
  );
}

export function PanelSkeleton({ wide, height = 200 }: { wide?: boolean; height?: number }) {
  return (
    <div
      aria-hidden="true"
      className={cn("rounded-[12px] border border-line bg-surface p-5", wide && "@min-[1000px]:col-span-2")}
    >
      <div className="h-4 w-32 animate-pulse rounded-[5px] bg-surface-3" />
      <div className="mt-2 h-3 w-56 animate-pulse rounded-[5px] bg-surface-2" />
      <div className="mt-5 animate-pulse rounded-[8px] bg-surface-2" style={{ height }} />
    </div>
  );
}

/** The figures under a graph: label above value. */
export function Figures({ items }: { items: { label: string; value: string }[] }) {
  if (!items.length) return null;
  return (
    <dl className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-6 gap-y-3 border-t border-line pt-4">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-caption text-ink-3">{item.label}</dt>
          <dd className="selectable mt-0.5 text-body font-medium tabular text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A labelled checkbox for a graph option. */
export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="inline-flex h-7 items-center gap-1.5 rounded-[7px] px-1.5 text-control text-ink-2 hover:text-ink">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-3.5 accent-accent"
      />
      {label}
    </label>
  );
}
