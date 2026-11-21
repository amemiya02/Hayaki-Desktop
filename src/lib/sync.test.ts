// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { useSync, type SyncAccount } from "./sync";

const alice: SyncAccount = { hkey: "a", username: "alice", endpoint: null, currentEndpoint: null };
const bob: SyncAccount = { hkey: "b", username: "bob", endpoint: null, currentEndpoint: null };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Answers the shell's commands for one profile. */
function profile(account: Promise<SyncAccount | null>, restored = false) {
  invoke.mockImplementation((command: string) => {
    if (command === "sync_account_get") return account;
    if (command === "sync_prefs_get") return Promise.resolve({ autoSync: false, syncMedia: true });
    if (command === "backup_restored") return Promise.resolve(restored);
    return Promise.reject(new Error(`unexpected ${command}`));
  });
}

describe("the sync store across profiles", () => {
  beforeEach(() => {
    useSync.getState().unload();
    invoke.mockReset();
  });

  it("loads the open profile's account, preferences and restore state", async () => {
    profile(Promise.resolve(alice), true);
    await useSync.getState().load("a");
    const s = useSync.getState();
    expect(s.account).toEqual(alice);
    expect(s.prefs.autoSync).toBe(false);
    expect(s.restored).toBe(true);
    expect(s.loaded).toBe(true);
  });

  it("forgets the previous profile's account as soon as another loads", async () => {
    profile(Promise.resolve(alice));
    await useSync.getState().load("a");

    const pending = deferred<SyncAccount | null>();
    profile(pending.promise);
    const loading = useSync.getState().load("b");
    expect(useSync.getState().account).toBeNull();
    expect(useSync.getState().loaded).toBe(false);

    pending.reject(new Error("no-profile"));
    await expect(loading).rejects.toThrow("no-profile");
    expect(useSync.getState().account).toBeNull();
  });

  it("drops a load that finishes after the profile changed again", async () => {
    const first = deferred<SyncAccount | null>();
    profile(first.promise);
    const stale = useSync.getState().load("a");
    profile(Promise.resolve(bob));
    await useSync.getState().load("b");

    first.resolve(alice);
    await stale;
    expect(useSync.getState().account).toEqual(bob);
  });

  it("forgets the account when the profile closes", async () => {
    profile(Promise.resolve(alice));
    await useSync.getState().load("a");
    useSync.getState().unload();
    expect(useSync.getState().account).toBeNull();
  });

  it("writes the account to the profile it was loaded for", async () => {
    profile(Promise.resolve(alice));
    await useSync.getState().load("a");
    const fallback = invoke.getMockImplementation()!;
    invoke.mockImplementation((command: string, args: unknown) =>
      command === "sync_account_set" ? Promise.resolve() : fallback(command, args),
    );
    await useSync.getState().signOut();
    expect(invoke).toHaveBeenCalledWith("sync_account_set", { profile: "a", account: null });
  });
});
