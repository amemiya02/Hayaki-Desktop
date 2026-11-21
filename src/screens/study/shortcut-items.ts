// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** The reviewer keys the shortcuts sheet lists beyond answering, marking and burying. */
import { tr } from "@/lib/i18n";

import { STUDY_KEYS } from "./keys";

export const STUDY_SHEET_ITEMS: { label: () => string; keys: string[] }[] = [
  { label: () => tr("studying-more"), keys: [STUDY_KEYS.menu] },
  { label: () => tr("actions-previous-card-info"), keys: [STUDY_KEYS.previousCardInfo] },
  { label: () => tr("actions-options"), keys: [STUDY_KEYS.options] },
  { label: () => tr("actions-set-due-date"), keys: [STUDY_KEYS.setDue] },
  { label: () => tr("actions-forget-card"), keys: [STUDY_KEYS.forget] },
  { label: () => tr("actions-create-copy"), keys: [STUDY_KEYS.createCopy] },
  { label: () => tr("studying-pause-audio"), keys: [STUDY_KEYS.pauseAudio] },
  { label: () => tr("studying-audio-5s"), keys: [STUDY_KEYS.seekBack] },
  { label: () => tr("studying-audio-and5s"), keys: [STUDY_KEYS.seekForward] },
  { label: () => tr("studying-record-own-voice"), keys: [STUDY_KEYS.recordVoice] },
  { label: () => tr("studying-replay-own-voice"), keys: [STUDY_KEYS.replayVoice] },
  { label: () => tr("actions-auto-advance"), keys: [STUDY_KEYS.toggleAutoAdvance] },
];
