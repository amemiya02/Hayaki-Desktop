// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Server rendering has no layout, so draw the charts at a fixed width.
vi.mock("./Chart", async (importOriginal) => {
  const { createElement } = await import("react");
  const m = await importOriginal<typeof import("./Chart")>();
  return { ...m, BarChart: (p: import("./Chart").BarChartProps) => createElement(m.BarChartBody, { ...p, width: 600, shown: true }) };
});
vi.mock("./Heatmap", async (importOriginal) => {
  const { createElement } = await import("react");
  const m = await importOriginal<typeof import("./Heatmap")>();
  return { ...m, Heatmap: (p: import("./Heatmap").HeatmapProps) => createElement(m.HeatmapBody, { ...p, width: 900, shown: true }) };
});

import { TooltipProvider } from "@/components/ui";
import type { GraphsResponse } from "@/lib/anki/proto/anki/stats_pb";

import {
  AddedSection,
  ButtonsSection,
  CalendarSection,
  CardCountsSection,
  DifficultySection,
  EaseSection,
  FutureDueSection,
  HoursSection,
  IntervalsSection,
  RetrievabilitySection,
  ReviewsSection,
  StabilitySection,
  TodaySection,
  TrueRetentionSection,
  type SectionProps,
} from "./sections";

const rev = (young: number, mature: number) => ({ learn: 1, relearn: 0, young, mature, filtered: 0 });
const tr = { youngPassed: 3, youngFailed: 1, maturePassed: 9, matureFailed: 1 };
const hours = Array.from({ length: 24 }, (_, i) => ({ total: i, correct: Math.floor(i / 2) }));
const buttons = { learning: [1, 2, 3, 0], young: [1, 0, 5, 1], mature: [0, 1, 9, 2] };

const data = {
  fsrs: true,
  rolloverHour: 4,
  today: { answerCount: 10, answerMillis: 90000, correctCount: 8, matureCorrect: 3, matureCount: 4, learnCount: 2, reviewCount: 7, relearnCount: 1, earlyReviewCount: 0 },
  futureDue: { futureDue: { [-2]: 3, 0: 4, 1: 5, 10: 2 }, haveBacklog: true, dailyLoad: 3 },
  reviews: { count: { 0: rev(3, 2), [-1]: rev(1, 1), [-40]: rev(0, 4) }, time: { 0: rev(3000, 2000), [-1]: rev(1000, 1000), [-40]: rev(0, 4000) } },
  cardCounts: {
    includingInactive: { newCards: 5, learn: 1, relearn: 1, young: 3, mature: 1, suspended: 0, buried: 0 },
    excludingInactive: { newCards: 4, learn: 1, relearn: 1, young: 2, mature: 1, suspended: 1, buried: 1 },
  },
  intervals: { intervals: { 1: 3, 5: 2, 30: 1 } },
  stability: { intervals: { 0: 1, 4: 2, 60: 1 } },
  eases: { eases: { 250: 4, 230: 1 }, average: 245 },
  difficulty: { eases: { 30: 2, 55: 3 }, average: 45 },
  retrievability: { retrievability: { 80: 2, 95: 4 }, average: 90, sumByCard: 5.4, sumByNote: 4.2 },
  hours: { oneMonth: hours, threeMonths: hours, oneYear: hours, allTime: hours },
  buttons: { oneMonth: buttons, threeMonths: buttons, oneYear: buttons, allTime: buttons },
  added: { added: { 0: 2, [-3]: 1 } },
  trueRetention: { today: tr, yesterday: tr, week: tr, month: tr, year: tr, allTime: tr },
} as unknown as GraphsResponse;

const props: SectionProps = {
  data,
  range: "month",
  revlogRange: "year",
  prefs: { calendarFirstDayOfWeek: 1, cardCountsSeparateInactive: true, futureDueShowBacklog: true },
  setPref: () => {},
  browse: () => {},
};

const sections = {
  TodaySection,
  FutureDueSection,
  CalendarSection,
  ReviewsSection,
  CardCountsSection,
  IntervalsSection,
  StabilitySection,
  EaseSection,
  DifficultySection,
  RetrievabilitySection,
  TrueRetentionSection,
  HoursSection,
  ButtonsSection,
  AddedSection,
};

describe("sections render", () => {
  for (const [name, Section] of Object.entries(sections)) {
    it(`${name} renders with data`, () => {
      const html = renderToString(<TooltipProvider><Section {...props} /></TooltipProvider>);
      expect(html).toContain("<section");
      expect(html).not.toContain("NaN");
      if (name !== "TodaySection" && name !== "CardCountsSection" && name !== "TrueRetentionSection") {
        expect(html).toContain("<svg");
      }
    });
    it(`${name} renders without data`, () => {
      const html = renderToString(<TooltipProvider><Section {...props} data={{ fsrs: false, rolloverHour: 4 } as unknown as GraphsResponse} /></TooltipProvider>);
      expect(html).toContain("<section");
    });
  }
});
