import { describe, expect, it } from "vitest";
import type { GraphResult } from "@mcp-graph-explorer/normalizer";
import { labelStyles, parseResult, pickView, searchNodes, writeNote } from "../src/model.ts";

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
