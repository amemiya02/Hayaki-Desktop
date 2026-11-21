// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { Check, ChevronRight, ImagePlus, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Avatar, chooseAvatar } from "@/components/Avatar";
import { confirm } from "@/components/confirm";
import { SettingsRow, SettingsSection } from "@/components/settings";
import { Button, cn, Dialog, Segmented, Spinner, Switch, TextField } from "@/components/ui";
import { firstLanguage, t, tr } from "@/lib/i18n";
import { usePrefs } from "@/lib/prefs";
import { beforeProfileClose } from "@/lib/lifecycle";
import { checkDataFolder, createProfile, dataFolder, setDataFolder, type DataFolder } from "@/lib/profiles";
import { useApp } from "@/lib/session-store";
import { useNav } from "@/lib/nav";
import type { HayakiKey } from "@/lib/strings";
import { downloadShare, useUpdates } from "@/lib/updates";
import { tp } from "@/lib/strings/plugins";
import { themeColors, themeNames, themeOrder, type Appearance, type ResolvedAppearance, type ThemeId } from "@/lib/themes";
import { useResolvedAppearance } from "@/lib/useAppearance";
import { AnkiPreferencesSections } from "@/screens/preferences";
import { BackupsSection } from "@/shell/Backups";
import { SyncPreferencesSection } from "@/shell/Sync";
import { AnkiConnectSection } from "@/screens/preferences/AnkiConnectSection";
import { displayChord } from "@/shell/shortcuts";
import { WindowSettings } from "@/shell/WindowSettings";

function themeLabel(id: ThemeId): string {
  const lang = firstLanguage().toLowerCase();
  const names = themeNames[id];
  return lang.startsWith("zh") ? names.zh : lang.startsWith("ja") ? names.ja : names.en;
}

