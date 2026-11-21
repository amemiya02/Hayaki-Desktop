// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** The native plugin commands (`src-tauri/src/plugins`) and the `plugin` scheme's addresses. */
import { convertFileSrc, invoke } from "@tauri-apps/api/core";

import type { Manifest, PluginList, StagedPlugin } from "./types";

export const listPlugins = () => invoke<PluginList>("plugins_list");
export const heartbeat = (page: string, seq: number, running: string[], loading: string[]) =>
  invoke<void>("plugins_heartbeat", { page, seq, running, loading });
export const stagePlugin = (path: string) => invoke<StagedPlugin>("plugin_install_stage", { path });
export const commitPlugin = (token: string) => invoke<Manifest>("plugin_install_commit", { token });
export const cancelPlugin = (token: string) => invoke<void>("plugin_install_cancel", { token });
export const uninstallPlugin = (id: string) => invoke<void>("plugin_uninstall", { id });
export const setPluginEnabled = (id: string, enabled: boolean) => invoke<void>("plugin_set_enabled", { id, enabled });
export const setPluginFailed = (id: string, error: string) => invoke<void>("plugin_set_failed", { id, error });
export const storageGet = (id: string, key: string) => invoke<unknown>("plugin_storage_get", { id, key });
export const storageSet = (id: string, key: string, value: unknown) =>
  invoke<void>("plugin_storage_set", { id, key, value: value ?? null });
export const sanitizeHtml = (html: string) => invoke<string>("plugin_sanitize_html", { html });

/** `plugin://localhost/` (`http://plugin.localhost/` on Windows); paths are already URL-safe. */
function base(): string {
  const root = convertFileSrc("", "plugin");
  return root.endsWith("/") ? root : `${root}/`;
}

/**
 * The address of a plugin page with a fresh one-use ticket, which the
 * scheme requires for every page: the entry page for `entry`, else the panel
 * page at that path in the plugin's folder.
 */
export async function pageUrl(id: string, page: { entry: true } | { path: string }): Promise<string> {
  const path = "entry" in page ? `_entry/${id}` : `${id}/${page.path}`;
  const ticket = await invoke<string>("plugin_frame_ticket", { path: `/${path}` });
  return `${base()}${path}?t=${ticket}`;
}
