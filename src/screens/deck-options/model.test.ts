// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { describe, expect, test } from "vitest";

import {
  DeckConfig_Config_NewCardGatherPriority as GatherOrder,
  DeckConfig_Config_NewCardSortOrder as SortOrder,
  DeckConfig_ConfigSchema,
  DeckConfigsForUpdateSchema,
  type DeckConfigsForUpdate,
} from "@/lib/anki/proto/anki/deck_config_pb";

import {
  addPreset,
  buildRequest,
  clonePreset,
  currentConfig,
  fromServer,
  presetList,
  removalForcesFullSync,
  removePreset,
  renamePreset,
  selectPreset,
  setFlag,
  setTabbed,
  snapshot,
  switchTab,
  tabbedValue,
  updateConfig,
  UpdateDeckConfigsMode,
} from "./model";

const easyDays = [1, 1, 1, 1, 1, 1, 1];

function config(overrides: Omit<MessageInitShape<typeof DeckConfig_ConfigSchema>, "$typeName"> = {}) {
  return create(DeckConfig_ConfigSchema, {
    newPerDay: 20,
    reviewsPerDay: 200,
    learnSteps: [1, 10],
    desiredRetention: 0.9,
    easyDaysPercentages: easyDays,
    ...overrides,
  });
}

function sample(): DeckConfigsForUpdate {
  return create(DeckConfigsForUpdateSchema, {
    allConfig: [
      { config: { id: 1n, name: "Default", config: config() }, useCount: 1 },
      { config: { id: 1000n, name: "Languages", config: config({ newPerDay: 10 }) }, useCount: 3 },
      { config: { id: 1001n, name: "another", config: config({ newPerDay: 5 }) }, useCount: 1 },
    ],
    currentDeck: { name: "Japanese::Vocab", configId: 1000n, limits: {} },
    defaults: { config: config() },
    schemaModified: false,
    cardStateCustomizer: "",
    fsrs: false,
  });
}

describe("loading", () => {
  test("presets sorted by name, current selected, use counts", () => {
    const state = fromServer(5n, sample());
    expect(presetList(state)).toEqual([
      { index: 0, name: "another", useCount: 1, current: false },
      { index: 1, name: "Default", useCount: 1, current: false },
      { index: 2, name: "Languages", useCount: 3, current: true },
    ]);
    expect(state.deckName).toBe("Japanese::Vocab");
  });

  test("selecting another preset moves the target deck's count", () => {
    const state = selectPreset(fromServer(5n, sample()), 1);
    const list = presetList(state);
    expect(list[1]).toMatchObject({ name: "Default", useCount: 2, current: true });
    expect(list[2]).toMatchObject({ name: "Languages", useCount: 2, current: false });
    expect(state.assignmentsChanged).toBe(true);
  });

  test("easy days and invalid sort orders are normalised without counting as changes", () => {
    const data = sample();
    data.allConfig[1].config!.config!.easyDaysPercentages = [];
    data.allConfig[1].config!.config!.newCardGatherPriority = GatherOrder.RANDOM_CARDS;
    data.allConfig[1].config!.config!.newCardSortOrder = SortOrder.RANDOM_CARD;
    const state = fromServer(5n, data);
    expect(currentConfig(state).easyDaysPercentages).toEqual(easyDays);
    expect(currentConfig(state).newCardSortOrder).toBe(SortOrder.TEMPLATE);
    expect(state.modified).toEqual([]);
  });
});

describe("editing", () => {
  test("changing an option marks the preset modified and dirty", () => {
    const state = fromServer(5n, sample());
    const original = snapshot(state);
    const next = updateConfig(state, { newPerDay: 15 });
    expect(next.modified).toEqual([1000n]);
    expect(snapshot(next)).not.toBe(original);
    expect(snapshot(updateConfig(next, { newPerDay: 10 }))).toBe(original);
  });

  test("f32 rounding does not count as a change", () => {
    const state = fromServer(5n, sample());
    const original = snapshot(state);
    expect(snapshot(updateConfig(state, { desiredRetention: Math.fround(0.9) }))).toBe(original);
    expect(snapshot(updateConfig(state, { desiredRetention: 0.9 }))).toBe(original);
  });

  test("gathering random cards resets a sort order it disables", () => {
    let state = fromServer(5n, sample());
    state = updateConfig(state, { newCardSortOrder: SortOrder.RANDOM_CARD });
    state = updateConfig(state, { newCardGatherPriority: GatherOrder.RANDOM_CARDS });
    expect(currentConfig(state).newCardSortOrder).toBe(SortOrder.TEMPLATE);
  });
});

