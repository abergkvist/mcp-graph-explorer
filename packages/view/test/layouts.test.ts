import { describe, expect, it } from "vitest";
import type { GraphEdge, GraphNode } from "@mcp-graph-explorer/normalizer";
import { circularPositions, expansionPositions, geographicPositions, hasCoordinates } from "../src/layouts.ts";

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

  it("does not stack nodes without coordinates on their only neighbour", () => {
    const town = [node("a", { lat: 60, lon: 15 }), node("b", { lat: 61, lon: 17 }), node("p"), node("q"), node("r")];
    const p = geographicPositions(town, [edge("a", "b"), edge("p", "a"), edge("q", "a"), edge("r", "q")]);
    const all = [...p.values()];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) expect(Math.hypot(all[i]!.x - all[j]!.x, all[i]!.y - all[j]!.y)).toBeGreaterThan(1);
    }
  });
});

describe("expanding", () => {
  const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
  const nodes = ["hub", "old", "a", "b", "c", "far"].map((id) => node(id));
  const edges = [edge("old", "hub"), edge("hub", "a"), edge("hub", "b"), edge("c", "hub"), edge("far", "c")];

  it("puts new nodes a normal edge length away from their neighbour, apart from each other", () => {
    const kept = new Map([["hub", { x: 0, y: 0 }], ["old", { x: -80, y: 0 }]]);
    const p = expansionPositions(nodes, edges, kept);
    expect([...p.keys()].sort()).toEqual(["a", "b", "c", "far"]);
    for (const id of ["a", "b", "c"]) {
      expect(distance(p.get(id)!, kept.get("hub")!)).toBeCloseTo(80);
      expect(distance(p.get(id)!, kept.get("old")!)).toBeGreaterThan(80);
    }
    expect(distance(p.get("a")!, p.get("b")!)).toBeGreaterThan(40);
    expect(distance(p.get("far")!, p.get("c")!)).toBeCloseTo(80);
  });
  it("uses a default distance when there is no edge to measure", () => {
    const p = expansionPositions(nodes.slice(0, 1).concat(node("a")), [edge("hub", "a")], new Map([["hub", { x: 5, y: 5 }]]));
    expect(distance(p.get("a")!, { x: 5, y: 5 })).toBeCloseTo(100);
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
