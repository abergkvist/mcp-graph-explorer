import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import neo4j from "neo4j-driver";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";
import { adapterFor } from "../src/dialect.ts";
import { applyLimits } from "../src/limits.ts";
import { queryData, runCypher } from "../src/query.ts";
import { createSelectionStore } from "../src/selection.ts";
import { summarize } from "../src/summary.ts";
import type { GraphResult, Json } from "@mcp-graph-explorer/normalizer";
import type { QueryRunner, RunResult } from "../src/runner.ts";
import { toDriverParams } from "../src/runner.ts";

describe("config, dialects and parameters", () => {
  it("sends safe integers as driver integers, floats unchanged", () => {
    const p = toDriverParams({ n: 5, x: 1.5, list: [2], m: { k: 3 }, s: "5" });
    expect(neo4j.isInt(p.n as object)).toBe(true);
    expect(p.x).toBe(1.5);
    expect(neo4j.isInt((p.list as object[])[0]!)).toBe(true);
    expect(neo4j.isInt((p.m as { k: object }).k)).toBe(true);
    expect(p.s).toBe("5");
  });
  it("leaves driver values in parameters untouched", () => {
    const id = neo4j.int(7);
    expect((toDriverParams({ ids: [id] }).ids as unknown[])[0]).toBe(id);
  });
  it("maps ids per dialect", () => {
    expect(adapterFor("neo4j").idExpr("a")).toBe("elementId(a)");
    expect(adapterFor("neo4j").toIdParam("4:abc:1")).toBe("4:abc:1");
    expect(adapterFor("memgraph").idExpr("a")).toBe("id(a)");
    expect(adapterFor("memgraph").toIdParam("12")).toEqual(neo4j.int(12));
    expect(adapterFor("memgraph").toIdParam("4:abc:1")).toBeUndefined();
  });
  it("is read-only unless write mode is chosen explicitly", () => {
    expect(loadConfig({}).accessMode).toBe("read");
    expect(loadConfig({ GRAPH_ACCESS_MODE: "write" }).accessMode).toBe("write");
    expect(() => loadConfig({ GRAPH_ACCESS_MODE: "rw" })).toThrow(/GRAPH_ACCESS_MODE/);
    expect(() => loadConfig({ GRAPH_DIALECT: "arango" })).toThrow(/GRAPH_DIALECT/);
  });
});

function graph(count: number, links: [string, string][] = [], rows: Json[][] = []): GraphResult {
  return {
    nodes: Array.from({ length: count }, (_, i) => ({ id: `n${i}`, labels: ["Station"], props: { name: `S${i}` } })),
    edges: links.map(([source, target], i) => ({ id: `r${i}`, type: "CONNECTS", source, target, props: {} })),
    table: { columns: rows.length ? ["c"] : [], rows },
    meta: { danglingEdges: 0, truncated: [], autoConnectedEdges: 0, dialect: "neo4j" },
  };
}

describe("limits and summary", () => {
  it("drops edges whose endpoints were cut", () => {
    const r = applyLimits(graph(3, [["n0", "n1"], ["n1", "n2"]]), { maxNodes: 2, maxEdges: 10, maxStructuredChars: 1e6 });
    expect(r.nodes).toHaveLength(2);
    expect(r.edges).toHaveLength(1);
    expect(r.meta.truncated).toContain("nodes");
  });
  it("fits structured content under the size limit", () => {
    const big = graph(200, [], Array.from({ length: 1000 }, () => ["x".repeat(5000)]));
    const r = applyLimits(big);
    expect(JSON.stringify(r).length).toBeLessThanOrEqual(140_000);
    expect(r.meta.truncated).toEqual(expect.arrayContaining(["properties"]));
  });
  it("summarizes without sending the whole graph", () => {
    const text = summarize(graph(400, [], Array.from({ length: 80 }, (_, i) => [i])));
    expect(text).toContain("400 nodes");
    expect(text).toContain("(30 more rows not shown)");
    expect(text.length).toBeLessThan(5000);
  });
});

