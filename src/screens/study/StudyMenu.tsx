// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** The reviewer's More menu (M), in the order of Anki's `Reviewer._contextMenu`. */
import {
  AudioLines,
  Ban,
  BookmarkMinus,
  CalendarClock,
  Copy,
  FastForward,
  Flag,
  History,
  Info,
  ListRestart,
  Mic,
  MoreHorizontal,
  Pause,
  PauseCircle,
  Pencil,
  Rewind,
  RotateCcw,
  Settings2,
  Star,
  Trash2,
} from "lucide-react";
import type { ReactNode } from "react";

import { IconButton, Menu, MenuCheckItem, MenuContent, MenuItem, MenuSeparator, MenuTrigger, SubMenu } from "@/components/ui";
import { t, tr } from "@/lib/i18n";
import { useSession } from "@/lib/study/session";

import { SEEK_SECS, STUDY_KEYS, type StudyCommand } from "./keys";

export const flagColors = ["", "var(--flag-1)", "var(--flag-2)", "var(--flag-3)", "var(--flag-4)", "var(--flag-5)", "var(--flag-6)", "var(--flag-7)"];
export const flagNames = () => [
  "",
  tr("actions-flag-red"),
  tr("actions-flag-orange"),
  tr("actions-flag-green"),
  tr("actions-flag-blue"),
  tr("actions-flag-pink"),
  tr("actions-flag-turquoise"),
  tr("actions-flag-purple"),
];

const ellipsis = (key: string) => tr("actions-with-ellipsis", { action: tr(key) });

export function StudyMenu({ open, onOpenChange, run }: { open: boolean; onOpenChange: (open: boolean) => void; run: (command: StudyCommand) => void }) {
  const flag = useSession((s) => s.flag);
  const hasCard = useSession((s) => s.phase === "question" || s.phase === "answer");
  const hasPrevious = useSession((s) => s.previousCardId !== null);
  const autoAdvance = useSession((s) => s.autoAdvance);

  const item = (command: StudyCommand, label: string, icon: ReactNode, shortcut: string, opts: { danger?: boolean; disabled?: boolean } = {}) => (
    <MenuItem shortcut={shortcut} danger={opts.danger} disabled={opts.disabled ?? !hasCard} onSelect={() => run(command)}>
      {icon}
      {label}
    </MenuItem>
  );

  return (
    <Menu open={open} onOpenChange={onOpenChange}>
      <MenuTrigger asChild>
        <IconButton label={`${t("study.more")} (${STUDY_KEYS.menu})`}>
          <MoreHorizontal />
        </IconButton>
      </MenuTrigger>
      <MenuContent>
        {item({ id: "edit" }, tr("studying-edit"), <Pencil />, STUDY_KEYS.edit)}
        <SubMenu label={tr("studying-flag-card")} icon={<Flag />}>
          {flagNames()
            .slice(1)
            .map((name, i) => (
              <MenuItem key={i} shortcut={`Ctrl+${i + 1}`} disabled={!hasCard} onSelect={() => run({ id: "flag", flag: i + 1 })}>
                <Flag style={{ color: flagColors[i + 1], fill: flag === i + 1 ? flagColors[i + 1] : "none" }} />
                {name}
              </MenuItem>
            ))}
        </SubMenu>
        {item({ id: "bury", scope: "card" }, tr("studying-bury-card"), <BookmarkMinus />, "-")}
        {item({ id: "forget" }, ellipsis("actions-forget-card"), <ListRestart />, STUDY_KEYS.forget)}
        {item({ id: "setDue" }, ellipsis("actions-set-due-date"), <CalendarClock />, STUDY_KEYS.setDue)}
        {item({ id: "suspend", scope: "card" }, tr("actions-suspend-card"), <PauseCircle />, "@")}
        {item({ id: "options" }, tr("actions-options"), <Settings2 />, STUDY_KEYS.options)}
        {item({ id: "cardInfo" }, tr("actions-card-info"), <Info />, STUDY_KEYS.cardInfo)}
        {item({ id: "previousCardInfo" }, tr("actions-previous-card-info"), <History />, STUDY_KEYS.previousCardInfo, { disabled: !hasPrevious })}
        <MenuSeparator />
        {item({ id: "mark" }, tr("studying-mark-note"), <Star />, "*")}
        {item({ id: "bury", scope: "note" }, tr("studying-bury-note"), <BookmarkMinus />, "=")}
        {item({ id: "suspend", scope: "note" }, tr("studying-suspend-note"), <Ban />, "!")}
        {item({ id: "createCopy" }, ellipsis("actions-create-copy"), <Copy />, STUDY_KEYS.createCopy)}
        {item({ id: "deleteNote" }, tr("studying-delete-note"), <Trash2 />, "Ctrl+Del", { danger: true })}
        <MenuSeparator />
        {item({ id: "replay" }, tr("actions-replay-audio"), <RotateCcw />, "R")}
        {item({ id: "pauseAudio" }, tr("studying-pause-audio"), <Pause />, STUDY_KEYS.pauseAudio, { disabled: false })}
        {item({ id: "seek", secs: -SEEK_SECS }, tr("studying-audio-5s"), <Rewind />, STUDY_KEYS.seekBack, { disabled: false })}
        {item({ id: "seek", secs: SEEK_SECS }, tr("studying-audio-and5s"), <FastForward />, STUDY_KEYS.seekForward, { disabled: false })}
        {item({ id: "recordVoice" }, tr("studying-record-own-voice"), <Mic />, STUDY_KEYS.recordVoice, { disabled: false })}
        {item({ id: "replayVoice" }, tr("studying-replay-own-voice"), <AudioLines />, STUDY_KEYS.replayVoice, { disabled: false })}
        <MenuCheckItem checked={autoAdvance} shortcut={STUDY_KEYS.toggleAutoAdvance} onSelect={() => run({ id: "toggleAutoAdvance" })}>
          {tr("actions-auto-advance")}
        </MenuCheckItem>
      </MenuContent>
    </Menu>
  );
}
