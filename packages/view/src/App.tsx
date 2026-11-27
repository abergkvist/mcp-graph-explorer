import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { mergeGraphs } from "@mcp-graph-explorer/normalizer/graph";
import type { GraphResult, ViewQuery } from "@mcp-graph-explorer/normalizer";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cellText, DataTable } from "./components/data-table.tsx";
import { EdgeDetails } from "./components/edge-details.tsx";
import { GraphCanvas } from "./components/graph-canvas.tsx";
import { NodeDetails } from "./components/node-details.tsx";
import { QueryPanel } from "./components/query-panel.tsx";
import { Toolbar } from "./components/toolbar.tsx";
import { useHost, type Host } from "./host.ts";
import { hasCoordinates, type LayoutName } from "./layouts.ts";
import { modelContext, pickView, searchNodes, writeNote, type Selection } from "./model.ts";
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
  host: Pick<Host, "selectNode" | "shareContext" | "expandNode">;
  /** The result shown is that of the user's own run. */
  userRan?: boolean;
  editor?: { original: ViewQuery; run(query: ViewQuery): Promise<void>; reset(): void };
}

function Result({ result: given, theme, expand, host, userRan = false, editor }: ResultProps) {
  // Expanding adds to this copy; it is gone if the view is reloaded.
  const [result, setResult] = useState(given);
  // Dev only: ?select=<node id> starts with a node selected, for visual checks.
  const [selected, setSelected] = useState<Selection | null>(() => {
    const id = import.meta.env.DEV ? new URLSearchParams(location.search).get("select") : null;
    return id ? { kind: "node", id } : null;
  });
  const [expansion, setExpansion] = useState<{ busy?: boolean; error?: string }>({});
  const [tab, setTab] = useState("graph");
  const byId = (id: string) => result.nodes.find((n) => n.id === id);
  const node = selected?.kind === "node" ? byId(selected.id) : undefined;
  const edge = selected?.kind === "edge" ? result.edges.find((e) => e.id === selected.id) : undefined;
  const [search, setSearch] = useState("");
  const [layout, setLayout] = useState<LayoutName>("force");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const matches = useMemo(() => searchNodes(result.nodes, search), [result, search]);
  const [editing, setEditing] = useState(false);
  const view = pickView(result);

  // A run or a reset hands in another result. Layout, hidden labels and the editor stay as they are.
  const [shown, setShown] = useState(given);
  if (shown !== given) {
    setShown(given);
    setResult(given);
    setSelected(null);
    setExpansion({});
    setSearch("");
    if (!given.table.columns.length) setTab("graph");
    if (layout === "geographic" && !hasCoordinates(given.nodes)) setLayout("force");
  }
  const current = useRef(given);
  current.current = given;
  // The server still remembers a node from the earlier result.
  const selectedBefore = useRef(selected);
  useEffect(() => {
    if (selectedBefore.current) host.selectNode(null);
  }, [given]);
  useEffect(() => void (selectedBefore.current = selected), [selected]);
  // Nothing is sent until the user does something, so reopening an old view stays silent.
  const context = modelContext(result, selected, userRan);
  const sharedContext = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (context === sharedContext.current) return;
    sharedContext.current = context;
    host.shareContext(context);
  }, [context]);
  const toggle = (label: string) =>
    setHidden((current) => {
      const next = new Set(current);
      if (!next.delete(label)) next.add(label);
      return next;
    });

  const select = (next: Selection | null) => {
    setSelected(next);
    setExpansion({});
    // Claude only knows about nodes; selecting a relationship forgets the earlier node.
    host.selectNode(next?.kind === "node" ? next.id : null);
  };
  const expandSelected = async (id: string) => {
    setExpansion({ busy: true });
    const startedOn = current.current;
    try {
      const extra = await host.expandNode(id);
      if (current.current !== startedOn) return; // belongs to an earlier result
      setResult((now) => mergeGraphs(now, extra));
      setExpansion({});
    } catch (error) {
      if (current.current !== startedOn) return;
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
        <div className="ml-auto flex gap-2">
          {editor && (
            <Button variant={editing ? "secondary" : "outline"} size="sm" aria-expanded={editing} onClick={() => setEditing(!editing)}>
              Cypher
            </Button>
          )}
          {expand && <Button variant="outline" size="sm" onClick={expand}>Open in panel</Button>}
        </div>
      </header>
      {editor && <QueryPanel original={editor.original} hidden={!editing} onRun={editor.run} onReset={editor.reset} />}
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
              query={search}
              onQuery={setSearch}
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
            {edge && <EdgeDetails edge={edge} source={byId(edge.source)!} target={byId(edge.target)!} onClose={() => select(null)} />}
          </div>
          {tab === "table" && <DataTable table={result.table} />}
        </>
      )}
    </>
  );
}

/** Holds what is shown: Claude's result, or that of the user's latest run. */
function QueryableResult({ result: initial, host, ...props }: Omit<ResultProps, "editor" | "host" | "userRan"> & {
  host: Pick<Host, "selectNode" | "shareContext" | "expandNode" | "runQuery" | "resetQuery">;
}) {
  const [{ shown, userRan }, setShown] = useState({ shown: initial, userRan: false });
  const editor = initial.query && {
    original: initial.query,
    run: async (query: ViewQuery) => setShown({ shown: await host.runQuery(query), userRan: true }),
    reset: () => {
      setShown({ shown: { ...initial }, userRan: false }); // a copy, so that expansions are dropped too
      host.resetQuery();
    },
  };
  return <Result {...props} result={shown} userRan={userRan} host={host} editor={editor} />;
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
  const { state, frame, openInPanel, selectNode, shareContext, expandNode, runQuery, resetQuery } = useHost();
  // On the root element, so that the body, scrollbars and menus follow the theme too.
  useEffect(() => void document.documentElement.classList.toggle("dark", frame.theme === "dark"), [frame.theme]);
  return (
    <main className="flex flex-col overflow-hidden bg-background text-foreground" style={{ height: frame.height, padding: frame.padding }}>
      {state.kind === "loading" && <Message text="Running query…" />}
      {state.kind === "message" && <Message text={state.text} error={state.error} />}
      {state.kind === "result" && (
        <Fallback>
          <QueryableResult
            result={state.result}
            theme={frame.theme}
            expand={frame.canExpand ? openInPanel : undefined}
            host={{ selectNode, shareContext, expandNode, runQuery, resetQuery }}
          />
        </Fallback>
      )}
    </main>
  );
}
