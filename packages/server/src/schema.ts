import { toJson, type Dialect, type Json } from "@mcp-graph-explorer/normalizer";
import type { DialectAdapter } from "./dialect.ts";
import type { QueryRunner } from "./runner.ts";

export interface SchemaEntry { name: string; properties: { name: string; examples: Json[] }[] }
export interface Schema { dialect: Dialect; labels: SchemaEntry[]; relationshipTypes: SchemaEntry[] }

const clip = (value: Json): Json => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 80 ? `${text.slice(0, 80)}…` : value;
};

async function entries(runner: QueryRunner, cypher: string): Promise<SchemaEntry[]> {
  const { rows } = await runner.run(cypher, {}, 100_000);
  const found = new Map<string, Map<string, Map<string, Json>>>();
  for (const [name, props] of rows as [string, Record<string, unknown>][]) {
    const properties = found.get(name) ?? new Map<string, Map<string, Json>>();
    found.set(name, properties);
    for (const [key, value] of Object.entries(props)) {
      const examples = properties.get(key) ?? new Map<string, Json>();
      properties.set(key, examples);
      if (examples.size < 3) {
        const example = clip(toJson(value));
        examples.set(JSON.stringify(example), example);
      }
    }
  }
  return [...found]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, properties]) => ({
      name,
      properties: [...properties].map(([key, examples]) => ({ name: key, examples: [...examples.values()] })),
    }));
}

export async function readSchema(runner: QueryRunner, adapter: DialectAdapter): Promise<Schema> {
  return {
    dialect: adapter.name,
    labels: await entries(runner, adapter.schemaQueries.nodes),
    relationshipTypes: await entries(runner, adapter.schemaQueries.relationships),
  };
}
