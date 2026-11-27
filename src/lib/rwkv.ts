// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * RWKV scheduling (ADR 0005, Android ADR-0009). The switch is the collection
 * config key `hayakiRwkvScheduling` and the model `hayakiRwkvModel`, so both sync. The core keeps the model
 * state and builds the review queue; the app only switches it, starts
 * preparation, and shows the status.
 */
import * as core from "@/lib/anki/generated/core";
import { RwkvModel, RwkvStatusResponse_State, type RwkvStatusResponse } from "@/lib/anki/proto/anki/zz_hayaki_pb";

import { appInfo } from "./profiles";

export const RWKV_KEY = "hayakiRwkvScheduling";
/** Synced boolean key: RWKV fixes the day's review list at the first study of the day. Absent means false. */
export const RWKV_DAILY_LIST_KEY = "hayakiRwkvDailyList";
export const rwkvQueryKey = ["rwkv-status"] as const;
export const rwkvDailyListQueryKey = ["rwkv-daily-list"] as const;
export { RwkvModel, RwkvStatusResponse_State as RwkvState, type RwkvStatusResponse };

/** The weights live in the app data folder, shared by every profile. */
async function weightsDir(): Promise<string> {
  const info = await appInfo();
  return `${info.dataDir}/rwkv`;
}

export const getRwkvStatus = () => core.rwkvStatus();

/** Downloads the weights if needed and starts preparing the open collection. */
export async function prepareRwkv(): Promise<RwkvStatusResponse> {
  return core.prepareRwkv({ weightsDir: await weightsDir() });
}

export async function setRwkvEnabled(on: boolean): Promise<void> {
  await core.setConfigJson({
    key: RWKV_KEY,
    valueJson: new TextEncoder().encode(JSON.stringify(on)),
    undoable: false,
  });
  if (on) await prepareRwkv();
}

/** Reads {@link RWKV_DAILY_LIST_KEY}; a key that was never set reads as false. */
export async function getRwkvDailyList(): Promise<boolean> {
  try {
    const out = await core.getConfigJson({ val: RWKV_DAILY_LIST_KEY }, { quiet: true });
    return JSON.parse(new TextDecoder().decode(out.json)) === true;
  } catch {
    return false;
  }
}

/** Switches the fixed daily list (a synced key); the core reads it at the next queue build. */
export async function setRwkvDailyList(on: boolean): Promise<void> {
  await core.setConfigJson({
    key: RWKV_DAILY_LIST_KEY,
    valueJson: new TextEncoder().encode(JSON.stringify(on)),
    undoable: false,
  });
}

/** Picks the model (the synced key `hayakiRwkvModel`); with the switch on, the new one is prepared. */
export async function setRwkvModel(model: RwkvModel): Promise<void> {
  const status = await core.setRwkvModel({ model });
  if (status.enabled) await prepareRwkv();
}

/** The first counted tree can trigger another replay after a sync. */
export async function readDueDeckTree(signal: AbortSignal) {
  let status = await getRwkvStatus();
  if (status.enabled && status.state === RwkvStatusResponse_State.FAILED) {
    signal.throwIfAborted();
    status = await prepareRwkv();
  }
  let pollDelayMs = 16;
  for (;;) {
    signal.throwIfAborted();
    if (!status.enabled || status.state === RwkvStatusResponse_State.READY) {
      const tree = await core.deckTree({ now: BigInt(Math.floor(Date.now() / 1000)) });
      if (!status.enabled) return tree;
      status = await getRwkvStatus();
      if (status.enabled && status.state === RwkvStatusResponse_State.READY) return tree;
    } else if (status.state === RwkvStatusResponse_State.NOT_PREPARED) {
      status = await prepareRwkv();
    } else if (status.state === RwkvStatusResponse_State.PREPARING) {
      await new Promise<void>((resolve) => setTimeout(resolve, pollDelayMs));
      pollDelayMs = Math.min(pollDelayMs * 2, 250);
      signal.throwIfAborted();
      status = await getRwkvStatus();
    } else {
      throw new Error(status.error);
    }
  }
}
