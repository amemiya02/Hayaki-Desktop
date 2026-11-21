// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** Profiles and app information, from the Rust shell (`src-tauri/src/profiles.rs`). */
import { invoke } from "@tauri-apps/api/core";

export interface ProfileMeta {
  id: string;
  name: string;
  created: number;
}

export interface OpenProfile {
  id: string;
  name: string;
  folder: string;
  collectionPath: string;
  mediaFolder: string;
  backupFolder: string;
}

export interface ProfilesState {
  profiles: ProfileMeta[];
  lastOpened: string | null;
  current: OpenProfile | null;
}

export interface AppInfo {
  version: string;
  ankiVersion: string;
  dataDir: string;
  langs: string[];
  platform: string;
}

export const appInfo = () => invoke<AppInfo>("app_info");
export const listProfiles = () => invoke<ProfilesState>("profiles_list");
export const createProfile = (name: string) => invoke<ProfileMeta>("profile_create", { name });
export const renameProfile = (id: string, name: string) => invoke<ProfilesState>("profile_rename", { id, name });
export const deleteProfile = (id: string) => invoke<ProfilesState>("profile_delete", { id });
export const openProfile = (id: string) => invoke<OpenProfile>("profile_open", { id });
export const closeProfile = () => invoke<void>("profile_close");
export const setCoreLangs = (langs: string[]) => invoke<void>("set_core_langs", { langs });
