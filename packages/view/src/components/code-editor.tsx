import { useEffect, useRef } from "react";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { cypher } from "@codemirror/legacy-modes/mode/cypher";
import { EditorState, Prec } from "@codemirror/state";
import { drawSelection, EditorView, keymap, lineNumbers } from "@codemirror/view";
import { tags } from "@lezer/highlight";

// Colours are CSS variables, so the editor follows the theme by itself.
const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--syntax-keyword)", fontWeight: "600" },
  { tag: [tags.string, tags.atom], color: "var(--syntax-string)" },
  { tag: [tags.standard(tags.variableName), tags.definition(tags.variableName)], color: "var(--syntax-builtin)" },
  { tag: tags.comment, color: "var(--muted-foreground)", fontStyle: "italic" },
]);

const chrome = EditorView.theme({
  "&": { fontSize: "12px", border: "1px solid var(--input)", borderRadius: "var(--radius)" },
  "&.cm-focused": { outline: "2px solid var(--ring)", outlineOffset: "-1px" },
  ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
  ".cm-content": { caretColor: "var(--foreground)" },
  ".cm-cursor": { borderLeftColor: "var(--foreground)" },
  ".cm-gutters": { backgroundColor: "var(--muted)", color: "var(--muted-foreground)", borderRight: "1px solid var(--border)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground": { backgroundColor: "var(--selection)" },
});

interface Props {
  value: string;
  onChange(value: string): void;
  /** Mod-Enter */
  onRun(): void;
  label: string;
}

export function CodeEditor({ value, onChange, onRun, label }: Props) {
  const element = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView>(null);
  // The editor is created once; it calls whatever handlers are current.
  const handlers = useRef({ onChange, onRun });
  handlers.current = { onChange, onRun };

  useEffect(() => {
    editor.current = new EditorView({
      parent: element.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          // Before the default keymap, which uses Mod-Enter to insert a line.
          Prec.highest(keymap.of([{ key: "Mod-Enter", run: () => (handlers.current.onRun(), true) }])),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          lineNumbers(),
          history(),
          drawSelection(),
          EditorView.lineWrapping,
          StreamLanguage.define(cypher),
          syntaxHighlighting(highlight),
          chrome,
          EditorView.contentAttributes.of({ "aria-label": label }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) handlers.current.onChange(update.state.doc.toString());
          }),
        ],
      }),
    });
    return () => editor.current?.destroy();
  }, []);

  useEffect(() => {
    const view = editor.current!;
    const current = view.state.doc.toString();
    if (value !== current) view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  return <div ref={element} />;
}
