// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { ChevronRight, CloudDownload, CloudUpload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button, cn, Dialog, TextField } from "@/components/ui";
import { t, tr } from "@/lib/i18n";
import { useSync, type FullSyncChoice } from "@/lib/sync";

type Required = "either" | "upload" | "download";

/** Sign-in and full-sync dialogs, plus the action that starts a sync. */
export function useSyncAction() {
  const [signingIn, setSigningIn] = useState(false);
  const [fullSync, setFullSync] = useState<Required | null>(null);
  const resolver = useRef<((choice: FullSyncChoice) => void) | null>(null);
  const { account, loaded, load, sync, phase } = useSync();

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

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
    const id = toast.loading(tr("sync-syncing"));
    const result = await sync(askFullSync);
    const state = useSync.getState();
    if (result === "done") toast.success(tr("sync-collection-complete"), { id });
    else if (result === "cancelled") toast.dismiss(id);
    else {
      toast.error(t("sync.failed"), { id, description: state.lastError ?? undefined });
      if (!state.account) setSigningIn(true);
    }
  }, [sync, askFullSync]);

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
