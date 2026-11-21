// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { create } from "@bufbuild/protobuf";
import { expect, test } from "vitest";

import { NotetypeSchema } from "@/lib/anki/proto/anki/notetypes_pb";

import { fieldContext, fieldOptions } from "./completion";
import { renameField } from "./model";
import { bodyClass, clozeNumbers, playButtons, templateForPreview, typeAnswerPreview } from "./preview";

test("typing boxes show an example, and extra ones a warning", () => {
  const q = typeAnswerPreview("a [[type:Back]] b [[type:Other]]", "question", "", "W");
  expect(q).toContain("value='example'");
  expect(q).toContain("<center><b>W</b></center>");
  const a = typeAnswerPreview("x<hr id=answer>[[type:Back]]", "answer", "CMP", "W");
  expect(a).toBe("x<hr id=answer>CMP");
  expect(typeAnswerPreview("plain", "question", "", "W")).toBe("plain");
});

test("cloze numbers come from the fields of the Note", () => {
  expect(clozeNumbers(["{{c2::a}} {{c1::b}}", "{{c2::c}}"])).toEqual([1, 2]);
  expect(clozeNumbers(["none"])).toEqual([1]);
});

test("the preview maps renamed fields back to their saved names", () => {
  const original = create(NotetypeSchema, {
    fields: [{ name: "Front", ord: { val: 0 } }],
    templates: [{ name: "Card 1", ord: { val: 0 }, config: { qFormat: "{{Front}}", aFormat: "{{FrontSide}}" } }],
  });
  const edited = renameField(original, 0, "Q");
  expect(edited.templates[0].config?.qFormat).toBe("{{Q}}");
  expect(templateForPreview(original, edited, 0).config?.qFormat).toBe("{{Front}}");
});

test("play references become replay buttons and body classes follow the Card", () => {
  expect(playButtons("[anki:play:q:0]", "Play")).toContain('data-play="q:0"');
  expect(bodyClass(1, true)).toBe("card card2 nightMode night_mode");
});

test("completion finds the name being typed inside {{ }}", () => {
  expect(fieldContext("abc {{Fr", "")).toEqual({ from: 6, typed: "Fr", closed: false });
  expect(fieldContext("{{#Fr", "}}")).toEqual({ from: 3, typed: "Fr", closed: true });
  expect(fieldContext("{{text:B", "")).toEqual({ from: 7, typed: "B", closed: false });
  expect(fieldContext("{{Front}} x", "")).toBeNull();
  expect(fieldOptions(["Front", "Back"], "f", false).map((o) => o.label)).toEqual(["Front", "FrontSide"]);
});
