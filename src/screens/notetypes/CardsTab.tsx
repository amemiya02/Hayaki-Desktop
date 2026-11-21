// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The Cards tab (qt/aqt/clayout.py): the Card Templates, their front and
 * back, the shared styling, and a live preview.
 */
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  Braces,
  Check as CheckIcon,
  ChevronDown,
  ClipboardCopy,
  FolderInput,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Rows3,
  Table2,
  Trash2,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { confirm } from "@/components/confirm";
import { Button, Dialog, IconButton, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, NumberField, Segmented, SubMenu, TextField } from "@/components/ui";
import * as core from "@/lib/anki/generated/core";
import type { Notetype } from "@/lib/anki/proto/anki/notetypes_pb";
import { tr } from "@/lib/i18n";
import { useNav } from "@/lib/nav";
import { plainLabel, tn } from "@/lib/strings/notetypes";
import { SelectField } from "@/screens/deck-options/controls";

import { CodeEditor, type CodeEditorHandle } from "./CodeEditor";
import { SPECIAL_FIELDS } from "./completion";
import { Check, NameDialog } from "./dialogs";
import type { Loaded } from "./Editor";
import {
  addTemplate,
  fieldsOnTemplate,
  flipTemplate,
  isCloze,
  moveTemplate,
  newCardName,
  removeTemplate,
  setCss,
  templateMarkdown,
  updateTemplate,
} from "./model";
import { TemplatePreview } from "./TemplatePreview";

export type EditingPart = "front" | "back" | "styling";

