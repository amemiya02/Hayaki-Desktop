// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** Every Deck options section except FSRS, with Anki's options, help and warnings. */
import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/components/ui";
import * as core from "@/lib/anki/generated/core";
import type { DeckConfig_Config, GetIgnoredBeforeCountResponse } from "@/lib/anki/proto/anki/deck_config_pb";
import { tr } from "@/lib/i18n";

import {
  answerActionChoices,
  gatherChoices,
  insertOrderChoices,
  leechChoices,
  questionActionChoices,
  reviewMixChoices,
  reviewOrderChoices,
  sortChoices,
} from "./choices";
import { MiniSegmented, NumberField, Row, Section, SelectField, StepsField, Switch, type NumberFieldProps } from "./controls";
import {
  currentConfig,
  defaultParamSearch,
  disabledSortOrders,
  setCardStateCustomizer,
  setFlag,
  setTabbed,
  switchTab,
  tabbedValue,
  updateConfig,
  type GlobalFlag,
  type OptionsState,
  type TabbedKind,
} from "./model";
import * as w from "./warnings";

export interface SectionProps {
  state: OptionsState;
  update: (fn: (state: OptionsState) => OptionsState) => void;
}

type ConfigKey = keyof DeckConfig_Config;

function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return Math.fround(a) === Math.fround(b);
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
  return a === b;
}

/** Shorthands every section uses to read, write and restore preset options. */
function useConfig({ state, update }: SectionProps) {
  const config = currentConfig(state);
  const defaults = state.defaults;
  const set = (patch: Partial<DeckConfig_Config>) => update((s) => updateConfig(s, patch));
  const restore = (key: ConfigKey) =>
    sameValue(config[key], defaults[key]) ? undefined : () => set({ [key]: defaults[key] } as Partial<DeckConfig_Config>);
  const flag = (name: GlobalFlag) => ({ checked: state[name], onChange: (v: boolean) => update((s) => setFlag(s, name, v)) });
  return { config, defaults, set, restore, flag };
}

const helpWith = (...parts: string[]) => parts.join("\n\n");

/* ------------------------------ Shared rows ------------------------------ */

function NumberRow({
  label,
  help,
  value,
  onChange,
  onRestore,
  messages,
  ...field
}: Omit<NumberFieldProps, "label"> & { label: string; help: string; onRestore?: () => void; messages?: (w.Warning | null)[] }) {
  return (
    <Row label={label} name={label} help={help} onRestore={onRestore} messages={messages}>
      <NumberField label={label} value={value} onChange={onChange} {...field} />
    </Row>
  );
}

function SwitchRow({
  label,
  help,
  checked,
  onChange,
  global,
  onRestore,
  messages,
}: {
  label: string;
  help: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  global?: boolean;
  onRestore?: () => void;
  messages?: (w.Warning | null)[];
}) {
  return (
    <Row label={label} name={label} help={help} global={global} onRestore={onRestore} messages={messages}>
      <Switch label={label} checked={checked} onChange={onChange} />
    </Row>
  );
}

/** A limit with Anki's "Preset / This deck / Today only" tabs. */
export function TabbedNumberRow({
  state,
  update,
  kind,
  label,
  help,
  defaultValue,
  messages,
  field,
  onFocus,
}: SectionProps & {
  kind: TabbedKind;
  label: string;
  help: string;
  defaultValue: number;
  messages?: (w.Warning | null)[];
  field?: Partial<NumberFieldProps>;
  onFocus?: () => void;
}) {
  const value = tabbedValue(state, kind);
  const tabs = [tr("deck-config-shared-preset"), tr("deck-config-deck-only"), tr("deck-config-today-only")].slice(
    0,
    state.tabs[kind].tabs.length,
  );
  return (
    <Row
      label={label}
      name={label}
      help={help}
      messages={messages}
      onRestore={sameValue(value, defaultValue) ? undefined : () => update((s) => setTabbed(s, kind, defaultValue))}
    >
      <MiniSegmented label={label} value={state.tabs[kind].active} options={tabs} onChange={(i) => update((s) => switchTab(s, kind, i))} />
      <NumberField label={label} value={value} onChange={(v) => update((s) => setTabbed(s, kind, v))} onFocus={onFocus} {...field} />
    </Row>
  );
}

