// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { useSync } from "@/lib/sync";
import { syncPill, syncToast } from "./sync-pill";

const pillNow = () => {
  const { phase, progress } = useSync.getState();
  return syncPill(phase, progress);
};

describe("the sync pill follows the sync store", () => {
  it("is hidden while idle", () => {
    useSync.setState({ phase: "idle", progress: [] });
    expect(pillNow()).toBeNull();
  });

  it("shows the media counts only in its short label", () => {
    useSync.setState({ phase: "media", progress: ["Added: 0↑ 1,100↓", "Checked: 40"] });
    const pill = pillNow();
    expect(pill?.short).toBe("Media 1,100↓");
    expect(pill?.full).toContain("Checked: 40");
    expect(pill?.abortable).toBe(true);
  });

  it("reads counts the engine wraps in bidi isolation marks", () => {
    useSync.setState({ phase: "media", progress: ["已新增：\u20680\u2069↑ \u206816175\u2069↓"] });
    expect(pillNow()?.short).toBe("Media 16175↓");
  });

  it("starts with the bare label before any count arrives", () => {
    useSync.setState({ phase: "media", progress: [] });
    expect(pillNow()?.short).toBe("Media");
  });

  it("cannot abort the collection sync", () => {
    useSync.setState({ phase: "syncing", progress: ["Uploading"] });
    expect(pillNow()?.abortable).toBe(false);
  });
});

describe("a finished sync reports as a toast", () => {
  it("is silent when cancelled", () => {
    expect(syncToast("cancelled", null)).toBeNull();
  });

  it("warns with the error when media failed, and errors when the sync failed", () => {
    expect(syncToast("media-failed", "boom")).toMatchObject({ level: "warning", description: "boom" });
    expect(syncToast("error", "boom")).toMatchObject({ level: "error", description: "boom" });
  });

  it("succeeds for done, aborted and media off", () => {
    for (const result of ["done", "media-aborted", "media-disabled"] as const) {
      expect(syncToast(result, null)?.level).toBe("success");
    }
  });
});
