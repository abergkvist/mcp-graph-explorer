import neo4j from "neo4j-driver";
import type { Json } from "./types.ts";

/** Converts any driver value that is not a graph object into a JSON-safe value. */
export function toJson(value: unknown): Json {
  if (value === null || value === undefined) return null;
  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      return Number.isFinite(value) ? value : String(value);
    case "bigint":
      return value >= Number.MIN_SAFE_INTEGER && value <= Number.MAX_SAFE_INTEGER ? Number(value) : value.toString();
  }
  if (neo4j.isInt(value)) return value.inSafeRange() ? value.toNumber() : value.toString();
  if (
    neo4j.isDate(value) || neo4j.isDateTime(value) || neo4j.isLocalDateTime(value) ||
    neo4j.isTime(value) || neo4j.isLocalTime(value) || neo4j.isDuration(value)
  ) return String(value);
  if (neo4j.isPoint(value)) {
    const point: Record<string, Json> = { srid: toJson(value.srid), x: toJson(value.x), y: toJson(value.y) };
    if (value.z !== undefined) point.z = toJson(value.z);
    return point;
  }
  if (ArrayBuffer.isView(value)) return Array.from(value as Int8Array);
  if (Array.isArray(value)) return value.map(toJson);
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toJson(v)]));
  return String(value);
}