/* ------------------------------ Sections ------------------------------ */

export function DailyLimitsSection(props: SectionProps) {
  const { state } = props;
  const { flag } = useConfig(props);
  const v3Extra = "\n\n" + tr("deck-config-limit-deck-v3") + "\n\n" + tr("deck-config-tab-description");
  const reviewV3Extra = "\n\n" + tr("deck-config-limit-interday-bound-by-reviews") + v3Extra;
  return (
    <Section id="daily-limits" title={tr("deck-config-daily-limits")}>
      <TabbedNumberRow
        {...props}
        kind="new"
        label={tr("scheduling-new-cardsday")}
        help={tr("deck-config-new-limit-tooltip") + v3Extra}
        defaultValue={state.defaults.newPerDay}
      />
      <TabbedNumberRow
        {...props}
        kind="review"
        label={tr("scheduling-maximum-reviewsday")}
        help={tr("deck-config-review-limit-tooltip") + reviewV3Extra}
        defaultValue={state.defaults.reviewsPerDay}
        messages={[w.reviewsTooLow(tabbedValue(state, "new"), tabbedValue(state, "review"))]}
      />
      <SwitchRow
        label={tr("deck-config-new-cards-ignore-review-limit")}
        help={helpWith(tr("deck-config-affects-entire-collection"), tr("deck-config-new-cards-ignore-review-limit-tooltip"))}
        global
        {...flag("newCardsIgnoreReviewLimit")}
      />
      <SwitchRow
        label={tr("deck-config-apply-all-parent-limits")}
        help={helpWith(tr("deck-config-affects-entire-collection"), tr("deck-config-apply-all-parent-limits-tooltip"))}
        global
        {...flag("applyAllParentLimits")}
      />
    </Section>
  );
}

export function NewCardsSection(props: SectionProps) {
  const { config, set, restore } = useConfig(props);
  const fsrs = props.state.fsrs;
  const stepsLabel = tr("deck-config-learning-steps");
  return (
    <Section id="new-cards" title={tr("scheduling-new-cards")}>
      <Row
        label={stepsLabel}
        name={stepsLabel}
        help={tr("deck-config-learning-steps-tooltip")}
        onRestore={restore("learnSteps")}
        messages={[w.learningStepsTooLargeForFsrs(config, fsrs)]}
      >
        <StepsField label={stepsLabel} value={config.learnSteps} onChange={(learnSteps) => set({ learnSteps })} />
      </Row>
      {!fsrs && (
        <>
          <NumberRow
            label={tr("scheduling-graduating-interval")}
            help={tr("deck-config-graduating-interval-tooltip")}
            value={config.graduatingIntervalGood}
            onChange={(graduatingIntervalGood) => set({ graduatingIntervalGood })}
            onRestore={restore("graduatingIntervalGood")}
            messages={[w.stepsExceedGraduatingInterval(config)]}
          />
          <NumberRow
            label={tr("scheduling-easy-interval")}
            help={tr("deck-config-easy-interval-tooltip")}
            value={config.graduatingIntervalEasy}
            onChange={(graduatingIntervalEasy) => set({ graduatingIntervalEasy })}
            onRestore={restore("graduatingIntervalEasy")}
            messages={[w.goodExceedsEasy(config)]}
          />
        </>
      )}
      <Row
        label={tr("deck-config-new-insertion-order")}
        name={tr("deck-config-new-insertion-order")}
        help={tr("deck-config-new-insertion-order-tooltip")}
        onRestore={restore("newCardInsertOrder")}
        messages={[w.insertionOrderRandom(config)]}
      >
        <SelectField
          label={tr("deck-config-new-insertion-order")}
          value={config.newCardInsertOrder}
          choices={insertOrderChoices()}
          onChange={(newCardInsertOrder) => set({ newCardInsertOrder })}
        />
      </Row>
    </Section>
  );
}

