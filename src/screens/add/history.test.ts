// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { describe, expect, it } from "vitest";

import { HISTORY_LIMIT, parseHistory, pushEntry, serializeHistory, type HistoryEntry } from "./history";

const entry = (id: number): HistoryEntry => ({ id: BigInt(id), text: `n${id}`, notetype: "Basic", deck: "Default" });

describe("Add history", () => {
  it("keeps the newest first and the last 30", () => {
    let entries: HistoryEntry[] = [];
    for (let i = 1; i <= HISTORY_LIMIT + 5; i++) entries = pushEntry(entries, entry(i));
    expect(entries).toHaveLength(HISTORY_LIMIT);
    expect(entries[0].id).toBe(BigInt(HISTORY_LIMIT + 5));
  });

  it("survives a restart, including ids beyond a double's precision", () => {
    const big = { ...entry(1), id: 1700000000123456789n };
    expect(parseHistory(serializeHistory([big, entry(2)]))).toEqual([big, entry(2)]);
  });

  it("reads damaged storage as empty", () => {
    expect(parseHistory(null)).toEqual([]);
    expect(parseHistory("{")).toEqual([]);
    expect(parseHistory('{"a":1}')).toEqual([]);
    expect(parseHistory('[{"id":"x"},{"id":"5","text":3}]')).toEqual([{ id: 5n, text: "", notetype: "", deck: "" }]);
  });
});
