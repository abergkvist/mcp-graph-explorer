import type { GraphEdge, GraphNode } from "@mcp-graph-explorer/normalizer";
import { Badge } from "@/components/ui/badge";
import { nodeName } from "../model.ts";
import { DetailsPanel } from "./details-panel.tsx";

interface Props {
  edge: GraphEdge;
  source: GraphNode;
  target: GraphNode;
  onClose(): void;
}

export function EdgeDetails({ edge, source, target, onClose }: Props) {
  return (
    <DetailsPanel
      label="Selected relationship"
      title={`${nodeName(source)} → ${nodeName(target)}`}
      badges={<Badge variant="secondary">{edge.type}</Badge>}
      props={edge.props}
      onClose={onClose}
    />
  );
}
