// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import type { MessageInitShape } from "@bufbuild/protobuf";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { toast } from "sonner";

import { Button, cn, Dialog } from "@/components/ui";
import * as core from "@/lib/anki/generated/core";
import type { ExportLimitSchema } from "@/lib/anki/proto/anki/import_export_pb";
import { t, tr } from "@/lib/i18n";
import { resetQueries } from "@/lib/queries";

type Format = "apkg" | "colpkg" | "notes" | "cards";

const FORMATS: { format: Format; key: string; ext: string }[] = [
  { format: "apkg", key: "exporting-anki-deck-package", ext: "apkg" },
  { format: "colpkg", key: "exporting-anki-collection-package", ext: "colpkg" },
  { format: "notes", key: "exporting-notes-in-plain-text", ext: "txt" },
  { format: "cards", key: "exporting-cards-in-plain-text", ext: "txt" },
];

/** What to export: a Deck (or everything), or the notes selected in Browse. */
export type ExportTarget = bigint | null | { deckId?: bigint | null; noteIds?: bigint[] };

export const useExport = create<{
  open: boolean;
  deckId: bigint | null;
  noteIds: bigint[] | null;
  /** `show()`, `show(deckId)`, `show({ noteIds })` or `show(null, { noteIds })`. */
  show(target?: ExportTarget, options?: { noteIds?: bigint[] }): void;
  hide(): void;
}>((set) => ({
  open: false,
  deckId: null,
  noteIds: null,
  show: (target = null, options) => {
    const object = target !== null && typeof target === "object" ? target : null;
    const deckId = object ? (object.deckId ?? null) : (target as bigint | null);
    const noteIds = object?.noteIds ?? options?.noteIds ?? null;
    set({ open: true, deckId, noteIds: noteIds && noteIds.length ? noteIds : null });
  },
  hide: () => set({ open: false }),
}));

function Check({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={cn("flex h-8 items-center gap-2.5 text-[13px] text-ink", disabled && "opacity-45")}>
      <input
        type="checkbox"
        disabled={disabled}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 accent-[var(--accent)]"
      />
      {label}
    </label>
  );
}

const selectClass = "h-8 rounded-[8px] border border-line bg-surface px-2 text-[13px] text-ink outline-none focus:border-accent";

const exportLabel = () => tr("exporting-export").replace(/\.\.\.$|…$/, "");

