// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** The RWKV scheduling switch and its status (ADR 0005). */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { SettingsNote, SettingsRow, SettingsSection } from "@/components/settings";
import { Button, cn, Spinner, Switch } from "@/components/ui";
import { getRwkvDailyList, getRwkvStatus, prepareRwkv, RwkvModel, RwkvState, rwkvQueryKey, rwkvDailyListQueryKey, setRwkvDailyList, setRwkvEnabled, setRwkvModel, type RwkvStatusResponse } from "@/lib/rwkv";
import { trw } from "@/lib/strings/rwkv";

function statusText(status: RwkvStatusResponse): string {
  if (!status.enabled) return trw("off");
  switch (status.state) {
    case RwkvState.READY:
      return trw("ready");
    case RwkvState.PREPARING:
      return status.total > 0 ? trw("preparing", { done: Number(status.done), total: Number(status.total) }) : trw("preparingStart");
    case RwkvState.FAILED:
      return trw("failed", { message: status.error });
    default:
      return trw("notPrepared");
  }
}

function StatusLine({ status, onRetry }: { status: RwkvStatusResponse; onRetry: () => void }) {
  const failed = status.enabled && status.state === RwkvState.FAILED;
  const tone = !status.enabled ? "bg-ink-3" : status.state === RwkvState.READY ? "bg-accent" : failed ? "bg-danger" : "bg-ink-3";
  return (
    <div role="status" className={cn("mt-1.5 flex items-start gap-2 text-caption", failed ? "text-danger" : "text-ink-2")}>
      <span aria-hidden className={cn("mt-[5px] size-1.5 shrink-0 rounded-full", tone)} />
      <span className="selectable">{statusText(status)}</span>
      {failed && (
        <Button size="sm" className="ms-auto" onClick={onRetry}>
          {trw("retry")}
        </Button>
      )}
    </div>
  );
}

const MODEL_OPTIONS = [
  { model: RwkvModel.BIG, label: "modelBig", hint: "modelBigHint" },
  { model: RwkvModel.SMALL, label: "modelSmall", hint: "modelSmallHint" },
  { model: RwkvModel.TINY, label: "modelTiny", hint: "modelTinyHint" },
] as const;

function ModelPicker({ value, onChange }: { value: RwkvModel; onChange: (model: RwkvModel) => void }) {
  return (
    <div className="px-4 py-2.5">
      <div id="rwkv-model-title" className="text-body text-ink">
        {trw("modelTitle")}
      </div>
      <div role="radiogroup" aria-labelledby="rwkv-model-title" className="mt-2 flex flex-col gap-1.5">
        {MODEL_OPTIONS.map((option, index) => {
          const selected = value === option.model;
          return (
            <button
              key={option.model}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(option.model)}
              onKeyDown={(e) => {
                const delta = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
                if (!delta) return;
                e.preventDefault();
                // Arrows only move focus: choosing a model can start a download and a full replay.
                const next = (index + delta + MODEL_OPTIONS.length) % MODEL_OPTIONS.length;
                e.currentTarget.parentElement?.querySelectorAll("button")[next]?.focus();
              }}
              className={cn(
                "flex items-start gap-3 rounded-[10px] border px-3 py-2 text-start outline-none transition-colors duration-[var(--dur-fast)]",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                selected ? "border-accent bg-surface-2" : "border-line hover:bg-surface-2",
              )}
            >
              <span
                aria-hidden
                className={cn("mt-[3px] grid size-3.5 shrink-0 place-items-center rounded-full border", selected ? "border-accent" : "border-ink-3")}
              >
                {selected && <span className="size-2 rounded-full bg-accent" />}
              </span>
              <span className="min-w-0">
                <span className={cn("block text-body", selected ? "font-semibold text-ink" : "text-ink")}>{trw(option.label)}</span>
                <span className="mt-0.5 block text-pretty text-caption text-ink-3">{trw(option.hint)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function RwkvSection() {
  const client = useQueryClient();
  const { data: status, isPending, isError, refetch } = useQuery({
    queryKey: rwkvQueryKey,
    queryFn: getRwkvStatus,
    // Poll while the core reads the review history.
    refetchInterval: (query) => (query.state.data?.enabled && query.state.data.state !== RwkvState.READY && query.state.data.state !== RwkvState.FAILED ? 1000 : false),
  });

  const { data: dailyList = false } = useQuery({ queryKey: rwkvDailyListQueryKey, queryFn: getRwkvDailyList });

  const run = (action: Promise<unknown>, errorKey: "saveError" | "modelSaveError" = "saveError") => {
    action
      .catch((error: unknown) => {
        toast.error(trw(errorKey), { description: error instanceof Error ? error.message : String(error) });
      })
      .finally(() => {
        void client.invalidateQueries({ queryKey: rwkvQueryKey });
        void client.invalidateQueries({ queryKey: rwkvDailyListQueryKey });
      });
  };

  if (isPending) {
    return (
      <SettingsSection title={trw("title")}>
        <div className="grid h-[72px] place-items-center">
          <Spinner />
        </div>
      </SettingsSection>
    );
  }
  if (isError || !status) {
    return (
      <SettingsSection title={trw("title")}>
        <SettingsRow label={trw("loadError")}>
          <Button size="sm" onClick={() => void refetch()}>
            {trw("retry")}
          </Button>
        </SettingsRow>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection title={trw("title")}>
      <SettingsRow label={trw("enable")} hint={trw("enableHint")}>
        <Switch label={trw("enable")} checked={status.enabled} onChange={(on) => run(setRwkvEnabled(on))} />
      </SettingsRow>
      <div className="px-4 pb-3">
        <StatusLine status={status} onRetry={() => run(prepareRwkv())} />
      </div>
      <ModelPicker value={status.model} onChange={(model) => model !== status.model && run(setRwkvModel(model), "modelSaveError")} />
      <SettingsNote>{trw("modelHint")}</SettingsNote>
      {status.enabled && (
        <SettingsRow label={trw("dailyList")} hint={trw("dailyListHint")}>
          <Switch label={trw("dailyList")} checked={dailyList} onChange={(on) => run(setRwkvDailyList(on))} />
        </SettingsRow>
      )}
    </SettingsSection>
  );
}
