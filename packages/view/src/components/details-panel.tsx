import type { ReactNode } from "react";
import type { Json } from "@mcp-graph-explorer/normalizer";
import { Button } from "@/components/ui/button";
import { cellText } from "./data-table.tsx";

interface Props {
  label: string;
  title: string;
  badges: ReactNode;
  action?: ReactNode;
  /** Shown above the properties. */
  notice?: ReactNode;
  props: Record<string, Json>;
  onClose(): void;
}

/** The properties of what is selected in the graph. */
export function DetailsPanel({ label, title, badges, action, notice, props, onClose }: Props) {
  const properties = Object.entries(props);
  return (
    <section className="flex max-h-[45%] flex-col border-t" aria-label={label}>
      <div className="flex items-center gap-2 px-3 py-2">
        <h2 className="min-w-0 truncate text-sm font-semibold">{title}</h2>
        {badges}
        <div className="ml-auto flex items-center gap-2">
          {action}
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close details">×</Button>
        </div>
      </div>
      {notice}
      <dl className="grid min-h-0 grid-cols-[minmax(0,max-content)_minmax(0,1fr)] gap-x-4 gap-y-1 overflow-auto px-3 pb-3 text-sm">
        {!properties.length && <dd className="col-span-2 text-muted-foreground">No properties.</dd>}
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
