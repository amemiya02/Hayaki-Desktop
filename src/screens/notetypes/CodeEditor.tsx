// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * A CodeMirror 6 editor for Card Templates and styling, themed with the
 * app's tokens, with field-name completion inside `{{ }}`.
 */
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState } from "@codemirror/state";
import {
  Decoration,
  drawSelection,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  type DecorationSet,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder as placeholderExt,
  type ViewUpdate,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

import { cn } from "@/components/ui";

import { fieldContext, fieldOptions } from "./completion";

export interface CodeEditorHandle {
  /** Inserts text at the cursor (replacing the selection) and focuses the editor. */
  insert(text: string): void;
  focus(): void;
}

const theme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--surface)",
    color: "var(--ink)",
    fontSize: "12.5px",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.6" },
  ".cm-content": { caretColor: "var(--accent)", padding: "8px 0" },
  ".cm-line": { padding: "0 12px 0 8px" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--selection) !important",
  },
  ".cm-activeLine": { backgroundColor: "var(--accent-softer)" },
  ".cm-gutters": {
    backgroundColor: "var(--surface-2)",
    color: "var(--ink-3)",
    borderRight: "1px solid var(--line)",
  },
  ".cm-activeLineGutter": { backgroundColor: "var(--accent-softer)", color: "var(--ink-2)" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 12px", minWidth: "36px" },
  "&.cm-focused .cm-matchingBracket": { backgroundColor: "var(--accent-soft)", outline: "none" },
  ".cm-placeholder": { color: "var(--ink-3)" },
  ".cm-tooltip": {
    backgroundColor: "var(--raised)",
    border: "1px solid var(--line)",
    borderRadius: "10px",
    boxShadow: "var(--shadow-pop)",
    overflow: "hidden",
    padding: "4px",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": { fontFamily: "var(--font-ui)", fontSize: "13px", maxHeight: "16em" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
    padding: "4px 10px",
    borderRadius: "6px",
    color: "var(--ink)",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    backgroundColor: "var(--accent-soft)",
    color: "var(--ink)",
  },
  ".cm-completionDetail": { color: "var(--ink-3)", fontStyle: "normal", marginLeft: "12px" },
  ".cm-completionIcon": { display: "none" },
  ".cm-completionMatchedText": { textDecoration: "none", fontWeight: "600" },
});

const highlight = HighlightStyle.define([
  { tag: [tags.tagName, tags.angleBracket], color: "var(--count-new)" },
  { tag: tags.attributeName, color: "var(--answer-hard)" },
  { tag: [tags.attributeValue, tags.string], color: "var(--count-due)" },
  { tag: tags.comment, color: "var(--ink-3)" },
  { tag: [tags.className, tags.propertyName], color: "var(--count-new)" },
  { tag: [tags.number, tags.unit, tags.color, tags.atom, tags.keyword], color: "var(--count-learn)" },
  { tag: [tags.definitionKeyword, tags.modifier, tags.operatorKeyword], color: "var(--accent-ink)" },
  { tag: tags.invalid, color: "var(--danger)" },
]);

/** Marks `{{…}}` replacements so they stand out from the HTML around them. */
const replacementTheme = EditorView.theme({
  ".cm-hayaki-field": { color: "var(--accent-ink)", fontWeight: "600" },
});

function fieldCompletion(getFields: () => string[]) {
  return (context: CompletionContext): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos);
    const before = line.text.slice(0, context.pos - line.from);
    const after = line.text.slice(context.pos - line.from);
    const found = fieldContext(before, after);
    if (!found) return null;
    const inside = before.slice(before.lastIndexOf("{{") + 2);
    const withFilters = !inside.replace(/^[#^/]/, "").includes(":") && !/^[#^/]/.test(inside);
    const options = fieldOptions(getFields(), found.typed, withFilters);
    if (!options.length) return null;
    return {
      from: line.from + found.from,
      to: context.pos,
      filter: false,
      options: options.map((option) => ({
        label: option.label,
        type: option.kind === "filter" ? "keyword" : "variable",
        apply:
          option.kind === "filter" || found.closed
            ? option.label
            : (view: EditorView, _c: unknown, from: number, to: number) => {
                view.dispatch({
                  changes: { from, to, insert: `${option.label}}}` },
                  selection: { anchor: from + option.label.length + 2 },
                });
              },
      })),
    };
  };
}

const fieldMatcher = new MatchDecorator({
  regexp: /\{\{[^{}]*\}\}/g,
  decoration: Decoration.mark({ class: "cm-hayaki-field" }),
});

const fieldMarks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = fieldMatcher.createDeco(view);
    }
    update(update: ViewUpdate) {
      this.decorations = fieldMatcher.updateDeco(update, this.decorations);
    }
  },
  { decorations: (v) => v.decorations },
);

interface Props {
  value: string;
  onChange: (value: string) => void;
  language: "html" | "css";
  fields?: string[];
  label: string;
  placeholder?: string;
  className?: string;
}

export const CodeEditor = forwardRef<CodeEditorHandle, Props>(function CodeEditor(
  { value, onChange, language, fields = [], label, placeholder, className },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;
  const languageSlot = useRef(new Compartment());
  const labelSlot = useRef(new Compartment());

  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        highlightActiveLine(),
        EditorView.lineWrapping,
        autocompletion({ activateOnTyping: true, icons: false }),
        EditorState.languageData.of(() => [{ autocomplete: fieldCompletion(() => fieldsRef.current) }]),
        keymap.of([...closeBracketsKeymap, ...defaultKeymap.filter((binding) => binding.key !== "Mod-Enter"), ...historyKeymap, ...completionKeymap, indentWithTab]),
        languageSlot.current.of(language === "html" ? html({ autoCloseTags: false }) : css()),
        labelSlot.current.of(EditorView.contentAttributes.of({ "aria-label": label })),
        syntaxHighlighting(highlight),
        fieldMarks,
        replacementTheme,
        theme,
        placeholder ? placeholderExt(placeholder) : [],
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString());
        }),
      ],
    });
    const created = new EditorView({ state, parent: host.current });
    view.current = created;
    return () => {
      created.destroy();
      view.current = null;
    };
    // The editor is created once; later props are applied below.
  }, []);

  // Outside changes (switching Card Template, Flip) replace the document.
  useEffect(() => {
    const current = view.current;
    if (!current) return;
    if (current.state.doc.toString() !== value) {
      current.dispatch({ changes: { from: 0, to: current.state.doc.length, insert: value } });
    }
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({
      effects: languageSlot.current.reconfigure(language === "html" ? html({ autoCloseTags: false }) : css()),
    });
  }, [language]);

  useEffect(() => {
    view.current?.dispatch({
      effects: labelSlot.current.reconfigure(EditorView.contentAttributes.of({ "aria-label": label })),
    });
  }, [label]);

  useImperativeHandle(
    ref,
    () => ({
      insert(text) {
        const current = view.current;
        if (!current) return;
        const { from, to } = current.state.selection.main;
        current.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, scrollIntoView: true });
        current.focus();
      },
      focus() {
        view.current?.focus();
      },
    }),
    [],
  );

  return (
    <div
      ref={host}
      className={cn(
        "min-h-0 overflow-hidden rounded-[10px] border border-line bg-surface transition-[border-color,box-shadow] duration-[var(--dur-fast)]",
        "focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--accent-soft)]",
        className,
      )}
    />
  );
});
