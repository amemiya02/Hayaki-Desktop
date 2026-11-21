// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Syncing the open profile with AnkiWeb or a self-hosted server, through the
 * core's own sync implementation. The profile keeps one destination; only the
 * key the server issues at sign-in is stored, never the password.
 */
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

import * as core from "./anki/generated/core";
import { tr } from "./i18n";
import { appendLog, type LogEntry } from "./lifecycle";
import { BackendError_Kind } from "./anki/proto/anki/backend_pb";
import { CoreError } from "./anki/transport";
import { SyncCollectionResponse_ChangesRequired } from "./anki/proto/anki/sync_pb";
import { resetQueries } from "./queries";

export interface SyncAccount {
  hkey: string;
  username: string;
  endpoint: string | null;
  currentEndpoint: string | null;
}

/** Per profile, as Anki keeps them in its profile (`src-tauri/src/profiles.rs`). */
export interface SyncPrefs {
  /** Sync when the profile opens and closes. */
  autoSync: boolean;
  /** Sync audio and images too. */
  syncMedia: boolean;
}

const DEFAULT_PREFS: SyncPrefs = { autoSync: true, syncMedia: true };

export type FullSyncChoice = "upload" | "download" | "cancel";

export type SyncResult = "done" | "media-disabled" | "media-failed" | "media-aborted" | "cancelled" | "error";

type Phase = "idle" | "syncing" | "media";

interface SyncState {
  phase: Phase;
  /** The profile whose account and preferences are loaded; the shell refuses writes for any other. */
  profile: string | null;
  account: SyncAccount | null;
  prefs: SyncPrefs;
  loaded: boolean;
  /** A backup was restored since the profile opened: no syncing on open or close. */
  restored: boolean;
  progress: string[];
  /** Anki's Media Sync Log: the lines of the running or last media sync. */
  log: LogEntry[];
  logOpen: boolean;
  lastError: string | null;
  lastSynced: number | null;
  /** Forgets the account and preferences at once, then loads `profile`'s, the open profile. */
  load(profile: string): Promise<void>;
  /** Forgets the account and preferences: no profile is open, or another one is opening. */
  unload(): void;
  setPrefs(prefs: Partial<SyncPrefs>): Promise<void>;
  showLog(open: boolean): void;
  /** Resolves once no sync is running. */
  idle(): Promise<void>;
  signIn(username: string, password: string, endpoint: string | null): Promise<void>;
  signOut(): Promise<void>;
  sync(askFullSync: (required: "either" | "upload" | "download") => Promise<FullSyncChoice>): Promise<SyncResult>;
  abortMedia(): void;
}

const getAccount = (profile: string) => invoke<SyncAccount | null>("sync_account_get", { profile });
const getPrefs = (profile: string) => invoke<SyncPrefs>("sync_prefs_get", { profile });
const getRestored = () => invoke<boolean>("backup_restored");

/** Nothing known about a profile: not signed in, and no syncing on open or close. */
const UNLOADED = {
  profile: null,
  account: null,
  prefs: DEFAULT_PREFS,
  loaded: false,
  restored: false,
  log: [],
  lastError: null,
  lastSynced: null,
};

function auth(account: SyncAccount) {
  return { hkey: account.hkey, endpoint: account.currentEndpoint ?? account.endpoint ?? undefined };
}

/** The core's progress as already-translated parts, shown side by side. */
function describeProgress(p: Awaited<ReturnType<typeof core.latestProgress>>): string[] {
  switch (p.value.case) {
    case "normalSync":
      return [p.value.value.stage, p.value.value.added, p.value.value.removed].filter(Boolean);
    case "fullSync": {
      const { transferred, total } = p.value.value;
      return total ? [`${Math.round((transferred / total) * 100)}%`] : [];
    }
    default:
      return [];
  }
}