/** A small mock of the app window in another Theme's literal colours. */
function ThemePreview({ id, selected, resolved, onSelect }: { id: ThemeId; selected: boolean; resolved: ResolvedAppearance; onSelect: () => void }) {
  const { accent, canvas, ink, onAccent } = themeColors(id, resolved);
  const mix = (color: string, pct: number) => `color-mix(in oklab, ${color} ${pct}%, ${canvas})`;
  return (
    <button type="button" role="radio" aria-checked={selected} onClick={onSelect} className="group flex flex-col gap-2 text-start outline-none">
      <span
        className={cn(
          "relative flex aspect-[8/5] w-full overflow-hidden rounded-[10px] border transition-[transform,box-shadow] duration-[var(--dur-fast)]",
          "group-hover:-translate-y-0.5 group-hover:shadow-[0_8px_18px_-10px_rgb(0_0_0/0.45)]",
          "group-focus-visible:outline group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-accent",
          selected ? "border-transparent" : "border-line",
        )}
        style={{ background: canvas, boxShadow: selected ? `0 0 0 2px ${accent}` : undefined }}
      >
        {/* The sidebar, with the current Deck picked out. */}
        <span className="flex w-[30%] flex-col gap-[5px] px-[7%] pt-[14%]" style={{ background: mix(accent, 10) }}>
          <span className="h-[5px] w-full rounded-full" style={{ background: mix(accent, 75) }} />
          <span className="h-1 w-4/5 rounded-full" style={{ background: mix(ink, 22) }} />
          <span className="h-1 w-3/5 rounded-full" style={{ background: mix(ink, 22) }} />
        </span>
        {/* A card and its answer button. */}
        <span className="flex flex-1 flex-col gap-[5px] px-[10%] pt-[14%]">
          <span className="h-1.5 w-3/5 rounded-full" style={{ background: mix(ink, 78) }} />
          <span className="h-1 w-full rounded-full" style={{ background: mix(ink, 18) }} />
          <span className="h-1 w-4/5 rounded-full" style={{ background: mix(ink, 18) }} />
          <span className="mb-[14%] mt-auto h-[11px] w-1/2 self-end rounded-full" style={{ background: accent }} />
        </span>
        {selected && (
          <span className="absolute bottom-1.5 start-1.5 grid size-[18px] place-items-center rounded-full shadow-sm" style={{ background: accent }}>
            <Check className="size-3" style={{ color: onAccent }} strokeWidth={3} />
          </span>
        )}
      </span>
      <span className="flex min-w-0 items-center gap-1.5 px-0.5">
        <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: accent }} />
        <span className={cn("truncate text-caption", selected ? "font-semibold text-ink" : "text-ink-2")}>{themeLabel(id)}</span>
      </span>
    </button>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function UpdateRows() {
  const { status, check, download, install } = useUpdates();
  const autoCheck = usePrefs((s) => s.autoCheckUpdates);
  const setPref = usePrefs((s) => s.set);
  const [notesOpen, setNotesOpen] = useState(false);
  const update = "update" in status ? status.update : undefined;

  const run = (action: () => Promise<unknown>, failed: HayakiKey) => () =>
    void action().catch((error) => toast.error(t(failed), { description: errorMessage(error) }));

  const share = status.kind === "downloading" ? downloadShare(status.downloaded, status.total) : null;
  const percent = share === null ? "" : new Intl.NumberFormat(undefined, { style: "percent" }).format(share);

  let hint: string;
  switch (status.kind) {
    case "checking":
      hint = t("settings.updatesChecking");
      break;
    case "latest":
      hint = t("settings.updatesLatest");
      break;
    case "available":
      hint = t("settings.updatesAvailable", { version: status.update.version });
      break;
    case "downloading":
      hint = t("settings.updatesDownloading", { percent });
      break;
    case "ready":
      hint = t("settings.updatesReady");
      break;
    case "installing":
      hint = t("settings.updatesInstalling");
      break;
    case "error":
      hint = status.update ? t("settings.updatesFailed") : t("settings.updatesCheckFailed");
      break;
    default:
      hint = t("settings.updatesHint");
  }

  let action;
  switch (status.kind) {
    case "available":
      action = (
        <Button size="sm" variant="primary" onClick={run(download, "settings.updatesFailed")}>
          {t("settings.updatesDownload")}
        </Button>
      );
      break;
    case "error":
      action = status.update ? (
        <Button size="sm" variant="primary" onClick={run(download, "settings.updatesFailed")}>
          {t("common.retry")}
        </Button>
      ) : (
        <Button size="sm" onClick={run(check, "settings.updatesCheckFailed")}>
          {t("settings.updatesCheck")}
        </Button>
      );
      break;
    case "downloading":
      action = (
        <span className="h-1.5 w-28 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={share === null ? undefined : Math.round(share * 100)}>
          <span
            className={cn("block h-full rounded-full bg-accent transition-[width] duration-[var(--dur-fast)]", share === null && "w-1/3 animate-pulse")}
            style={share === null ? undefined : { width: `${share * 100}%` }}
          />
        </span>
      );
      break;
    case "ready":
      action = (
        <Button size="sm" variant="primary" onClick={run(install, "settings.updatesFailed")}>
          {t("settings.updatesRestart")}
        </Button>
      );
      break;
    case "installing":
    case "checking":
      action = <Spinner />;
      break;
    default:
      action = (
        <Button size="sm" onClick={run(check, "settings.updatesCheckFailed")}>
          {t("settings.updatesCheck")}
        </Button>
      );
  }

  return (
    <>
      <SettingsRow label={t("settings.updates")} hint={<span aria-live="polite">{hint}</span>}>
        <div className="flex shrink-0 items-center gap-1.5">
          {update?.notes && (
            <Button size="sm" variant="ghost" aria-expanded={notesOpen} onClick={() => setNotesOpen((o) => !o)}>
              {t("settings.updatesNotes")}
              <ChevronRight className={cn("transition-transform duration-[var(--dur-fast)]", notesOpen && "rotate-90")} />
            </Button>
          )}
          {action}
        </div>
      </SettingsRow>
      {notesOpen && update?.notes && (
        <div className="selectable max-h-60 overflow-y-auto whitespace-pre-wrap px-4 py-3 text-caption leading-relaxed text-ink-2">{update.notes}</div>
      )}
      <SettingsRow label={t("settings.updatesAuto")}>
        <Switch label={t("settings.updatesAuto")} checked={autoCheck} onChange={(v) => setPref("autoCheckUpdates", v)} />
      </SettingsRow>
    </>
  );
}

