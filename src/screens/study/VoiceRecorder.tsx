// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Record Own Voice (Shift+V) and Replay Own Voice (V), as in Anki's reviewer:
 * the recording is kept in memory for this session, never added to the
 * collection, and plays back once it is saved. The recording dialog uses the
 * editor recorder's format choice, level meter and messages.
 */
import { MicOff, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { failureOf, levelOf, pickFormat, smoothLevel, splitLines } from "@/components/editor/recording";
import { Button, cn, Dialog, Spinner } from "@/components/ui";
import { tr } from "@/lib/i18n";
import { trec } from "@/lib/strings/recording";
import { playUrl } from "@/lib/study/audio";

let recordedUrl: string | null = null;

/** V: plays the last recording, or says there is none yet. */
export function replayOwnVoice(): void {
  if (!recordedUrl) {
    toast(tr("studying-you-havent-recorded-your-voice-yet"));
    return;
  }
  void playUrl(recordedUrl);
}

function keepRecording(blob: Blob): void {
  if (recordedUrl) URL.revokeObjectURL(recordedUrl);
  recordedUrl = URL.createObjectURL(blob);
}

type Phase = { kind: "starting" } | { kind: "recording" } | { kind: "saving" } | { kind: "error"; message: string };

function errorText(error: unknown): string {
  const failure = failureOf(error);
  if (failure === "other") return tr("qt-misc-unable-to-record", { error: error instanceof Error ? error.message : String(error) });
  return trec(failure);
}

export function RecordVoiceDialog({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: "starting" });
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  useEffect(() => {
    let live = true;
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let frame = 0;
    let timer: number | undefined;
    setPhase({ kind: "starting" });
    setElapsed(0);
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw Object.assign(new Error("MediaRecorder"), { name: "NotSupportedError" });
      }
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (!live) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream = media;
      const format = pickFormat((m) => MediaRecorder.isTypeSupported(m));
      const rec = new MediaRecorder(media, format ? { mimeType: format.mimeType } : undefined);
      chunks.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };
      rec.start(250);
      recorder.current = rec;
      try {
        context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        context.createMediaStreamSource(media).connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);
        let shown = 0;
        const tick = () => {
          analyser.getByteTimeDomainData(samples);
          shown = smoothLevel(shown, levelOf(samples));
          setLevel(shown);
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      } catch {
        // The meter is a guide only.
      }
      const began = performance.now();
      timer = window.setInterval(() => setElapsed((performance.now() - began) / 1000), 100);
      setPhase({ kind: "recording" });
    })().catch((error: unknown) => live && setPhase({ kind: "error", message: errorText(error) }));
    return () => {
      live = false;
      cancelAnimationFrame(frame);
      window.clearInterval(timer);
      const rec = recorder.current;
      if (rec && rec.state !== "inactive") {
        rec.onstop = null;
        rec.stop();
      }
      recorder.current = null;
      stream?.getTracks().forEach((t) => t.stop());
      void context?.close().catch(() => undefined);
    };
  }, [attempt]);

  const save = useCallback(async () => {
    const rec = recorder.current;
    if (!rec || rec.state === "inactive") return;
    setPhase({ kind: "saving" });
    await new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
      rec.stop();
    });
    recorder.current = null;
    keepRecording(new Blob(chunks.current, { type: rec.mimeType || "" }));
    onClose();
    replayOwnVoice();
  }, [onClose]);

  // Enter saves wherever focus is, as the default button of Anki's recording dialog.
  const recording = phase.kind === "recording";
  useEffect(() => {
    if (!recording) return;
    const listener = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      e.stopPropagation();
      void save();
    };
    window.addEventListener("keydown", listener, true);
    return () => window.removeEventListener("keydown", listener, true);
  }, [recording, save]);

  const label = tr("studying-record-own-voice");
  const [title, time] = splitLines(tr("media-recordingtime", { secs: elapsed.toFixed(1) }));

  if (phase.kind === "error") {
    return (
      <Dialog
        open
        onOpenChange={(o) => !o && onClose()}
        title={label}
        footer={
          <>
            <Button onClick={onClose}>{tr("actions-close")}</Button>
            <Button variant="primary" onClick={() => setAttempt((n) => n + 1)}>
              {label}
            </Button>
          </>
        }
      >
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-surface-3 text-danger">
            <MicOff className="size-4" />
          </span>
          <p role="alert" className="whitespace-pre-line text-control leading-snug text-ink">
            {phase.message}
          </p>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && phase.kind !== "saving" && onClose()}
      title={label}
      width={360}
      footer={
        <>
          <Button onClick={onClose} disabled={phase.kind === "saving"}>
            {tr("actions-cancel")}
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={phase.kind !== "recording"}>
            {phase.kind === "saving" ? <Spinner className="text-on-accent" /> : <Square className="fill-current" />}
            {tr("actions-save")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2.5">
          <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-3">
            {phase.kind === "recording" ? <span className="size-2.5 animate-pulse rounded-full bg-[var(--danger)]" /> : <Spinner className="size-3.5" />}
          </span>
          <div className="min-w-0 flex-1" aria-live="polite">
            <p className="text-control font-medium text-ink">
              {phase.kind === "starting" ? trec("starting") : phase.kind === "saving" ? trec("saving") : title}
            </p>
            <p className="tabular text-caption text-ink-3">{time}</p>
          </div>
        </div>
        <div role="meter" aria-label={trec("level")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)} className="flex h-2 gap-[2px]">
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
      </div>
    </Dialog>
  );
}
