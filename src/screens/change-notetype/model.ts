// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Change Note Type's mapping state, ported from Anki's
 * ts/routes/change-notetype/lib.ts as plain immutable functions.
 */
import { clone } from "@bufbuild/protobuf";

import { ChangeNotetypeRequestSchema, type ChangeNotetypeInfo, type ChangeNotetypeRequest } from "@/lib/anki/proto/anki/notetypes_pb";

export enum MapContext {
  Field,
  Template,
}

export interface MappingState {
  info: ChangeNotetypeInfo;
  /** For each new field, the old field it takes content from, or null. */
  fields: (number | null)[];
  /** For each new Card Template, the old one whose Cards move to it; undefined to or from Cloze. */
  templates?: (number | null)[];
  isCloze: boolean;
}

export function negativeOneToNull(list: number[]): (number | null)[] {
  return list.map((v) => (v === -1 ? null : v));
}

export function nullToNegativeOne(list: (number | null)[]): number[] {
  return list.map((v) => v ?? -1);
}

export function fromInfo(info: ChangeNotetypeInfo): MappingState {
  const templates = info.input?.newTemplates ?? [];
  return {
    info,
    fields: negativeOneToNull(info.input?.newFields ?? []),
    templates: templates.length > 0 ? negativeOneToNull(templates) : undefined,
    isCloze: info.input?.isCloze ?? false,
  };
}

export function mapFor(state: MappingState, ctx: MapContext): (number | null)[] {
  return ctx === MapContext.Template ? (state.templates ?? []) : state.fields;
}

export function oldNames(state: MappingState, ctx: MapContext): string[] {
  return ctx === MapContext.Template ? state.info.oldTemplateNames : state.info.oldFieldNames;
}

export function newNames(state: MappingState, ctx: MapContext): string[] {
  return ctx === MapContext.Template ? state.info.newTemplateNames : state.info.newFieldNames;
}

/**
 * Maps one new field or Card Template to an old one (null for Nothing). Old
 * fields may feed several new fields; an old Card Template moves to one place.
 */
export function setOld(state: MappingState, ctx: MapContext, newIndex: number, oldIndex: number | null): MappingState {
  const list = [...mapFor(state, ctx)];
  if (ctx === MapContext.Template && oldIndex !== null) {
    for (let i = 0; i < list.length; i++) if (list[i] === oldIndex) list[i] = null;
  }
  list[newIndex] = oldIndex;
  return ctx === MapContext.Template ? { ...state, templates: list } : { ...state, fields: list };
}

/** Old names nothing maps to: their content or Cards will be lost. */
export function unusedItems(state: MappingState, ctx: MapContext): string[] {
  if (ctx === MapContext.Template && (state.isCloze || !state.templates)) return [];
  const used = new Set(mapFor(state, ctx).filter((v): v is number => v !== null));
  return oldNames(state, ctx).filter((_, i) => !used.has(i));
}

export function unchanged(state: MappingState): boolean {
  const input = state.info.input;
  if (!input) return true;
  const identity = (list: (number | null)[]) => list.every((v, i) => v === i);
  return (
    input.newNotetypeId === input.oldNotetypeId &&
    identity(state.fields) &&
    state.fields.length === state.info.oldFieldNames.length &&
    identity(state.templates ?? [])
  );
}

/** The request to send, with the mapping packed back in. */
export function toRequest(state: MappingState, noteIds: bigint[]): ChangeNotetypeRequest {
  const input = clone(ChangeNotetypeRequestSchema, state.info.input!);
  input.noteIds = noteIds;
  input.newFields = nullToNegativeOne(state.fields);
  if (state.templates) input.newTemplates = nullToNegativeOne(state.templates);
  return input;
}
