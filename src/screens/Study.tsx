// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { ArrowLeft, FastForward, Flag, Star, Undo2, Volume2 } from "lucide-react";
import { motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { CardFrame, type CardFrameContent, type CardFrameHandle, type ForwardedKey } from "@/components/CardFrame";
import { Button, cn, IconButton, Kbd, onAccentKbd, Tooltip } from "@/components/ui";
import { QueuedCards_Queue } from "@/lib/anki/proto/anki/scheduler_pb";
import { onCollectionChange } from "@/lib/anki/transport";
import { direction, firstLanguage, t, tr } from "@/lib/i18n";
import { useNav } from "@/lib/nav";
import { cardFrameVars, usePrefs } from "@/lib/prefs";
import { tstudy } from "@/lib/strings/study";
import { useResolvedAppearance } from "@/lib/useAppearance";
import { playTags, stopAudio } from "@/lib/study/audio";
import { Rating, useSession } from "@/lib/study/session";

import { handleWindowChord } from "@/shell/WindowHost";

import { Finished } from "./Finished";
import { AnswerTimer } from "./study/AnswerTimer";
import { EditCurrentDialog, ForgetDialog, SetDueDialog, TimeboxDialog } from "./study/dialogs";
import { commandFor, STUDY_KEYS } from "./study/keys";
import { flagColors, flagNames, StudyMenu } from "./study/StudyMenu";
import { useAutoAdvance } from "./study/useAutoAdvance";
import { answerCard, replayAudio, useStudyCommands, type StudyDialog } from "./study/useStudyCommands";
import { RecordVoiceDialog } from "./study/VoiceRecorder";

const answers = [
  { rating: Rating.AGAIN, key: "1", label: () => tr("studying-again"), color: "text-again" },
  { rating: Rating.HARD, key: "2", label: () => tr("studying-hard"), color: "text-hard" },
  { rating: Rating.GOOD, key: "3", label: () => tr("studying-good"), color: "text-good" },
  { rating: Rating.EASY, key: "4", label: () => tr("studying-easy"), color: "text-easy" },
];

function StudyCounts() {
  const counts = useSession((s) => s.counts);
  const queue = useSession((s) => s.queued?.queue);
  const items = [
    { value: counts.newCount, color: "text-new", tint: "var(--count-new)", active: queue === QueuedCards_Queue.NEW },
    { value: counts.learningCount, color: "text-learn", tint: "var(--count-learn)", active: queue === QueuedCards_Queue.LEARNING },
    { value: counts.reviewCount, color: "text-due", tint: "var(--count-due)", active: queue === QueuedCards_Queue.REVIEW },
  ];
  // Counts change in place, without motion: a number that moves on every answer pulls the eye from the Card.
  return (
    <div className="flex items-center gap-1" aria-label={t("study.remaining", { count: counts.newCount + counts.learningCount + counts.reviewCount })}>
      {items.map((item, i) => (
        <span
          key={i}
          className={cn(
            "tabular rounded-full px-2 py-0.5 text-control font-semibold transition-[background-color] duration-[var(--dur)]",
            item.value ? item.color : "font-normal text-ink-3",
          )}
          style={item.active ? { background: `color-mix(in oklab, ${item.tint} var(--tint-pill), transparent)` } : undefined}
        >
          {item.value}
        </span>
      ))}
    </div>
  );
}

/** Shown while auto advance runs, so a Card moving on by itself never surprises. */
function AutoAdvanceBadge({ onTurnOff }: { onTurnOff: () => void }) {
  const on = useSession((s) => s.autoAdvance);
  if (!on) return null;
  return (
    <Tooltip content={`${tstudy("autoAdvanceOn")} (${STUDY_KEYS.toggleAutoAdvance})`}>
      <button
        type="button"
        aria-pressed
        onClick={onTurnOff}
        className="me-1 flex h-7 items-center gap-1 rounded-full bg-accent-soft px-2.5 text-caption font-medium text-accent-ink transition-colors duration-[var(--dur-fast)] hover:bg-[color-mix(in_oklab,var(--accent)_22%,transparent)]"
      >
        <FastForward className="size-3.5" aria-hidden />
        {tr("actions-auto-advance")}
      </button>
    </Tooltip>
  );
}

export function StudyScreen({ deckId }: { deckId: bigint | null }) {
  const back = useNav((s) => s.back);
  const go = useNav((s) => s.go);
  const theme = usePrefs((s) => s.theme);
  const resolved = useResolvedAppearance();
  const night = resolved !== "light";
  const frameRef = useRef<CardFrameHandle>(null);
  const [dialog, setDialog] = useState<StudyDialog | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const s = useSession();

  useEffect(() => {
    void useSession.getState().start(deckId, night);
    return () => stopAudio();
    // Starting a session once per Deck; a change of appearance re-renders the Card below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckId]);

  useEffect(() => {
    useSession.getState().setNightMode(night);
  }, [night]);

  const content = useMemo<CardFrameContent | null>(() => {
    const r = s.rendered;
    if (!r) return null;
    // The answer stays up while the next Card loads and behind the timebox notice.
    const answerSide = s.phase !== "question" && s.answerHtml !== null;
    return {
      html: answerSide ? s.answerHtml! : r.question,
      css: r.css,
      bodyClass: night ? r.bodyClass.includes("nightMode") ? r.bodyClass : `${r.bodyClass} nightMode night_mode` : r.bodyClass.replace(/\s*nightMode night_mode/, ""),
      side: answerSide ? "answer" : "question",
      frame: { dark: night, vars: cardFrameVars(theme, resolved), dir: direction(), lang: firstLanguage() },
      flag: s.flag,
      marked: s.marked,
    };
  }, [s.rendered, s.phase, s.answerHtml, night, theme, resolved, s.flag, s.marked]);

  // Each side's sounds play as it appears when the preset allows; otherwise the
  // side still clears what was playing, as Anki's player does.
  const lastPlayed = useRef<string>("");
  useEffect(() => {
    const r = s.rendered;
    if (!r || (s.phase !== "question" && s.phase !== "answer")) return;
    const key = `${r.cardId}:${s.shownAt}:${s.phase}`;
    if (key === lastPlayed.current) return;
    lastPlayed.current = key;
    const tags = s.phase === "question" ? r.questionAv : r.answerAv;
    void playTags(s.config.autoplay ? tags : [], { interrupt: s.prefs.interruptAudio });
  }, [s.rendered, s.phase, s.shownAt, s.config.autoplay, s.prefs.interruptAudio]);

  const reveal = useCallback(async () => {
    const typed = useSession.getState().rendered?.typeAnswer ? await frameRef.current?.typedAnswer() : null;
    await useSession.getState().reveal(typed ?? null);
  }, []);

  const openMenu = useCallback(() => setMenuOpen(true), []);
  const { run, autoAdvance } = useStudyCommands({ reveal, openDialog: setDialog, openMenu });
  useAutoAdvance(autoAdvance);

  const playRef = useCallback((ref: string) => {
    const r = useSession.getState().rendered;
    if (!r) return;
    const [side, index] = ref.split(":");
    const tag = (side === "q" ? r.questionAv : r.answerAv)[Number(index)];
    if (tag) void playTags([tag], { interrupt: useSession.getState().prefs.interruptAudio });
  }, []);

  // Edits saved from Edit Current (or anywhere else) redraw the Card on the side it is on, as Anki does.
  useEffect(
    () =>
      onCollectionChange(({ changes, origin }) => {
        if (origin !== "study" && (changes.noteText || changes.note)) void useSession.getState().redraw();
      }),
    [],
  );

  const handleKey = useCallback(
    (e: ForwardedKey | KeyboardEvent): boolean => {
      // Full screen, zoom and redo, which keys from the Card page would otherwise never reach.
      if (handleWindowChord(e, "target" in e ? e.target : null)) return true;
      const phase = useSession.getState().phase;
      const command = commandFor(e, phase);
      if (!command) return false;
      // The finished screen keeps only leaving and undo.
      if (phase === "finished" && command.id !== "leave" && command.id !== "undo") return false;
      run(command);
      return true;
    },
    [run],
  );

  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (document.querySelector("[role=menu], [role=dialog]")) return;
      if (handleKey(e)) e.preventDefault();
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [handleKey]);

  const closeDialog = () => setDialog(null);

  const remaining = s.counts.newCount + s.counts.learningCount + s.counts.reviewCount;
  // The line starts full and drains as Cards leave the session.
  const progress = s.answered + remaining > 0 ? remaining / (s.answered + remaining) : 0;
  const deckName = s.queued?.context?.deckName ?? "";
  const path = deckName.split("::");

  if (s.phase === "finished") {
    return <Finished onBack={back} error={s.error} />;
  }

  return (
    <div className="flex h-full flex-col bg-canvas">
      <header className="relative flex h-11 shrink-0 items-center gap-2 px-3">
        <IconButton label={`${t("study.back")} (Esc)`} onClick={back}>
          <ArrowLeft />
        </IconButton>
        <div className="flex min-w-0 items-center gap-1.5 text-control" title={deckName}>
          {path.map((part, i) => (
            <span key={i} className="flex min-w-0 items-center gap-1.5">
              {i > 0 && <span className="text-ink-3">›</span>}
              <span className={cn("truncate", i === path.length - 1 ? "font-semibold text-ink" : "text-ink-2")}>{part}</span>
            </span>
          ))}
        </div>
        {s.prefs.showRemaining && (
          <div className="ms-3">
            <StudyCounts />
          </div>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <AutoAdvanceBadge onTurnOff={() => run({ id: "toggleAutoAdvance" })} />
          <AnswerTimer />
          {s.marked && <Star className="me-1 size-4 fill-marked text-marked" aria-label={tr("studying-mark-note")} />}
          {s.flag > 0 && <Flag className="mr-1 size-4" style={{ color: flagColors[s.flag], fill: flagColors[s.flag] }} aria-label={flagNames()[s.flag]} />}
          <IconButton label={`${tr("actions-replay-audio")} (R)`} onClick={replayAudio}>
            <Volume2 />
          </IconButton>
          <IconButton label={`${t("study.undo")} (Ctrl+Z)`} disabled={!s.canUndo} onClick={() => void s.undo()}>
            <Undo2 />
          </IconButton>
          <StudyMenu open={menuOpen} onOpenChange={setMenuOpen} run={run} />
        </div>
        <div className="absolute inset-x-0 bottom-0 h-[2px] bg-[color-mix(in_oklab,var(--accent)_22%,transparent)]" aria-hidden="true">
          <div
            className="h-full bg-accent transition-[width] duration-[var(--dur)] ease-out"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </header>

      <main className="relative min-h-0 flex-1">
        <CardFrame
          ref={frameRef}
          content={content}
          title={t("study.cardContent")}
          className="absolute inset-0 h-full w-full border-0 bg-transparent"
          onCommand={(cmd) => {
            if (cmd === "ans") {
              if (useSession.getState().phase === "question") void reveal();
            } else if (cmd.startsWith("play:")) playRef(cmd.slice(5));
          }}
          onKey={(key) => handleKey(key)}
        />
      </main>

      <footer className="shrink-0 px-6 pb-5 pt-3">
        <div className="mx-auto flex h-[60px] max-w-[640px] items-stretch justify-center gap-2">
          {s.phase === "answer" ? (
            answers.map((a, i) => (
              <motion.button
                key={a.key}
                type="button"
                onClick={() => void answerCard(a.rating)}
                // Press sinks to 0.96 and settles back on a short spring; the answer itself is sent on click, never delayed.
                whileTap={{ scale: 0.96 }}
                transition={{ type: "spring", stiffness: 700, damping: 30, mass: 0.6 }}
                className={cn(
                  "group flex flex-1 flex-col items-center justify-center gap-0.5 rounded-[12px] border border-line bg-surface",
                  "transition-[background-color,border-color] duration-[var(--dur-fast)] ease-standard",
                  "hover:border-line-strong hover:bg-surface-2",
                  "animate-rise-quick",
                )}
                style={{ animationDelay: `${i * 18}ms` }}
              >
                {s.prefs.showIntervals && <span className="tabular text-caption font-medium text-ink-3">{s.intervals[i] ?? ""}</span>}
                <span className={cn("text-body font-semibold", a.color)}>{a.label()}</span>
                <Kbd className="sr-only">{a.key}</Kbd>
              </motion.button>
            ))
          ) : (
            <Button
              variant="primary"
              size="lg"
              disabled={s.phase !== "question"}
              onClick={() => void reveal()}
              className="h-full w-full rounded-[12px] text-title"
            >
              {tr("studying-show-answer")}
              <Kbd className={onAccentKbd}>
                {tr("studying-space")}
              </Kbd>
            </Button>
          )}
        </div>
        {/* Always laid out, so the Card never moves when the answer appears. */}
        <div
          className={cn("mx-auto mt-2 flex max-w-[640px] justify-around text-micro text-ink-3", s.phase !== "answer" && "invisible")}
          aria-hidden="true"
        >
          {answers.map((a) => (
            <span key={a.key} className="flex-1 text-center">
              {a.key}
            </span>
          ))}
        </div>
      </footer>

      {s.phase === "timebox" && s.timeboxNotice && (
        <TimeboxDialog notice={s.timeboxNotice} onContinue={() => void s.continueAfterTimebox()} onFinish={() => go({ name: "decks" })} />
      )}
      {dialog?.kind === "setDue" && <SetDueDialog onClose={closeDialog} onSubmit={(days) => s.setDueDate(days).then(() => doneToast("scheduling-set-due-date-done"))} />}
      {dialog?.kind === "forget" && (
        <ForgetDialog onClose={closeDialog} onSubmit={(restore, reset) => s.forget(restore, reset).then(() => doneToast("scheduling-forgot-cards"))} />
      )}
      {dialog?.kind === "edit" && <EditCurrentDialog noteId={dialog.noteId} onClose={closeDialog} />}
      {dialog?.kind === "record" && <RecordVoiceDialog onClose={closeDialog} />}
    </div>
  );
}

function doneToast(key: string): void {
  toast(tr(key, { cards: 1 }), { action: { label: tr("undo-undo"), onClick: () => void useSession.getState().undo() } });
}
