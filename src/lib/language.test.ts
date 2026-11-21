import { describe, expect, it } from "vitest";

import { LANGUAGES, languageTag, sameLanguage } from "./language";

describe("languages", () => {
  it("offers upstream's list sorted by name, each code once", () => {
    expect(LANGUAGES.length).toBeGreaterThan(50);
    expect(new Set(LANGUAGES.map((l) => l.code)).size).toBe(LANGUAGES.length);
    const names = LANGUAGES.map((l) => l.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en")));
    expect(LANGUAGES).toContainEqual({ name: "日本語", code: "ja_JP" });
  });

  it("hands the core a BCP 47 tag", () => {
    expect(languageTag("ja_JP")).toBe("ja-JP");
    expect(languageTag("yi")).toBe("yi");
  });

  it("recognises the language the core already runs in", () => {
    expect(sameLanguage("ja-JP", "ja_JP")).toBe(true);
    expect(sameLanguage("JA-jp", "ja_JP")).toBe(true);
    expect(sameLanguage("en-US", "ja_JP")).toBe(false);
    expect(sameLanguage(undefined, "ja_JP")).toBe(false);
  });
});
