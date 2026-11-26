// The only file that knows about Sigma.
import { MultiDirectedGraph } from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import Sigma from "sigma";
import { extremityArrow, pathCurved, pathLine, pathLoop, sdfCircle, sdfDiamond, sdfSquare, sdfTriangle } from "sigma/rendering";
import type { GraphResult } from "@mcp-graph-explorer/normalizer";
import { labelStyles, nodeName } from "./model.ts";
import { PALETTE, type Theme } from "./palette.ts";
import type { CreateRenderer } from "./renderer.ts";

export const createSigmaRenderer: CreateRenderer = (el, events) => {
  const graph = new MultiDirectedGraph();
  let theme: Theme = "light";
  let data: Pick<GraphResult, "nodes" | "edges"> = { nodes: [], edges: [] };
  let selected: string | null = null;
  let highlight: Set<string> | null = null;
  let hidden = new Set<string>();

  const attribute = (name: string) => ({ attribute: name });
  const sigma = new Sigma(graph, el, {
    primitives: {
      nodes: { shapes: [sdfCircle(), sdfSquare(), sdfDiamond(), sdfTriangle()] },
      edges: { paths: [pathLine(), pathCurved(), pathLoop()], extremities: [extremityArrow()] },
    },
    styles: {
      nodes: {
        x: attribute("x"), y: attribute("y"), size: attribute("size"), color: attribute("color"),
        shape: attribute("shape"), label: attribute("label"), labelColor: attribute("labelColor"),
        visibility: attribute("visibility"), zIndex: attribute("zIndex"), labelVisibility: attribute("labelVisibility"),
        labelSize: 12, cursor: "pointer",
      },
      edges: {
        size: attribute("size"), color: attribute("color"), visibility: attribute("visibility"),
        label: attribute("label"), labelColor: attribute("labelColor"), labelSize: 10,
        head: "arrow", parallelPath: "curved",
      },
    },
    settings: {
      allowInvalidContainer: true,
      itemSizesReference: "screen", // sizes in pixels, not in layout units
      renderEdgeLabels: true,
      labelRenderedSizeThreshold: 4,
      labelDensity: 1.5,
      stagePadding: 40,
    },
  });

  sigma.on("clickNode", ({ node }) => events.onNodeClick(node));
  sigma.on("clickStage", () => events.onBackgroundClick());
  sigma.on("enterNode", ({ node }) => events.onNodeHover(node));
  sigma.on("leaveNode", () => events.onNodeHover(null));

  /** Recomputes everything visual from data, theme, selection, search and label filter. */
  function paint() {
    const colors = PALETTE[theme];
    const styles = labelStyles(data.nodes.flatMap((n) => n.labels.slice(0, 1)));
    const near = new Set<string>(selected && graph.hasNode(selected) ? [selected, ...graph.neighbors(selected)] : []);
    const focus = highlight ?? (near.size ? near : null);

    for (const node of data.nodes) {
      const style = styles.get(node.labels[0] ?? "");
      const faded = focus !== null && !focus.has(node.id);
      const degree = graph.degree(node.id);
      graph.mergeNodeAttributes(node.id, {
        size: Math.min(6 + Math.sqrt(degree) * 1.6, 14) * (node.id === selected ? 1.5 : 1),
        color: faded ? colors.faded : style ? colors.nodes[style.color] : colors.placeholder,
        shape: style?.shape ?? "circle",
        label: faded || node.placeholder ? "" : nodeName(node),
        labelColor: colors.label,
        labelVisibility: node.id === selected ? "visible" : "auto",
        visibility: node.labels.some((label) => hidden.has(label)) ? "hidden" : "visible",
        zIndex: faded ? 0 : 1,
      });
    }
    const showTypes = data.edges.length <= 30;
    for (const edge of data.edges) {
      const faded = focus !== null && !(focus.has(edge.source) && focus.has(edge.target));
      const gone = [edge.source, edge.target].some((id) => graph.getNodeAttribute(id, "visibility") === "hidden");
      graph.mergeEdgeAttributes(edge.id, {
        size: 1.8,
        color: faded ? colors.faded : colors.edge,
        label: showTypes && !faded ? edge.type : "",
        labelColor: colors.label,
        visibility: gone ? "hidden" : "visible",
      });
    }
  }

  return {
    setGraph(next) {
      const positions = new Map(graph.mapNodes((id, a) => [id, { x: a.x as number, y: a.y as number }]));
      data = next;
      graph.clear();
      const known = next.nodes.some((n) => positions.has(n.id));
      next.nodes.forEach((node, i) => {
        const kept = positions.get(node.id);
        const neighbour = next.edges
          .flatMap((e) => (e.source === node.id ? [e.target] : e.target === node.id ? [e.source] : []))
          .map((id) => positions.get(id))
          .find(Boolean);
        const angle = (2 * Math.PI * i) / next.nodes.length;
        const start = kept ??
          (neighbour
            ? { x: neighbour.x + Math.cos(angle) * 10, y: neighbour.y + Math.sin(angle) * 10 }
            : { x: Math.cos(angle) * 100, y: Math.sin(angle) * 100 });
        graph.addNode(node.id, { ...start, fixed: Boolean(kept) });
      });
      for (const edge of next.edges) graph.addDirectedEdgeWithKey(edge.id, edge.source, edge.target, {});
      if (graph.order > 1) {
        forceAtlas2.assign(graph, {
          iterations: known ? 80 : 400,
          settings: { ...forceAtlas2.inferSettings(graph), adjustSizes: false, gravity: 0.8, scalingRatio: 12 },
        });
      }
      paint();
    },
    setSelected(id) { selected = id; paint(); },
    setHighlight(ids) { highlight = ids; paint(); },
    setHiddenLabels(labels) { hidden = labels; paint(); },
    setTheme(next) { theme = next; paint(); },
    destroy: () => sigma.kill(),
  };
};
