// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { create } from "@bufbuild/protobuf";
import { expect, test } from "vitest";

import { ChangeNotetypeInfoSchema } from "@/lib/anki/proto/anki/notetypes_pb";

import { fromInfo, MapContext, negativeOneToNull, setOld, toRequest, unchanged, unusedItems } from "./model";

function info(newNotetypeId = 1n) {
  return create(ChangeNotetypeInfoSchema, {
    oldFieldNames: ["Front", "Back"],
    oldTemplateNames: ["Card 1", "Card 2"],
    newFieldNames: ["Front", "Back"],
    newTemplateNames: ["Card 1", "Card 2"],
    oldNotetypeName: "Basic",
    input: { oldNotetypeId: 1n, newNotetypeId, newFields: [0, 1], newTemplates: [0, 1] },
  });
}

test("-1 means Nothing", () => {
  expect(negativeOneToNull([0, -1, 2])).toEqual([0, null, 2]);
});

test("the same Note Type with the identity mapping is unchanged", () => {
  expect(unchanged(fromInfo(info()))).toBe(true);
  expect(unchanged(fromInfo(info(2n)))).toBe(false);
});

test("fields can repeat; Card Templates move to one place", () => {
  let state = fromInfo(info());
  state = setOld(state, MapContext.Field, 1, 0);
  expect(state.fields).toEqual([0, 0]);
  expect(unusedItems(state, MapContext.Field)).toEqual(["Back"]);
  state = setOld(state, MapContext.Template, 1, 0);
  expect(state.templates).toEqual([null, 0]);
  expect(unusedItems(state, MapContext.Template)).toEqual(["Card 2"]);
  const request = toRequest(state, [5n]);
  expect(request.newFields).toEqual([0, 0]);
  expect(request.newTemplates).toEqual([-1, 0]);
  expect(request.noteIds).toEqual([5n]);
});

test("to or from Cloze there is no template mapping", () => {
  const i = info();
  i.input!.newTemplates = [];
  i.input!.isCloze = true;
  const state = fromInfo(i);
  expect(state.templates).toBeUndefined();
  expect(unusedItems(state, MapContext.Template)).toEqual([]);
  expect(toRequest(state, []).newTemplates).toEqual([]);
});
