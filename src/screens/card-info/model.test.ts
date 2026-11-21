// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { create } from "@bufbuild/protobuf";
import { expect, test } from "vitest";

import {
  CardStatsResponse_StatsRevlogEntrySchema,
  CardStatsResponseSchema,
  RevlogEntry_ReviewKind as ReviewKind,
} from "@/lib/anki/proto/anki/stats_pb";

import { countsAsReview, decayFromParams, formatEaseOrDifficulty, revlogRows, rowsFromStats } from "./model";

const keys = (stats: Parameters<typeof rowsFromStats>[0]) => rowsFromStats(stats).map((r) => r.key);

test("SM-2 Cards show ease and no FSRS rows", () => {
  const stats = create(CardStatsResponseSchema, { added: 1_700_000_000n, ease: 2500, reviews: 3, cardType: "Card 1", deck: "A", notetype: "Basic" });
  const rows = rowsFromStats(stats);
  expect(rows.find((r) => r.key === "card-stats-ease")?.value).toBe("250%");
  expect(keys(stats)).not.toContain("card-stats-fsrs-stability");
  expect(keys(stats)).not.toContain("card-stats-first-review");
});

test("FSRS Cards show stability, difficulty and retrievability instead of ease", () => {
  const stats = create(CardStatsResponseSchema, {
    added: 1n,
    ease: 2500,
    memoryState: { stability: 10, difficulty: 5.5 },
    fsrsRetrievability: 0.876,
    desiredRetention: 0.9,
  });
  const rows = rowsFromStats(stats);
  expect(rows.find((r) => r.key === "card-stats-fsrs-difficulty")?.value).toBe("50%");
  expect(rows.find((r) => r.key === "card-stats-fsrs-retrievability")?.value).toBe("88%");
  expect(keys(stats)).not.toContain("card-stats-ease");
});

test("FSRS on without a memory state hides ease, as upstream", () => {
  const stats = create(CardStatsResponseSchema, { added: 1n, ease: 2500, desiredRetention: 0.9 });
  expect(keys(stats)).not.toContain("card-stats-ease");
});

test("the original Deck follows a filtered Deck, and custom data is listed", () => {
  const stats = create(CardStatsResponseSchema, { added: 1n, deck: "Filtered", originalDeck: "Home", customData: '{"a":1,"b":"x"}' });
  const rows = rowsFromStats(stats);
  expect(rows.find((r) => r.key === "card-stats-deck-name")?.value).toBe("Filtered (Home)");
  expect(rows.find((r) => r.key === "card-stats-custom-data")?.value).toBe("a=1 b=x");
});

test("ease and difficulty format as upstream", () => {
  expect(formatEaseOrDifficulty(0)).toBe("");
  expect(formatEaseOrDifficulty(2500)).toBe("250%");
  expect(formatEaseOrDifficulty(600)).toBe("D:50%");
});

test("decay follows the parameter count", () => {
  expect(decayFromParams([])).toBe(0.1542);
  expect(decayFromParams(new Array(19).fill(1))).toBe(0.5);
  const params = new Array(21).fill(1);
  params[20] = 0.3;
  expect(decayFromParams(params)).toBe(0.3);
});

test("elapsed time skips manual and rescheduled entries", () => {
  const entry = (time: number, reviewKind: ReviewKind, ease = 2500) =>
    create(CardStatsResponse_StatsRevlogEntrySchema, { time: BigInt(time), reviewKind, ease, buttonChosen: 3 });
  const revlog = [entry(3000, ReviewKind.REVIEW), entry(2000, ReviewKind.MANUAL, 0), entry(1000, ReviewKind.LEARNING)];
  expect(countsAsReview(revlog[1])).toBe(false);
  const rows = revlogRows(revlog);
  expect(rows[1].elapsed).toBe("");
  expect(rows[2].elapsed).toBe("0");
  expect(rows[0].elapsed).not.toBe("");
  expect(rows[0].kindTone).toBe("due");
  expect(rows[2].kindTone).toBe("new");
});
