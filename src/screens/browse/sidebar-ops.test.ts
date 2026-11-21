import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { TagTreeNodeSchema, type TagTreeNode } from "@/lib/anki/proto/anki/tags_pb";

import { canReparent, cleanName, leafOf, parentOf, renameSaved, reparentedName, tagMoveTargets } from "./sidebar-ops";

describe("canReparent", () => {
  it("allows moving into another branch or to the top", () => {
    expect(canReparent("a::b", "c")).toBe(true);
    expect(canReparent("a::b", "")).toBe(true);
    expect(canReparent("x", "a::b")).toBe(true);
  });

  it("refuses itself, its parent and its descendants", () => {
    expect(canReparent("a::b", "a::b")).toBe(false);
    expect(canReparent("a::b", "a")).toBe(false);
    expect(canReparent("a", "a::b::c")).toBe(false);
    expect(canReparent("a", "")).toBe(false);
  });

  it("compares without regard to case, as the core does", () => {
    expect(canReparent("Spanish::Verbs", "spanish")).toBe(false);
    expect(canReparent("spanish", "SPANISH::verbs")).toBe(false);
  });

  it("does not mistake a longer name for a descendant", () => {
    expect(canReparent("a", "ab")).toBe(true);
  });
});

describe("names", () => {
  it("drops quotes and surrounding space", () => {
    expect(cleanName(' "Hard" words ')).toBe("Hard words");
  });
  it("finds the parent path", () => {
    expect(parentOf("a::b::c")).toBe("a::b");
    expect(parentOf("a")).toBe("");
  });
});

describe("renameSaved", () => {
  const saved = { one: "tag:a", two: "tag:b" };
  it("moves the search to its new name", () => {
    expect(renameSaved(saved, "one", "uno")).toEqual({ saved: { two: "tag:b", uno: "tag:a" }, overwrites: null });
  });
  it("reports the name it would overwrite", () => {
    const change = renameSaved(saved, "one", "two");
    expect(change.overwrites).toBe("two");
    expect(change.saved).toEqual({ two: "tag:a" });
  });
  it("leaves an unchanged or unknown name alone", () => {
    expect(renameSaved(saved, "one", "one").saved).toBe(saved);
    expect(renameSaved(saved, "nope", "x").saved).toBe(saved);
  });
});

describe("reparentedName", () => {
  it("puts the leaf under the target", () => {
    expect(reparentedName("a::b", "c")).toBe("c::b");
    expect(reparentedName("x", "a::b")).toBe("a::b::x");
  });

  it("moves to the top level with just the leaf", () => {
    expect(reparentedName("a::b::c", "")).toBe("c");
  });

  it("keeps the whole subtree path below the leaf", () => {
    expect(leafOf("a::b")).toBe("b");
    expect(leafOf("solo")).toBe("solo");
  });
});

const node = (name: string, ...children: TagTreeNode[]) => create(TagTreeNodeSchema, { name, children });

describe("tagMoveTargets", () => {
  const tree = [node("a", node("b", node("c")), node("d")), node("e")];
  const names = (source: string, query?: string) => tagMoveTargets(tree, source, query).map((t) => t.name);

  it("offers the top level and every tag except itself, its descendants and its parent", () => {
    expect(names("a::b")).toEqual(["", "a::d", "e"]);
  });

  it("lists in tree order with depths", () => {
    expect(tagMoveTargets(tree, "e").map((t) => [t.name, t.depth])).toEqual([
      ["a", 0],
      ["a::b", 1],
      ["a::b::c", 2],
      ["a::d", 1],
    ]);
  });

  it("never offers the top level to a top-level tag", () => {
    expect(names("e")).not.toContain("");
  });

  it("narrows by a case-insensitive query and drops the top level", () => {
    expect(names("e", "B")).toEqual(["a::b", "a::b::c"]);
  });
});
