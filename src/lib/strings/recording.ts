// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// Strings the audio recorder adds to Anki's. Anki's own words come from `tr`.

import { makeStrings } from "@/lib/i18n";

export const trec = makeStrings({
  en: {
    level: "Input level",
    starting: "Starting the microphone",
    denied: "Hayaki is not allowed to use the microphone. Allow it in Windows Settings under Privacy & security > Microphone, then try again.",
    missing: "No microphone was found. Connect one and try again.",
    busy: "The microphone is in use by another program. Close it and try again.",
    unsupported: "Recording audio is not available on this system.",
    saveFailed: "The recording could not be saved.",
    saving: "Saving the recording",
  },
  zh: {
    level: "输入音量",
    starting: "正在启动麦克风",
    denied: "Hayaki 无权使用麦克风。请在 Windows 设置的“隐私和安全性 > 麦克风”中允许，然后重试。",
    missing: "未找到麦克风。请连接麦克风后重试。",
    busy: "麦克风正被其他程序使用。请关闭该程序后重试。",
    unsupported: "此系统无法录制音频。",
    saveFailed: "无法保存录音。",
    saving: "正在保存录音",
  },
  ja: {
    level: "入力レベル",
    starting: "マイクを起動しています",
    denied: "Hayaki にマイクの使用が許可されていません。Windows の設定の「プライバシーとセキュリティ > マイク」で許可してから、もう一度お試しください。",
    missing: "マイクが見つかりません。接続してからもう一度お試しください。",
    busy: "マイクは別のプログラムで使用中です。そのプログラムを閉じてからもう一度お試しください。",
    unsupported: "このシステムでは音声を録音できません。",
    saveFailed: "録音を保存できませんでした。",
    saving: "録音を保存しています",
  },
});