export function LapsesSection(props: SectionProps) {
  const { config, set, restore } = useConfig(props);
  const fsrs = props.state.fsrs;
  const stepsLabel = tr("deck-config-relearning-steps");
  return (
    <Section id="lapses" title={tr("scheduling-lapses")}>
      <Row
        label={stepsLabel}
        name={stepsLabel}
        help={tr("deck-config-relearning-steps-tooltip")}
        onRestore={restore("relearnSteps")}
        messages={[w.relearningStepsTooLargeForFsrs(config, fsrs), w.relearningStepsExceedMinimumInterval(config, fsrs)]}
      >
        <StepsField label={stepsLabel} value={config.relearnSteps} onChange={(relearnSteps) => set({ relearnSteps })} />
      </Row>
      {!fsrs && (
        <NumberRow
          label={tr("scheduling-minimum-interval")}
          help={tr("deck-config-minimum-interval-tooltip")}
          value={config.minimumLapseInterval}
          min={1}
          onChange={(minimumLapseInterval) => set({ minimumLapseInterval })}
          onRestore={restore("minimumLapseInterval")}
        />
      )}
      <NumberRow
        label={tr("scheduling-leech-threshold")}
        help={tr("deck-config-leech-threshold-tooltip")}
        value={config.leechThreshold}
        min={1}
        onChange={(leechThreshold) => set({ leechThreshold })}
        onRestore={restore("leechThreshold")}
      />
      <Row
        label={tr("scheduling-leech-action")}
        name={tr("scheduling-leech-action")}
        help={tr("deck-config-leech-action-tooltip")}
        onRestore={restore("leechAction")}
      >
        <SelectField
          label={tr("scheduling-leech-action")}
          value={config.leechAction}
          choices={leechChoices()}
          onChange={(leechAction) => set({ leechAction })}
        />
      </Row>
    </Section>
  );
}

export function DisplayOrderSection(props: SectionProps) {
  const { config, set, restore } = useConfig(props);
  const currentDeck = "\n\n" + tr("deck-config-display-order-will-use-current-deck");
  const rows = [
    {
      key: "newCardGatherPriority" as const,
      label: tr("deck-config-new-gather-priority"),
      help: tr("deck-config-new-gather-priority-tooltip-2") + currentDeck,
      choices: gatherChoices(),
    },
    {
      key: "newCardSortOrder" as const,
      label: tr("deck-config-new-card-sort-order"),
      help: tr("deck-config-new-card-sort-order-tooltip-2") + currentDeck,
      choices: sortChoices(disabledSortOrders(config.newCardGatherPriority)),
    },
    {
      key: "newMix" as const,
      label: tr("deck-config-new-review-priority"),
      help: tr("deck-config-new-review-priority-tooltip") + currentDeck,
      choices: reviewMixChoices(),
    },
    {
      key: "interdayLearningMix" as const,
      label: tr("deck-config-interday-step-priority"),
      help: tr("deck-config-interday-step-priority-tooltip") + currentDeck,
      choices: reviewMixChoices(),
    },
    {
      key: "reviewOrder" as const,
      label: tr("deck-config-review-sort-order"),
      help: tr("deck-config-review-sort-order-tooltip") + currentDeck,
      choices: reviewOrderChoices(props.state.fsrs),
    },
  ];
  return (
    <Section id="display-order" title={tr("deck-config-ordering-title")}>
      {rows.map((row) => (
        <Row key={row.key} label={row.label} name={row.label} help={row.help} onRestore={restore(row.key)}>
          <SelectField<number>
            label={row.label}
            value={config[row.key]}
            choices={row.choices}
            onChange={(value) => set({ [row.key]: value } as Partial<DeckConfig_Config>)}
          />
        </Row>
      ))}
    </Section>
  );
}

export function BurySection(props: SectionProps) {
  const { config, set, restore } = useConfig(props);
  const priority = "\n\n" + tr("deck-config-bury-priority-tooltip");
  return (
    <Section id="burying" title={tr("deck-config-bury-title")}>
      <SwitchRow
        label={tr("deck-config-bury-new-siblings")}
        help={tr("deck-config-bury-new-tooltip") + priority}
        checked={config.buryNew}
        onChange={(buryNew) => set({ buryNew })}
        onRestore={restore("buryNew")}
      />
      <SwitchRow
        label={tr("deck-config-bury-review-siblings")}
        help={tr("deck-config-bury-review-tooltip") + priority}
        checked={config.buryReviews}
        onChange={(buryReviews) => set({ buryReviews })}
        onRestore={restore("buryReviews")}
      />
      <SwitchRow
        label={tr("deck-config-bury-interday-learning-siblings")}
        help={tr("deck-config-bury-interday-learning-tooltip") + priority}
        checked={config.buryInterdayLearning}
        onChange={(buryInterdayLearning) => set({ buryInterdayLearning })}
        onRestore={restore("buryInterdayLearning")}
      />
    </Section>
  );
}

