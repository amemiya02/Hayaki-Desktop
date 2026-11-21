// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AVTag } from "../anki/proto/anki/card_rendering_pb";
import { isPlaying, playTags, stopAudio } from "./audio";

class FakeUtterance {
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  voice: unknown = null;
  lang = "";
  rate = 1;
  constructor(public text: string) {}
}

const spoken: FakeUtterance[] = [];

const tts = (text: string) =>
  ({ value: { case: "tts", value: { fieldText: text, lang: "en_US", voices: [], speed: 0 } } }) as unknown as AVTag;

beforeEach(() => {
  spoken.length = 0;
  vi.stubGlobal("window", {
    speechSynthesis: { getVoices: () => [], speak: (u: FakeUtterance) => spoken.push(u), cancel: () => {} },
  });
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
});

afterEach(() => {
  stopAudio();
  vi.unstubAllGlobals();
});

describe("text to speech", () => {
  it("keeps speaking when a cancelled utterance reports its end late", async () => {
    void playTags([tts("first")]);
    expect(isPlaying()).toBe(true);
    void playTags([tts("second")]);
    expect(spoken).toHaveLength(2);
    spoken[0].onend?.();
    expect(isPlaying()).toBe(true);
    spoken[1].onend?.();
    expect(isPlaying()).toBe(false);
  });
});
