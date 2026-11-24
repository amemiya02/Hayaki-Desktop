// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * RWKV scheduling (ADR 0005, Android ADR-0009). The switch is the collection
 * config key `hayakiRwkvScheduling`, so it syncs. The core keeps the model
 * state and builds the review queue; the app only switches it, starts
 * preparation, and shows the status.
 */
import * as core from "@/lib/anki/generated/core";
import { RwkvStatusResponse_State, type RwkvStatusResponse } from "@/lib/anki/proto/anki/zz_hayaki_pb";

import { appInfo } from "./profiles";

export const RWKV_KEY = "hayakiRwkvScheduling";
export const rwkvQueryKey = ["rwkv-status"] as const;
export { RwkvStatusResponse_State as RwkvState, type RwkvStatusResponse };

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

/**
 * Called after a profile opens: a collection with the switch on starts
 * preparing at once, so the first study session can use RWKV.
 */
export async function prepareRwkvIfEnabled(): Promise<void> {
  const status = await getRwkvStatus();
  if (status.enabled && status.state !== RwkvStatusResponse_State.READY && status.state !== RwkvStatusResponse_State.PREPARING) {
    await prepareRwkv();
  }
}
