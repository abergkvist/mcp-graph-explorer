import { describe, expect, it } from "vitest";
import type { GraphEdge, GraphNode } from "@mcp-graph-explorer/normalizer";
import { circularPositions, geographicPositions, hasCoordinates } from "../src/layouts.ts";

const node = (id: string, props: GraphNode["props"] = {}): GraphNode => ({ id, labels: [], props });
const edge = (source: string, target: string): GraphEdge => ({ id: `${source}-${target}`, type: "T", source, target, props: {} });

describe("geographic layout", () => {
  const nodes = [node("a", { lat: 60, lon: 15 }), node("s"), node("b", { lat: 61, lon: 17 }), node("alone")];
  const edges = [edge("a", "s"), edge("s", "b")];

  it("is offered only when at least two nodes have coordinates", () => {
    expect(hasCoordinates(nodes)).toBe(true);
    expect(hasCoordinates([nodes[0]!, node("x", { lat: "north" })])).toBe(false);
    expect(hasCoordinates([node("p", { at: { srid: 4326, x: 15, y: 60 } }), node("q", { latitude: 61, longitude: 17 })])).toBe(true);
  });
  it("puts north up and places nodes without coordinates between their neighbours", () => {
    const p = geographicPositions(nodes, edges);
    expect(p.get("b")!.x).toBeGreaterThan(p.get("a")!.x);
    expect(p.get("b")!.y).toBeGreaterThan(p.get("a")!.y);
    expect(p.get("s")!.x).toBeCloseTo((p.get("a")!.x + p.get("b")!.x) / 2);
    expect(p.get("s")!.y).toBeCloseTo((p.get("a")!.y + p.get("b")!.y) / 2);
    expect(Number.isFinite(p.get("alone")!.x) && Number.isFinite(p.get("alone")!.y)).toBe(true);
  });
});

describe("circular layout", () => {
  it("spreads nodes on one circle with connected nodes next to each other", () => {
    const p = circularPositions([node("a"), node("c"), node("b"), node("d")], [edge("a", "b"), edge("b", "c"), edge("c", "d")]);
    const radius = [...p.values()].map((q) => Math.hypot(q.x, q.y));
    for (const r of radius) expect(r).toBeCloseTo(radius[0]!);
    const order = [...p].sort(([, u], [, v]) => Math.atan2(u.y, u.x) - Math.atan2(v.y, v.x)).map(([id]) => id).join("");
    expect("abcdabcd").toContain(order);
  });
});