export function AudioSection(props: SectionProps) {
  const { config, set, restore } = useConfig(props);
  return (
    <Section id="audio" title={tr("deck-config-audio-title")}>
      <SwitchRow
        label={tr("deck-config-disable-autoplay")}
        help={tr("deck-config-disable-autoplay-tooltip")}
        checked={config.disableAutoplay}
        onChange={(disableAutoplay) => set({ disableAutoplay })}
        onRestore={restore("disableAutoplay")}
      />
      <SwitchRow
        label={tr("deck-config-skip-question-when-replaying")}
        help={tr("deck-config-always-include-question-audio-tooltip")}
        checked={config.skipQuestionWhenReplayingAnswer}
        onChange={(skipQuestionWhenReplayingAnswer) => set({ skipQuestionWhenReplayingAnswer })}
        onRestore={restore("skipQuestionWhenReplayingAnswer")}
      />
    </Section>
  );
}

export function TimerSection(props: SectionProps) {
  const { config, set, restore } = useConfig(props);
  return (
    <Section id="timer" title={tr("deck-config-timer-title")}>
      <NumberRow
        label={tr("deck-config-maximum-answer-secs")}
        help={tr("deck-config-maximum-answer-secs-tooltip")}
        value={config.capAnswerTimeToSecs}
        min={1}
        max={7200}
        onChange={(capAnswerTimeToSecs) => set({ capAnswerTimeToSecs })}
        onRestore={restore("capAnswerTimeToSecs")}
        messages={[w.maximumAnswerSecondsAboveRecommended(config)]}
      />
      <SwitchRow
        label={tr("scheduling-show-answer-timer")}
        help={tr("deck-config-show-answer-timer-tooltip")}
        checked={config.showTimer}
        onChange={(showTimer) => set({ showTimer })}
        onRestore={restore("showTimer")}
      />
      <SwitchRow
        label={tr("deck-config-stop-timer-on-answer")}
        help={tr("deck-config-stop-timer-on-answer-tooltip")}
        checked={config.stopTimerOnAnswer}
        onChange={(stopTimerOnAnswer) => set({ stopTimerOnAnswer })}
        onRestore={restore("stopTimerOnAnswer")}
      />
    </Section>
  );
}

export function AutoAdvanceSection(props: SectionProps) {
  const { config, set, restore } = useConfig(props);
  return (
    <Section id="auto-advance" title={tr("actions-auto-advance")}>
      <NumberRow
        label={tr("deck-config-seconds-to-show-question")}
        help={tr("deck-config-seconds-to-show-question-tooltip-3")}
        value={config.secondsToShowQuestion}
        step={0.1}
        onChange={(secondsToShowQuestion) => set({ secondsToShowQuestion })}
        onRestore={restore("secondsToShowQuestion")}
      />
      <NumberRow
        label={tr("deck-config-seconds-to-show-answer")}
        help={tr("deck-config-seconds-to-show-answer-tooltip-2")}
        value={config.secondsToShowAnswer}
        step={0.1}
        onChange={(secondsToShowAnswer) => set({ secondsToShowAnswer })}
        onRestore={restore("secondsToShowAnswer")}
      />
      <SwitchRow
        label={tr("deck-config-wait-for-audio")}
        help={tr("deck-config-wait-for-audio-tooltip-2")}
        checked={config.waitForAudio}
        onChange={(waitForAudio) => set({ waitForAudio })}
        onRestore={restore("waitForAudio")}
      />
      <Row
        label={tr("deck-config-question-action")}
        name={tr("deck-config-question-action")}
        help={tr("deck-config-question-action-tool-tip")}
        onRestore={restore("questionAction")}
      >
        <SelectField
          label={tr("deck-config-question-action")}
          value={config.questionAction}
          choices={questionActionChoices()}
          onChange={(questionAction) => set({ questionAction })}
        />
      </Row>
      <Row
        label={tr("deck-config-answer-action")}
        name={tr("deck-config-answer-action")}
        help={tr("deck-config-answer-action-tooltip-2")}
        onRestore={restore("answerAction")}
      >
        <SelectField
          label={tr("deck-config-answer-action")}
          value={config.answerAction}
          choices={answerActionChoices()}
          onChange={(answerAction) => set({ answerAction })}
        />
      </Row>
    </Section>
  );
}

