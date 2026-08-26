# DETAIL PRICE CHART INTERACTION P1 — TAP-TO-SELECT / CROSSHAIR UX FIX

## 1. Previous Mobile Problems

- **P1-A**: tapping a specific x position on the chart did not immediately move
  the active point/tooltip there — it stuck on whatever was last active until
  the user dragged left/right.
- **P1-B**: the currently-active point had no strong visual guide (no
  crosshair), so it wasn't obvious which x position the tooltip referred to.
- **P1-C**: touching a line, a bar, or empty plot space should all react to
  the nearest x position identically.

## 2. Root Cause

Traced directly in `node_modules/recharts/lib/chart/RechartsWrapper.js`, not
assumed: Recharts wires `onTouchStart`, `onTouchMove`, and `onTouchEnd`
separately for touch. Only `onTouchMove`'s handler
(`myOnTouchMove`) dispatches `touchEventsMiddleware`'s position-lookup action,
which is what recomputes which data point is "active." `onTouchStart`'s
handler (`myOnTouchStart`) only forwards to an external handler prop (which we
don't set) — it never triggers that recomputation. So a plain tap
(touchstart + touchend with no meaningful movement) never updated the active
point at all; only a drag, which generates `touchmove` events, did. Mouse
hover was unaffected by this specific gap (continuous `mousemove` already
drove Recharts' own tracking correctly), which is why the bug was
touch-specific.

## 3. Tap-to-Select Implementation

`activeIndex` is now a fully self-managed `useState<number | null>` in
`PriceTrendChart.tsx`, decoupled from Recharts' own internal hover/touch
state. A `pointerdown` handler on the `.chart` wrapper computes the nearest
data point to the tap position immediately (see §9), so the very first tap
selects a point — no drag required.

Nearest-point lookup is a pure, unit-tested helper:
`src/lib/chart-crosshair.ts::findNearestIndex(localX, positions)`. `positions`
comes from the actual rendered dot `cx` values (captured via a custom `dot`
render-prop on both `<Line>` series — see §5), not a recomputed/guessed
scale from chart margins and axis widths, so it can never drift out of sync
with layout, responsive resizing, or future margin tweaks.

**A real bug was caught during verification, not assumed away**: an initial
version reset `activeIndex` to `null` in a `useEffect(() => {...}, [points])`.
`points` is a `useMemo` built from `saleTrades`/`rentTrades`, which are
recomputed as *new array references* on every single render (they were never
memoized) — so the memo built on them was never referentially stable either,
meaning that effect actually fired on every render and immediately nulled out
`activeIndex` right after a tap set it, making tap-to-select appear to do
nothing. Caught via live DOM inspection (dispatching a synthetic pointerdown
at an exact known dot position and observing `activeIndex`'s effects were
present only for ~1 render before disappearing), not by assumption. Fixed by
keying the reset effect on the actual primitive values that determine a real
data change instead: `[selectedTradeArea, period]`.

## 4. Drag-to-Scrub Behavior

The same `pointermove` handler that powers desktop hover-follow also drives
mobile drag-to-scrub, with no separate code path: `pointermove` fires
continuously while a mouse hovers (no button needed) and, for touch, only
while a finger is actively down and moving (there is no touch "hover"
concept) — so one handler naturally covers both. `el.setPointerCapture()` is
called on `pointerdown` so the drag keeps tracking smoothly even if the
pointer briefly leaves the element's bounds mid-drag. Verified live: dragging
from one side of the chart to the other moved the crosshair/tooltip
continuously and ended at the exact release position's nearest point.

Real mouse `pointerleave` (not touch — touch has no hover concept) clears
`activeIndex`, matching prior hover-based behavior; lifting a touch finger
deliberately leaves the crosshair on the last point (expected mobile chart
behavior, matching native map/chart apps), it does not clear on
`pointerup`/`touchend`.

## 5. Crosshair Implementation

## 6. Vertical Line

`<ReferenceLine x={activeIndex} yAxisId="price" stroke="#94a3b8" strokeWidth={1}
strokeDasharray="3 3" />`, Recharts' own official reference-line component —
rendered only when `activeIndex !== null`. Recharts computes its exact pixel
position internally from the same scale as the data itself, so it is always
pixel-perfect aligned with the active point regardless of chart margins or
responsive width. Thin, dashed, muted gray per the "얇고 희미한" requirement.

## 7. Horizontal Line

Added as a secondary guide, per series, only when that series is both
visible (`seriesVisible`) and has a non-null value at the active point (each
point belongs to exactly one series — see `buildPriceTrendPoints` — so at
most one horizontal guide renders per real point): `<ReferenceLine
y={activePoint.salePrice or rentPrice} yAxisId="price" stroke={series color}
strokeOpacity={0.3} strokeWidth={1} strokeDasharray="2 4" />`. Kept
intentionally fainter/thinner than the vertical line per the STEP's stated
priority (vertical > horizontal).

## 8. Tooltip Behavior

`<Tooltip>`'s `active`/`defaultIndex` props (Recharts v3's documented,
official replacement for manually-managed active state — see
`node_modules/recharts/types/component/Tooltip.d.ts`, which links
`https://recharts.github.io/en-US/guide/activeIndex/`) are now driven by our
own `activeIndex`: `active={activeIndex !== null}
defaultIndex={activeIndex !== null ? String(activeIndex) : undefined}`. The
existing tooltip content contract (date, 매매/전세 rows gated by
`seriesVisible`, daily transaction counts) is completely unchanged — only
*which* point it displays is now under our control instead of Recharts'
internal touch tracking.

## 9. Active Marker Behavior

The same custom `dot` render-prop that captures position data (§3) also
decides the active point's appearance directly — replacing Recharts'
built-in `activeDot` (`activeDot={false}` on both `<Line>`s) so there is a
single, guaranteed-consistent source of truth for "which point is active"
instead of two potentially-divergent mechanisms. The active point renders at
`r=5` with a white 2px stroke (vs. `r=2.5`, no stroke, for inactive points);
its fill color still identifies which series it belongs to (green = 매매,
blue = 전세), so with both series visible there is never ambiguity about
which value the enlarged dot represents.

## 10. Black Rectangle Regression

None. The P0 fix (`preventDefault()` on `pointerdown` so the chart surface
never becomes `document.activeElement` from a pointer interaction) is
untouched — the new hit-testing/crosshair `pointerdown`/`pointermove`/
`pointerup`/`pointerleave` listeners were added alongside it in the same
callback-ref registration, not in place of it. Re-verified live after every
interaction test in this STEP (tap, drag, toggle-then-tap, on both desktop
and mobile-iframe): `document.activeElement` stayed `BODY`, never the
surface, in every case.

## 11-13. Mobile 360 / 375 / 390

All three verified live via the established same-page 3-column iframe
technique. For each width: tap (via a `pointerType: 'touch'` pointerdown
dispatched at a real rendered dot's exact screen position) immediately
produced `refLineCount: 2` (vertical + one horizontal guide) and a `visible`
tooltip; `document.activeElement` stayed `BODY` (no black box);
`document.documentElement.scrollWidth === clientWidth` at all three widths
(no horizontal overflow regression from the previous STEP's full-bleed fix);
InvestmentMetrics values (59.7% / 1.6억) rendered identically to desktop, no
regression.

## 14. Desktop

Verified with **real** (`computer`-tool, trusted) clicks and drags, not only
synthetic dispatch — see §4. A single real click immediately moved the
crosshair/tooltip to the tapped point's nearest neighbor; a real click-drag
from one side of the chart to the other continuously updated the active
point and settled on the release position. `document.activeElement`
confirmed `BODY` after both. No full-bleed/mobile-only CSS leaks into
desktop (unrelated to this STEP's changes, which are JS/interaction-only).

## Known Limitation

Coordinate-testing this specific chart via the `computer` tool's screenshot-
space clicks required discovering and accounting for a ~1.088x scale factor
between screenshot pixels and actual CSS pixels in this environment (verified
empirically by logging `event.clientX/clientY` from a real dispatched click
against the intended screenshot coordinate) — this is a property of the
browser-automation harness itself, not of the app; real device touch input
is unaffected.

## Files Changed

- `src/components/PriceTrendChart.tsx` — activeIndex state, pointer hit-
  testing, custom dot render-props, ReferenceLine crosshair, controlled
  Tooltip.
- `src/lib/chart-crosshair.ts` (new) — `findNearestIndex` pure helper.
- `src/lib/chart-crosshair.test.mjs` (new) — 6 tests.
- `docs/development/DETAIL_PRICE_CHART_INTERACTION_P1.md` (this file).
- `docs/development/CHANGELOG.md`.

## Tests

`node --experimental-strip-types --test src/lib/*.test.mjs` → 32/32 pass (26
pre-existing baseline unchanged + 6 new in `chart-crosshair.test.mjs`: exact
hit, between-two-points nearest-neighbor, clamp left of plot, clamp right of
plot, empty-position-set returns null, tie-break behavior). No component-test
framework exists in this repo (established in prior STEPs); the React-level
interaction (pointer events → state → Recharts rendering) was verified live
against the running dev server instead, both via synthetic dispatch (for
precise, reproducible coordinate control) and real `computer`-tool
clicks/drags (for trusted-event confidence) — see §4/§14.

## DB / Schema

DB WRITE: NONE. SCHEMA CHANGE: NONE. MIGRATION: NONE.

## selectedTradeArea / Data Contract

Unchanged. `activeIndex` operates purely on the already-fetched, already-
area-filtered `points` array — it never re-fetches, never changes which raw
trade area is selected, and never introduces a cross-unit fallback. 매매/전세/
전세가율/갭 calculation logic in `InvestmentMetrics`/`PriceTrendChart`'s summary
strip is untouched and was re-verified showing identical values (59.7% /
1.6억) throughout this STEP's QA.
