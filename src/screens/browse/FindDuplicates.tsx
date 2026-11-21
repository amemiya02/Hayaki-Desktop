// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Find Duplicates (`aqt/browser/find_duplicates.py`): choose a field and an
 * optional filter, read the groups of Notes that share its text, tag them or
 * open one group in the browser.
 */
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button, Dialog, Spinner, TextField } from "@/components/ui";
import * as core from "@/lib/anki/generated/core";
import { tr } from "@/lib/i18n";
import { tb } from "@/lib/strings/browse";

import { errorText, FieldLabel, selectClass } from "./dialogs";
import { allFieldNames, findDuplicates, type DuplicateGroup } from "./duplicates";
import { idSearch } from "./search";

/** The last choices, kept for the session as Anki does. */
const last = { field: "", filter: "" };

export function FindDuplicatesDialog({ onClose, onSearch }: { onClose: () => void; onSearch: (search: string) => void }) {
  const [fields, setFields] = useState<string[] | null>(null);
  const [field, setField] = useState(last.field);
  const [filter, setFilter] = useState(last.filter);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    allFieldNames()
      .then((names) => {
        setFields(names);
        setField((current) => (names.includes(current) ? current : (names[0] ?? "")));
      })
      .catch((e: unknown) => setError(errorText(e)));
    return () => {
      cancelled.current = true;
    };
  }, []);

  const searching = progress !== null;

  const search = async () => {
    if (!field || searching) return;
    last.field = field;
    last.filter = filter;
    setError(null);
    setProgress({ done: 0, total: 0 });
    try {
      const found = await findDuplicates(field, filter, (done, total) => setProgress({ done, total }), () => cancelled.current);
      if (!cancelled.current) setGroups(found);
    } catch (e) {
      if (!cancelled.current) setError(errorText(e));
    } finally {
      if (!cancelled.current) setProgress(null);
    }
  };

  const noteCount = groups?.reduce((sum, g) => sum + g.noteIds.length, 0) ?? 0;

  const tagDuplicates = async () => {
    if (!groups?.length) return;
    try {
      const out = await core.addNoteTags({ noteIds: [...new Set(groups.flatMap((g) => g.noteIds))], tags: tr("browsing-duplicate") });
      toast(tr("browsing-notes-updated", { count: out.count }));
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const open = (ids: bigint[]) => {
    onSearch(idSearch("nid", ids));
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={tr("browsing-find-duplicates")}
      width={560}
      footer={
        <>
          <Button onClick={onClose}>{tr("actions-close")}</Button>
          {groups && groups.length > 0 && <Button onClick={() => void tagDuplicates()}>{tr("browsing-tag-duplicates")}</Button>}
          <Button variant="primary" disabled={!field || searching} onClick={() => void search()}>
            {searching && <Spinner className="text-on-accent" />}
            {tr("actions-search")}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <div>
          <FieldLabel htmlFor="browse-dupes-field">{tr("browsing-search-in")}</FieldLabel>
          <select id="browse-dupes-field" value={field} disabled={!fields} onChange={(e) => setField(e.target.value)} className={selectClass}>
            {(fields ?? []).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <FieldLabel htmlFor="browse-dupes-filter">{tr("browsing-optional-filter")}</FieldLabel>
          <TextField id="browse-dupes-filter" value={filter} placeholder="deck:current" spellCheck={false} onChange={(e) => setFilter(e.target.value)} />
        </div>
        {/* Enter in either control searches. */}
        <button type="submit" hidden />
      </form>

      <div className="mt-3" aria-live="polite">
        {error && (
          <p role="alert" className="selectable text-control text-danger">
            {error}
          </p>
        )}
        {!groups && !searching && !error && <p className="text-control text-ink-3">{tb("duplicatesHint")}</p>}
        {searching && progress && (
          <p className="tabular flex items-center gap-2 text-control text-ink-2">
            <Spinner />
            {progress.total > 0 ? tb("readingNotes", { done: progress.done, total: progress.total }) : tr("actions-search")}
          </p>
        )}
        {groups && !searching && (
          <>
            <p className="text-control text-ink">
              {tr("browsing-found-as-across-bs", {
                part: tr("browsing-group", { count: groups.length }),
                whole: tr("browsing-note-count", { count: noteCount }),
              })}
            </p>
            {groups.length > 0 && (
              <ol className="mt-2 max-h-[240px] overflow-auto rounded-[10px] border border-line bg-surface p-1">
                {groups.map((g) => (
                  <li key={g.value}>
                    <button
                      onClick={() => open(g.noteIds)}
                      className="flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-start text-control text-ink outline-none hover:bg-accent-soft focus-visible:shadow-ring-inset"
                    >
                      <span className="tabular shrink-0 text-ink-3">{tr("browsing-note-count", { count: g.noteIds.length })}</span>
                      <span className="min-w-0 flex-1 truncate">{g.value}</span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
