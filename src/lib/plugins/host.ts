// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The interface's side of the plugin system: the installed plugins, the
 * router their frames talk to, the host methods behind `ui.*`, `storage.*`
 * and `reviewer.*`, the events the app sends them, and the reports the
 * shell's freeze guard needs (ADR 0004).
 */
import type { Message } from "@bufbuild/protobuf";
import { toast } from "sonner";
import { create } from "zustand";

import { methodNumbers } from "../anki/generated/core";
import { call } from "../anki/transport";
import { useNav } from "../nav";
import { onReviewerEvent } from "../study/reviewer-events";
import * as api from "./api";
import { pluginShortcut } from "./commands";
import { tp } from "../strings/plugins";
import { cssProblem, useInjections } from "./injection";
import { PluginRouter, RpcFailure, type FrameBinding, type HostMethod } from "./rpc";
import type { InstalledPlugin } from "./types";

/** How long a plugin has to finish loading before it is marked failed. */
export const LOAD_TIMEOUT_MS = 15_000;
const MAX_COMMANDS = 20;
/** The `failed` reason the shell records for a plugin that froze the app. */
export const FROZE = "froze";

export interface PluginCommand {
  pluginId: string;
  pluginName: string;
  id: string;
  title: string;
  shortcut: string | null;
  frame: FrameBinding;
}

interface PluginsState {
  installed: InstalledPlugin[];
  /** Started without plugins this time: none runs. */
  paused: boolean;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  commands: PluginCommand[];
}

export const usePlugins = create<PluginsState>(() => ({
  installed: [],
  paused: false,
  status: "idle",
  error: null,
  commands: [],
}));

let toldStopped = false;

export async function refreshPlugins(): Promise<void> {
  if (usePlugins.getState().status === "idle") usePlugins.setState({ status: "loading" });
  try {
    const { plugins, paused, stopped } = await api.listPlugins();
    usePlugins.setState({ installed: plugins, paused, status: "ready", error: null });
    if (!toldStopped) {
      toldStopped = true;
      for (const id of stopped) {
        const name = plugins.find((p) => p.id === id)?.manifest?.name ?? id;
        toast.error(name, { description: tp("frozeToast") });
      }
    }
  } catch (error) {
    usePlugins.setState({ status: "error", error: String(error) });
  }
}

/** Plugins that should be running now: installed, valid, enabled and not failed, unless all are paused. */
export function runnable(installed: InstalledPlugin[], paused: boolean): InstalledPlugin[] {
  return paused ? [] : installed.filter((p) => p.manifest && p.enabled && !p.failed);
}

/** Identifies one install of a plugin, so an update or reinstall gets fresh frames. */
export const installKey = (p: InstalledPlugin) => `${p.id}:${p.install}`;

// The freeze guard's reports: which plugins have frames and which are loading.
const HEARTBEAT_MS = 2_000;
const loading = new Map<string, number>();
let running: string[] = [];
// Reports are numbered per page load, so the shell applies only the newest.
const page = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
let seq = 0;

function report(): Promise<void> {
  return api.heartbeat(page, ++seq, running, [...loading.keys()]).catch(() => undefined);
}

/**
 * Reports `id` as loading and resolves once the shell has recorded it, so a
 * frame that freezes the interface while it loads is blamed for it. Call the
 * returned function, any number of times, when loading ends.
 */
export async function startLoading(id: string): Promise<() => void> {
  loading.set(id, (loading.get(id) ?? 0) + 1);
  let done = false;
  await report();
  return () => {
    if (done) return;
    done = true;
    const left = (loading.get(id) ?? 1) - 1;
    if (left > 0) loading.set(id, left);
    else loading.delete(id);
    void report();
  };
}

export function setRunning(ids: string[]): void {
  running = ids;
  void report();
}

/** Beats every 2 seconds until the returned function stops it and reports nothing running. */
export function startHeartbeat(): () => void {
  const timer = setInterval(() => void report(), HEARTBEAT_MS);
  return () => {
    clearInterval(timer);
    running = [];
    loading.clear();
    void report();
  };
}

