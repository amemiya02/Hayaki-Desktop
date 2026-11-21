// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { clone } from "@bufbuild/protobuf";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button, cn, Dialog, fieldClass, Spinner, Switch } from "@/components/ui";
import * as core from "@/lib/anki/generated/core";
import { DeckSchema } from "@/lib/anki/proto/anki/decks_pb";
import { t, tr } from "@/lib/i18n";
import { td } from "@/lib/strings/decks";

/** Edits a normal Deck's description and its Markdown option, as Anki's description dialog does. */
export function DeckDescriptionDialog({ deckId, onClose }: { deckId: bigint | null; onClose: () => void }) {
  const open = deckId !== null;
  const { data: deck, isError, refetch } = useQuery({
    queryKey: ["deck", String(deckId)],
    queryFn: () => core.getDeck({ did: deckId! }),
    enabled: open,
  });
  const [text, setText] = useState("");
  const [markdown, setMarkdown] = useState(false);
  const [busy, setBusy] = useState(false);
  const loaded = deck?.kind.case === "normal";

  // Seed the fields once per opening: the query refetches after any collection
  // change, and reseeding then would wipe what the person is typing.
  const seeded = useRef<bigint | null>(null);
  useEffect(() => {
    if (!open) {
      seeded.current = null;
      return;
    }
    if (seeded.current === deckId || deck?.kind.case !== "normal") return;
    seeded.current = deckId;
    setText(deck.kind.value.description);
    setMarkdown(deck.kind.value.markdownDescription);
  }, [open, deckId, deck]);

  const save = async () => {
    if (deck?.kind.case !== "normal") return;
    setBusy(true);
    try {
      const next = clone(DeckSchema, deck);
      if (next.kind.case !== "normal") return;
      next.kind.value.description = text;
      next.kind.value.markdownDescription = markdown;
      await core.updateDeck(next, { origin: "decks" });
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={tr("scheduling-description")}
      width={520}
      footer={
        <>
          <Button onClick={onClose}>{tr("actions-cancel")}</Button>
          <Button variant="primary" disabled={!loaded || busy} onClick={() => void save()}>
            {busy && <Spinner />}
            {t("common.save")}
          </Button>
        </>
      }
    >
      {isError ? (
        <div className="flex flex-col items-start gap-3 py-2">
          <p className="text-control text-danger">{td("descriptionLoadError")}</p>
          <Button size="sm" onClick={() => void refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      ) : !loaded ? (
        <div className="grid h-[200px] place-items-center">
          <Spinner />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <label className="flex items-start gap-3" title={tr("deck-config-description-new-handling-hint")}>
            <Switch checked={markdown} onChange={setMarkdown} label={tr("deck-config-description-new-handling2")} />
            <span className="min-w-0 text-control text-ink">
              {tr("deck-config-description-new-handling2")}
              <span className="mt-0.5 block text-caption text-ink-3">{tr("deck-config-description-new-handling-hint")}</span>
            </span>
          </label>
          <textarea
            data-autofocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label={td("descriptionLabel")}
            placeholder={td("descriptionPlaceholder")}
            spellCheck
            rows={9}
            className={cn(fieldClass, "selectable h-auto min-h-[180px] resize-y py-2 font-mono leading-relaxed")}
          />
        </div>
      )}
    </Dialog>
  );
}
