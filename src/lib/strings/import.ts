// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// Import strings Hayaki adds. Option labels and the import log use Anki's
// own words (`tr("importing-…")`).
import { makeStrings } from "@/lib/i18n";

export const ti = makeStrings({
  en: {
    loadError: "This file could not be read.",
    retry: "Try again",
    fromColumn: "From column {column}",
    preview: "First rows of the file",
    noPreview: "The file has no rows.",
    abort: "Stop",
    failed: "The import did not finish.",
    anki: "Anki",
    text: "Text",
    packageTitle: "Import {name}",
  },
  zh: {
    loadError: "无法读取这个文件。",
    retry: "重试",
    fromColumn: "来自列 {column}",
    preview: "文件的前几行",
    noPreview: "文件中没有内容。",
    abort: "停止",
    failed: "导入没有完成。",
    anki: "Anki",
    text: "文本",
    packageTitle: "导入 {name}",
  },
  ja: {
    loadError: "このファイルを読み込めませんでした。",
    retry: "再試行",
    fromColumn: "列から: {column}",
    preview: "ファイルの先頭の行",
    noPreview: "ファイルに行がありません。",
    abort: "中止",
    failed: "読み込みが完了しませんでした。",
    anki: "Anki",
    text: "テキスト",
    packageTitle: "{name} を読み込む",
  },
});
