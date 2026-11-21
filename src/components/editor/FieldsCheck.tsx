// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** The core's check of a Note's fields (empty, duplicate, cloze problems) and the notice it shows. */
import { CircleAlert, Info } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/components/ui";
import * as core from "@/lib/anki/generated/core";
import { NoteFieldsCheckResponse_State as CheckState } from "@/lib/anki/proto/anki/notes_pb";
import { tr } from "@/lib/i18n";
import { useNav } from "@/lib/nav";
import { te } from "@/lib/strings/editor";

export { CheckState };

/** Re-checks the fields shortly after they stop changing. */
export function useFieldsCheck(noteId: bigint, notetypeId: bigint | undefined, fields: string[]): CheckState {
  const [state, setState] = useState(CheckState.NORMAL);
  useEffect(() => {
    if (notetypeId === undefined || !fields.length) return;
    let live = true;
    const timer = window.setTimeout(() => {
      core
        .noteFieldsCheck({ id: noteId, notetypeId, fields })
        .then((reply) => live && setState(reply.state))
        .catch(() => live && setState(CheckState.NORMAL));
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [noteId, notetypeId, fields]);
  return notetypeId === undefined ? CheckState.NORMAL : state;
}

export function checkMessage(state: CheckState): string | null {
  switch (state) {
    case CheckState.EMPTY:
      return tr("adding-the-first-field-is-empty");
    case CheckState.DUPLICATE:
      return te("duplicate");
    case CheckState.MISSING_CLOZE:
      return te("missingCloze");
    case CheckState.NOTETYPE_NOT_CLOZE:
      return tr("adding-cloze-outside-cloze-notetype");
    case CheckState.FIELD_NOT_CLOZE:
      return tr("adding-cloze-outside-cloze-field");
    default:
      return null;
  }
}

export function FieldsCheckNotice({
  state,
  notetypeId,
  firstField,
  showEmpty,
}: {
  state: CheckState;
  notetypeId: bigint;
  firstField: string;
  /** Whether an empty first field is worth mentioning yet. */
  showEmpty: boolean;
}) {
  const go = useNav((s) => s.go);
  if (state === CheckState.EMPTY && !showEmpty) return null;
  const message = checkMessage(state);
  if (!message) return null;
  const informational = state === CheckState.MISSING_CLOZE;
  const Icon = informational ? Info : CircleAlert;
  return (
    <p
      role="status"
      className={cn(
        "flex items-start gap-1.5 text-caption leading-[1.4] animate-rise-quick",
        informational ? "text-ink-2" : "text-danger",
      )}
    >
      <Icon aria-hidden className="mt-px size-3.5 shrink-0" />
      <span>
        {message}
        {state === CheckState.DUPLICATE && (
          <button
            type="button"
            className="ms-1.5 font-medium text-accent-ink underline-offset-2 hover:underline"
            onClick={async () => {
              const search = await core.buildSearchString({ filter: { case: "dupe", value: { notetypeId, firstField } } });
              go({ name: "browse", search: search.val });
            }}
          >
            {tr("editing-show-duplicates")}
          </button>
        )}
      </span>
    </p>
  );
}
