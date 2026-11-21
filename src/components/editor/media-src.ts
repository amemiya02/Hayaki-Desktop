// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Media references in field HTML. Anki stores bare filenames
 * (`<img src="cat.jpg">`); the editor shows them from the media origin. These
 * two rewrites are inverses: what the editor shows never reaches the
 * collection with a media URL in it.
 */

const MEDIA_TAG = /<(img|audio|video|source)\b[^>]*>/gi;
const SRC_ATTR = /(\ssrc\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|#39);/gi, (whole, entity: string) => {
    const e = entity.toLowerCase();
    if (e === "amp") return "&";
    if (e === "nbsp") return "\u00a0";
    if (e === "lt") return "<";
    if (e === "gt") return ">";
    if (e === "quot") return '"';
    if (e === "apos" || e === "#39") return "'";
    const code = e.startsWith("#x") ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

export function escapeAttr(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Whether a src names a file in the media folder rather than a URL. */
export function isLocalMediaName(src: string): boolean {
  const value = src.trim();
  return value !== "" && !HAS_SCHEME.test(value) && !value.startsWith("/") && !value.startsWith("#");
}

function rewriteSrc(html: string, map: (src: string) => string | null): string {
  return html.replace(MEDIA_TAG, (tag) =>
    tag.replace(SRC_ATTR, (whole, lead: string, dq?: string, sq?: string, bare?: string) => {
      const raw = dq ?? sq ?? bare ?? "";
      const next = map(decodeEntities(raw));
      return next === null ? whole : `${lead}"${escapeAttr(next)}"`;
    }),
  );
}

/** Field HTML as stored, with each bare media filename turned into a URL the editor can load. */
export function fieldToDisplay(html: string, urlFor: (filename: string) => string): string {
  if (!html) return html;
  return rewriteSrc(html, (src) => (isLocalMediaName(src) ? urlFor(src) : null));
}

/** Editor HTML back to stored HTML: media URLs under `prefix` become bare filenames again. */
export function displayToField(html: string, prefix: string): string {
  if (!html || !prefix) return html;
  return rewriteSrc(html, (src) => {
    if (!src.startsWith(prefix)) return null;
    const rest = src.slice(prefix.length).split(/[?#]/)[0];
    try {
      return decodeURIComponent(rest);
    } catch {
      return rest;
    }
  });
}

/** What a field holds when the editor has emptied it. */
export function normalizeEmpty(html: string): string {
  const trimmed = html.trim();
  return trimmed === "<br>" || trimmed === "<div><br></div>" || trimmed === "<p><br></p>" ? "" : html;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|tiff?|ico|avif|heic)$/i;

/** The HTML that references a stored media file: an image tag, or Anki's sound tag for audio and video. */
export function mediaReference(filename: string, urlFor?: (filename: string) => string): string {
  if (IMAGE_EXT.test(filename)) return `<img src="${escapeAttr(urlFor ? urlFor(filename) : filename)}">`;
  return `[sound:${filename}]`;
}

export const MEDIA_EXTENSIONS = [
  "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "tif", "tiff", "ico", "avif",
  "mp3", "ogg", "oga", "opus", "wav", "m4a", "flac", "aac", "spx",
  "mp4", "webm", "mov", "mkv", "avi", "mpg", "mpeg", "ogv", "3gp",
];

export function isMediaPath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MEDIA_EXTENSIONS.includes(ext);
}
