// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** The RWKV scheduling switch and its status (ADR 0005). */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { SettingsNote, SettingsRow, SettingsSection } from "@/components/settings";
import { Button, cn, Spinner, Switch } from "@/components/ui";
import { getRwkvStatus, prepareRwkv, RwkvState, rwkvQueryKey, setRwkvEnabled, type RwkvStatusResponse } from "@/lib/rwkv";
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

export function RwkvSection() {
  const client = useQueryClient();
  const { data: status, isPending, isError, refetch } = useQuery({
    queryKey: rwkvQueryKey,
    queryFn: getRwkvStatus,
    // Poll while the core reads the review history.
    refetchInterval: (query) => (query.state.data?.enabled && query.state.data.state !== RwkvState.READY && query.state.data.state !== RwkvState.FAILED ? 1000 : false),
  });

  const run = (action: Promise<unknown>) => {
    action
      .catch((error: unknown) => {
        toast.error(trw("saveError"), { description: error instanceof Error ? error.message : String(error) });
      })
      .finally(() => void client.invalidateQueries({ queryKey: rwkvQueryKey }));
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
      <SettingsNote>{trw("syncHint")}</SettingsNote>
      <SettingsNote>{trw("weightsHint")}</SettingsNote>
    </SettingsSection>
  );
}
