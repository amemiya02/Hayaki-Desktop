// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { ChangeNotetype } from "./ChangeNotetype";

/** Change Note Type for the given Notes (all must share one Note Type). */
export function ChangeNotetypeScreen({ noteIds }: { noteIds: bigint[] }) {
  return <ChangeNotetype key={noteIds.join(",")} noteIds={noteIds} />;
}
