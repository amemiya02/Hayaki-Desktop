// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// The ten Hayaki Themes, shared with Hayaki for iOS and Android. Source of
// truth: Hayaki-iOS Packages/HayakiAppearance/Sources/HayakiAppearance/Theme.swift.
// Light accents reach 4.5:1 on the tinted ground; Black reuses the dark accent.

export type ThemeId =
  | "hayaki"
  | "sakura"
  | "matcha"
  | "ocean"
  | "indigo"
  | "wisteria"
  | "amber"
  | "sumi"
  | "paper"
  | "midnight";

export type Appearance = "system" | "light" | "dark" | "black";
export type ResolvedAppearance = "light" | "dark" | "black";

export interface ThemePalette {
  light: string;
  dark: string;
  lightCanvas?: string;
  darkCanvas?: string;
}

export const themes: Record<ThemeId, ThemePalette> = {
  hayaki: { light: "#2C776E", dark: "#7ED6CA" },
  sakura: { light: "#B04663", dark: "#FF9DB7" },
  matcha: { light: "#50743F", dark: "#A8CF8E" },
  ocean: { light: "#0A6E9E", dark: "#5EC4F0" },
  indigo: { light: "#3A5BD9", dark: "#8FA8FF" },
  wisteria: { light: "#745AB9", dark: "#B9A3F5" },
  amber: { light: "#916019", dark: "#F5C451" },
  sumi: { light: "#4A4A4F", dark: "#C7C7CC" },
  paper: { light: "#8A5A2B", dark: "#D9A86C", lightCanvas: "#F6F1E7", darkCanvas: "#1E1A15" },
  midnight: { light: "#1A757F", dark: "#5EE6EE", lightCanvas: "#EEF3FA", darkCanvas: "#0B1426" },
};

export const themeOrder: ThemeId[] = [
  "hayaki",
  "sakura",
  "matcha",
  "ocean",
  "indigo",
  "wisteria",
  "amber",
  "sumi",
  "paper",
  "midnight",
];

export const themeNames: Record<ThemeId, { en: string; zh: string; ja: string }> = {
  hayaki: { en: "Hayaki", zh: "Hayaki", ja: "Hayaki" },
  sakura: { en: "Sakura", zh: "樱花", ja: "桜" },
  matcha: { en: "Matcha", zh: "抹茶", ja: "抹茶" },
  ocean: { en: "Ocean", zh: "海洋", ja: "海" },
  indigo: { en: "Indigo", zh: "靛蓝", ja: "藍" },
  wisteria: { en: "Wisteria", zh: "紫藤", ja: "藤" },
  amber: { en: "Amber", zh: "琥珀", ja: "琥珀" },
  sumi: { en: "Sumi", zh: "墨", ja: "墨" },
  paper: { en: "Paper", zh: "纸张", ja: "紙" },
  midnight: { en: "Midnight", zh: "午夜", ja: "真夜中" },
};

/**
 * Literal values of the roles that leave the interface: the study canvas and
 * ink handed to the card page, and the Theme swatches in Settings. They mirror
 * `--canvas-*`, `--ink` and `--on-accent` in `src/styles/app.css`.
 */
export const appearanceTokens: Record<ResolvedAppearance, { canvas: string; ink: string; onAccent: string }> = {
  light: { canvas: "#FFFFFF", ink: "#1B1E20", onAccent: "#FFFFFF" },
  dark: { canvas: "#17191A", ink: "#E8EAEB", onAccent: "#0F1414" },
  black: { canvas: "#000000", ink: "#E8EAEB", onAccent: "#0F1414" },
};

/** The study canvas, accent and ink for a Theme in a resolved Appearance. */
export function themeColors(theme: ThemeId, resolved: ResolvedAppearance): { canvas: string; accent: string; ink: string; onAccent: string } {
  const palette = themes[theme];
  const base = appearanceTokens[resolved];
  const canvas =
    resolved === "black" ? base.canvas : resolved === "dark" ? (palette.darkCanvas ?? base.canvas) : (palette.lightCanvas ?? base.canvas);
  return { canvas, accent: resolved === "light" ? palette.light : palette.dark, ink: base.ink, onAccent: base.onAccent };
}
