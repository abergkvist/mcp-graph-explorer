// Deterministic layouts. The force layout lives in the renderer, since it works on the drawn graph.
import type { GraphEdge, GraphNode } from "@mcp-graph-explorer/normalizer";

export const LAYOUTS = { force: "Force", geographic: "Geographic", circular: "Circular" } as const;
export type LayoutName = keyof typeof LAYOUTS;
export interface Position { x: number; y: number }

/** lat/lon, latitude/longitude, or any property holding a WGS 84 point. */
function coordinates({ props }: GraphNode): { lat: number; lon: number } | undefined {
  const lat = props.lat ?? props.latitude;
  const lon = props.lon ?? props.longitude;
  if (typeof lat === "number" && typeof lon === "number") return { lat, lon };
  for (const value of Object.values(props)) {
    const point = value as { srid?: unknown; x?: unknown; y?: unknown } | null;
    if ((point?.srid === 4326 || point?.srid === 4979) && typeof point.x === "number" && typeof point.y === "number") {
      return { lat: point.y, lon: point.x };
    }
  }
  return undefined;
}

export const hasCoordinates = (nodes: GraphNode[]): boolean => nodes.filter(coordinates).length >= 2;

const neighbours = (nodes: GraphNode[], edges: GraphEdge[]) => {
  const map = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const { source, target } of edges) {
    map.get(source)?.push(target);
    map.get(target)?.push(source);
  }
  return map;
};

/**
 * Positions from coordinates, without a background map. A node without coordinates goes to the
 * average of its neighbours; one with no route to any coordinate goes in a row underneath.
 */
export function geographicPositions(nodes: GraphNode[], edges: GraphEdge[]): Map<string, Position> {
  const known = nodes.flatMap((n) => {
    const c = coordinates(n);
    return c ? [{ id: n.id, ...c }] : [];
  });
  // Equirectangular projection around the mean latitude; plenty for a regional graph.
  const shrink = Math.cos((known.reduce((sum, c) => sum + c.lat, 0) / (known.length || 1)) * (Math.PI / 180));
  const positions = new Map<string, Position>(known.map((c) => [c.id, { x: c.lon * shrink * 1000, y: c.lat * 1000 }]));
  const fixed = new Set(positions.keys());
  const links = neighbours(nodes, edges);

  // Repeated averaging settles chains of nodes without coordinates evenly between their ends.
  for (let round = 0; round < 200; round++) {
    for (const { id } of nodes) {
      if (fixed.has(id)) continue;
      const around = links.get(id)!.flatMap((other) => positions.get(other) ?? []);
      if (!around.length) continue;
      positions.set(id, {
        x: around.reduce((sum, p) => sum + p.x, 0) / around.length,
        y: around.reduce((sum, p) => sum + p.y, 0) / around.length,
      });
    }
  }

  const placed = [...positions.values()];
  const left = Math.min(0, ...placed.map((p) => p.x));
  const bottom = Math.min(0, ...placed.map((p) => p.y));
  const xs = placed.map((p) => p.x);
  const step = placed.length ? (Math.max(...xs) - Math.min(...xs)) / 20 || 50 : 50;
  const start = placed.length ? Math.min(...xs) : left;
  const lowest = placed.length ? Math.min(...placed.map((p) => p.y)) : bottom;
  nodes
    .filter((n) => !positions.has(n.id))
    .forEach((n, i) => positions.set(n.id, { x: start + (i % 20) * step, y: lowest - step * (2 + Math.floor(i / 20)) }));
  return positions;
}

/** One circle, in depth-first order so that connected nodes tend to be neighbours. */
export function circularPositions(nodes: GraphNode[], edges: GraphEdge[]): Map<string, Position> {
  const links = neighbours(nodes, edges);
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id) || !links.has(id)) return;
    seen.add(id);
    order.push(id);
    links.get(id)!.forEach(visit);
  };
  // Start at the ends of chains, so that a line is not split in the middle.
  [...nodes].sort((a, b) => links.get(a.id)!.length - links.get(b.id)!.length).forEach((n) => visit(n.id));
  const radius = Math.max(100, order.length * 5);
  return new Map(
    order.map((id, i) => {
      const angle = (2 * Math.PI * i) / order.length;
      return [id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }];
    }),
  );
}
