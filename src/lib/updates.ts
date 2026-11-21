// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Updating Hayaki (`src-tauri/src/updater.rs`): check for a newer version,
 * download it, then install it, which closes the collection and restarts.
 */
import { Channel, invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

import { beforeProfileClose } from "./lifecycle";

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  /** Markdown. */
  notes?: string | null;
  /** Seconds since 1970. */
  date?: number | null;
}

interface DownloadProgress {
  downloaded: number;
  total?: number | null;
}

export type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "latest" }
  | { kind: "available"; update: UpdateInfo }
  | { kind: "downloading"; update: UpdateInfo; downloaded: number; total: number | null }
  | { kind: "ready"; update: UpdateInfo }
  | { kind: "installing"; update: UpdateInfo }
  | { kind: "error"; message: string; update?: UpdateInfo };

/** The share downloaded, 0 to 1, or null while the size is unknown. */
export function downloadShare(downloaded: number, total: number | null): number | null {
  if (!total || total <= 0) return null;
  return Math.min(1, Math.max(0, downloaded / total));
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface Updates {
  status: UpdateStatus;
  /** Looks for a newer version; the update found, if any. */
  check(): Promise<UpdateInfo | null>;
  download(): Promise<void>;
  /** Closes the profile and installs; the app restarts when it works. */
  install(): Promise<void>;
}

export const useUpdates = create<Updates>((set, get) => ({
  status: { kind: "idle" },

  async check() {
    const busy = get().status.kind;
    if (busy === "checking" || busy === "downloading" || busy === "installing") return null;
    set({ status: { kind: "checking" } });
    try {
      const update = await invoke<UpdateInfo | null>("update_check");
      set({ status: update ? { kind: "available", update } : { kind: "latest" } });
      return update;
    } catch (error) {
      set({ status: { kind: "error", message: message(error) } });
      throw error;
    }
  },

  async download() {
    const status = get().status;
    if (status.kind !== "available" && !(status.kind === "error" && status.update)) return;
    const update = status.update!;
    set({ status: { kind: "downloading", update, downloaded: 0, total: null } });
    const onProgress = new Channel<DownloadProgress>();
    onProgress.onmessage = ({ downloaded, total }) => {
      const now = get().status;
      if (now.kind === "downloading") set({ status: { ...now, downloaded, total: total ?? null } });
    };
    try {
      await invoke("update_download", { onProgress });
      set({ status: { kind: "ready", update } });
    } catch (error) {
      set({ status: { kind: "error", message: message(error), update } });
      throw error;
    }
  },

  async install() {
    const status = get().status;
    if (status.kind !== "ready") return;
    const { update } = status;
    set({ status: { kind: "installing", update } });
    try {
      // Syncs on close first, as quitting does.
      await beforeProfileClose();
      await invoke("update_install");
    } catch (error) {
      // The download is kept, so restarting can be tried again.
      set({ status: { kind: "ready", update } });
      throw error;
    }
  },
}));
