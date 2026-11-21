// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { describe, expect, it } from "vitest";

import { SearchNode_Flag } from "@/lib/anki/proto/anki/search_pb";

import { chordOf, actionForKey } from "./keys";
import { combineFor, idSearch, joinPath, negated, nodes, plainLabel } from "./search";

const mods = (m: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }>) => ({
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...m,
});

describe("combineFor", () => {
  it("maps modifiers like Anki's sidebar", () => {
    expect(combineFor(mods({}))).toEqual({ combine: "set", negate: false });
    expect(combineFor(mods({ ctrlKey: true }))).toEqual({ combine: "and", negate: false });
    expect(combineFor(mods({ metaKey: true }))).toEqual({ combine: "and", negate: false });
    expect(combineFor(mods({ shiftKey: true }))).toEqual({ combine: "or", negate: false });
    expect(combineFor(mods({ ctrlKey: true, shiftKey: true }))).toEqual({ combine: "replace", negate: false });
    expect(combineFor(mods({ altKey: true }))).toEqual({ combine: "set", negate: true });
  });
});

describe("nodes", () => {
  it("numbers flags like the core", () => {
    expect(nodes.flag(0).filter).toEqual({ case: "flag", value: SearchNode_Flag.NONE });
    expect(nodes.flag(1).filter).toEqual({ case: "flag", value: SearchNode_Flag.RED });
    expect(nodes.flag(7).filter).toEqual({ case: "flag", value: SearchNode_Flag.PURPLE });
  });

  it("negates a node", () => {
    expect(negated(nodes.addedToday())).toEqual({ filter: { case: "negated", value: { filter: { case: "addedInDays", value: 1 } } } });
  });
});

describe("helpers", () => {
  it("builds id searches", () => {
    expect(idSearch("cid", [1n, 2n, 3n])).toBe("cid:1,2,3");
  });

  it("joins tree paths", () => {
    expect(joinPath("", "Japanese")).toBe("Japanese");
    expect(joinPath("Japanese", "Vocab")).toBe("Japanese::Vocab");
  });

  it("strips accelerators, markup and ellipses from Anki labels", () => {
    expect(plainLabel("Set &Due Date...")).toBe("Set Due Date");
    expect(plainLabel("<b>Find</b>:")).toBe("Find");
    expect(plainLabel("Add Tags...")).toBe("Add Tags");
    expect(plainLabel("Fil&ter")).toBe("Filter");
    expect(plainLabel("检查并替换(&P)...")).toBe("检查并替换");
    expect(plainLabel("検索と置換 (&P)...")).toBe("検索と置換");
    expect(plainLabel("查找：")).toBe("查找");
  });
});

describe("shortcuts", () => {
  const key = (k: Partial<Parameters<typeof chordOf>[0]>) => ({
    key: "",
    code: "",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...k,
  });

  it("reads the physical key", () => {
    expect(chordOf(key({ key: "d", code: "KeyD", ctrlKey: true }))).toBe("Ctrl+D");
    expect(chordOf(key({ key: "!", code: "Digit1", ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+1");
    expect(chordOf(key({ key: "Delete", code: "Delete", ctrlKey: true }))).toBe("Ctrl+Del");
  });

  it("finds Anki's browser actions", () => {
    expect(actionForKey(key({ key: "d", code: "KeyD", ctrlKey: true }))).toBe("changeDeck");
    expect(actionForKey(key({ key: "D", code: "KeyD", ctrlKey: true, shiftKey: true }))).toBe("setDue");
    expect(actionForKey(key({ key: "a", code: "KeyA", ctrlKey: true, altKey: true, shiftKey: true }))).toBe("removeTags");
    expect(actionForKey(key({ key: "3", code: "Digit3", ctrlKey: true }))).toBe("flag3");
    expect(actionForKey(key({ key: "j", code: "KeyJ", ctrlKey: true }))).toBe("toggleSuspend");
    expect(actionForKey(key({ key: "j", code: "KeyJ" }))).toBeNull();
  });
});
