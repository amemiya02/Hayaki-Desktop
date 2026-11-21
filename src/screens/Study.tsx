// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import {
  ArrowLeft,
  Ban,
  BookmarkMinus,
  Flag,
  Info,
  MoreHorizontal,
  PauseCircle,
  Pencil,
  RotateCcw,
  Star,
  Trash2,
  Undo2,
  Volume2,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";

import { CardFrame, type CardFrameContent, type CardFrameHandle, type ForwardedKey } from "@/components/CardFrame";
import { Button, cn, IconButton, Kbd, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, onAccentKbd, SubMenu } from "@/components/ui";
import * as core from "@/lib/anki/generated/core";
import { QueuedCards_Queue } from "@/lib/anki/proto/anki/scheduler_pb";
import { direction, firstLanguage, t, tr } from "@/lib/i18n";
import { useNav } from "@/lib/nav";
import { cardFrameVars, usePrefs } from "@/lib/prefs";
import { useResolvedAppearance } from "@/lib/useAppearance";
import { playTags, stopAudio } from "@/lib/study/audio";
import { Rating, useSession } from "@/lib/study/session";
import { isImageOcclusion } from "@/components/editor/markup";
import { openCardInfo } from "@/screens/card-info";

import { Finished } from "./Finished";

const answers = [
  { rating: Rating.AGAIN, key: "1", label: () => tr("studying-again"), color: "text-again" },
  { rating: Rating.HARD, key: "2", label: () => tr("studying-hard"), color: "text-hard" },
  { rating: Rating.GOOD, key: "3", label: () => tr("studying-good"), color: "text-good" },
  { rating: Rating.EASY, key: "4", label: () => tr("studying-easy"), color: "text-easy" },
];

const flagColors = ["", "var(--flag-1)", "var(--flag-2)", "var(--flag-3)", "var(--flag-4)", "var(--flag-5)", "var(--flag-6)", "var(--flag-7)"];
const flagNames = () => [
  "",
  tr("actions-flag-red"),
  tr("actions-flag-orange"),
  tr("actions-flag-green"),
  tr("actions-flag-blue"),
  tr("actions-flag-pink"),
  tr("actions-flag-turquoise"),
  tr("actions-flag-purple"),
];

/**
 * Anki's own review preferences (Preferences > Review): next intervals on the
 * answer buttons and the remaining counts. Any collection change refreshes them.
 */
function useReviewPrefs() {
  const { data } = useQuery({ queryKey: ["preferences", "reviewing"], queryFn: async () => (await core.getPreferences()).reviewing ?? null });
  return { showIntervals: data?.showIntervalsOnButtons ?? true, showRemaining: data?.showRemainingDueCounts ?? true };
}

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

