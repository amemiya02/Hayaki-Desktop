// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** Adding files to the collection's media folder. */
import { invoke } from "@tauri-apps/api/core";

import { addMediaFile } from "./anki/generated/core";

/** Stores bytes in the media folder; returns the name the core stored them under. */
export async function addMediaBytes(desiredName: string, data: Uint8Array): Promise<string> {
  return (await addMediaFile({ desiredName, data })).val;
}

/** Stores a file chosen on disk (from the open dialog or a drop). */
export async function addMediaFromPath(path: string): Promise<string> {
  const bytes = new Uint8Array(await invoke<ArrayBuffer>("read_chosen_file", { path }));
  const name = path.split(/[\\/]/).pop() || "file";
  return addMediaBytes(name, bytes);
}
