import { describe, expect, it } from "vitest";

import { groupDuplicates } from "./duplicates";

const v = (noteId: number, value: string) => ({ noteId: BigInt(noteId), value });

describe("groupDuplicates", () => {
  it("groups Notes that share text and ignores singles", () => {
    const groups = groupDuplicates([v(1, "cat"), v(2, "dog"), v(3, "cat"), v(4, "cat")]);
    expect(groups).toEqual([{ value: "cat", noteIds: [1n, 3n, 4n] }]);
  });

  it("never counts empty fields", () => {
    expect(groupDuplicates([v(1, ""), v(2, "")])).toEqual([]);
  });

  it("lists groups in the order each first repeats", () => {
    const groups = groupDuplicates([v(1, "a"), v(2, "b"), v(3, "b"), v(4, "a")]);
    expect(groups.map((g) => g.value)).toEqual(["b", "a"]);
  });

  it("is case sensitive, like Anki", () => {
    expect(groupDuplicates([v(1, "Cat"), v(2, "cat")])).toEqual([]);
  });
});