export function StudyScreen({ deckId }: { deckId: bigint | null }) {
  const back = useNav((s) => s.back);
  const go = useNav((s) => s.go);
  const theme = usePrefs((s) => s.theme);
  const autoplay = usePrefs((s) => s.autoplay);
  const { showIntervals, showRemaining } = useReviewPrefs();
  const resolved = useResolvedAppearance();
  const night = resolved !== "light";
  const frameRef = useRef<CardFrameHandle>(null);

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
    const html = s.phase === "answer" && s.answerHtml !== null ? s.answerHtml : r.question;
    return {
      html,
      css: r.css,
      bodyClass: night ? r.bodyClass.includes("nightMode") ? r.bodyClass : `${r.bodyClass} nightMode night_mode` : r.bodyClass.replace(/\s*nightMode night_mode/, ""),
      side: s.phase === "answer" ? "answer" : "question",
      frame: { dark: night, vars: cardFrameVars(theme, resolved), dir: direction(), lang: firstLanguage() },
      flag: s.flag,
      marked: s.marked,
    };
  }, [s.rendered, s.phase, s.answerHtml, night, theme, resolved, s.flag, s.marked]);

  // Autoplay each side's sounds as it appears.
  const lastPlayed = useRef<string>("");
  useEffect(() => {
    const r = s.rendered;
    if (!r || !autoplay) return;
    const key = `${r.cardId}:${s.phase}`;
    if (key === lastPlayed.current) return;
    if (s.phase === "question") {
      lastPlayed.current = key;
      void playTags(r.questionAv);
    } else if (s.phase === "answer") {
      lastPlayed.current = key;
      void playTags(r.answerAv);
    }
  }, [s.rendered, s.phase, autoplay]);

  const reveal = useCallback(async () => {
    const typed = useSession.getState().rendered?.typeAnswer ? await frameRef.current?.typedAnswer() : null;
    await useSession.getState().reveal(typed ?? null);
  }, []);

  const replay = useCallback(() => {
    const st = useSession.getState();
    const r = st.rendered;
    if (!r) return;
    void playTags(st.phase === "answer" ? r.answerAv : r.questionAv);
  }, []);

  const playRef = useCallback((ref: string) => {
    const r = useSession.getState().rendered;
    if (!r) return;
    const [side, index] = ref.split(":");
    const tag = (side === "q" ? r.questionAv : r.answerAv)[Number(index)];
    if (tag) void playTags([tag]);
  }, []);

  const runAction = useCallback(
    async (action: () => Promise<void>, message?: string) => {
      try {
        await action();
        if (message) toast(message, { action: { label: tr("undo-undo"), onClick: () => void useSession.getState().undo() } });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      }
    },
    [],
  );

  /** E edits the Note: Image Occlusion Notes on their image, others in Browse. */
  const editNote = useCallback(
    async (noteId: bigint) => {
      try {
        const note = await core.getNote({ nid: noteId });
        const notetype = await core.getNotetype({ ntid: note.notetypeId });
        if (isImageOcclusion(notetype)) return go({ name: "image-occlusion", mode: { kind: "edit", noteId } });
      } catch {
        // Fall back to Browse, which shows its own error if the Note is gone.
      }
      go({ name: "browse", search: `nid:${noteId}` });
    },
    [go],
  );

  const handleKey = useCallback(
    (e: ForwardedKey | KeyboardEvent): boolean => {
      const st = useSession.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === "Escape") {
        back();
        return true;
      }
      if (mod && e.key.toLowerCase() === "z") {
        void st.undo();
        return true;
      }
      if (mod && /^[0-7]$/.test(e.key)) {
        void st.setFlag(Number(e.key));
        return true;
      }
      if (mod && (e.key === "Delete" || e.key === "Backspace")) {
        void runAction(() => st.deleteNote(), tr("browsing-cards-deleted", { count: 1 }));
        return true;
      }
      if (mod || e.altKey) return false;
      if (st.phase === "question" && (e.key === " " || e.key === "Enter")) {
        void reveal();
        return true;
      }
      if (st.phase === "answer") {
        if (e.key === " " || e.key === "Enter") {
          void st.answer(Rating.GOOD);
          return true;
        }
        const index = ["1", "2", "3", "4"].indexOf(e.key);
        if (index >= 0) {
          void st.answer(answers[index].rating);
          return true;
        }
      }
      switch (e.key) {
        case "r":
        case "F5":
          replay();
          return true;
        case "*":
          void st.toggleMark();
          return true;
        case "-":
          void runAction(() => st.bury("card"), tr("studying-cards-buried", { count: 1 }));
          return true;
        case "=":
          void runAction(() => st.bury("note"), tr("studying-cards-buried", { count: 1 }));
          return true;
        case "@":
          void runAction(() => st.suspend("card"), tr("studying-card-suspended"));
          return true;
        case "!":
          void runAction(() => st.suspend("note"), tr("studying-note-suspended"));
          return true;
        case "e":
          if (st.queued?.card) void editNote(st.queued.card.noteId);
          return true;
        case "i":
          if (st.queued?.card) openCardInfo(st.queued.card.id);
          return true;
      }
      return false;
    },
    [back, editNote, reveal, replay, runAction],
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
        {showRemaining && (
          <div className="ms-3">
            <StudyCounts />
          </div>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          {s.marked && <Star className="me-1 size-4 fill-marked text-marked" aria-label={tr("studying-mark-note")} />}
          {s.flag > 0 && <Flag className="mr-1 size-4" style={{ color: flagColors[s.flag], fill: flagColors[s.flag] }} aria-label={flagNames()[s.flag]} />}
          <IconButton label={`${tr("actions-replay-audio")} (R)`} onClick={replay}>
            <Volume2 />
          </IconButton>
          <IconButton label={`${t("study.undo")} (Ctrl+Z)`} disabled={!s.canUndo} onClick={() => void s.undo()}>
            <Undo2 />
          </IconButton>
          <Menu>
            <MenuTrigger asChild>
              <IconButton label={t("study.more")}>
                <MoreHorizontal />
              </IconButton>
            </MenuTrigger>
            <MenuContent>
              <MenuItem shortcut="E" onSelect={() => s.queued?.card && void editNote(s.queued.card.noteId)}>
                <Pencil />
                {tr("studying-edit")}
              </MenuItem>
              <SubMenu label={tr("studying-flag-card")} icon={<Flag />}>
                {flagNames().slice(1).map((name, i) => (
                  <MenuItem key={i} shortcut={`Ctrl+${i + 1}`} onSelect={() => void s.setFlag(i + 1)}>
                    <Flag style={{ color: flagColors[i + 1], fill: s.flag === i + 1 ? flagColors[i + 1] : "none" }} />
                    {name}
                  </MenuItem>
                ))}
              </SubMenu>
              <MenuItem shortcut="I" onSelect={() => s.queued?.card && openCardInfo(s.queued.card.id)}>
                <Info />
                {tr("actions-card-info")}
              </MenuItem>
              <MenuItem shortcut="*" onSelect={() => void s.toggleMark()}>
                <Star />
                {tr("studying-mark-note")}
              </MenuItem>
              <MenuSeparator />
              <MenuItem shortcut="-" onSelect={() => void runAction(() => s.bury("card"), tr("studying-cards-buried", { count: 1 }))}>
                <BookmarkMinus />
                {tr("studying-bury-card")}
              </MenuItem>
              <MenuItem shortcut="=" onSelect={() => void runAction(() => s.bury("note"), tr("studying-cards-buried", { count: 1 }))}>
                <BookmarkMinus />
                {tr("studying-bury-note")}
              </MenuItem>
              <MenuItem shortcut="@" onSelect={() => void runAction(() => s.suspend("card"), tr("studying-card-suspended"))}>
                <PauseCircle />
                {tr("actions-suspend-card")}
              </MenuItem>
              <MenuItem shortcut="!" onSelect={() => void runAction(() => s.suspend("note"), tr("studying-note-suspended"))}>
                <Ban />
                {tr("studying-suspend-note")}
              </MenuItem>
              <MenuSeparator />
              <MenuItem shortcut="R" onSelect={replay}>
                <RotateCcw />
                {tr("actions-replay-audio")}
              </MenuItem>
              <MenuItem danger shortcut="Ctrl+Del" onSelect={() => void runAction(() => s.deleteNote(), tr("browsing-cards-deleted", { count: 1 }))}>
                <Trash2 />
                {tr("studying-delete-note")}
              </MenuItem>
            </MenuContent>
          </Menu>
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
                onClick={() => void s.answer(a.rating)}
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
                {showIntervals && <span className="tabular text-caption font-medium text-ink-3">{s.intervals[i] ?? ""}</span>}
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
    </div>
  );
}
