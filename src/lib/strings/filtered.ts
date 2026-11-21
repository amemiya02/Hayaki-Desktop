// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// Filtered Deck and Custom Study strings Hayaki adds. Option labels use
// Anki's own words (`tr("decks-…")`, `tr("custom-study-…")`).
import { makeStrings } from "@/lib/i18n";

export const tf = makeStrings({
  en: {
    loadError: "This filtered Deck could not be opened.",
    customLoadError: "Custom Study could not be opened for this Deck.",
    retry: "Try again",
    limit: "Number of Cards",
    order: "Order",
    cardState: "Cards",
    noTags: "The Cards in this Deck have no tags.",
    tagsHint: "Leave a list empty to not limit by it.",
    filterTags: "Filter tags",
  },
  zh: {
    loadError: "无法打开这个筛选牌组。",
    customLoadError: "无法为这个牌组打开自定义学习。",
    retry: "重试",
    limit: "卡片数量",
    order: "顺序",
    cardState: "卡片",
    noTags: "这个牌组里的卡片没有标签。",
    tagsHint: "列表留空即不按它筛选。",
    filterTags: "筛选标签",
  },
  ja: {
    loadError: "このフィルターデッキを開けませんでした。",
    customLoadError: "このデッキのカスタム学習を開けませんでした。",
    retry: "再試行",
    limit: "カード数",
    order: "順序",
    cardState: "カード",
    noTags: "このデッキのカードにはタグがありません。",
    tagsHint: "リストを空にすると、その条件では絞り込みません。",
    filterTags: "タグを絞り込む",
  },
});