type Prompt = { kind: "rename" } | { kind: "reposition" };

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function CardsTab({
  working,
  loaded,
  update,
  part,
  onPart,
}: {
  working: Notetype;
  loaded: Loaded;
  update: (fn: (nt: Notetype) => Notetype) => void;
  part: EditingPart;
  onPart: (part: EditingPart) => void;
}) {
  const [selected, setSelected] = useState(0);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [deckDialog, setDeckDialog] = useState(false);
  const [browserDialog, setBrowserDialog] = useState(false);
  const editor = useRef<CodeEditorHandle>(null);
  const cloze = isCloze(working);
  const index = Math.min(selected, working.templates.length - 1);
  const template = working.templates[index];
  const config = template?.config;
  const fieldNames = working.fields.map((f) => f.name);
  const css = working.config?.css ?? "";

  const value = part === "front" ? (config?.qFormat ?? "") : part === "back" ? (config?.aFormat ?? "") : css;

  const onChange = (text: string) => {
    if (part === "styling") update((nt) => setCss(nt, text));
    else
      update((nt) =>
        updateTemplate(nt, index, (t) => {
          if (!t.config) return;
          if (part === "front") t.config.qFormat = text;
          else t.config.aFormat = text;
        }),
      );
  };

  const summary = (i: number) => {
    const c = working.templates[i].config;
    const front = fieldsOnTemplate(c?.qFormat ?? "", fieldNames).join("+") || tr("card-templates-blank");
    const back = fieldsOnTemplate(c?.aFormat ?? "", fieldNames).join("+") || tr("card-templates-blank");
    return `${front} → ${back}`;
  };

  const add = async () => {
    if (loaded.noteCount) {
      const ok = await confirm({
        title: stripEllipsis(tr("card-templates-add-card-type")),
        message: tr("card-templates-this-will-create-card-proceed", { count: loaded.noteCount }),
        confirm: tr("actions-add"),
      });
      if (!ok) return;
    }
    const name = newCardName(working, (n) => tr("card-templates-card", { val: n }));
    update((nt) => addTemplate(nt, name, index));
    setSelected(working.templates.length);
  };

  const remove = async () => {
    if (working.templates.length < 2) {
      toast.error(tr("card-templates-at-least-one-card-type-is"));
      return;
    }
    let count = 0;
    const ord = template.ord?.val;
    if (ord !== undefined) {
      try {
        count = (await core.searchCards({ search: `mid:${working.id} card:${ord + 1}`, order: { value: { case: "none", value: {} } } })).ids.length;
      } catch {
        count = 0;
      }
    }
    const ok = await confirm({
      title: stripEllipsis(tr("card-templates-remove-card-type")),
      message: tr("card-templates-delete-the-as-card-type-and", { template: template.name, cards: tr("card-templates-card-count", { count }) }),
      confirm: tr("actions-delete"),
      danger: true,
    });
    if (!ok) return;
    update((nt) => removeTemplate(nt, index));
    setSelected(Math.max(0, index - 1));
  };

  const flip = () => {
    const flipped = flipTemplate(config?.qFormat ?? "", config?.aFormat ?? "");
    if (!flipped) {
      toast.error(tr("card-templates-anki-couldnt-find-the-line-between"));
      return;
    }
    update((nt) =>
      updateTemplate(nt, index, (t) => {
        if (!t.config) return;
        t.config.qFormat = flipped.qFormat;
        t.config.aFormat = flipped.aFormat;
      }),
    );
  };

  const copyInfo = async () => {
    await navigator.clipboard.writeText(templateMarkdown(template, css));
    toast.success(tr("about-copied-to-clipboard"));
  };

  const restore = async () => {
    const kind = working.config?.originalStockKind ?? 0;
    if (!kind) {
      toast.error(tn("restoreUnavailable"));
      return;
    }
    const ok = await confirm({
      title: tr("card-templates-restore-to-default"),
      message: tr("card-templates-restore-to-default-confirmation").replace(/\s+/g, " "),
      confirm: tr("card-templates-restore-to-default"),
      danger: true,
    });
    if (!ok) return;
    try {
      await core.restoreNotetypeToStock({ notetypeId: { ntid: working.id } });
      toast.success(tr("card-templates-restored-to-default"));
      // The saved Note Type changed under the working copy; leave so it reloads.
      useNav.getState().back();
    } catch (e) {
      toast.error(message(e));
    }
  };

  const partLabel = part === "front" ? tr("card-templates-front-template") : part === "back" ? tr("card-templates-back-template") : tr("card-templates-template-styling");

  return (
    <div className="@container flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-5 py-2.5">
        <span className="text-[12.5px] text-ink-3">{plainLabel(tr("card-templates-card-type"))}</span>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button className="max-w-[420px] justify-between" aria-label={`${plainLabel(tr("card-templates-card-type"))}: ${template.name}`}>
              <span className="tabular shrink-0 text-ink-3">{index + 1}</span>
              <span className="truncate">{template.name}</span>
              <span className="hidden truncate text-[12px] font-normal text-ink-3 @min-[720px]:inline">{summary(index)}</span>
              <ChevronDown className="text-ink-3" />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="start"
              sideOffset={6}
              className="z-50 max-h-[min(420px,var(--radix-dropdown-menu-content-available-height))] min-w-[300px] overflow-y-auto rounded-[10px] border border-line bg-raised p-1 shadow-pop data-[state=open]:animate-[pop-in_120ms_var(--ease-out)]"
            >
              <DropdownMenu.RadioGroup value={String(index)} onValueChange={(v) => setSelected(Number(v))}>
                {working.templates.map((t, i) => (
                  <DropdownMenu.RadioItem
                    key={`${t.ord?.val ?? "new"}-${i}`}
                    value={String(i)}
                    className="relative flex min-h-8 cursor-default select-none items-center gap-3 rounded-[6px] py-1 pl-8 pr-2.5 text-[13px] text-ink outline-none data-[highlighted]:bg-accent-soft"
                  >
                    <DropdownMenu.ItemIndicator className="absolute left-2.5 inline-flex">
                      <CheckIcon className="size-4 text-accent-ink" />
                    </DropdownMenu.ItemIndicator>
                    <span className="tabular w-4 shrink-0 text-ink-3">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate">{t.name}</span>
                    <span className="max-w-[220px] shrink-0 truncate text-[12px] text-ink-3">{summary(i)}</span>
                  </DropdownMenu.RadioItem>
                ))}
              </DropdownMenu.RadioGroup>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <Menu>
          <MenuTrigger asChild>
            <IconButton label={tr("actions-options")} variant="secondary">
              <MoreHorizontal />
            </IconButton>
          </MenuTrigger>
          <MenuContent align="start">
            {!cloze && (
              <>
                <MenuItem onSelect={() => void add()}>
                  <Plus />
                  {tr("card-templates-add-card-type")}
                </MenuItem>
                <MenuItem onSelect={() => void remove()} danger>
                  <Trash2 />
                  {tr("card-templates-remove-card-type")}
                </MenuItem>
                <MenuItem onSelect={() => setPrompt({ kind: "rename" })}>
                  <Pencil />
                  {tr("card-templates-rename-card-type")}
                </MenuItem>
                <MenuItem onSelect={() => setPrompt({ kind: "reposition" })} disabled={working.templates.length < 2}>
                  <Rows3 />
                  {tr("card-templates-reposition-card-type")}
                </MenuItem>
                <MenuSeparator />
                <MenuItem onSelect={() => setDeckDialog(true)}>
                  <FolderInput />
                  {tr("card-templates-deck-override")}
                  <span className="ml-auto pl-4 text-[12px] text-ink-3">{config?.targetDeckId ? tr("card-templates-on") : tr("card-templates-off")}</span>
                </MenuItem>
              </>
            )}
            <MenuItem onSelect={() => setBrowserDialog(true)}>
              <Table2 />
              {tr("card-templates-browser-appearance")}
            </MenuItem>
            <MenuItem onSelect={() => void copyInfo()}>
              <ClipboardCopy />
              {tr("card-templates-copy-info")}
            </MenuItem>
            <MenuSeparator />
            <MenuItem onSelect={() => void restore()} danger>
              <RotateCcw />
              {tr("actions-with-ellipsis", { action: tr("card-templates-restore-to-default") })}
            </MenuItem>
          </MenuContent>
        </Menu>
        {!cloze && (
          <Button variant="ghost" onClick={flip} title={tr("card-templates-flip")}>
            <ArrowLeftRight />
            {tr("card-templates-flip")}
          </Button>
        )}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] @min-[900px]:grid-cols-2 @min-[900px]:grid-rows-1">
        <section aria-label={tr("card-templates-template-box")} className="flex min-h-0 flex-col gap-2 border-line px-5 pb-4 pt-3 @min-[900px]:border-r">
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              label={tn("editing")}
              value={part}
              options={[
                { value: "front", label: tr("card-templates-front-template") },
                { value: "back", label: tr("card-templates-back-template") },
                { value: "styling", label: tr("card-templates-template-styling") },
              ]}
              onChange={onPart}
            />
            {part !== "styling" && (
              <Menu>
                <MenuTrigger asChild>
                  <Button size="sm" variant="ghost" className="ml-auto">
                    <Braces />
                    {tn("insertField")}
                    <ChevronDown className="text-ink-3" />
                  </Button>
                </MenuTrigger>
                <MenuContent>
                  {fieldNames.map((name) => (
                    <MenuItem key={name} onSelect={() => requestAnimationFrame(() => editor.current?.insert(`{{${name}}}`))}>
                      {name}
                    </MenuItem>
                  ))}
                  <MenuSeparator />
                  <SubMenu label={tn("insertSpecial")}>
                    <MenuLabel>{tn("insertSpecial")}</MenuLabel>
                    {SPECIAL_FIELDS.filter((n) => part === "back" || n !== "FrontSide").map((name) => (
                      <MenuItem key={name} onSelect={() => requestAnimationFrame(() => editor.current?.insert(`{{${name}}}`))}>
                        {name}
                      </MenuItem>
                    ))}
                  </SubMenu>
                </MenuContent>
              </Menu>
            )}
          </div>
          <CodeEditor
            ref={editor}
            key={`${part}-${index}`}
            value={value}
            onChange={onChange}
            language={part === "styling" ? "css" : "html"}
            fields={fieldNames}
            label={`${partLabel}: ${template.name}`}
            className="flex-1"
          />
        </section>
        <TemplatePreview working={working} loaded={loaded} index={index} initialSide={part === "back" ? "answer" : "question"} />
      </div>

      <NameDialog
        open={prompt !== null}
        title={prompt?.kind === "reposition" ? stripEllipsis(tr("card-templates-reposition-card-type")) : stripEllipsis(tr("card-templates-rename-card-type"))}
        label={prompt?.kind === "reposition" ? tr("card-templates-enter-new-card-position-1", { val: working.templates.length }) : tr("actions-new-name")}
        initial={prompt?.kind === "reposition" ? String(index + 1) : template.name}
        validate={(v) => {
          if (prompt?.kind !== "reposition") return null;
          const n = Number(v);
          return Number.isInteger(n) && n >= 1 && n <= working.templates.length ? null : tr("card-templates-enter-new-card-position-1", { val: working.templates.length });
        }}
        onClose={() => setPrompt(null)}
        onSubmit={(v) => {
          const kind = prompt?.kind;
          setPrompt(null);
          if (kind === "reposition") {
            const to = Number(v) - 1;
            if (to === index) return;
            update((nt) => moveTemplate(nt, index, to));
            setSelected(to);
          } else {
            const name = v.replace(/"/g, "");
            if (!name.trim()) return;
            if (working.templates.some((t, i) => i !== index && t.name === name.trim())) {
              toast.error(tn("nameTaken"));
              return;
            }
            update((nt) => updateTemplate(nt, index, (t) => void (t.name = name.trim())));
          }
        }}
      />
      {deckDialog && (
        <DeckOverrideDialog
          templateName={template.name}
          deckId={config?.targetDeckId ?? 0n}
          onClose={() => setDeckDialog(false)}
          onChange={(id) => update((nt) => updateTemplate(nt, index, (t) => void (t.config && (t.config.targetDeckId = id))))}
        />
      )}
      {browserDialog && config && (
        <BrowserAppearanceDialog
          initial={{ q: config.qFormatBrowser, a: config.aFormatBrowser, font: config.browserFontName, size: config.browserFontSize }}
          onClose={() => setBrowserDialog(false)}
          onSave={(v) => {
            setBrowserDialog(false);
            update((nt) =>
              updateTemplate(nt, index, (t) => {
                if (!t.config) return;
                t.config.qFormatBrowser = v.q.trim();
                t.config.aFormatBrowser = v.a.trim();
                t.config.browserFontName = v.font;
                t.config.browserFontSize = v.size;
              }),
            );
          }}
        />
      )}
    </div>
  );
}

