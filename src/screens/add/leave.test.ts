// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { beforeEach, describe, expect, it } from "vitest";

import { useNav } from "@/lib/nav";

import { guardUnsavedAdd } from "./leave";

describe("guardUnsavedAdd", () => {
  beforeEach(() => useNav.setState({ route: { name: "add" }, history: [] }));

  it("holds navigation until the person agrees to discard", () => {
    let proceed: (() => void) | undefined;
    guardUnsavedAdd((p) => (proceed = p));
    useNav.getState().go({ name: "decks" });
    expect(useNav.getState().route.name).toBe("add");
    proceed?.();
    expect(useNav.getState().route.name).toBe("decks");
  });

  it("stays put when the person keeps editing", () => {
    guardUnsavedAdd(() => {});
    useNav.getState().back();
    expect(useNav.getState().route.name).toBe("add");
  });

  it("lets navigation through once the guard is removed", () => {
    const remove = guardUnsavedAdd(() => {
      throw new Error("asked");
    });
    remove();
    useNav.getState().go({ name: "decks" });
    expect(useNav.getState().route.name).toBe("decks");
  });
});
