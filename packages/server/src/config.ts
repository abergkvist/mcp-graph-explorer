import type { Dialect } from "@mcp-graph-explorer/normalizer";

export interface Config {
  uri: string;
  user: string;
  password: string;
  database?: string;
  dialect: Dialect;
  accessMode: "read" | "write";
}

export const LIMITS = {
  maxRows: 1000,
  maxNodes: 500,
  maxEdges: 2000,
  timeoutMs: 30000,
  maxStructuredChars: 140000,
  maxTableRowsForModel: 50,
  maxNeighbors: 25,
  maxExpandEdges: 50,
  /** What query_cypher returns to the model. */
  query: { maxNodes: 100, maxEdges: 100, maxStructuredChars: 20_000 },
} as const;

function oneOf<T extends string>(name: string, value: string | undefined, allowed: readonly T[]): T {
  const chosen = value || allowed[0]!;
  if (!allowed.includes(chosen as T)) throw new Error(`${name} must be one of ${allowed.join(", ")}, got "${chosen}"`);
  return chosen as T;
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  return {
    uri: env.GRAPH_URI || "bolt://localhost:7687",
    user: env.GRAPH_USER ?? "",
    password: env.GRAPH_PASSWORD ?? "",
    database: env.GRAPH_DATABASE || undefined,
    dialect: oneOf("GRAPH_DIALECT", env.GRAPH_DIALECT, ["neo4j", "memgraph"]),
    accessMode: oneOf("GRAPH_ACCESS_MODE", env.GRAPH_ACCESS_MODE, ["read", "write"]),
  };
}
