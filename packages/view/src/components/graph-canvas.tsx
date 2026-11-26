import { useEffect, useRef, useState } from "react";
import type { GraphNode, GraphResult } from "@mcp-graph-explorer/normalizer";
import type { LayoutName } from "../layouts.ts";
import type { Theme } from "../palette.ts";
import type { GraphRenderer } from "../renderer.ts";
import { createSigmaRenderer } from "../sigma-renderer.ts";
import { cellText } from "./data-table.tsx";

interface Props {
  result: GraphResult;
  theme: Theme;
  selected: string | null;
  onSelect(id: string | null): void;
  highlight: Set<string> | null;
  hidden: Set<string>;
  layout: LayoutName;
}

interface Pointer { x: number; y: number; width: number; height: number }

export function GraphCanvas({ result, theme, selected, onSelect, highlight, hidden, layout }: Props) {
  const pointer = useRef<Pointer>({ x: 0, y: 0, width: 0, height: 0 });
  const [hovered, setHovered] = useState<{ id: string; at: Pointer }>();
  const element = useRef<HTMLDivElement>(null);
  const renderer = useRef<GraphRenderer>(null);
  // The renderer is created once; it calls whatever handler is current.
  const select = useRef(onSelect);
  select.current = onSelect;

  useEffect(() => {
    renderer.current = createSigmaRenderer(element.current!, {
      onNodeClick: (id) => select.current(id),
      onBackgroundClick: () => select.current(null),
      onNodeHover: (id) => setHovered(id ? { id, at: pointer.current } : undefined),
    });
    return () => renderer.current?.destroy();
  }, []);
  useEffect(() => renderer.current?.setTheme(theme), [theme]);
  useEffect(() => renderer.current?.setGraph(result), [result]);
  useEffect(() => renderer.current?.setLayout(layout), [layout]);
  useEffect(() => renderer.current?.setSelected(selected), [selected]);
  useEffect(() => renderer.current?.setHighlight(highlight), [highlight]);
  useEffect(() => renderer.current?.setHiddenLabels(hidden), [hidden]);

  const node = result.nodes.find((n) => n.id === hovered?.id);

  return (
    <div
      className="relative min-h-0 flex-1 overflow-hidden"
      onPointerMove={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        pointer.current = { x: e.clientX - box.left, y: e.clientY - box.top, width: box.width, height: box.height };
      }}
    >
      <div ref={element} className="absolute inset-0" />
      {node && hovered && <NodeTooltip node={node} at={hovered.at} />}
    </div>
  );
}

function NodeTooltip({ node, at }: { node: GraphNode; at: Pointer }) {
  const properties = Object.entries(node.props).slice(0, 8);
  // Open towards the middle of the canvas so that the box stays inside it.
  const style = {
    left: at.x < at.width / 2 ? at.x + 12 : undefined,
    right: at.x < at.width / 2 ? undefined : at.width - at.x + 12,
    top: at.y < at.height / 2 ? at.y + 12 : undefined,
    bottom: at.y < at.height / 2 ? undefined : at.height - at.y + 12,
  };
  return (
    <div role="tooltip" className="pointer-events-none absolute max-w-64 rounded-md border bg-background px-3 py-2 text-xs shadow-md" style={style}>
      <p className="font-semibold">{node.labels.join(", ") || "Node"}</p>
      {properties.map(([key, value]) => (
        <p key={key} className="truncate">
          <span className="text-muted-foreground">{key}</span> {cellText(value)}
        </p>
      ))}
    </div>
  );
}