const easyDayValues = [0, 0.5, 1];

function nearestEasyDay(value: number): number {
  let best = 0;
  easyDayValues.forEach((v, i) => {
    if (Math.abs(v - value) < Math.abs(easyDayValues[best] - value)) best = i;
  });
  return best;
}

export function EasyDaysSection(props: SectionProps & { original: number[] }) {
  const { config, set } = useConfig(props);
  const days = [
    tr("deck-config-easy-days-monday"),
    tr("deck-config-easy-days-tuesday"),
    tr("deck-config-easy-days-wednesday"),
    tr("deck-config-easy-days-thursday"),
    tr("deck-config-easy-days-friday"),
    tr("deck-config-easy-days-saturday"),
    tr("deck-config-easy-days-sunday"),
  ];
  const levels = [tr("deck-config-easy-days-minimum"), tr("deck-config-easy-days-reduced"), tr("deck-config-easy-days-normal")];
  const values = config.easyDaysPercentages;
  const messages = [
    w.noNormalEasyDay(values),
    w.easyDaysNeedReschedule(props.original, values, props.state.fsrs, props.state.fsrsReschedule),
  ].filter((m): m is w.Warning => !!m);
  return (
    <Section id="easy-days" title={tr("deck-config-easy-days-title")}>
      {days.map((day, index) => (
        <Row
          key={day}
          label={day}
          name={day}
          messages={index === days.length - 1 ? messages : undefined}
        >
          <MiniSegmented
            label={day}
            value={nearestEasyDay(values[index] ?? 1)}
            options={levels}
            onChange={(level) => {
              const next = values.slice();
              next[index] = easyDayValues[level];
              set({ easyDaysPercentages: next });
            }}
          />
        </Row>
      ))}
    </Section>
  );
}

function DateField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const shown = value && value !== "1970-01-01" ? value : "";
  return (
    <input
      type="date"
      aria-label={label}
      value={shown}
      max={new Date().toLocaleDateString("en-CA")}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "tabular h-8 w-[160px] rounded-[8px] border border-line bg-surface px-2.5 text-[13px] text-ink outline-none",
        "transition-[border-color,box-shadow] duration-[var(--dur-fast)] hover:border-line-strong focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]",
        !shown && "text-ink-3",
      )}
    />
  );
}

