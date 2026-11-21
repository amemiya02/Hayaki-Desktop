// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Deck options state, ported from Anki's `DeckOptionsState`
 * (ts/routes/deck-options/lib.ts) as pure functions over an immutable value.
 * Presets are kept sorted by name; the selected one is the one the deck will
 * use. Saving sends every new or modified preset, with the selected one last.
 */
import { clone, create, toBinary, type MessageInitShape } from "@bufbuild/protobuf";

import {
  DeckConfig_Config_NewCardGatherPriority as GatherOrder,
  DeckConfig_Config_NewCardSortOrder as SortOrder,
  DeckConfig_ConfigSchema,
  DeckConfigSchema,
  DeckConfigsForUpdate_CurrentDeck_LimitsSchema,
  UpdateDeckConfigsMode,
  type DeckConfig,
  type DeckConfig_Config,
  type DeckConfigsForUpdate,
  type DeckConfigsForUpdate_CurrentDeck_Limits as Limits,
  type UpdateDeckConfigsRequestSchema,
} from "@/lib/anki/proto/anki/deck_config_pb";

import { activateTab, initTabs, makeTab, replaceFirstTab, setTabValue, shownValue, type TabbedValue } from "./tabs";

export { UpdateDeckConfigsMode };

export interface Preset {
  config: DeckConfig;
  /** Decks using the preset, not counting the target deck. */
  useCount: number;
}

export type TabbedKind = "new" | "review" | "retention";

export type GlobalFlag = "newCardsIgnoreReviewLimit" | "applyAllParentLimits" | "fsrs" | "fsrsReschedule" | "fsrsHealthCheck";

export interface OptionsState {
  targetDeckId: bigint;
  deckName: string;
  defaults: DeckConfig_Config;
  presets: Preset[];
  selected: number;
  modified: bigint[];
  removed: bigint[];
  schemaModified: boolean;
  assignmentsChanged: boolean;
  limits: Limits;
  cardStateCustomizer: string;
  newCardsIgnoreReviewLimit: boolean;
  applyAllParentLimits: boolean;
  fsrs: boolean;
  fsrsReschedule: boolean;
  fsrsHealthCheck: boolean;
  legacyEvaluate: boolean;
  daysSinceLastOptimization: number;
  tabs: Record<TabbedKind, TabbedValue>;
}

export interface PresetListEntry {
  index: number;
  name: string;
  useCount: number;
  current: boolean;
}

const collator = new Intl.Collator(undefined, { sensitivity: "base" });

/* ------------------------------ Loading ------------------------------ */

/** Sort orders that duplicate another one under the given gather order (DisplayOrder.svelte). */
export function disabledSortOrders(gather: GatherOrder): SortOrder[] {
  switch (gather) {
    case GatherOrder.RANDOM_NOTES:
      return [SortOrder.TEMPLATE_THEN_RANDOM, SortOrder.RANDOM_NOTE_THEN_TEMPLATE];
    case GatherOrder.RANDOM_CARDS:
      return [SortOrder.TEMPLATE_THEN_RANDOM, SortOrder.RANDOM_NOTE_THEN_TEMPLATE, SortOrder.RANDOM_CARD];
    default:
      return [];
  }
}

/** The corrections Anki's page applies when a preset is shown. */
export function normalizeConfig(config: DeckConfig_Config, defaults: DeckConfig_Config): DeckConfig_Config {
  let next = config;
  if (next.easyDaysPercentages.length !== 7) {
    next = { ...next, easyDaysPercentages: defaults.easyDaysPercentages.slice() };
  }
  if (!(next.newCardSortOrder in SortOrder) || disabledSortOrders(next.newCardGatherPriority).includes(next.newCardSortOrder)) {
    next = { ...next, newCardSortOrder: SortOrder.TEMPLATE };
  }
  return next;
}

