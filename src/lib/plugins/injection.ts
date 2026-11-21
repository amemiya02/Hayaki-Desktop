// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * CSS and HTML that plugins add to the card page while studying. HTML is
 * cleaned natively before it is stored here; CSS is checked so it cannot
 * load anything: no `url()`, `src()`, `image()`, `@import` and the like,
 * also when spelled with escapes.
 */
import { create } from "zustand";

import type { CardFrameContent } from "@/components/CardFrame";

const MAX_LENGTH = 64 * 1024;
const LOADS = /@import|url\s*\(|src\s*\(|image-set\s*\(|image\s*\(|cross-fade\s*\(|element\s*\(|expression\s*\(/i;

/**
 * The CSS with its escapes, such as `\201C ` or `\72`, decoded. Comments
 * stay: a function name and its parenthesis cannot have one between them,
 * and removing one could hide a `url(` inside a string that only looks like
 * a comment.
 */
export function decodeCss(css: string): string {
  return css.replace(/\\(?:([0-9a-f]{1,6})(?:\r\n|[ \t\n\r\f])?|(\r\n|[\s\S]))/gi, (_, hex, char) => {
    if (hex === undefined) return /^[\r\n\f]/.test(char) ? "" : char;
    const code = parseInt(hex, 16);
    return code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) ? "\ufffd" : String.fromCodePoint(code);
  });
}

/** Returns why the CSS is refused, or null when it may be injected. */
export function cssProblem(css: string): string | null {
  if (css.length > MAX_LENGTH) return "Injected CSS is limited to 64 KB.";
  if (LOADS.test(decodeCss(css))) return "Injected CSS cannot load files: url(), src(), image() and @import are not allowed.";
  return null;
}

interface Injection {
  css: string;
  html: string;
}

interface InjectionState {
  byPlugin: Record<string, Injection>;
  set(pluginId: string, part: Partial<Injection>): void;
  clear(pluginId: string): void;
}

export const useInjections = create<InjectionState>((set) => ({
  byPlugin: {},
  set(pluginId, part) {
    set((s) => ({
      byPlugin: { ...s.byPlugin, [pluginId]: { ...(s.byPlugin[pluginId] ?? { css: "", html: "" }), ...part } },
    }));
  },
  clear(pluginId) {
    set((s) => {
      if (!(pluginId in s.byPlugin)) return s;
      const { [pluginId]: _removed, ...rest } = s.byPlugin;
      return { byPlugin: rest };
    });
  },
}));

/** The card content with every plugin's CSS and HTML added after the Card's own. */
export function withInjections(content: CardFrameContent, byPlugin: Record<string, Injection>): CardFrameContent {
  const parts = Object.values(byPlugin);
  if (parts.length === 0) return content;
  const css = parts.map((p) => p.css).filter(Boolean).join("\n");
  const html = parts.map((p) => p.html).filter(Boolean).join("");
  return {
    ...content,
    css: css ? `${content.css}\n${css}` : content.css,
    html: html ? `${content.html}<div class="hayaki-plugins">${html}</div>` : content.html,
  };
}
