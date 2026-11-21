// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Manage Note Types (qt/aqt/models.py): every Note Type with its Note count,
 * and Add, Rename, Delete, Fields, Cards and Options.
 */
import { useQuery } from "@tanstack/react-query";
import { Layers, ListTree, MoreHorizontal, Pencil, Plus, Search, Settings2, Trash2 } from "lucide-react";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";

import { confirm } from "@/components/confirm";
import { Button, cn, Dialog, IconButton, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Spinner, TextField } from "@/components/ui";
import * as core from "@/lib/anki/generated/core";
import { StockNotetype_Kind, type NotetypeNameIdUseCount } from "@/lib/anki/proto/anki/notetypes_pb";
import { localeCompare, t, tr } from "@/lib/i18n";
import { useNav } from "@/lib/nav";
import { plainLabel, tn } from "@/lib/strings/notetypes";

import { Check, NameDialog, TextArea } from "./dialogs";
import { confirmSchemaChange } from "./schema";

const STOCK_KINDS = [
  StockNotetype_Kind.BASIC,
  StockNotetype_Kind.BASIC_AND_REVERSED,
  StockNotetype_Kind.BASIC_OPTIONAL_REVERSED,
  StockNotetype_Kind.BASIC_TYPING,
  StockNotetype_Kind.CLOZE,
  StockNotetype_Kind.IMAGE_OCCLUSION,
];

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function NotetypeList() {
  const go = useNav((s) => s.go);
  const query = useQuery({ queryKey: ["notetypes", "counts"], queryFn: () => core.getNotetypeNamesAndCounts() });
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<NotetypeNameIdUseCount | null>(null);
  const [options, setOptions] = useState<NotetypeNameIdUseCount | null>(null);
  const list = useRef<HTMLUListElement>(null);

  const entries = query.data?.entries ?? [];

  const open = (id: bigint, tab?: "fields" | "templates") => go({ name: "notetype", notetypeId: id, tab });

  const remove = async (entry: NotetypeNameIdUseCount) => {
    if (entries.length < 2) {
      toast.error(tr("notetypes-please-add-another-note-type-first"));
      return;
    }
    const ok = await confirm({
      title: `${tr("actions-delete")}: ${entry.name}`,
      message: entry.useCount ? tr("notetypes-delete-this-note-type-and-all") : tr("notetypes-delete-this-unused-note-type"),
      confirm: tr("actions-delete"),
      danger: true,
    });
    if (!ok) return;
    if (!(await confirmSchemaChange(tr("actions-delete"), tr("actions-delete")))) return;
    try {
      await core.removeNotetype({ ntid: entry.id });
    } catch (e) {
      toast.error(message(e));
    }
  };

  const rename = async (entry: NotetypeNameIdUseCount, name: string) => {
    setRenaming(null);
    try {
      const nt = await core.getNotetype({ ntid: entry.id });
      nt.name = name;
      await core.updateNotetype(nt);
    } catch (e) {
      toast.error(message(e));
    }
  };

  // Up and Down move between rows, as in Anki's list.
  const onListKey = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    const rows = Array.from(list.current?.querySelectorAll<HTMLElement>("[data-row]") ?? []);
    const index = rows.findIndex((row) => row.contains(document.activeElement));
    const next =
      e.key === "Home" ? 0 : e.key === "End" ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, index + (e.key === "ArrowDown" ? 1 : -1)));
    e.preventDefault();
    rows[next]?.focus();
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[760px] px-8 pb-16 pt-8">
        <div className="mb-5 flex items-end gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold text-ink">{tr("notetypes-note-types")}</h2>
            <p className="mt-1 text-[13px] text-ink-2">{tn("listLead")}</p>
          </div>
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Plus />
            {tr("actions-add-notetype")}
          </Button>
        </div>

        {query.isError ? (
          <div className="rounded-[12px] border border-line bg-surface px-6 py-10 text-center">
            <p className="text-[13px] font-medium text-ink">{tn("loadFailed")}</p>
            <p className="selectable mt-1 text-[12.5px] text-ink-2">{message(query.error)}</p>
            <Button className="mt-4" onClick={() => void query.refetch()}>
              {t("common.retry")}
            </Button>
          </div>
        ) : !query.data ? (
          <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-ink-3" aria-busy="true">
            <Spinner />
            {t("common.loading")}
          </div>
        ) : entries.length === 0 ? (
          <p className="rounded-[12px] border border-line bg-surface px-6 py-10 text-center text-[13px] text-ink-3">{tn("empty")}</p>
        ) : (
          <ul
            ref={list}
            aria-label={tr("notetypes-note-types")}
            onKeyDown={onListKey}
            className="divide-y divide-line overflow-hidden rounded-[12px] border border-line bg-surface"
          >
            {entries.map((entry) => (
              <li key={String(entry.id)} className="group flex h-[52px] items-center gap-2 pl-1 pr-2 transition-colors duration-[var(--dur-fast)] hover:bg-surface-2">
                <button
                  type="button"
                  data-row
                  onClick={() => open(entry.id)}
                  onKeyDown={(e) => {
                    if (e.key === "F2") {
                      e.preventDefault();
                      setRenaming(entry);
                    } else if (e.key === "Delete") {
                      e.preventDefault();
                      void remove(entry);
                    }
                  }}
                  className="flex h-full min-w-0 flex-1 items-center gap-3 rounded-[8px] px-3 text-left outline-offset-[-2px]"
                >
                  <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{entry.name}</span>
                  <span className={cn("tabular shrink-0 text-[12.5px]", entry.useCount ? "text-ink-2" : "text-ink-3")}>
                    {tr("browsing-note-count", { count: entry.useCount })}
                  </span>
                </button>
                <Button size="sm" variant="ghost" onClick={() => open(entry.id, "fields")}>
                  <ListTree />
                  {tr("notetypes-fields")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => open(entry.id, "templates")}>
                  <Layers />
                  {tr("notetypes-cards")}
                </Button>
                <Menu>
                  <MenuTrigger asChild>
                    <IconButton label={tn("actionsFor", { name: entry.name })} size="sm">
                      <MoreHorizontal />
                    </IconButton>
                  </MenuTrigger>
                  <MenuContent>
                    <MenuItem onSelect={() => setRenaming(entry)} shortcut="F2">
                      <Pencil />
                      {tr("actions-rename")}
                    </MenuItem>
                    <MenuItem onSelect={() => setOptions(entry)}>
                      <Settings2 />
                      {tr("notetypes-options")}
                    </MenuItem>
                    <MenuItem onSelect={() => go({ name: "browse", search: `"note:${entry.name.replace(/["\\*_]/g, (c) => `\\${c}`)}"` })}>
                      <Search />
                      {tn("showNotes")}
                    </MenuItem>
                    <MenuSeparator />
                    <MenuItem danger onSelect={() => void remove(entry)} shortcut="Del">
                      <Trash2 />
                      {tr("actions-delete")}
                    </MenuItem>
                  </MenuContent>
                </Menu>
              </li>
            ))}
          </ul>
        )}
      </div>

      <AddDialog open={adding} notetypes={entries} onClose={() => setAdding(false)} />
      <NameDialog
        open={renaming !== null}
        title={tr("actions-rename")}
        label={tr("actions-new-name")}
        initial={renaming?.name ?? ""}
        onClose={() => setRenaming(null)}
        onSubmit={(name) => renaming && void rename(renaming, name)}
      />
      {options && <OptionsDialog entry={options} onClose={() => setOptions(null)} />}
    </div>
  );
}

