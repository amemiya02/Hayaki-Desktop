// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { useQuery } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { useMemo } from "react";

import { cn } from "@/components/ui";
import * as core from "@/lib/anki/generated/core";

import { isSafeLink, sanitizeDescription } from "./sanitize";

const prose = [
  "selectable max-w-[62ch] text-body leading-relaxed text-ink-2 break-words",
  "[&_p]:mt-3 [&_p:first-child]:mt-0 [&_h1]:mt-4 [&_h2]:mt-4 [&_h3]:mt-4 [&_h1]:text-title [&_h2]:text-title [&_h3]:font-semibold",
  "[&_h1]:font-semibold [&_h2]:font-semibold [&_h1]:text-ink [&_h2]:text-ink [&_h3]:text-ink",
  "[&_ul]:mt-3 [&_ul]:list-disc [&_ul]:ps-5 [&_ol]:mt-3 [&_ol]:list-decimal [&_ol]:ps-5 [&_li]:mt-1",
  "[&_a[href]]:text-accent-ink [&_a[href]]:underline [&_a[href]]:underline-offset-2",
  "[&_blockquote]:mt-3 [&_blockquote]:border-s-2 [&_blockquote]:border-line [&_blockquote]:ps-3",
  "[&_code]:rounded-[4px] [&_code]:bg-surface-3 [&_code]:px-1 [&_code]:text-[0.92em]",
  "[&_pre]:mt-3 [&_pre]:overflow-x-auto [&_pre]:rounded-[8px] [&_pre]:bg-surface-3 [&_pre]:p-3",
  "[&_img]:mt-3 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-[8px]",
  "[&_table]:mt-3 [&_td]:border [&_td]:border-line [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-line [&_th]:px-2 [&_th]:py-1",
  "[&_hr]:my-4 [&_hr]:border-line",
].join(" ");

/** A Deck's description as the overview shows it: sanitized HTML, or Markdown rendered by the core. */
export function DeckDescription({ text, markdown, className }: { text: string; markdown: boolean; className?: string }) {
  const { data: rendered } = useQuery({
    queryKey: ["deck-markdown", text],
    queryFn: async () => (await core.renderMarkdown({ markdown: text, sanitize: true })).val,
    enabled: markdown && text.trim() !== "",
  });
  const html = useMemo(() => sanitizeDescription(markdown ? (rendered ?? "") : text), [markdown, rendered, text]);
  if (!html.trim()) return null;
  return (
    <div
      className={cn(prose, className)}
      // The HTML went through `sanitizeDescription`.
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const link = (e.target as HTMLElement).closest("a");
        if (!link) return;
        e.preventDefault();
        const href = link.getAttribute("href") ?? "";
        if (isSafeLink(href)) openUrl(href).catch((error: unknown) => toast.error(String(error)));
      }}
    />
  );
}
