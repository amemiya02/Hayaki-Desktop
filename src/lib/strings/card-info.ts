// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// Card Info strings Hayaki adds. Labels and values use Anki's own words
// (`tr("card-stats-…")`).
import { makeStrings } from "@/lib/i18n";

export const tci = makeStrings({
  en: {
    loadFailed: "Card Info could not be loaded.",
    noReviews: "This Card has not been reviewed yet.",
    reviewLog: "Review history",
    timeRange: "Time range",
    curveLead: "The predicted chance that you recall this Card, from its first review to its next.",
    curveKeys: "Use the arrow keys to move along the curve.",
    today: "Today",
    copyId: "Copy",
    copied: "Copied",
  },
  zh: {
    loadFailed: "无法加载卡片信息。",
    noReviews: "这张卡片还没有复习过。",
    reviewLog: "复习记录",
    timeRange: "时间范围",
    curveLead: "从首次复习到下次复习，你记得这张卡片的预测概率。",
    curveKeys: "使用方向键沿曲线移动。",
    today: "今天",
    copyId: "复制",
    copied: "已复制",
  },
  ja: {
    loadFailed: "カード情報を読み込めませんでした。",
    noReviews: "このカードはまだ復習していません。",
    reviewLog: "復習の履歴",
    timeRange: "期間",
    curveLead: "最初の復習から次の復習まで、このカードを思い出せる予測確率です。",
    curveKeys: "矢印キーで曲線に沿って移動します。",
    today: "今日",
    copyId: "コピー",
    copied: "コピーしました",
  },
});
