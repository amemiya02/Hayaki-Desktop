// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// Strings for the RWKV scheduling section of Settings.
import { makeStrings } from "@/lib/i18n";

export const trw = makeStrings({
  en: {
    title: "RWKV scheduling",
    enable: "Schedule reviews with RWKV",
    enableHint:
      "Review Cards come due when an RWKV model predicts that your chance of recalling them has fallen to the Deck's desired retention. New and learning Cards, and every due date Anki stores, are unchanged, so turning this off returns to your usual schedule at once.",
    syncHint:
      "The switch syncs with your collection. If another device changes any preference later and syncs first, it can turn the switch back.",
    weightsHint: "Turning it on downloads the model (about 430 KB). Its author allows personal and research use.",
    off: "Off",
    notPrepared: "Waiting to start",
    preparing: "Reading your review history: {done} of {total}",
    preparingStart: "Downloading the model",
    ready: "Ready. Review Cards are chosen by RWKV.",
    failed: "RWKV could not start: {message}. Reviews use your usual schedule.",
    retry: "Try again",
    loadError: "The RWKV status could not be loaded.",
    saveError: "RWKV scheduling could not be changed.",
  },
  zh: {
    title: "RWKV 排程",
    enable: "用 RWKV 安排复习",
    enableHint:
      "RWKV 模型预测你记住某张复习卡的概率降到牌组的目标保留率时，这张卡就到期。新卡、学习中的卡，以及 Anki 存下的所有到期日都不变，所以关掉后会立刻回到平常的排程。",
    syncHint: "这个开关随集合同步。如果另一台设备之后改了任何偏好设置并先同步，可能会把开关改回去。",
    weightsHint: "打开后会下载模型（约 430 KB）。作者允许个人和研究使用。",
    off: "已关闭",
    notPrepared: "等待开始",
    preparing: "正在读取复习记录：{done} / {total}",
    preparingStart: "正在下载模型",
    ready: "已就绪，复习卡由 RWKV 选择。",
    failed: "RWKV 无法启动：{message}。复习使用平常的排程。",
    retry: "重试",
    loadError: "无法读取 RWKV 状态。",
    saveError: "无法更改 RWKV 排程。",
  },
  ja: {
    title: "RWKV スケジュール",
    enable: "RWKV で復習を組む",
    enableHint:
      "RWKV モデルが予測する想起確率がデッキの目標保持率まで下がると、その復習カードが期日になります。新規カード・学習中のカードと、Anki が保存する期日はすべて変わらないため、オフにするとすぐに通常のスケジュールに戻ります。",
    syncHint: "このスイッチはコレクションと同期します。別の端末が後で設定を変更して先に同期すると、スイッチが戻ることがあります。",
    weightsHint: "オンにするとモデル（約 430 KB）をダウンロードします。作者は個人利用と研究利用を認めています。",
    off: "オフ",
    notPrepared: "開始待ち",
    preparing: "復習履歴を読み込み中：{done} / {total}",
    preparingStart: "モデルをダウンロード中",
    ready: "準備完了。復習カードは RWKV が選びます。",
    failed: "RWKV を開始できません：{message}。復習は通常のスケジュールです。",
    retry: "再試行",
    loadError: "RWKV の状態を読み込めません。",
    saveError: "RWKV スケジュールを変更できません。",
  },
});
