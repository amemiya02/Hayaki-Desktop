// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** The pure parts of recording audio into a field. */

/** Container formats to try, best first. Ogg plays everywhere Anki does; WebView2 records WebM. */
const FORMATS: { mimeType: string; ext: string }[] = [
  { mimeType: "audio/ogg;codecs=opus", ext: "ogg" },
  { mimeType: "audio/webm;codecs=opus", ext: "webm" },
  { mimeType: "audio/mp4", ext: "m4a" },
  { mimeType: "audio/webm", ext: "webm" },
];

export function pickFormat(isSupported: (mimeType: string) => boolean): { mimeType: string; ext: string } | null {
  return FORMATS.find((f) => isSupported(f.mimeType)) ?? null;
}

/** The extension for what the recorder actually produced, which can differ from what was asked. */
export function extensionFor(mimeType: string, fallback: string): string {
  const type = mimeType.split(";")[0].trim().toLowerCase();
  if (type === "audio/ogg") return "ogg";
  if (type === "audio/webm" || type === "video/webm") return "webm";
  if (type === "audio/mp4" || type === "video/mp4") return "m4a";
  return fallback;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** `rec-20261121-174502.ogg`; the media folder makes it unique if needed. */
export function recordingName(date: Date, ext: string): string {
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `rec-${day}-${time}.${ext}`;
}

/** A 0-1 level from time-domain samples centred on 128, with headroom for speech. */
export function levelOf(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = (samples[i] - 128) / 128;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / samples.length);
  return Math.min(1, rms * 3.2);
}

/** Smooths the meter: rises at once, falls gently. */
export function smoothLevel(previous: number, next: number): number {
  return next > previous ? next : previous * 0.85 + next * 0.15;
}

export type RecordFailure = "denied" | "missing" | "busy" | "unsupported" | "other";

export function failureOf(error: unknown): RecordFailure {
  const name = error instanceof Error || (typeof error === "object" && error && "name" in error) ? String((error as { name: unknown }).name) : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
    case "PermissionDeniedError":
      return "denied";
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return "missing";
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return "busy";
    case "NotSupportedError":
      return "unsupported";
    default:
      return "other";
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Anki's sound tag: as HTML for a rich-text field, as text for the HTML editor. */
export function soundTag(filename: string, rich: boolean): string {
  const tag = `[sound:${filename}]`;
  return rich ? escapeHtml(tag) : tag;
}

/** Anki's "Recording...<br>Time: 1.5" as separate lines. */
export function splitLines(html: string): string[] {
  return html.split(/<br\s*\/?>/i).map((line) => line.trim());
}