function stripEllipsis(text: string): string {
  return text.replace(/(\.\.\.|…)$/, "");
}

/* ------------------------------ Deck override ------------------------------ */

function DeckOverrideDialog({
  templateName,
  deckId,
  onClose,
  onChange,
}: {
  templateName: string;
  deckId: bigint;
  onClose: () => void;
  onChange: (id: bigint) => void;
}) {
  const decks = useQuery({ queryKey: ["deckNames", "normal"], queryFn: () => core.getDeckNames({ skipEmptyDefault: false, includeFiltered: false }) });
  const entries = decks.data?.entries ?? [];
  const current = entries.findIndex((d) => d.id === deckId);
  const [choice, setChoice] = useState<number | null>(null);
  const value = choice ?? current + 1;
  const choices = useMemo(() => [{ value: 0, label: tn("noDeck") }, ...entries.map((d, i) => ({ value: i + 1, label: d.name }))], [entries]);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={stripEllipsis(tr("card-templates-deck-override"))}
      description={tr("card-templates-enter-deck-to-place-new", { val: templateName })}
      footer={
        <>
          <Button onClick={onClose}>{tr("actions-cancel")}</Button>
          <Button
            variant="primary"
            disabled={!decks.data}
            onClick={() => {
              onChange(value === 0 ? 0n : entries[value - 1].id);
              onClose();
            }}
          >
            {tr("actions-save")}
          </Button>
        </>
      }
    >
      <div className="pb-2">
        <SelectField label={tn("deckOverride")} value={value} choices={choices} onChange={setChoice} />
      </div>
    </Dialog>
  );
}

