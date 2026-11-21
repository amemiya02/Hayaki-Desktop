// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Interface text. Anki's own strings come from the core's Fluent resources,
 * so every language upstream translates reads exactly like Anki (`tr`).
 * Strings Hayaki adds live in `strings/` in English, Simplified Chinese and
 * Japanese, falling back to English (`t`).
 */
import { FluentBundle, FluentResource, type FluentVariable } from "@fluent/bundle";

import { i18nResources } from "./anki/generated/core";
import { applyStoredLanguage } from "./language";
import { hayakiStrings, type HayakiKey } from "./strings";

let bundles: FluentBundle[] = [];
let langs: string[] = ["en-US"];
let hayakiLang: "en" | "zh" | "ja" = "en";

let markLoaded: () => void = () => undefined;
/** Resolves once Anki's strings are loaded; `tr` returns the bare key before that. */
export const i18nLoaded: Promise<void> = new Promise((resolve) => {
  markLoaded = resolve;
});

export async function setupI18n(): Promise<void> {
  // A language chosen in Settings restarts the core in it before its strings are read.
  await applyStoredLanguage();
  const resources = await i18nResources({ modules: [] });
  const json = JSON.parse(new TextDecoder().decode(resources.json)) as {
    resources: string[];
    langs: string[];
  };
  bundles = json.resources.map((text, i) => {
    const bundle = new FluentBundle([json.langs[i], "en-US"], { useIsolating: false });
    bundle.addResource(new FluentResource(text));
    return bundle;
  });
  langs = json.langs;
  const first = langs[0]?.toLowerCase() ?? "en";
  hayakiLang = first.startsWith("zh") ? "zh" : first.startsWith("ja") ? "ja" : "en";
  document.documentElement.lang = langs[0] ?? "en";
  document.documentElement.dir = direction();
  markLoaded();
}

export function firstLanguage(): string {
  return langs[0] ?? "en-US";
}

export function languages(): string[] {
  return langs;
}

export function direction(): "ltr" | "rtl" {
  const first = firstLanguage();
  return ["he", "ar", "fa", "ug", "yi"].some((l) => first.startsWith(l)) ? "rtl" : "ltr";
}

/** Translates one of Anki's strings, such as `tr("decks-study")`. */
export function tr(key: string, args?: Record<string, FluentVariable>): string {
  for (const bundle of bundles) {
    const message = bundle.getMessage(key);
    if (message?.value) {
      return bundle.formatPattern(message.value, args);
    }
  }
  return key;
}

/**
 * Cleans one of Anki's menu labels for use as a plain label: drops Qt access
 * keys ("&Filter", or "筛选(&T)" / "絞り込み (&T)" in Chinese and Japanese)
 * and a trailing ellipsis ("Export...").
 */
export function cleanLabel(text: string): string {
  return text
    .replace(/\s*[(（]&?[A-Za-z0-9][)）]/gu, "")
    .replace(/&(?=\S)/g, "")
    .replace(/\s*(\.\.\.|…)\s*$/u, "")
    .trim();
}

/** `tr()` for a menu string such as `qt-accel-export`, cleaned with `cleanLabel`. */
export function trLabel(key: string, args?: Record<string, FluentVariable>): string {
  return cleanLabel(tr(key, args));
}

/** Translates a string Hayaki adds, with `{name}` placeholders. */
export function t(key: HayakiKey, args?: Record<string, string | number>): string {
  const table = hayakiStrings[hayakiLang] as Partial<Record<HayakiKey, string>>;
  let text = table[key] ?? hayakiStrings.en[key];
  if (args) {
    for (const [name, value] of Object.entries(args)) {
      text = text.replaceAll(`{${name}}`, formatNumber(value));
    }
  }
  return text;
}

/**
 * Builds a typed translator for one area's strings, kept in that area's own
 * file. English is required for every key; Chinese and Japanese fall back to it.
 *
 *   export const tb = makeStrings({ en: { "title": "Browse" }, zh: {...}, ja: {...} });
 *   tb("title");
 */
export function makeStrings<E extends Record<string, string>>(tables: {
  en: E;
  zh: Partial<Record<keyof E, string>>;
  ja: Partial<Record<keyof E, string>>;
}): (key: keyof E & string, args?: Record<string, string | number>) => string {
  return (key, args) => {
    let text = (tables[hayakiLang] as Partial<Record<string, string>>)[key] ?? tables.en[key];
    if (args) {
      for (const [name, value] of Object.entries(args)) {
        text = text.replaceAll(`{${name}}`, formatNumber(value));
      }
    }
    return text;
  };
}

function formatNumber(value: string | number): string {
  return typeof value === "number" ? value.toLocaleString(langs) : value;
}

export function localizedNumber(n: number, maximumFractionDigits = 0): string {
  return n.toLocaleString(langs, { maximumFractionDigits });
}

export function localizedDate(date: Date, options?: Intl.DateTimeFormatOptions): string {
  return date.toLocaleDateString(langs, options);
}

export function localeCompare(a: string, b: string): number {
  return a.localeCompare(b, langs);
}

// This module holds app-wide state that boot fills once; an in-place hot update
// would recreate it empty (stuck on the boot screen, raw string keys). Reload instead.
import.meta.hot?.accept(() => location.reload());
