// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Importing a CSV or text file with field mapping (upstream
 * ts/routes/import-csv), then the import log (ts/routes/import-page).
 */
import { AlertTriangle, FileText, Info } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { TagEditor } from "@/components/editor/TagEditor";
import { Button, cn, Kbd, Spinner } from "@/components/ui";
import * as core from "@/lib/anki/generated/core";
import type { DeckNameId } from "@/lib/anki/proto/anki/decks_pb";
import {
  CsvMetadata_Delimiter as Delimiter,
  CsvMetadata_DupeResolution as DupeResolution,
  CsvMetadata_MatchScope as MatchScope,
  type CsvMetadata,
  type ImportResponse,
  type ImportResponse_Note,
} from "@/lib/anki/proto/anki/import_export_pb";
import type { NotetypeNameId } from "@/lib/anki/proto/anki/notetypes_pb";
import { CoreError } from "@/lib/anki/transport";
import { tr } from "@/lib/i18n";
import { useNav } from "@/lib/nav";
import { ti } from "@/lib/strings/import";
import { HelpButton, SelectField, Switch, type Choice } from "@/screens/deck-options/controls";

import {
  carryOver,
  columnOptions,
  deckColumn,
  deckId,
  fileName,
  forImport,
  globalNotetypeId,
  needsRefetch,
  notetypeColumn,
  previewRows,
  sourceColumns,
  withDeck,
  withDeckColumn,
  withFieldColumn,
  withGlobalNotetype,
  withNotetypeColumn,
} from "./csv";
import { ImportLog } from "./ImportLog";
import { notesSearch } from "./log";
import { withImportProgress } from "./progress";

const DELIMITERS: [Delimiter, string][] = [
  [Delimiter.TAB, "importing-tab"],
  [Delimiter.PIPE, "importing-pipe"],
  [Delimiter.SEMICOLON, "importing-semicolon"],
  [Delimiter.COLON, "importing-colon"],
  [Delimiter.COMMA, "importing-comma"],
  [Delimiter.SPACE, "studying-space"],
];

const DUPE_RESOLUTIONS: [DupeResolution, string][] = [
  [DupeResolution.UPDATE, "importing-update"],
  [DupeResolution.PRESERVE, "importing-preserve"],
  [DupeResolution.DUPLICATE, "importing-duplicate"],
];

const MATCH_SCOPES: [MatchScope, string][] = [
  [MatchScope.NOTETYPE, "notetypes-notetype"],
  [MatchScope.NOTETYPE_AND_DECK, "importing-notetype-and-deck"],
];

const MAX_PREVIEW_COLUMNS = 1000;

