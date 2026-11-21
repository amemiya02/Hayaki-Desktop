// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { describe, expect, it } from "vitest";

import { carryFields, clozeNumbersIn, clozeSurround, mathSurround, nextClozeNumber, surroundText } from "./markup";
import { displayToField, fieldToDisplay, isLocalMediaName, mediaReference, normalizeEmpty } from "./media-src";
import { htmlToText, sanitizeHtml, textToHtml } from "./sanitize";
import { addTags, normalizeTag, splitTags, tagLevels } from "./tags";

const PREFIX = "http://media.localhost/";
const urlFor = (name: string) => PREFIX + encodeURIComponent(name);

describe("media src", () => {
  it("shows bare filenames from the media origin", () => {
    expect(fieldToDisplay('<img src="cat.jpg">', urlFor)).toBe(`<img src="${PREFIX}cat.jpg">`);
    expect(fieldToDisplay("<img src='猫 1.png' alt=x>", urlFor)).toBe(`<img src="${PREFIX}%E7%8C%AB%201.png" alt=x>`);
    expect(fieldToDisplay("<IMG class=a SRC=dog.gif>", urlFor)).toBe(`<IMG class=a SRC="${PREFIX}dog.gif">`);
  });

  it("leaves URLs and other attributes alone", () => {
    const html = '<img src="https://example.com/a.png"><img src="data:image/png;base64,AA=="><a href="x.jpg">x</a>';
    expect(fieldToDisplay(html, urlFor)).toBe(html);
    expect(fieldToDisplay('<img data-src="a.jpg">', urlFor)).toBe('<img data-src="a.jpg">');
    expect(isLocalMediaName("/abs.png")).toBe(false);
    expect(isLocalMediaName("a.png")).toBe(true);
  });

  it("round-trips back to bare filenames", () => {
    for (const stored of ['<img src="cat.jpg">', '<img src="a&amp;b 猫%.png">', '<div>x<img src="q.svg" alt="y"></div>']) {
      expect(displayToField(fieldToDisplay(stored, urlFor), PREFIX)).toBe(stored);
    }
  });

  it("never saves a media URL", () => {
    expect(displayToField(`<img src="${PREFIX}cat%20x.jpg">`, PREFIX)).toBe('<img src="cat x.jpg">');
    expect(displayToField('<img src="https://example.com/a.png">', PREFIX)).toBe('<img src="https://example.com/a.png">');
  });

  it("normalizes emptied fields and builds references", () => {
    expect(normalizeEmpty("<br>")).toBe("");
    expect(normalizeEmpty("a<br>")).toBe("a<br>");
    expect(mediaReference("a.png")).toBe('<img src="a.png">');
    expect(mediaReference("a.mp3")).toBe("[sound:a.mp3]");
  });
});

describe("sanitize", () => {
  it("removes scripts, styles and handlers", () => {
    expect(sanitizeHtml("<script>alert(1)</script>hi")).toBe("hi");
    expect(sanitizeHtml("<div><style>p{}</style>hello</div>")).toBe("<div>hello</div>");
    expect(sanitizeHtml('<p onclick="alert(1)">hi</p>')).toBe("<div>hi</div>");
    expect(sanitizeHtml('<img src="a.png" onerror="alert(1)">')).toBe('<img src="a.png">');
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).toBe("<a>x</a>");
    expect(sanitizeHtml("<iframe src=x><b>no</b></iframe>ok")).toBe("ok");
  });

  it("keeps basic formatting and unwraps the rest", () => {
    expect(sanitizeHtml("<b>bold</b> <i>it</i> <u>u</u><br>")).toBe("<b>bold</b> <i>it</i> <u>u</u><br>");
    expect(sanitizeHtml('<html><body><!--StartFragment--><o:p>x</o:p><section class="z">y</section></body></html>')).toBe("xy");
    expect(sanitizeHtml('<ul><li>a<li>b</ul>')).toBe("<ul><li>a<li>b</li></li></ul>");
  });

  it("keeps only colour and emphasis styles", () => {
    expect(sanitizeHtml('<span style="color: red; font-size: 40px; background-color: transparent">r</span>')).toBe(
      '<span style="color: red">r</span>',
    );
    expect(sanitizeHtml('<span style="font-size: 9px">x</span>')).toBe("<span>x</span>");
    expect(sanitizeHtml('<span style="color: red; background: url(x)"></span>')).toBe("");
  });

  it("drops unsafe data URLs but keeps images", () => {
    expect(sanitizeHtml('<img src="data:text/html;base64,AA">')).toBe("");
    expect(sanitizeHtml('<img src="data:image/png;base64,AA">')).toBe('<img src="data:image/png;base64,AA">');
  });

  it("closes what it opened and drops stray closers", () => {
    expect(sanitizeHtml("<b>a")).toBe("<b>a</b>");
    expect(sanitizeHtml("a</b>c")).toBe("ac");
  });

  it("turns text into HTML and back", () => {
    expect(textToHtml("a < b\nc & d")).toBe("a &lt; b<br>c &amp; d");
    expect(htmlToText("<div>Hello&nbsp;</div><b>w&amp;rld</b>[sound:x.mp3]")).toBe("Hello w&rld");
  });
});

