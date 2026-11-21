// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// Collection preference strings Hayaki adds. Option labels use Anki's own
// words (`tr("preferences-…")`).
import { makeStrings } from "@/lib/i18n";

export const tp = makeStrings({
  en: {
    loadError: "The collection's preferences could not be loaded.",
    saveError: "The change could not be saved.",
    retry: "Try again",
  },
  zh: {
    loadError: "无法载入集合的偏好设置。",
    saveError: "无法保存这项更改。",
    retry: "重试",
  },
  ja: {
    loadError: "コレクションの設定を読み込めませんでした。",
    saveError: "変更を保存できませんでした。",
    retry: "再試行",
  },
});
