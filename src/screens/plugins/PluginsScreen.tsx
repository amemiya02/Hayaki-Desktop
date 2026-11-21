// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The plugin manager: what is installed, each plugin's permissions, turning
 * plugins on and off, uninstalling, and installing from a folder or a .zip
 * after the person reviews what the plugin asks for.
 */
import { open } from "@tauri-apps/plugin-dialog";
import { FileArchive, FolderOpen, Puzzle, Trash2, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { confirm } from "@/components/confirm";
import { Button, Dialog, IconButton, Spinner, Switch } from "@/components/ui";
import { t } from "@/lib/i18n";
import { cancelPlugin, commitPlugin, stagePlugin } from "@/lib/plugins/api";
import { FROZE, refreshPlugins, setEnabled, uninstall, usePlugins } from "@/lib/plugins/host";
import type { InstalledPlugin, StagedPlugin } from "@/lib/plugins/types";
import { tp } from "@/lib/strings/plugins";

import { PermissionChips, PermissionList } from "./meta";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function PluginRow({ plugin }: { plugin: InstalledPlugin }) {
  const [busy, setBusy] = useState(false);
  const m = plugin.manifest;
  const name = m?.name ?? plugin.id;
  const problem = plugin.error ?? plugin.failed;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: tp("uninstallTitle", { name }),
      message: tp("uninstallMessage"),
      confirm: tp("uninstall"),
      danger: true,
    });
    if (ok) await run(() => uninstall(plugin.id));
  };

  return (
    <li className="flex gap-3.5 px-4 py-3.5">
      <span aria-hidden className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-[9px] bg-accent-soft text-accent-ink">
        <Puzzle className="size-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-body font-medium text-ink">{name}</span>
          {m && <span className="tabular shrink-0 text-caption text-ink-3">{m.version}</span>}
        </div>
        {m?.author && <div className="text-caption text-ink-3">{tp("byAuthor", { author: m.author })}</div>}
        {m?.description && <p className="mt-1 text-control text-ink-2">{m.description}</p>}
        {problem && (
          <div role="status" className="mt-2 flex items-start gap-1.5 text-control text-danger">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span className="selectable min-w-0">
              {plugin.failed === FROZE && !plugin.error ? (
                <span className="font-medium">{tp("frozeLabel")}</span>
              ) : (
                <>
                  <span className="font-medium">{plugin.error ? tp("invalid") : tp("failed")}</span>
                  {": "}
                  {problem}
                </>
              )}
              {!plugin.error && <span className="block text-caption text-ink-3">{tp("failedHint")}</span>}
            </span>
          </div>
        )}
        {m && (
          <div className="mt-2.5">
            <PermissionChips manifest={m} />
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-start gap-1.5 pt-0.5">
        {m && (
          <Switch
            label={tp("enable", { name })}
            checked={plugin.enabled && !plugin.failed}
            disabled={busy}
            onChange={(on) => void run(() => setEnabled(plugin.id, on))}
          />
        )}
        <IconButton label={tp("uninstall")} size="sm" disabled={busy} onClick={() => void remove()} className="-mt-1">
          <Trash2 />
        </IconButton>
      </div>
    </li>
  );
}

function InstallDialog({ staged, onDone }: { staged: StagedPlugin | null; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const m = staged?.manifest;

  const close = (install: boolean) => {
    if (!staged || busy) return;
    if (!install) {
      void cancelPlugin(staged.token).catch(() => undefined);
      onDone();
      return;
    }
    setBusy(true);
    commitPlugin(staged.token)
      .then(async (manifest) => {
        await refreshPlugins();
        toast.success(tp("installed", { name: manifest.name }));
        onDone();
      })
      .catch((error) => toast.error(tp("installFailed"), { description: errorText(error) }))
      .finally(() => setBusy(false));
  };

  const meta = m ? [tp("version", { version: m.version }), m.author && tp("byAuthor", { author: m.author })].filter(Boolean).join(" · ") : "";

  return (
    <Dialog
      open={!!staged}
      onOpenChange={(o) => !o && close(false)}
      title={m ? tp(staged.replaces ? "updateTitle" : "installTitle", { name: m.name }) : ""}
      description={meta}
      width={480}
      footer={
        <>
          <Button onClick={() => close(false)} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={() => close(true)} disabled={busy}>
            {busy && <Spinner className="size-3.5" />}
            {staged?.replaces ? tp("update") : tp("install")}
          </Button>
        </>
      }
    >
      {m && (
        <div className="space-y-3 pb-1">
          {m.description && <p className="text-control text-ink">{m.description}</p>}
          {staged.replaces && <p className="text-caption text-ink-3">{tp("updateFrom", { version: staged.replaces.version })}</p>}
          {staged.replaces && staged.replaces.author !== m.author && (
            <p role="alert" className="flex items-start gap-1.5 text-control text-danger">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                {tp("authorChanged", { from: staged.replaces.author || tp("noAuthor"), to: m.author || tp("noAuthor") })}
              </span>
            </p>
          )}
          <div>
            <div className="mb-1.5 text-caption font-semibold text-ink-2">{tp("asksTo")}</div>
            <PermissionList manifest={m} previous={staged.replaces} />
          </div>
        </div>
      )}
    </Dialog>
  );
}

export function PluginsScreen() {
  const { installed, paused, status, error } = usePlugins();
  const [staged, setStaged] = useState<StagedPlugin | null>(null);
  const [choosing, setChoosing] = useState(false);

  useEffect(() => {
    void refreshPlugins();
  }, []);

  const choose = async (kind: "folder" | "zip") => {
    if (choosing) return;
    setChoosing(true);
    try {
      const picked = await open(
        kind === "folder" ? { directory: true, multiple: false } : { multiple: false, filters: [{ name: tp("zipFilter"), extensions: ["zip"] }] },
      );
      if (typeof picked === "string") setStaged(await stagePlugin(picked));
    } catch (err) {
      toast.error(tp("installFailed"), { description: errorText(err) });
    } finally {
      setChoosing(false);
    }
  };

  const installButtons = (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => void choose("folder")} disabled={choosing}>
        <FolderOpen />
        {tp("installFolder")}
      </Button>
      <Button onClick={() => void choose("zip")} disabled={choosing}>
        <FileArchive />
        {tp("installZip")}
      </Button>
    </div>
  );

  let body;
  if (status === "idle" || status === "loading") {
    body = (
      <div className="grid h-40 place-items-center" aria-label={tp("loading")}>
        <Spinner className="size-5" />
      </div>
    );
  } else if (status === "error") {
    body = (
      <div className="rounded-[12px] border border-line bg-surface px-5 py-6 text-center">
        <p className="text-body text-ink">{tp("loadError")}</p>
        <p className="selectable mt-1 text-caption text-ink-3">{error}</p>
        <Button className="mt-4" onClick={() => void refreshPlugins()}>
          {t("common.retry")}
        </Button>
      </div>
    );
  } else if (installed.length === 0) {
    body = (
      <div className="flex flex-col items-center rounded-[12px] border border-line bg-surface px-8 py-10 text-center">
        <span aria-hidden className="grid size-12 place-items-center rounded-[12px] bg-accent-soft text-accent-ink">
          <Puzzle className="size-6" />
        </span>
        <h2 className="mt-4 text-heading font-semibold text-ink">{tp("emptyTitle")}</h2>
        <p className="mt-1.5 max-w-[440px] text-control text-ink-2">{tp("emptyLead")}</p>
        <div className="mt-5">{installButtons}</div>
      </div>
    );
  } else {
    body = (
      <ul className="divide-y divide-line overflow-hidden rounded-[12px] border border-line bg-surface">
        {installed.map((p) => (
          <PluginRow key={p.id} plugin={p} />
        ))}
      </ul>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[720px] px-8 pb-16 pt-8">
        <div className="mb-6 flex flex-wrap items-end gap-4">
          <p className="min-w-[260px] flex-1 text-control text-ink-2">{tp("lead")}</p>
          {installed.length > 0 && installButtons}
        </div>
        {paused && (
          <p role="status" className="mb-4 rounded-[10px] border border-line bg-surface px-4 py-3 text-control text-ink-2">
            {tp("paused")}
          </p>
        )}
        {body}
      </div>
      <InstallDialog staged={staged} onDone={() => setStaged(null)} />
    </div>
  );
}
