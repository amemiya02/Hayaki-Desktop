// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { Hammer } from "lucide-react";

import { t } from "@/lib/i18n";

/** A destination that exists in Anki but has not been rebuilt yet. */
export function Later({ title }: { title: string }) {
  return (
    <div className="grid h-full place-items-center px-8">
      <div className="flex max-w-[380px] flex-col items-center text-center">
        <span className="mb-4 grid size-12 place-items-center rounded-full bg-surface-3 text-ink-2">
          <Hammer className="size-5" />
        </span>
        <h2 className="text-heading font-semibold text-ink">{title}</h2>
        <p className="mt-2 text-body leading-relaxed text-ink-2">{t("nav.later")}</p>
      </div>
    </div>
  );
}
