// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import * as core from "@/lib/anki/generated/core";
import type { ComputeParamsProgress } from "@/lib/anki/proto/anki/collection_pb";
import { CoreError } from "@/lib/anki/transport";
import { tr } from "@/lib/i18n";

/** Runs a long core task, polling its progress every 200ms until it ends. */
export async function withProgress<T>(task: () => Promise<T>, onProgress: (progress: ComputeParamsProgress) => void): Promise<T> {
  let done = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const poll = async () => {
    if (done) return;
    try {
      const progress = await core.latestProgress();
      if (!done && progress.value.case === "computeParams") onProgress(progress.value.value);
    } catch {
      // Progress is best effort; the task reports its own errors.
    }
    if (!done) timer = setTimeout(poll, 200);
  };
  timer = setTimeout(poll, 200);
  try {
    return await task();
  } finally {
    done = true;
    clearTimeout(timer);
  }
}

export function isInterrupted(error: unknown): boolean {
  return error instanceof CoreError && error.isInterrupted;
}

/** Anki's progress line for parameter optimisation. */
export function progressText(progress: ComputeParamsProgress | undefined): string {
  if (!progress || !progress.total) return "";
  if (progress.current === progress.total) return tr("deck-config-checking-for-improvement");
  const pct = ((progress.current / progress.total) * 100).toFixed(1);
  return tr("deck-config-percent-of-reviews", { pct, reviews: progress.reviews });
}
