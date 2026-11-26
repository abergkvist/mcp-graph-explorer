import neo4j from "neo4j-driver";
import { describe, expect, it } from "vitest";
import { mergeGraphs } from "../src/graph.ts";
import { normalize } from "../src/normalize.ts";

const { Node, Relationship, Path, PathSegment } = neo4j.types;
const int = neo4j.int;
const node = (id: number, props = {}) => new Node(int(id), ["Station"], props, `n${id}`);
const rel = (id: number, a: number, b: number) =>
  new Relationship(int(id), int(a), int(b), "CONNECTS", {}, `r${id}`, `n${a}`, `n${b}`);
const run = (keys: string[], ...rows: unknown[][]) => normalize({ keys, rows }, "neo4j");
const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort();

describe("normalize", () => {
  it("turns nodes and relationships into a graph with no table", () => {
    const r = run(["a", "r", "b"], [node(1, { km: int(5) }), rel(9, 1, 2), node(2)]);
    expect(r.nodes[0]).toEqual({ id: "n1", labels: ["Station"], props: { km: 5 } });
    expect(r.edges[0]).toEqual({ id: "r9", type: "CONNECTS", source: "n1", target: "n2", props: {} });
    expect(r.table).toEqual({ columns: [], rows: [] });
    expect(r.meta.danglingEdges).toBe(0);
  });

  it("deduplicates on id", () => {
    const r = run(["a", "r"], [node(1), rel(9, 1, 2)], [node(1), rel(9, 1, 2)]);
    expect(ids(r.edges)).toEqual(["r9"]);
    expect(ids(r.nodes)).toEqual(["n1", "n2"]);
  });

  it("adds placeholders for missing endpoints", () => {
    const r = run(["r"], [rel(9, 1, 2)]);
    expect(r.nodes).toContainEqual({ id: "n2", labels: [], props: {}, placeholder: true });
    expect(r.meta.danglingEdges).toBe(1);
  });

  it("replaces a placeholder when the node appears later", () => {
    const r = run(["x"], [rel(9, 1, 2)], [node(1)], [node(2)]);
    expect(r.nodes.some((n) => n.placeholder)).toBe(false);
    expect(r.meta.danglingEdges).toBe(0);
  });

  it("walks paths, lists and maps", () => {
    const path = new Path(node(1), node(2), [new PathSegment(node(1), rel(9, 1, 2), node(2))]);
    const r = run(["p", "c", "m"], [path, [node(3)], { deep: [node(4)] }]);
    expect(ids(r.nodes)).toEqual(["n1", "n2", "n3", "n4"]);
    expect(ids(r.edges)).toEqual(["r9"]);
    expect(r.table.columns).toEqual([]);
  });

  it("keeps scalar columns and references graph objects in mixed cells", () => {
    const r = run(["s", "name", "m"], [node(1), "Falun C", { station: node(1), n: int(2) }]);
    expect(r.table).toEqual({ columns: ["name", "m"], rows: [["Falun C", { station: { $node: "n1" }, n: 2 }]] });
  });

  it("keeps null columns and the columns of empty results", () => {
    expect(run(["x"], [null]).table).toEqual({ columns: ["x"], rows: [[null]] });
    expect(run(["a", "b"]).table).toEqual({ columns: ["a", "b"], rows: [] });
  });
});

describe("mergeGraphs", () => {
  it("unions graphs, resolves placeholders and keeps the base table", () => {
    const base = run(["r", "c"], [rel(9, 1, 2), 7]);
    const merged = mergeGraphs(base, run(["a", "b"], [node(1), node(2)]));
    expect(ids(merged.nodes)).toEqual(["n1", "n2"]);
    expect(merged.meta.danglingEdges).toBe(0);
    expect(merged.table).toEqual(base.table);
  });
});