/* ------------------------------ Browser appearance ------------------------------ */

function BrowserAppearanceDialog({
  initial,
  onClose,
  onSave,
}: {
  initial: { q: string; a: string; font: string; size: number };
  onClose: () => void;
  onSave: (value: { q: string; a: string; font: string; size: number }) => void;
}) {
  const [q, setQ] = useState(initial.q);
  const [a, setA] = useState(initial.a);
  const [override, setOverride] = useState(!!initial.font);
  const [font, setFont] = useState(initial.font || "Arial");
  const [size, setSize] = useState(initial.size || 12);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={tr("browsing-browser-appearance")}
      width={520}
      footer={
        <>
          <Button onClick={onClose}>{tr("actions-cancel")}</Button>
          <Button variant="primary" onClick={() => onSave({ q, a, font: override ? font : "", size: override ? size : 0 })}>
            {tr("actions-save")}
          </Button>
        </>
      }
    >
      <div className="space-y-4 pb-2">
        <label className="block">
          <span className="mb-1.5 block text-[12.5px] text-ink-2">{plainLabel(tr("browsing-override-front-template"))}</span>
          <TextField className="font-mono" spellCheck={false} value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[12.5px] text-ink-2">{plainLabel(tr("browsing-override-back-template"))}</span>
          <TextField className="font-mono" spellCheck={false} value={a} onChange={(e) => setA(e.target.value)} />
        </label>
        <Check checked={override} onChange={setOverride}>
          {plainLabel(tr("browsing-override-font"))}
        </Check>
        {override && (
          <div className="flex items-end gap-3 pl-6">
            <label className="block flex-1">
              <span className="mb-1.5 block text-[12.5px] text-ink-2">{tn("font")}</span>
              <TextField spellCheck={false} value={font} onChange={(e) => setFont(e.target.value)} />
            </label>
            <div>
              <span className="mb-1.5 block text-[12.5px] text-ink-2">{tn("fontSize")}</span>
              <NumberField label={tn("fontSize")} min={1} max={300} value={size} onChange={setSize} />
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
