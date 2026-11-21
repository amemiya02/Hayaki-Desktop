// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { CsvMetadata_DupeResolution, CsvMetadataSchema, ImportResponse_LogSchema, ImportResponse_NoteSchema } from "@/lib/anki/proto/anki/import_export_pb";

import {
  carryOver,
  columnOptions,
  forImport,
  isTextFile,
  needsRefetch,
  previewRows,
  sourceColumns,
  withDeck,
  withDeckColumn,
  withFieldColumn,
  withGlobalNotetype,
  withNotetypeColumn,
} from "./csv";
import { logRows, notesSearch, summaries, summaryCount } from "./log";

const labels = { nothing: "(Nothing)", notetype: "Note Type", deck: "Deck" };

const sample = () =>
  create(CsvMetadataSchema, {
    columnLabels: ["Front", "", "Tags"],
    preview: [{ vals: ["a", "b", "t"] }],
    notetype: { case: "globalNotetype", value: { id: 7n, fieldColumns: [1, 2] } },
    deck: { case: "deckId", value: 1n },
    tagsColumn: 3,
    guidColumn: 0,
  });

describe("column options", () => {
  it("labels columns by name, or by the first row when unnamed", () => {
    const options = columnOptions(sample(), labels);
    expect(options.map((o) => o.label)).toEqual(["(Nothing)", "1: Front", "2: b", "3: Tags"]);
    expect(options[2].shortLabel).toBe("2");
  });

  it("disables the note type and Deck columns", () => {
    const meta = withDeckColumn(withNotetypeColumn(sample(), 1), 3);
    const options = columnOptions(meta, labels);
    expect(options[1]).toMatchObject({ label: "1: Note Type", disabled: true });
    expect(options[3]).toMatchObject({ label: "3: Deck", disabled: true });
    expect(meta.tagsColumn).toBe(0);
  });

  it("offers every unclaimed column as a source", () => {
    expect(sourceColumns(withNotetypeColumn(sample(), 1), "deck")).toEqual([2, 3]);
  });
});

describe("metadata edits", () => {
  it("unmaps a field when its column becomes the Deck column", () => {
    const meta = withDeckColumn(sample(), 2);
    expect(meta.notetype.case === "globalNotetype" && meta.notetype.value.fieldColumns).toEqual([1, 0]);
  });

  it("maps a field, growing the list as needed", () => {
    const meta = withFieldColumn(sample(), 3, 2);
    expect(meta.notetype.case === "globalNotetype" && meta.notetype.value.fieldColumns).toEqual([1, 2, 0, 2]);
  });

  it("chooses the new Deck the file names with id 0", () => {
    expect(withDeck(sample(), 0n, "Imported").deck).toEqual({ case: "deckName", value: "Imported" });
    expect(withDeck(sample(), 5n, "Imported").deck).toEqual({ case: "deckId", value: 5n });
  });

  it("refetches on separator, HTML or note type changes only", () => {
    const a = sample();
    expect(needsRefetch(a, withDeck(a, 3n, null))).toBe(false);
    expect(needsRefetch(a, { ...a, isHtml: true })).toBe(true);
    expect(needsRefetch(a, withNotetypeColumn(a, 1))).toBe(false);
    expect(needsRefetch(a, withGlobalNotetype(a, 8n))).toBe(true);
    expect(needsRefetch(a, withGlobalNotetype(a, 7n))).toBe(false);
  });

  it("carries tags and duplicate handling across a refetch", () => {
    const before = create(CsvMetadataSchema, { globalTags: ["x"], updatedTags: ["y"], dupeResolution: CsvMetadata_DupeResolution.DUPLICATE });
    const after = carryOver(sample(), before);
    expect(after.globalTags).toEqual(["x"]);
    expect(after.dupeResolution).toBe(CsvMetadata_DupeResolution.DUPLICATE);
  });

  it("drops the preview before importing, and truncates wide previews", () => {
    expect(forImport(sample()).preview).toEqual([]);
    expect(previewRows(sample(), 2)).toEqual({ rows: [["a", "b"]], truncated: true });
  });

  it("recognises text files", () => {
    expect(isTextFile("C:\\x\\Words.TSV")).toBe(true);
    expect(isTextFile("deck.apkg")).toBe(false);
  });
});

describe("import log", () => {
  const note = (nid: bigint) => create(ImportResponse_NoteSchema, { id: { nid }, fields: ["f"] });

  it("groups first-field matches by the duplicate handling", () => {
    const log = create(ImportResponse_LogSchema, {
      new: [note(1n)],
      firstFieldMatch: [note(2n)],
      missingDeck: [note(3n)],
      dupeResolution: CsvMetadata_DupeResolution.PRESERVE,
    });
    const list = summaries(log);
    expect(list.map(summaryCount)).toEqual([1, 1, 0, 1]);
    expect(logRows(list).map((r) => r.queue.reason)).toEqual([
      "importing-added-new-note",
      "importing-existing-note-skipped",
      "importing-note-skipped-due-to-missing-deck",
    ]);
  });

  it("counts duplicates added as new notes", () => {
    const log = create(ImportResponse_LogSchema, { firstFieldMatch: [note(2n)], dupeResolution: CsvMetadata_DupeResolution.DUPLICATE });
    expect(summaryCount(summaries(log)[0])).toBe(1);
  });

  it("searches notes by id", () => {
    expect(notesSearch([note(1n), note(22n)])).toBe("nid:1,22");
  });
});
