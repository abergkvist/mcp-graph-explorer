import type { GraphResult } from "@mcp-graph-explorer/normalizer";
import { LIMITS } from "./config.ts";

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

const counts = (names: string[]) => {
  const tally = new Map<string, number>();
  for (const name of names) tally.set(name, (tally.get(name) ?? 0) + 1);
  return [...tally].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([name, n]) => `${name} ${n}`).join(", ");
};

/** The compact text the model gets instead of the graph. */
export function summarize(result: GraphResult): string {
  const { nodes, edges, table, meta } = result;
  const lines: string[] = [];

  if (meta.changes) {
    const changes = Object.entries(meta.changes).map(([k, v]) => `${k}: ${v}`).join(", ");
    lines.push(`Write mode: transaction committed.${changes ? ` ${changes}` : ""}`);
  }
  if (nodes.length) {
    lines.push(`Graph: ${nodes.length} nodes, ${edges.length} relationships`);
    const labels = counts(nodes.flatMap((n) => n.labels));
    if (labels) lines.push(`Labels: ${labels}`);
    if (edges.length) lines.push(`Relationship types: ${counts(edges.map((e) => e.type))}`);

    const degree = new Map<string, number>();
    for (const edge of edges) for (const id of [edge.source, edge.target]) degree.set(id, (degree.get(id) ?? 0) + 1);
    const top = nodes
      .filter((n) => !n.placeholder)
      .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))
      .slice(0, 5)
      .map((n) => {
        const name = n.props.name ?? n.props.title;
        return `- ${[n.labels.join(":"), name === undefined ? "" : clip(String(name), 80)].filter(Boolean).join(" ")} (${n.id})`;
      });
    if (top.length) lines.push("Most connected:", ...top);
  }
  if (table.rows.length) {
    lines.push(`Table: ${table.columns.join(", ")}`);
    lines.push(...table.rows.slice(0, LIMITS.maxTableRowsForModel).map((row) => clip(JSON.stringify(row), 500)));
    const hidden = table.rows.length - LIMITS.maxTableRowsForModel;
    if (hidden > 0) lines.push(`(${hidden} more rows not shown)`);
  }
  if (meta.truncated.length) lines.push(`Truncated: ${meta.truncated.join(", ")}`);
  if (!nodes.length && !table.rows.length && !meta.changes) lines.push("No results.");
  return lines.join("\n");
}
