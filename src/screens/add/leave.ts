// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { setLeaveGuard } from "@/lib/nav";

/**
 * While the Add screen holds typed or prefilled content, any navigation (the
 * sidebar, the toolbar, Escape) hands `ask` a `proceed` to call once the person
 * agrees to discard. Returns the function that removes the guard.
 */
export function guardUnsavedAdd(ask: (proceed: () => void) => void): () => void {
  return setLeaveGuard((proceed) => {
    ask(proceed);
    return false;
  });
}
