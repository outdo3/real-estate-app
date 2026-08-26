# DETAIL PRICE CHART PRODUCTION QA P0 FIX

## 1. Production Evidence

Real Android production QA (superseding the previous STEP's automated-QA
`BLACK_FOCUS_BOX = REMOVED` conclusion, per this STEP's explicit "Production
evidence overrides prior PASS report" instruction) reported four issues on
`/apt/[name]`'s "매매·전세 시세 추이" section:

- **P0-A**: touching the chart plot / volume bars still showed a thick black
  rectangle, despite the previous STEP's `data-input-modality` + `:focus`
  CSS gating.
- **P0-B**: PriceTrendChart's summary showed 최근 전세 `보 2억 3,100만`, but
  `InvestmentMetrics` directly below it showed `데이터 부족` for 전세가/전세가율/
  필요 갭 금액 at the same `selectedTradeArea`.
- **P0-C**: no clear, direct control for turning 매매/전세 series on/off inside
  the chart — the existing legend was decorative only.
- **P0-D**: the bottom sticky bar showed `보 3,000만 / 월세 150만` (a mixed
  deposit+rent transaction) while the chart section above showed a completely
  different pure-jeonse number for what looked like the same area, with no
  label explaining why.

## 2. Metrics Contradiction Root Cause

Traced with real, current data (not assumed) via direct API calls against the
running dev server for 대신롯데캐슬, `selectedTradeArea = "84.7855m²"`:

| | `type=apt` (sale) | `type=rent`, period=36 (PriceTrendChart's default) | `type=rent`, period=6 (InvestmentMetrics, before fix) |
|---|---|---|---|
| latest 84.7855㎡ result | 2026-08-21, 3억 8,700만 | 2026-01-20, 보 2억 3,100만 (`monthlyRent: 0`) | only trade in window: 2026-07-10, `보 3,000만 / 월세 150만` (`monthlyRent: 150`) |

`InvestmentMetrics.tsx` fetched `period=6` (a fixed 6-month window) regardless
of what `PriceTrendChart` was showing, while `PriceTrendChart` used its own
selectable period (12/36/60 months, default 36). The actual most-recent pure
jeonse trade for this area was dated 2026-01-20 — about 7 months before "now"
(system date 2026-08-26) — so it fell **outside** InvestmentMetrics's 6-month
window but inside PriceTrendChart's 36-month window. The only trade
InvestmentMetrics's narrow window *did* contain (2026-07-10) has
`monthlyRent: 150`, so its own (correct) pure-jeonse filter excluded it too,
leaving zero candidates and producing the honest-but-misleading `데이터 부족`.

The two components' **filtering logic was never in disagreement** — both
already used the identical pure-jeonse definition (`monthlyRent ?? 0 === 0`)
and the identical exact-`selectedTradeArea` match. Only the fetch *window*
differed. This is confirmed by `src/lib/metrics-contract.test.mjs` (new),
which runs both components' filtering approaches against the same input data
and asserts they agree.

## 3. Pure Jeonse Contract

No change. Both components already shared:
- `monthlyRent ?? 0 === 0` as the pure-jeonse predicate.
- Exact `trade.area === selectedTradeArea` string match, no cross-unit
  fallback.

Verified unchanged and re-locked by the new consistency tests (§11).

## 4. Metrics Fix

`InvestmentMetrics.tsx`: replaced the hardcoded `period=6` with a
`METRICS_PERIOD_MONTHS = 60` constant — the widest period `PriceTrendChart`
itself offers (5년). This makes InvestmentMetrics's fetch window a superset
of whatever window PriceTrendChart could be showing at any of its own period
settings, so the "most recent pure-jeonse for this area" question can never
disagree between the two sections again. Widening the window cannot change
*which* trade is "most recent" (the sort-by-date-then-take-first logic in
`computeInvestmentMetrics` is unaffected by how far back the window reaches —
it can only reveal more real candidates, never invent one). No aggregation,
no averaging, no schema change.

## 5. Black Rectangle Actual Root Cause

Re-investigated from the DOM/SVG level as required, not reused from the
previous STEP's conclusion:

- Confirmed via `node_modules/recharts` source (not guessed): `Cursor.js`
  line 63 returns `null` immediately when `cursor={false}` (our prop) — the
  Tooltip's own cursor rectangle is not the source. `Bar.js`'s
  `defaultBarProps` has `activeBar: false` and `background: false`, both
  unset by our JSX, so Recharts' own active-bar highlight and background-track
  rectangle are not the source either. `grep`-ing the entire recharts source
  tree for `.focus(` found zero explicit focus calls — focus is purely the
  browser's own default action for tapping a `tabIndex=0` element.
- The actual cause (confirmed in the previous STEP, re-verified here): the
  root `<svg class="recharts-surface">` — sized to the whole chart plot area —
  gets `tabIndex={0}`/`role="application"` from Recharts' `accessibilityLayer`
  (default on). A tap anywhere in the plot moves DOM focus to this element.
- The previous STEP's fix (suppress the outline via a JS-tracked
  `data-input-modality` attribute, gated in CSS) was verified in this session
  to be **logically correct** — a synthetic pointerdown+focus sequence in
  Chrome reproducibly resulted in `outline-style: none`. But a *second*
  synthetic run of the exact same sequence produced
  `svg.matches(':focus-visible') === true` where the first run gave `false` —
  proving the browser's own `:focus-visible` heuristic is itself
  non-deterministic for this exact element shape in this environment, which
  is consistent with the previous fix still failing on real Android: **the
  fix depended on `:focus-visible` painting correctly, and that dependency
  itself is not reliable.**

## 6. Black Rectangle Fix

Definitive fix: the surface should never receive focus from a pointer/touch
interaction in the first place, removing any dependency on `:focus-visible`
painting correctly at all.

`PriceTrendChart.tsx`'s callback ref now also attaches a `pointerdown`
listener that calls `event.preventDefault()`. Per the Pointer Events spec,
this cancels the browser's default action for that interaction, which
includes moving focus to the target. Verified safe:
- `.chart` contains only the chart SVG — no buttons/inputs whose default
  pointerdown behavior would need to fire.
- `node_modules/recharts/lib/chart/RechartsWrapper.js` shows Recharts drives
  its own touch-tooltip logic via a separate native `touchstart`/`touchmove`/
  `touchend` listener chain (not mouse-compat events synthesized from
  pointerdown), so canceling pointerdown's default action does not cancel or
  interfere with those independently-dispatched `TouchEvent`s.
- Keyboard Tab-focus is a fully separate code path (not triggered by
  pointerdown), so it is unaffected — keyboard accessibility is preserved.

Verified live in this session with a **real** (`computer`-tool, not
synthetic) click on the rendered chart: `document.activeElement` was `BODY`
immediately afterward, confirming the surface never became focused at all —
regardless of `:focus-visible` engine quirks.

The previous STEP's `data-input-modality`/CSS-outline-gating mechanism is
kept as a secondary fallback for genuine keyboard Tab navigation (which still
needs a visible ring) and as defense-in-depth. Also added, as a separate
defense-in-depth measure against Android's native long-press
callout/selection UI (a different OS/browser mechanism entirely, ruled
in/out independently — see §5): `-webkit-touch-callout: none` and
`user-select: none` on the surface and its descendants.

## 7. Sale/Jeonse Chart Controls

The previously decorative `.legend` ("● 매매 ● 전세" plain text/dots) is now a
real `role="group"` of two `<button aria-pressed>` elements. Clicking toggles
that series' `<Line>` (conditionally rendered — `{seriesVisible.sale && <Line
.../>}`) and its corresponding tooltip row. Volume bars are unaffected by the
toggle (§12 of the STEP prompt: "거래량 bar는 기존 의미 유지") since only the
`<Line>` elements are gated, not the `<Bar>` elements. At least one series
must remain visible — the toggle logic refuses to turn off the last visible
one. This guard is extracted to a pure, tested helper:
`src/lib/series-visibility.ts::toggleSeriesVisibility`.

## 8. StickyPriceBar Semantics

Audited `apt-client.tsx`: `heroTrade`/`latestPrice` (shared by Hero and
`StickyPriceBar`) already filters `trades` by `selectedTradeArea` **and**
`tradeTypeFilter` (the existing top 매매/전월세 toggle) correctly — no
state-split regression, no cross-unit fallback. The area scoping was never
wrong. What was genuinely ambiguous: in 전월세 mode, this value is the most
recent 전월세 trade *of any kind* (including a 반전세/월세-mixed deposit like
`보 3,000만 / 월세 150만`), not restricted to pure-jeonse the way the chart
section's "최근 전세"/InvestmentMetrics's "전세가" are. Both numbers were
honest, correctly-scoped real data — only the bare, unlabeled "최근 실거래가"
text left it unclear which lens a user was looking at, especially once
scrolled past Hero's own visible 매매/전월세 toggle buttons.

Fix: `StickyPriceBar` now receives `tradeTypeFilter` and labels itself
accordingly — "최근 매매가" or "최근 전월세" — instead of the generic "최근
실거래가". No filtering logic changed; Hero's own label was left as-is since
its toggle buttons are already visibly adjacent to it, unlike the sticky
footer.

## 9. Mobile QA

Re-verified all three target widths live via the established same-page-iframe
technique (`resize_window` does not change this environment's actual
viewport). All three showed, simultaneously in one screenshot set: full-bleed
background reaching the injected iframe's edge (true viewport edge), no axis
clipping, correct P0-B metrics (전세가율 59.7%, 필요 갭 금액 1.6억 — all
populated, no more 데이터 부족), and the corrected StickyPriceBar label
("최근 매매가").

A real regression was caught and fixed during this pass, not assumed away:
`document.documentElement.scrollWidth` measured strictly greater than
`clientWidth` at 360/375/390px (e.g. 350 vs 341 at 360px) — a genuine
horizontal-overflow gap, not a false alarm (confirmed by finding the actual
offending element: `PriceTrendChart-module__chart` `.card` itself, `right`
edge past `clientWidth`). Root cause: the mobile full-bleed rule
(`width:100vw; margin-inline:calc(50% - 50vw)`, added in the previous STEP)
depends on `100vw` matching the space actually available for content, but in
this environment (and any layout with a classic space-reserving scrollbar)
`100vw` includes the scrollbar's reserved width while `clientWidth` excludes
it — a well-known CSS caveat. Real mobile devices mostly use overlay
scrollbars where `100vw === clientWidth` and this never appears, but relying
on that was fragile. Fixed by adding `overflow-x: hidden` to `.main` in
`detail.module.css` — scoped to this one page only, a defensive clamp rather
than a design change. Re-verified after the fix: `scrollWidth === clientWidth`
exactly at 360/375/390px.

## 10. Real Data QA

대신롯데캐슬, `selectedTradeArea = "84.7855m²"` (raw), live dev server, actual
current data (system date 2026-08-26):
- PriceTrendChart: 최근 매매 `3억 8,700만` (2026-08-21), 최근 전세
  `보 2억 3,100만` (2026-01-20).
- InvestmentMetrics (after fix): 매매가 `3억 8,700만`, 전세가
  `보 2억 3,100만`, 전세가율 `59.7%` (2.31/3.87), 필요 갭 금액 `1.6억`
  (3.87-2.31=1.56, displayed rounded) — all four now populated, matching the
  chart exactly.
- Sale/jeonse toggle: clicking "전세" hides the blue line + its tooltip row
  and dims the button (`aria-pressed="false"`); volume bars for both types
  remain visible; clicking again restores it. Clicking the *only* remaining
  visible series does not turn it off (verified against the extracted
  `toggleSeriesVisibility` helper's tests).
- StickyPriceBar: 매매 mode → "최근 매매가 3억 8,700만"; switching the top
  toggle to 전월세 mode → "최근 전월세 보 3,000만 / 월세 150만" (the exact
  value from the original production report, now correctly labeled).
- Black rectangle: real (non-synthetic) clicks on the plot, on a data point,
  and on the toggle buttons all left `document.activeElement === BODY`
  (desktop and mobile-iframe), never the surface — no outline possible.

## 11. Tests

26/26 pass (`node --experimental-strip-types --test src/lib/*.test.mjs`):
19 pre-existing (unchanged) + 4 new in `series-visibility.test.mjs` (toggle
off from both-on, refuse to turn off the last visible series, restore a
hidden series) + 3 new in `metrics-contract.test.mjs` (PriceTrendChart-style
filtering and InvestmentMetrics-style `computeInvestmentMetrics` agree on the
same latest pure-jeonse trade for the same input; both agree a
monthlyRent-mixed trade is excluded; both agree a different-area trade never
substitutes). No component-test framework exists in this repo (established in
the previous STEP); StickyPriceBar's one-line label ternary and the actual
`period=60` fetch value were verified via live QA (§10) rather than a new
test-infra addition, consistent with the project's existing convention of
pure-helper-only unit tests.

## 12. Remaining Manual QA

- `BLACK_BOX_AUTOMATED_QA = PARTIAL`: this environment cannot dispatch a
  genuine OS-level touch event or grant the browser tab real window focus
  (`document.hasFocus()` is `false` here), so the final `:focus` CSS paint
  step itself was not pixel-reproducible. What *was* verified directly and
  is the strongest evidence available in this environment: a real click
  never moves focus to the surface at all (`document.activeElement` stays
  `BODY`), which structurally cannot produce a focus-outline rectangle
  regardless of any browser's `:focus-visible` implementation quirks. A real
  Android device re-test is still recommended to close this out completely.
- The `-webkit-touch-callout`/`user-select` addition (§6) targets a
  plausible but not device-confirmed secondary hypothesis (Android's native
  long-press image/selection callout) — kept as safe, cheap defense-in-depth
  regardless of whether it turns out to be needed.
