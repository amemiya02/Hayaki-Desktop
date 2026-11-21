// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { create } from "@bufbuild/protobuf";
import { expect, test } from "vitest";

import { NotetypeSchema, type Notetype } from "@/lib/anki/proto/anki/notetypes_pb";

import {
  addField,
  addTemplate,
  checkFieldName,
  copyNotetype,
  fieldsOnTemplate,
  flipTemplate,
  mapFieldsInTemplate,
  moveField,
  moveTemplate,
  newCardName,
  removeField,
  renamedFields,
  renameField,
  renameFieldInTemplate,
  requiresFullSync,
  setSortField,
  snapshot,
} from "./model";

function basic(): Notetype {
  return create(NotetypeSchema, {
    id: 1n,
    name: "Basic",
    config: { css: ".card {}", sortFieldIdx: 0 },
    fields: [
      { name: "Front", ord: { val: 0 }, config: { fontName: "Arial", fontSize: 20 } },
      { name: "Back", ord: { val: 1 }, config: { fontName: "Arial", fontSize: 20 } },
    ],
    templates: [{ name: "Card 1", ord: { val: 0 }, config: { qFormat: "{{Front}}", aFormat: "{{FrontSide}}<hr id=answer>{{Back}}" } }],
  });
}

test("field names are checked as upstream", () => {
  const nt = basic();
  expect(checkFieldName(nt, "  Extra ")).toEqual({ name: "Extra" });
  expect(checkFieldName(nt, 'Ex"tra')).toEqual({ name: "Extra" });
  expect(checkFieldName(nt, "#x")).toEqual({ problem: "fields-name-first-letter-not-valid" });
  expect(checkFieldName(nt, "a:b")).toEqual({ problem: "fields-name-invalid-letter" });
  expect(checkFieldName(nt, "a{b")).toEqual({ problem: "fields-name-invalid-letter" });
  expect(checkFieldName(nt, "back")).toEqual({ problem: "fields-that-field-name-is-already-used" });
  expect(checkFieldName(nt, "front", "Front")).toEqual({ problem: "unchanged" });
  expect(checkFieldName(nt, "   ")).toEqual({ problem: "empty" });
});

test("renaming a field rewrites every kind of reference", () => {
  const text = "{{Front}} {{#Front}}x{{/Front}} {{^Front}}y{{/Front}} {{text:Front}} {{cloze:Front}} {{Frontier}} {{FrontSide}}";
  expect(renameFieldInTemplate(text, "Front", "Q")).toBe(
    "{{Q}} {{#Q}}x{{/Q}} {{^Q}}y{{/Q}} {{text:Q}} {{cloze:Q}} {{Frontier}} {{FrontSide}}",
  );
});

test("names can be swapped in one pass", () => {
  const swap = new Map([
    ["A", "B"],
    ["B", "A"],
  ]);
  expect(mapFieldsInTemplate("{{A}}-{{B}}", swap)).toBe("{{B}}-{{A}}");
});

test("renameField updates the working templates and is reported against the saved name", () => {
  const original = basic();
  const edited = renameField(original, 0, "Question");
  expect(edited.templates[0].config?.qFormat).toBe("{{Question}}");
  expect(original.templates[0].config?.qFormat).toBe("{{Front}}");
  expect(renamedFields(original, edited)).toEqual(new Map([["Question", "Front"]]));
  expect(requiresFullSync(original, edited)).toBe(false);
});

test("adding, removing or reordering fields needs a one-way sync; options do not", () => {
  const original = basic();
  expect(requiresFullSync(original, copyNotetype(original))).toBe(false);
  expect(requiresFullSync(original, addField(original, "Extra"))).toBe(true);
  expect(requiresFullSync(original, removeField(original, 1))).toBe(true);
  expect(requiresFullSync(original, moveField(original, 0, 1))).toBe(true);
  expect(requiresFullSync(original, setSortField(original, 1))).toBe(true);
  expect(requiresFullSync(original, addTemplate(original, "Card 2", 0))).toBe(true);
  const fonts = copyNotetype(original);
  fonts.fields[0].config!.fontSize = 30;
  expect(requiresFullSync(original, fonts)).toBe(false);
  expect(snapshot(fonts)).not.toBe(snapshot(original));
});

test("the sort field follows its field when fields move or are removed", () => {
  const nt = setSortField(addField(basic(), "Extra"), 1);
  expect(moveField(nt, 1, 0).config?.sortFieldIdx).toBe(0);
  expect(moveField(nt, 0, 2).config?.sortFieldIdx).toBe(0);
  expect(removeField(nt, 0).config?.sortFieldIdx).toBe(0);
  expect(removeField(nt, 1).config?.sortFieldIdx).toBe(0);
  expect(removeField(nt, 2).config?.sortFieldIdx).toBe(1);
});

test("new Card Templates copy the current one and take a free name", () => {
  const nt = addTemplate(basic(), "Card 2", 0);
  expect(nt.templates[1].config?.qFormat).toBe("{{Front}}");
  expect(nt.templates[1].ord).toBeUndefined();
  expect(newCardName(nt, (n) => `Card ${n}`)).toBe("Card 3");
  expect(moveTemplate(nt, 1, 0).templates[0].name).toBe("Card 2");
});

test("flip swaps front and back around the answer line", () => {
  expect(flipTemplate("{{Front}}", "{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}")).toEqual({
    qFormat: "{{Back}}",
    aFormat: "{{FrontSide}}\n\n<hr id=answer>\n\n{{Front}}",
  });
  expect(flipTemplate("{{Front}}", "{{Back}}")).toBeNull();
});

test("fields on a template are listed once", () => {
  expect(fieldsOnTemplate("{{Front}} {{text:Back}} {{Front}} {{Tags}}", ["Front", "Back"])).toEqual(["Front", "Back"]);
});