export async function setEnabled(id: string, enabled: boolean): Promise<void> {
  await api.setPluginEnabled(id, enabled);
  await refreshPlugins();
}

export async function uninstall(id: string): Promise<void> {
  await api.uninstallPlugin(id);
  await refreshPlugins();
}

/** A plugin that failed while loading stays off until the person enables it again. */
export async function markFailed(id: string, message: string): Promise<void> {
  const name = usePlugins.getState().installed.find((p) => p.id === id)?.manifest?.name ?? id;
  try {
    await api.setPluginFailed(id, message);
  } finally {
    await refreshPlugins();
  }
  toast.error(name, { description: message });
}

// Frame lifecycles: a frame reports ready or a load error once.
export interface FrameLifecycle {
  ready(): void;
  error(message: string): void;
}
const lifecycles = new WeakMap<FrameBinding, FrameLifecycle>();

/** Starts routing a frame's calls; the returned function detaches it and drops what it registered. */
export function attachFrame(source: Window, binding: FrameBinding, lifecycle: FrameLifecycle): () => void {
  lifecycles.set(binding, lifecycle);
  const detach = router.attach(source, binding);
  return () => {
    detach();
    usePlugins.setState((s) => ({ commands: s.commands.filter((c) => c.frame !== binding) }));
    if (binding.frame.kind === "main") useInjections.getState().clear(binding.plugin.id);
  };
}

export function invokeCommand(command: PluginCommand): void {
  command.frame.target.postMessage({ type: "event", name: "command.invoked", payload: { id: command.id } }, "*");
}

/** The interface's appearance, for the SDK to mirror on the plugin's own root. */
export function themePayload() {
  const root = document.documentElement;
  return {
    dark: root.classList.contains("dark"),
    theme: root.dataset.theme ?? null,
    appearance: root.dataset.appearance ?? null,
    lang: root.lang,
    dir: root.dir || "ltr",
  };
}

function record(params: unknown): Record<string, unknown> {
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    throw new RpcFailure("invalid-params", "params must be an object");
  }
  return params as Record<string, unknown>;
}

function text(params: Record<string, unknown>, key: string, max: number, optional = false): string | undefined {
  const value = params[key];
  if (value === undefined && optional) return undefined;
  if (typeof value !== "string" || value.length > max || (!optional && value.length === 0)) {
    throw new RpcFailure("invalid-params", `${key} must be a string of at most ${max} characters`);
  }
  return value;
}

function storageError(error: unknown): never {
  const message = String(error);
  const code = message.startsWith("storage-full") ? "storage-full" : message.startsWith("invalid-params") ? "invalid-params" : "failed";
  throw new RpcFailure(code, message.replace(/^[a-z-]+: /, ""));
}

