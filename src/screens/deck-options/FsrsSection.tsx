// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** The FSRS section: the switch, desired retention, parameters and the optimiser. */
import { ChartLine, Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button, cn, Spinner, TextField } from "@/components/ui";
import * as core from "@/lib/anki/generated/core";
import type { ComputeParamsProgress } from "@/lib/anki/proto/anki/collection_pb";
import type { GetRetentionWorkloadResponse } from "@/lib/anki/proto/anki/deck_config_pb";
import { tr } from "@/lib/i18n";
import { td } from "@/lib/strings/deck-options";

import { Message, Row, Section, Switch } from "./controls";
import { SimulatorDialog } from "./Simulator";
import { currentConfig, defaultParamSearch, fsrsParams, setFlag, tabbedValue, updateConfig, type OptionsState } from "./model";
import { isInterrupted, progressText, withProgress } from "./progress";
import { TabbedNumberRow, type SectionProps } from "./sections";
import * as w from "./warnings";

export interface FsrsSectionProps extends SectionProps {
  /** Shows a message the way Anki's page uses `alert`. */
  notify: (text: string) => void;
  /** Saves every change and optimises all presets (Anki's "Optimize All Presets"). */
  onOptimizeAll: () => void;
}

function ignoreBeforeMs(date: string): bigint {
  return BigInt(date ? new Date(date).getTime() : 0);
}

/** Anki's workload estimate for a change of desired retention. */
function useWorkloadInfo(state: OptionsState, retention: number, show: boolean): string {
  const params = fsrsParams(currentConfig(state));
  const paramsKey = params.join(",");
  const search = defaultParamSearch(state);
  const starting = useRef<string | null>(null);
  if (starting.current === null) starting.current = retention.toFixed(2);
  const cache = useRef<{ key: string; promise: Promise<GetRetentionWorkloadResponse> } | null>(null);
  const [info, setInfo] = useState("");
  const rounded = Number(retention.toFixed(2));

  useEffect(() => {
    if (!show) return;
    if (+starting.current! === rounded) {
      setInfo(tr("deck-config-workload-factor-unchanged"));
      return;
    }
    const key = `${paramsKey}|${search}`;
    if (!cache.current || cache.current.key !== key) {
      cache.current = { key, promise: core.getRetentionWorkload({ w: paramsKey ? paramsKey.split(",").map(Number) : [], search }) };
    }
    let cancelled = false;
    const previous = Math.round(+starting.current! * 100);
    const after = Math.round(rounded * 100);
    cache.current.promise
      .then((resp) => {
        if (cancelled) return;
        const factor = resp.costs[after] / resp.costs[previous];
        setInfo(
          Number.isFinite(factor)
            ? tr("deck-config-workload-factor-change", { factor: factor.toFixed(2), previousDR: previous.toString() })
            : "",
        );
      })
      .catch(() => !cancelled && setInfo(""));
    return () => {
      cancelled = true;
    };
  }, [show, rounded, paramsKey, search]);

  return show ? info : "";
}

function ParamsRow({ state, update, notify }: FsrsSectionProps) {
  const config = currentConfig(state);
  const params = config.fsrsParams6;
  const [unlocked, setUnlocked] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const label = tr("deck-config-weights");
  const text = w.formatParams(params);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [draft, text]);

  const commit = () => {
    if (draft === null) return;
    const parsed = w.parseParams(draft);
    setDraft(null);
    if (parsed) update((s) => updateConfig(s, { fsrsParams6: parsed }));
    else notify(tr("deck-config-invalid-parameters"));
  };

  return (
    <Row
      label={label}
      name={label}
      help={tr("deck-config-weights-tooltip2") + "\n\n" + tr("deck-config-compute-optimal-weights-tooltip2")}
      onRestore={params.length ? () => update((s) => updateConfig(s, { fsrsParams6: [] })) : undefined}
      messages={[unlocked ? { key: "deck-config-manual-parameter-edit-warning", level: "danger" } : null]}
      below={
        <div className="space-y-2">
          <textarea
            ref={area}
            aria-label={label}
            rows={2}
            spellCheck={false}
            readOnly={!unlocked}
            value={draft ?? text}
            placeholder={tr("deck-config-placeholder-parameters")}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            className={cn(
              "selectable tabular block w-full resize-none overflow-y-auto rounded-[8px] border border-line px-2.5 py-2 font-mono text-[12px] leading-relaxed outline-none",
              unlocked
                ? "bg-surface text-ink focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]"
                : "bg-surface-2 text-ink-2",
            )}
          />
          <TextField
            aria-label={`${label}: ${tr("actions-search")}`}
            value={config.paramSearch}
            placeholder={defaultParamSearch(state)}
            spellCheck={false}
            onChange={(e) => update((s) => updateConfig(s, { paramSearch: e.target.value }))}
          />
        </div>
      }
    >
      {!unlocked && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setUnlocked(true);
            requestAnimationFrame(() => area.current?.focus());
          }}
        >
          <Pencil />
          {td("editParams")}
        </Button>
      )}
    </Row>
  );
}

