// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Plays a Card's sounds and text-to-speech tags in order, like Anki's AV
 * player (`aqt/sound.py`): one queue, pause and seek on what is playing, and
 * an option to let a new side's sounds wait for the current one instead of
 * interrupting it.
 */
import { convertFileSrc } from "@tauri-apps/api/core";

import type { AVTag, TTSTag } from "../anki/proto/anki/card_rendering_pb";

export function mediaUrl(filename: string): string {
  return convertFileSrc(filename, "media");
}

/** The card page's address; it shares the media origin, never the app's. */
export function cardPageUrl(): string {
  return convertFileSrc("_hayaki/card.html", "media").replace("_hayaki%2Fcard.html", "_hayaki/card.html");
}

let generation = 0;
let current: HTMLAudioElement | null = null;
let speaking = false;
/** Settles when the sound or speech now playing ends or is stopped. */
let currentDone: Promise<void> = Promise.resolve();
const idleListeners = new Set<() => void>();

function stopCurrent(): void {
  if (current) {
    const audio = current;
    current = null;
    audio.pause();
    audio.dispatchEvent(new Event("ended"));
    audio.src = "";
  }
  if (speaking && typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  speaking = false;
}

function notifyIdle(): void {
  for (const listener of [...idleListeners]) listener();
}

/** Whether a sound or speech is playing or paused. */
export function isPlaying(): boolean {
  return current !== null || speaking;
}

/** Calls back each time the queue runs out or is stopped. */
export function onAudioIdle(listener: () => void): () => void {
  idleListeners.add(listener);
  return () => idleListeners.delete(listener);
}

export function stopAudio(): void {
  generation++;
  stopCurrent();
  notifyIdle();
}

function playSource(src: string, token: number): Promise<void> {
  if (token !== generation) return Promise.resolve();
  const done = new Promise<void>((resolve) => {
    const audio = new Audio(src);
    current = audio;
    const finish = () => {
      if (current === audio) current = null;
      resolve();
    };
    audio.addEventListener("ended", finish, { once: true });
    audio.addEventListener("error", finish, { once: true });
    audio.play().catch(finish);
  });
  currentDone = done;
  return done;
}

function speak(tag: TTSTag, token: number): Promise<void> {
  if (token !== generation || !("speechSynthesis" in window)) return Promise.resolve();
  const done = new Promise<void>((resolve) => {
    const utterance = new SpeechSynthesisUtterance(tag.fieldText.replace(/<[^>]+>/g, ""));
    utterance.lang = tag.lang.replace("_", "-");
    if (tag.speed > 0) utterance.rate = tag.speed;
    const voices = window.speechSynthesis.getVoices();
    const wanted = tag.voices.map((v) => v.toLowerCase());
    const voice =
      voices.find((v) => wanted.includes(v.name.toLowerCase())) ??
      voices.find((v) => v.lang.toLowerCase() === utterance.lang.toLowerCase());
    if (voice) utterance.voice = voice;
    const finish = () => {
      speaking = false;
      resolve();
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    speaking = true;
    window.speechSynthesis.speak(utterance);
  });
  currentDone = done;
  return done;
}

async function run(items: (AVTag | { url: string })[], interrupt: boolean): Promise<void> {
  const token = ++generation;
  if (interrupt) stopCurrent();
  else await currentDone;
  for (const item of items) {
    if (token !== generation) return;
    if ("url" in item) await playSource(item.url, token);
    else if (item.value.case === "soundOrVideo") await playSource(mediaUrl(item.value.value), token);
    else if (item.value.case === "tts") await speak(item.value.value, token);
  }
  if (token === generation) notifyIdle();
}

export interface PlayOptions {
  /** Stop what is playing first (the default), or let it finish. */
  interrupt?: boolean;
}

/** Replaces the queue with these tags and plays them one after another. */
export function playTags(tags: AVTag[], { interrupt = true }: PlayOptions = {}): Promise<void> {
  return run(tags, interrupt);
}

/** Plays one file from any address, such as a recording held in memory. */
export function playUrl(url: string): Promise<void> {
  return run([{ url }], true);
}

/** Anki's Pause Audio: pauses or resumes what is playing. */
export function togglePause(): void {
  if (current) {
    if (current.paused) void current.play().catch(() => undefined);
    else current.pause();
  } else if (speaking) {
    if (window.speechSynthesis.paused) window.speechSynthesis.resume();
    else window.speechSynthesis.pause();
  }
}

/** Moves the playing sound by a number of seconds. */
export function seekRelative(secs: number): void {
  if (!current) return;
  const duration = Number.isFinite(current.duration) ? current.duration : Infinity;
  current.currentTime = Math.min(duration, Math.max(0, current.currentTime + secs));
}
