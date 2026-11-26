import neo4j from "neo4j-driver";
import type { Node, Path, Relationship } from "neo4j-driver";
import { resolveEndpoints } from "./graph.ts";
import { toJson } from "./values.ts";
import type { Dialect, GraphEdge, GraphNode, GraphResult, Json } from "./types.ts";

/** Driver-neutral input: column names and one array of values per row. */
export interface ResultInput {
  keys: string[];
  rows: unknown[][];
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && [Object.prototype, null].includes(Object.getPrototypeOf(value));

const isGraphObject = (value: unknown): value is Node | Relationship | Path =>
  neo4j.isNode(value as object) || neo4j.isRelationship(value as object) || neo4j.isPath(value as object);

const children = (value: unknown): unknown[] | undefined =>
  Array.isArray(value) ? value : isPlainObject(value) ? Object.values(value) : undefined;

/** True for null and for empty or null-only lists and maps. */
const isBlank = (value: unknown): boolean => value === null || value === undefined || (children(value)?.every(isBlank) ?? false);

/** True if the value holds anything besides graph objects and nulls. */
const hasScalar = (value: unknown): boolean => {
  if (value === null || value === undefined || isGraphObject(value)) return false;
  return children(value)?.some(hasScalar) ?? true;
};

/** A table cell: graph objects become references by id. */
const toCell = (value: unknown): Json => {
  if (neo4j.isNode(value as object)) return { $node: (value as Node).elementId };
  if (neo4j.isRelationship(value as object)) return { $edge: (value as Relationship).elementId };
  if (neo4j.isPath(value as object)) {
    const path = value as Path;
    return {
      $path: [path.start.elementId, ...path.segments.flatMap((s) => [s.relationship.elementId, s.end.elementId])],
    };
  }
  if (Array.isArray(value)) return value.map(toCell);
  if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toCell(v)]));
  return toJson(value);
};

export function normalize(input: ResultInput, dialect: Dialect): GraphResult {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const props = (source: object) => toJson({ ...source }) as Record<string, Json>;

  const addNode = (node: Node) => {
    nodes.set(node.elementId, { id: node.elementId, labels: [...node.labels], props: props(node.properties) });
  };
  const addEdge = (rel: Relationship) => {
    edges.set(rel.elementId, {
      id: rel.elementId,
      type: rel.type,
      source: rel.startNodeElementId,
      target: rel.endNodeElementId,
      props: props(rel.properties),
    });
  };
  const walk = (value: unknown): void => {
    if (neo4j.isNode(value as object)) addNode(value as Node);
    else if (neo4j.isRelationship(value as object)) addEdge(value as Relationship);
    else if (neo4j.isPath(value as object)) {
      const path = value as Path;
      addNode(path.start);
      addNode(path.end);
      for (const segment of path.segments) {
        addNode(segment.start);
        addEdge(segment.relationship);
        addNode(segment.end);
      }
    } else children(value)?.forEach(walk);
  };
  input.rows.forEach((row) => row.forEach(walk));

  const included = input.keys
    .map((_, index) => index)
    .filter((i) => input.rows.some((row) => hasScalar(row[i])) || input.rows.every((row) => isBlank(row[i])));
  const resolved = resolveEndpoints([...nodes.values()], [...edges.values()]);

  return {
    nodes: resolved.nodes,
    edges: [...edges.values()],
    table: {
      columns: included.map((i) => input.keys[i]!),
      rows: included.length ? input.rows.map((row) => included.map((i) => toCell(row[i]))) : [],
    },
    meta: { danglingEdges: resolved.danglingEdges, truncated: [], autoConnectedEdges: 0, dialect },
  };
}