function Optimizer({ state, update, notify, onOptimized }: FsrsSectionProps & { onOptimized: () => void }) {
  const [running, setRunning] = useState<"optimize" | "evaluate" | null>(null);
  const [progress, setProgress] = useState<ComputeParamsProgress | undefined>();
  const [reviews, setReviews] = useState<number | undefined>();
  const mounted = useRef(true);
  useEffect(() => () => void (mounted.current = false), []);

  const config = currentConfig(state);
  const search = config.paramSearch || defaultParamSearch(state);

  const start = async (kind: "optimize" | "evaluate") => {
    if (running) {
      await core.setWantsAbort();
      return;
    }
    if (state.assignmentsChanged) {
      notify(tr("deck-config-please-save-your-changes-first"));
      return;
    }
    setRunning(kind);
    setProgress(undefined);
    let last: ComputeParamsProgress | undefined;
    const track = (p: ComputeParamsProgress) => {
      last = p;
      if (mounted.current) setProgress(p);
    };
    try {
      if (kind === "optimize") {
        const params = fsrsParams(config);
        const resp = await withProgress(
          () =>
            core.computeFsrsParams({
              search,
              ignoreRevlogsBeforeMs: ignoreBeforeMs(config.ignoreRevlogsBeforeDate),
              currentParams: params,
              numOfRelearningSteps: w.relearningStepsInDay(config.relearnSteps),
              healthCheck: state.fsrsHealthCheck,
            }),
          track,
        );
        const alreadyOptimal = w.paramsAlreadyOptimal(params, resp.params);
        const health =
          resp.healthCheckPassed === undefined
            ? ""
            : resp.healthCheckPassed
              ? tr("deck-config-fsrs-good-fit")
              : tr("deck-config-fsrs-bad-fit-warning");
        const optimal = alreadyOptimal
          ? resp.fsrsItems
            ? tr("deck-config-fsrs-params-optimal")
            : tr("deck-config-fsrs-params-no-reviews")
          : "";
        const message = [optimal, health].filter((m) => m).join("\n\n");
        if (!alreadyOptimal) {
          update((s) => updateConfig(s, { fsrsParams6: resp.params }));
          onOptimized();
        }
        if (message) notify(message);
      } else {
        const resp = await withProgress(
          () =>
            core.evaluateParamsLegacy({
              search,
              ignoreRevlogsBeforeMs: ignoreBeforeMs(config.ignoreRevlogsBeforeDate),
              params: fsrsParams(config),
            }),
          track,
        );
        notify(
          `Log loss: ${resp.logLoss.toFixed(4)}, RMSE(bins): ${(resp.rmseBins * 100).toFixed(2)}%. ${tr("deck-config-smaller-is-better")}`,
        );
      }
      if (last) setReviews(last.reviews);
    } catch (error) {
      if (!isInterrupted(error)) notify(error instanceof Error ? error.message : String(error));
    } finally {
      if (mounted.current) setRunning(null);
    }
  };

  const pct = progress && progress.total ? (progress.current / progress.total) * 100 : 0;
  const status = running ? progressText(progress) : reviews !== undefined ? tr("statistics-reviews", { reviews }) : "";

  return (
    <div className="space-y-3 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant={running === "optimize" ? "secondary" : "primary"} disabled={running === "evaluate"} onClick={() => void start("optimize")}>
          {running === "optimize" && <Spinner />}
          {running === "optimize" ? tr("actions-cancel") : tr("deck-config-optimize-button")}
        </Button>
        {state.legacyEvaluate && (
          <Button disabled={running === "optimize"} onClick={() => void start("evaluate")}>
            {running === "evaluate" && <Spinner />}
            {running === "evaluate" ? tr("actions-cancel") : tr("deck-config-evaluate-button")}
          </Button>
        )}
        {status && <span className="tabular text-[12.5px] text-ink-2" aria-live="polite">{status}</span>}
      </div>
      {running && (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
          className="h-1 overflow-hidden rounded-full bg-surface-3"
        >
          <div className="h-full rounded-full bg-accent transition-[width] duration-200 ease-linear" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

export function FsrsSection(props: FsrsSectionProps) {
  const { state, update } = props;
  const config = currentConfig(state);
  const fsrsLabel = "FSRS";
  // Anki shows the workload estimate once FSRS is newly enabled, retention focused, or parameters optimised.
  const [newlyEnabled, setNewlyEnabled] = useState(() => !state.fsrs);
  useEffect(() => {
    if (!state.fsrs) setNewlyEnabled(true);
  }, [state.fsrs]);
  const [focused, setFocused] = useState(false);
  const [optimized, setOptimized] = useState(false);
  const retention = state.fsrs ? tabbedValue(state, "retention") : config.desiredRetention;
  const workload = useWorkloadInfo(state, retention, state.fsrs && (newlyEnabled || focused || optimized));
  const retentionWarning = w.desiredRetentionWarning(retention);
  const lastOptimization = w.timeToOptimize(state.daysSinceLastOptimization);

  // The simulators use saved parameters: after optimising, the preset has to be saved first.
  const [simulator, setSimulator] = useState<"review" | "workload" | null>(null);
  const initialParams = useRef(new Map<bigint, string>());
  const presetId = state.presets[state.selected].config.id;
  if (!initialParams.current.has(presetId)) initialParams.current.set(presetId, fsrsParams(config).join(","));
  const openSimulator = (kind: "review" | "workload") => {
    if (fsrsParams(config).join(",") === initialParams.current.get(presetId)) setSimulator(kind);
    else props.notify(tr("deck-config-fsrs-simulate-save-preset"));
  };

  return (
    <Section id="fsrs" title="FSRS">
      <Row label={fsrsLabel} name={fsrsLabel} help={tr("deck-config-fsrs-tooltip")} global>
        <Switch label={fsrsLabel} checked={state.fsrs} onChange={(v) => update((s) => setFlag(s, "fsrs", v))} />
      </Row>
      {state.fsrs && (
        <>
          <TabbedNumberRow
            {...props}
            kind="retention"
            label={tr("deck-config-desired-retention")}
            help={tr("deck-config-desired-retention-tooltip") + "\n\n" + tr("deck-config-desired-retention-tooltip2")}
            defaultValue={state.defaults.desiredRetention}
            field={{ min: 0.7, max: 0.99, step: 0.01, percentage: true }}
            onFocus={() => setFocused(true)}
            messages={[workload ? { key: "workload", level: "info", text: workload } : null, retentionWarning]}
          />
          <div className="px-4 py-3">
            <Button onClick={() => openSimulator("workload")}>
              {tr("deck-config-fsrs-desired-retention-help-me-decide-experimental")}
            </Button>
          </div>
          <ParamsRow {...props} />
          <Row
            label={tr("deck-config-reschedule-cards-on-change")}
            name={tr("deck-config-reschedule-cards-on-change")}
            help={tr("deck-config-reschedule-cards-on-change-tooltip")}
            global
            messages={[state.fsrsReschedule ? { key: "deck-config-reschedule-cards-warning", level: "warning" } : null]}
          >
            <Switch
              label={tr("deck-config-reschedule-cards-on-change")}
              checked={state.fsrsReschedule}
              onChange={(v) => update((s) => setFlag(s, "fsrsReschedule", v))}
            />
          </Row>
          <Row
            label={tr("deck-config-slow-suffix", { text: tr("deck-config-health-check") })}
            name={tr("deck-config-health-check")}
            help={[
              tr("deck-config-affects-entire-collection"),
              tr("deck-config-health-check-tooltip1"),
              tr("deck-config-health-check-tooltip2"),
            ].join("\n\n")}
            global
          >
            <Switch
              label={tr("deck-config-health-check")}
              checked={state.fsrsHealthCheck}
              onChange={(v) => update((s) => setFlag(s, "fsrsHealthCheck", v))}
            />
          </Row>
          <Optimizer {...props} onOptimized={() => setOptimized(true)} />
          <div className="space-y-2.5 px-4 py-3">
            {lastOptimization && <Message warning={lastOptimization} />}
            <Button onClick={props.onOptimizeAll}>{tr("deck-config-save-and-optimize")}</Button>
          </div>
          <div className="px-4 py-3">
            <Button onClick={() => openSimulator("review")}>
              <ChartLine />
              {tr("deck-config-fsrs-simulator-experimental")}
            </Button>
          </div>
          <SimulatorDialog
            open={simulator === "review"}
            onOpenChange={(open) => setSimulator(open ? "review" : null)}
            state={state}
            update={update}
          />
          <SimulatorDialog
            open={simulator === "workload"}
            onOpenChange={(open) => setSimulator(open ? "workload" : null)}
            workload
            state={state}
            update={update}
          />
        </>
      )}
    </Section>
  );
}
