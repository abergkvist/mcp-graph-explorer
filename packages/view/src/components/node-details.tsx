import type { GraphNode } from "@mcp-graph-explorer/normalizer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { nodeName } from "../model.ts";
import { cellText } from "./data-table.tsx";

interface Props {
  node: GraphNode;
  busy?: boolean;
  error?: string;
  onExpand(): void;
  onClose(): void;
}

export function NodeDetails({ node, busy, error, onExpand, onClose }: Props) {
  const properties = Object.entries(node.props);
  return (
    <section className="flex max-h-[45%] flex-col border-t" aria-label="Selected node">
      <div className="flex items-center gap-2 px-3 py-2">
        <h2 className="min-w-0 truncate text-sm font-semibold">{nodeName(node)}</h2>
        {node.labels.map((label) => (
          <Badge key={label} variant="secondary">{label}</Badge>
        ))}
        <Button variant="outline" size="sm" className="ml-auto" disabled={busy} onClick={onExpand}>
          {busy ? "Expanding…" : "Expand"}
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close details">×</Button>
      </div>
      {error && <p className="px-3 pb-2 text-xs text-destructive">{error}</p>}
      <dl className="grid min-h-0 grid-cols-[minmax(0,max-content)_minmax(0,1fr)] gap-x-4 gap-y-1 overflow-auto px-3 pb-3 text-sm">
        {node.placeholder && <dd className="col-span-2 text-muted-foreground">This node is not part of the result.</dd>}
        {properties.map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="text-muted-foreground">{key}</dt>
            <dd className="break-words tabular-nums">{cellText(value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
