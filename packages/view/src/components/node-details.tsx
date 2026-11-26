import type { GraphNode } from "@mcp-graph-explorer/normalizer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { nodeName } from "../model.ts";
import { DetailsPanel } from "./details-panel.tsx";

interface Props {
  node: GraphNode;
  busy?: boolean;
  error?: string;
  onExpand(): void;
  onClose(): void;
}

export function NodeDetails({ node, busy, error, onExpand, onClose }: Props) {
  return (
    <DetailsPanel
      label="Selected node"
      title={nodeName(node)}
      badges={node.labels.map((label) => (
        <Badge key={label} variant="secondary">{label}</Badge>
      ))}
      action={
        <Button variant="outline" size="sm" disabled={busy} onClick={onExpand}>
          {busy ? "Expanding…" : "Expand"}
        </Button>
      }
      notice={
        <>
          {error && <p className="px-3 pb-2 text-xs text-destructive">{error}</p>}
          {node.placeholder && <p className="px-3 pb-2 text-sm text-muted-foreground">This node is not part of the result.</p>}
        </>
      }
      props={node.props}
      onClose={onClose}
    />
  );
}