describe("presets", () => {
  test("add uses defaults, clone copies, both become current", () => {
    let state = fromServer(5n, sample());
    state = clonePreset(state, "Copy");
    expect(currentConfig(state).newPerDay).toBe(10);
    expect(presetList(state).find((p) => p.current)?.name).toBe("Copy");
    state = addPreset(state, "Fresh");
    expect(currentConfig(state).newPerDay).toBe(20);
  });

  test("duplicate names get a timestamp", () => {
    const state = addPreset(fromServer(5n, sample()), "Default", 1_700_000_000_000);
    expect(presetList(state).find((p) => p.current)?.name).toBe("Default1700000000");
  });

  test("rename keeps selection and marks modified", () => {
    const state = renamePreset(fromServer(5n, sample()), "Aardvark");
    expect(presetList(state)[0]).toMatchObject({ name: "Aardvark", current: true });
    expect(state.modified).toEqual([1000n]);
  });

  test("remove records the id and selects the previous preset", () => {
    const state = fromServer(5n, sample());
    expect(removalForcesFullSync(state)).toBe(true);
    const next = removePreset(state);
    expect(next.removed).toEqual([1000n]);
    expect(next.schemaModified).toBe(true);
    expect(presetList(next).find((p) => p.current)?.name).toBe("Default");
  });

  test("the default preset cannot be removed", () => {
    expect(() => removePreset(selectPreset(fromServer(5n, sample()), 1))).toThrow();
  });

  test("removing an unsaved preset records nothing", () => {
    const next = removePreset(addPreset(fromServer(5n, sample()), "Temp"));
    expect(next.removed).toEqual([]);
  });
});

describe("saving", () => {
  test("sends new and modified presets, current last", () => {
    let state = fromServer(5n, sample());
    state = updateConfig(state, { newPerDay: 12 });
    state = selectPreset(state, 0); // "another"
    state = addPreset(state, "New one");
    state = setFlag(state, "fsrs", true);
    const request = buildRequest(state, UpdateDeckConfigsMode.APPLY_TO_CHILDREN);
    expect(request.targetDeckId).toBe(5n);
    expect(request.mode).toBe(UpdateDeckConfigsMode.APPLY_TO_CHILDREN);
    expect(request.configs!.map((c) => c.name)).toEqual(["Languages", "New one"]);
    expect(request.fsrs).toBe(true);
    expect(request.fsrsReschedule).toBe(false);
    expect(request.removedConfigIds).toEqual([]);
  });

  test("an unmodified current preset is still sent", () => {
    const request = buildRequest(fromServer(5n, sample()), UpdateDeckConfigsMode.NORMAL);
    expect(request.configs!.map((c) => c.name)).toEqual(["Languages"]);
  });
});

describe("limit tabs", () => {
  test("preset tab edits the preset", () => {
    const state = setTabbed(fromServer(5n, sample()), "new", 30);
    expect(currentConfig(state).newPerDay).toBe(30);
    expect(state.limits.new).toBeUndefined();
  });

  test("this deck tab starts from the shown value and restores the preset", () => {
    let state = fromServer(5n, sample());
    state = setTabbed(state, "new", 30);
    state = switchTab(state, "new", 1);
    expect(state.limits.new).toBe(30);
    // The preset tab is restored to its value when the tab was created.
    expect(currentConfig(state).newPerDay).toBe(10);
    state = setTabbed(state, "new", 4);
    expect(state.limits.new).toBe(4);
    expect(tabbedValue(state, "new")).toBe(4);
  });

  test("going back to the preset tab clears later tabs", () => {
    let state = fromServer(5n, sample());
    state = switchTab(state, "review", 2);
    expect(state.limits.reviewToday).toBe(200);
    state = switchTab(state, "review", 0);
    expect(state.limits.reviewToday).toBeUndefined();
    expect(state.limits.review).toBeUndefined();
  });

  test("the last set tab is active on load; inactive today limits are cleared", () => {
    const data = sample();
    data.currentDeck!.limits = { $typeName: "anki.deck_config.DeckConfigsForUpdate.CurrentDeck.Limits", new: 7, newToday: 3, newTodayActive: false, reviewTodayActive: false } as never;
    const state = fromServer(5n, data);
    expect(state.tabs.new.active).toBe(1);
    expect(tabbedValue(state, "new")).toBe(7);
    expect(state.limits.newToday).toBeUndefined();
  });

  test("today only resumes its earlier value", () => {
    const data = sample();
    data.currentDeck!.limits = { $typeName: "anki.deck_config.DeckConfigsForUpdate.CurrentDeck.Limits", newToday: 3, newTodayActive: false, reviewTodayActive: false } as never;
    const state = switchTab(fromServer(5n, data), "new", 2);
    expect(state.limits.newToday).toBe(3);
    expect(tabbedValue(state, "new")).toBe(3);
  });

  test("switching tabs and back is not a change", () => {
    const state = fromServer(5n, sample());
    const original = snapshot(state);
    expect(snapshot(switchTab(switchTab(state, "new", 2), "new", 0))).toBe(original);
    expect(snapshot(switchTab(state, "new", 1))).not.toBe(original);
  });

  test("switching preset refreshes the preset tab", () => {
    const state = selectPreset(fromServer(5n, sample()), 0);
    expect(tabbedValue(state, "new")).toBe(5);
  });

  test("deck-specific desired retention", () => {
    let state = setFlag(fromServer(5n, sample()), "fsrs", true);
    state = switchTab(state, "retention", 1);
    state = setTabbed(state, "retention", 0.85);
    expect(state.limits.desiredRetention).toBe(0.85);
    expect(currentConfig(state).desiredRetention).toBe(0.9);
  });
});
