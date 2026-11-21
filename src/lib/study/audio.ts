// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** Plays a Card's sounds and text-to-speech tags in order, like Anki's AV player. */
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

export function stopAudio(): void {
  generation++;
  if (current) {
    current.pause();
    current.src = "";
    current = null;
  }
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

function playFile(filename: string, token: number): Promise<void> {
  return new Promise((resolve) => {
    if (token !== generation) return resolve();
    const audio = new Audio(mediaUrl(filename));
    current = audio;
    audio.addEventListener("ended", () => resolve(), { once: true });
    audio.addEventListener("error", () => resolve(), { once: true });
    audio.play().catch(() => resolve());
  });
}

function speak(tag: TTSTag, token: number): Promise<void> {
  return new Promise((resolve) => {
    if (token !== generation || !("speechSynthesis" in window)) return resolve();
    const utterance = new SpeechSynthesisUtterance(tag.fieldText.replace(/<[^>]+>/g, ""));
    utterance.lang = tag.lang.replace("_", "-");
    if (tag.speed > 0) utterance.rate = tag.speed;
    const voices = window.speechSynthesis.getVoices();
    const wanted = tag.voices.map((v) => v.toLowerCase());
    const voice =
      voices.find((v) => wanted.includes(v.name.toLowerCase())) ??
      voices.find((v) => v.lang.toLowerCase() === utterance.lang.toLowerCase());
    if (voice) utterance.voice = voice;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.speak(utterance);
  });
}

/** Stops whatever is playing, then plays the tags one after another. */
export async function playTags(tags: AVTag[]): Promise<void> {
  stopAudio();
  const token = generation;
  for (const tag of tags) {
    if (token !== generation) return;
    if (tag.value.case === "soundOrVideo") await playFile(tag.value.value, token);
    else if (tag.value.case === "tts") await speak(tag.value.value, token);
  }
}
