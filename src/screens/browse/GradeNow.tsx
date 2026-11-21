// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** Grade Now (`Browser.grade_now`): answer the selected Cards with one of the four buttons. */
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button, Dialog, Kbd, Spinner } from "@/components/ui";
import * as core from "@/lib/anki/generated/core";
import { CardAnswer_Rating } from "@/lib/anki/proto/anki/scheduler_pb";
import { tr } from "@/lib/i18n";
import { tb } from "@/lib/strings/browse";

import { errorText } from "./dialogs";

const GRADES = [
  { rating: CardAnswer_Rating.AGAIN, label: "studying-again", key: "1" },
  { rating: CardAnswer_Rating.HARD, label: "studying-hard", key: "2" },
  { rating: CardAnswer_Rating.GOOD, label: "studying-good", key: "3" },
  { rating: CardAnswer_Rating.EASY, label: "studying-easy", key: "4" },
] as const;

export function GradeNowDialog({ cardIds, onClose }: { cardIds: bigint[]; onClose: () => void }) {
  const [busy, setBusy] = useState(false);

  const grade = async (rating: CardAnswer_Rating) => {
    if (busy) return;
    setBusy(true);
    try {
      await core.gradeNow({ cardIds, rating });
      onClose();
    } catch (error) {
      toast.error(errorText(error));
      setBusy(false);
    }
  };

  // Anki answers with 1 to 4 here, as in the reviewer.
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const hit = GRADES.find((g) => g.key === e.key);
      if (!hit) return;
      e.preventDefault();
      void grade(hit.rating);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={tr("actions-grade-now")}
      description={tb("gradeNowLead", { count: cardIds.length })}
      width={460}
      footer={<Button onClick={onClose}>{tr("actions-cancel")}</Button>}
    >
      <div className="grid grid-cols-4 gap-2 py-1">
        {GRADES.map((g) => (
          <Button key={g.key} disabled={busy} onClick={() => void grade(g.rating)} title={tr("actions-shortcut-key", { val: g.key })} className="h-14 flex-col gap-1">
            {busy ? <Spinner /> : <span>{tr(g.label)}</span>}
            <Kbd>{g.key}</Kbd>
          </Button>
        ))}
      </div>
    </Dialog>
  );
}
