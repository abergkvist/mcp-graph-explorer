import { useEffect, useMemo, useRef } from "react";
import type { GraphResult } from "@mcp-graph-explorer/normalizer";
import { labelStyles } from "../model.ts";
import { PALETTE, type Theme } from "../palette.ts";
import type { GraphRenderer } from "../renderer.ts";
import { createSigmaRenderer } from "../sigma-renderer.ts";
import { LabelMark } from "./label-mark.tsx";

interface Props {
  result: GraphResult;
  theme: Theme;
  selected: string | null;
  onSelect(id: string | null): void;
}

export function GraphCanvas({ result, theme, selected, onSelect }: Props) {
  const element = useRef<HTMLDivElement>(null);
  const renderer = useRef<GraphRenderer>(null);
  // The renderer is created once; it calls whatever handler is current.
  const select = useRef(onSelect);
  select.current = onSelect;

  useEffect(() => {
    renderer.current = createSigmaRenderer(element.current!, {
      onNodeClick: (id) => select.current(id),
      onBackgroundClick: () => select.current(null),
      onNodeHover: () => {},
    });
    return () => renderer.current?.destroy();
  }, []);
  useEffect(() => renderer.current?.setTheme(theme), [theme]);
  useEffect(() => renderer.current?.setGraph(result), [result]);
  useEffect(() => renderer.current?.setSelected(selected), [selected]);

  const legend = useMemo(() => [...labelStyles(result.nodes.flatMap((n) => n.labels.slice(0, 1)))], [result]);

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={element} className="absolute inset-0" />
      <ul className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {legend.map(([label, style]) => (
          <li key={label} className="flex items-center gap-1.5">
            <LabelMark shape={style.shape} color={PALETTE[theme].nodes[style.color]!} />
            {label}
          </li>
        ))}
      </ul>
    </div>
  );
}
