// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Settings for the built-in AnkiConnect server: on or off, port, allowed
 * origins and API key. Every change is saved at once; the server picks up
 * origins and the key without restarting.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Plus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { SettingsRow, SettingsSection } from "@/components/settings";
import { Button, cn, IconButton, NumberField, Spinner, Switch, TextField } from "@/components/ui";
import { checkOrigin, getAnkiConnect, queryKey, setAnkiConnect, type AnkiConnectConfig, type AnkiConnectSnapshot, type AnkiConnectStatus } from "@/lib/ankiconnect";
import { tac } from "@/lib/strings/ankiconnect";

function StatusLine({ status }: { status: AnkiConnectStatus }) {
  const port = (n: number) => String(n);
  const [tone, text] =
    status.state === "listening"
      ? ["bg-accent", tac("listening", { port: port(status.port) })]
      : status.state === "failed"
        ? ["bg-danger", status.inUse ? tac("portInUse", { port: port(status.port) }) : tac("failed", { port: port(status.port), message: status.message })]
        : ["bg-ink-3", tac("off")];
  return (
    <div role="status" className={cn("mt-1.5 flex items-start gap-2 text-caption", status.state === "failed" ? "text-danger" : "text-ink-2")}>
      <span aria-hidden className={cn("mt-[5px] size-1.5 shrink-0 rounded-full", tone)} />
      <span className="selectable">{text}</span>
    </div>
  );
}

function Origins({ origins, onChange }: { origins: string[]; onChange: (next: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const add = () => {
    const check = checkOrigin(draft, origins);
    if (!check.ok) {
      setProblem(check.reason === "duplicate" ? tac("duplicateOrigin") : tac("invalidOrigin"));
      return;
    }
    onChange([...origins, check.origin]);
    setDraft("");
    setProblem(null);
  };
  return (
    <div className="px-4 py-3">
      <label htmlFor="ankiconnect-origin" className="text-body text-ink">
        {tac("origins")}
      </label>
      <div className="mt-0.5 text-pretty text-caption text-ink-3">{tac("originsHint")}</div>
      {origins.length === 0 ? (
        <div className="mt-3 text-pretty rounded-[8px] border border-dashed border-line px-3 py-2.5 text-caption text-ink-3">{tac("originsEmpty")}</div>
      ) : (
        <ul className="mt-3 divide-y divide-line overflow-hidden rounded-[8px] border border-line">
          {origins.map((origin) => (
            <li key={origin} className="flex h-9 items-center gap-2 ps-3 pe-1">
              <span className="selectable min-w-0 flex-1 truncate font-mono text-caption text-ink">{origin}</span>
              <IconButton size="sm" label={tac("removeOrigin", { origin })} onClick={() => onChange(origins.filter((o) => o !== origin))}>
                <X />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <TextField
          id="ankiconnect-origin"
          className="flex-1 font-mono"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          placeholder={tac("originPlaceholder")}
          value={draft}
          aria-invalid={problem !== null}
          aria-describedby={problem ? "ankiconnect-origin-problem" : undefined}
          onChange={(e) => {
            setDraft(e.target.value);
            setProblem(null);
          }}
        />
        <Button type="submit" disabled={!draft.trim()}>
          <Plus />
          {tac("addOrigin")}
        </Button>
      </form>
      {problem && (
        <div id="ankiconnect-origin-problem" role="alert" className="mt-1.5 text-caption text-danger">
          {problem}
        </div>
      )}
    </div>
  );
}

/** Commits on blur or Enter, so typing does not save on every key. */
function ApiKey({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const commit = () => {
    if (draft !== null && draft.trim() !== value) onChange(draft.trim());
    setDraft(null);
  };
  return (
    <div className="flex shrink-0 items-center gap-1">
      <TextField
        id="ankiconnect-key"
        className="w-[220px] font-mono"
        type={shown ? "text" : "password"}
        autoComplete="off"
        spellCheck={false}
        placeholder={tac("apiKeyPlaceholder")}
        value={draft ?? value}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          else if (e.key === "Escape" && draft !== null) (e.stopPropagation(), setDraft(null));
        }}
      />
      <IconButton label={shown ? tac("hideKey") : tac("showKey")} aria-pressed={shown} onClick={() => setShown((s) => !s)}>
        {shown ? <EyeOff /> : <Eye />}
      </IconButton>
    </div>
  );
}

export function AnkiConnectSection() {
  const client = useQueryClient();
  const { data, isPending, isError, refetch } = useQuery({ queryKey, queryFn: getAnkiConnect });

  const save = (patch: Partial<AnkiConnectConfig>) => {
    const current = client.getQueryData<AnkiConnectSnapshot>(queryKey);
    if (!current) return;
    const config = { ...current.config, ...patch };
    client.setQueryData<AnkiConnectSnapshot>(queryKey, { ...current, config });
    setAnkiConnect(config)
      .then((snapshot) => client.setQueryData(queryKey, snapshot))
      .catch((error: unknown) => {
        toast.error(tac("saveError"), { description: error instanceof Error ? error.message : String(error) });
        void client.invalidateQueries({ queryKey });
      });
  };

  if (isPending) {
    return (
      <SettingsSection title={tac("title")}>
        <div className="grid h-[52px] place-items-center">
          <Spinner />
        </div>
      </SettingsSection>
    );
  }
  if (isError || !data) {
    return (
      <SettingsSection title={tac("title")}>
        <SettingsRow label={tac("loadError")}>
          <Button size="sm" onClick={() => void refetch()}>
            {tac("retry")}
          </Button>
        </SettingsRow>
      </SettingsSection>
    );
  }

  const { config, status } = data;
  return (
    <SettingsSection title={tac("title")}>
      <SettingsRow
        label={tac("enable")}
        hint={
          <>
            {tac("enableHint")}
            <StatusLine status={status} />
          </>
        }
      >
        <Switch label={tac("enable")} checked={config.enabled} onChange={(enabled) => save({ enabled })} />
      </SettingsRow>
      <SettingsRow label={tac("port")} hint={tac("portHint")} htmlFor="ankiconnect-port">
        <NumberField id="ankiconnect-port" label={tac("port")} value={config.port} min={1024} max={65535} onChange={(port) => save({ port })} />
      </SettingsRow>
      <Origins origins={config.origins} onChange={(origins) => save({ origins })} />
      <SettingsRow label={tac("apiKey")} hint={tac("apiKeyHint")} htmlFor="ankiconnect-key">
        <ApiKey value={config.apiKey} onChange={(apiKey) => save({ apiKey })} />
      </SettingsRow>
    </SettingsSection>
  );
}
