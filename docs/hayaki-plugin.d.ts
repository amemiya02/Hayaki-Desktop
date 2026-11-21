// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// Types for the Hayaki plugin SDK (`/_sdk/hayaki-plugin.js`), which defines
// `window.hayaki`. Copy this file next to your plugin to type-check it.
// See docs/plugins.md.

export type ErrorCode =
  | "permission-denied"
  | "unknown-method"
  | "invalid-params"
  | "core-error"
  | "storage-full"
  | "busy"
  | "failed"
  | "timeout";

/** Every rejected call rejects with this. */
export interface HayakiError extends Error {
  name: "HayakiError";
  code: ErrorCode;
}

/** Card and Note ids are int64, so they travel as strings. */
export interface CardEvent {
  cardId: string;
  noteId: string;
}

export interface AnsweredEvent extends CardEvent {
  /** 1 Again, 2 Hard, 3 Good, 4 Easy. */
  ease: 1 | 2 | 3 | 4;
}

export interface ThemeEvent {
  dark: boolean;
  theme: string | null;
  appearance: "light" | "dark" | "black" | null;
  lang: string;
  dir: "ltr" | "rtl";
}

export interface Events {
  "reviewer.questionShown": CardEvent;
  "reviewer.answerShown": CardEvent;
  "reviewer.answered": AnsweredEvent;
  "command.invoked": { id: string };
  "app.theme": ThemeEvent;
}

export interface Command {
  /** a-z, 0-9 and hyphens, unique within the plugin. */
  id: string;
  /** Up to 60 characters, shown in the command palette after the plugin's name. */
  title: string;
  /** Ctrl+Alt (and optionally Shift) with a letter or digit, unused by Hayaki and macOS. Ctrl is Cmd on macOS. */
  shortcut?: string;
}

export type NavigateTarget = { to: "browse"; search?: string } | { to: "add" } | { to: "deck"; deckId: string };

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface Hayaki {
  /** The raw bridge: any method name, protobuf-JSON params. */
  call(method: string, params?: Json): Promise<unknown>;
  /**
   * Every core method, by its camelCase name, such as `hayaki.core.getCard({ cid: "1700000000000" })`.
   * Params and results are protobuf JSON for the method's request and response messages
   * (vendor/anki/proto/anki/*.proto). Needs `collection:read` or `collection:write`.
   */
  core: Record<string, (params?: Json) => Promise<unknown>>;
  /** Listens for an event; returns the function that stops listening. */
  on<K extends keyof Events>(name: K, handler: (payload: Events[K]) => void): () => void;
  ui: {
    /** Needs `ui`. The handler runs when the person picks the command or presses its shortcut. */
    registerCommand(command: Command, handler?: (payload: { id: string }) => void): Promise<null>;
    unregisterCommand(id: string): Promise<null>;
    toast(message: string, kind?: "info" | "success" | "error"): Promise<null>;
    navigate(target: NavigateTarget): Promise<null>;
  };
  /** Always available; up to 1 MB of JSON per plugin. Setting null removes the key. */
  storage: {
    get<T extends Json = Json>(key: string): Promise<T | null>;
    set(key: string, value: Json): Promise<null>;
    remove(key: string): Promise<null>;
  };
  /** Needs `reviewer`. Each call replaces what this plugin injected before. */
  reviewer: {
    injectCss(css: string): Promise<null>;
    injectHtml(html: string): Promise<null>;
  };
}

declare global {
  interface Window {
    readonly hayaki: Hayaki;
  }
  const hayaki: Hayaki;
}