export const useSync = create<SyncState>((set, get) => {
  let poller: ReturnType<typeof setInterval> | null = null;
  /** Bumped whenever the profile changes, so a load for an earlier profile is dropped. */
  let generation = 0;

  /** Written to the loaded profile only; the shell refuses it once another profile is open. */
  function setAccount(account: SyncAccount | null) {
    return invoke<void>("sync_account_set", { profile: get().profile, account });
  }

  function startPolling() {
    stopPolling();
    poller = setInterval(() => {
      core
        .latestProgress()
        .then((p) => set({ progress: describeProgress(p) }))
        .catch(() => undefined);
    }, 250);
  }

  function stopPolling() {
    if (poller) clearInterval(poller);
    poller = null;
    set({ progress: [] });
  }

  async function rememberEndpoint(newEndpoint: string | undefined) {
    const account = get().account;
    if (account && newEndpoint && newEndpoint !== account.currentEndpoint) {
      const updated = { ...account, currentEndpoint: newEndpoint };
      await setAccount(updated);
      set({ account: updated });
    }
  }

  function log(text: string) {
    set({ log: appendLog(get().log, text, Date.now()) });
  }

  /** The core runs media sync in the background; poll its status until it stops. */
  async function syncMedia(account: SyncAccount): Promise<"done" | "media-disabled" | "media-failed" | "media-aborted"> {
    if (!get().prefs.syncMedia) {
      log(tr("sync-media-disabled"));
      return "media-disabled";
    }
    set({ phase: "media", progress: [] });
    log(tr("sync-media-starting"));
    try {
      await core.syncMedia(auth(account));
      for (;;) {
        const status = await core.mediaSyncStatus();
        if (status.progress) {
          const { added, removed, checked } = status.progress;
          const parts = [added, removed, checked].filter(Boolean);
          set({ progress: parts });
          if (parts.length) log(parts.join(", "));
        }
        if (!status.active) {
          log(tr("sync-media-complete"));
          return "done";
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    } catch (error) {
      if (error instanceof CoreError && error.backendError.kind === BackendError_Kind.INTERRUPTED) {
        log(tr("sync-media-aborted"));
        return "media-aborted";
      }
      const message = error instanceof Error ? error.message : String(error);
      log(`${tr("sync-media-failed")} ${message}`);
      set({ lastError: message });
      return "media-failed";
    }
  }

  return {
    phase: "idle",
    profile: null,
    account: null,
    prefs: DEFAULT_PREFS,
    loaded: false,
    restored: false,
    progress: [],
    log: [],
    logOpen: false,
    lastError: null,
    lastSynced: null,

    async load(profile) {
      const mine = ++generation;
      set(UNLOADED);
      const [account, prefs, restored] = await Promise.all([
        getAccount(profile),
        getPrefs(profile).catch(() => DEFAULT_PREFS),
        getRestored(),
      ]);
      if (mine === generation) set({ profile, account, prefs, restored, loaded: true });
    },

    unload() {
      generation++;
      set(UNLOADED);
    },

    async setPrefs(change) {
      const prefs = { ...get().prefs, ...change };
      set({ prefs });
      await invoke<void>("sync_prefs_set", { profile: get().profile, prefs });
    },

    showLog(open) {
      set({ logOpen: open });
    },

    idle() {
      if (get().phase === "idle") return Promise.resolve();
      return new Promise<void>((resolve) => {
        const unsubscribe = useSync.subscribe((s) => {
          if (s.phase === "idle") {
            unsubscribe();
            resolve();
          }
        });
      });
    },

    async signIn(username, password, endpoint) {
      const result = await core.syncLogin({ username, password, endpoint: endpoint || undefined });
      const account: SyncAccount = {
        hkey: result.hkey,
        username,
        endpoint: endpoint || null,
        currentEndpoint: result.endpoint ?? null,
      };
      await setAccount(account);
      set({ account });
    },

    async signOut() {
      await setAccount(null);
      set({ account: null });
    },

    async sync(askFullSync) {
      const account = get().account;
      if (!account || get().phase !== "idle") return "cancelled";
      set({ phase: "syncing", lastError: null });
      startPolling();
      try {
        const result = await core.syncCollection({ auth: auth(account), syncMedia: false });
        await rememberEndpoint(result.newEndpoint);
        const Required = SyncCollectionResponse_ChangesRequired;
        let choice: FullSyncChoice | null = null;
        if (result.required === Required.FULL_SYNC) choice = await askFullSync("either");
        else if (result.required === Required.FULL_DOWNLOAD) choice = await askFullSync("download");
        else if (result.required === Required.FULL_UPLOAD) choice = await askFullSync("upload");
        if (choice === "cancel") {
          return "cancelled";
        }
        if (choice) {
          await core.fullUploadOrDownload({
            auth: auth(get().account!),
            upload: choice === "upload",
            serverUsn: result.serverMediaUsn,
          });
        }
        resetQueries();
        set({ lastSynced: Date.now() });
        stopPolling();
        return await syncMedia(get().account!);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        set({ lastError: message });
        if (error instanceof CoreError && error.backendError.kind === BackendError_Kind.SYNC_AUTH_ERROR) {
          await setAccount(null);
          set({ account: null });
        }
        return "error";
      } finally {
        stopPolling();
        set({ phase: "idle" });
      }
    },

    abortMedia() {
      if (get().phase !== "media") return;
      log(tr("sync-media-aborting"));
      void core.setWantsAbort();
      void core.abortMediaSync();
    },
  };
});
