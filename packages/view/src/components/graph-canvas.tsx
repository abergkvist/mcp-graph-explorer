import { useEffect, useMemo, useRef } from "react";
import type { GraphResult } from "@mcp-graph-explorer/normalizer";
import { labelStyles } from "../model.ts";
import { PALETTE, type Theme } from "../palette.ts";
import type { GraphRenderer } from "../renderer.ts";
import { createSigmaRenderer } from "../sigma-renderer.ts";
import { LabelMark } from "./label-mark.tsx";

export function GraphCanvas({ result, theme }: { result: GraphResult; theme: Theme }) {
  const element = useRef<HTMLDivElement>(null);
  const renderer = useRef<GraphRenderer>(null);

  useEffect(() => {
    renderer.current = createSigmaRenderer(element.current!, {
      onNodeClick: () => {},
      onBackgroundClick: () => {},
      onNodeHover: () => {},
    });
    return () => renderer.current?.destroy();
  }, []);
  useEffect(() => renderer.current?.setTheme(theme), [theme]);
  useEffect(() => renderer.current?.setGraph(result), [result]);

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
