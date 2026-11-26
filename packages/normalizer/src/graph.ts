// Pure graph operations: no driver imports, so the view can use this in the browser.
import type { GraphEdge, GraphNode, GraphResult } from "./types.ts";

/** Adds placeholder nodes for missing edge endpoints and counts the edges that touch one. */
export function resolveEndpoints(nodes: GraphNode[], edges: GraphEdge[]): { nodes: GraphNode[]; danglingEdges: number } {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const edge of edges) {
    for (const id of [edge.source, edge.target]) {
      if (!byId.has(id)) byId.set(id, { id, labels: [], props: {}, placeholder: true });
    }
  }
  const danglingEdges = edges.filter((e) => byId.get(e.source)!.placeholder || byId.get(e.target)!.placeholder).length;
  return { nodes: [...byId.values()], danglingEdges };
}

/** Union of two results on id. Real nodes replace placeholders; the table comes from `base`. */
export function mergeGraphs(base: GraphResult, extra: GraphResult): GraphResult {
  const nodes = new Map<string, GraphNode>();
  for (const node of [...base.nodes, ...extra.nodes]) {
    const seen = nodes.get(node.id);
    if (!seen || (seen.placeholder && !node.placeholder)) nodes.set(node.id, node);
  }
  const edges = new Map([...extra.edges, ...base.edges].map((edge) => [edge.id, edge]));
  const resolved = resolveEndpoints([...nodes.values()], [...edges.values()]);
  return {
    nodes: resolved.nodes,
    edges: [...edges.values()],
    table: base.table,
    meta: {
      dialect: base.meta.dialect,
      danglingEdges: resolved.danglingEdges,
      truncated: [...new Set([...base.meta.truncated, ...extra.meta.truncated])],
      autoConnectedEdges: base.meta.autoConnectedEdges + extra.meta.autoConnectedEdges,
    },
  };
}
