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

/** Runs one query and returns its data as JSON for the model. Writes if the server is in write mode. */
export async function queryData(
  runner: QueryRunner,
  adapter: DialectAdapter,
  { query, params = {} }: { query: string; params?: Record<string, unknown> },
): Promise<string> {
  const run = await runner.run(query, params, LIMITS.maxRows, runner.accessMode === "write");
  try {
    const { nodes, edges, table, meta } = applyLimits(toGraph(run, adapter), LIMITS.query);
    return JSON.stringify({ nodes, relationships: edges, table, truncated: meta.truncated, changes: run.changes });
  } catch (error) {
    if (!run.changes) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`The write was committed. Do not run the query again. Processing the result failed: ${reason}`);
  }
}

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

/** The final answer for the view. Only reads, also when the server is in write mode. */
export async function runCypher(runner: QueryRunner, adapter: DialectAdapter, input: CypherInput): Promise<GraphResult> {
  const { answer_query, context_query, params = {}, connect = "auto" } = input;
  const answer = await runner.run(answer_query, params, LIMITS.maxRows);
  let result = toGraph(answer, adapter);
  if (context_query) result = mergeGraphs(result, toGraph(await runner.run(context_query, params, LIMITS.maxRows), adapter));

  const real = result.nodes.filter((n) => !n.placeholder).length;
  if (connect === true || (connect === "auto" && real >= 2 && !result.edges.length)) {
    result = await autoConnect(runner, adapter, result);
  }
  return applyLimits(result);
}
