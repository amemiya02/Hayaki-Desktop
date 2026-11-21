// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { describe, expect, it } from "vitest";

import { checkOrigin } from "./ankiconnect";

describe("checkOrigin", () => {
  it("keeps only scheme, host and port, as a browser sends them", () => {
    expect(checkOrigin(" https://Example.com/path?q=1 ", [])).toEqual({ ok: true, origin: "https://example.com" });
    expect(checkOrigin("http://localhost:3000/", [])).toEqual({ ok: true, origin: "http://localhost:3000" });
    expect(checkOrigin("moz-extension://1b2c3d4e-aaaa", [])).toEqual({ ok: true, origin: "moz-extension://1b2c3d4e-aaaa" });
    expect(checkOrigin("*", [])).toEqual({ ok: true, origin: "*" });
  });

  it("rejects text that is not an origin", () => {
    expect(checkOrigin("example.com", [])).toEqual({ ok: false, reason: "invalid" });
    expect(checkOrigin("", [])).toEqual({ ok: false, reason: "invalid" });
    expect(checkOrigin("https://", [])).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects an origin already listed", () => {
    expect(checkOrigin("http://localhost/", ["http://localhost"])).toEqual({ ok: false, reason: "duplicate" });
  });
});
