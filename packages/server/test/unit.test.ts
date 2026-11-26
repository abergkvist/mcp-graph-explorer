import neo4j from "neo4j-driver";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";
import { adapterFor } from "../src/dialect.ts";
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
