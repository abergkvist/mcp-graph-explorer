// Everything that talks to the MCP host.
import { useEffect, useMemo, useState } from "react";
import { App } from "@modelcontextprotocol/ext-apps";
import type { GraphResult } from "@mcp-graph-explorer/normalizer";
import { parseResult } from "./model.ts";
import type { Theme } from "./palette.ts";

export type ViewState =
  | { kind: "loading" }
  | { kind: "message"; text: string; error?: boolean }
  | { kind: "result"; result: GraphResult };

export interface Frame {
  theme: Theme;
  height: string;
  padding: string;
  canExpand: boolean;
}

export interface Host {
  state: ViewState;
  frame: Frame;
  openInPanel(): void;
  /** Tells the server which node is selected, so that the model can ask for it. */
  selectNode(id: string | null): void;
  expandNode(id: string): Promise<GraphResult>;
}

const INLINE_HEIGHT = "480px";

function frameOf(app: App): Frame {
  const context = app.getHostContext();
  const fullscreen = context?.displayMode === "fullscreen";
  const size = context?.containerDimensions as { height?: number } | undefined;
  const inset = context?.safeAreaInsets;
  return {
    theme: context?.theme === "dark" ? "dark" : "light",
    height: fullscreen ? (size?.height ? `${size.height}px` : "100dvh") : INLINE_HEIGHT,
    padding: inset ? `${inset.top}px ${inset.right}px ${inset.bottom}px ${inset.left}px` : "0",
    canExpand: !fullscreen && Boolean(context?.availableDisplayModes?.includes("fullscreen")),
  };
}

const stateOf = (result: { isError?: boolean; content?: unknown; structuredContent?: unknown }): ViewState => {
  if (result.isError) {
    const text = (result.content as { text?: string }[] | undefined)?.[0]?.text;
    return { kind: "message", text: text ?? "The query failed", error: true };
  }
  const parsed = parseResult(result.structuredContent);
  return parsed ? { kind: "result", result: parsed } : { kind: "message", text: "This result can't be displayed" };
};

const initialFrame: Frame = { theme: "light", height: INLINE_HEIGHT, padding: "0", canExpand: false };

export function useHost(): Host {
  const [state, setState] = useState<ViewState>({ kind: "loading" });
  const [frame, setFrame] = useState<Frame>(initialFrame);
  const [app, setApp] = useState<App>();

  useEffect(() => {
    // Vite dev server outside a host, or with ?demo=graph|table|value|empty: show example data.
    if (import.meta.env.DEV && (window.parent === window || new URLSearchParams(location.search).has("demo"))) {
      void import("./demo.ts").then(({ demo }) => {
        const query = new URLSearchParams(location.search);
        setFrame({ ...initialFrame, theme: query.get("theme") === "dark" ? "dark" : "light", height: "100dvh", canExpand: true });
        setState(stateOf({ structuredContent: demo(query.get("demo") ?? "graph") }));
      });
      return;
    }
    const host = new App({ name: "graph-explorer", version: "0.1.0" }, { availableDisplayModes: ["inline", "fullscreen"] });
    // Handlers must be registered before connect().
    host.ontoolresult = (result) => setState(stateOf(result));
    host.ontoolcancelled = () => setState({ kind: "message", text: "Query cancelled" });
    host.onhostcontextchanged = () => setFrame(frameOf(host));
    host.onteardown = async () => ({});
    void host.connect().then(
      () => {
        setApp(host);
        setFrame(frameOf(host));
      },
      (error) => setState({ kind: "message", text: `Could not connect to the host: ${error}`, error: true }),
    );
  }, []);

  const actions = useMemo(
    () => ({
      openInPanel: () => void app?.requestDisplayMode({ mode: "fullscreen" }),
      selectNode: (id: string | null) =>
        void app?.callServerTool({ name: "select_node", arguments: { nodeId: id } }).catch(console.error),
      async expandNode(id: string) {
        if (!app) throw new Error("Not connected to a host");
        const response = await app.callServerTool({ name: "expand_node", arguments: { nodeId: id } });
        const next = stateOf(response);
        if (next.kind === "result") return next.result;
        throw new Error(next.kind === "message" ? next.text : "Could not expand the node");
      },
    }),
    [app],
  );
  return { state, frame, ...actions };
}
