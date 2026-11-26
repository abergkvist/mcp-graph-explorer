import type { GraphResult } from "@mcp-graph-explorer/normalizer";
import type { LayoutName } from "./layouts.ts";

export interface GraphRenderer {
  /** Replaces the drawn graph; nodes with a known id keep their position. */
  setGraph(graph: Pick<GraphResult, "nodes" | "edges">): void;
  /** Rearranges all nodes, discarding positions the user has dragged them to. */
  setLayout(layout: LayoutName): void;
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
