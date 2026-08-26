// DETAIL PRICE CHART INTERACTION P1 — pure hit-testing helper for the price
// trend chart's tap-to-select / drag-to-scrub crosshair. Recharts' own
// touch handling only recomputes the active point on 'touchmove' (see
// node_modules/recharts/lib/chart/RechartsWrapper.js — 'touchstart' does not
// dispatch the position-lookup middleware), so a plain tap never updates
// anything until the user drags. This finds the nearest rendered data point
// to an arbitrary pointer x position, independent of Recharts' internal
// hover/touch state, so tap and drag can be driven deterministically from a
// single pointerdown/pointermove handler.

export interface IndexedPosition {
  id: number;
  x: number;
}

// positions come from the actual rendered dot cx values (real geometry, not a
// guessed/recomputed scale), so this is exact regardless of chart margins,
// axis widths, or responsive resizing.
export function findNearestIndex(localX: number, positions: IndexedPosition[]): number | null {
  if (positions.length === 0) return null;
  let nearest = positions[0];
  let nearestDist = Math.abs(positions[0].x - localX);
  for (let i = 1; i < positions.length; i++) {
    const dist = Math.abs(positions[i].x - localX);
    if (dist < nearestDist) {
      nearest = positions[i];
      nearestDist = dist;
    }
  }
  return nearest.id;
}
