// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** `await confirm({...})` from anywhere; the host renders the dialog. */
import { create } from "zustand";

import { t } from "@/lib/i18n";

import { Button, Dialog } from "./ui";

interface Request {
  title: string;
  message: string;
  confirm: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

const useConfirm = create<{ request: Request | null }>(() => ({ request: null }));

export function confirm(options: Omit<Request, "resolve">): Promise<boolean> {
  return new Promise((resolve) => useConfirm.setState({ request: { ...options, resolve } }));
}

export function ConfirmHost() {
  const request = useConfirm((s) => s.request);
  const close = (ok: boolean) => {
    request?.resolve(ok);
    useConfirm.setState({ request: null });
  };
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
