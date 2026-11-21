// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Importing a Deck package (`.apkg`): upstream's options
 * (ts/routes/import-anki-package), then progress, then the import log.
 */
import { useEffect, useState, type ReactNode } from "react";
import { create } from "zustand";

import { Button, Dialog, Spinner } from "@/components/ui";
import * as core from "@/lib/anki/generated/core";
import { ImportAnkiPackageUpdateCondition as Update, type ImportAnkiPackageOptions, type ImportResponse, type ImportResponse_Note } from "@/lib/anki/proto/anki/import_export_pb";
import { CoreError } from "@/lib/anki/transport";
import { t, tr } from "@/lib/i18n";
import { useNav } from "@/lib/nav";
import { ti } from "@/lib/strings/import";
import { HelpButton, SelectField, Switch } from "@/screens/deck-options/controls";

import { fileName } from "./csv";
import { ImportLog } from "./ImportLog";
import { notesSearch } from "./log";
import { withImportProgress } from "./progress";

const usePackageImport = create<{ path: string | null; serial: number }>(() => ({ path: null, serial: 0 }));

/** Shows the options for importing `path`; the dialog runs the import. */
export function showPackageImport(path: string): void {
  usePackageImport.setState((s) => ({ path, serial: s.serial + 1 }));
}

const UPDATE_CHOICES: [Update, string][] = [
  [Update.IF_NEWER, "importing-update-if-newer"],
  [Update.ALWAYS, "importing-update-always"],
  [Update.NEVER, "importing-update-never"],
];

type Phase = { name: "options" } | { name: "importing"; progress: string } | { name: "done"; response: ImportResponse } | { name: "failed"; message: string };

function Row({ label, help, htmlFor, children }: { label: string; help: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[48px] items-center gap-4 px-3.5 py-2">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <label htmlFor={htmlFor} className="text-[13px] text-ink">
          {label}
        </label>
        <HelpButton title={label} text={help} />
      </div>
      {children}
    </div>
  );
}

function PackageImportDialog({ path, onClose }: { path: string; onClose: () => void }) {
  const go = useNav((s) => s.go);
  const [options, setOptions] = useState<ImportAnkiPackageOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: "options" });

  useEffect(() => {
    let live = true;
    core
      .getImportAnkiPackagePresets()
      .then((presets) => live && setOptions(presets))
      .catch((e: unknown) => live && setLoadError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, []);

  const patch = (changes: Partial<ImportAnkiPackageOptions>) => setOptions((o) => (o ? { ...o, ...changes } : o));

  const run = async () => {
    if (!options) return;
    setPhase({ name: "importing", progress: tr("importing-importing-file") });
    try {
      const response = await withImportProgress(
        () => core.importAnkiPackage({ packagePath: path, options }, { origin: "import" }),
        (progress) => setPhase((p) => (p.name === "importing" ? { name: "importing", progress } : p)),
      );
      setPhase({ name: "done", response });
    } catch (error) {
      if (error instanceof CoreError && error.isInterrupted) setPhase({ name: "options" });
      else setPhase({ name: "failed", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const browse = (notes: ImportResponse_Note[]) => {
    onClose();
    go({ name: "browse", search: notesSearch(notes) });
  };

  const importing = phase.name === "importing";
  const footer =
    phase.name === "options" ? (
      <>
        <Button onClick={onClose}>{t("common.cancel")}</Button>
        <Button variant="primary" disabled={!options} onClick={() => void run()}>
          {tr("actions-import")}
        </Button>
      </>
    ) : importing ? (
      <Button onClick={() => void core.setWantsAbort()}>{ti("abort")}</Button>
    ) : (
      <Button variant="primary" onClick={onClose}>
        {tr("actions-close")}
      </Button>
    );

  return (
    <Dialog
      open
      // An import in progress cannot be dismissed; it can be stopped.
      onOpenChange={(o) => !o && !importing && onClose()}
      title={phase.name === "done" ? tr("importing-import-log") : ti("packageTitle", { name: fileName(path) })}
      width={phase.name === "done" ? 680 : 560}
      footer={footer}
    >
      {phase.name === "importing" ? (
        <div className="flex h-[160px] flex-col items-center justify-center gap-4" aria-busy="true">
          <Spinner className="size-6" />
          <p className="tabular text-[13px] text-ink-2" aria-live="polite">
            {phase.progress}
          </p>
        </div>
      ) : phase.name === "done" ? (
        <ImportLog response={phase.response} onBrowse={browse} maxTableHeight={300} />
      ) : phase.name === "failed" ? (
        <div className="flex flex-col gap-2 py-2">
          <p className="text-[13.5px] font-semibold text-ink">{t("import.failed")}</p>
          <p className="selectable whitespace-pre-line text-[13px] text-ink-2">{phase.message}</p>
        </div>
      ) : loadError ? (
        <p className="selectable py-2 text-[13px] text-danger">{loadError}</p>
      ) : !options ? (
        <div className="grid h-[200px] place-items-center">
          <Spinner className="size-5" />
        </div>
      ) : (
        <div className="flex flex-col gap-4 pb-1">
          <div className="divide-y divide-line rounded-[10px] border border-line">
            <Row label={tr("importing-also-import-progress")} help={tr("importing-include-reviews-help")}>
              <Switch label={tr("importing-also-import-progress")} checked={options.withScheduling} onChange={(withScheduling) => patch({ withScheduling })} />
            </Row>
            <Row label={tr("importing-with-deck-configs")} help={tr("importing-with-deck-configs-help")}>
              <Switch label={tr("importing-with-deck-configs")} checked={options.withDeckConfigs} onChange={(withDeckConfigs) => patch({ withDeckConfigs })} />
            </Row>
          </div>
          <div>
            <h3 className="mb-2 px-1 text-[12.5px] font-semibold text-ink-2">{tr("importing-updates")}</h3>
            <div className="divide-y divide-line rounded-[10px] border border-line">
              <Row label={tr("importing-merge-notetypes")} help={tr("importing-merge-notetypes-help")}>
                <Switch label={tr("importing-merge-notetypes")} checked={options.mergeNotetypes} onChange={(mergeNotetypes) => patch({ mergeNotetypes })} />
              </Row>
              <Row label={tr("importing-update-notes")} help={tr("importing-update-notes-help")} htmlFor="apkg-update-notes">
                <SelectField
                  id="apkg-update-notes"
                  label={tr("importing-update-notes")}
                  value={options.updateNotes}
                  choices={UPDATE_CHOICES.map(([value, key]) => ({ value, label: tr(key) }))}
                  onChange={(updateNotes) => patch({ updateNotes })}
                />
              </Row>
              <Row label={tr("importing-update-notetypes")} help={tr("importing-update-notetypes-help")} htmlFor="apkg-update-notetypes">
                <SelectField
                  id="apkg-update-notetypes"
                  label={tr("importing-update-notetypes")}
                  value={options.updateNotetypes}
                  choices={UPDATE_CHOICES.map(([value, key]) => ({ value, label: tr(key) }))}
                  onChange={(updateNotetypes) => patch({ updateNotetypes })}
                />
              </Row>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}

/** Mounted once (inside the export dialog's host). */
export function PackageImportHost() {
  const { path, serial } = usePackageImport();
  if (!path) return null;
  return <PackageImportDialog key={serial} path={path} onClose={() => usePackageImport.setState({ path: null })} />;
}
