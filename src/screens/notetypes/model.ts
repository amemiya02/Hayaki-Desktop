// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Pure edits to a working copy of a Note Type, matching what Anki's Fields
 * and Cards dialogs do (qt/aqt/fields.py, clayout.py, pylib models.py). The
 * core applies the result in one `updateNotetype`.
 */
import { clone, create, toBinary } from "@bufbuild/protobuf";

import {
  Notetype_Config_Kind,
  Notetype_FieldSchema,
  Notetype_TemplateSchema,
  NotetypeSchema,
  type Notetype,
  type Notetype_Field,
  type Notetype_Template,
} from "@/lib/anki/proto/anki/notetypes_pb";

export function copyNotetype(nt: Notetype): Notetype {
  return clone(NotetypeSchema, nt);
}

/** A comparable snapshot, for telling whether there are unsaved changes. */
export function snapshot(nt: Notetype): string {
  const bytes = toBinary(NotetypeSchema, nt);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

export function isCloze(nt: Notetype): boolean {
  return nt.config?.kind === Notetype_Config_Kind.CLOZE;
}

/* ------------------------------ Names ------------------------------ */

export type NameProblem =
  | "empty"
  | "unchanged"
  | "fields-name-first-letter-not-valid"
  | "fields-name-invalid-letter"
  | "fields-that-field-name-is-already-used";

/** Checks a field name as Anki's `_uniqueName` does; returns the cleaned name or the problem. */
export function checkFieldName(
  nt: Notetype,
  input: string,
  old = "",
): { name: string } | { problem: NameProblem } {
  const name = input.replace(/"/g, "").trim();
  if (!name) return { problem: "empty" };
  if ("#^/".includes(name[0])) return { problem: "fields-name-first-letter-not-valid" };
  if (/[:{}"]/.test(name)) return { problem: "fields-name-invalid-letter" };
  // As upstream, a change of case alone is not a rename.
  if (old && name.toLocaleLowerCase() === old.toLocaleLowerCase()) return { problem: "unchanged" };
  if (nt.fields.some((f) => f.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    return { problem: "fields-that-field-name-is-already-used" };
  }
  return { name };
}

/* ------------------------------ Template text ------------------------------ */

const REPLACEMENT = /\{\{([#^/]?)([^{}]*?)\}\}/g;

/**
 * Renames field references in template text in one pass: `{{Name}}`,
 * `{{#Name}}`, `{{/Name}}`, `{{^Name}}` and filtered ones such as
 * `{{text:Name}}`. The map goes from current name to replacement.
 */
export function mapFieldsInTemplate(text: string, names: Map<string, string>): string {
  if (names.size === 0) return text;
  return text.replace(REPLACEMENT, (whole, prefix: string, body: string) => {
    const trimmed = body.trim();
    const colon = trimmed.lastIndexOf(":");
    const field = colon >= 0 ? trimmed.slice(colon + 1) : trimmed;
    const to = names.get(field);
    if (to === undefined) return whole;
    const filters = colon >= 0 ? trimmed.slice(0, colon + 1) : "";
    return `{{${prefix}${filters}${to}}}`;
  });
}

export function renameFieldInTemplate(text: string, from: string, to: string): string {
  if (!from || from === to) return text;
  return mapFieldsInTemplate(text, new Map([[from, to]]));
}

/** Field names referenced on a template, in order and without repeats. */
export function fieldsOnTemplate(text: string, fieldNames: string[]): string[] {
  const known = new Set(fieldNames);
  const out: string[] = [];
  for (const match of text.matchAll(REPLACEMENT)) {
    const body = match[2].trim();
    const field = body.slice(body.lastIndexOf(":") + 1);
    if (known.has(field) && !out.includes(field)) out.push(field);
  }
  return out;
}

/* ------------------------------ Fields ------------------------------ */

function mapTemplates(nt: Notetype, fn: (text: string) => string): void {
  for (const template of nt.templates) {
    if (!template.config) continue;
    template.config.qFormat = fn(template.config.qFormat);
    template.config.aFormat = fn(template.config.aFormat);
    template.config.qFormatBrowser = fn(template.config.qFormatBrowser);
    template.config.aFormatBrowser = fn(template.config.aFormatBrowser);
  }
}

function randomId(): bigint {
  const hi = BigInt(Math.floor(Math.random() * 0x7fffffff));
  const lo = BigInt(Math.floor(Math.random() * 0xffffffff));
  return (hi << 32n) | lo;
}

/** Anki's new field defaults (rslib NoteField::new). */
export function newField(name: string): Notetype_Field {
  return create(Notetype_FieldSchema, {
    name,
    config: { fontName: "Arial", fontSize: 20, description: "", id: randomId() },
  });
}

export function addField(nt: Notetype, name: string): Notetype {
  const next = copyNotetype(nt);
  next.fields.push(newField(name));
  return next;
}

export function renameField(nt: Notetype, index: number, name: string): Notetype {
  const next = copyNotetype(nt);
  const old = next.fields[index].name;
  next.fields[index].name = name;
  mapTemplates(next, (text) => renameFieldInTemplate(text, old, name));
  return next;
}

export function removeField(nt: Notetype, index: number): Notetype {
  const next = copyNotetype(nt);
  next.fields.splice(index, 1);
  const config = next.config;
  if (config) {
    if (config.sortFieldIdx === index) config.sortFieldIdx = 0;
    else if (config.sortFieldIdx > index) config.sortFieldIdx -= 1;
  }
  return next;
}

/** Moves a list item, keeping the sort field pointing at the same field. */
export function moveField(nt: Notetype, from: number, to: number): Notetype {
  if (from === to || to < 0 || to >= nt.fields.length) return nt;
  const next = copyNotetype(nt);
  const sortName = next.fields[next.config?.sortFieldIdx ?? 0]?.name;
  const [field] = next.fields.splice(from, 1);
  next.fields.splice(to, 0, field);
  if (next.config) {
    next.config.sortFieldIdx = Math.max(0, next.fields.findIndex((f) => f.name === sortName));
  }
  return next;
}

export function setSortField(nt: Notetype, index: number): Notetype {
  const next = copyNotetype(nt);
  if (next.config) next.config.sortFieldIdx = index;
  return next;
}

export function updateField(nt: Notetype, index: number, fn: (field: Notetype_Field) => void): Notetype {
  const next = copyNotetype(nt);
  fn(next.fields[index]);
  return next;
}

/* ------------------------------ Templates ------------------------------ */

export function updateTemplate(nt: Notetype, index: number, fn: (template: Notetype_Template) => void): Notetype {
  const next = copyNotetype(nt);
  fn(next.templates[index]);
  return next;
}

export function setCss(nt: Notetype, css: string): Notetype {
  const next = copyNotetype(nt);
  if (next.config) next.config.css = css;
  return next;
}

/** "Card N" with the first N not already taken (clayout `_newCardName`). */
export function newCardName(nt: Notetype, cardName: (n: number) => string): string {
  const names = new Set(nt.templates.map((t) => t.name));
  let n = nt.templates.length + 1;
  while (names.has(cardName(n))) n++;
  return cardName(n);
}

/** Adds a Card Template copying the given one's front and back, as upstream does. */
export function addTemplate(nt: Notetype, name: string, copyFrom: number): Notetype {
  const next = copyNotetype(nt);
  const source = next.templates[copyFrom]?.config;
  next.templates.push(
    create(Notetype_TemplateSchema, {
      name,
      config: { qFormat: source?.qFormat ?? "", aFormat: source?.aFormat ?? "", id: randomId() },
    }),
  );
  return next;
}

export function removeTemplate(nt: Notetype, index: number): Notetype {
  const next = copyNotetype(nt);
  next.templates.splice(index, 1);
  return next;
}

export function moveTemplate(nt: Notetype, from: number, to: number): Notetype {
  if (from === to || to < 0 || to >= nt.templates.length) return nt;
  const next = copyNotetype(nt);
  const [template] = next.templates.splice(from, 1);
  next.templates.splice(to, 0, template);
  return next;
}

/** Swaps front and back as clayout's Flip does; null when the answer has no `<hr id=answer>`. */
export function flipTemplate(qFormat: string, aFormat: string): { qFormat: string; aFormat: string } | null {
  const match = /^([\s\S]+)<hr id=answer>([\s\S]+)$/.exec(aFormat);
  if (!match) return null;
  return { aFormat: `{{FrontSide}}\n\n<hr id=answer>\n\n${qFormat}`, qFormat: match[2].trim() };
}

/** Clayout's "Copy Info to Clipboard". */
export function templateMarkdown(template: Notetype_Template, css: string): string {
  const clean = (text: string) => text.replace(/```/g, "\\`\\`\\`");
  return (
    "## Front Template\n```html\n" +
    `${clean(template.config?.qFormat ?? "")}\n` +
    "```\n## Back Template\n```html\n" +
    `${clean(template.config?.aFormat ?? "")}\n` +
    "```\n## Styling\n```css\n" +
    `${clean(css)}\n` +
    "```\n"
  );
}

/* ------------------------------ Schema changes ------------------------------ */

function ordsChanged(ords: (number | undefined)[], previousLength: number): boolean {
  return ords.length !== previousLength || ords.some((ord, i) => ord !== i);
}

/**
 * Whether saving will modify the collection schema and so force a one-way
 * sync, as the core decides it (rslib notetype/schemachange.rs): fields or
 * Card Templates added, removed or reordered, or a new sort field.
 */
export function requiresFullSync(original: Notetype, edited: Notetype): boolean {
  if (ordsChanged(edited.fields.map((f) => f.ord?.val), original.fields.length)) return true;
  if ((edited.config?.sortFieldIdx ?? 0) !== (original.config?.sortFieldIdx ?? 0)) return true;
  return ordsChanged(edited.templates.map((t) => t.ord?.val), original.templates.length);
}

/** Fields with a stored ordinal whose name differs from the saved Note Type, as new name to old. */
export function renamedFields(original: Notetype, edited: Notetype): Map<string, string> {
  const out = new Map<string, string>();
  for (const field of edited.fields) {
    const ord = field.ord?.val;
    if (ord === undefined) continue;
    const old = original.fields[ord]?.name;
    if (old !== undefined && old !== field.name) out.set(field.name, old);
  }
  return out;
}

/** Fields added since the last save. */
export function addedFields(edited: Notetype): string[] {
  return edited.fields.filter((f) => f.ord === undefined).map((f) => f.name);
}
