// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** Anki's `confirm_schema_modification`, shared by Note Type screens and Change Note Type. */
import { confirm } from "@/components/confirm";
import * as core from "@/lib/anki/generated/core";
import { tr } from "@/lib/i18n";

/** Whether the schema has already changed since the last sync (then no one-way sync warning is needed). */
export async function schemaModified(): Promise<boolean> {
  // The Default Deck (id 1) always exists; its options report the collection's schema state.
  const info = await core.getDeckConfigsForUpdate({ did: 1n });
  return info.schemaModified;
}

/**
 * Asks before a change that needs a one-way sync, unless the schema has
 * already changed since the last sync. Resolves true to go ahead.
 */
export async function confirmSchemaChange(title: string, action: string): Promise<boolean> {
  let modified = false;
  try {
    modified = await schemaModified();
  } catch {
    modified = false;
  }
  if (modified) return true;
  return confirm({ title, message: tr("qt-misc-the-requested-change-will-require-a"), confirm: action });
}
