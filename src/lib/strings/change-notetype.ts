// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// Change Note Type strings Hayaki adds. Headings, column names and warnings
// use Anki's own words (`tr("change-notetype-…")`).
import { makeStrings } from "@/lib/i18n";

export const tcn = makeStrings({
  en: {
    loadFailed: "Change Note Type could not be loaded.",
    noNotes: "Select some Notes first.",
    target: "New Note Type",
    noChanges: "Nothing has changed, so there is nothing to save.",
    confirmLead: "{count} Notes will change from {old} to {new}.",
    applying: "Changing Note Type",
    mapTo: "Take {new} from",
  },
  zh: {
    loadFailed: "无法加载更改笔记模板。",
    noNotes: "请先选择一些笔记。",
    target: "新的笔记模板",
    noChanges: "没有任何更改，无需保存。",
    confirmLead: "{count} 条笔记将从 {old} 更改为 {new}。",
    applying: "正在更改笔记模板",
    mapTo: "{new} 的来源",
  },
  ja: {
    loadFailed: "ノートタイプの変更を読み込めませんでした。",
    noNotes: "先にノートを選んでください。",
    target: "新しいノートタイプ",
    noChanges: "変更がないため、保存するものはありません。",
    confirmLead: "{count} 件のノートが {old} から {new} に変わります。",
    applying: "ノートタイプを変更しています",
    mapTo: "{new} の取得元",
  },
});
