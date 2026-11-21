// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { describe, expect, it } from "vitest";

import type { CardFrameContent } from "@/components/CardFrame";
import { cssProblem, decodeCss, withInjections } from "./injection";

const content: CardFrameContent = {
  html: "<p>Q</p>",
  css: ".card{}",
  bodyClass: "card",
  side: "question",
  frame: { dark: false, vars: {}, dir: "ltr", lang: "en" },
};

describe("card injection", () => {
  it("refuses CSS that could load from anywhere", () => {
    for (const css of [
      "a{background:url(https://e.example/x)}",
      "a{background:URL ( 'x' )}",
      "@import 'https://e.example/x.css';",
      "a{background-image:image-set('https://e.example/x' 1x)}",
      "a{background:u\\72l(https://e.example)}",
      "a{background:image('https://e.example/x')}",
      "a{background:\\75 \\72 \\6c(https://e.example)}",
      "a{background:\\000075rl(https://e.example)}",
      'a{content:"/*";background:url(https://e.example);content:"*/"}',
      "@\\69mport 'https://e.example/x.css';",
      "@font-face{font-family:x;src:src('https://e.example/f.woff')}",
      "a{background:-webkit-image-set('x' 1x)}",
    ]) {
      expect(cssProblem(css), css).not.toBeNull();
    }
    expect(cssProblem(".streak{color:var(--accent);font-weight:600}")).toBeNull();
  });

  it("allows escapes that spell nothing that loads", () => {
    for (const css of [
      '.q::before{content:"\\201C"}',
      '.q::after{content:"\\201D "}',
      ".\\31 0x{color:red}",
      '.a::before{content:"\\"quoted\\""}',
    ]) {
      expect(cssProblem(css), css).toBeNull();
    }
    expect(decodeCss('"\\201C"')).toBe('"\u201C"');
    expect(decodeCss("\\31 0")).toBe("10");
    expect(decodeCss("\\0")).toBe("\ufffd");
  });

  it("adds every plugin's CSS and HTML after the Card's own", () => {
    expect(withInjections(content, {})).toBe(content);
    const out = withInjections(content, { a: { css: ".a{}", html: "<b>A</b>" }, b: { css: "", html: "<i>B</i>" } });
    expect(out.css).toBe(".card{}\n.a{}");
    expect(out.html).toBe('<p>Q</p><div class="hayaki-plugins"><b>A</b><i>B</i></div>');
  });
});
