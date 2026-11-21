// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Runs every enabled plugin's entry script in a hidden sandboxed frame
 * (`allow-scripts` only, so its origin is opaque), routes the frames' calls,
 * mirrors the appearance into them, and runs plugin command shortcuts.
 *
 * Plugins start one at a time, each reported to the shell as loading first,
 * so a plugin that freezes the interface while it loads is the one turned
 * off at the next launch (ADR 0004).
 */
import { useEffect, useState } from "react";

import { matchesShortcut } from "@/lib/plugins/commands";
import { usePluginFrame, type PluginPage } from "@/lib/plugins/frame";
import {
  installKey,
  invokeCommand,
  markFailed,
  refreshPlugins,
  router,
  runnable,
  setRunning,
  startHeartbeat,
  themePayload,
  usePlugins,
} from "@/lib/plugins/host";
import type { FrameKind } from "@/lib/plugins/rpc";
import type { Manifest } from "@/lib/plugins/types";

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

const MAIN: FrameKind = { kind: "main" };
const ENTRY: PluginPage = { entry: true };

function PluginWorker({ manifest: current, onSettled }: { manifest: Manifest; onSettled: () => void }) {
  // Keyed by install, so a new install means a new frame.
  const [manifest] = useState(current);
  const frame = usePluginFrame(manifest, MAIN, ENTRY, (error) => {
    onSettled();
    if (error) void markFailed(manifest.id, error);
  });
  if (!frame.src) return null;
  return <iframe ref={frame.ref} src={frame.src} onLoad={frame.onLoad} title={manifest.name} sandbox="allow-scripts" tabIndex={-1} />;
}

export function PluginHost() {
  const installed = usePlugins((s) => s.installed);
  const paused = usePlugins((s) => s.paused);
  const [settled, setSettled] = useState<ReadonlySet<string>>(() => new Set());
  const plugins = runnable(installed, paused);
  // Every plugin that finished loading, and the next one in line.
  const next = plugins.find((p) => !settled.has(installKey(p)));
  const mounted = plugins.filter((p) => p === next || settled.has(installKey(p)));
  const mountedIds = mounted.map((p) => p.id).join(" ");

  useEffect(() => setRunning(mountedIds ? mountedIds.split(" ") : []), [mountedIds]);

  useEffect(() => {
    const stopHeartbeat = startHeartbeat();
    void refreshPlugins();
    const onMessage = (e: MessageEvent) => void router.receive({ source: e.source, data: e.data });
    window.addEventListener("message", onMessage);

    const observer = new MutationObserver(() => router.emit("app.theme", themePayload(), () => true));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "data-appearance", "lang", "dir"],
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || isTyping(e.target) || document.querySelector("[role=dialog]")) return;
      const command = usePlugins.getState().commands.find((c) => c.shortcut && matchesShortcut(c.shortcut, e));
      if (!command) return;
      e.preventDefault();
      invokeCommand(command);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      stopHeartbeat();
      window.removeEventListener("message", onMessage);
      window.removeEventListener("keydown", onKey);
      observer.disconnect();
    };
  }, []);

  return (
    <div hidden aria-hidden>
      {mounted.map((p) => (
        <PluginWorker
          key={installKey(p)}
          manifest={p.manifest!}
          onSettled={() => setSettled((s) => (s.has(installKey(p)) ? s : new Set(s).add(installKey(p))))}
        />
      ))}
    </div>
  );
}