/* ------------------------------ Add ------------------------------ */

interface Choice {
  key: string;
  label: string;
  defaultName: string;
  load: () => Promise<Record<string, unknown>>;
}

/** Upstream's AddModel chooser: "Add: Basic" for each stock kind, then "Clone: X" for each Note Type. */
function AddDialog({ open, notetypes, onClose }: { open: boolean; notetypes: NotetypeNameIdUseCount[]; onClose: () => void }) {
  const stock = useQuery({
    queryKey: ["notetypes", "stock"],
    enabled: open,
    queryFn: async () =>
      Promise.all(
        STOCK_KINDS.map(async (kind) => {
          const json = JSON.parse(decoder.decode((await core.getStockNotetypeLegacy({ kind })).json)) as Record<string, unknown>;
          return { kind, json };
        }),
      ),
  });
  const [selected, setSelected] = useState(0);
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const choices = useMemo<Choice[]>(() => {
    const out: Choice[] = (stock.data ?? []).map(({ kind, json }) => {
      const stockName = String(json.name ?? "");
      return {
        key: `stock-${kind}`,
        label: tr("notetypes-add", { val: stockName }),
        defaultName: stockName,
        load: async () => structuredClone(json),
      };
    });
    for (const entry of [...notetypes].sort((a, b) => localeCompare(a.name, b.name))) {
      out.push({
        key: `clone-${entry.id}`,
        label: tr("notetypes-clone", { val: entry.name }),
        defaultName: tr("notetypes-copy", { val: entry.name }),
        load: async () => {
          const json = JSON.parse(decoder.decode((await core.getNotetypeLegacy({ ntid: entry.id })).json)) as Record<string, unknown>;
          json.id = 0;
          json.originalId = null;
          return json;
        },
      });
    }
    return out;
  }, [stock.data, notetypes]);

  const close = () => {
    setSelected(0);
    setName(null);
    onClose();
  };

  const current = choices[selected];
  const shownName = name ?? current?.defaultName ?? "";

  const submit = async () => {
    if (!current || !shownName.trim() || busy) return;
    setBusy(true);
    try {
      const json = await current.load();
      json.name = shownName.trim();
      await core.addNotetypeLegacy({ json: encoder.encode(JSON.stringify(json)) });
      toast.success(tr("card-templates-changes-saved"));
      close();
    } catch (e) {
      toast.error(message(e));
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = Math.max(0, Math.min(choices.length - 1, selected + (e.key === "ArrowDown" ? 1 : -1)));
      setSelected(next);
      setName(null);
      listRef.current?.querySelectorAll<HTMLElement>("[role=option]")[next]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && close()}
      title={tr("notetypes-add-note-type")}
      description={tn("chooseLead")}
      width={480}
      footer={
        <>
          <Button onClick={close}>{tr("actions-cancel")}</Button>
          <Button variant="primary" disabled={!current || !shownName.trim() || busy} onClick={() => void submit()}>
            {busy && <Spinner className="text-on-accent" />}
            {tr("actions-add")}
          </Button>
        </>
      }
    >
      {stock.isError ? (
        <p className="selectable py-6 text-center text-[13px] text-danger">{message(stock.error)}</p>
      ) : !stock.data ? (
        <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-ink-3">
          <Spinner />
          {t("common.loading")}
        </div>
      ) : (
        <>
          <div
            ref={listRef}
            role="listbox"
            tabIndex={0}
            autoFocus
            aria-label={tr("notetypes-add-note-type")}
            aria-activedescendant={current ? `add-choice-${current.key}` : undefined}
            onKeyDown={onKey}
            className="max-h-[300px] overflow-y-auto rounded-[10px] border border-line bg-surface p-1 outline-none focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_var(--accent-soft)]"
          >
            {choices.map((choice, index) => (
              <div
                key={choice.key}
                id={`add-choice-${choice.key}`}
                role="option"
                aria-selected={index === selected}
                onClick={() => {
                  setSelected(index);
                  setName(null);
                }}
                onDoubleClick={() => void submit()}
                className={cn(
                  "flex h-8 cursor-default items-center truncate rounded-[6px] px-2.5 text-[13px] text-ink",
                  index === selected ? "bg-accent-soft text-accent-ink" : "hover:bg-surface-2",
                  index === STOCK_KINDS.length && "mt-1",
                )}
              >
                {choice.label}
              </div>
            ))}
          </div>
          <label className="mt-4 block">
            <span className="mb-1.5 block text-[12.5px] text-ink-2">{plainLabel(tr("actions-name"))}</span>
            <TextField
              value={shownName}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submit();
                }
              }}
            />
          </label>
        </>
      )}
    </Dialog>
  );
}

