import { describe, expect, it } from "vitest";

/**
 * The window takes file drops itself (`dragDropEnabled: true` in
 * src-tauri/tauri.conf.json), so HTML5 drag and drop never fires in the app:
 * `draggable`, `onDragStart`, `onDragOver`, `onDrop` and `dataTransfer` do
 * nothing there, and a drag built on them looks fine in code and fails in use.
 * In-app dragging uses the pointer-driven module src/lib/pointer-drag.ts.
 */
const files = import.meta.glob<string>(["/src/**/*.{ts,tsx}", "!/src/lib/anki/generated/**", "!/src/lib/anki/proto/**"], {
  query: "?raw",
  import: "default",
  eager: true,
});

/** Files that may use HTML5 drag events, with the reason each is safe. */
const ALLOWED: Record<string, string> = {
  "components/editor/RichTextInput.tsx":
    "Drags that stay inside the editable field (selected text, pasted HTML) are handled by the browser; OS file drops arrive through Tauri's drag-drop event in FieldsEditor.tsx.",
};

const FORBIDDEN: [string, RegExp][] = [
  // `draggable` as a JSX attribute or property: anything but `false`.
  ["draggable set to a truthy value", /\bdraggable\s*=\s*(?!\{?\s*false\b|["']false["'])/],
  ["bare draggable attribute", /\sdraggable(?=\s+[A-Za-z]+=|\s*\/?>|[ \t]*$)/m],
  ["draggable set through setAttribute", /["']draggable["']\s*,\s*["']?true/],
  ["onDragStart", /\bonDragStart\b/],
  ["onDragOver", /\bonDragOver\b/],
  ["onDrop", /\bonDrop\b/],
  ["dataTransfer", /\bdataTransfer\b/],
];

/** Comments and prose may mention the words; only code counts. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("no HTML5 drag and drop", () => {
  it("is not used outside the allow-list", () => {
    const found: string[] = [];
    for (const [path, raw] of Object.entries(files)) {
      const name = path.replace(/^\/src\//, "");
      if (name in ALLOWED) continue;
      const text = stripComments(raw);
      for (const [what, pattern] of FORBIDDEN) if (pattern.test(text)) found.push(`src/${name}: ${what}`);
    }
    expect(
      found,
      [
        "HTML5 drag and drop never fires in this app: src-tauri/tauri.conf.json sets `dragDropEnabled: true`,",
        "so the window takes drops itself and `draggable`, onDragStart, onDragOver, onDrop and dataTransfer do nothing.",
        "Drag with the pointer-driven module src/lib/pointer-drag.ts instead (see src/screens/notetypes/field-drag.ts",
        "for a reorderable list and src/screens/decks/drag.ts for a tree). `draggable={false}` is fine.",
        "If a use is safe (it stays inside the webview and needs no OS drop), add the file to ALLOWED with the reason.",
      ].join("\n"),
    ).toEqual([]);
  });

  it("keeps every allow-list entry pointing at a file that exists", () => {
    for (const name of Object.keys(ALLOWED)) expect(`/src/${name}` in files, `${name} is in ALLOWED but missing`).toBe(true);
  });
});
