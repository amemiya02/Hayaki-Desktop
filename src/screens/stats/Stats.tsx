// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Statistics, rebuilt natively from Anki's graphs page. Every figure comes
 * from the core's GraphsResponse and is bucketed as upstream's TypeScript does.
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertCircle, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Chooser } from "@/components/editor/Chooser";
import { Button, Segmented, Spinner, TextField } from "@/components/ui";
import * as core from "@/lib/anki/generated/core";
import { tr } from "@/lib/i18n";
import { useNav } from "@/lib/nav";
import { queryClient, useCurrentDeck } from "@/lib/queries";
import { te } from "@/lib/strings/editor";
import { ts } from "@/lib/strings/stats";

import { daysToRevlogRange, type GraphRange } from "./data";
import { capitalize, MONTH, timeSpan, YEAR } from "./format";
import { PanelSkeleton } from "./Panel";
import {
  AddedSection,
  ButtonsSection,
  CalendarSection,
  CardCountsSection,
  DifficultySection,
  EaseSection,
  FutureDueSection,
  HoursSection,
  IntervalsSection,
  RetrievabilitySection,
  ReviewsSection,
  StabilitySection,
  TodaySection,
  TrueRetentionSection,
  type Prefs,
  type SectionProps,
} from "./sections";

type Scope = "deck" | "collection" | "custom";

/** A Deck search that matches the name literally. */
function deckSearch(name: string): string {
  return `deck:"${name.replace(/[\\"*_]/g, (c) => `\\${c}`)}"`;
}

const PREFS_KEY = ["stats", "prefs"] as const;