function DataFolderRow() {
  const [folder, setFolder] = useState<DataFolder | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void dataFolder().then(setFolder, () => setFolder(null));
  }, []);

  /** `path` null is the default folder. */
  const switchTo = async (path: string | null) => {
    const kind = await checkDataFolder(path);
    if (kind === "current") return;
    if (kind === "occupied" || kind === "nested") {
      toast.error(t(kind === "occupied" ? "settings.dataFolderOccupied" : "settings.dataFolderNested"));
      return;
    }
    const copying = kind === "empty";
    const ok = await confirm({
      title: t(copying ? "settings.dataFolderCopyTitle" : "settings.dataFolderUseTitle"),
      message: t(copying ? "settings.dataFolderCopyMessage" : "settings.dataFolderUseMessage", { path: path ?? folder?.defaultPath ?? "" }),
      confirm: t("settings.dataFolderConfirm"),
    });
    if (!ok) return;
    setBusy(true);
    const id = toast.loading(t("settings.dataFolderMoving"));
    try {
      // Syncs on close first, as switching profiles does.
      await beforeProfileClose();
      // The app restarts once this returns.
      await setDataFolder(path);
    } catch (error) {
      toast.error(t("settings.dataFolderFailed"), { id, description: error instanceof Error ? error.message : String(error) });
      setBusy(false);
    }
  };

  const change = async () => {
    const path = await openDialog({ directory: true, multiple: false, defaultPath: folder?.path });
    if (typeof path === "string") await switchTo(path);
  };

  return (
    <SettingsRow
      label={t("settings.dataFolder")}
      hint={
        <span className="selectable block truncate" title={folder?.path}>
          {folder?.path ?? t("settings.dataFolderHint")}
        </span>
      }
    >
      <div className="flex shrink-0 items-center gap-1.5">
        {folder && !folder.isDefault && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void switchTo(null)}>
            {t("settings.dataFolderReset")}
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={!folder} onClick={() => folder && void revealItemInDir(folder.path)}>
          {t("settings.dataFolderShow")}
        </Button>
        <Button size="sm" disabled={busy || !folder} onClick={() => void change()}>
          {t("settings.dataFolderChange")}
        </Button>
      </div>
    </SettingsRow>
  );
}

