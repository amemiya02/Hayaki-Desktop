// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// Strings the reviewer adds to Anki's. Anki's own words come from `tr`.

import { makeStrings } from "@/lib/i18n";

export const tstudy = makeStrings({
  en: {
    timer: "Time on this Card",
    autoAdvanceOn: "Auto Advance is on. Select to turn it off.",
  },
  zh: {
    timer: "本卡片用时",
    autoAdvanceOn: "自动前进已开启。点按可关闭。",
  },
  ja: {
    timer: "このカードの所要時間",
    autoAdvanceOn: "自動進行がオンです。選択するとオフになります。",
  },
});
