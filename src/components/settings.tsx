// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import type { ReactNode } from "react";

/** A titled group of rows on the Settings page. Every section reads the same. */
export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8 first:mt-0">
      <h2 className="mb-2.5 px-1 text-control font-semibold text-ink-2">{title}</h2>
      <div className="divide-y divide-line overflow-hidden rounded-[12px] border border-line bg-surface">{children}</div>
    </section>
  );
}

/** One setting: a label, an optional hint under it, and its control at the end. 52px at least. */
export function SettingsRow({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-[52px] items-center gap-6 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-body text-ink">
            {label}
          </label>
        ) : (
          <div className="text-body text-ink">{label}</div>
        )}
        {hint && <div className="mt-0.5 text-pretty text-caption text-ink-3">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

/** Running text inside a section, such as the lead-in above a group of settings. */
export function SettingsNote({ children }: { children: ReactNode }) {
  return <div className="text-pretty px-4 py-3 text-caption leading-relaxed text-ink-2">{children}</div>;
}
