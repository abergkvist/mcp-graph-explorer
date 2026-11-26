import { mergeGraphs, normalize, type GraphResult } from "@mcp-graph-explorer/normalizer";
import { LIMITS } from "./config.ts";
import type { DialectAdapter } from "./dialect.ts";
import { applyLimits } from "./limits.ts";
import type { QueryRunner, RunResult } from "./runner.ts";

export interface CypherInput {
  answer_query: string;
  context_query?: string;
  params?: Record<string, unknown>;
  connect?: "auto" | boolean;
}

const toGraph = (run: RunResult, adapter: DialectAdapter): GraphResult => {
  const result = normalize(run, adapter.name);
  if (run.truncated) result.meta.truncated.push("rows");
  return result;
};

/** Adds the relationships that exist between the nodes already in the result. */
async function autoConnect(runner: QueryRunner, adapter: DialectAdapter, result: GraphResult): Promise<GraphResult> {
  const ids = result.nodes.filter((n) => !n.placeholder).map((n) => adapter.toIdParam(n.id)).filter((id) => id !== undefined);
  if (!ids.length) return result;
  const cypher =
    `MATCH (a)-[r]->(b) WHERE ${adapter.idExpr("a")} IN $ids AND ${adapter.idExpr("b")} IN $ids RETURN r LIMIT $max`;
  const run = await runner.run(cypher, { ids, max: LIMITS.maxEdges + 1 }, LIMITS.maxEdges);
  const found = toGraph(run, adapter);
  if (run.truncated) found.meta.truncated = ["edges"];
  const merged = mergeGraphs(result, { ...found, nodes: [] });
  merged.meta.autoConnectedEdges = merged.edges.length - result.edges.length;
  return merged;
}

export async function runCypher(runner: QueryRunner, adapter: DialectAdapter, input: CypherInput): Promise<GraphResult> {
  const { answer_query, context_query, params = {}, connect = "auto" } = input;
  const answer = await runner.run(answer_query, params, LIMITS.maxRows, runner.accessMode === "write");
  let result = toGraph(answer, adapter);
  if (answer.changes) result.meta.changes = answer.changes;
  if (context_query) result = mergeGraphs(result, toGraph(await runner.run(context_query, params, LIMITS.maxRows), adapter));

  const real = result.nodes.filter((n) => !n.placeholder).length;
  if (connect === true || (connect === "auto" && real >= 2 && !result.edges.length)) {
    result = await autoConnect(runner, adapter, result);
  }
  return applyLimits(result);
}