function choicesOf<T extends number>(list: [T, string][]): Choice<T>[] {
  return list.map(([value, key]) => ({ value, label: tr(key) }));
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/* ------------------------------ Layout ------------------------------ */

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-title`} className="pt-8 first:pt-0">
      <h2 id={`${id}-title`} className="mb-2.5 px-1 text-[13px] font-semibold text-ink-2">
        {title}
      </h2>
      <div className="divide-y divide-line overflow-hidden rounded-[12px] border border-line bg-surface">{children}</div>
    </section>
  );
}

function Row({ label, help, htmlFor, children, below }: { label: string; help?: string; htmlFor?: string; children?: ReactNode; below?: ReactNode }) {
  return (
    <div>
      <div className="flex min-h-[52px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5">
        <div className="flex min-w-[180px] flex-1 items-center gap-1.5">
          <label htmlFor={htmlFor} className="text-[13.5px] text-ink">
            {label}
          </label>
          {help && <HelpButton title={label} text={help} />}
        </div>
        {children && <div className="ml-auto flex items-center gap-1.5">{children}</div>}
      </div>
      {below && <div className="px-4 pb-3">{below}</div>}
    </div>
  );
}

function Notice({ text, tone = "info" }: { text: string; tone?: "info" | "warning" }) {
  const Icon = tone === "info" ? Info : AlertTriangle;
  return (
    <p className={cn("flex items-start gap-2 px-4 py-2.5 text-[12.5px] leading-snug", tone === "info" ? "text-ink-2" : "text-danger")}>
      <Icon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      <span className="selectable">{text}</span>
    </p>
  );
}

/* ------------------------------ Screen ------------------------------ */

interface Sources {
  notetypes: NotetypeNameId[];
  decks: DeckNameId[];
  /** The new Deck named by the file, if any; chosen with id 0. */
  newDeckName: string | null;
}

type Phase =
  | { name: "loading" }
  | { name: "load-error"; message: string }
  | { name: "options" }
  | { name: "importing"; progress: string }
  | { name: "failed"; message: string }
  | { name: "done"; response: ImportResponse };

/** Import a CSV or text file with field mapping. */
export function ImportCsvScreen({ path }: { path: string }) {
  const go = useNav((s) => s.go);
  const back = useNav((s) => s.back);
  const [phase, setPhase] = useState<Phase>({ name: "loading" });
  const [meta, setMeta] = useState<CsvMetadata | null>(null);
  const [sources, setSources] = useState<Sources | null>(null);
  const [fieldNames, setFieldNames] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const request = useRef(0);

  useEffect(() => {
    let live = true;
    setPhase({ name: "loading" });
    void (async () => {
      try {
        const [metadata, notetypes, decks] = await Promise.all([
          core.getCsvMetadata({ path }),
          core.getNotetypeNames(),
          core.getDeckNames({ skipEmptyDefault: false, includeFiltered: false }),
        ]);
        if (!live) return;
        setSources({
          notetypes: notetypes.entries,
          decks: decks.entries,
          newDeckName: metadata.deck.case === "deckName" ? metadata.deck.value : null,
        });
        setMeta(metadata);
        setPhase({ name: "options" });
      } catch (error) {
        if (live) setPhase({ name: "load-error", message: errorText(error) });
      }
    })();
    return () => {
      live = false;
    };
  }, [path, attempt]);

  const ntid = meta ? globalNotetypeId(meta) : null;
  useEffect(() => {
    if (ntid === null) {
      setFieldNames([]);
      return;
    }
    let live = true;
    core
      .getFieldNames({ ntid })
      .then((list) => live && setFieldNames(list.vals))
      .catch(() => live && setFieldNames([]));
    return () => {
      live = false;
    };
  }, [ntid]);

  /** Applies an edit; separator, HTML and note type changes reload the metadata as upstream does. */
  const update = useCallback(
    (next: CsvMetadata) => {
      if (!meta) return;
      if (!needsRefetch(meta, next)) {
        setMeta(next);
        return;
      }
      const id = ++request.current;
      setMeta(next);
      setRefreshing(true);
      setRefreshError(null);
      core
        .getCsvMetadata({
          path,
          delimiter: next.delimiter,
          notetypeId: globalNotetypeId(next) ?? undefined,
          deckId: deckId(next) || undefined,
          isHtml: next.isHtml,
        })
        .then((fresh) => {
          if (id === request.current) setMeta(carryOver(fresh, next));
        })
        .catch((error: unknown) => {
          if (id === request.current) setRefreshError(errorText(error));
        })
        .finally(() => {
          if (id === request.current) setRefreshing(false);
        });
    },
    [meta, path],
  );

  const run = async () => {
    if (!meta || phase.name !== "options" || refreshing) return;
    setPhase({ name: "importing", progress: tr("importing-importing-file") });
    try {
      const response = await withImportProgress(
        () => core.importCsv({ path, metadata: forImport(meta) }),
        (progress) => setPhase((p) => (p.name === "importing" ? { name: "importing", progress } : p)),
      );
      setPhase({ name: "done", response });
    } catch (error) {
      if (error instanceof CoreError && error.isInterrupted) setPhase({ name: "options" });
      else setPhase({ name: "failed", message: errorText(error) });
    }
  };
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        // After the focused field has committed its value.
        setTimeout(() => void runRef.current(), 0);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const browse = (notes: ImportResponse_Note[]) => go({ name: "browse", search: notesSearch(notes) });

  const header = (
    <header className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-3 border-b border-line px-5 py-3">
      <FileText className="size-5 shrink-0 text-ink-3" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[15px] font-semibold text-ink" title={path}>
          {fileName(path)}
        </h1>
        <p className="selectable truncate text-[12px] text-ink-3" title={path}>
          {path}
        </p>
      </div>
      {phase.name === "options" && (
        <Button variant="primary" disabled={refreshing || !meta} onClick={() => void run()} title={`${tr("actions-import")} (Ctrl+Enter)`}>
          {tr("actions-import")}
          <Kbd className="border-transparent bg-[color-mix(in_oklab,var(--on-accent)_18%,transparent)] text-on-accent">Ctrl+Enter</Kbd>
        </Button>
      )}
      {phase.name === "done" && (
        <Button variant="primary" onClick={back}>
          {tr("actions-close")}
        </Button>
      )}
    </header>
  );

  if (phase.name === "loading") {
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="grid flex-1 place-items-center" aria-busy="true">
          <Spinner className="size-5" />
        </div>
      </div>
    );
  }

  if (phase.name === "load-error" || phase.name === "failed") {
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="grid flex-1 place-items-center px-8">
          <div className="max-w-[460px] text-center">
            <h2 className="text-[15px] font-semibold text-ink">{phase.name === "failed" ? ti("failed") : ti("loadError")}</h2>
            <p className="selectable mt-1.5 whitespace-pre-line text-[13px] text-ink-2">{phase.message}</p>
            <div className="mt-5 flex justify-center gap-2">
              <Button onClick={back}>{tr("actions-close")}</Button>
              <Button variant="primary" onClick={() => (phase.name === "failed" ? setPhase({ name: "options" }) : setAttempt((a) => a + 1))}>
                {ti("retry")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (phase.name === "importing") {
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="grid flex-1 place-items-center px-8" aria-busy="true">
          <div className="flex w-[360px] flex-col items-center gap-4 text-center">
            <Spinner className="size-6" />
            <p className="tabular min-h-[20px] text-[13px] text-ink-2" aria-live="polite">
              {phase.progress}
            </p>
            <Button size="sm" onClick={() => void core.setWantsAbort()}>
              {ti("abort")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (phase.name === "done") {
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[820px] px-8 pb-16 pt-8">
            <ImportLog response={phase.response} onBrowse={browse} maxTableHeight={560} />
          </div>
        </div>
      </div>
    );
  }

  if (!meta || !sources) return null;
  return (
    <div className="flex h-full flex-col">
      {header}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[820px] px-8 pb-16 pt-8">
          <CsvOptions meta={meta} sources={sources} fieldNames={fieldNames} refreshing={refreshing} refreshError={refreshError} onChange={update} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Options ------------------------------ */

function CsvOptions({
  meta,
  sources,
  fieldNames,
  refreshing,
  refreshError,
  onChange,
}: {
  meta: CsvMetadata;
  sources: Sources;
  fieldNames: string[];
  refreshing: boolean;
  refreshError: string | null;
  onChange: (meta: CsvMetadata) => void;
}) {
  const options = useMemo(
    () => columnOptions(meta, { nothing: tr("change-notetype-nothing"), notetype: tr("notetypes-notetype"), deck: tr("decks-deck") }),
    [meta],
  );
  const columnLabel = (column: number) => options[column]?.label ?? String(column);

  // Note type: one for every row (index into the list) or read from a column (negative column number).
  const ntColumn = notetypeColumn(meta);
  const ntIndex = sources.notetypes.findIndex((n) => n.id === globalNotetypeId(meta));
  const notetypeValue = ntColumn !== null ? -ntColumn : ntIndex;
  const notetypeChoices: Choice<number>[] = [
    ...sources.notetypes.map((n, i) => ({ value: i, label: n.name })),
    ...sourceColumns(meta, "notetype").map((c) => ({ value: -c, label: ti("fromColumn", { column: columnLabel(c) }) })),
  ];

  // Deck: an existing Deck (index), the new Deck the file names (decks.length), or a column (negative).
  const dkColumn = deckColumn(meta);
  const newDeckValue = sources.decks.length;
  const deckValue =
    dkColumn !== null ? -dkColumn : meta.deck.case === "deckName" ? newDeckValue : sources.decks.findIndex((d) => d.id === deckId(meta));
  const deckChoices: Choice<number>[] = [
    ...sources.decks.map((d, i) => ({ value: i, label: d.name })),
    ...(sources.newDeckName ? [{ value: newDeckValue, label: sources.newDeckName }] : []),
    ...sourceColumns(meta, "deck").map((c) => ({ value: -c, label: ti("fromColumn", { column: columnLabel(c) }) })),
  ];

  const { rows, truncated } = previewRows(meta, MAX_PREVIEW_COLUMNS);
  const fieldColumns = meta.notetype.case === "globalNotetype" ? meta.notetype.value.fieldColumns : [];

  return (
    <div aria-busy={refreshing}>
      <Section id="csv-file" title={tr("importing-file")}>
        <Row
          label={meta.forceDelimiter ? tr("importing-field-separator") : tr("importing-field-separator-guessed")}
          help={tr("importing-field-separator-help")}
          htmlFor="csv-delimiter"
        >
          <SelectField
            id="csv-delimiter"
            label={tr("importing-field-separator")}
            value={meta.delimiter}
            choices={choicesOf(DELIMITERS).map((c) => ({ ...c, disabled: meta.forceDelimiter && c.value !== meta.delimiter }))}
            onChange={(delimiter) => onChange({ ...meta, delimiter })}
          />
        </Row>
        <Row label={tr("importing-allow-html-in-fields")} help={tr("importing-allow-html-in-fields-help")}>
          <span className={cn(meta.forceIsHtml && "pointer-events-none opacity-45")} aria-disabled={meta.forceIsHtml}>
            <Switch label={tr("importing-allow-html-in-fields")} checked={meta.isHtml} onChange={(isHtml) => !meta.forceIsHtml && onChange({ ...meta, isHtml })} />
          </span>
        </Row>
        <div className="px-4 py-3">
          <div className="mb-2 flex items-center gap-2 text-[12.5px] font-medium text-ink-2">
            {ti("preview")}
            {refreshing && <Spinner className="size-3.5" />}
          </div>
          {rows.length === 0 ? (
            <p className="text-[12.5px] text-ink-3">{ti("noPreview")}</p>
          ) : (
            <div className={cn("max-h-[260px] overflow-auto rounded-[8px] border border-line transition-opacity", refreshing && "opacity-60")}>
              <table className="min-w-full border-collapse text-[12.5px]">
                <thead className="sticky top-0 bg-surface-2">
                  <tr>
                    {options.slice(1, MAX_PREVIEW_COLUMNS + 1).map((o) => (
                      <th key={o.value} scope="col" className="max-w-[220px] truncate border-b border-line px-2.5 py-1.5 text-left font-medium text-ink-2">
                        {o.shortLabel ?? o.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, r) => (
                    <tr key={r} className="border-b border-line last:border-b-0">
                      {row.map((cell, c) => (
                        <td key={c} title={cell} className="selectable max-w-[220px] truncate px-2.5 py-1.5 text-ink">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {truncated && <Notice tone="warning" text={tr("importing-preview-truncated", { count: MAX_PREVIEW_COLUMNS })} />}
        {refreshError && <Notice tone="warning" text={refreshError} />}
      </Section>

      <Section id="csv-import" title={tr("importing-import-options")}>
        <Row label={tr("notetypes-notetype")} help={tr("importing-notetype-help")} htmlFor="csv-notetype">
          <SelectField
            id="csv-notetype"
            label={tr("notetypes-notetype")}
            value={notetypeValue}
            choices={notetypeChoices}
            onChange={(v) => onChange(v < 0 ? withNotetypeColumn(meta, -v) : withGlobalNotetype(meta, sources.notetypes[v].id))}
          />
        </Row>
        <Row label={tr("decks-deck")} help={tr("importing-deck-help")} htmlFor="csv-deck">
          <SelectField
            id="csv-deck"
            label={tr("decks-deck")}
            value={deckValue}
            choices={deckChoices}
            onChange={(v) =>
              onChange(v < 0 ? withDeckColumn(meta, -v) : v === newDeckValue ? withDeck(meta, 0n, sources.newDeckName) : withDeck(meta, sources.decks[v].id, null))
            }
          />
        </Row>
        {meta.deck.case === "deckName" && <Notice text={tr("importing-new-deck-will-be-created", { name: meta.deck.value })} />}
        <Row label={tr("importing-existing-notes")} help={tr("importing-existing-notes-help")} htmlFor="csv-dupes">
          <SelectField
            id="csv-dupes"
            label={tr("importing-existing-notes")}
            value={meta.dupeResolution}
            choices={choicesOf(DUPE_RESOLUTIONS)}
            onChange={(dupeResolution) => onChange({ ...meta, dupeResolution })}
          />
        </Row>
        <Row label={tr("importing-match-scope")} help={tr("importing-match-scope-help")} htmlFor="csv-scope">
          <SelectField
            id="csv-scope"
            label={tr("importing-match-scope")}
            value={meta.matchScope}
            choices={choicesOf(MATCH_SCOPES)}
            onChange={(matchScope) => onChange({ ...meta, matchScope })}
          />
        </Row>
        <Row
          label={tr("importing-tag-all-notes")}
          help={tr("importing-tag-all-notes-help")}
          below={<TagEditor tags={meta.globalTags} onChange={(globalTags) => onChange({ ...meta, globalTags })} />}
        />
        <Row
          label={tr("importing-tag-updated-notes")}
          help={tr("importing-tag-updated-notes-help")}
          below={<TagEditor tags={meta.updatedTags} onChange={(updatedTags) => onChange({ ...meta, updatedTags })} />}
        />
      </Section>

      <Section id="csv-mapping" title={tr("importing-field-mapping")}>
        {meta.notetype.case === "globalNotetype" &&
          fieldNames.map((name, index) => (
            <Row key={`${index}-${name}`} label={name} htmlFor={`csv-field-${index}`}>
              <SelectField
                id={`csv-field-${index}`}
                label={name}
                value={fieldColumns[index] ?? 0}
                // The first field must come from some column.
                choices={(index === 0 ? options.slice(1) : options).map((o) => ({ value: o.value, label: o.label, disabled: o.disabled }))}
                onChange={(column) => onChange(withFieldColumn(meta, index, column))}
              />
            </Row>
          ))}
        <Row label={tr("editing-tags")} htmlFor="csv-tags-column">
          <SelectField
            id="csv-tags-column"
            label={tr("editing-tags")}
            value={meta.tagsColumn}
            choices={options.map((o) => ({ value: o.value, label: o.label, disabled: o.disabled }))}
            onChange={(tagsColumn) => onChange({ ...meta, tagsColumn })}
          />
        </Row>
      </Section>
    </div>
  );
}
