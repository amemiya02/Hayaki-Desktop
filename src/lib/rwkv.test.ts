// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { beforeEach, describe, expect, it, vi } from "vitest";

const { getConfigJson, setConfigJson } = vi.hoisted(() => ({ getConfigJson: vi.fn(), setConfigJson: vi.fn() }));
vi.mock("@/lib/anki/generated/core", () => ({ getConfigJson, setConfigJson }));
vi.mock("./profiles", () => ({ appInfo: vi.fn() }));

import { getRwkvDailyList, RWKV_DAILY_LIST_KEY, setRwkvDailyList } from "./rwkv";

const json = (v: unknown) => ({ json: new TextEncoder().encode(JSON.stringify(v)) });

beforeEach(() => {
  getConfigJson.mockReset();
  setConfigJson.mockReset();
});

describe("daily list key", () => {
  it("reads a stored true", async () => {
    getConfigJson.mockResolvedValue(json(true));
    expect(await getRwkvDailyList()).toBe(true);
    expect(getConfigJson.mock.calls[0][0]).toEqual({ val: RWKV_DAILY_LIST_KEY });
  });

  it("reads not-found and empty values as false", async () => {
    getConfigJson.mockRejectedValue(new Error("not found"));
    expect(await getRwkvDailyList()).toBe(false);
    getConfigJson.mockResolvedValue({ json: new Uint8Array() });
    expect(await getRwkvDailyList()).toBe(false);
  });

  it("writes a non-undoable JSON boolean", async () => {
    setConfigJson.mockResolvedValue({});
    await setRwkvDailyList(true);
    const arg = setConfigJson.mock.calls[0][0];
    expect(arg.key).toBe("hayakiRwkvDailyList");
    expect(arg.undoable).toBe(false);
    expect(new TextDecoder().decode(arg.valueJson)).toBe("true");
  });
});
