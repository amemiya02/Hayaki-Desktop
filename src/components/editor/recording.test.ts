// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { describe, expect, it } from "vitest";

import { extensionFor, failureOf, levelOf, pickFormat, recordingName, smoothLevel, soundTag, splitLines } from "./recording";

describe("recording", () => {
  it("picks the first supported format", () => {
    expect(pickFormat((m) => m.startsWith("audio/webm"))).toEqual({ mimeType: "audio/webm;codecs=opus", ext: "webm" });
    expect(pickFormat(() => true)?.ext).toBe("ogg");
    expect(pickFormat(() => false)).toBeNull();
  });

  it("names the extension from the produced type", () => {
    expect(extensionFor("audio/webm;codecs=opus", "ogg")).toBe("webm");
    expect(extensionFor("audio/ogg", "webm")).toBe("ogg");
    expect(extensionFor("", "webm")).toBe("webm");
  });

  it("names recordings by time", () => {
    expect(recordingName(new Date(2026, 10, 21, 7, 5, 2), "ogg")).toBe("rec-20261121-070502.ogg");
  });

  it("measures level", () => {
    expect(levelOf(new Uint8Array(64).fill(128))).toBe(0);
    expect(levelOf(new Uint8Array(64).fill(255))).toBe(1);
    expect(levelOf([])).toBe(0);
    expect(smoothLevel(0.2, 0.8)).toBe(0.8);
    expect(smoothLevel(0.8, 0)).toBeCloseTo(0.68);
  });

  it("classifies microphone errors", () => {
    expect(failureOf(new DOMException("no", "NotAllowedError"))).toBe("denied");
    expect(failureOf({ name: "NotFoundError" })).toBe("missing");
    expect(failureOf({ name: "NotReadableError" })).toBe("busy");
    expect(failureOf(new Error("x"))).toBe("other");
    expect(failureOf(null)).toBe("other");
  });

  it("writes Anki's sound tag", () => {
    expect(soundTag("a&b.ogg", true)).toBe("[sound:a&amp;b.ogg]");
    expect(soundTag("a&b.ogg", false)).toBe("[sound:a&b.ogg]");
    expect(splitLines("Recording...<br>Time: 1.5")).toEqual(["Recording...", "Time: 1.5"]);
  });
});
