// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { ChevronRight, CloudDownload, CloudUpload, ScrollText } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { SettingsRow, SettingsSection } from "@/components/settings";
import { Button, cn, Dialog, Spinner, Switch, TextField } from "@/components/ui";
import { i18nLoaded, languages, t, tr } from "@/lib/i18n";
import { canAutoSync, onProfileClose } from "@/lib/lifecycle";
import { useApp } from "@/lib/session-store";
import { tl } from "@/lib/strings/lifecycle";
import { useSync, type FullSyncChoice } from "@/lib/sync";

import { syncToast } from "./sync-pill";

/** As Anki's `can_auto_sync`, from the store's current state. */
function autoSyncDue(): boolean {
  const s = useSync.getState();
  return canAutoSync({ signedIn: !!s.account, autoSync: s.prefs.autoSync, restored: s.restored });
}

type Required = "either" | "upload" | "download";

/** Sign-in and full-sync dialogs, plus the action that starts a sync. */
export function useSyncAction() {
  const [signingIn, setSigningIn] = useState(false);
  const [fullSync, setFullSync] = useState<Required | null>(null);
  const resolver = useRef<((choice: FullSyncChoice) => void) | null>(null);
  const { account, load, sync, phase } = useSync();
  const profileId = useApp((s) => s.profile?.id);

  const askFullSync = useCallback(
    (required: Required) =>
      new Promise<FullSyncChoice>((resolve) => {
        resolver.current = resolve;
        setFullSync(required);
      }),
    [],
  );

  const run = useCallback(async () => {
    if (!useSync.getState().account) {
      setSigningIn(true);
      return;
    }
    // Progress lives in the toolbar's SyncIndicator; a toast reports the result.
    await i18nLoaded;
    const result = await sync(askFullSync);
    const state = useSync.getState();
    const outcome = syncToast(result, state.lastError);
    if (outcome) {
      const { level, title, description } = outcome;
      toast[level](title, {
        description,
        action:
          result === "media-failed"
            ? { label: tr("sync-media-log-button"), onClick: () => useSync.getState().showLog(true) }
            : undefined,
      });
    }
    if (result === "error" && !state.account) setSigningIn(true);
  }, [sync, askFullSync]);

  // Each profile has its own account and preferences. As in Anki, a profile
  // that opens syncs at once when syncing on open and close is on.
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    if (!profileId) {
      useSync.getState().unload();
      return;
    }
    let current = true;
    load(profileId)
      .then(() => {
        if (current && autoSyncDue()) void runRef.current();
      })
      .catch((error: unknown) => console.error("loading the sync account", error));
    return () => {
      current = false;
    };
  }, [profileId, load]);

  // And it syncs before the profile closes (switching profiles, restoring a
  // backup, quitting). A media sync still running is abandoned first; the
  // sync on close picks it up again.
  useEffect(
    () =>
      onProfileClose(async () => {
        useSync.getState().abortMedia();
        await useSync.getState().idle();
        if (autoSyncDue()) await runRef.current();
      }),
    [],
  );

  const choose = (choice: FullSyncChoice) => {
    resolver.current?.(choice);
    resolver.current = null;
    setFullSync(null);
  };

  const dialogs = (
    <>
      <SignInDialog
        open={signingIn}
        onClose={() => setSigningIn(false)}
        onSignedIn={() => {
          setSigningIn(false);
          void run();
        }}
      />
      <MediaLogDialog />
      <Dialog
        open={fullSync !== null}
        onOpenChange={(open) => !open && choose("cancel")}
        title={t("sync.fullTitle")}
        description={
          fullSync === "download"
            ? tr("sync-confirm-empty-download")
            : fullSync === "upload"
              ? tr("sync-confirm-empty-upload")
              : t("sync.fullLead")
        }
        width={480}
        footer={
          <>
            <Button onClick={() => choose("cancel")}>{tr("sync-cancel-button")}</Button>
            {fullSync !== "upload" && (
              <Button variant={fullSync === "download" ? "primary" : "secondary"} onClick={() => choose("download")}>
                <CloudDownload />
                {tr("sync-download-from-ankiweb")}
              </Button>
            )}
            {fullSync !== "download" && (
              <Button variant={fullSync === "upload" ? "primary" : "secondary"} onClick={() => choose("upload")}>
                <CloudUpload />
                {tr("sync-upload-to-ankiweb")}
              </Button>
            )}
          </>
        }
      >
        {fullSync === "either" && (
          <ul className="space-y-2 text-control leading-relaxed text-ink-2">
            <li>
              <span className="font-semibold text-ink">{tr("sync-download-from-ankiweb")}</span> · {t("sync.downloadMeans")}
            </li>
            <li>
              <span className="font-semibold text-ink">{tr("sync-upload-to-ankiweb")}</span> · {t("sync.uploadMeans")}
            </li>
          </ul>
        )}
      </Dialog>
    </>
  );

  return { run, dialogs, syncing: phase !== "idle", account };
}

