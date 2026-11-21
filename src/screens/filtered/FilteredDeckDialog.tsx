// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** Create, edit and (re)build a filtered Deck (upstream qt/aqt/filtered_deck.py). */
import { AlertTriangle } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button, cn, Dialog, motionTokens, NumberField, Spinner, Switch, TextField } from "@/components/ui";
import * as core from "@/lib/anki/generated/core";
import type { FilteredDeckForUpdate } from "@/lib/anki/proto/anki/decks_pb";
import { t, tr } from "@/lib/i18n";
import { useNav } from "@/lib/nav";
import { tf } from "@/lib/strings/filtered";
import { SelectField } from "@/screens/deck-options/controls";

import { availableOrders, deckFromForm, DYN_MAX_SIZE, formFromDeck, type FilteredForm } from "./model";

interface Loaded {
  deck: FilteredDeckForUpdate;
  labels: string[];
  orders: number[];
}

async function fsrsEnabled(): Promise<boolean> {
  try {
    const out = await core.getConfigJson({ val: "fsrs" });
    return JSON.parse(new TextDecoder().decode(out.json)) === true;
  } catch {
    return false;
  }
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function Check({ label, checked, onChange, id }: { label: string; checked: boolean; onChange: (v: boolean) => void; id?: string }) {
  return (
    <label htmlFor={id} className="flex min-h-8 items-center gap-2.5 text-[13px] text-ink">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 shrink-0 accent-[var(--accent)]" />
      {label}
    </label>
  );
}

export function InlineError({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="alert" className="flex items-start gap-2 text-[12.5px] leading-snug text-danger">
      <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      <span className="selectable whitespace-pre-line">{text}</span>
    </p>
  );
}

/** A section label over an inset group of rows, as in Preferences and Settings. */
function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section>
      {title && <h3 className="mb-1.5 px-1 text-[12px] font-semibold text-ink-2">{title}</h3>}
      <div className="divide-y divide-line overflow-hidden rounded-[10px] border border-line bg-surface-2">{children}</div>
    </section>
  );
}

function GroupRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("px-3.5 py-2.5", className)}>{children}</div>;
}

function SwitchRow({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex min-h-[44px] items-center gap-4 px-3.5 py-2">
      <label htmlFor={id} className="min-w-0 flex-1 text-[13px] text-ink">
        {label}
      </label>
      <Switch id={id} label={label} checked={checked} onChange={onChange} />
    </div>
  );
}

/** Rows that open and close by height; reduced motion makes it instant. */
function Expand({ open, children }: { open: boolean; children: ReactNode }) {
  const m = motionTokens();
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="rows"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ height: { duration: m.base, ease: m.easeOut }, opacity: { duration: m.quick, ease: m.easeOut } }}
          className="divide-y divide-line overflow-hidden border-t border-line"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function FilterFields({
  n,
  search,
  limit,
  order,
  labels,
  orders,
  error,
  onSearch,
  onLimit,
  onOrder,
  onValidate,
  autoFocus,
}: {
  n: 1 | 2;
  search: string;
  limit: number;
  order: number;
  labels: string[];
  orders: number[];
  error: string | null;
  onSearch: (v: string) => void;
  onLimit: (v: number) => void;
  onOrder: (v: number) => void;
  onValidate: () => void;
  autoFocus?: boolean;
}) {
  return (
    <>
      <GroupRow className="flex flex-col gap-1.5">
        <label htmlFor={`filter-search-${n}`} className="text-[12.5px] font-medium text-ink-2">
          {tr("actions-search")}
        </label>
        <TextField
          id={`filter-search-${n}`}
          autoFocus={autoFocus}
          onFocus={(e) => autoFocus && e.currentTarget.select()}
          spellCheck={false}
          data-submit=""
          value={search}
          aria-invalid={!!error}
          onChange={(e) => onSearch(e.target.value)}
          onBlur={onValidate}
          className={cn("font-mono text-[12.5px]", error && "border-danger")}
        />
        <InlineError text={error} />
      </GroupRow>
      <div className="flex min-h-[44px] items-center gap-4 px-3.5 py-2 text-[13px] text-ink">
        <label htmlFor={`filter-limit-${n}`} className="min-w-0 flex-1">
          {tr("decks-limit-to")}
        </label>
        <NumberField id={`filter-limit-${n}`} label={tf("limit")} value={limit} min={1} max={DYN_MAX_SIZE} onChange={onLimit} />
      </div>
      <div className="flex min-h-[44px] items-center gap-4 px-3.5 py-2 text-[13px] text-ink">
        <label htmlFor={`filter-order-${n}`} className="min-w-0 flex-1">
          {tf("order")}
        </label>
        <SelectField
          id={`filter-order-${n}`}
          label={tf("order")}
          value={order}
          choices={orders.map((o) => ({ value: o, label: labels[o] ?? String(o) }))}
          onChange={onOrder}
        />
      </div>
    </>
  );
}