/** Exports a Deck package (merges elsewhere), the whole collection (replaces elsewhere), or notes or Cards as plain text. */
export function ExportDialog() {
  const { open, deckId, noteIds, hide } = useExport();
  const [format, setFormat] = useState<Format>("apkg");
  const [deck, setDeck] = useState<string>("all");
  const [scheduling, setScheduling] = useState(true);
  const [presets, setPresets] = useState(false);
  const [media, setMedia] = useState(true);
  const [legacy, setLegacy] = useState(false);
  const [html, setHtml] = useState(true);
  const [tags, setTags] = useState(true);
  const [withDeck, setWithDeck] = useState(false);
  const [withNotetype, setWithNotetype] = useState(false);
  const [guid, setGuid] = useState(false);
  const [busy, setBusy] = useState(false);
  const { data: names } = useQuery({
    queryKey: ["deckNames"],
    queryFn: () => core.getDeckNames({ skipEmptyDefault: true, includeFiltered: false }),
    enabled: open,
  });

  // Each time the dialog opens it starts from the Deck or selection it was opened for.
  // The format is kept between openings, except that a selection cannot be a collection.
  useEffect(() => {
    if (!open) return;
    setDeck(noteIds ? "selected" : deckId !== null ? String(deckId) : "all");
    if (noteIds) setFormat((f) => (f === "colpkg" ? "apkg" : f));
  }, [open, deckId, noteIds]);

  const spec = FORMATS.find((f) => f.format === format) ?? FORMATS[0];
  const isCollection = format === "colpkg";
  const isText = format === "notes" || format === "cards";

  const limit = (): MessageInitShape<typeof ExportLimitSchema> => ({
    limit:
      deck === "selected" && noteIds
        ? { case: "noteIds", value: { noteIds } }
        : deck === "all"
          ? { case: "wholeCollection", value: {} }
          : { case: "deckId", value: BigInt(deck) },
  });

  const run = async () => {
    const deckName = deck === "selected" ? tr("exporting-selected-notes") : names?.entries.find((e) => String(e.id) === deck)?.name;
    const base = isCollection ? tr("exporting-collection") : (deckName ?? tr("exporting-all-decks")).replace(/[\\/:*?"<>|^]+/g, "-");
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "").replace(/(\d{8})(\d{4})/, "$1-$2");
    const path = await save({
      defaultPath: `${base} ${stamp}.${spec.ext}`,
      filters: [{ name: tr(spec.key), extensions: [spec.ext] }],
    });
    if (!path) return;
    setBusy(true);
    const id = toast.loading(tr("exporting-exporting-file"));
    try {
      if (isCollection) {
        await invoke("collection_export_colpkg", { outPath: path, includeMedia: media, legacy });
        resetQueries();
        toast.success(tr("exporting-collection-exported"), { id, description: path });
      } else if (format === "notes") {
        const count = await core.exportNoteCsv({ outPath: path, withHtml: html, withTags: tags, withDeck, withNotetype, withGuid: guid, limit: limit() });
        toast.success(tr("exporting-note-exported", { count: count.val }), { id, description: path });
      } else if (format === "cards") {
        const count = await core.exportCardCsv({ outPath: path, withHtml: html, limit: limit() });
        toast.success(tr("exporting-card-exported", { count: count.val }), { id, description: path });
      } else {
        const count = await core.exportAnkiPackage({
          outPath: path,
          options: { withScheduling: scheduling, withDeckConfigs: scheduling && presets, withMedia: media, legacy },
          limit: limit(),
        });
        toast.success(tr("exporting-note-exported", { count: count.val }), { id, description: path });
      }
      hide();
    } catch (error) {
      toast.error(tr("exporting-couldnt-save-file", { val: "" }).replace(/[:：]\s*$/, ""), {
        id,
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const formats = noteIds ? FORMATS.filter((f) => f.format !== "colpkg") : FORMATS;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => !o && hide()}
        title={exportLabel()}
        width={500}
        footer={
          <>
            <Button onClick={hide}>{t("common.cancel")}</Button>
            <Button variant="primary" disabled={busy} onClick={() => void run()}>
              {exportLabel()}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4 pb-1">
          <label className="flex flex-col gap-1.5 text-[12.5px] font-medium text-ink-2">
            {t("export.format")}
            <select value={format} onChange={(e) => setFormat(e.target.value as Format)} className={selectClass}>
              {formats.map((f) => (
                <option key={f.format} value={f.format}>
                  {`${tr(f.key)} (.${f.ext})`}
                </option>
              ))}
            </select>
          </label>
          {(format === "apkg" || isCollection) && (
            <p className="text-[12.5px] leading-relaxed text-ink-2">{format === "apkg" ? t("export.apkgMeans") : t("export.colpkgMeans")}</p>
          )}
          {!isCollection && (
            <label className="flex flex-col gap-1.5 text-[12.5px] font-medium text-ink-2">
              {tr("decks-deck")}
              <select value={deck} onChange={(e) => setDeck(e.target.value)} className={selectClass}>
                {noteIds ? (
                  <option value="selected">{tr("exporting-selected-notes")}</option>
                ) : (
                  <>
                    <option value="all">{tr("exporting-all-decks")}</option>
                    {names?.entries.map((entry) => (
                      <option key={String(entry.id)} value={String(entry.id)}>
                        {entry.name.replaceAll("\x1f", "::")}
                      </option>
                    ))}
                  </>
                )}
              </select>
            </label>
          )}
          <div className="flex flex-col">
            {format === "apkg" && (
              <>
                <Check label={tr("exporting-include-scheduling-information")} checked={scheduling} onChange={setScheduling} />
                <Check label={tr("exporting-include-deck-configs")} checked={scheduling && presets} disabled={!scheduling} onChange={setPresets} />
              </>
            )}
            {isText && <Check label={tr("exporting-include-html-and-media-references")} checked={html} onChange={setHtml} />}
            {format === "notes" && (
              <>
                <Check label={tr("exporting-include-tags")} checked={tags} onChange={setTags} />
                <Check label={tr("exporting-include-deck")} checked={withDeck} onChange={setWithDeck} />
                <Check label={tr("exporting-include-notetype")} checked={withNotetype} onChange={setWithNotetype} />
                <Check label={tr("exporting-include-guid")} checked={guid} onChange={setGuid} />
              </>
            )}
            {!isText && (
              <>
                <Check label={tr("exporting-include-media")} checked={media} onChange={setMedia} />
                <Check label={tr("exporting-support-older-anki-versions")} checked={legacy} onChange={setLegacy} />
              </>
            )}
          </div>
        </div>
      </Dialog>
      {/* The Deck package import dialog is mounted here so it lives once in the app shell. */}
    </>
  );
}
