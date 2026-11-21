// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { describe, expect, it } from "vitest";

import { methodNumbers } from "../anki/generated/core";
import { CORE_ACCESS, coreAccess } from "./permissions";
import { methodSchemas } from "./schemas";

describe("the core permission table", () => {
  it("classifies every generated core method, and nothing else", () => {
    const generated = Object.keys(methodNumbers).sort();
    expect(Object.keys(CORE_ACCESS).sort()).toEqual(generated);
  });

  it("has request and response schemas for every core method", () => {
    const missing = Object.keys(methodNumbers).filter((name) => !methodSchemas(name));
    expect(missing).toEqual([]);
  });

  it("denies methods it does not know", () => {
    expect(coreAccess("someFutureMethod")).toBe("deny");
    expect(coreAccess("toString")).toBe("deny");
    expect(coreAccess("__proto__")).toBe("deny");
  });

  it("denies the collection's lifecycle, sync, logins, raw SQL and file access", () => {
    for (const name of [
      "openCollection",
      "closeCollection",
      "syncCollection",
      "syncMedia",
      "syncLogin",
      "fullUploadOrDownload",
      "setWantsAbort",
      "importCollectionPackage",
      "exportCollectionPackage",
      "importAnkiPackage",
      "exportAnkiPackage",
      "importCsv",
      "exportNoteCsv",
      "addMediaFromPath",
      "addMediaFromUrl",
      "runDbCommand",
      "ankihubLogin",
      "readClipboard",
    ]) {
      expect(coreAccess(name), name).toBe("deny");
    }
    expect(coreAccess("getCard")).toBe("read");
    expect(coreAccess("answerCard")).toBe("write");
  });
});
