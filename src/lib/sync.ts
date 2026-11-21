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

export type FullSyncChoice = "upload" | "download" | "cancel";

export type SyncResult = "done" | "media-failed" | "media-aborted" | "cancelled" | "error";

type Phase = "idle" | "syncing" | "media";

interface SyncState {
  phase: Phase;
  account: SyncAccount | null;
  loaded: boolean;
  progress: string[];
  lastError: string | null;
  lastSynced: number | null;
  load(): Promise<void>;
  signIn(username: string, password: string, endpoint: string | null): Promise<void>;
  signOut(): Promise<void>;
  sync(askFullSync: (required: "either" | "upload" | "download") => Promise<FullSyncChoice>): Promise<SyncResult>;
  abortMedia(): void;
}

const getAccount = () => invoke<SyncAccount | null>("sync_account_get");
const setAccount = (account: SyncAccount | null) => invoke<void>("sync_account_set", { account });

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

  /** The core runs media sync in the background; poll its status until it stops. */
  async function syncMedia(account: SyncAccount): Promise<"done" | "media-failed" | "media-aborted"> {
    set({ phase: "media", progress: [] });
    try {
      await core.syncMedia(auth(account));
      for (;;) {
        const status = await core.mediaSyncStatus();
        if (status.progress) {
          const { added, removed, checked } = status.progress;
          set({ progress: [added, removed, checked].filter(Boolean) });
        }
        if (!status.active) return "done";
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    } catch (error) {
      if (error instanceof CoreError && error.backendError.kind === BackendError_Kind.INTERRUPTED) return "media-aborted";
      set({ lastError: error instanceof Error ? error.message : String(error) });
      return "media-failed";
    }
  }

  return {
    phase: "idle",
    account: null,
    loaded: false,
    progress: [],
    lastError: null,
    lastSynced: null,

    async load() {
      set({ account: await getAccount(), loaded: true });
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
      if (get().phase === "media") void core.abortMediaSync();
    },
  };
});
