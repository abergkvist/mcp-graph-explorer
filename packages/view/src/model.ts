import type { GraphResult } from "@mcp-graph-explorer/normalizer";

/** Accepts only payloads that look like a result; old or foreign ones become undefined. */
export function parseResult(structured: unknown): GraphResult | undefined {
  const r = structured as Partial<GraphResult> | null | undefined;
  const ok =
    r && Array.isArray(r.nodes) && Array.isArray(r.edges) && Array.isArray(r.table?.columns) &&
    Array.isArray(r.table?.rows) && Array.isArray(r.meta?.truncated);
  return ok ? (r as GraphResult) : undefined;
}

export function pickView({ nodes, edges, table }: GraphResult): "graph" | "table" | "value" | "empty" {
  if (nodes.length || edges.length) return "graph";
  if (!table.rows.length) return "empty";
  return table.rows.length === 1 && table.columns.length === 1 ? "value" : "table";
}

export const SHAPES = ["circle", "square", "diamond", "triangle"] as const;
export interface LabelStyle { color: number; shape: (typeof SHAPES)[number] }
export const COLOR_COUNT = 8;

/** A label gets the same colour and shape in every result, unless two labels of one result collide. */
export function labelStyles(labels: string[]): Map<string, LabelStyle> {
  const styles = new Map<string, LabelStyle>();
  const taken = new Set<number>();
  for (const label of [...new Set(labels)].sort()) {
    let slot = [...label].reduce((hash, char) => (hash * 31 + char.codePointAt(0)!) >>> 0, 7) % COLOR_COUNT;
    while (taken.has(slot) && taken.size < COLOR_COUNT) slot = (slot + 1) % COLOR_COUNT;
    taken.add(slot);
    styles.set(label, { color: slot, shape: SHAPES[slot % SHAPES.length]! });
  }
  return styles;
}

export const nodeName = (node: GraphResult["nodes"][number]): string =>
  String(node.props.name ?? node.props.title ?? node.labels[0] ?? node.id);
