import { describe, expect, it } from "vitest";
import { nodeSize, zoomSizeRatio } from "../src/sizing.ts";

describe("node sizes stay in proportion", () => {
  it("lets well connected and selected nodes grow only moderately", () => {
    expect(nodeSize(1000, false, 10) / nodeSize(1, false, 10)).toBeLessThanOrEqual(1.5);
    expect(nodeSize(3, true, 10) / nodeSize(3, false, 10)).toBeLessThanOrEqual(1.35);
    expect(nodeSize(3, true, 10)).toBeGreaterThan(nodeSize(3, false, 10));
    expect(nodeSize(1, false, 500)).toBeLessThan(nodeSize(1, false, 10));
  });
  it("barely grows nodes when zooming in, and shrinks them when zooming out", () => {
    // Sigma draws a node at size / zoomSizeRatio(cameraRatio); a small ratio means zoomed in.
    expect(1 / zoomSizeRatio(0.01)).toBeLessThanOrEqual(1.35);
    expect(zoomSizeRatio(1)).toBe(1);
    expect(zoomSizeRatio(4)).toBe(2);
  });
});