/* ------------------------------ Options ------------------------------ */

/** Upstream's Options dialog: the LaTeX header, footer and SVG setting. */
function OptionsDialog({ entry, onClose }: { entry: NotetypeNameIdUseCount; onClose: () => void }) {
  const query = useQuery({ queryKey: ["notetype", String(entry.id), "options"], queryFn: () => core.getNotetype({ ntid: entry.id }), staleTime: 0 });
  const [draft, setDraft] = useState<{ pre: string; post: string; svg: boolean } | null>(null);
  const config = query.data?.config;
  const value = draft ?? (config ? { pre: config.latexPre, post: config.latexPost, svg: config.latexSvg } : null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!query.data || !value) return;
    setBusy(true);
    try {
      const nt = query.data;
      if (nt.config) {
        nt.config.latexPre = value.pre;
        nt.config.latexPost = value.post;
        nt.config.latexSvg = value.svg;
      }
      await core.updateNotetype(nt);
      toast.success(tr("card-templates-changes-saved"));
      onClose();
    } catch (e) {
      toast.error(message(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={tr("actions-options-for", { val: entry.name })}
      width={560}
      footer={
        <>
          <Button onClick={onClose}>{tr("actions-cancel")}</Button>
          <Button variant="primary" disabled={!value || busy || !draft} onClick={() => void save()}>
            {tr("actions-save")}
          </Button>
        </>
      }
    >
      {!value ? (
        <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-ink-3">
          <Spinner />
          {t("common.loading")}
        </div>
      ) : (
        <div className="space-y-4 pb-1">
          <p className="text-[12.5px] font-semibold text-ink-2">{tn("latex")}</p>
          <TextArea label={tr("notetypes-header")} value={value.pre} mono rows={7} onChange={(pre) => setDraft({ ...value, pre })} />
          <TextArea label={tr("notetypes-footer")} value={value.post} mono rows={3} onChange={(post) => setDraft({ ...value, post })} />
          <Check checked={value.svg} onChange={(svg) => setDraft({ ...value, svg })}>
            {tr("notetypes-create-scalable-images-with-dvisvgm")}
          </Check>
        </div>
      )}
    </Dialog>
  );
}
