// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The collection's life around the interface (`src-tauri/src/lifecycle.rs`):
 * backups, restoring one, the media sync log and what runs before a profile
 * closes. Pure helpers are exported for tests.
 */

/** A backup in the profile's backup folder, newest first from the shell. */
export interface BackupEntry {
  name: string;
  path: string;
  size: number;
  /** Local date and time, `YYYY-MM-DDTHH:MM:SS`. */
  stamp: string;
}

/** The backup's local date and time. */
export function backupDate(stamp: string): Date {
  const [date = "", time = ""] = stamp.split("T");
  const [y = 0, mo = 1, d = 1] = date.split("-").map(Number);
  const [h = 0, mi = 0, s = 0] = time.split(":").map(Number);
  return new Date(y, mo - 1, d, h, mi, s);
}

/** A size in the units people read, such as "1.2 MB". */
export function formatSize(bytes: number, locales?: string | string[]): string {
  const units = ["byte", "kilobyte", "megabyte", "gigabyte"] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return new Intl.NumberFormat(locales, {
    style: "unit",
    unit: units[unit],
    unitDisplay: "short",
    maximumFractionDigits: unit === 0 ? 0 : 1,
  }).format(value);
}

/** One line of the media sync log. */
export interface LogEntry {
  at: number;
  text: string;
}

export const LOG_LIMIT = 200;

/** Adds a line to the log, skipping a repeat of the last line and keeping the newest `limit`. */
export function appendLog(log: readonly LogEntry[], text: string, at: number, limit = LOG_LIMIT): LogEntry[] {
  if (log.at(-1)?.text === text) return log as LogEntry[];
  const next = [...log, { at, text }];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

/** As Anki's `can_auto_sync`: signed in, syncing on open and close switched on, and no backup restored since the profile opened. */
export function canAutoSync(state: { signedIn: boolean; autoSync: boolean; restored: boolean }): boolean {
  return state.signedIn && state.autoSync && !state.restored;
}

type CloseHandler = () => Promise<void>;
let closeHandler: CloseHandler | null = null;

/** Registers what runs before the open profile closes (the sync on close). Returns the unregister function. */
export function onProfileClose(handler: CloseHandler): () => void {
  closeHandler = handler;
  return () => {
    if (closeHandler === handler) closeHandler = null;
  };
}

/** Runs the registered handler. A failure never stops the profile from closing. */
export async function beforeProfileClose(): Promise<void> {
  try {
    await closeHandler?.();
  } catch (error) {
    console.error("before profile close", error);
  }
}
