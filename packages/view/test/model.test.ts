import { describe, expect, it } from "vitest";
import type { GraphResult } from "@mcp-graph-explorer/normalizer";
import { editedQuery, labelStyles, parseResult, pickView, searchNodes, selectionFocus, writeNote } from "../src/model.ts";

const result = (partial: Partial<GraphResult>): GraphResult => ({
  nodes: [],
  edges: [],
  table: { columns: [], rows: [] },
  meta: { danglingEdges: 0, truncated: [], autoConnectedEdges: 0, dialect: "neo4j" },
  ...partial,
});

describe("view model", () => {
  it("picks the view from the content", () => {
    const n = { id: "1", labels: [], props: {} };
    expect(pickView(result({ nodes: [n] }))).toBe("graph");
    expect(pickView(result({ table: { columns: ["a", "b"], rows: [[1, 2]] } }))).toBe("table");
    expect(pickView(result({ table: { columns: ["c"], rows: [[7]] } }))).toBe("value");
    expect(pickView(result({ table: { columns: ["c"], rows: [] } }))).toBe("empty");
  });
  it("tells up to four labels apart by both colour and shape", () => {
    for (const labels of [["Station", "TrackSection"], ["A", "B", "C", "D"]]) {
      const styles = [...labelStyles(labels).values()];
      expect(new Set(styles.map((s) => s.color)).size).toBe(labels.length);
      expect(new Set(styles.map((s) => s.shape)).size).toBe(labels.length);
    }
  });
  it("rejects payloads that would crash the rendering", () => {
    const ok = { id: "1", labels: [], props: {} };
    expect(parseResult(result({ nodes: [{ id: "1" } as never] }))).toBeUndefined();
    expect(parseResult(result({ nodes: [ok], edges: [{ id: "e", type: "T", source: "1", target: "2", props: {} }] }))).toBeUndefined();
    expect(parseResult(result({ nodes: [ok], edges: [{ id: "e", type: "T", source: "1", target: "1", props: {} }] }))).toBeDefined();
  });
  it("says what a committed write changed", () => {
    expect(writeNote(result({}).meta)).toBeUndefined();
    expect(writeNote({ ...result({}).meta, changes: {} })).toBe("Write committed");
    expect(writeNote({ ...result({}).meta, changes: { nodesCreated: 3 } })).toBe("Write committed: nodesCreated 3");
  });
  it("keeps a usable query and drops a broken one without losing the result", () => {
    const query = { answer_query: "RETURN 1" };
    expect(parseResult(result({ query }))?.query).toEqual(query);
    for (const broken of [{}, { answer_query: 1 }, { answer_query: "A", context_query: 2 }, "A", null]) {
      const parsed = parseResult(result({ query: broken as never }));
      expect(parsed).toBeDefined();
      expect(parsed!.query).toBeUndefined();
    }
  });
  it("builds the query to run from the editors", () => {
    const original = { answer_query: "A", context_query: "C", params: { n: 1 }, connect: false };
    expect(editedQuery(original, "B", "D")).toEqual({ ...original, answer_query: "B", context_query: "D" });
    expect(editedQuery(original, "B", "  \n")).toEqual({ answer_query: "B", params: { n: 1 }, connect: false });
    expect(editedQuery(original, " ", "C")).toBeUndefined();
  });
  it("keeps a selected node with its neighbours, or a selected relationship with its ends, in focus", () => {
    const edge = (id: string, source: string, target: string) => ({ id, type: "T", source, target, props: {} });
    // "1" is both a node id and a relationship id, as it can be in Memgraph.
    const edges = [edge("1", "1", "2"), edge("2", "2", "3"), edge("3", "3", "4")];
    expect(selectionFocus({ kind: "node", id: "1" }, edges)).toEqual({ nodes: new Set(["1", "2"]), edges: new Set(["1"]) });
    expect(selectionFocus({ kind: "edge", id: "2" }, edges)).toEqual({ nodes: new Set(["2", "3"]), edges: new Set(["2"]) });
    expect(selectionFocus({ kind: "edge", id: "gone" }, edges)).toBeNull();
    expect(selectionFocus(null, edges)).toBeNull();
  });
  it("searches labels and property values", () => {
    const nodes = [
      { id: "1", labels: ["Station"], props: { name: "Falun C" } },
      { id: "2", labels: ["TrackSection"], props: { lengthKm: 12 } },
    ];
    expect(searchNodes(nodes, "falun")).toEqual(new Set(["1"]));
    expect(searchNodes(nodes, "track")).toEqual(new Set(["2"]));
    expect(searchNodes(nodes, "  ")).toBeNull();
  });
  it("rejects unexpected payloads", () => {
    for (const bad of [undefined, null, "x", {}, { nodes: 1 }]) expect(parseResult(bad)).toBeUndefined();
    expect(parseResult(result({}))).toEqual(result({}));
  });
});
