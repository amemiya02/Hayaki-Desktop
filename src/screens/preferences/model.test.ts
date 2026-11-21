// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { PreferencesSchema } from "@/lib/anki/proto/anki/config_pb";

import { minsToSecs, secsToMins, withPreference } from "./model";

describe("withPreference", () => {
  it("changes one field and leaves the original untouched", () => {
    const prefs = create(PreferencesSchema, { scheduling: { rollover: 4, learnAheadSecs: 1200 } });
    const next = withPreference(prefs, "scheduling", "rollover", 6);
    expect(next.scheduling?.rollover).toBe(6);
    expect(next.scheduling?.learnAheadSecs).toBe(1200);
    expect(prefs.scheduling?.rollover).toBe(4);
  });

  it("fills groups the core left out", () => {
    const next = withPreference(create(PreferencesSchema), "backups", "daily", 12);
    expect(next.backups?.daily).toBe(12);
    expect(next.editing).toBeDefined();
  });
});

describe("minutes", () => {
  it("rounds stored seconds down to whole minutes, as Anki shows them", () => {
    expect(secsToMins(1200)).toBe(20);
    expect(secsToMins(1259)).toBe(20);
    expect(minsToSecs(20)).toBe(1200);
  });
});
