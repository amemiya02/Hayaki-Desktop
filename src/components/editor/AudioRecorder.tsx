// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The editor's Record audio button (F5, as in Anki). It records from the
 * microphone in a small popover with a level meter and the elapsed time,
 * stores the file in the media folder and inserts `[sound:…]` where the caret
 * was in the field that last had focus, then plays it back as Anki does.
 */
import { Mic, MicOff, Square } from "lucide-react";
import { Popover } from "radix-ui";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button, cn, Spinner, Tooltip } from "@/components/ui";
import { tr } from "@/lib/i18n";
import { addMediaBytes } from "@/lib/media";
import { trec } from "@/lib/strings/recording";
import { mediaUrl } from "@/lib/study/audio";

import { insertHtml, insertText, rememberSelection } from "./dom";
import { extensionFor, failureOf, levelOf, pickFormat, recordingName, smoothLevel, soundTag, splitLines } from "./recording";

type Phase = "idle" | "starting" | "recording" | "saving" | "error";

/** The editor around an element: the nearest ancestor that holds fields. */
function editorRoot(from: HTMLElement | null): HTMLElement | null {
  let el = from?.parentElement ?? null;
  while (el && !el.querySelector("[data-field-index]")) el = el.parentElement;
  return el;
}

function isInput(el: Element | null): el is HTMLElement {
  return !!el && (el.hasAttribute("data-rich-input") || el.hasAttribute("data-plain-input"));
}

function errorText(error: unknown): string {
  const failure = failureOf(error);
  if (failure === "other") return tr("qt-misc-unable-to-record", { error: error instanceof Error ? error.message : String(error) });
  return trec(failure);
}

