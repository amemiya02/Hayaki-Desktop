// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * `await confirm({...})` from anywhere; the host renders the dialog. Requests
 * made while one is open wait their turn, so none replaces another.
 */
import { create } from "zustand";

import { t } from "@/lib/i18n";

import { Button, Dialog } from "./ui";

export interface ConfirmOptions {
  title: string;
  message: string;
  confirm: string;
  danger?: boolean;
  /** Aborting closes the dialog, or takes it out of the queue, as Cancel. */
  signal?: AbortSignal;
}

interface Request extends Omit<ConfirmOptions, "signal"> {
  resolve: (ok: boolean) => void;
}

const useConfirm = create<{ queue: Request[] }>(() => ({ queue: [] }));

export function confirm({ signal, ...options }: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(false);
    const abort = () => request.resolve(false);
    const request: Request = {
      ...options,
      resolve: (ok) => {
        signal?.removeEventListener("abort", abort);
        useConfirm.setState((s) => ({ queue: s.queue.filter((r) => r !== request) }));
        resolve(ok);
      },
    };
    signal?.addEventListener("abort", abort, { once: true });
    useConfirm.setState((s) => ({ queue: [...s.queue, request] }));
  });
}

export function ConfirmHost() {
  const request = useConfirm((s) => s.queue[0]);
  const close = (ok: boolean) => request?.resolve(ok);
  return (
    <Dialog
      open={!!request}
      onOpenChange={(open) => !open && close(false)}
      title={request?.title ?? ""}
      description={request?.message}
      footer={
        <>
          {/* The safe choice takes the initial focus. */}
          <Button autoFocus data-autofocus onClick={() => close(false)}>
            {t("common.cancel")}
          </Button>
          <Button variant={request?.danger ? "danger" : "primary"} onClick={() => close(true)}>
            {request?.confirm}
          </Button>
        </>
      }
    />
  );
}
