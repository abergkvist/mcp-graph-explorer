// How large nodes are drawn, in screen pixels.

/** Grows a little with the number of relationships and with selection, within narrow bounds. */
export function nodeSize(degree: number, selected: boolean, nodeCount: number): number {
  const base = Math.min(6 + Math.sqrt(degree), 9);
  return base * (nodeCount > 100 ? 0.65 : 1) * (selected ? 1.3 : 1);
}

/**
 * Sigma draws a node at `size / zoomSizeRatio(cameraRatio)`; a ratio below 1 means zoomed in.
 * Zooming in should spread nodes apart rather than inflate them, so growth stops early.
 */
export const zoomSizeRatio = (cameraRatio: number): number => Math.max(Math.sqrt(cameraRatio), 0.75);
