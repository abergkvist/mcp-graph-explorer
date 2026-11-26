import { Component, useEffect, useMemo, useState, type ReactNode } from "react";
import { mergeGraphs } from "@mcp-graph-explorer/normalizer/graph";
import type { GraphResult } from "@mcp-graph-explorer/normalizer";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cellText, DataTable } from "./components/data-table.tsx";
import { GraphCanvas } from "./components/graph-canvas.tsx";
import { NodeDetails } from "./components/node-details.tsx";
import { Toolbar } from "./components/toolbar.tsx";
import { useHost, type Host } from "./host.ts";
import type { LayoutName } from "./layouts.ts";
import { pickView, searchNodes, writeNote } from "./model.ts";
import type { Theme } from "./palette.ts";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function Message({ text, error }: { text: string; error?: boolean }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <p className={`max-w-prose text-center text-sm break-words ${error ? "text-destructive" : "text-muted-foreground"}`}>{text}</p>
    </div>
  );
}

interface ResultProps {
  result: GraphResult;
  theme: Theme;
  expand?: () => void;
  host: Pick<Host, "selectNode" | "expandNode">;
}

function Result({ result: initial, theme, expand, host }: ResultProps) {
  // Expanding adds to this copy; it is gone if the view is reloaded.
  const [result, setResult] = useState(initial);
  // Dev only: ?select=<node id> starts with a node selected, for visual checks.
  const [selected, setSelected] = useState<string | null>(import.meta.env.DEV ? new URLSearchParams(location.search).get("select") : null);
  const [expansion, setExpansion] = useState<{ busy?: boolean; error?: string }>({});
  const view = pickView(result);
  const [tab, setTab] = useState("graph");
  const node = result.nodes.find((n) => n.id === selected);
  const [query, setQuery] = useState("");
  const [layout, setLayout] = useState<LayoutName>("force");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const matches = useMemo(() => searchNodes(result.nodes, query), [result, query]);
  const toggle = (label: string) =>
    setHidden((current) => {
      const next = new Set(current);
      if (!next.delete(label)) next.add(label);
      return next;
    });

  const select = (id: string | null) => {
    setSelected(id);
    setExpansion({});
    host.selectNode(id);
  };
  const expandSelected = async (id: string) => {
    setExpansion({ busy: true });
    try {
      const extra = await host.expandNode(id);
      setResult((current) => mergeGraphs(current, extra));
      setExpansion({});
    } catch (error) {
      setExpansion({ error: error instanceof Error ? error.message : String(error) });
    }
  };
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
      {writeNote(result.meta) && view !== "empty" && <p className="border-b bg-muted px-3 py-1.5 text-xs">{writeNote(result.meta)}</p>}
      {view === "empty" && <Message text={writeNote(result.meta) ?? "No results"} />}
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
            <Toolbar
              result={result}
              theme={theme}
              query={query}
              onQuery={setQuery}
              matches={matches?.size}
              hidden={hidden}
              onToggle={toggle}
              layout={layout}
              onLayout={setLayout}
            />
            <GraphCanvas result={result} theme={theme} selected={selected} onSelect={select} highlight={matches} hidden={hidden} layout={layout} />
            {node && (
              <NodeDetails
                node={node}
                {...expansion}
                onExpand={() => void expandSelected(node.id)}
                onClose={() => select(null)}
              />
            )}
          </div>
          {tab === "table" && <DataTable table={result.table} />}
        </>
      )}
    </>
  );
}

/** React removes the whole tree on an uncaught error; show a message instead of an empty panel. */
class Fallback extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <Message text="This result can't be displayed" error /> : this.props.children;
  }
}

export function App() {
  const { state, frame, openInPanel, selectNode, expandNode } = useHost();
  // On the root element, so that the body, scrollbars and menus follow the theme too.
  useEffect(() => void document.documentElement.classList.toggle("dark", frame.theme === "dark"), [frame.theme]);
  return (
    <main className="flex flex-col overflow-hidden bg-background text-foreground" style={{ height: frame.height, padding: frame.padding }}>
      {state.kind === "loading" && <Message text="Running query…" />}
      {state.kind === "message" && <Message text={state.text} error={state.error} />}
      {state.kind === "result" && (
        <Fallback>
          <Result
            result={state.result}
            theme={frame.theme}
            expand={frame.canExpand ? openInPanel : undefined}
            host={{ selectNode, expandNode }}
          />
        </Fallback>
      )}
    </main>
  );
}
