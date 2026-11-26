import type { GraphResult, Json, Truncation } from "@mcp-graph-explorer/normalizer";
import { LIMITS } from "./config.ts";

const MAX_STRING = 500;
const size = (value: unknown) => JSON.stringify(value).length;

const shorten = (value: Json): Json => {
  if (typeof value === "string") return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (Array.isArray(value)) return value.map(shorten);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shorten(v)]));
  return value;
};

/** Cuts a result down to what the host can load; every cut is recorded in meta.truncated. */
export function applyLimits(
  result: GraphResult,
  limits: Pick<typeof LIMITS, "maxNodes" | "maxEdges" | "maxStructuredChars"> | { maxNodes: number; maxEdges: number; maxStructuredChars: number } = LIMITS,
): GraphResult {
  const truncated = new Set<Truncation>(result.meta.truncated);
  let { nodes, edges } = result;
  let rows = result.table.rows;

  const keepNodes = (count: number) => {
    nodes = nodes.slice(0, count);
    const ids = new Set(nodes.map((n) => n.id));
    edges = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    truncated.add("nodes");
  };
  if (nodes.length > limits.maxNodes) keepNodes(limits.maxNodes);
  if (edges.length > limits.maxEdges) {
    edges = edges.slice(0, limits.maxEdges);
    truncated.add("edges");
  }

  const build = (): GraphResult => ({
    nodes,
    edges,
    table: { columns: result.table.columns, rows },
    meta: { ...result.meta, truncated: [...truncated] },
  });

  if (size(build()) > limits.maxStructuredChars) {
    const props = <T extends { props: Record<string, Json> }>(item: T) => ({ ...item, props: shorten(item.props) as Record<string, Json> });
    nodes = nodes.map(props);
    edges = edges.map(props);
    rows = rows.map((row) => row.map(shorten));
    truncated.add("properties");
  }
  while (size(build()) > limits.maxStructuredChars && (rows.length || nodes.length)) {
    if (rows.length && size(rows) >= size(nodes) + size(edges)) {
      rows = rows.slice(0, Math.floor(rows.length / 2));
      truncated.add("rows");
    } else if (nodes.length) keepNodes(Math.floor(nodes.length / 2));
    else rows = rows.slice(0, Math.floor(rows.length / 2));
  }
  return build();
}
