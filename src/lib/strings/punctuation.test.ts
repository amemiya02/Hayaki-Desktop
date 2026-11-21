// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { describe, expect, it } from "vitest";

// Chinese and Japanese strings use full-width punctuation. A half-width mark
// touching a CJK character is a slip; URLs, host:port and Anki's "::" Deck
// separator never touch one.
const CJK = String.raw`぀-ヿ㐀-鿿「」`;
const HALF = new RegExp(String.raw`[${CJK}](?<!::)[,;:?()](?!:)|(?<!:)[,;:?()](?!:)[${CJK}]`, "u");

function offenders(source: string): string[] {
  return (source.match(/"[^"\n]*"/g) ?? []).filter((literal) => HALF.test(literal));
}

describe("Chinese and Japanese strings", () => {
  const files = import.meta.glob<string>(["/src/lib/strings/*.ts", "!/src/lib/strings/*.test.ts", "/src/lib/strings.ts"], {
    query: "?raw",
    import: "default",
    eager: true,
  });

  it.each(Object.entries(files))("use full-width punctuation in %s", (_, source) => {
    expect(offenders(source)).toEqual([]);
  });

  it("flags a half-width comma between CJK characters but not a URL or a Deck path", () => {
    expect(offenders(`"运行,只能"`)).toHaveLength(1);
    expect(offenders(`"作者:{author}"`)).toHaveLength(1);
    expect(offenders(`"正在监听 127.0.0.1:{port}"`)).toEqual([]);
    expect(offenders(`"例如 日语::词汇。"`)).toEqual([]);
  });
});
