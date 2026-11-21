// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// Backup, restore and sync-log strings Hayaki adds. Anki's own words come
// from `tr("profiles-…")`, `tr("qt-misc-…")` and `tr("sync-…")`.
import { makeStrings } from "@/lib/i18n";

export const tl = makeStrings({
  en: {
    backupsTitle: "Restore from a backup",
    backupsHint: "Backups of this profile, newest first. Restoring one replaces the collection; the current one is backed up first.",
    noBackups: "No backups yet. Hayaki makes one when the profile closes and every so often while you study.",
    loadError: "The backups could not be listed.",
    retry: "Try again",
    restore: "Restore",
    restoring: "Restoring the backup…",
    restoreFailed: "The backup could not be restored.",
    noLog: "No media sync has run since the profile opened.",
  },
  zh: {
    backupsTitle: "从备份恢复",
    backupsHint: "此配置文件的备份，最新的在前。恢复会替换当前集合，替换前会先备份当前集合。",
    noBackups: "还没有备份。关闭配置文件时以及学习期间，Hayaki 会定期自动备份。",
    loadError: "无法列出备份。",
    retry: "重试",
    restore: "恢复",
    restoring: "正在恢复备份…",
    restoreFailed: "无法恢复这个备份。",
    noLog: "打开配置文件以来还没有同步过媒体。",
  },
  ja: {
    backupsTitle: "バックアップから復元",
    backupsHint: "このプロファイルのバックアップです（新しい順）。復元するとコレクションが置き換わります。置き換える前に現在のコレクションをバックアップします。",
    noBackups: "バックアップはまだありません。プロファイルを閉じるときと、学習中に定期的に自動で作成されます。",
    loadError: "バックアップを一覧できませんでした。",
    retry: "再試行",
    restore: "復元",
    restoring: "バックアップを復元しています…",
    restoreFailed: "バックアップを復元できませんでした。",
    noLog: "プロファイルを開いてからメディアの同期はまだ行われていません。",
  },
});
