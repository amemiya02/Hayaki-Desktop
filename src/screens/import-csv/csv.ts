// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * CSV import metadata edits, mirroring upstream ts/routes/import-csv/lib.ts.
 * Column indices are one-based; 0 means "nothing".
 */
import { clone } from "@bufbuild/protobuf";

import { CsvMetadataSchema, type CsvMetadata } from "@/lib/anki/proto/anki/import_export_pb";

export interface ColumnOption {
  label: string;
  /** Shorter header for the preview table, when the label came from the first row. */
  shortLabel?: string;
  value: number;
  disabled: boolean;
}

export interface ColumnLabels {
  nothing: string;
  notetype: string;
  deck: string;
}

export function notetypeColumn(meta: CsvMetadata): number | null {
  return meta.notetype.case === "notetypeColumn" ? meta.notetype.value : null;
}

export function deckColumn(meta: CsvMetadata): number | null {
  return meta.deck.case === "deckColumn" ? meta.deck.value : null;
}

export function globalNotetypeId(meta: CsvMetadata): bigint | null {
  return meta.notetype.case === "globalNotetype" ? meta.notetype.value.id : null;
}

export function deckId(meta: CsvMetadata): bigint {
  return meta.deck.case === "deckId" ? meta.deck.value : 0n;
}

function option(label: string, disabled: boolean, index: number, short?: boolean): ColumnOption {
  return { label: label ? `${index}: ${label}` : String(index), shortLabel: short ? String(index) : undefined, value: index, disabled };
}

/** "Nothing" followed by one option per column; columns used for the note type, Deck or GUID cannot be mapped. */
export function columnOptions(meta: CsvMetadata, labels: ColumnLabels): ColumnOption[] {
  const nt = notetypeColumn(meta);
  const dk = deckColumn(meta);
  return [
    { label: labels.nothing, value: 0, disabled: false },
    ...meta.columnLabels.map((label, i) => {
      const index = i + 1;
      if (index === nt) return option(labels.notetype, true, index);
      if (index === dk) return option(labels.deck, true, index);
      if (index === meta.guidColumn) return option("GUID", true, index);
      if (label === "") return option(meta.preview[0]?.vals[i] ?? "", false, index, true);
      return option(label, false, index);
    }),
  ];
}

/** The columns a note type or Deck can be read from: every column not otherwise claimed. */
export function sourceColumns(meta: CsvMetadata, claimedBy: "notetype" | "deck"): number[] {
  const other = claimedBy === "notetype" ? deckColumn(meta) : notetypeColumn(meta);
  const out: number[] = [];
  for (let index = 1; index <= meta.columnLabels.length; index++) {
    if (index !== other && index !== meta.guidColumn) out.push(index);
  }
  return out;
}

export function withNotetypeColumn(meta: CsvMetadata, column: number): CsvMetadata {
  const next = clone(CsvMetadataSchema, meta);
  next.notetype = { case: "notetypeColumn", value: column };
  unmapColumn(next, column);
  return next;
}

export function withDeckColumn(meta: CsvMetadata, column: number): CsvMetadata {
  const next = clone(CsvMetadataSchema, meta);
  next.deck = { case: "deckColumn", value: column };
  unmapColumn(next, column);
  return next;
}

/** Chooses an existing Deck, or (with 0) the new Deck the file names. */
export function withDeck(meta: CsvMetadata, id: bigint, newDeckName: string | null): CsvMetadata {
  const next = clone(CsvMetadataSchema, meta);
  next.deck = id === 0n && newDeckName ? { case: "deckName", value: newDeckName } : { case: "deckId", value: id };
  return next;
}

export function withFieldColumn(meta: CsvMetadata, field: number, column: number): CsvMetadata {
  if (meta.notetype.case !== "globalNotetype") return meta;
  const next = clone(CsvMetadataSchema, meta);
  if (next.notetype.case !== "globalNotetype") return meta;
  const columns = next.notetype.value.fieldColumns;
  while (columns.length <= field) columns.push(0);
  columns[field] = column;
  return next;
}

/** A column now used for the note type or Deck can no longer feed a field or the tags. */
function unmapColumn(meta: CsvMetadata, column: number) {
  if (meta.notetype.case === "globalNotetype") {
    meta.notetype.value.fieldColumns = meta.notetype.value.fieldColumns.map((c) => (c === column ? 0 : c));
  }
  if (meta.tagsColumn === column) meta.tagsColumn = 0;
}

/**
 * Whether changing from `before` to `after` needs fresh metadata from the core, as upstream decides.
 * Reading the note type from a column is a local change: the core would put its default note type back.
 */
export function needsRefetch(before: CsvMetadata, after: CsvMetadata): boolean {
  const id = globalNotetypeId(after);
  return before.delimiter !== after.delimiter || before.isHtml !== after.isHtml || (id !== null && id !== globalNotetypeId(before));
}

/** Switches to one note type for every row; the core then supplies its field mapping. */
export function withGlobalNotetype(meta: CsvMetadata, id: bigint): CsvMetadata {
  const next = clone(CsvMetadataSchema, meta);
  next.notetype = { case: "globalNotetype", value: { $typeName: "anki.import_export.CsvMetadata.MappedNotetype", id, fieldColumns: [] } };
  return next;
}

/** Carries what the person chose across a refetch that would otherwise reset it. */
export function carryOver(fresh: CsvMetadata, previous: CsvMetadata): CsvMetadata {
  const next = clone(CsvMetadataSchema, fresh);
  next.globalTags = [...previous.globalTags];
  next.updatedTags = [...previous.updatedTags];
  next.dupeResolution = previous.dupeResolution;
  next.matchScope = previous.matchScope;
  return next;
}

/** Preview rows, cut to at most `maxColumns` columns. */
export function previewRows(meta: CsvMetadata, maxColumns = 1000): { rows: string[][]; truncated: boolean } {
  let truncated = false;
  const rows = meta.preview.map((row) => {
    if (row.vals.length > maxColumns) {
      truncated = true;
      return row.vals.slice(0, maxColumns);
    }
    return row.vals;
  });
  return { rows, truncated };
}

/** The metadata sent to the import: the preview is only for display. */
export function forImport(meta: CsvMetadata): CsvMetadata {
  const next = clone(CsvMetadataSchema, meta);
  next.preview = [];
  return next;
}

const TEXT_EXTENSIONS = ["csv", "tsv", "txt"];

export function isTextFile(path: string): boolean {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  return TEXT_EXTENSIONS.includes(ext);
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
