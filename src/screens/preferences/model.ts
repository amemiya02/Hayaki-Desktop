// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** Pure edits of Anki's collection preferences, one field at a time. */
import { clone, create } from "@bufbuild/protobuf";

import {
  PreferencesSchema,
  Preferences_BackupLimitsSchema,
  Preferences_EditingSchema,
  Preferences_ReviewingSchema,
  Preferences_SchedulingSchema,
  type Preferences,
  type Preferences_BackupLimits,
  type Preferences_Editing,
  type Preferences_Reviewing,
  type Preferences_Scheduling,
} from "@/lib/anki/proto/anki/config_pb";

export interface Groups {
  scheduling: Preferences_Scheduling;
  reviewing: Preferences_Reviewing;
  editing: Preferences_Editing;
  backups: Preferences_BackupLimits;
}

export type Fields<T> = Omit<T, "$typeName" | "$unknown">;

/** Returns a copy of `prefs` with one field of one group changed; groups missing from the core are filled with defaults. */
export function withPreference<G extends keyof Groups, K extends keyof Fields<Groups[G]>>(
  prefs: Preferences,
  group: G,
  key: K,
  value: Groups[G][K],
): Preferences {
  const next = clone(PreferencesSchema, prefs);
  next.scheduling ??= create(Preferences_SchedulingSchema);
  next.reviewing ??= create(Preferences_ReviewingSchema);
  next.editing ??= create(Preferences_EditingSchema);
  next.backups ??= create(Preferences_BackupLimitsSchema);
  (next[group] as Groups[G])[key] = value;
  return next;
}

/** Anki shows times in minutes and stores seconds. */
export const secsToMins = (secs: number) => Math.floor(secs / 60);
export const minsToSecs = (mins: number) => Math.round(mins) * 60;
