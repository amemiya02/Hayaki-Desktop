import { create } from "@bufbuild/protobuf";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { OpChangesSchema, OpChangesWithCountSchema } from "./proto/anki/collection_pb";
import { AddNoteResponseSchema } from "./proto/anki/notes_pb";
import { extractOpChanges } from "./transport";

describe("extractOpChanges", () => {
  it("finds OpChanges at the top level", () => {
    const changes = create(OpChangesSchema, { card: true });
    expect(extractOpChanges(changes, 1)?.card).toBe(true);
  });

  it("finds OpChanges nested inside an AddNoteResponse", () => {
    const response = create(AddNoteResponseSchema, {
      noteId: 5n,
      changes: create(OpChangesWithCountSchema, { count: 1, changes: { note: true, studyQueues: true } }),
    });
    const found = extractOpChanges(response, 3);
    expect(found?.note).toBe(true);
    expect(found?.studyQueues).toBe(true);
  });

  it("does not search deeper than the reported level", () => {
    const response = create(AddNoteResponseSchema, {
      changes: create(OpChangesWithCountSchema, { changes: { note: true } }),
    });
    expect(extractOpChanges(response, 1)).toBeUndefined();
  });
});
