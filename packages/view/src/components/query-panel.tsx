import { useState } from "react";
import type { ViewQuery } from "@mcp-graph-explorer/normalizer";
import { Button } from "@/components/ui/button";
import { editedQuery } from "../model.ts";
import { CodeEditor } from "./code-editor.tsx";

interface Props {
  /** Claude's query. */
  original: ViewQuery;
  /** Stays mounted while hidden, so that the drafts survive closing it. */
  hidden: boolean;
  onRun(query: ViewQuery): Promise<void>;
  onReset(): void;
}

const runKeys = /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘↵" : "Ctrl↵";

export function QueryPanel({ original, hidden, onRun, onReset }: Props) {
  const [answer, setAnswer] = useState(original.answer_query);
  const [context, setContext] = useState(original.context_query ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const query = editedQuery(original, answer, context);
  const params = Object.keys(original.params ?? {}).length ? JSON.stringify(original.params) : undefined;

  const run = async () => {
    if (busy || !query) return;
    setBusy(true);
    setError(undefined);
    try {
      await onRun(query);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };
  const reset = () => {
    setAnswer(original.answer_query);
    setContext(original.context_query ?? "");
    setError(undefined);
    onReset();
  };

  return (
    <section className={hidden ? "hidden" : "flex max-h-[45%] shrink-0 flex-col gap-2 border-b px-3 py-2"} aria-label="Cypher">
      <div className="flex min-h-0 flex-col gap-2 overflow-auto">
        <CodeEditor value={answer} onChange={setAnswer} onRun={() => void run()} label="Query" />
        {original.context_query !== undefined && (
          <>
            <p className="text-xs text-muted-foreground">Context query</p>
            <CodeEditor value={context} onChange={setContext} onRun={() => void run()} label="Context query" />
          </>
        )}
        {params && <p className="font-mono text-xs break-all text-muted-foreground">params {params}</p>}
        {error && <p role="alert" className="text-xs break-words whitespace-pre-wrap text-destructive">{error}</p>}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" disabled={busy} onClick={reset}>Reset</Button>
        <Button size="sm" disabled={busy || !query} onClick={() => void run()}>
          {busy ? "Running…" : `Run ${runKeys}`}
        </Button>
      </div>
    </section>
  );
}
