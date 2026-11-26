export type Dialect = "neo4j" | "memgraph";
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface GraphNode { id: string; labels: string[]; props: Record<string, Json>; placeholder?: true }
export interface GraphEdge { id: string; type: string; source: string; target: string; props: Record<string, Json> }
export interface Table { columns: string[]; rows: Json[][] }
export type Truncation = "rows" | "nodes" | "edges" | "properties";
export interface Meta { danglingEdges: number; truncated: Truncation[]; autoConnectedEdges: number; dialect: Dialect;
  /** Present only after a committed write: what changed. */
  changes?: Record<string, number> }
/** The Cypher behind a shown result, as the view gets it and sends it back. */
export interface ViewQuery {
  answer_query: string;
  context_query?: string;
  params?: Record<string, unknown>;
  connect?: "auto" | boolean;
}
export interface GraphResult { nodes: GraphNode[]; edges: GraphEdge[]; table: Table; meta: Meta; query?: ViewQuery }