export function RecordButton({ disabled }: { disabled?: boolean }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);

  const button = useRef<HTMLButtonElement>(null);
  const lastInput = useRef<HTMLElement | null>(null);
  const target = useRef<HTMLElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const audio = useRef<AudioContext | null>(null);
  const frame = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const fallbackExt = useRef("webm");
  const phaseRef = useRef<Phase>("idle");
  phaseRef.current = phase;

  // Remember which field had focus, so the recording goes there.
  useEffect(() => {
    const root = editorRoot(button.current);
    if (!root) return;
    const onFocus = (e: FocusEvent) => {
      if (isInput(e.target as Element)) lastInput.current = e.target as HTMLElement;
    };
    root.addEventListener("focusin", onFocus);
    return () => root.removeEventListener("focusin", onFocus);
  }, []);

  const release = useCallback(() => {
    cancelAnimationFrame(frame.current);
    window.clearInterval(timer.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    void audio.current?.close().catch(() => {});
    audio.current = null;
    recorder.current = null;
    chunks.current = [];
    setLevel(0);
  }, []);

  // Recording stops if the editor goes away.
  useEffect(() => () => {
    if (recorder.current && recorder.current.state !== "inactive") {
      recorder.current.onstop = null;
      recorder.current.stop();
    }
    release();
  }, [release]);

  const findTarget = (): HTMLElement | null => {
    const root = editorRoot(button.current);
    if (!root) return null;
    const last = lastInput.current;
    if (last && last.isConnected && root.contains(last)) return last;
    return root.querySelector<HTMLElement>("[data-rich-input]") ?? root.querySelector<HTMLElement>("[data-plain-input]");
  };

  const refocus = () => {
    const el = target.current;
    if (el?.isConnected) el.focus({ preventScroll: true });
  };

  const start = async () => {
    const el = findTarget();
    target.current = el;
    if (el && el.hasAttribute("data-rich-input")) rememberSelection(el);
    setError("");
    setElapsed(0);
    setPhase("starting");
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw Object.assign(new Error("MediaRecorder"), { name: "NotSupportedError" });
      }
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (phaseRef.current !== "starting") {
        // cancelled while the permission prompt was open
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = media;
      const format = pickFormat((m) => MediaRecorder.isTypeSupported(m));
      fallbackExt.current = format?.ext ?? "webm";
      const rec = new MediaRecorder(media, format ? { mimeType: format.mimeType } : undefined);
      chunks.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };
      recorder.current = rec;
      rec.start(250);

      try {
        const context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        context.createMediaStreamSource(media).connect(analyser);
        audio.current = context;
        const samples = new Uint8Array(analyser.fftSize);
        let shown = 0;
        const tick = () => {
          analyser.getByteTimeDomainData(samples);
          shown = smoothLevel(shown, levelOf(samples));
          setLevel(shown);
          frame.current = requestAnimationFrame(tick);
        };
        frame.current = requestAnimationFrame(tick);
      } catch {
        // The meter is a guide only.
      }

      const began = performance.now();
      timer.current = window.setInterval(() => setElapsed((performance.now() - began) / 1000), 100);
      setPhase("recording");
    } catch (err) {
      release();
      setError(errorText(err));
      setPhase("error");
    }
  };

  const cancel = () => {
    const rec = recorder.current;
    if (rec && rec.state !== "inactive") {
      rec.onstop = null;
      rec.stop();
    }
    release();
    setPhase("idle");
    requestAnimationFrame(refocus);
  };

  const save = async () => {
    const rec = recorder.current;
    if (!rec || phaseRef.current !== "recording") return;
    setPhase("saving");
    window.clearInterval(timer.current);
    await new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
      rec.stop();
    });
    const type = rec.mimeType || "";
    const blob = new Blob(chunks.current, { type });
    release();
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const name = await addMediaBytes(recordingName(new Date(), extensionFor(type, fallbackExt.current)), bytes);
      setPhase("idle");
      const el = target.current;
      if (el?.isConnected) {
        if (el instanceof HTMLTextAreaElement) insertText(el, soundTag(name, false));
        else insertHtml(el, soundTag(name, true));
      }
      void new Audio(mediaUrl(name)).play().catch(() => {});
    } catch (err) {
      setError(`${trec("saveFailed")}\n${err instanceof Error ? err.message : String(err)}`);
      setPhase("error");
    }
  };

  const toggle = () => {
    const p = phaseRef.current;
    if (p === "idle" || p === "error") void start();
    else if (p === "recording") void save();
  };
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;

  // F5 records from anywhere in the editor, and stops and saves while recording.
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (e.key !== "F5" || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      const root = editorRoot(button.current);
      const inside = !!root && root.contains(e.target as Node);
      if (!inside && phaseRef.current === "idle") return;
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat && !disabled) toggleRef.current();
    };
    window.addEventListener("keydown", listener, true);
    return () => window.removeEventListener("keydown", listener, true);
  }, [disabled]);

  const open = phase !== "idle";
  const label = tr("editing-record-audio");
  const [title, time] = splitLines(tr("media-recordingtime", { secs: elapsed.toFixed(1) }));

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && phase !== "saving") cancel();
      }}
    >
      <Tooltip content={`${label} (F5)`}>
        <Popover.Anchor asChild>
          <button
            ref={button}
            type="button"
            tabIndex={-1}
            aria-label={label}
            aria-pressed={phase === "recording"}
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={toggle}
            className={cn(
              "grid h-7 min-w-7 place-items-center rounded-[7px] px-1 text-ink-2 transition-colors duration-[var(--dur-fast)]",
              "hover:bg-sidebar-hover hover:text-ink disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4",
              open && "bg-accent-soft text-accent-ink hover:bg-accent-soft hover:text-accent-ink",
            )}
          >
            <Mic />
          </button>
        </Popover.Anchor>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          aria-label={label}
          onInteractOutside={(e) => phase === "recording" && e.preventDefault()}
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            if (phase !== "saving") cancel();
          }}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onKeyDown={(e) => {
            if (e.key === "Enter" && phase === "recording" && !(e.target as HTMLElement).closest("button")) {
              e.preventDefault();
              void save();
            }
          }}
          className="z-50 w-[280px] rounded-[12px] border border-line bg-raised p-3.5 shadow-pop outline-none data-[state=open]:animate-[pop-in_120ms_var(--ease-out)]"
        >
          {phase === "error" ? (
            <div className="space-y-3">
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-surface-3 text-danger">
                  <MicOff className="size-4" />
                </span>
                <p role="alert" className="whitespace-pre-line text-[12.5px] leading-snug text-ink">
                  {error}
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button size="sm" onClick={cancel}>
                  {tr("actions-close")}
                </Button>
                <Button size="sm" variant="primary" autoFocus onClick={() => void start()}>
                  {label}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2.5">
                <span aria-hidden className="relative grid size-7 shrink-0 place-items-center rounded-full bg-surface-3">
                  {phase === "recording" ? (
                    <span className="size-2.5 animate-pulse rounded-full bg-[var(--danger)]" />
                  ) : (
                    <Spinner className="size-3.5" />
                  )}
                </span>
                <div className="min-w-0 flex-1" aria-live="polite">
                  <p className="text-[13px] font-medium text-ink">
                    {phase === "starting" ? trec("starting") : phase === "saving" ? trec("saving") : title}
                  </p>
                  <p className="tabular text-[12px] text-ink-3">{time}</p>
                </div>
              </div>
              <div
                role="meter"
                aria-label={trec("level")}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(level * 100)}
                className="flex h-2 gap-[2px]"
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <span
                    key={i}
                    className={cn(
                      "flex-1 rounded-[1.5px] transition-colors duration-75",
                      i / 24 < level ? (i >= 20 ? "bg-[var(--danger)]" : "bg-accent") : "bg-surface-3",
                    )}
                  />
                ))}
              </div>
              <div className="flex justify-end gap-2">
                <Button size="sm" onClick={cancel} disabled={phase === "saving"}>
                  {tr("actions-cancel")}
                </Button>
                <Button size="sm" variant="primary" autoFocus onClick={() => void save()} disabled={phase !== "recording"}>
                  {phase === "saving" ? <Spinner className="text-on-accent" /> : <Square className="fill-current" />}
                  {tr("actions-save")}
                </Button>
              </div>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
