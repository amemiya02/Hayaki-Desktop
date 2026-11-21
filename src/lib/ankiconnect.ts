// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** The built-in AnkiConnect server, from the Rust shell (`src-tauri/src/ankiconnect/`). */
import { invoke } from "@tauri-apps/api/core";

export interface AnkiConnectConfig {
  enabled: boolean;
  port: number;
  /** AnkiConnect's `webCorsOriginList`. */
  origins: string[];
  /** Empty when no key is required. */
  apiKey: string;
}

export type AnkiConnectStatus =
  | { state: "off" }
  | { state: "listening"; port: number }
  | { state: "failed"; port: number; inUse: boolean; message: string };

export interface AnkiConnectSnapshot {
  config: AnkiConnectConfig;
  status: AnkiConnectStatus;
}

/** Events the server sends to the interface. */
export const events = {
  status: "ankiconnect:status",
  changed: "ankiconnect:changed",
  browse: "ankiconnect:browse",
  addCards: "ankiconnect:add-cards",
  sync: "ankiconnect:sync",
  permission: "ankiconnect:permission",
  /** The permission prompt went unanswered and counts as no. */
  permissionClosed: "ankiconnect:permission-closed",
} as const;

export const queryKey = ["ankiconnect"] as const;

export function getAnkiConnect(): Promise<AnkiConnectSnapshot> {
  return invoke("ankiconnect_get");
}

export function setAnkiConnect(config: AnkiConnectConfig): Promise<AnkiConnectSnapshot> {
  return invoke("ankiconnect_set", { config });
}

export function replyToPermission(id: number, allow: boolean): Promise<void> {
  return invoke("ankiconnect_permission_reply", { id, allow });
}

export type OriginCheck = { ok: true; origin: string } | { ok: false; reason: "invalid" | "duplicate" };

/**
 * Checks an origin typed into the allowed list. The server compares origins
 * as exact strings, so the entry is reduced to `scheme://host[:port]` the way
 * a browser sends it; `*` stands for every origin.
 */
export function checkOrigin(input: string, listed: readonly string[]): OriginCheck {
  const text = input.trim();
  let origin: string;
  if (text === "*") {
    origin = text;
  } else {
    const match = /^([a-z][a-z0-9+.-]*):\/\/([^/?#\s]+)/i.exec(text);
    if (!match) return { ok: false, reason: "invalid" };
    origin = `${match[1].toLowerCase()}://${match[2].toLowerCase()}`;
  }
  if (listed.includes(origin)) return { ok: false, reason: "duplicate" };
  return { ok: true, origin };
}
