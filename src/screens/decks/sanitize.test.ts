// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/study/audio", () => ({ mediaUrl: (name: string) => `media://${name}` }));

import { isSafeLink, mediaFileOf } from "./sanitize";

describe("isSafeLink", () => {
  it("allows web and mail links only", () => {
    expect(isSafeLink("https://apps.ankiweb.net")).toBe(true);
    expect(isSafeLink(" http://example.com")).toBe(true);
    expect(isSafeLink("mailto:a@b.c")).toBe(true);
    expect(isSafeLink("javascript:alert(1)")).toBe(false);
    expect(isSafeLink("data:text/html,x")).toBe(false);
    expect(isSafeLink("file:///etc/passwd")).toBe(false);
  });
});

describe("mediaFileOf", () => {
  it("names the file a relative source points at", () => {
    expect(mediaFileOf("cat.png")).toBe("cat.png");
    expect(mediaFileOf("my%20cat.png")).toBe("my cat.png");
  });
  it("refuses remote, absolute and scheme sources", () => {
    expect(mediaFileOf("https://x.test/a.png")).toBeUndefined();
    expect(mediaFileOf("//x.test/a.png")).toBeUndefined();
    expect(mediaFileOf("/etc/passwd")).toBeUndefined();
    expect(mediaFileOf("data:image/png;base64,AAAA")).toBeUndefined();
    expect(mediaFileOf("")).toBeUndefined();
  });
});
