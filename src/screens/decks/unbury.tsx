// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button, Dialog } from "@/components/ui";
import * as core from "@/lib/anki/generated/core";
import { UnburyDeckRequest_Mode as Mode } from "@/lib/anki/proto/anki/scheduler_pb";
import { tr } from "@/lib/i18n";
import { td } from "@/lib/strings/decks";

export interface BuriedInfo {
  haveSchedBuried: boolean;
  haveUserBuried: boolean;
}

export const hasBuried = (info: BuriedInfo | undefined): boolean => !!info && (info.haveSchedBuried || info.haveUserBuried);

/** Anki asks only when both kinds are buried; with one kind it unburies that at once. */
export const needsChoice = (info: BuriedInfo | undefined): boolean => !!info && info.haveSchedBuried && info.haveUserBuried;

const CHOICES: { mode: Mode; label: string }[] = [
  { mode: Mode.USER_ONLY, label: "studying-manually-buried-cards" },
  { mode: Mode.SCHED_ONLY, label: "studying-buried-siblings" },
  { mode: Mode.ALL, label: "studying-all-buried-cards" },
];

/**
 * Unburies a Deck's Cards. `request()` asks which kind when both are buried,
 * then calls the core; `dialog` must be rendered by the caller.
 */
export function useUnbury(
  deckId: bigint | undefined,
  info: BuriedInfo | undefined,
  after?: () => void | Promise<void>,
): { request: () => void; dialog: ReactNode } {
  const [asking, setAsking] = useState(false);

  const run = async (mode: Mode) => {
    if (deckId === undefined) return;
    setAsking(false);
    try {
      await core.unburyDeck({ deckId, mode }, { origin: "decks" });
      toast(td("unburied"));
      await after?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const request = () => {
    if (!hasBuried(info)) return;
    if (needsChoice(info)) setAsking(true);
    else void run(Mode.ALL);
  };

  const dialog = (
    <Dialog
      open={asking}
      onOpenChange={setAsking}
      title={tr("studying-unbury")}
      description={tr("studying-what-would-you-like-to-unbury")}
      footer={<Button onClick={() => setAsking(false)}>{tr("actions-cancel")}</Button>}
    >
      <div className="flex flex-col gap-1.5">
        {CHOICES.map((choice, i) => (
          <Button key={choice.mode} className="justify-start" data-autofocus={i === 0 ? "" : undefined} onClick={() => void run(choice.mode)}>
            {tr(choice.label)}
          </Button>
        ))}
      </div>
    </Dialog>
  );

  return { request, dialog };
}