const { Node, Relationship } = neo4j.types;
const node = (id: number) => new Node(neo4j.int(id), ["Station"], {}, `n${id}`);
const rel = new Relationship(neo4j.int(9), neo4j.int(1), neo4j.int(2), "CONNECTS", {}, "r9", "n1", "n2");

function fakeRunner(answer: unknown[][], accessMode: "read" | "write" = "read") {
  const calls: { cypher: string; write: boolean }[] = [];
  const runner: QueryRunner = {
    accessMode,
    async run(cypher, _params, _maxRows, write = false): Promise<RunResult> {
      calls.push({ cypher, write });
      if (cypher.includes("IN $ids")) return { keys: ["r"], rows: [[rel]], truncated: false };
      return { keys: ["a", "b"], rows: answer, truncated: false, changes: write ? { nodesCreated: 1 } : undefined };
    },
    close: async () => {},
  };
  return { runner, calls };
}

describe("runCypher", () => {
  const adapter = adapterFor("neo4j");
  const run = async (answer: unknown[][], connect?: "auto" | boolean) => {
    const fake = fakeRunner(answer);
    const result = await runCypher(fake.runner, adapter, { answer_query: "Q", connect });
    return { result, calls: fake.calls.length };
  };

  it("auto-connects only when the result has no relationships of its own", async () => {
    const bare = await run([[node(1), node(2)]]);
    expect(bare.calls).toBe(2);
    expect(bare.result.meta.autoConnectedEdges).toBe(1);
    expect((await run([[node(1), rel]])).calls).toBe(1);
    expect((await run([[node(1), rel]], true)).calls).toBe(2);
    expect((await run([[node(1), node(2)]], false)).calls).toBe(1);
  });
  it("never writes, also when the server is in write mode", async () => {
    const fake = fakeRunner([[1, 2]], "write");
    await runCypher(fake.runner, adapter, { answer_query: "A", context_query: "C" });
    expect(fake.calls.map((c) => c.write)).toEqual([false, false]);
  });
});

describe("queryData", () => {
  const adapter = adapterFor("neo4j");

  it("returns the data within the limits and notes the cut", async () => {
    const many = Array.from({ length: 300 }, (_, i) => [node(i + 1)]);
    const out = await queryData(fakeRunner(many).runner, adapter, { query: "Q" });
    const data = JSON.parse(out);
    expect(out.length).toBeLessThanOrEqual(20_000);
    expect(data.nodes.length).toBeGreaterThan(0);
    expect(data.nodes.length).toBeLessThanOrEqual(100);
    expect(data.truncated).toContain("nodes");
    expect(data).not.toHaveProperty("changes");
  });
  it("reports a committed write without rows", async () => {
    const fake = fakeRunner([], "write");
    const data = JSON.parse(await queryData(fake.runner, adapter, { query: "Q" }));
    expect(fake.calls.map((c) => c.write)).toEqual([true]);
    expect(data.changes).toEqual({ nodesCreated: 1 });
  });
  it("says that a write was committed even if processing the result fails", async () => {
    const broken = fakeRunner(null as unknown as unknown[][], "write");
    await expect(queryData(broken.runner, adapter, { query: "Q" })).rejects.toThrow(/committed.*Do not run the query again/);
  });
});

describe("selection store", () => {
  it("round-trips the selection per connection and clears it", () => {
    const env = { GRAPH_STATE_DIR: mkdtempSync(join(tmpdir(), "gx-")) };
    const a = createSelectionStore({ uri: "bolt://a" }, env);
    const b = createSelectionStore({ uri: "bolt://b" }, env);
    a.write("n1");
    expect(a.read()?.nodeId).toBe("n1");
    expect(b.read()).toBeUndefined();
    a.write(null);
    expect(a.read()).toBeUndefined();
  });
});
