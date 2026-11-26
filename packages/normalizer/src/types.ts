export type Dialect = "neo4j" | "memgraph";
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface GraphNode { id: string; labels: string[]; props: Record<string, Json>; placeholder?: true }
export interface GraphEdge { id: string; type: string; source: string; target: string; props: Record<string, Json> }
export interface Table { columns: string[]; rows: Json[][] }
export type Truncation = "rows" | "nodes" | "edges" | "properties";
export interface Meta { danglingEdges: number; truncated: Truncation[]; autoConnectedEdges: number; dialect: Dialect }
export interface GraphResult { nodes: GraphNode[]; edges: GraphEdge[]; table: Table; meta: Meta }
