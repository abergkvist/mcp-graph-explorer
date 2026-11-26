import { normalize, type GraphResult } from "@mcp-graph-explorer/normalizer";
import { LIMITS } from "./config.ts";
import type { DialectAdapter } from "./dialect.ts";
import { applyLimits } from "./limits.ts";
import type { QueryRunner } from "./runner.ts";

/** A node and at most `max` of its relationships; undefined if the node does not exist. */
export async function neighborhood(
  runner: QueryRunner,
  adapter: DialectAdapter,
  nodeId: string,
  max: number,
): Promise<GraphResult | undefined> {
  const id = adapter.toIdParam(nodeId);
  if (id === undefined) return undefined;
  const cypher = `MATCH (n) WHERE ${adapter.idExpr("n")} = $id OPTIONAL MATCH (n)-[r]-(m) RETURN n, r, m LIMIT $max`;
  const run = await runner.run(cypher, { id, max: max + 1 }, max);
  if (!run.rows.length) return undefined;
  const result = normalize(run, adapter.name);
  if (run.truncated) result.meta.truncated.push("edges");
  return result;
}

const GONE = "The selected node no longer exists in the database.";

/** What get_selection tells the model. */
export async function describeSelection(
  runner: QueryRunner,
  adapter: DialectAdapter,
  selection: { nodeId: string; selectedAt: string } | undefined,
): Promise<string> {
  if (!selection) return "No node has been selected in the graph view.";
  const found = await neighborhood(runner, adapter, selection.nodeId, LIMITS.maxNeighbors);
  if (!found) return GONE;
  const neighborsTruncated = found.meta.truncated.includes("edges");
  const result = applyLimits(found, { maxNodes: 100, maxEdges: 100, maxStructuredChars: 20_000 });
  const byId = new Map(result.nodes.map((node) => [node.id, node]));
  const node = byId.get(selection.nodeId);
  if (!node) return GONE;
  return JSON.stringify({
    node,
    neighbors: result.edges.map((edge) => {
      const out = edge.source === node.id;
      return { relationship: edge.type, direction: out ? "out" : "in", node: byId.get(out ? edge.target : edge.source) };
    }),
    selectedAt: selection.selectedAt,
    ageSeconds: Math.round((Date.now() - Date.parse(selection.selectedAt)) / 1000),
    neighborsTruncated,
  });
}
