// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The web view's own accelerators (reload, history, print, view source, and
 * developer tools in release builds) would replace the app. Their default is
 * cancelled in the capture phase, before the web view acts, while the event
 * still travels on, so Anki's F5 (record), Ctrl+R (clear formatting) and R
 * (replay) handlers run as usual.
 */
export function isWebViewAccelerator(e: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">, dev: boolean): boolean {
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (e.key === "F5" || e.key === "BrowserRefresh" || e.key === "BrowserBack" || e.key === "BrowserForward") return true;
  if (e.altKey && !mod && (e.key === "ArrowLeft" || e.key === "ArrowRight")) return true;
  if (mod && !e.altKey) {
    if (key === "r" || key === "p" || key === "u") return true;
    if (e.shiftKey && key === "i" && !dev) return true;
  }
  return false;
}