/** How many cards the "ignore cards reviewed before" date leaves for optimisation (debounced as in Anki). */
function useIgnoredBeforeCount(state: OptionsState): GetIgnoredBeforeCountResponse | null {
  const config = currentConfig(state);
  const date = config.ignoreRevlogsBeforeDate;
  const search = config.paramSearch || defaultParamSearch(state);
  const [count, setCount] = useState<GetIgnoredBeforeCountResponse | null>(null);
  useEffect(() => {
    if (!state.fsrs || !date || date === "1970-01-01") {
      setCount(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      core
        .getIgnoredBeforeCount({ search, ignoreRevlogsBeforeDate: date })
        .then((resp) => !cancelled && setCount(resp))
        .catch(() => !cancelled && setCount(null));
    }, 1000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [date, search, state.fsrs]);
  return count;
}

export function AdvancedSection(props: SectionProps) {
  const { state, update } = props;
  const { config, set, restore } = useConfig(props);
  const ignored = useIgnoredBeforeCount(state);
  const [customOpen, setCustomOpen] = useState(false);
  const floatRow = (
    key: "initialEase" | "easyMultiplier" | "intervalMultiplier" | "hardMultiplier" | "lapseMultiplier",
    label: string,
    help: string,
    min: number,
    max: number,
  ) => (
    <NumberRow
      key={key}
      label={label}
      help={help}
      value={config[key]}
      step={0.01}
      min={min}
      max={max}
      onChange={(value) => set({ [key]: value })}
      onRestore={restore(key)}
    />
  );
  const customLabel = tr("deck-config-custom-scheduling");
  return (
    <Section id="advanced" title={tr("deck-config-advanced-title")}>
      <NumberRow
        label={tr("scheduling-maximum-interval")}
        help={tr("deck-config-maximum-interval-tooltip")}
        value={config.maximumReviewInterval}
        min={1}
        max={365 * 100}
        onChange={(maximumReviewInterval) => set({ maximumReviewInterval })}
        onRestore={restore("maximumReviewInterval")}
        messages={[w.maximumIntervalTooShort(config)]}
      />
      {!state.fsrs ? (
        <>
          {floatRow("initialEase", tr("scheduling-starting-ease"), tr("deck-config-starting-ease-tooltip"), 1.31, 5)}
          {floatRow("easyMultiplier", tr("scheduling-easy-bonus"), tr("deck-config-easy-bonus-tooltip"), 1, 5)}
          {floatRow("intervalMultiplier", tr("scheduling-interval-modifier"), tr("deck-config-interval-modifier-tooltip"), 0.5, 2)}
          {floatRow("hardMultiplier", tr("scheduling-hard-interval"), tr("deck-config-hard-interval-tooltip"), 0.5, 1.3)}
          {floatRow("lapseMultiplier", tr("scheduling-new-interval"), tr("deck-config-new-interval-tooltip"), 0, 1)}
        </>
      ) : (
        <>
          <NumberRow
            label={tr("deck-config-historical-retention")}
            help={tr("deck-config-historical-retention-tooltip")}
            value={config.historicalRetention}
            step={0.01}
            min={0.5}
            max={1}
            percentage
            onChange={(historicalRetention) => set({ historicalRetention })}
            onRestore={restore("historicalRetention")}
          />
          <Row
            label={tr("deck-config-ignore-before")}
            name={tr("deck-config-ignore-before")}
            help={tr("deck-config-ignore-before-tooltip-2")}
            messages={[ignored && ignored.total ? w.ignoredBeforeInfo(ignored.included, ignored.total) : null]}
          >
            <DateField
              label={tr("deck-config-ignore-before")}
              value={config.ignoreRevlogsBeforeDate}
              onChange={(ignoreRevlogsBeforeDate) => set({ ignoreRevlogsBeforeDate })}
            />
          </Row>
        </>
      )}
      <Row
        label={
          <button
            type="button"
            aria-expanded={customOpen}
            onClick={() => setCustomOpen(!customOpen)}
            className="-ml-1 inline-flex items-center gap-1 rounded-[6px] px-1 text-left"
          >
            <ChevronRight className={cn("size-3.5 text-ink-3 transition-transform duration-[var(--dur-fast)]", customOpen && "rotate-90")} />
            {customLabel}
          </button>
        }
        name={customLabel}
        help={tr("deck-config-custom-scheduling-tooltip")}
        global
        onRestore={state.cardStateCustomizer ? () => update((s) => setCardStateCustomizer(s, "")) : undefined}
        below={
          customOpen && (
            <textarea
              aria-label={customLabel}
              spellCheck={false}
              autoCapitalize="none"
              value={state.cardStateCustomizer}
              onChange={(e) => update((s) => setCardStateCustomizer(s, e.target.value))}
              className="selectable h-40 w-full resize-y rounded-[8px] border border-line bg-surface-2 p-2.5 font-mono text-[12.5px] text-ink outline-none focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]"
            />
          )
        }
      />
    </Section>
  );
}

export const sectionTitles = () => [
  { id: "daily-limits", title: tr("deck-config-daily-limits") },
  { id: "new-cards", title: tr("scheduling-new-cards") },
  { id: "lapses", title: tr("scheduling-lapses") },
  { id: "display-order", title: tr("deck-config-ordering-title") },
  { id: "fsrs", title: "FSRS" },
  { id: "burying", title: tr("deck-config-bury-title") },
  { id: "audio", title: tr("deck-config-audio-title") },
  { id: "timer", title: tr("deck-config-timer-title") },
  { id: "auto-advance", title: tr("actions-auto-advance") },
  { id: "easy-days", title: tr("deck-config-easy-days-title") },
  { id: "advanced", title: tr("deck-config-advanced-title") },
];