export function fromServer(targetDeckId: bigint, data: DeckConfigsForUpdate): OptionsState {
  const defaults = data.defaults?.config ?? create(DeckConfig_ConfigSchema);
  const presets: Preset[] = data.allConfig.map((entry) => {
    const config = clone(DeckConfigSchema, entry.config ?? create(DeckConfigSchema));
    config.config = normalizeConfig(config.config ?? clone(DeckConfig_ConfigSchema, defaults), defaults);
    return { config, useCount: entry.useCount };
  });
  const currentId = data.currentDeck?.configId ?? 1n;
  let selected = Math.max(0, presets.findIndex((p) => p.config.id === currentId));
  // The selected preset gets +1 when listed, so the target deck is not counted twice.
  presets[selected] = { ...presets[selected], useCount: presets[selected].useCount - 1 };
  const sorted = sortPresets(presets, selected);
  selected = sorted.selected;

  const limits = clone(
    DeckConfigsForUpdate_CurrentDeck_LimitsSchema,
    data.currentDeck?.limits ?? create(DeckConfigsForUpdate_CurrentDeck_LimitsSchema),
  );

  let state: OptionsState = {
    targetDeckId,
    deckName: data.currentDeck?.name ?? "",
    defaults,
    presets: sorted.presets,
    selected,
    modified: [],
    removed: [],
    schemaModified: data.schemaModified,
    assignmentsChanged: false,
    limits,
    cardStateCustomizer: data.cardStateCustomizer,
    newCardsIgnoreReviewLimit: data.newCardsIgnoreReviewLimit,
    applyAllParentLimits: data.applyAllParentLimits,
    fsrs: data.fsrs,
    fsrsReschedule: false,
    fsrsHealthCheck: data.fsrsHealthCheck,
    legacyEvaluate: data.fsrsLegacyEvaluate,
    daysSinceLastOptimization: data.daysSinceLastFsrsOptimize,
    tabs: { new: { tabs: [], active: 0 }, review: { tabs: [], active: 0 }, retention: { tabs: [], active: 0 } },
  };
  state = createTabs(state, "new");
  state = createTabs(state, "review");
  state = createTabs(state, "retention");
  return state;
}

/* ------------------------------ Reading ------------------------------ */

export function currentPreset(state: OptionsState): DeckConfig {
  return state.presets[state.selected].config;
}

export function currentConfig(state: OptionsState): DeckConfig_Config {
  return currentPreset(state).config!;
}

export function presetList(state: OptionsState): PresetListEntry[] {
  return state.presets.map((p, index) => ({
    index,
    name: p.config.name,
    useCount: p.useCount + (index === state.selected ? 1 : 0),
    current: index === state.selected,
  }));
}

export function isDefaultPresetSelected(state: OptionsState): boolean {
  return currentPreset(state).id === 1n;
}

export function removalForcesFullSync(state: OptionsState): boolean {
  return !state.schemaModified && currentPreset(state).id !== 0n;
}

export function fsrsParams(config: DeckConfig_Config): number[] {
  if (config.fsrsParams6.length) return config.fsrsParams6;
  if (config.fsrsParams5.length) return config.fsrsParams5;
  return config.fsrsParams4;
}

