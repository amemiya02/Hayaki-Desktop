// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { describe, expect, it, vi } from "vitest";

import { appendLog, backupDate, beforeProfileClose, canAutoSync, formatSize, onProfileClose } from "./lifecycle";

describe("backupDate", () => {
  it("reads the local date and time of a backup", () => {
    const date = backupDate("2026-11-21T20:23:14");
    expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()]).toEqual([
      2026, 10, 21, 20, 23, 14,
    ]);
  });
});

describe("formatSize", () => {
  it("picks a unit people read", () => {
    expect(formatSize(512, "en")).toBe("512 byte");
    expect(formatSize(1_234_567, "en")).toBe("1.2 MB");
    expect(formatSize(3_000, "en")).toBe("3 kB");
  });
});

describe("appendLog", () => {
  it("adds lines in order and skips a repeat of the last one", () => {
    let log = appendLog([], "starting", 1);
    log = appendLog(log, "starting", 2);
    log = appendLog(log, "1, 0, 5", 3);
    expect(log).toEqual([
      { at: 1, text: "starting" },
      { at: 3, text: "1, 0, 5" },
    ]);
  });

  it("keeps only the newest lines", () => {
    let log = appendLog([], "a", 1, 2);
    log = appendLog(log, "b", 2, 2);
    log = appendLog(log, "c", 3, 2);
    expect(log.map((e) => e.text)).toEqual(["b", "c"]);
  });
});

describe("canAutoSync", () => {
  it("syncs on open and close only when signed in, enabled and not restored", () => {
    expect(canAutoSync({ signedIn: true, autoSync: true, restored: false })).toBe(true);
    expect(canAutoSync({ signedIn: false, autoSync: true, restored: false })).toBe(false);
    expect(canAutoSync({ signedIn: true, autoSync: false, restored: false })).toBe(false);
    expect(canAutoSync({ signedIn: true, autoSync: true, restored: true })).toBe(false);
  });
});

describe("beforeProfileClose", () => {
  it("runs the registered handler until it is unregistered", async () => {
    const handler = vi.fn(async () => undefined);
    const off = onProfileClose(handler);
    await beforeProfileClose();
    off();
    await beforeProfileClose();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("lets the profile close when the handler fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const off = onProfileClose(async () => {
      throw new Error("offline");
    });
    await expect(beforeProfileClose()).resolves.toBeUndefined();
    off();
    error.mockRestore();
  });
});
