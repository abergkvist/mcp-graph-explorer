import neo4j from "neo4j-driver";
import { describe, expect, it } from "vitest";
import { toJson } from "../src/values.ts";

const { Date: NDate, Point, Duration } = neo4j.types;

describe("toJson", () => {
  it("converts integers, keeping unsafe ones as strings", () => {
    expect(toJson(neo4j.int(42))).toBe(42);
    expect(toJson(neo4j.int("9007199254740993"))).toBe("9007199254740993");
    expect(toJson(10n)).toBe(10);
  });
  it("converts temporal and spatial types", () => {
    expect(toJson(new NDate(2026, 11, 26))).toBe("2026-11-26");
    expect(toJson(new Duration(1, 2, 3, 0))).toBe(new Duration(1, 2, 3, 0).toString());
    expect(toJson(new Point(neo4j.int(4326), 15.6, 60.6))).toEqual({ srid: 4326, x: 15.6, y: 60.6 });
  });
  it("handles nesting and non-JSON values", () => {
    expect(toJson({ a: [neo4j.int(1), null, undefined] })).toEqual({ a: [1, null, null] });
    expect(toJson(NaN)).toBe("NaN");
    expect(toJson(new Int8Array([1, 2]))).toEqual([1, 2]);
  });
});
