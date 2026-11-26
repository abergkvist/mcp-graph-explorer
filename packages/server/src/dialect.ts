import neo4j from "neo4j-driver";
import type { Dialect } from "@mcp-graph-explorer/normalizer";

export interface DialectAdapter {
  name: Dialect;
  /** Cypher expression for the id of a node or relationship variable. */
  idExpr(variable: string): string;
  /** Converts a normalized string id to a query parameter; undefined if it cannot be an id. */
  toIdParam(id: string): unknown | undefined;
  schemaQueries: { nodes: string; relationships: string };
}

// Portable Cypher, based on a sample so that large databases stay responsive.
const schemaQueries = {
  nodes: "MATCH (n) WITH n LIMIT 10000 UNWIND labels(n) AS name RETURN name, properties(n) AS props",
  relationships: "MATCH ()-[r]->() WITH r LIMIT 10000 RETURN type(r) AS name, properties(r) AS props",
};

const adapters: Record<Dialect, DialectAdapter> = {
  neo4j: {
    name: "neo4j",
    idExpr: (v) => `elementId(${v})`,
    toIdParam: (id) => id || undefined,
    schemaQueries,
  },
  memgraph: {
    name: "memgraph",
    idExpr: (v) => `id(${v})`,
    toIdParam: (id) => (/^\d+$/.test(id) ? neo4j.int(id) : undefined),
    schemaQueries,
  },
};

export const adapterFor = (dialect: Dialect): DialectAdapter => adapters[dialect];