export function SettingsScreen() {
  const prefs = usePrefs();
  const resolved = useResolvedAppearance();
  const { info, profiles, profile, open, refreshProfiles, setAvatar } = useApp();

  const changeAvatar = async (id: string) => {
    try {
      const avatar = await chooseAvatar();
      if (avatar) await setAvatar(id, avatar);
    } catch (error) {
      toast.error(t("profile.avatarFailed"), { description: error instanceof Error ? error.message : String(error) });
    }
  };
  const go = useNav((s) => s.go);
  const [newProfile, setNewProfile] = useState<string | null>(null);

  const appearanceOptions: { value: Appearance; label: string }[] = [
    { value: "system", label: t("settings.system") },
    { value: "light", label: t("settings.light") },
    { value: "dark", label: t("settings.dark") },
    { value: "black", label: t("settings.black") },
  ];

  const addProfile = async () => {
    if (!newProfile?.trim()) return;
    try {
      const meta = await createProfile(newProfile.trim());
      setNewProfile(null);
      await refreshProfiles();
      await open(meta.id);
    } catch (error) {
      toast.error(String(error) === "name-exists" ? t("settings.profileExists") : String(error));
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[720px] px-8 pb-16 pt-8">
        <SettingsSection title={t("settings.appearance")}>
          <SettingsRow label={t("settings.mode")} hint={t("settings.appearanceHint")}>
            <Segmented label={t("settings.appearance")} value={prefs.appearance} options={appearanceOptions} onChange={prefs.setAppearance} />
          </SettingsRow>
          <div className="px-4 py-4">
            <div className="mb-3 text-body text-ink">{t("settings.theme")}</div>
            <div role="radiogroup" aria-label={t("settings.theme")} className="grid grid-cols-5 gap-x-3 gap-y-4">
              {/* Each preview shows another Theme, so it reads that Theme's literal colours. */}
              {themeOrder.map((id) => (
                <ThemePreview key={id} id={id} resolved={resolved} selected={prefs.theme === id} onSelect={() => prefs.setTheme(id)} />
              ))}
            </div>
          </div>
        </SettingsSection>

        <WindowSettings />

        <AnkiPreferencesSections />
        <BackupsSection />
        <SyncPreferencesSection />
        <AnkiConnectSection />

        <SettingsSection title={t("settings.collection")}>
          <button
            type="button"
            onClick={() => go({ name: "notetypes" })}
            className="flex min-h-[52px] w-full items-center gap-6 px-4 py-2.5 text-start transition-colors duration-[var(--dur-fast)] hover:bg-surface-2 focus-visible:bg-accent-softer"
          >
            <span className="min-w-0 flex-1 text-body text-ink">{tr("qt-misc-manage-note-types")}</span>
            <span className="tabular text-caption text-ink-3">{displayChord("Ctrl+Shift+N")}</span>
            <ChevronRight className="size-4 text-ink-3 rtl:rotate-180" />
          </button>
          <button
            type="button"
            onClick={() => go({ name: "plugins" })}
            className="flex min-h-[52px] w-full items-center gap-6 px-4 py-2.5 text-start transition-colors duration-[var(--dur-fast)] hover:bg-surface-2 focus-visible:bg-accent-softer"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-body text-ink">{tp("title")}</span>
              <span className="mt-0.5 block text-caption text-ink-3">{tp("manageHint")}</span>
            </span>
            <ChevronRight className="size-4 text-ink-3 rtl:rotate-180" />
          </button>
        </SettingsSection>

        <SettingsSection title={t("settings.profiles")}>
          {profiles.map((p) => (
            <SettingsRow
              key={p.id}
              label={
                <span className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void changeAvatar(p.id)}
                    aria-label={`${t("profile.setAvatar")} ${p.name}`}
                    title={t("profile.setAvatar")}
                    className="group/avatar relative shrink-0 rounded-full outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    <Avatar name={p.name} src={p.avatar} />
                    <span className="absolute inset-0 grid place-items-center rounded-full bg-black/45 text-white opacity-0 transition-opacity duration-[var(--dur-fast)] group-hover/avatar:opacity-100">
                      <ImagePlus className="size-3.5" />
                    </span>
                  </button>
                  <span className="min-w-0">
                    <span className="block truncate">{p.name}</span>
                    {p.id === profile?.id && <span className="block text-caption text-ink-3">{t("settings.profileOpen")}</span>}
                  </span>
                </span>
              }
            >
              {p.avatar && (
                <Button size="sm" variant="ghost" onClick={() => void setAvatar(p.id, null)}>
                  {t("profile.removeAvatar")}
                </Button>
              )}
              {p.id === profile?.id ? (
                <Check className="size-4 text-accent-ink" />
              ) : (
                <Button size="sm" onClick={() => void open(p.id)}>
                  {t("settings.switch")}
                </Button>
              )}
            </SettingsRow>
          ))}
          <div className="px-4 py-2.5">
            <Button variant="ghost" size="sm" onClick={() => setNewProfile("")}>
              <Plus />
              {t("profile.new")}
            </Button>
          </div>
        </SettingsSection>

        <SettingsSection title={t("settings.about")}>
          <SettingsRow label="Hayaki" hint={t("settings.aboutHint")}>
            <span className="tabular text-control text-ink-2">{info?.version}</span>
          </SettingsRow>
          <SettingsRow label={t("settings.engine")}>
            <span className="tabular text-control text-ink-2">Anki {info?.ankiVersion}</span>
          </SettingsRow>
          <UpdateRows />
          <DataFolderRow />
          <SettingsRow label={t("settings.source")} hint="AGPL-3.0-or-later">
            <Button size="sm" onClick={() => void openUrl("https://github.com/amemiya02")}>
              GitHub
            </Button>
          </SettingsRow>
        </SettingsSection>
      </div>

      <Dialog
        open={newProfile !== null}
        onOpenChange={(o) => !o && setNewProfile(null)}
        title={t("profile.new")}
        description={t("settings.profileHint")}
        footer={
          <>
            <Button onClick={() => setNewProfile(null)}>{t("common.cancel")}</Button>
            <Button variant="primary" disabled={!newProfile?.trim()} onClick={() => void addProfile()}>
              {t("profile.new")}
            </Button>
          </>
        }
      >
        <TextField autoFocus value={newProfile ?? ""} onChange={(e) => setNewProfile(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void addProfile()} />
      </Dialog>
    </div>
  );
}
