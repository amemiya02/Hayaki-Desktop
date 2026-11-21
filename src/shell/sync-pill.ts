// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * What the toolbar's sync pill shows for the sync store's state, and which
 * toast reports a finished sync. Progress lives in the pill only; a toast is
 * for a result.
 */
import { t, tr } from "@/lib/i18n";
import type { SyncResult } from "@/lib/sync";

export interface SyncPill {
  /** The popover's heading. */
  title: string;
  /** The pill's label: a spinner and this, never more than a few characters of count. */
  short: string;
  /** Tooltip and accessible name. */
  full: string;
  /** The core's progress lines, already translated. */
  parts: string[];
  /** Media sync can be abandoned; the collection sync cannot. */
  abortable: boolean;
}

/** Up and down counts of Anki's "Added: 1,100↑ 0↓", without the zeros. */
function mediaCounts(parts: string[]): string {
  const counts = parts[0]?.match(/[\d.,  ]*\d[\d.,  ]*\s*[↑↓]/gu) ?? [];
  return counts
    .map((count) => count.replace(/\s+/g, ""))
    .filter((count) => /[1-9]/.test(count))
    .join(" ");
}

export function syncPill(phase: "idle" | "syncing" | "media", progress: string[]): SyncPill | null {
  if (phase === "idle") return null;
  if (phase === "media") {
    const media = t("sync.mediaShort");
    return {
      title: t("sync.media"),
      short: [media, mediaCounts(progress)].filter(Boolean).join(" "),
      full: progress.length ? `${t("sync.media")} · ${progress.join(" · ")}` : tr("sync-media-starting"),
      parts: progress,
      abortable: true,
    };
  }
  const syncing = tr("sync-syncing");
  return {
    title: syncing,
    short: syncing,
    full: progress.length ? `${syncing} ${progress.join(" · ")}` : syncing,
    parts: progress,
    abortable: false,
  };
}

export interface SyncToast {
  level: "success" | "warning" | "error";
  title: string;
  description?: string;
}

/** The result toast of a finished sync, or none when it was cancelled. */
export function syncToast(result: SyncResult, lastError: string | null): SyncToast | null {
  switch (result) {
    case "done":
      return { level: "success", title: tr("sync-collection-complete"), description: tr("sync-media-complete") };
    case "media-disabled":
      return { level: "success", title: tr("sync-collection-complete") };
    case "media-aborted":
      return { level: "success", title: tr("sync-collection-complete"), description: tr("sync-media-aborted") };
    case "media-failed":
      return { level: "warning", title: tr("sync-media-failed"), description: lastError ?? undefined };
    case "cancelled":
      return null;
    case "error":
      return { level: "error", title: t("sync.failed"), description: lastError ?? undefined };
  }
}