/** The search FSRS uses for the selected preset when none is set. */
export function defaultParamSearch(state: OptionsState): string {
  const name = currentPreset(state).name.replace(/([\\"])/g, "\\$1");
  return `preset:"${name}" -is:suspended`;
}

/* ------------------------------ Editing ------------------------------ */

function markModified(modified: bigint[], id: bigint): bigint[] {
  return id && !modified.includes(id) ? [...modified, id] : modified;
}

function withCurrent(state: OptionsState, preset: Preset): OptionsState {
  const presets = state.presets.slice();
  presets[state.selected] = preset;
  return { ...state, presets };
}

function sameConfig(a: DeckConfig_Config, b: DeckConfig_Config): boolean {
  return bytesEqual(toBinary(DeckConfig_ConfigSchema, a), toBinary(DeckConfig_ConfigSchema, b));
}

export function updateConfig(state: OptionsState, patch: Partial<DeckConfig_Config>): OptionsState {
  const preset = state.presets[state.selected];
  const before = preset.config.config!;
  let next: DeckConfig_Config = { ...before, ...patch };
  if (patch.newCardGatherPriority !== undefined && disabledSortOrders(next.newCardGatherPriority).includes(next.newCardSortOrder)) {
    next = { ...next, newCardSortOrder: SortOrder.TEMPLATE };
  }
  if (sameConfig(before, next)) {
    return withCurrent(state, { ...preset, config: { ...preset.config, config: next } });
  }
  const updated = withCurrent(state, { ...preset, config: { ...preset.config, config: next } });
  return { ...updated, modified: markModified(state.modified, preset.config.id) };
}

export function setFlag(state: OptionsState, flag: GlobalFlag, value: boolean): OptionsState {
  let next = { ...state, [flag]: value };
  // FSRS options mount afresh when FSRS is turned on, recreating their tabs.
  if (flag === "fsrs" && value && !state.fsrs) next = createTabs(next, "retention");
  return next;
}

export function setCardStateCustomizer(state: OptionsState, text: string): OptionsState {
  return { ...state, cardStateCustomizer: text };
}

/* ------------------------------ Tabbed values ------------------------------ */

function tabsFor(state: OptionsState, kind: TabbedKind): TabbedValue {
  const config = currentConfig(state);
  const limits = state.limits;
  switch (kind) {
    case "new":
      return {
        tabs: [
          makeTab(config.newPerDay, config.newPerDay, null),
          makeTab(limits.new ?? null, null, null),
          makeTab(limits.newTodayActive ? (limits.newToday ?? null) : null, null, limits.newToday ?? null),
        ],
        active: 0,
      };
    case "review":
      return {
        tabs: [
          makeTab(config.reviewsPerDay, config.reviewsPerDay, null),
          makeTab(limits.review ?? null, null, null),
          makeTab(limits.reviewTodayActive ? (limits.reviewToday ?? null) : null, null, limits.reviewToday ?? null),
        ],
        active: 0,
      };
    case "retention":
      return {
        tabs: [makeTab(config.desiredRetention, config.desiredRetention, null), makeTab(limits.desiredRetention ?? null, null, null)],
        active: 0,
      };
  }
}

function writeTab(state: OptionsState, kind: TabbedKind, index: number, value: number | null): OptionsState {
  const limit = value ?? undefined;
  const fields: Record<TabbedKind, [keyof DeckConfig_Config, keyof Limits, keyof Limits | null]> = {
    new: ["newPerDay", "new", "newToday"],
    review: ["reviewsPerDay", "review", "reviewToday"],
    retention: ["desiredRetention", "desiredRetention", null],
  };
  const [configField, deckField, todayField] = fields[kind];
  if (index === 0) {
    return value === null ? state : updateConfig(state, { [configField]: value });
  }
  const field = index === 1 ? deckField : todayField;
  if (!field) return state;
  return { ...state, limits: { ...state.limits, [field]: limit } };
}

function applyWrites(state: OptionsState, kind: TabbedKind, writes: (number | null)[]): OptionsState {
  return writes.reduce<OptionsState>((s, value, index) => writeTab(s, kind, index, value), state);
}

function createTabs(state: OptionsState, kind: TabbedKind): OptionsState {
  const { tabbed, writes } = initTabs(tabsFor(state, kind).tabs);
  const next = { ...state, tabs: { ...state.tabs, [kind]: tabbed } };
  return applyWrites(next, kind, writes);
}

export function tabbedValue(state: OptionsState, kind: TabbedKind): number {
  return shownValue(state.tabs[kind]);
}

export function switchTab(state: OptionsState, kind: TabbedKind, index: number): OptionsState {
  if (state.tabs[kind].active === index) return state;
  const { tabbed, writes } = activateTab(state.tabs[kind], index);
  return applyWrites({ ...state, tabs: { ...state.tabs, [kind]: tabbed } }, kind, writes);
}

export function setTabbed(state: OptionsState, kind: TabbedKind, value: number): OptionsState {
  const result = setTabValue(state.tabs[kind], value);
  return writeTab({ ...state, tabs: { ...state.tabs, [kind]: result.tabbed } }, kind, result.index, result.value);
}

/** Refreshes the preset tabs after a different preset becomes current. */
function onPresetChange(state: OptionsState): OptionsState {
  const config = currentConfig(state);
  return {
    ...state,
    tabs: {
      new: replaceFirstTab(state.tabs.new, config.newPerDay),
      review: replaceFirstTab(state.tabs.review, config.reviewsPerDay),
      retention: replaceFirstTab(state.tabs.retention, config.desiredRetention),
    },
  };
}

/* ------------------------------ Presets ------------------------------ */

function sortPresets(presets: Preset[], selected: number): { presets: Preset[]; selected: number } {
  const currentName = presets[selected].config.name;
  const sorted = presets.slice().sort((a, b) => collator.compare(a.config.name, b.config.name));
  return { presets: sorted, selected: sorted.findIndex((p) => p.config.name === currentName) };
}

function uniqueName(state: OptionsState, name: string, now: number): string {
  return state.presets.some((p) => p.config.name === name) ? name + (now / 1000).toFixed(0) : name;
}

export function selectPreset(state: OptionsState, index: number): OptionsState {
  return onPresetChange({ ...state, selected: index, assignmentsChanged: true });
}

function addPresetFrom(state: OptionsState, name: string, source: DeckConfig_Config, now: number): OptionsState {
  const config = create(DeckConfigSchema, {
    id: 0n,
    name: uniqueName(state, name, now),
    config: clone(DeckConfig_ConfigSchema, source),
  });
  const presets = [...state.presets, { config, useCount: 0 }];
  const sorted = sortPresets(presets, presets.length - 1);
  return onPresetChange({ ...state, presets: sorted.presets, selected: sorted.selected, assignmentsChanged: true });
}

/** Adds a preset with the default options and makes it current. */
export function addPreset(state: OptionsState, name: string, now = Date.now()): OptionsState {
  return addPresetFrom(state, name, state.defaults, now);
}

/** Copies the current preset under a new name and makes the copy current. */
export function clonePreset(state: OptionsState, name: string, now = Date.now()): OptionsState {
  return addPresetFrom(state, name, currentConfig(state), now);
}

export function renamePreset(state: OptionsState, name: string, now = Date.now()): OptionsState {
  const preset = state.presets[state.selected];
  if (preset.config.name === name) return state;
  const renamed = withCurrent(state, { ...preset, config: { ...preset.config, name: uniqueName(state, name, now) } });
  const sorted = sortPresets(renamed.presets, renamed.selected);
  return { ...renamed, presets: sorted.presets, selected: sorted.selected, modified: markModified(state.modified, preset.config.id) };
}

/** Removes the current preset; the default preset cannot be removed. */
export function removePreset(state: OptionsState): OptionsState {
  const id = currentPreset(state).id;
  if (id === 1n) throw new Error("can't remove default config");
  const removed = id !== 0n ? [...state.removed, id] : state.removed;
  const presets = state.presets.filter((_, i) => i !== state.selected);
  const next = { ...state, presets, removed, schemaModified: state.schemaModified || id !== 0n };
  return selectPreset(next, Math.max(0, state.selected - 1));
}

/* ------------------------------ Saving ------------------------------ */

export type UpdateRequest = MessageInitShape<typeof UpdateDeckConfigsRequestSchema>;

/** The request Anki's page sends (`dataForSaving`). */
export function buildRequest(state: OptionsState, mode: UpdateDeckConfigsMode): UpdateRequest {
  const others = state.presets
    .map((p) => p.config)
    .filter((c, i) => i !== state.selected && (c.id === 0n || state.modified.includes(c.id)));
  return {
    targetDeckId: state.targetDeckId,
    removedConfigIds: state.removed,
    // The current preset must come last, even when unmodified.
    configs: [...others, currentPreset(state)],
    mode,
    cardStateCustomizer: state.cardStateCustomizer,
    limits: state.limits,
    newCardsIgnoreReviewLimit: state.newCardsIgnoreReviewLimit,
    applyAllParentLimits: state.applyAllParentLimits,
    fsrs: state.fsrs,
    fsrsReschedule: state.fsrsReschedule,
    fsrsHealthCheck: state.fsrsHealthCheck,
  };
}

/**
 * Everything a save would change, as a comparable string. Floats are
 * compared as the f32 values the core stores, through their wire encoding.
 */
export function snapshot(state: OptionsState): string {
  const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return JSON.stringify({
    presets: state.presets.map((p) => hex(toBinary(DeckConfigSchema, p.config))),
    selected: currentPreset(state).name,
    removed: state.removed.map(String),
    limits: hex(toBinary(DeckConfigsForUpdate_CurrentDeck_LimitsSchema, state.limits)),
    cardStateCustomizer: state.cardStateCustomizer,
    newCardsIgnoreReviewLimit: state.newCardsIgnoreReviewLimit,
    applyAllParentLimits: state.applyAllParentLimits,
    fsrs: state.fsrs,
    fsrsReschedule: state.fsrsReschedule,
    fsrsHealthCheck: state.fsrsHealthCheck,
  });
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
