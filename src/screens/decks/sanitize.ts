// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Makes a Deck description safe to show in the app's own page. Descriptions are
 * HTML (or Markdown the core has already turned into HTML); they may carry
 * formatting, links and images from the media folder, never script.
 */
import { mediaUrl } from "@/lib/study/audio";

const BLOCKED_TAGS = new Set([
  "script", "style", "iframe", "frame", "frameset", "object", "embed", "link", "meta", "base",
  "form", "input", "button", "select", "textarea", "svg", "math", "template", "noscript", "audio", "video", "source",
]);

const LINK_SCHEME = /^(https?:|mailto:)/i;
const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Links may go to the web or mail; anything else (javascript:, data:, file:) is dropped. */
export function isSafeLink(href: string): boolean {
  return LINK_SCHEME.test(href.trim());
}

/** The media file a relative image source names, or undefined for a remote or unsafe source. */
export function mediaFileOf(src: string): string | undefined {
  const value = src.trim();
  if (!value || ANY_SCHEME.test(value) || value.startsWith("//") || value.startsWith("/")) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function cleanImage(img: Element): void {
  const src = img.getAttribute("src") ?? "";
  const file = mediaFileOf(src);
  if (file) img.setAttribute("src", mediaUrl(file));
  else if (!/^https?:/i.test(src.trim())) img.removeAttribute("src");
  img.removeAttribute("srcset");
  img.setAttribute("loading", "lazy");
}

function clean(el: Element): void {
  for (const child of Array.from(el.children)) {
    if (BLOCKED_TAGS.has(child.localName)) {
      child.remove();
      continue;
    }
    for (const attr of Array.from(child.attributes)) {
      if (attr.name.startsWith("on") || attr.name === "srcdoc" || attr.name === "formaction") child.removeAttribute(attr.name);
    }
    if (child.localName === "a") {
      const href = child.getAttribute("href") ?? "";
      if (isSafeLink(href)) {
        child.setAttribute("rel", "noreferrer noopener");
      } else {
        child.removeAttribute("href");
      }
      child.removeAttribute("target");
    } else if (child.localName === "img") {
      cleanImage(child);
    }
    clean(child);
  }
}

export function sanitizeDescription(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  clean(doc.body);
  return doc.body.innerHTML;
}
