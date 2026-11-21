// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** A plugin's panel: its page in a visible sandboxed frame, on the same bridge as its entry script. */
import { Puzzle, TriangleAlert } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button, Spinner } from "@/components/ui";
import { usePluginFrame, type PluginPage } from "@/lib/plugins/frame";
import { installKey, runnable, usePlugins } from "@/lib/plugins/host";
import type { FrameKind } from "@/lib/plugins/rpc";
import type { Manifest, PanelManifest } from "@/lib/plugins/types";
import { useNav } from "@/lib/nav";
import { tp } from "@/lib/strings/plugins";

type PanelState = { kind: "loading" } | { kind: "ready" } | { kind: "failed"; message: string };

function Notice({ icon, message, detail }: { icon: ReactNode; message: string; detail?: string }) {
  const go = useNav((s) => s.go);
  return (
    <div className="grid h-full place-items-center px-8">
      <div className="flex max-w-[420px] flex-col items-center text-center">
        {icon}
        <p className="mt-3 text-body text-ink">{message}</p>
        {detail && <p className="selectable mt-1 text-caption text-ink-3">{detail}</p>}
        <Button className="mt-4" onClick={() => go({ name: "plugins" })}>
          {tp("manage")}
        </Button>
      </div>
    </div>
  );
}

function PanelFrame(props: { manifest: Manifest; panel: PanelManifest }) {
  // Keyed by install and panel, so later refreshes never restart the frame.
  const [{ manifest, panel, kind, page }] = useState(() => {
    const kind: FrameKind = { kind: "panel", panelId: props.panel.id };
    const page: PluginPage = { path: props.panel.entry };
    return { ...props, kind, page };
  });
  const [state, setState] = useState<PanelState>({ kind: "loading" });
  const frame = usePluginFrame(manifest, kind, page, (error) => setState(error ? { kind: "failed", message: error } : { kind: "ready" }));

  if (state.kind === "failed") {
    return <Notice icon={<TriangleAlert className="size-6 text-danger" />} message={tp("panelFailed")} detail={state.message} />;
  }
  return (
    <div className="relative h-full">
      {state.kind === "loading" && (
        <div className="absolute inset-0 grid place-items-center">
          <Spinner className="size-5" />
        </div>
      )}
      {frame.src && (
        <iframe
          ref={frame.ref}
          src={frame.src}
          onLoad={frame.onLoad}
          title={panel.title}
          sandbox="allow-scripts"
          className="absolute inset-0 h-full w-full border-0 bg-transparent transition-opacity duration-[var(--dur-quick)]"
          style={{ opacity: state.kind === "ready" ? 1 : 0 }}
        />
      )}
    </div>
  );
}

export function PluginPanelScreen({ pluginId, panelId }: { pluginId: string; panelId: string }) {
  const installed = usePlugins((s) => s.installed);
  const paused = usePlugins((s) => s.paused);
  const status = usePlugins((s) => s.status);
  const plugin = runnable(installed, paused).find((p) => p.id === pluginId);
  const manifest = plugin?.manifest?.permissions.includes("ui") ? plugin.manifest : null;
  const panel = manifest?.panels.find((p) => p.id === panelId);

  if (status === "idle" || status === "loading") {
    return (
      <div className="grid h-full place-items-center">
        <Spinner className="size-5" />
      </div>
    );
  }
  if (!plugin || !manifest || !panel) {
    return <Notice icon={<Puzzle className="size-6 text-ink-3" />} message={tp(paused ? "paused" : "panelMissing")} />;
  }
  return <PanelFrame key={`${installKey(plugin)}:${panel.id}`} manifest={manifest} panel={panel} />;
}
