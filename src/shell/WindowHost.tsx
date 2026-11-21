// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The main window's own chords (full screen, zoom, undo and redo, Study Deck)
 * and the Study Deck chooser they open. `handleWindowChord` also serves keys
 * forwarded from the Card page, which never reach the window.
 */
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";
import { toast } from "sonner";

import { useNav } from "@/lib/nav";
import { useApp } from "@/lib/session-store";

import { openStudyDeck, StudyDeckHost } from "./StudyDeck";
import { runRedo, runUndo } from "./undo";
import { chordAction, chordAppliesOnRoute, type KeyLike } from "./window-keys";
import { zoom } from "./zoom";

export async function toggleFullscreen(): Promise<void> {
  try {
    const window = getCurrentWindow();
    await window.setFullscreen(!(await window.isFullscreen()));
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  }
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

/**
 * Runs the chord when it applies here and says whether it did. Study keeps
 * its own Undo (it rebuilds the queue); undo and redo run only on the screens
 * in `UNDO_ROUTES` and `REDO_ROUTES`.
 */
export function handleWindowChord(e: KeyLike, target: EventTarget | null = null): boolean {
  const action = chordAction(e);
  if (!action) return false;
  const route = useNav.getState().route.name;
  // Undo, redo and Study Deck need an open collection.
  const blocked = isTyping(target) || !!document.querySelector("[role=dialog]") || useApp.getState().status !== "ready";
  switch (action) {
    case "fullscreen":
      void toggleFullscreen();
      return true;
    case "zoomIn":
      zoom("in");
      return true;
    case "zoomOut":
      zoom("out");
      return true;
    case "zoomReset":
      zoom("reset");
      return true;
    case "studyDeck":
      if (blocked || route === "browse") return false;
      openStudyDeck();
      return true;
    case "undo":
      if (blocked || !chordAppliesOnRoute("undo", route)) return false;
      void runUndo();
      return true;
    case "redo":
      if (blocked || !chordAppliesOnRoute("redo", route)) return false;
      void runRedo();
      return true;
  }
}

export function WindowHost() {
  useEffect(() => {
    // Capture phase: Ctrl+Cmd+F must not also reach the toolbar's Ctrl+F.
    const listener = (e: KeyboardEvent) => {
      if (handleWindowChord(e, e.target)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", listener, true);
    return () => window.removeEventListener("keydown", listener, true);
  }, []);

  return <StudyDeckHost />;
}
