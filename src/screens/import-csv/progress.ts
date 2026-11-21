// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import * as core from "@/lib/anki/generated/core";

/** Runs an import, polling the core's progress text every 200ms until it ends. */
export async function withImportProgress<T>(task: () => Promise<T>, onProgress: (text: string) => void): Promise<T> {
  let done = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const poll = async () => {
    if (done) return;
    try {
      const progress = await core.latestProgress();
      if (!done && progress.value.case === "importing") onProgress(progress.value.value);
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