describe("cloze and MathJax", () => {
  it("reads cloze numbers across fields", () => {
    expect(clozeNumbersIn(["{{c1::a}} {{c3::b}}", "{{c2::c}}", "none"])).toEqual([1, 2, 3]);
    expect(clozeNumbersIn(["{{c1::a{{c4::b}}}}"])).toEqual([1, 4]);
  });

  it("chooses the next or the same number", () => {
    expect(nextClozeNumber([], true)).toBe(1);
    expect(nextClozeNumber([], false)).toBe(1);
    expect(nextClozeNumber([1, 2], true)).toBe(3);
    expect(nextClozeNumber([1, 2], false)).toBe(2);
    expect(clozeSurround(2)).toEqual({ prefix: "{{c2::", suffix: "}}" });
  });

  it("wraps plain text and places the selection inside", () => {
    expect(surroundText("hello world", 6, 11, clozeSurround(1))).toEqual({
      text: "hello {{c1::world}}",
      selectionStart: 12,
      selectionEnd: 17,
    });
    expect(surroundText("x", 1, 1, mathSurround("inline"))).toEqual({ text: "x\\(\\)", selectionStart: 3, selectionEnd: 3 });
    expect(mathSurround("block")).toEqual({ prefix: "\\[", suffix: "\\]" });
  });

  it("wraps LaTeX like Anki's Ctrl+T chords", () => {
    expect(mathSurround("latex")).toEqual({ prefix: "[latex]", suffix: "[/latex]" });
    expect(mathSurround("latexEquation")).toEqual({ prefix: "[$]", suffix: "[/$]" });
    expect(mathSurround("latexMathEnv")).toEqual({ prefix: "[$$]", suffix: "[/$$]" });
  });
});

describe("carry fields between Note Types", () => {
  it("keeps same-named fields and carries others by position", () => {
    expect(carryFields(["Front", "Back"], ["f", "b"], ["Text", "Back Extra"], ["", ""])).toEqual(["f", "b"]);
    expect(carryFields(["Front", "Back"], ["f", "b"], ["Back", "Front", "Extra"], ["", "", ""])).toEqual(["b", "f", ""]);
    expect(carryFields(["Front", "Back"], ["f", "b"], ["Text", "Front"], ["", ""])).toEqual(["", "f"]);
  });
});

describe("tags", () => {
  it("normalizes and splits", () => {
    expect(normalizeTag(" lang::ja ")).toBe("lang::ja");
    expect(normalizeTag("a:::b::")).toBe("a::b");
    expect(splitTags("a  b　c")).toEqual(["a", "b", "c"]);
    expect(tagLevels("lang::ja::verbs")).toEqual(["lang", "ja", "verbs"]);
  });

  it("adds without case-insensitive duplicates", () => {
    expect(addTags(["Vocab"], ["vocab", "grammar", "grammar"])).toEqual(["Vocab", "grammar"]);
  });
});