const host: Record<string, HostMethod> = {
  "plugin.ready": {
    permission: null,
    run(frame) {
      lifecycles.get(frame)?.ready();
      frame.target.postMessage({ type: "event", name: "app.theme", payload: themePayload() }, "*");
    },
  },
  "plugin.error": {
    permission: null,
    run(frame, params) {
      const message = text(record(params), "message", 2000) ?? "";
      lifecycles.get(frame)?.error(message);
    },
  },
  "ui.registerCommand": {
    permission: "ui",
    run(frame, params) {
      const p = record(params);
      const id = text(p, "id", 32)!;
      if (!/^[a-z0-9-]+$/.test(id)) throw new RpcFailure("invalid-params", "a command id is a-z, 0-9 and hyphens");
      const title = text(p, "title", 60)!;
      const chord = text(p, "shortcut", 32, true);
      const shortcut = chord === undefined ? null : pluginShortcut(chord);
      if (chord !== undefined && !shortcut) {
        throw new RpcFailure("invalid-params", "a shortcut is Ctrl+Alt (and optionally Shift) with a letter or digit, unused by Hayaki");
      }
      const { commands } = usePlugins.getState();
      const others = commands.filter((c) => !(c.pluginId === frame.plugin.id && c.id === id));
      if (others.filter((c) => c.pluginId === frame.plugin.id).length >= MAX_COMMANDS) {
        throw new RpcFailure("invalid-params", `a plugin registers at most ${MAX_COMMANDS} commands`);
      }
      if (shortcut && others.some((c) => c.shortcut === shortcut)) {
        throw new RpcFailure("invalid-params", `${shortcut} is taken by another plugin's command`);
      }
      const command: PluginCommand = { pluginId: frame.plugin.id, pluginName: frame.plugin.name, id, title, shortcut, frame };
      usePlugins.setState({ commands: [...others, command] });
    },
  },
  "ui.unregisterCommand": {
    permission: "ui",
    run(frame, params) {
      const id = text(record(params), "id", 32);
      usePlugins.setState((s) => ({ commands: s.commands.filter((c) => !(c.pluginId === frame.plugin.id && c.id === id)) }));
    },
  },
  "ui.toast": {
    permission: "ui",
    run(frame, params) {
      const p = record(params);
      const message = text(p, "message", 300)!;
      const kind = p.kind ?? "info";
      const show = kind === "success" ? toast.success : kind === "error" ? toast.error : toast.info;
      show(frame.plugin.name, { description: message });
    },
  },
  "ui.navigate": {
    permission: "ui",
    run(_frame, params) {
      const p = record(params);
      const go = useNav.getState().go;
      if (p.to === "browse") go({ name: "browse", search: text(p, "search", 1000, true) ?? "" });
      else if (p.to === "add") go({ name: "add" });
      else if (p.to === "deck" && typeof p.deckId === "string" && /^\d{1,19}$/.test(p.deckId)) go({ name: "deck", deckId: BigInt(p.deckId) });
      else throw new RpcFailure("invalid-params", 'navigate to { to: "browse", search }, { to: "add" } or { to: "deck", deckId }');
    },
  },
  "storage.get": {
    permission: null,
    async run(frame, params) {
      const key = text(record(params), "key", 128)!;
      return (await api.storageGet(frame.plugin.id, key).catch(storageError)) ?? null;
    },
  },
  "storage.set": {
    permission: null,
    async run(frame, params) {
      const p = record(params);
      const key = text(p, "key", 128)!;
      await api.storageSet(frame.plugin.id, key, p.value).catch(storageError);
    },
  },
  "reviewer.injectCss": {
    permission: "reviewer",
    run(frame, params) {
      const css = text(record(params), "css", 64 * 1024, true) ?? "";
      const problem = cssProblem(css);
      if (problem) throw new RpcFailure("invalid-params", problem);
      useInjections.getState().set(frame.plugin.id, { css });
    },
  },
  "reviewer.injectHtml": {
    permission: "reviewer",
    async run(frame, params) {
      const html = text(record(params), "html", 64 * 1024, true) ?? "";
      useInjections.getState().set(frame.plugin.id, { html: html ? await api.sanitizeHtml(html) : "" });
    },
  },
};

export const router = new PluginRouter({
  host,
  callCore(method, schemas, input) {
    const [service, index] = methodNumbers[method];
    // OpChanges are announced, so screens refresh after a plugin's change.
    return call(service, index, schemas.input, input, schemas.output, 3, { origin: "plugin" }) as Promise<Message>;
  },
});

// Ids travel as strings, as int64 does in protobuf JSON.
onReviewerEvent((event) => {
  const payload = {
    cardId: String(event.cardId),
    noteId: String(event.noteId),
    ...(event.name === "reviewer.answered" ? { ease: event.ease } : {}),
  };
  router.emit(event.name, payload, (b) => b.plugin.permissions.has("reviewer"));
});

/** The title of a plugin's panel, for the toolbar. */
export function pluginPanelTitle(pluginId: string, panelId: string): string {
  const plugin = usePlugins.getState().installed.find((p) => p.id === pluginId);
  return plugin?.manifest?.panels.find((p) => p.id === panelId)?.title ?? plugin?.manifest?.name ?? "";
}
