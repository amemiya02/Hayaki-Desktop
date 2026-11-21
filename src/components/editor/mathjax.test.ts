// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { describe, expect, it } from "vitest";

import { copiedMath, displayToMath, mathChip, mathSource, mathStored, mathToDisplay } from "./mathjax";

describe("MathJax chips", () => {
  it("round-trips inline, block and chemistry expressions", () => {
    for (const stored of [
      "a \\(x^2\\) b",
      "\\[\\frac{a}{b}\\]",
      "{{c1::\\(\\ce{H2O}\\)}} and \\(y\\)",
      "<div>\\(a &lt; b &amp;&amp; c\\)</div><br>",
      "\\(\\)",
    ]) {
      expect(displayToMath(mathToDisplay(stored))).toBe(stored);
    }
  });

  it("shows an expression as one atomic chip", () => {
    const display = mathToDisplay("\\(x\\)");
    expect(display).toContain('data-anki="mathjax"');
    expect(display).toContain('contenteditable="false"');
    expect(display).toContain('data-block="false"');
    expect(mathToDisplay("\\[x\\]")).toContain('data-block="true"');
  });

  it("leaves markup and text without math alone", () => {
    for (const stored of ["plain", '<a title="\\(x\\)">link</a>', "<b>bold</b>"]) {
      expect(mathToDisplay(stored)).toBe(stored);
      expect(displayToMath(stored)).toBe(stored);
    }
  });

  it("edits the unescaped source and stores it escaped", () => {
    expect(mathSource("a &lt; b")).toBe("a < b");
    expect(mathStored("a < b && c > d")).toBe("a &lt; b &amp;&amp; c &gt; d");
    expect(displayToMath(mathChip(mathStored("a<b"), false))).toBe("\\(a&lt;b\\)");
  });

  it("never turns text inside a tag into a chip, even after a `>` in a quoted attribute", () => {
    for (const stored of ['<img alt="a > \\(x\\)">', "<img alt='a > \\(x\\)'>", '<a title="1 > 0" href="\\[y\\]">t</a>']) {
      expect(mathToDisplay(stored)).toBe(stored);
    }
    expect(mathToDisplay('<img alt="a > b">\\(x\\)')).toContain('data-anki="mathjax"');
  });

  it("decodes only &lt; &gt; &amp; when reading source", () => {
    expect(mathSource("a &lt; b &amp;amp; &nbsp; &quot;")).toBe("a < b &amp; &nbsp; &quot;");
    const stored = "&nbsp;x&quot;";
    expect(displayToMath(mathToDisplay(`\\(${stored}\\)`))).toBe(`\\(${stored}\\)`);
  });

  it("copies chips in their stored form, delimiters included", () => {
    const chip = mathChip("a &lt; b", false);
    const copied = copiedMath(`x ${chip}<div>${mathChip("y", true)}</div>`);
    expect(copied?.html).toBe("x \\(a &lt; b\\)<div>\\[y\\]</div>");
    expect(copied?.text).toBe("x \\(a < b\\)\n\\[y\\]");
    expect(copiedMath("plain <b>text</b>")).toBeNull();
  });
});
