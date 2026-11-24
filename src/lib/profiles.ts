// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** Profiles and app information, from the Rust shell (`src-tauri/src/profiles.rs`). */
import { invoke } from "@tauri-apps/api/core";

export interface ProfileMeta {
  id: string;
  name: string;
  created: number;
  /** A small picture as a `data:image/...` URL; none shows the initial. */
  avatar?: string;
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
export const setProfileAvatar = (id: string, avatar: string | null) => invoke<ProfilesState>("profile_set_avatar", { id, avatar });

export interface DataFolder {
  path: string;
  defaultPath: string;
  isDefault: boolean;
}

/** What a folder offered as the new data folder holds (`src-tauri/src/location.rs`). */
export type FolderKind = "current" | "nested" | "existing" | "empty" | "occupied";

export const dataFolder = () => invoke<DataFolder>("data_folder_get");
/** `path` null is the default folder. */
export const checkDataFolder = (path: string | null) => invoke<FolderKind>("data_folder_check", { path });
/** Switches the data folder and restarts the app. */
export const setDataFolder = (path: string | null) => invoke<void>("data_folder_set", { path });
