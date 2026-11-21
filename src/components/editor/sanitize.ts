// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Cleans pasted HTML the way Anki's editor does (`ts/lib/html-filter`,
 * extended mode): basic formatting, lists, tables, links and images stay;
 * scripts, styles, frames and event handlers go; unknown elements are
 * unwrapped so their text survives. Works on the string, so it runs anywhere.
 */
import { decodeEntities, escapeAttr } from "./media-src";

type AttrRule = readonly string[];

const ALLOWED: Record<string, AttrRule> = {
  a: ["href"],
  b: [],
  blockquote: [],
  br: [],
  code: [],
  dd: [],
  div: [],
  dl: [],
  dt: [],
  em: [],
  font: ["color"],
  h1: [],
  h2: [],
  h3: [],
  hr: [],
  i: [],
  img: ["src", "alt"],
  li: [],
  ol: [],
  pre: [],
  rp: [],
  rt: [],
  ruby: [],
  span: ["style"],
  strong: [],
  sub: [],
  sup: [],
  table: [],
  tbody: [],
  td: ["colspan", "rowspan"],
  th: ["colspan", "rowspan"],
  thead: [],
  tr: ["rowspan"],
  u: [],
  ul: [],
};

/** Paragraphs become divs, as in Anki. */
const RENAMED: Record<string, string> = { p: "div" };

/** Elements removed with everything inside them. */
const DROPPED = new Set([
  "script", "style", "title", "iframe", "object", "embed", "noscript", "template", "head",
  "svg", "math", "textarea", "select", "button", "canvas", "frameset", "frame", "applet", "xml",
]);

const VOID = new Set(["br", "hr", "img", "meta", "link", "input", "wbr", "col", "area", "base", "source", "track", "param"]);

const KEPT_STYLES = new Set(["color", "background-color", "font-weight", "font-style", "text-decoration-line"]);

const TOKEN = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\?[^>]*>|<\/?([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

function safeUrl(value: string, image: boolean): string | null {
  const url = decodeEntities(value).trim();
  const compact = url.replace(/[\s\u0000-\u001f]+/g, "").toLowerCase();
  if (/^(javascript|vbscript|file):/.test(compact)) return null;
  if (compact.startsWith("data:")) return image && /^data:image\/(png|jpe?g|gif|webp|bmp)[;,]/.test(compact) ? url : null;
  return url;
}

function filterStyle(value: string): string {
  const kept: string[] = [];
  for (const declaration of decodeEntities(value).split(";")) {
    const colon = declaration.indexOf(":");
    if (colon < 0) continue;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const val = declaration.slice(colon + 1).trim();
    if (!KEPT_STYLES.has(property) || !val) continue;
    if (/url\(|expression|javascript:|[<>]/i.test(val)) continue;
    if (property === "background-color" && val.toLowerCase() === "transparent") continue;
    kept.push(`${property}: ${val}`);
  }
  return kept.join("; ");
}

function filterAttributes(tag: string, source: string): string {
  const allowed = ALLOWED[tag] ?? [];
  if (!allowed.length || !source) return "";
  let out = "";
  ATTR.lastIndex = 0;
  for (let m = ATTR.exec(source); m; m = ATTR.exec(source)) {
    const name = m[1].toLowerCase();
    if (!allowed.includes(name)) continue;
    let value = m[2] ?? m[3] ?? m[4] ?? "";
    if (name === "href" || name === "src") {
      const url = safeUrl(value, name === "src");
      if (url === null) continue;
      value = url;
    } else if (name === "style") {
      value = filterStyle(value);
      if (!value) continue;
    } else {
      value = decodeEntities(value);
    }
    out += ` ${name}="${escapeAttr(value)}"`;
  }
  return out;
}

function escapeText(text: string): string {
  // Text between tags is already HTML; only stray angle brackets need escaping.
  return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function sanitizeHtml(html: string): string {
  let out = "";
  let last = 0;
  /** Depth inside a dropped element, and the name that closes it. */
  let dropName: string | null = null;
  let dropDepth = 0;
  /** Open allowed elements, so stray closing tags are left out. */
  const open: string[] = [];

  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(html); m; m = TOKEN.exec(html)) {
    const text = html.slice(last, m.index);
    last = TOKEN.lastIndex;
    if (!dropName && text) out += escapeText(text);

    const name = m[1]?.toLowerCase();
    if (!name) continue; // comment, doctype or processing instruction
    const closing = m[0].startsWith("</");
    const selfClosing = /\/\s*$/.test(m[2] ?? "");

    if (dropName) {
      if (name === dropName) {
        if (closing) dropDepth--;
        else if (!selfClosing) dropDepth++;
        if (dropDepth === 0) dropName = null;
      }
      continue;
    }

    if (DROPPED.has(name)) {
      if (!closing && !selfClosing) {
        dropName = name;
        dropDepth = 1;
        // Raw-text elements end at their first closing tag, whatever is inside.
        if (name === "script" || name === "style" || name === "title" || name === "textarea" || name === "xml") {
          const end = html.toLowerCase().indexOf(`</${name}`, last);
          if (end < 0) {
            last = html.length;
            break;
          }
          const close = html.indexOf(">", end);
          last = close < 0 ? html.length : close + 1;
          TOKEN.lastIndex = last;
          dropName = null;
          dropDepth = 0;
        }
      }
      continue;
    }

    const tag = RENAMED[name] ?? name;
    if (!(tag in ALLOWED)) continue; // unwrapped: the tag goes, its content stays

    if (closing) {
      const at = open.lastIndexOf(tag);
      if (at < 0) continue;
      for (let i = open.length - 1; i >= at; i--) out += `</${open[i]}>`;
      open.length = at;
      continue;
    }

    if (tag === "img") {
      const attrs = filterAttributes(tag, m[2] ?? "");
      if (/\ssrc="/.test(attrs)) out += `<img${attrs}>`;
      continue;
    }
    out += `<${tag}${filterAttributes(tag, m[2] ?? "")}>`;
    if (!VOID.has(tag) && !selfClosing) open.push(tag);
  }
  if (!dropName) out += escapeText(html.slice(last));
  for (let i = open.length - 1; i >= 0; i--) out += `</${open[i]}>`;
  return removeEmptyInline(out);
}

/** Spans and formatting left with nothing inside them after filtering. */
function removeEmptyInline(html: string): string {
  let previous: string;
  let current = html;
  do {
    previous = current;
    current = current.replace(/<(span|b|i|u|em|strong|font|sub|sup|a)(\s[^>]*)?><\/\1>/g, "");
  } while (current !== previous);
  return current;
}

/** Plain text as field HTML: escaped, with line breaks kept. */
export function textToHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r\n?/g, "\n")
    .replace(/\n/g, "<br>");
}

/** The visible text of field HTML, for one-line summaries. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<\/?(br|div|p|li|tr|h[1-6])\b[^>]*>/gi, " ")
      .replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, "")
      .replace(/<img\b[^>]*>/gi, " ")
      .replace(/<[^>]+>/g, "")
      .replace(/\[sound:[^\]]*\]/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}
