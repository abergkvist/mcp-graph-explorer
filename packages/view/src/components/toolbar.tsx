import { useMemo } from "react";
import type { GraphResult } from "@mcp-graph-explorer/normalizer";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { labelStyles } from "../model.ts";
import { PALETTE, type Theme } from "../palette.ts";
import { LabelMark } from "./label-mark.tsx";

interface Props {
  result: GraphResult;
  theme: Theme;
  query: string;
  onQuery(query: string): void;
  /** Number of search hits; undefined when not searching. */
  matches?: number;
  hidden: Set<string>;
  onToggle(label: string): void;
}

/** Search, plus the legend, which doubles as the label filter. */
export function Toolbar({ result, theme, query, onQuery, matches, hidden, onToggle }: Props) {
  const legend = useMemo(() => [...labelStyles(result.nodes.flatMap((n) => n.labels.slice(0, 1)))], [result]);
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 pt-2">
      <Input
        type="search"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder="Search nodes"
        aria-label="Search nodes"
        className="h-8 w-40 text-sm"
      />
      {matches !== undefined && (
        <span className="text-xs text-muted-foreground tabular-nums">{matches === 1 ? "1 match" : `${matches} matches`}</span>
      )}
      {legend.map(([label, style]) => (
        <Badge key={label} variant="outline" asChild className={hidden.has(label) ? "opacity-40" : undefined}>
          <button type="button" className="cursor-pointer" aria-pressed={!hidden.has(label)} onClick={() => onToggle(label)}>
            <LabelMark shape={style.shape} color={PALETTE[theme].nodes[style.color]!} />
            {label}
          </button>
        </Badge>
      ))}
    </div>
  );
}
