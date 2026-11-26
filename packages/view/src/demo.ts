// Made-up example data (not the real network) for `pnpm --filter @mcp-graph-explorer/view dev`; not part of the production build.
import type { GraphResult, Json } from "@mcp-graph-explorer/normalizer";

const lines = [
  ["Stockholm C", "Uppsala C", "Tierp", "Gävle C", "Storvik", "Falun C", "Borlänge C", "Säter", "Hedemora", "Avesta Krylbo", "Sala", "Uppsala C"],
  ["Sala", "Västerås C", "Enköping", "Stockholm C"],
  ["Borlänge C", "Leksand", "Rättvik", "Mora"],
  ["Gävle C", "Söderhamn"],
];

function railway(): Pick<GraphResult, "nodes" | "edges"> {
  const nodes = new Map<string, GraphResult["nodes"][number]>();
  const edges: GraphResult["edges"] = [];
  const station = (name: string) => nodes.set(name, { id: name, labels: ["Station"], props: { name } });
  for (const line of lines) {
    line.slice(1).forEach((to, i) => {
      const from = line[i]!;
      const id = `${from} – ${to}`;
      station(from);
      station(to);
      nodes.set(id, { id, labels: ["TrackSection"], props: { name: id, lengthKm: 20 + i * 7 } });
      edges.push({ id: `${id}:a`, type: "CONNECTS", source: from, target: id, props: {} });
      edges.push({ id: `${id}:b`, type: "CONNECTS", source: id, target: to, props: {} });
    });
  }
  return { nodes: [...nodes.values()], edges };
}

export function demo(kind: string): GraphResult {
  const table = (columns: string[], rows: Json[][]) => ({ columns, rows });
  const base: GraphResult = {
    nodes: [],
    edges: [],
    table: table([], []),
    meta: { danglingEdges: 0, truncated: [], autoConnectedEdges: 0, dialect: "neo4j" },
  };
  if (kind === "table") {
    return { ...base, table: table(["s.name", "s.signature"], [["Gävle C", "Gä"], ["Falun C", "Fln"], ["Borlänge C", "Blg"]]) };
  }
  if (kind === "value") return { ...base, table: table(["count(s)"], [[34]]) };
  if (kind === "empty") return { ...base, table: table(["s.name"], []) };
  return { ...base, ...railway(), table: table(["stations"], [[19]]), meta: { ...base.meta, truncated: kind === "cut" ? ["nodes"] : [] } };
}
