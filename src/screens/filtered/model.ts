// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The filtered Deck and Custom Study forms as plain data, mirroring upstream's
 * qt/aqt/filtered_deck.py and qt/aqt/customstudy.py.
 */
import type { MessageInitShape } from "@bufbuild/protobuf";

import {
  Deck_Filtered_SearchTerm_Order as Order,
  type FilteredDeckForUpdate,
  type FilteredDeckForUpdateSchema,
} from "@/lib/anki/proto/anki/decks_pb";
import {
  CustomStudyRequest_Cram_CramKind as CramKind,
  type CustomStudyDefaultsResponse,
  type CustomStudyRequestSchema,
} from "@/lib/anki/proto/anki/scheduler_pb";

/* ------------------------------ Filtered Deck ------------------------------ */

/** Anki's maximum size of a filtered Deck (DYN_MAX_SIZE). */
export const DYN_MAX_SIZE = 99999;

const FSRS_ONLY_ORDERS = new Set([Order.RETRIEVABILITY_ASCENDING, Order.RETRIEVABILITY_DESCENDING]);
export const DEFAULT_ORDER = Order.RANDOM;

/** The orders offered: retrievability orders need FSRS memory states. */
export function availableOrders(count: number, fsrs: boolean): Order[] {
  const orders: Order[] = [];
  for (let order = 0; order < count; order++) {
    if (fsrs || !FSRS_ONLY_ORDERS.has(order)) orders.push(order);
  }
  return orders;
}

/** A saved order that is no longer offered (FSRS turned off) falls back to random. */
export function shownOrder(order: Order, available: Order[]): Order {
  return available.includes(order) ? order : DEFAULT_ORDER;
}

export interface FilteredForm {
  name: string;
  search: string;
  limit: number;
  order: Order;
  secondFilter: boolean;
  search2: string;
  limit2: number;
  order2: Order;
  reschedule: boolean;
  againSecs: number;
  hardSecs: number;
  goodSecs: number;
  allowEmpty: boolean;
}

export function formFromDeck(
  deck: FilteredDeckForUpdate,
  available: Order[],
  desired?: { search?: string; search2?: string },
): FilteredForm {
  const config = deck.config;
  const existing = deck.id !== 0n;
  const term1 = config?.searchTerms[0];
  const term2 = config?.searchTerms[1];
  const form: FilteredForm = {
    name: deck.name,
    search: term1?.search ?? "",
    limit: term1?.limit ?? 100,
    order: shownOrder(term1?.order ?? DEFAULT_ORDER, available),
    secondFilter: !!term2 && existing,
    search2: term2?.search ?? "",
    limit2: term2 ? term2.limit : 20,
    order2: shownOrder(term2?.order ?? DEFAULT_ORDER, available),
    reschedule: config?.reschedule ?? true,
    againSecs: config?.previewAgainSecs ?? 60,
    hardSecs: config?.previewHardSecs ?? 600,
    goodSecs: config?.previewGoodSecs ?? 0,
    allowEmpty: deck.allowEmpty,
  };
  if (desired?.search !== undefined) form.search = desired.search;
  if (desired?.search2 !== undefined) {
    form.secondFilter = true;
    form.search2 = desired.search2;
  }
  return form;
}

/** The request that saves the form; the second filter is sent only when enabled. */
export function deckFromForm(deck: FilteredDeckForUpdate, form: FilteredForm): MessageInitShape<typeof FilteredDeckForUpdateSchema> {
  const searchTerms = [{ search: form.search, limit: form.limit, order: form.order }];
  if (form.secondFilter) searchTerms.push({ search: form.search2, limit: form.limit2, order: form.order2 });
  return {
    id: deck.id,
    name: form.name,
    allowEmpty: form.allowEmpty,
    config: {
      reschedule: form.reschedule,
      searchTerms,
      delays: [],
      previewDelay: deck.config?.previewDelay ?? 0,
      previewAgainSecs: form.againSecs,
      previewHardSecs: form.hardSecs,
      previewGoodSecs: form.goodSecs,
    },
  };
}

