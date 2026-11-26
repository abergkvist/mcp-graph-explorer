import type { Json, Table } from "@mcp-graph-explorer/normalizer";

export const cellText = (value: Json): string =>
  value === null ? "–" : typeof value === "object" ? JSON.stringify(value) : String(value);

export function DataTable({ table }: { table: Table }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full border-collapse text-left text-sm tabular-nums">
        <thead className="sticky top-0 bg-background">
          <tr>
            {table.columns.map((column) => (
              <th key={column} className="border-b px-3 py-2 font-medium whitespace-nowrap text-muted-foreground">{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, r) => (
            <tr key={r} className="border-b last:border-0 hover:bg-muted">
              {row.map((value, c) => (
                <td key={c} className="max-w-80 truncate px-3 py-2" title={cellText(value)}>{cellText(value)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
