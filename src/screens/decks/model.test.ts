// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { DeckTreeNodeSchema, type DeckTreeNode } from "@/lib/anki/proto/anki/decks_pb";

import { dropState, moveTargets, parentIdOf, TOP_LEVEL } from "./model";

function node(id: number, name: string, children: DeckTreeNode[] = [], filtered = false): DeckTreeNode {
  return create(DeckTreeNodeSchema, { deckId: BigInt(id), name, children, filtered });
}

// Root
//   Japan (1)
//     Japan::Kanji (2)
//       Japan::Kanji::N5 (3)
//   Music (4)
//   Cram (5, filtered)
const tree = node(0, "", [
  node(1, "Japan", [node(2, "Japan::Kanji", [node(3, "Japan::Kanji::N5")])]),
  node(4, "Music"),
  node(5, "Cram", [], true),
]);

describe("parentIdOf", () => {
  it("finds the holder, with the top level as 0", () => {
    expect(parentIdOf(tree, 3n)).toBe(2n);
    expect(parentIdOf(tree, 1n)).toBe(TOP_LEVEL);
    expect(parentIdOf(tree, 99n)).toBeUndefined();
  });
});

describe("dropState", () => {
  it("allows a Deck into another Deck and to the top level", () => {
    expect(dropState(tree, 4n, 1n)).toBe("ok");
    expect(dropState(tree, 3n, TOP_LEVEL)).toBe("ok");
  });
  it("refuses moves that do nothing or break the tree", () => {
    expect(dropState(tree, 1n, 1n)).toBe("self");
    expect(dropState(tree, 1n, 3n)).toBe("inside-itself");
    expect(dropState(tree, 3n, 2n)).toBe("already-there");
    expect(dropState(tree, 1n, TOP_LEVEL)).toBe("already-there");
    expect(dropState(tree, 4n, 5n)).toBe("filtered-target");
    expect(dropState(tree, 99n, 1n)).toBe("missing");
  });
});

describe("moveTargets", () => {
  it("lists the top level first, then every valid Deck in tree order", () => {
    const targets = moveTargets(tree, 3n);
    expect(targets.map((t) => t.id)).toEqual([TOP_LEVEL, 1n, 4n]);
    expect(targets.find((t) => t.id === 1n)?.depth).toBe(0);
  });
  it("leaves out the Deck itself, its subdecks and filtered Decks", () => {
    expect(moveTargets(tree, 1n).map((t) => t.id)).toEqual([4n]);
  });
  it("narrows by name without the top level", () => {
    expect(moveTargets(tree, 3n, "mus").map((t) => t.id)).toEqual([4n]);
    expect(moveTargets(tree, 3n, "zzz")).toEqual([]);
  });
});
