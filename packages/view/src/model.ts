import type { GraphResult, ViewQuery } from "@mcp-graph-explorer/normalizer";

/**
 * Accepts only payloads that can be drawn; old or foreign ones become undefined.
 * Old chats hand their stored result to the newest view, so the shape cannot be taken for granted.
 */
export function parseResult(structured: unknown): GraphResult | undefined {
  const r = structured as Partial<GraphResult> | null | undefined;
  if (!r || !Array.isArray(r.nodes) || !Array.isArray(r.edges)) return undefined;
  if (!Array.isArray(r.table?.columns) || !Array.isArray(r.table.rows) || !Array.isArray(r.meta?.truncated)) return undefined;
  if (!r.table.rows.every(Array.isArray)) return undefined;
  const ids = new Set<string>();
  for (const node of r.nodes) {
    if (typeof node?.id !== "string" || !Array.isArray(node.labels) || typeof node.props !== "object" || !node.props) return undefined;
    ids.add(node.id);
  }
  const connected = r.edges.every((e) => typeof e?.id === "string" && ids.has(e.source) && ids.has(e.target));
  if (!connected) return undefined;
  if (r.query === undefined || isQuery(r.query)) return r as GraphResult;
  const { query: _broken, ...rest } = r as GraphResult;
  return rest;
}

function isQuery(value: unknown): value is ViewQuery {
  const query = value as Partial<ViewQuery> | null;
  return typeof query?.answer_query === "string" && (query.context_query === undefined || typeof query.context_query === "string");
}

/** The query to run from what is in the editors; undefined when there is nothing to run. */
export function editedQuery(original: ViewQuery, answer: string, context: string): ViewQuery | undefined {
  if (!answer.trim()) return undefined;
  const { context_query: _old, ...rest } = original;
  return { ...rest, answer_query: answer, ...(context.trim() ? { context_query: context } : {}) };
}

/** What to tell the user after a committed write; undefined for reads. */
export function writeNote({ changes }: GraphResult["meta"]): string | undefined {
  if (!changes) return undefined;
  const list = Object.entries(changes).map(([name, count]) => `${name} ${count}`).join(", ");
  return list ? `Write committed: ${list}` : "Write committed";
}

export function pickView({ nodes, edges, table }: GraphResult): "graph" | "table" | "value" | "empty" {
  if (nodes.length || edges.length) return "graph";
  if (!table.rows.length) return "empty";
  return table.rows.length === 1 && table.columns.length === 1 ? "value" : "table";
}

export const SHAPES = ["circle", "square", "diamond", "triangle"] as const;
export interface LabelStyle { color: number; shape: (typeof SHAPES)[number] }
export const COLOR_COUNT = 8;

/** A label gets the same colour and shape in every result, unless labels of one result collide. */
export function labelStyles(labels: string[]): Map<string, LabelStyle> {
  const styles = new Map<string, LabelStyle>();
  const colors = new Set<number>();
  const shapes = new Set<number>();
  for (const label of [...new Set(labels)].sort()) {
    const hash = [...label].reduce((h, char) => (h * 31 + char.codePointAt(0)!) >>> 0, 7);
    const order = Array.from({ length: COLOR_COUNT }, (_, i) => (hash + i) % COLOR_COUNT);
    const free = order.filter((slot) => !colors.has(slot));
    const color = free.find((slot) => !shapes.has(slot % SHAPES.length)) ?? free[0] ?? order[0]!;
    colors.add(color);
    shapes.add(color % SHAPES.length);
    styles.set(label, { color, shape: SHAPES[color % SHAPES.length]! });
  }
  return styles;
}

export const nodeName = (node: GraphResult["nodes"][number]): string =>
  String(node.props.name ?? node.props.title ?? node.labels[0] ?? node.id);

/** Ids of nodes whose labels or property values contain the query; null when there is no query. */
export function searchNodes(nodes: GraphResult["nodes"], query: string): Set<string> | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return null;
  const matches = (value: unknown) => String(typeof value === "object" ? JSON.stringify(value) : value).toLowerCase().includes(needle);
  return new Set(nodes.filter((n) => [...n.labels, ...Object.values(n.props)].some(matches)).map((n) => n.id));
}
