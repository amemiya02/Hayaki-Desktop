// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** Plugin shapes as the native side (`src-tauri/src/plugins`) returns them; it validates every manifest. */

export type Permission = "collection:read" | "collection:write" | "reviewer" | "ui" | "network";

export interface PanelManifest {
  id: string;
  title: string;
  icon?: string;
  entry: string;
}

export interface Manifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  entry: string;
  panels: PanelManifest[];
  permissions: Permission[];
  network: string[];
}

export interface InstalledPlugin {
  id: string;
  manifest: Manifest | null;
  /** Why the installed copy cannot run, such as an invalid manifest. */
  error: string | null;
  enabled: boolean;
  /** Why it stopped; it stays off until enabled again. `"froze"` is the freeze guard's (ADR 0004). */
  failed: string | null;
  /** Changes with every install and update, so the frames of an updated plugin reload. */
  install: string;
}

export interface PluginList {
  plugins: InstalledPlugin[];
  /** The person started Hayaki without plugins (Shift held at launch, or `HAYAKI_NO_PLUGINS`). */
  paused: boolean;
  /** Plugins the freeze guard turned off at this launch. */
  stopped: string[];
}

export interface StagedPlugin {
  token: string;
  manifest: Manifest;
  /** The installed manifest this replaces, if any. */
  replaces: Manifest | null;
}

/** A plugin as the host runs it: its id, name and granted permissions. */
export interface PluginContext {
  id: string;
  name: string;
  permissions: ReadonlySet<Permission>;
}

export function contextOf(manifest: Manifest): PluginContext {
  return { id: manifest.id, name: manifest.name, permissions: new Set(manifest.permissions) };
}
