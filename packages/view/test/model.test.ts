import { describe, expect, it } from "vitest";
import type { GraphResult } from "@mcp-graph-explorer/normalizer";
import { parseResult, pickView } from "../src/model.ts";

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
  it("rejects unexpected payloads", () => {
    for (const bad of [undefined, null, "x", {}, { nodes: 1 }]) expect(parseResult(bad)).toBeUndefined();
    expect(parseResult(result({}))).toEqual(result({}));
  });
});
