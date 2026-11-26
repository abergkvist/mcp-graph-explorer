import type { GraphResult } from "@mcp-graph-explorer/normalizer";

export interface GraphRenderer {
  /** Replaces the drawn graph; nodes with a known id keep their position. */
  setGraph(graph: Pick<GraphResult, "nodes" | "edges">): void;
  setSelected(id: string | null): void;
  setHighlight(ids: Set<string> | null): void;
  setHiddenLabels(labels: Set<string>): void;
  setTheme(theme: "light" | "dark"): void;
  destroy(): void;
}
export interface RendererEvents {
  onNodeClick(id: string): void;
  onBackgroundClick(): void;
  onNodeHover(id: string | null): void;
}
export type CreateRenderer = (el: HTMLElement, events: RendererEvents) => GraphRenderer;
