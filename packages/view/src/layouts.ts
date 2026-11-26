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

  spreadStacked(positions, fixed);

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

/** A node with a single route to the coordinates ends up exactly on a neighbour; fan those out. */
function spreadStacked(positions: Map<string, Position>, fixed: Set<string>): void {
  const key = (p: Position) => `${Math.round(p.x)},${Math.round(p.y)}`;
  const piles = new Map<string, string[]>();
  for (const [id, p] of positions) piles.set(key(p), [...(piles.get(key(p)) ?? []), id]);

  const xs = [...positions.values()].map((p) => p.x);
  const radius = Math.max((Math.max(...xs) - Math.min(...xs)) / 40, 5);
  for (const pile of piles.values()) {
    if (pile.length < 2) continue;
    // Nodes with real coordinates stay put.
    const movable = pile.filter((id) => !fixed.has(id));
    movable.forEach((id, i) => {
      const angle = (2 * Math.PI * i) / movable.length;
      const ring = radius * (1 + Math.floor(i / 12));
      const { x, y } = positions.get(id)!;
      positions.set(id, { x: x + Math.cos(angle) * ring, y: y + Math.sin(angle) * ring });
    });
  }
}

/**
 * Positions for nodes added by an expand: a typical edge length from the neighbour they hang on,
 * fanned out away from what is already drawn there. Existing nodes are not moved.
 */
export function expansionPositions(nodes: GraphNode[], edges: GraphEdge[], kept: Map<string, Position>): Map<string, Position> {
  const lengths = edges
    .flatMap(({ source, target }) => {
      const a = kept.get(source);
      const b = kept.get(target);
      return a && b && source !== target ? [Math.hypot(a.x - b.x, a.y - b.y)] : [];
    })
    .sort((a, b) => a - b);
  const length = lengths[Math.floor(lengths.length / 2)] || 100;

  const links = neighbours(nodes, edges);
  const placed = new Map(kept);
  const added = new Map<string, Position>();
  let waiting = nodes.map((n) => n.id).filter((id) => !kept.has(id));

  while (waiting.length) {
    // Group the new nodes that touch something already placed by that anchor.
    const groups = new Map<string, string[]>();
    for (const id of waiting) {
      const anchor = links.get(id)!.find((other) => placed.has(other));
      if (anchor) groups.set(anchor, [...(groups.get(anchor) ?? []), id]);
    }
    if (!groups.size) break;
    for (const [anchor, group] of groups) {
      const centre = placed.get(anchor)!;
      const taken = links.get(anchor)!.flatMap((other) => placed.get(other) ?? []);
      const dx = taken.reduce((sum, p) => sum + p.x - centre.x, 0);
      const dy = taken.reduce((sum, p) => sum + p.y - centre.y, 0);
      const open = Math.atan2(-dy, -dx);
      const radius = length * Math.max(1, group.length / 8);
      group.forEach((id, i) => {
        // A full circle around a lone anchor, otherwise three quarters of one facing the free side.
        const angle = taken.length ? open + ((i + 0.5) / group.length - 0.5) * 1.5 * Math.PI : (2 * Math.PI * i) / group.length;
        const position = { x: centre.x + Math.cos(angle) * radius, y: centre.y + Math.sin(angle) * radius };
        placed.set(id, position);
        added.set(id, position);
      });
    }
    waiting = waiting.filter((id) => !placed.has(id));
  }
  // Nodes without any route to the drawn graph go in a ring around it.
  waiting.forEach((id, i) => {
    const angle = (2 * Math.PI * i) / waiting.length;
    added.set(id, { x: Math.cos(angle) * length * 3, y: Math.sin(angle) * length * 3 });
  });
  return added;
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
