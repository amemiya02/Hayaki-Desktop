// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { describe, expect, it } from "vitest";

import { installKey, runnable } from "@/lib/plugins/host";
import type { InstalledPlugin, Manifest } from "@/lib/plugins/types";

import { grantChanges } from "./meta";

const manifest = (over: Partial<Manifest> = {}): Manifest => ({
  id: "com.example.streak",
  name: "Streak",
  version: "1.0.0",
  description: "",
  author: "A",
  entry: "main.js",
  panels: [],
  permissions: ["ui"],
  network: [],
  ...over,
});

const installed = (over: Partial<InstalledPlugin> = {}): InstalledPlugin => ({
  id: "com.example.streak",
  manifest: manifest(),
  error: null,
  enabled: true,
  failed: null,
  install: "a",
  ...over,
});

describe("plugin updates", () => {
  it("gives every install its own frames, even at the same version", () => {
    expect(installKey(installed({ install: "a" }))).not.toBe(installKey(installed({ install: "b" })));
  });

  it("runs nothing while paused, and nothing failed or off", () => {
    const plugins = [installed(), installed({ id: "b", enabled: false }), installed({ id: "c", failed: "froze" })];
    expect(runnable(plugins, false).map((p) => p.id)).toEqual(["com.example.streak"]);
    expect(runnable(plugins, true)).toEqual([]);
  });

  it("marks grants an update adds and lists the ones it drops", () => {
    const before = manifest({ permissions: ["ui", "reviewer", "network"], network: ["https://a.example"] });
    const after = manifest({ permissions: ["ui", "collection:write", "network"], network: ["https://b.example"] });
    const { added, removed } = grantChanges(before, after);
    expect([...added].sort()).toEqual(["collection:write", "network"]);
    expect(removed).toEqual(["reviewer"]);
    expect(grantChanges(before, before).added.size).toBe(0);
  });
});