export function FilteredDeckDialog({
  deckId,
  search,
  search2,
  onClose,
}: {
  deckId?: bigint;
  search?: string;
  search2?: string;
  onClose: () => void;
}) {
  const go = useNav((s) => s.go);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<FilteredForm | null>(null);
  const [errors, setErrors] = useState<{ 1: string | null; 2: string | null; save: string | null }>({ 1: null, 2: null, save: null });
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setLoadError(null);
    void (async () => {
      try {
        const [deck, labels, fsrs] = await Promise.all([
          core.getOrCreateFilteredDeck({ did: deckId ?? 0n }),
          core.filteredDeckOrderLabels(),
          fsrsEnabled(),
        ]);
        if (!live) return;
        const orders = availableOrders(labels.vals.length, fsrs);
        setLoaded({ deck, labels: labels.vals, orders });
        setForm(formFromDeck(deck, orders, { search, search2 }));
      } catch (error) {
        if (live) setLoadError(errorText(error));
      }
    })();
    return () => {
      live = false;
    };
    // The searches are only the starting text; reloading on them would discard edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckId, attempt]);

  const patch = (changes: Partial<FilteredForm>) => setForm((f) => (f ? { ...f, ...changes } : f));

  const validate = async (n: 1 | 2) => {
    const text = n === 1 ? form?.search : form?.search2;
    if (text === undefined) return true;
    try {
      await core.buildSearchString({ filter: { case: "parsableText", value: text } });
      setErrors((e) => ({ ...e, [n]: null }));
      return true;
    } catch (error) {
      setErrors((e) => ({ ...e, [n]: errorText(error) }));
      return false;
    }
  };

  const build = async () => {
    if (!loaded || !form || busy) return;
    setBusy(true);
    setErrors((e) => ({ ...e, save: null }));
    const ok1 = await validate(1);
    const ok2 = form.secondFilter ? await validate(2) : true;
    if (!ok1 || !ok2) {
      setBusy(false);
      return;
    }
    try {
      const out = await core.addOrUpdateFilteredDeck(deckFromForm(loaded.deck, form));
      onClose();
      go({ name: "deck", deckId: out.id });
    } catch (error) {
      setErrors((e) => ({ ...e, save: errorText(error) }));
    } finally {
      setBusy(false);
    }
  };

  const buildRef = useRef(build);
  buildRef.current = build;

  const existing = !!loaded && loaded.deck.id !== 0n;
  const title = loaded ? tr("actions-options-for", { val: loaded.deck.name }) : tr("decks-build");

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      width={600}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={!form || busy || !form.name.trim()} onClick={() => void build()}>
            {busy && <Spinner className="text-on-accent" />}
            {existing ? tr("actions-rebuild") : tr("decks-build")}
          </Button>
        </>
      }
    >
      {loadError ? (
        <div className="flex flex-col items-start gap-3 py-4">
          <InlineError text={`${tf("loadError")}\n${loadError}`} />
          <Button size="sm" onClick={() => setAttempt((a) => a + 1)}>
            {tf("retry")}
          </Button>
        </div>
      ) : !form || !loaded ? (
        <div className="grid h-[320px] place-items-center">
          <Spinner className="size-5" />
        </div>
      ) : (
        <div
          className="flex flex-col gap-4 pb-1"
          onKeyDown={(e) => {
            // Enter in a text field builds, as the dialog's default button does upstream.
            // It runs after the field under the caret has committed its value.
            const target = e.target as HTMLElement;
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey || target.dataset.submit !== undefined)) {
              e.preventDefault();
              setTimeout(() => void buildRef.current(), 0);
            }
          }}
        >
          <label className="flex flex-col gap-1.5 text-[12.5px] font-medium text-ink-2">
            {tr("actions-name")}
            <TextField data-submit="" value={form.name} placeholder={loaded.deck.name} onChange={(e) => patch({ name: e.target.value })} />
          </label>

          <Group title={tr("actions-filter")}>
            <FilterFields
              n={1}
              autoFocus={search2 === undefined}
              search={form.search}
              limit={form.limit}
              order={form.order}
              labels={loaded.labels}
              orders={loaded.orders}
              error={errors[1]}
              onSearch={(v) => (patch({ search: v }), setErrors((e) => ({ ...e, 1: null })))}
              onLimit={(v) => patch({ limit: v })}
              onOrder={(v) => patch({ order: v })}
              onValidate={() => void validate(1)}
            />
          </Group>

          {/* The switch row names this group; a heading above it would repeat it. */}
          <Group>
            <SwitchRow id="filter-second" label={tr("decks-enable-second-filter")} checked={form.secondFilter} onChange={(v) => patch({ secondFilter: v })} />
            <Expand open={form.secondFilter}>
              <FilterFields
                n={2}
                autoFocus={search2 !== undefined}
                search={form.search2}
                limit={form.limit2}
                order={form.order2}
                labels={loaded.labels}
                orders={loaded.orders}
                error={errors[2]}
                onSearch={(v) => (patch({ search2: v }), setErrors((e) => ({ ...e, 2: null })))}
                onLimit={(v) => patch({ limit2: v })}
                onOrder={(v) => patch({ order2: v })}
                onValidate={() => void validate(2)}
              />
            </Expand>
          </Group>

          <Group title={tr("actions-options")}>
            <div>
              <SwitchRow id="filter-resched" label={tr("decks-reschedule-cards-based-on-my-answers")} checked={form.reschedule} onChange={(v) => patch({ reschedule: v })} />
              <Expand open={!form.reschedule}>
                {(
                  [
                    ["againSecs", "studying-again"],
                    ["hardSecs", "studying-hard"],
                    ["goodSecs", "studying-good"],
                  ] as const
                ).map(([key, button]) => (
                  <GroupRow key={key} className="flex items-center gap-2.5 py-2 text-[13px] text-ink">
                    <label htmlFor={`filter-${key}`} className="min-w-0 flex-1">
                      {tr("decks-delay-for-button", { button: tr(button) })}
                    </label>
                    <NumberField id={`filter-${key}`} label={tr("decks-delay-for-button", { button: tr(button) })} value={form[key]} min={0} max={99999} onChange={(v) => patch({ [key]: v })} />
                    <span className="w-[60px] text-ink-3">{tr("scheduling-seconds")}</span>
                  </GroupRow>
                ))}
                <GroupRow className="py-2">
                  <p className="text-[12px] text-ink-3">{tr("decks-zero-minutes-hint")}</p>
                </GroupRow>
              </Expand>
            </div>
            <SwitchRow id="filter-empty" label={tr("decks_create_even_if_empty")} checked={form.allowEmpty} onChange={(v) => patch({ allowEmpty: v })} />
          </Group>

          <InlineError text={errors.save} />
        </div>
      )}
    </Dialog>
  );
}