export function StatsScreen({ deckId }: { deckId?: bigint }) {
  const go = useNav((s) => s.go);
  const [scope, setScope] = useState<Scope>("deck");
  const [custom, setCustom] = useState("");
  const [draft, setDraft] = useState("");
  const [range, setRange] = useState<GraphRange>("month");
  const [chosenId, setChosenId] = useState<bigint | undefined>(deckId);
  const [choosing, setChoosing] = useState(false);
  const cancelled = useRef(false);
  useEffect(() => setChosenId(deckId), [deckId]);

  const { data: decks } = useQuery({
    queryKey: ["stats", "deckNames"],
    queryFn: async () =>
      (await core.getDeckNames({ skipEmptyDefault: true, includeFiltered: true })).entries.map((e) => ({ id: e.id, name: e.name })),
  });
  const { data: current } = useCurrentDeck();
  const selectedId = chosenId ?? current?.id;
  const deckName = decks?.find((d) => d.id === selectedId)?.name;

  const deckQuery = chosenId === undefined ? "deck:current" : deckName ? deckSearch(deckName) : null;
  const search = scope === "deck" ? deckQuery : scope === "collection" ? "" : custom;
  const days = range === "all" ? 0 : 365;
  const revlogRange = daysToRevlogRange(days);

  useEffect(() => {
    if (scope !== "custom") setDraft(search ?? "");
  }, [scope, search]);

  const prefsQuery = useQuery({ queryKey: PREFS_KEY, queryFn: () => core.getGraphPreferences() });
  const graphs = useQuery({
    queryKey: ["stats", "graphs", search, days],
    queryFn: () => core.graphs({ search: search!, days }),
    enabled: search !== null,
    placeholderData: keepPreviousData,
  });

  const setPref = useCallback(<K extends keyof Prefs>(key: K, value: Prefs[K]) => {
    const old = queryClient.getQueryData<Awaited<ReturnType<typeof core.getGraphPreferences>>>(PREFS_KEY);
    if (!old) return;
    const next = { ...old, [key]: value };
    queryClient.setQueryData(PREFS_KEY, next);
    void core.setGraphPreferences(next);
  }, []);

  const browse = useCallback(
    (query: string) => go({ name: "browse", search: `${search ?? ""} ${query}`.trim() }),
    [go, search],
  );

  const applySearch = () => {
    const text = draft.trim();
    if (text === "deck:current" || (deckQuery !== null && text === deckQuery)) setScope("deck");
    else if (text === "") setScope("collection");
    else {
      setCustom(text);
      setScope("custom");
    }
  };

  const periods: { value: GraphRange; label: string }[] = [
    { value: "month", label: capitalize(timeSpan(MONTH)) },
    { value: "threeMonths", label: capitalize(timeSpan(3 * MONTH)) },
    { value: "year", label: capitalize(timeSpan(YEAR)) },
    { value: "all", label: capitalize(tr("statistics-range-all-time")) },
  ];

  const data = graphs.data;
  const prefs = prefsQuery.data;

  let body;
  if (graphs.isError) {
    body = (
      <div className="@min-[1000px]:col-span-2 flex flex-col items-center rounded-[12px] border border-line bg-surface px-6 py-12 text-center">
        <AlertCircle className="size-5 text-danger" />
        <p className="mt-3 text-body font-medium text-ink">{ts("loadError")}</p>
        <p className="selectable mt-1 max-w-[60ch] text-control text-ink-2">{(graphs.error as Error).message}</p>
        <Button className="mt-4" size="sm" onClick={() => void graphs.refetch()}>
          {ts("retry")}
        </Button>
      </div>
    );
  } else if (!data || !prefs) {
    body = (
      <>
        <PanelSkeleton wide height={72} />
        <PanelSkeleton />
        <PanelSkeleton />
        <PanelSkeleton wide height={140} />
        <PanelSkeleton />
        <PanelSkeleton />
      </>
    );
  } else {
    const props: SectionProps = {
      data,
      range,
      revlogRange,
      prefs: {
        calendarFirstDayOfWeek: prefs.calendarFirstDayOfWeek,
        cardCountsSeparateInactive: prefs.cardCountsSeparateInactive,
        futureDueShowBacklog: prefs.futureDueShowBacklog,
      },
      setPref,
      browse,
    };
    body = (
      <>
        <TodaySection {...props} />
        <FutureDueSection {...props} />
        <ReviewsSection {...props} />
        <CalendarSection {...props} />
        <CardCountsSection {...props} />
        <IntervalsSection {...props} />
        {data.fsrs ? (
          <>
            <StabilitySection {...props} />
            <DifficultySection {...props} />
            <RetrievabilitySection {...props} />
          </>
        ) : (
          <EaseSection {...props} />
        )}
        <TrueRetentionSection {...props} />
        <HoursSection {...props} />
        <ButtonsSection {...props} />
        <AddedSection {...props} />
      </>
    );
  }

  return (
    <div className="@container h-full overflow-y-auto">
      <div className="sticky top-0 z-20 border-b border-line bg-bg/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-3 gap-y-2 px-6 py-3">
          <Segmented<Scope>
            label={ts("scope")}
            value={scope}
            onChange={setScope}
            options={[
              { value: "deck", label: capitalize(tr("statistics-range-deck")) },
              { value: "collection", label: capitalize(tr("statistics-range-collection")) },
            ]}
          />
          <form
            role="search"
            className="relative w-[280px] min-w-[180px] shrink"
            onSubmit={(e) => {
              e.preventDefault();
              applySearch();
            }}
          >
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
            <TextField
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                if (cancelled.current) cancelled.current = false;
                else applySearch();
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  cancelled.current = true;
                  setDraft(search ?? "");
                  e.currentTarget.blur();
                }
              }}
              placeholder={tr("statistics-range-search")}
              aria-label={tr("statistics-range-search")}
              title={ts("searchApply")}
              className="bg-surface-2 pl-8"
            />
          </form>
          {scope === "deck" && (
            <Chooser
              label={tr("decks-deck")}
              items={decks ?? []}
              value={selectedId ?? null}
              onSelect={setChosenId}
              open={choosing}
              onOpenChange={setChoosing}
              searchLabel={te("searchDecks")}
              hierarchical
            />
          )}
          <span className="ml-auto inline-flex items-center gap-3">
            {graphs.isFetching && <Spinner />}
            <Segmented<GraphRange> label={ts("period")} value={range} onChange={setRange} options={periods} />
          </span>
        </div>
      </div>
      <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-4 px-6 pb-12 pt-5 @min-[1000px]:grid-cols-2 animate-rise-in">
        {body}
      </div>
    </div>
  );
}
