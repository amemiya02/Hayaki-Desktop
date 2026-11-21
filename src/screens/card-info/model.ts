// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Card Info's rows and review log, ported from Anki's Svelte page
 * (ts/routes/card-info/lib.ts and Revlog.svelte).
 */
import { tr } from "@/lib/i18n";
import {
  RevlogEntry_ReviewKind as ReviewKind,
  type CardStatsResponse,
  type CardStatsResponse_StatsRevlogEntry as RevlogEntry,
} from "@/lib/anki/proto/anki/stats_pb";
import { DAY, timeSpan } from "@/screens/stats/format";

/** YYYY-MM-DD in local time, as upstream's `Timestamp.dateString`. */
export function dateString(seconds: number | bigint): string {
  const date = new Date(Number(seconds) * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** HH:MM in local time, as upstream's `Timestamp.timeString`. */
export function timeString(seconds: number | bigint): string {
  const date = new Date(Number(seconds) * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export interface StatsRow {
  key: string;
  label: string;
  value: string;
  /** Values such as IDs that are worth selecting and copying. */
  copyable?: boolean;
}

const DAYS_UNIT = 3;

export function rowsFromStats(stats: CardStatsResponse): StatsRow[] {
  const rows: StatsRow[] = [];
  const push = (key: string, value: string | number | bigint, copyable?: boolean) =>
    rows.push({ key, label: tr(key), value: String(value), copyable });

  push("card-stats-added", dateString(stats.added));
  if (stats.firstReview != null) push("card-stats-first-review", dateString(stats.firstReview));
  if (stats.latestReview != null) push("card-stats-latest-review", dateString(stats.latestReview));
  if (stats.dueDate != null) push("statistics-due-date", dateString(stats.dueDate));
  if (stats.duePosition != null) push("card-stats-new-card-position", stats.duePosition);
  if (stats.interval) push("card-stats-interval", timeSpan(stats.interval * DAY));

  if (stats.memoryState) {
    let stability = timeSpan(stats.memoryState.stability * 86400, false, false);
    if (stats.memoryState.stability > 31) {
      stability += ` (${timeSpan(stats.memoryState.stability * 86400, false, false, DAYS_UNIT)})`;
    }
    push("card-stats-fsrs-stability", stability);
    const difficulty = (((stats.memoryState.difficulty - 1.0) / 9.0) * 100.0).toFixed(0);
    push("card-stats-fsrs-difficulty", `${difficulty}%`);
    if (stats.fsrsRetrievability) {
      push("card-stats-fsrs-retrievability", `${(stats.fsrsRetrievability * 100).toFixed(0)}%`);
    }
  } else if (stats.ease && stats.desiredRetention === undefined) {
    // Ease is hidden when FSRS is on but the Card has no memory state yet.
    push("card-stats-ease", `${stats.ease / 10}%`);
  }

  push("card-stats-review-count", stats.reviews);
  push("card-stats-lapse-count", stats.lapses);
  if (stats.totalSecs) {
    push("card-stats-average-time", timeSpan(stats.averageSecs));
    push("card-stats-total-time", timeSpan(stats.totalSecs));
  }

  push("card-stats-card-template", stats.cardType);
  push("card-stats-note-type", stats.notetype);
  push("card-stats-deck-name", stats.originalDeck ? `${stats.deck} (${stats.originalDeck})` : stats.deck);
  push("card-stats-preset", stats.preset);
  push("card-stats-card-id", stats.cardId, true);
  push("card-stats-note-id", stats.noteId, true);

  if (stats.customData) {
    let value: string;
    try {
      const parsed = JSON.parse(stats.customData) as Record<string, unknown>;
      value = Object.entries(parsed)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(" ");
    } catch {
      value = stats.customData;
    }
    push("card-stats-custom-data", value);
  }
  return rows;
}

/** FSRS decay from the preset's parameters, as upstream picks it. */
export function decayFromParams(params: number[] | undefined): number {
  const length = params?.length ?? 0;
  if (length === 0) return 0.1542;
  if (length < 21) return 0.5;
  return params?.[20] ?? 0.1542;
}

/** Reviews that count for elapsed time and the forgetting curve. */
export function countsAsReview(entry: RevlogEntry): boolean {
  return (
    entry.reviewKind !== ReviewKind.MANUAL &&
    entry.reviewKind !== ReviewKind.RESCHEDULED &&
    (entry.reviewKind !== ReviewKind.FILTERED || entry.ease !== 0)
  );
}

export type KindTone = "new" | "due" | "learn" | "plain";

export interface RevlogRow {
  key: string;
  date: string;
  time: string;
  kind: string;
  kindTone: KindTone;
  rating: number;
  interval: string;
  ease: string;
  taken: string;
  elapsed: string;
}

export function reviewKindLabel(kind: ReviewKind): string {
  switch (kind) {
    case ReviewKind.LEARNING:
      return tr("card-stats-review-log-type-learn");
    case ReviewKind.REVIEW:
      return tr("card-stats-review-log-type-review");
    case ReviewKind.RELEARNING:
      return tr("card-stats-review-log-type-relearn");
    case ReviewKind.FILTERED:
      return tr("card-stats-review-log-type-filtered");
    case ReviewKind.MANUAL:
      return tr("card-stats-review-log-type-manual");
    case ReviewKind.RESCHEDULED:
      return tr("card-stats-review-log-type-rescheduled");
  }
  return "";
}

function kindTone(kind: ReviewKind): KindTone {
  switch (kind) {
    case ReviewKind.LEARNING:
      return "new";
    case ReviewKind.REVIEW:
      return "due";
    case ReviewKind.RELEARNING:
      return "learn";
    default:
      return "plain";
  }
}

/** Per-mill ease as "250%", or FSRS difficulty (stored shifted by 100) as "D:52%". */
export function formatEaseOrDifficulty(ease: number): string {
  if (ease === 0) return "";
  const percent = ease / 10.0;
  if (percent <= 110) return `D:${(percent - 10).toFixed(0)}%`;
  return `${percent.toFixed(0)}%`;
}

/** The review log rows, newest first, as the core returns them. */
export function revlogRows(revlog: RevlogEntry[]): RevlogRow[] {
  return revlog.map((entry, index) => {
    let previous: RevlogEntry | undefined;
    for (let i = index + 1; i < revlog.length; i++) {
      if (countsAsReview(revlog[i])) {
        previous = revlog[i];
        break;
      }
    }
    let elapsed = "";
    if (countsAsReview(entry)) {
      elapsed = previous ? timeSpan(Number(entry.time) - Number(previous.time)) : "0";
    }
    return {
      key: `${entry.time}-${index}`,
      date: dateString(entry.time),
      time: timeString(entry.time),
      kind: reviewKindLabel(entry.reviewKind),
      kindTone: kindTone(entry.reviewKind),
      rating: entry.buttonChosen,
      interval: timeSpan(entry.interval),
      ease: formatEaseOrDifficulty(entry.ease),
      taken: timeSpan(entry.takenSecs, true),
      elapsed,
    };
  });
}
