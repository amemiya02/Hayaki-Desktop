// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** The Fields tab (qt/aqt/fields.py): reorder, add, rename, delete and per-field options. */
import { ArrowDown, ArrowUp, GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";

import { confirm } from "@/components/confirm";
import { Button, cn, IconButton, NumberField, TextField } from "@/components/ui";
import type { Notetype } from "@/lib/anki/proto/anki/notetypes_pb";
import { tr } from "@/lib/i18n";
import { plainLabel, tn } from "@/lib/strings/notetypes";
import { Row, Section, Switch } from "@/screens/deck-options/controls";

import { NameDialog } from "./dialogs";
import { fieldDrag } from "./field-drag";
import { addField, checkFieldName, moveField, removeField, renameField, setSortField, updateField } from "./model";

type Prompt = { kind: "add" } | { kind: "rename"; index: number };

export function FieldsTab({
  working,
  noteCount,
  update,
}: {
  working: Notetype;
  original: Notetype;
  noteCount: number;
  update: (fn: (nt: Notetype) => Notetype) => void;
}) {
  const [selected, setSelected] = useState(0);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const drag = fieldDrag.useDrag();
  const dragFrom = drag.source === null ? null : Number(drag.source);
  const list = useRef<HTMLDivElement>(null);
  const fields = working.fields;
  const index = Math.min(selected, fields.length - 1);
  const field = fields[index];
  const sortIdx = working.config?.sortFieldIdx ?? 0;

  const focusRow = (i: number) => requestAnimationFrame(() => list.current?.querySelectorAll<HTMLElement>("[role=option]")[i]?.focus());

  const move = (from: number, to: number) => {
    if (to < 0 || to >= fields.length || from === to) return;
    update((nt) => moveField(nt, from, to));
    setSelected(to);
    focusRow(to);
  };

  const remove = async () => {
    if (fields.length < 2) {
      toast.error(tr("fields-notes-require-at-least-one-field"));
      return;
    }
    if (field.config?.preventDeletion) {
      toast.error(tr("fields-field-is-required"));
      return;
    }
    const ok = await confirm({
      title: `${tr("actions-delete")}: ${field.name}`,
      message: tr("fields-delete-field-from", { val: tr("browsing-note-count", { count: noteCount }) }),
      confirm: tr("actions-delete"),
      danger: true,
    });
    if (!ok) return;
    update((nt) => removeField(nt, index));
    setSelected(Math.max(0, index - 1));
  };

  const validate = (value: string, old = "") => {
    const result = checkFieldName(working, value, old);
    if ("name" in result) return null;
    if (result.problem === "empty" || result.problem === "unchanged") return null;
    return tr(result.problem);
  };

  const submitName = (value: string) => {
    if (!prompt) return;
    const old = prompt.kind === "rename" ? fields[prompt.index].name : "";
    const result = checkFieldName(working, value, old);
    setPrompt(null);
    if (!("name" in result)) return;
    if (prompt.kind === "add") {
      update((nt) => addField(nt, result.name));
      setSelected(fields.length);
      focusRow(fields.length);
    } else {
      update((nt) => renameField(nt, prompt.index, result.name));
    }
  };

  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      move(index, index + (e.key === "ArrowUp" ? -1 : 1));
      return;
    }
    let next: number | null = null;
    if (e.key === "ArrowDown") next = Math.min(fields.length - 1, index + 1);
    else if (e.key === "ArrowUp") next = Math.max(0, index - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = fields.length - 1;
    else if (e.key === "F2") {
      e.preventDefault();
      setPrompt({ kind: "rename", index });
    } else if (e.key === "Delete") {
      e.preventDefault();
      void remove();
    }
    if (next !== null) {
      e.preventDefault();
      setSelected(next);
      focusRow(next);
    }
  };

  const set = (fn: Parameters<typeof updateField>[2]) => update((nt) => updateField(nt, index, fn));
  const config = field?.config;

  return (
    <div className="@container h-full overflow-y-auto">
      <div className="mx-auto grid max-w-[1000px] grid-cols-1 gap-8 px-8 pb-16 pt-6 @min-[760px]:grid-cols-[280px_minmax(0,1fr)]">
        <div className="min-w-0">
          <h3 className="mb-2.5 px-1 text-[13px] font-semibold text-ink-2">{tr("notetypes-fields")}</h3>
          <div
            ref={list}
            role="listbox"
            aria-label={tn("fieldList", { name: working.name })}
            aria-describedby="fields-reorder-hint"
            onKeyDown={onListKey}
            className="overflow-hidden rounded-[12px] border border-line bg-surface py-1"
          >
            {fields.map((f, i) => (
              <div key={`${f.ord?.val ?? "new"}-${f.name}-${i}`} className="relative px-1">
                {drag.valid && drag.over === String(i) && drag.edge === "before" && (
                  <div className="pointer-events-none absolute inset-x-3 -top-px h-0.5 rounded-full bg-accent" aria-hidden="true" />
                )}
                <div
                  role="option"
                  aria-selected={i === index}
                  tabIndex={i === index ? 0 : -1}
                  data-field-drop={i}
                  {...fieldDrag.handlers({ index: i, name: f.name, move }, String(i))}
                  onPointerDownCapture={() => setSelected(i)}
                  onClick={() => setSelected(i)}
                  onDoubleClick={() => setPrompt({ kind: "rename", index: i })}
                  className={cn(
                    "flex h-9 cursor-default select-none items-center gap-2 rounded-[7px] pl-1.5 pr-2.5 text-[13px] outline-offset-[-2px]",
                    i === index ? "bg-accent-soft text-accent-ink" : "text-ink hover:bg-surface-2",
                    dragFrom === i && "opacity-50",
                  )}
                >
                  <GripVertical className="size-4 shrink-0 cursor-grab text-ink-3" aria-hidden="true" />
                  <span className="tabular w-5 shrink-0 text-right text-[12px] text-ink-3">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{f.name}</span>
                  {i === sortIdx && (
                    <span className="shrink-0 rounded-full bg-surface-3 px-2 py-px text-[11.5px] font-medium text-ink-2">{tn("sortField")}</span>
                  )}
                </div>
                {drag.valid && drag.over === String(i) && drag.edge === "after" && (
                  <div className="pointer-events-none absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-accent" aria-hidden="true" />
                )}
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-1">
            <Button size="sm" onClick={() => setPrompt({ kind: "add" })}>
              <Plus />
              {tr("fields-add-field")}
            </Button>
            <IconButton label={`${tr("actions-rename")} (F2)`} size="sm" onClick={() => setPrompt({ kind: "rename", index })}>
              <Pencil />
            </IconButton>
            <IconButton label={`${tr("actions-delete")} (Del)`} size="sm" onClick={() => void remove()}>
              <Trash2 />
            </IconButton>
            <span className="mx-1 h-4 w-px bg-line" aria-hidden="true" />
            <IconButton label={`${tn("moveUp")} (Alt+Up)`} size="sm" disabled={index === 0} onClick={() => move(index, index - 1)}>
              <ArrowUp />
            </IconButton>
            <IconButton label={`${tn("moveDown")} (Alt+Down)`} size="sm" disabled={index === fields.length - 1} onClick={() => move(index, index + 1)}>
              <ArrowDown />
            </IconButton>
          </div>
          <p id="fields-reorder-hint" className="mt-2 px-1 text-[12px] text-ink-3">
            {tn("reorderHint")}
          </p>
        </div>

        {field && config && (
          <div className="min-w-0">
            <Section id="field-options" title={tn("fieldOptions", { name: field.name })}>
              <Row label={tr("fields-sort-by-this-field-in-the")} name={tr("fields-sort-by-this-field-in-the")}>
                {/* As upstream, the sort field can be moved but not turned off. */}
                <Switch
                  checked={index === sortIdx}
                  label={tr("fields-sort-by-this-field-in-the")}
                  onChange={(on) => on && update((nt) => setSortField(nt, index))}
                />
              </Row>
              <Row label={tn("font")} name={tn("font")} id="field-font">
                <TextField
                  id="field-font"
                  className="w-[220px]"
                  spellCheck={false}
                  value={config.fontName}
                  onChange={(e) => set((f) => f.config && (f.config.fontName = e.target.value))}
                />
              </Row>
              <Row label={tn("fontSize")} name={tn("fontSize")} id="field-size">
                <NumberField
                  id="field-size"
                  label={tn("fontSize")}
                  min={1}
                  max={300}
                  value={config.fontSize}
                  onChange={(v) => set((f) => f.config && (f.config.fontSize = v))}
                />
              </Row>
              <Row label={tr("fields-reverse-text-direction-rtl")} name={tr("fields-reverse-text-direction-rtl")}>
                <Switch label={tr("fields-reverse-text-direction-rtl")} checked={config.rtl} onChange={(v) => set((f) => f.config && (f.config.rtl = v))} />
              </Row>
              <Row label={tr("fields-html-by-default")} name={tr("fields-html-by-default")}>
                <Switch label={tr("fields-html-by-default")} checked={config.plainText} onChange={(v) => set((f) => f.config && (f.config.plainText = v))} />
              </Row>
              <Row label={tr("fields-collapse-by-default")} name={tr("fields-collapse-by-default")}>
                <Switch label={tr("fields-collapse-by-default")} checked={config.collapsed} onChange={(v) => set((f) => f.config && (f.config.collapsed = v))} />
              </Row>
              <Row label={tr("fields-exclude-from-search")} name={tr("fields-exclude-from-search")}>
                <Switch
                  label={tr("fields-exclude-from-search")}
                  checked={config.excludeFromSearch}
                  onChange={(v) => set((f) => f.config && (f.config.excludeFromSearch = v))}
                />
              </Row>
              <Row
                label={plainLabel(tr("fields-description"))}
                name={tr("fields-description")}
                below={
                  <TextField
                    aria-label={tr("fields-description")}
                    placeholder={tr("fields-description-placeholder")}
                    value={config.description}
                    onChange={(e) => set((f) => f.config && (f.config.description = e.target.value))}
                  />
                }
              />
            </Section>
          </div>
        )}
      </div>

      <NameDialog
        open={prompt !== null}
        title={prompt?.kind === "add" ? tr("fields-add-field") : tr("actions-rename")}
        label={prompt?.kind === "add" ? tr("fields-field-name") : tr("actions-new-name")}
        initial={prompt?.kind === "rename" ? (fields[prompt.index]?.name ?? "") : ""}
        action={prompt?.kind === "add" ? tr("actions-add") : tr("actions-save")}
        validate={(value) => validate(value, prompt?.kind === "rename" ? fields[prompt.index]?.name : "")}
        onClose={() => setPrompt(null)}
        onSubmit={submitName}
      />
    </div>
  );
}
