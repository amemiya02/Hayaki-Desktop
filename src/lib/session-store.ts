// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** App start-up and the open profile. */
import { create } from "zustand";

import { setupI18n } from "./i18n";
import { beforeProfileClose } from "./lifecycle";
import {
  appInfo,
  closeProfile,
  createProfile,
  deleteProfile,
  renameProfile,
  listProfiles,
  openProfile,
  type AppInfo,
  type OpenProfile,
  type ProfileMeta,
} from "./profiles";
import { prepareRwkvIfEnabled } from "./rwkv";
import { resetQueries } from "./queries";
import { useSync } from "./sync";

type Status = "starting" | "choose-profile" | "ready" | "error";

interface AppState {
  status: Status;
  info: AppInfo | null;
  profile: OpenProfile | null;
  profiles: ProfileMeta[];
  /** No profile exists yet: the chooser shows its welcome. */
  firstRun: boolean;
  error: string | null;
  /** Starts the app. A call while one is still running joins it (React's StrictMode runs the boot effect twice). */
  boot(): Promise<void>;
  open(id: string): Promise<void>;
  refreshProfiles(): Promise<void>;
  /** Closes the open profile and shows the profile chooser (Anki's Switch Profile). */
  switchProfile(): Promise<void>;
  /** Creates a profile and opens it. Throws `name-exists` for a taken name. */
  createAndOpen(name: string): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
}

export const useApp = create<AppState>((set, get) => {
  let booting: Promise<void> | null = null;

  async function boot() {
    try {
      const [info] = await Promise.all([appInfo(), setupI18n()]);
      const state = await listProfiles();
      set({ info, profiles: state.profiles });
      const target = state.profiles.find((p) => p.id === state.lastOpened) ?? (state.profiles.length === 1 ? state.profiles[0] : null);
      if (state.profiles.length === 0) {
        // First run: the chooser welcomes the person and creates the profile.
        set({ status: "choose-profile", firstRun: true });
      } else if (target) {
        await get().open(target.id);
      } else {
        set({ status: "choose-profile" });
      }
    } catch (error) {
      set({ status: "error", error: error instanceof Error ? error.message : String(error) });
    }
  }

  return {
    status: "starting",
    info: null,
    profile: null,
    profiles: [],
    firstRun: false,
    error: null,

    boot() {
      booting ??= boot().finally(() => {
        booting = null;
      });
      return booting;
    },

    async open(id) {
      if (get().profile?.id !== id) {
        // Another profile closes first, with its sync on close.
        if (get().profile) await beforeProfileClose();
        // Its sync account is forgotten before the switch starts, so nothing of
        // it is written into the profile that opens.
        useSync.getState().unload();
      }
      try {
        const profile = await openProfile(id);
        resetQueries();
        set({ profile, status: "ready", error: null, firstRun: false });
        // RWKV scheduling prepares in the background; study uses the upstream
        // queue until it is ready, so a failure here only shows in Settings.
        prepareRwkvIfEnabled().catch(() => undefined);
      } catch (error) {
        // No profile is loaded now (the shell may have closed the old one), so
        // opening any profile, the same one included, starts afresh.
        set({ profile: null, status: "error", error: error instanceof Error ? error.message : String(error) });
      }
    },

    async refreshProfiles() {
      const state = await listProfiles();
      set({ profiles: state.profiles, profile: state.current ?? get().profile });
    },

    async switchProfile() {
      await beforeProfileClose();
      try {
        await closeProfile();
      } catch {
        // A profile that is already closed needs no closing.
      }
      resetQueries();
      const state = await listProfiles();
      set({ status: "choose-profile", profile: null, profiles: state.profiles, firstRun: state.profiles.length === 0 });
    },

    async createAndOpen(name) {
      const meta = await createProfile(name);
      await get().refreshProfiles();
      await get().open(meta.id);
    },

    async rename(id, name) {
      const state = await renameProfile(id, name);
      set({ profiles: state.profiles, profile: state.current ?? get().profile });
    },

    async remove(id) {
      const state = await deleteProfile(id);
      set({ profiles: state.profiles, firstRun: state.profiles.length === 0 });
    },
  };
});

// This module holds app-wide state that boot fills once; an in-place hot update
// would recreate it empty (stuck on the boot screen, raw string keys). Reload instead.
import.meta.hot?.accept(() => location.reload());
