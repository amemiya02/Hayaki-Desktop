// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Closing the window or quitting (`src-tauri/src/lifecycle.rs`). The shell
 * asks first, so the open profile can sync on close as in Anki; then the
 * shell backs up, closes the collection and exits. Asking to quit again while
 * this runs quits at once. Also reports a periodic backup that failed.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { toast } from "sonner";

import { tr } from "@/lib/i18n";
import { beforeProfileClose } from "@/lib/lifecycle";
import { useApp } from "@/lib/session-store";

let closing = false;

async function closeApp(): Promise<void> {
  await invoke("lifecycle_close_ack");
  if (closing) return;
  closing = true;
  try {
    if (useApp.getState().status === "ready") await beforeProfileClose();
  } finally {
    toast.loading(tr("qt-misc-backing-up"), { id: "lifecycle-closing", duration: Infinity });
    await invoke("lifecycle_quit");
  }
}

export function LifecycleHost() {
  useEffect(() => {
    const unlisten = [
      listen("lifecycle://close-requested", () => void closeApp()),
      listen<string>("lifecycle://backup-failed", (event) => toast.error(tr("profiles-backup-creation-failed", { reason: event.payload }))),
    ];
    return () => unlisten.forEach((p) => void p.then((off) => off()));
  }, []);
  return null;
}
