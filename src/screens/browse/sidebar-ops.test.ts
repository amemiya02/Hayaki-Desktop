import { describe, expect, it } from "vitest";

import { canReparent, cleanName, parentOf, renameSaved } from "./sidebar-ops";

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