/* ------------------------------ Custom Study ------------------------------ */

export type StudyMode = "new" | "review" | "forgot" | "ahead" | "preview" | "cram";
export const STUDY_MODES: StudyMode[] = ["new", "review", "forgot", "ahead", "preview", "cram"];

/** The four card choices of "Study by card state or tag", in upstream's order. */
export const CRAM_KINDS: CramKind[] = [CramKind.NEW, CramKind.DUE, CramKind.REVIEW, CramKind.ALL];

export interface Spinner {
  min: number;
  max: number;
  initial: number;
  /** ftl keys for the text before and after the number. */
  before: string;
  after: string;
}

export function spinnerFor(mode: StudyMode, defaults: Pick<CustomStudyDefaultsResponse, "extendNew" | "extendReview">): Spinner {
  switch (mode) {
    case "new":
      return { min: -DYN_MAX_SIZE, max: DYN_MAX_SIZE, initial: defaults.extendNew, before: "custom-study-increase-todays-new-card-limit-by", after: "custom-study-cards" };
    case "review":
      return { min: -DYN_MAX_SIZE, max: DYN_MAX_SIZE, initial: defaults.extendReview, before: "custom-study-increase-todays-review-limit-by", after: "custom-study-cards" };
    case "forgot":
      return { min: 1, max: 30, initial: 1, before: "custom-study-review-cards-forgotten-in-last", after: "custom-study-days" };
    case "ahead":
      return { min: 1, max: DYN_MAX_SIZE, initial: 1, before: "custom-study-review-ahead-by", after: "custom-study-days" };
    case "preview":
      return { min: 1, max: DYN_MAX_SIZE, initial: 1, before: "custom-study-preview-new-cards-added-in-the", after: "custom-study-days" };
    case "cram":
      return { min: 1, max: DYN_MAX_SIZE, initial: 100, before: "custom-study-select", after: "custom-study-cards-from-the-deck" };
  }
}

export function clampToSpinner(value: number, spinner: Spinner): number {
  return Math.min(spinner.max, Math.max(spinner.min, Math.round(value)));
}

export interface CramChoice {
  kind: CramKind;
  include: string[];
  exclude: string[];
}

export function customStudyRequest(deckId: bigint, mode: StudyMode, value: number, cram: CramChoice): MessageInitShape<typeof CustomStudyRequestSchema> {
  switch (mode) {
    case "new":
      return { deckId, value: { case: "newLimitDelta", value } };
    case "review":
      return { deckId, value: { case: "reviewLimitDelta", value } };
    case "forgot":
      return { deckId, value: { case: "forgotDays", value } };
    case "ahead":
      return { deckId, value: { case: "reviewAheadDays", value } };
    case "preview":
      return { deckId, value: { case: "previewDays", value } };
    case "cram":
      return {
        deckId,
        value: { case: "cram", value: { kind: cram.kind, cardLimit: value, tagsToInclude: cram.include, tagsToExclude: cram.exclude } },
      };
  }
}

/** Upstream's "12 (3 in subdecks)" count, given the translated subdeck suffix. */
export function countWithChildren(parent: number, children: number, childText: (count: number) => string): string {
  return children ? `${parent} ${childText(children)}` : String(parent);
}

/** Starts from the tags upstream remembers as included or excluded for this Deck. */
export function initialTags(tags: CustomStudyDefaultsResponse["tags"]): { include: string[]; exclude: string[] } {
  return {
    include: tags.filter((t) => t.include).map((t) => t.name),
    exclude: tags.filter((t) => t.exclude).map((t) => t.name),
  };
}

/** Toggles a tag in one list; a tag cannot be both included and excluded. */
export function toggleTag(lists: { include: string[]; exclude: string[] }, list: "include" | "exclude", tag: string) {
  const other = list === "include" ? "exclude" : "include";
  const has = lists[list].includes(tag);
  return {
    ...lists,
    [list]: has ? lists[list].filter((t) => t !== tag) : [...lists[list], tag],
    [other]: has ? lists[other] : lists[other].filter((t) => t !== tag),
  } as { include: string[]; exclude: string[] };
}
