// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, ChevronRight, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { SettingsRow, SettingsSection } from "@/components/settings";
import { Button, cn, Dialog, Segmented, TextField } from "@/components/ui";
import { firstLanguage, t, tr } from "@/lib/i18n";
import { usePrefs } from "@/lib/prefs";
import { createProfile } from "@/lib/profiles";
import { useApp } from "@/lib/session-store";
import { useNav } from "@/lib/nav";
import { themeColors, themeNames, themeOrder, type Appearance, type ThemeId } from "@/lib/themes";
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

export function SettingsScreen() {
  const prefs = usePrefs();
  const resolved = useResolvedAppearance();
  const { info, profiles, profile, open, refreshProfiles } = useApp();
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
            <div role="radiogroup" aria-label={t("settings.theme")} className="grid grid-cols-5 gap-2.5">
              {themeOrder.map((id) => {
                // Each swatch previews another Theme, so it reads that Theme's literal colours.
                const { accent, canvas, onAccent } = themeColors(id, resolved);
                const selected = prefs.theme === id;
                return (
                  <button
                    key={id}
                    role="radio"
                    aria-checked={selected}
                    onClick={() => prefs.setTheme(id)}
                    className={cn(
                      "group flex flex-col items-center gap-2 rounded-[10px] p-2 transition-colors duration-[var(--dur-fast)]",
                      "hover:bg-surface-2",
                    )}
                  >
                    <span
                      className={cn("relative grid h-12 w-full place-items-center overflow-hidden rounded-[8px] border", selected ? "border-transparent ring-2 ring-accent ring-offset-2 ring-offset-surface" : "border-line")}
                      style={{ background: canvas }}
                    >
                      <span className="size-5 rounded-full" style={{ background: accent }} />
                      {selected && (
                        <span className="absolute right-1.5 top-1.5 grid size-4 place-items-center rounded-full" style={{ background: accent }}>
                          <Check className="size-3" style={{ color: onAccent }} strokeWidth={3} />
                        </span>
                      )}
                    </span>
                    <span className={cn("text-caption", selected ? "font-semibold text-accent-ink" : "text-ink-2")}>{themeLabel(id)}</span>
                  </button>
                );
              })}
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
        </SettingsSection>

        <SettingsSection title={t("settings.profiles")}>
          {profiles.map((p) => (
            <SettingsRow key={p.id} label={p.name} hint={p.id === profile?.id ? t("settings.profileOpen") : undefined}>
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
          <SettingsRow label={t("settings.dataFolder")}>
            <span className="selectable max-w-[340px] truncate text-caption text-ink-3" title={info?.dataDir}>
              {info?.dataDir}
            </span>
          </SettingsRow>
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
