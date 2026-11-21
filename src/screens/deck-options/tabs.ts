// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Values with "Preset / This deck / Today only" tabs, ported from Anki's
 * `ValueTab` and `TabbedValue.svelte`. Activating a tab applies its last
 * value; tabs before it keep their original values, tabs after it are cleared
 * (they would otherwise override the active one).
 *
 * Every operation returns the new tabs and the value to write through each
 * tab's setter, so the caller decides where each value lives.
 */

export interface ValueTab {
  value: number | null;
  /** Value when the tab was created; restored when a later tab becomes active. */
  initial: number | null;
  /** Written when an earlier tab becomes active. */
  disabled: number | null;
  /** Used when the tab is activated without a value of its own. */
  start: number | null;
}

export interface TabbedValue {
  tabs: ValueTab[];
  active: number;
}

export interface TabResult {
  tabbed: TabbedValue;
  /** One entry per tab: the value to pass to that tab's setter. */
  writes: (number | null)[];
}

export function makeTab(value: number | null, disabled: number | null, start: number | null): ValueTab {
  return { value, initial: value, disabled, start };
}

/** The last tab holding a value, which is the one in effect. */
export function lastSetTab(tabs: ValueTab[]): number {
  for (let i = tabs.length - 1; i >= 0; i--) {
    if (tabs[i].value !== null) return i;
  }
  return 0;
}

export function shownValue(tabbed: TabbedValue): number {
  return tabbed.tabs[tabbed.active].value ?? 0;
}

/** Creates the tabs and applies the initial activation, as Svelte does on mount. */
export function initTabs(tabs: ValueTab[]): TabResult {
  const active = lastSetTab(tabs);
  return activateTab({ tabs, active }, active);
}

export function activateTab(tabbed: TabbedValue, index: number): TabResult {
  const current = shownValue(tabbed);
  const tabs = tabbed.tabs.map((tab) => ({ ...tab }));
  const writes: (number | null)[] = [];
  tabs.forEach((tab, i) => {
    if (i === index) {
      tab.value = tab.value ?? tab.start ?? current;
      writes.push(tab.value);
    } else if (index > i) {
      writes.push(tab.initial);
    } else {
      writes.push(tab.disabled);
    }
  });
  return { tabbed: { tabs, active: index }, writes };
}

/** Sets the active tab's value; returns the write for the active tab only. */
export function setTabValue(tabbed: TabbedValue, value: number): { tabbed: TabbedValue; index: number; value: number } {
  const tabs = tabbed.tabs.map((tab, i) => (i === tabbed.active ? { ...tab, value } : tab));
  return { tabbed: { tabs, active: tabbed.active }, index: tabbed.active, value };
}

/** After switching presets, the first tab reflects the new preset's value. */
export function replaceFirstTab(tabbed: TabbedValue, presetValue: number): TabbedValue {
  const tabs = [makeTab(presetValue, presetValue, null), ...tabbed.tabs.slice(1)];
  return { tabs, active: tabbed.active };
}
