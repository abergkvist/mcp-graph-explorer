import { useState } from "react";
import type { GraphResult } from "@mcp-graph-explorer/normalizer";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cellText, DataTable } from "./components/data-table.tsx";
import { GraphCanvas } from "./components/graph-canvas.tsx";
import { useHost } from "./host.ts";
import { pickView } from "./model.ts";
import type { Theme } from "./palette.ts";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function Message({ text, error }: { text: string; error?: boolean }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <p className={`max-w-prose text-center text-sm break-words ${error ? "text-destructive" : "text-muted-foreground"}`}>{text}</p>
    </div>
  );
}

function Result({ result, theme, expand }: { result: GraphResult; theme: Theme; expand?: () => void }) {
  const view = pickView(result);
  const [tab, setTab] = useState("graph");
  const showTabs = view === "graph" && result.table.columns.length > 0;
  const summary =
    view === "graph"
      ? `${plural(result.nodes.length, "node")}, ${plural(result.edges.length, "relationship")}`
      : view === "table" ? plural(result.table.rows.length, "row") : "";

  return (
    <>
      <header className="flex min-h-11 flex-wrap items-center gap-3 border-b px-3 py-1.5">
        {showTabs && (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="h-8">
              <TabsTrigger value="graph">Graph</TabsTrigger>
              <TabsTrigger value="table">Table</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
        <span className="text-xs text-muted-foreground tabular-nums">{summary}</span>
        {expand && (
          <Button variant="outline" size="sm" className="ml-auto" onClick={expand}>Open in panel</Button>
        )}
      </header>
      {result.meta.truncated.length > 0 && (
        <p className="border-b bg-muted px-3 py-1.5 text-xs">Result truncated: {result.meta.truncated.join(", ")}</p>
      )}
      {view === "empty" && <Message text="No results" />}
      {view === "value" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 p-6">
          <p className="max-w-full text-5xl font-semibold tracking-tight break-words tabular-nums">{cellText(result.table.rows[0]![0]!)}</p>
          <p className="text-sm text-muted-foreground">{result.table.columns[0]}</p>
        </div>
      )}
      {view === "table" && <DataTable table={result.table} />}
      {view === "graph" && (
        <>
          {/* Kept mounted so the layout and camera survive a visit to the table tab. */}
          <div className={tab === "graph" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
            <GraphCanvas result={result} theme={theme} />
          </div>
          {tab === "table" && <DataTable table={result.table} />}
        </>
      )}
    </>
  );
}

export function App() {
  const { state, frame, openInPanel } = useHost();
  return (
    <div className={frame.theme === "dark" ? "dark" : undefined}>
      <main className="flex flex-col overflow-hidden bg-background text-foreground" style={{ height: frame.height, padding: frame.padding }}>
        {state.kind === "loading" && <Message text="Running query…" />}
        {state.kind === "message" && <Message text={state.text} error={state.error} />}
        {state.kind === "result" && <Result result={state.result} theme={frame.theme} expand={frame.canExpand ? openInPanel : undefined} />}
      </main>
    </div>
  );
}