/** Anki's Media Sync Log: the lines of the running or last media sync, with Abort while it runs. */
function MediaLogDialog() {
  const { log, logOpen, phase, showLog, abortMedia } = useSync();
  const list = useRef<HTMLOListElement>(null);
  const time = new Intl.DateTimeFormat(languages(), { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log, logOpen]);

  return (
    <Dialog
      open={logOpen}
      onOpenChange={showLog}
      title={tr("sync-media-log-title")}
      width={520}
      footer={
        <>
          {phase === "media" && <Button onClick={abortMedia}>{tr("sync-abort-button")}</Button>}
          <Button variant="primary" onClick={() => showLog(false)}>
            {t("common.close")}
          </Button>
        </>
      }
    >
      {log.length === 0 ? (
        <p className="py-4 text-control text-ink-3">{tl("noLog")}</p>
      ) : (
        <ol
          ref={list}
          role="log"
          aria-live="polite"
          className="selectable max-h-[46vh] overflow-auto rounded-[8px] border border-line bg-surface-2 p-3 text-caption leading-relaxed text-ink-2"
        >
          {log.map((entry, i) => (
            <li key={i} className="flex gap-3">
              <time className="tabular shrink-0 text-ink-3" dateTime={new Date(entry.at).toISOString()}>
                {time.format(entry.at)}
              </time>
              <span className="min-w-0">{entry.text}</span>
            </li>
          ))}
        </ol>
      )}
    </Dialog>
  );
}

/**
 * Anki's Syncing preferences for the open profile. Anki's "Periodically sync
 * media" is not offered: media syncs with every sync.
 */
export function SyncPreferencesSection() {
  const { prefs, loaded, setPrefs, showLog } = useSync();
  const save = (change: Parameters<typeof setPrefs>[0]) =>
    setPrefs(change).catch((error: unknown) => toast.error(String(error instanceof Error ? error.message : error)));

  return (
    <SettingsSection title={tr("preferences-network")}>
      {!loaded ? (
        <div className="grid h-[104px] place-items-center">
          <Spinner />
        </div>
      ) : (
        <>
          <SettingsRow label={tr("preferences-automatically-sync-on-profile-openclose")}>
            <Switch
              label={tr("preferences-automatically-sync-on-profile-openclose")}
              checked={prefs.autoSync}
              onChange={(v) => void save({ autoSync: v })}
            />
          </SettingsRow>
          <SettingsRow label={tr("preferences-synchronize-audio-and-images-too")}>
            <Switch
              label={tr("preferences-synchronize-audio-and-images-too")}
              checked={prefs.syncMedia}
              onChange={(v) => void save({ syncMedia: v })}
            />
          </SettingsRow>
          <SettingsRow label={tr("sync-media-log-title")}>
            <Button size="sm" onClick={() => showLog(true)}>
              <ScrollText />
              {tr("sync-media-log-button")}
            </Button>
          </SettingsRow>
        </>
      )}
    </SettingsSection>
  );
}

function SignInDialog({ open, onClose, onSignedIn }: { open: boolean; onClose: () => void; onSignedIn: () => void }) {
  const signIn = useSync((s) => s.signIn);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [custom, setCustom] = useState(false);
  const [endpoint, setEndpoint] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!username || !password) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(username.trim(), password, custom && endpoint.trim() ? endpoint.trim() : null);
      setPassword("");
      onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={tr("sync-sign-in")}
      description={t("sync.signInLead")}
      width={420}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={busy || !username || !password} onClick={() => void submit()}>
            {tr("sync-log-in-button")}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="flex flex-col gap-1.5 text-caption font-medium text-ink-2">
          {tr("sync-ankiweb-id-label").replace(/[:：]\s*$/, "")}
          <TextField autoFocus type="email" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5 text-caption font-medium text-ink-2">
          {tr("sync-password-label").replace(/[:：]\s*$/, "")}
          <TextField type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button
          type="button"
          onClick={() => setCustom(!custom)}
          aria-expanded={custom}
          className="flex items-center gap-1 self-start text-caption font-medium text-accent-ink"
        >
          <ChevronRight className={cn("size-3.5 transition-transform duration-[var(--dur)]", custom && "rotate-90")} />
          {t("sync.selfHosted")}
        </button>
        {custom && (
          <label className="flex flex-col gap-1.5 text-caption font-medium text-ink-2">
            {t("sync.serverAddress")}
            <TextField placeholder="https://sync.example.com/" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} />
          </label>
        )}
        {error && <p className="selectable text-caption text-danger">{error}</p>}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
