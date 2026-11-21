// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("./i18n", () => ({ setupI18n: () => Promise.resolve() }));

import type { OpenProfile, ProfilesState } from "./profiles";
import { useApp } from "./session-store";
import { useSync } from "./sync";

function profile(id: string): OpenProfile {
  return { id, name: id, folder: id, collectionPath: id, mediaFolder: id, backupFolder: id };
}

const twoProfiles: ProfilesState = {
  profiles: [
    { id: "a", name: "a", created: 0 },
    { id: "b", name: "b", created: 0 },
  ],
  lastOpened: "a",
  current: null,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Answers the shell's commands; `open` answers `profile_open`. */
function shell(open: (id: string) => Promise<OpenProfile>) {
  invoke.mockImplementation((command: string, args?: { id?: string }) => {
    if (command === "app_info") return Promise.resolve({ version: "", ankiVersion: "", dataDir: "", langs: [], platform: "" });
    if (command === "profiles_list") return Promise.resolve(twoProfiles);
    if (command === "profile_open") return open(args!.id!);
    if (command === "sync_account_get") return Promise.resolve({ hkey: "key-of-a", username: "a", endpoint: null, currentEndpoint: null });
    if (command === "sync_prefs_get") return Promise.resolve({ autoSync: false, syncMedia: true });
    if (command === "backup_restored") return Promise.resolve(false);
    return Promise.reject(new Error(`unexpected ${command}`));
  });
}

const opened = () => invoke.mock.calls.filter(([command]) => command === "profile_open").map(([, args]) => args.id);

describe("starting the app", () => {
  beforeEach(() => {
    invoke.mockReset();
    useApp.setState({ status: "starting", profile: null, error: null });
  });

  it("opens the last profile once when started twice at the same time", async () => {
    shell((id) => Promise.resolve(profile(id)));
    const first = useApp.getState().boot();
    const second = useApp.getState().boot();
    await Promise.all([first, second]);
    expect(opened()).toEqual(["a"]);
    expect(useApp.getState().status).toBe("ready");
    expect(useApp.getState().profile?.id).toBe("a");
  });

  it("starts again after a start that failed", async () => {
    shell(() => Promise.reject(new Error("No such file or directory (os error 2)")));
    await useApp.getState().boot();
    expect(useApp.getState().status).toBe("error");

    shell((id) => Promise.resolve(profile(id)));
    await useApp.getState().boot();
    expect(useApp.getState().status).toBe("ready");
    expect(opened()).toEqual(["a", "a"]);
  });
});

describe("switching profiles", () => {
  it("forgets the open profile's sync account before the next one opens", async () => {
    invoke.mockReset();
    shell((id) => Promise.resolve(profile(id)));
    useApp.setState({ status: "ready", profile: profile("a") });
    await useSync.getState().load("a");
    expect(useSync.getState().account?.hkey).toBe("key-of-a");

    const opening = deferred<OpenProfile>();
    shell(() => opening.promise);
    const switching = useApp.getState().open("b");
    await vi.waitFor(() => expect(opened()).toContain("b"));
    expect(useSync.getState().account).toBeNull();
    expect(useSync.getState().profile).toBeNull();
    opening.resolve(profile("b"));
    await switching;
    expect(useApp.getState().profile?.id).toBe("b");
  });
});
