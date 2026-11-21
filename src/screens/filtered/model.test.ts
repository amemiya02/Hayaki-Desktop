// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { Deck_Filtered_SearchTerm_Order as Order, FilteredDeckForUpdateSchema } from "@/lib/anki/proto/anki/decks_pb";
import { CustomStudyRequest_Cram_CramKind as CramKind } from "@/lib/anki/proto/anki/scheduler_pb";

import {
  availableOrders,
  countWithChildren,
  customStudyRequest,
  deckFromForm,
  formFromDeck,
  initialTags,
  spinnerFor,
  toggleTag,
} from "./model";

const newDeck = () =>
  create(FilteredDeckForUpdateSchema, {
    id: 0n,
    name: "Filtered Deck 1",
    config: {
      reschedule: true,
      searchTerms: [{ search: "deck:current", limit: 100, order: Order.RETRIEVABILITY_ASCENDING }],
      previewAgainSecs: 60,
      previewHardSecs: 600,
      previewGoodSecs: 0,
    },
  });

describe("filtered Deck form", () => {
  it("hides retrievability orders without FSRS", () => {
    expect(availableOrders(11, false)).not.toContain(Order.RETRIEVABILITY_ASCENDING);
    expect(availableOrders(11, true)).toHaveLength(11);
  });

  it("falls back to random when the saved order is not offered", () => {
    const form = formFromDeck(newDeck(), availableOrders(11, false));
    expect(form.order).toBe(Order.RANDOM);
  });

  it("uses the desired searches and turns on the second filter for search2", () => {
    const form = formFromDeck(newDeck(), availableOrders(11, true), { search: "is:due", search2: "is:new" });
    expect(form.search).toBe("is:due");
    expect(form.secondFilter).toBe(true);
    expect(form.search2).toBe("is:new");
    expect(form.limit2).toBe(20);
  });

  it("keeps the second filter hidden for a new Deck even if the core supplies one", () => {
    const deck = newDeck();
    deck.config!.searchTerms.push({ ...deck.config!.searchTerms[0], search: "x" });
    expect(formFromDeck(deck, availableOrders(11, true)).secondFilter).toBe(false);
    deck.id = 5n;
    expect(formFromDeck(deck, availableOrders(11, true)).secondFilter).toBe(true);
  });

  it("sends the second filter only when it is enabled, and clears v1 delays", () => {
    const deck = newDeck();
    const form = { ...formFromDeck(deck, availableOrders(11, true)), search2: "is:new" };
    expect(deckFromForm(deck, form).config?.searchTerms).toHaveLength(1);
    const out = deckFromForm(deck, { ...form, secondFilter: true });
    expect(out.config?.searchTerms).toHaveLength(2);
    expect(out.config?.delays).toEqual([]);
  });
});

describe("Custom Study", () => {
  it("lets limits go negative but keeps days positive", () => {
    expect(spinnerFor("new", { extendNew: 5, extendReview: 0 })).toMatchObject({ min: -99999, initial: 5 });
    expect(spinnerFor("forgot", { extendNew: 0, extendReview: 0 })).toMatchObject({ min: 1, max: 30 });
    expect(spinnerFor("cram", { extendNew: 0, extendReview: 0 }).initial).toBe(100);
  });

  it("builds each request kind", () => {
    const cram = { kind: CramKind.ALL, include: ["a"], exclude: ["b"] };
    expect(customStudyRequest(1n, "review", 10, cram).value).toEqual({ case: "reviewLimitDelta", value: 10 });
    expect(customStudyRequest(1n, "preview", 3, cram).value).toEqual({ case: "previewDays", value: 3 });
    expect(customStudyRequest(1n, "cram", 50, cram).value).toEqual({
      case: "cram",
      value: { kind: CramKind.ALL, cardLimit: 50, tagsToInclude: ["a"], tagsToExclude: ["b"] },
    });
  });

  it("shows subdeck counts only when there are some", () => {
    expect(countWithChildren(4, 0, (n) => `(${n} in subdecks)`)).toBe("4");
    expect(countWithChildren(4, 2, (n) => `(${n} in subdecks)`)).toBe("4 (2 in subdecks)");
  });

  it("keeps a tag out of both lists at once", () => {
    let lists = initialTags([
      { name: "a", include: true, exclude: false },
      { name: "b", include: false, exclude: true },
    ] as never);
    lists = toggleTag(lists, "include", "b");
    expect(lists).toEqual({ include: ["a", "b"], exclude: [] });
    lists = toggleTag(lists, "include", "a");
    expect(lists.include).toEqual(["b"]);
  });
});
