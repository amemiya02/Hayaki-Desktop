// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { expect, test } from "vitest";

import { activateTab, initTabs, lastSetTab, makeTab, replaceFirstTab, setTabValue, shownValue } from "./tabs";

const tabs = () => [makeTab(20, 20, null), makeTab(null, null, null), makeTab(null, null, 5)];

test("last set tab is active", () => {
  expect(lastSetTab(tabs())).toBe(0);
  expect(lastSetTab([makeTab(20, 20, null), makeTab(8, null, null), makeTab(null, null, null)])).toBe(1);
});

test("initial activation writes every tab", () => {
  const { tabbed, writes } = initTabs(tabs());
  expect(tabbed.active).toBe(0);
  expect(writes).toEqual([20, null, null]);
});

test("activating carries the shown value or the start value", () => {
  const start = initTabs(tabs()).tabbed;
  const deck = activateTab(start, 1);
  expect(deck.writes).toEqual([20, 20, null]);
  expect(shownValue(deck.tabbed)).toBe(20);
  const today = activateTab(deck.tabbed, 2);
  expect(today.writes).toEqual([20, null, 5]);
  expect(shownValue(today.tabbed)).toBe(5);
});

test("set value and preset refresh", () => {
  const start = initTabs(tabs()).tabbed;
  const set = setTabValue(start, 30);
  expect(set).toMatchObject({ index: 0, value: 30 });
  expect(shownValue(set.tabbed)).toBe(30);
  expect(shownValue(replaceFirstTab(set.tabbed, 12))).toBe(12);
});
