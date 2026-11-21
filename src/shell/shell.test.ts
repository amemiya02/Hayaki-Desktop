// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { describe, expect, it } from "vitest";

import { clampSidebarWidth, SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN } from "@/lib/prefs";
import { menuLabel } from "@/lib/strings/shell";
import { materialFor, platformOf } from "@/lib/useAppearance";
import { SHORTCUTS } from "@/screens/browse/keys";
import { EDITOR_MIN, editorWidth, gridTemplate } from "@/screens/browse/store";

import { isWebViewAccelerator } from "./accelerators";
import { filterSections, SECTIONS, splitChord, type ResolvedSection } from "./shortcuts";

describe("window material", () => {
  it("reads the platform from the user agent", () => {
    expect(platformOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/140")).toBe("windows");
    expect(platformOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0)")).toBe("mac");
    expect(platformOf("Mozilla/5.0 (X11; Linux x86_64)")).toBe("linux");
  });

  it("uses Mica only from Windows 11", () => {
    expect(materialFor("windows", "15.0.0")).toBe("mica");
    expect(materialFor("windows", "13.0.0")).toBe("mica");
    expect(materialFor("windows", "10.0.0")).toBeNull();
    expect(materialFor("windows", "0.3.0")).toBeNull();
    expect(materialFor("windows", undefined)).toBeNull();
  });

  it("keeps the Mac opaque until vibrancy is enabled", () => {
    expect(materialFor("mac", undefined, false)).toBeNull();
    expect(materialFor("mac", undefined, true)).toBe("vibrancy");
    expect(materialFor("linux", undefined, true)).toBeNull();
  });
});

describe("sidebar width", () => {
  it("clamps to its range", () => {
    expect(clampSidebarWidth(10)).toBe(SIDEBAR_MIN);
    expect(clampSidebarWidth(9999)).toBe(SIDEBAR_MAX);
    expect(clampSidebarWidth(260.4)).toBe(260);
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_DEFAULT);
  });
});

describe("browse layout", () => {
  it("lets only the sort-field column flex", () => {
    expect(gridTemplate(["noteFld", "template", "cardDue", "deck"], [180, 104, 100, 160])).toBe("minmax(180px,1fr) 104px 100px 160px");
    expect(gridTemplate(["deck", "question"], [160, 180])).toBe("160px minmax(180px,1fr)");
    expect(gridTemplate(["deck", "cardDue"], [160, 100])).toBe("160px minmax(100px,1fr)");
  });

  it("keeps the editor's share while the table fits, then yields to its minimum", () => {
    expect(editorWidth(1400, 0.4, 544)).toBe(560);
    expect(editorWidth(900, 0.4, 544)).toBe(356);
    expect(editorWidth(811, 0.4, 544)).toBe(267);
    expect(editorWidth(700, 0.4, 544)).toBe(EDITOR_MIN);
  });
});

describe("shortcuts sheet", () => {
  it("splits chords into keys", () => {
    expect(splitChord("Ctrl+Shift+D")).toEqual(["Ctrl", "Shift", "D"]);
    expect(splitChord("?")).toEqual(["?"]);
    expect(splitChord("+")).toEqual(["+"]);
    expect(splitChord("Ctrl++")).toEqual(["Ctrl", "+"]);
    expect(splitChord("Ctrl+\\")).toEqual(["Ctrl", "\\"]);
  });

  it("lists every Browse shortcut it labels, with Anki's chord", () => {
    const browse = SECTIONS.find((s) => s.id === "browse")!;
    const chords = browse.items.map((i) => i.keys[0]);
    expect(chords).toContain(SHORTCUTS.cardInfo);
    expect(chords).toContain(SHORTCUTS.changeNotetype);
    expect(chords).toContain(SHORTCUTS.createFiltered);
    expect(new Set(chords).size).toBe(chords.length);
  });

  it("does not repeat a chord within a section", () => {
    for (const section of SECTIONS) {
      const seen = new Map<string, number>();
      for (const item of section.items) for (const k of item.keys) seen.set(k, (seen.get(k) ?? 0) + 1);
      // Space is both Show Answer and Good in Study, as in Anki.
      const repeats = [...seen].filter(([k, n]) => n > 1 && !(section.id === "study" && k === "Space"));
      expect(repeats).toEqual([]);
    }
  });

  it("filters by label or exact key", () => {
    const sections: ResolvedSection[] = [
      { id: "study", title: "Study", items: [{ label: "Show Answer", keys: ["Space"] }, { label: "Again", keys: ["1"] }] },
      { id: "browse", title: "Browse", items: [{ label: "Preview", keys: ["Ctrl+Shift+P"] }] },
    ];
    expect(filterSections(sections, "")).toBe(sections);
    expect(filterSections(sections, "answer").map((s) => s.items.map((i) => i.label))).toEqual([["Show Answer"]]);
    expect(filterSections(sections, "1")[0].items[0].label).toBe("Again");
    expect(filterSections(sections, "zzz")).toEqual([]);
  });

  it("strips Anki's accelerators and ellipses from menu labels", () => {
    expect(menuLabel("&Switch Profile")).toBe("Switch Profile");
    expect(menuLabel("Create Filtered Deck...")).toBe("Create Filtered Deck");
    expect(menuLabel("Fil&ter")).toBe("Filter");
  });

  it("strips Chinese and Japanese access-key suffixes", () => {
    expect(menuLabel("筛选(&T)")).toBe("筛选");
    expect(menuLabel("笔记(&O)")).toBe("笔记");
    expect(menuLabel("切换账户(&S)")).toBe("切换账户");
    expect(menuLabel("导出（&E）...")).toBe("导出");
    expect(menuLabel("書き出す (&E)...")).toBe("書き出す");
    expect(menuLabel("プロファイルを切り替える (&S)")).toBe("プロファイルを切り替える");
    expect(menuLabel("ノートを書き出す (&E)…")).toBe("ノートを書き出す");
  });
});

describe("web view accelerators", () => {
  const key = (k: string, mods: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }> = {}) => ({
    key: k,
    code: "",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
  });

  it("cancels reload, history, print and view source", () => {
    expect(isWebViewAccelerator(key("F5"), false)).toBe(true);
    expect(isWebViewAccelerator(key("F5", { ctrlKey: true }), false)).toBe(true);
    expect(isWebViewAccelerator(key("r", { ctrlKey: true }), false)).toBe(true);
    expect(isWebViewAccelerator(key("R", { ctrlKey: true, shiftKey: true }), false)).toBe(true);
    expect(isWebViewAccelerator(key("ArrowLeft", { altKey: true }), false)).toBe(true);
    expect(isWebViewAccelerator(key("p", { ctrlKey: true }), false)).toBe(true);
    expect(isWebViewAccelerator(key("u", { ctrlKey: true }), false)).toBe(true);
  });

  it("keeps developer tools in development builds only", () => {
    expect(isWebViewAccelerator(key("I", { ctrlKey: true, shiftKey: true }), false)).toBe(true);
    expect(isWebViewAccelerator(key("I", { ctrlKey: true, shiftKey: true }), true)).toBe(false);
  });

  it("leaves ordinary keys alone", () => {
    expect(isWebViewAccelerator(key("r"), false)).toBe(false);
    expect(isWebViewAccelerator(key("ArrowLeft"), false)).toBe(false);
    expect(isWebViewAccelerator(key("ArrowLeft", { ctrlKey: true, altKey: true }), false)).toBe(false);
    expect(isWebViewAccelerator(key("z", { ctrlKey: true }), false)).toBe(false);
  });
});
