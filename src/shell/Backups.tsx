// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Backups of the open profile: the list to restore from, Anki's Open Backup…
 * and Create Backup. Restoring replaces the collection through the core's
 * colpkg import after backing up the current collection
 * (`src-tauri/src/lifecycle.rs`). As in Anki, syncing and backups stay off
 * afterwards until the profile closes.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Archive, FolderOpen } from "lucide-react";
import { toast } from "sonner";

import { confirm } from "@/components/confirm";
import { Button, Spinner } from "@/components/ui";
import { languages, tr, trLabel } from "@/lib/i18n";
import { backupDate, beforeProfileClose, formatSize, type BackupEntry } from "@/lib/lifecycle";
import { resetQueries } from "@/lib/queries";
import { useApp } from "@/lib/session-store";
import { tl } from "@/lib/strings/lifecycle";
import { useSync } from "@/lib/sync";

const KEY = ["backups"] as const;

const listBackups = () => invoke<BackupEntry[]>("backups_list");

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Replaces the collection with the backup at `path`, after the person confirms. */
export async function restoreBackup(path: string): Promise<void> {
  const ok = await confirm({
    title: tr("qt-misc-revert-to-backup"),
    message: tr("qt-misc-replace-your-collection-with-an-earlier2", { val: baseName(path) }),
    confirm: tr("qt-misc-revert-to-backup"),
    danger: true,
  });
  if (!ok) return;
  // Anki closes the profile first, which syncs on close.
  await beforeProfileClose();
  const id = toast.loading(tl("restoring"));
  try {
    await invoke("backup_restore", { path });
    useSync.setState({ restored: true });
    toast.success(tr("qt-misc-automatic-syncing-and-backups-have-been"), { id, duration: 10_000 });
  } catch (error) {
    toast.error(tl("restoreFailed"), { id, description: errorText(error) });
  } finally {
    resetQueries();
  }
}

/** Anki's Open Backup…: any `.colpkg`, starting in the profile's backup folder. */
export async function openBackup(): Promise<void> {
  const file = await open({
    title: tr("qt-misc-revert-to-backup"),
    multiple: false,
    directory: false,
    defaultPath: useApp.getState().profile?.backupFolder,
    filters: [{ name: "Anki", extensions: ["colpkg"] }],
  });
  if (!file || Array.isArray(file)) return;
  await restoreBackup(file);
}

/** Anki's Create Backup: now, unless nothing changed since the last one. */
export async function createBackupNow(): Promise<void> {
  const id = toast.loading(tr("profiles-creating-backup"));
  try {
    const created = await invoke<boolean>("collection_backup");
    toast.success(created ? tr("profiles-backup-created") : tr("profiles-backup-unchanged"), { id });
  } catch (error) {
    toast.error(tr("profiles-backup-creation-failed", { reason: errorText(error) }), { id });
  }
}

function useDateFormat() {
  return new Intl.DateTimeFormat(languages(), { dateStyle: "medium", timeStyle: "short" });
}

/** The backups of the open profile, newest first, each with Restore. */
export function BackupsSection() {
  const client = useQueryClient();
  const { data, isPending, isError, refetch } = useQuery({ queryKey: KEY, queryFn: listBackups, refetchOnMount: "always" });
  const restored = useSync((s) => s.restored);
  const dates = useDateFormat();

  const refresh = () => void client.invalidateQueries({ queryKey: KEY });

  let body;
  if (isPending) {
    body = (
      <div className="grid h-[88px] place-items-center">
        <Spinner />
      </div>
    );
  } else if (isError || !data) {
    body = (
      <div className="flex min-h-[52px] items-center gap-6 px-4 py-2.5">
        <span className="min-w-0 flex-1 text-body text-ink">{tl("loadError")}</span>
        <Button size="sm" onClick={() => void refetch()}>
          {tl("retry")}
        </Button>
      </div>
    );
  } else if (data.length === 0) {
    body = <div className="px-4 py-4 text-control text-ink-3">{tl("noBackups")}</div>;
  } else {
    body = (
      <ul aria-label={tl("backupsTitle")} className="max-h-[320px] divide-y divide-line overflow-y-auto">
        {data.map((backup) => (
          <li key={backup.name} className="flex min-h-[48px] items-center gap-6 px-4 py-2">
            <div className="min-w-0 flex-1">
              <div className="tabular text-body text-ink">{dates.format(backupDate(backup.stamp))}</div>
              <div className="tabular text-caption text-ink-3">{formatSize(backup.size, languages())}</div>
            </div>
            <Button
              size="sm"
              aria-label={`${tl("restore")} ${dates.format(backupDate(backup.stamp))}`}
              onClick={() => void restoreBackup(backup.path).finally(refresh)}
            >
              {tl("restore")}
            </Button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section className="mt-8 first:mt-0">
      <h2 className="mb-2.5 px-1 text-[13px] font-semibold text-ink-2">{tl("backupsTitle")}</h2>
      <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
        <div className="border-b border-line px-4 py-3 text-[12.5px] leading-relaxed text-ink-2">
          {restored ? tr("qt-misc-automatic-syncing-and-backups-have-been") : tl("backupsHint")}
        </div>
        {body}
        <div className="flex gap-2 border-t border-line px-4 py-2.5">
          <Button size="sm" variant="ghost" onClick={() => void createBackupNow().finally(refresh)}>
            <Archive />
            {trLabel("qt-accel-create-backup")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void openBackup().finally(refresh)}>
            <FolderOpen />
            {tr("profiles-open-backup")}
          </Button>
        </div>
      </div>
    </section>
  );
}
