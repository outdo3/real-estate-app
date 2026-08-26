# DETAIL PRICE CHART UI FINAL

## 1. Previous Mobile Problems

Real production mobile screenshots showed three problems in `PriceTrendChart`
("매매·전세 시세 추이"):

- **P0-A**: touching the volume bars / chart interaction area showed a thick
  black rectangular focus box.
- **P0-B**: the white chart card sat inside the page's shared `.container`
  (16px horizontal padding on mobile), leaving a visible gray page-background
  gutter on both sides instead of using the full viewport width.
- **P0-C**: even where the card was wide, the actual Recharts plot area inside
  it was narrower than necessary.

A prior CSS-only attempt at P0-A (`:focus:not(:focus-visible)` /
`:focus-visible` on `.recharts-surface`) did not fully resolve it in real
production.

## 2. Black Focus Root Cause

Traced via Recharts' own source (`node_modules/recharts/lib/container/
RootSurface.js`, `Surface.js`, `context/accessibilityContext.js`), not guessed:

- `useAccessibilityLayer()` defaults to `true` whenever `accessibilityLayer`
  isn't explicitly set on the chart (it isn't, here), which gives the root
  `<svg class="recharts-surface">` — measured live at **the full chart card's
  width and height** (e.g. 1042×350px on desktop) — `tabIndex={0}` and
  `role="application"`.
- Any tap on a volume bar, a line point, or empty plot space is inside that
  `<svg>`, so it (or the click) moves DOM focus to this whole-card-sized
  element — matching the user's description of a rectangle wrapping the whole
  chart, not a single bar.
- `Surface.js` renders a plain `<svg>` with no extra focus-ring element of its
  own — the black box is the browser's native focus outline on this
  `tabIndex=0` `<svg>`, not something Recharts draws.
- The existing `:focus:not(:focus-visible)` CSS rule is spec-correct and was
  verified working in a synthetic Chrome touch-focus simulation in this
  session — but `:focus-visible`'s heuristic for a **manually-tabindexed,
  non-native element** (an `<svg>`, not a `<button>`/`<a>`/`<input>`) is a
  known cross-engine inconsistency; the same live session later reproduced
  `svg.matches(':focus-visible') === true` after an identical pointerdown+
  focus sequence, confirming the heuristic is not deterministic here — which
  is consistent with the CSS-only fix still failing in real mobile.

## 3. Black Focus Fix

Stopped depending on `:focus-visible` for this element entirely. Added a
small, deterministic input-modality tracker scoped to `PriceTrendChart.tsx`:

- A callback ref (`chartRefCallback`) on the `.chart` wrapper div attaches a
  `pointerdown` listener (element-scoped) and a `keydown` listener
  (`document`-scoped, because Tab-into-the-chart fires its keydown on
  whatever element *currently* has focus — often outside `.chart` — not on
  the surface itself).
- `pointerdown` (mouse/touch/pen — any pointer) sets
  `chartDiv.dataset.inputModality = 'pointer'`.
- `keydown` with `key === 'Tab'` sets `dataset.inputModality = 'keyboard'`.
- CSS: `.chart :global(.recharts-surface) { outline: none; }` by default;
  `.chart[data-input-modality='keyboard'] :global(.recharts-surface:focus)`
  is the only rule that ever shows the ring.
- Also hardened `-webkit-tap-highlight-color: transparent` directly on
  `.recharts-surface` and its descendants (previously only set on the
  ancestor `.chart` div) as defense-in-depth against mobile tap-highlight
  rendering independent of the outline/focus mechanism.

**A real bug was caught during verification, not assumed away**: a first
implementation used `useEffect(() => {...}, [])` reading `chartRef.current`.
Because `.chart` only mounts once `hasData` is true (a later render, gated
deep inside the `loading`/`needsAreaSelection`/`hasData` ternary), the effect
ran before the node existed and never attached anything —
`chartDiv.dataset.inputModality` stayed `undefined` forever, confirmed via a
live DOM check in this session. Switched to a callback ref, which fires
exactly when React attaches/detaches the real node regardless of which branch
renders it; re-verified live afterward (see §14 for the exact evidence).

## 4. Full-Bleed Structure

Root cause of the gutter (traced, not guessed): the shared `.container` class
(`src/app/globals.css`) applies `padding: 0 16px` on mobile (`max-width:
768px`) and is used site-wide, including the chart section's wrapper in
`apt-client.tsx`. `.panel.chartPanel` (`detail.module.css`) already goes
`background: transparent; padding: 0` at `max-width: 420px`, so the visible
white card *is* `PriceTrendChart.module.css`'s own `.card` — sitting inside
`.container`'s 16px inset.

Fix, scoped entirely to `.card` in `PriceTrendChart.module.css` (no changes
to `apt-client.tsx`, `.container`, or `.chartPanel` — only this one card goes
full-bleed, per the STEP's explicit scope limit):

```css
@media (max-width: 420px) {
  .card {
    width: 100vw;
    margin-inline: calc(50% - 50vw);
    border: 0;
    border-radius: 0;
    padding: 0.75rem;
  }
}
```

`calc(50% - 50vw)` is self-correcting for whatever the ancestor padding
actually is: `50%` resolves against `.card`'s own containing block width
(`.container`'s content width, already net of its padding), so the formula
cancels exactly whatever gutter exists without hardcoding the 16px value —
robust if `.container`'s padding ever changes elsewhere.

## 5. Plot Width Changes

Reduced from an earlier, more aggressive draft. A first attempt also gave
`.chart` a `margin-inline: -0.5rem` clawback (to shrink further into `.card`'s
own padding beyond the full-bleed background) — **live screenshot QA caught
this clipping the Y-axis price labels** (`4.9억` rendered as `.9억`, missing
its leading digit, at 360/375/390px), because the plot's already-existing
`ComposedChart margin={{ left: -12 }}` needs a few px of buffer past the
`.chart` div's own edge, and the extra clawback ate that buffer. Reverted —
`.chart` keeps `.card`'s existing `0.75rem` (12px) inset with no extra
negative margin. The full-bleed background alone was the fix P0-C actually
needed: previously the plot's usable width was constrained by `16px`
(`.container`) + `12px` (`.card` padding) = `28px` of dead space per side;
now only the `12px` card padding remains, a real, axis-clipping-free width
gain confirmed visually at all three target widths (see §14).

## 6. Axis Compaction

Left/right `YAxis` `width` (44 / 20) and `ComposedChart margin={{ left: -12,
right: 2 }}` were left unchanged — after the full-bleed width gain, axis
labels (`4.9억`…`2.1억`, `0`…`4`) render with no clipping at 360/375/390px in
live QA (see §14), so no further reduction was needed or attempted; per
§5 above, over-tightening this exact area is what caused real clipping once
already. `X-axis` tick config (`interval`, `minTickGap={28}`) is unchanged and
unclipped at all three widths.

## 7. Selector UX

Left `PriceTrendChart`'s own transaction-area `<select>` (already built in
the prior STEP) and its `전용 84.79㎡ · 개별 실거래 기준` label as the single
source of transaction-area selection — no changes to its markup or state
wiring this STEP (state contract is frozen, see §13).

Evaluated adding a duplicate selector near Hero (recommended as a follow-up
in the previous STEP's report) against this STEP's explicit principle: don't
duplicate if the existing flow is already natural. For complexes **without**
Unit Master data (the majority of tested complexes — e.g.
연산동일동미라주더스타), the top `AreaSelector` chips already write directly
into `selectedTradeArea` and drive Hero immediately — the flow is already a
single selector, fully natural, duplicating it would only recreate the "two
selectors, ambiguous which one is authoritative" confusion the state-split
STEP explicitly warned against. For Unit-Master-equipped complexes (e.g.
대신롯데캐슬), the top chips are Unit-Master-identity-only by design (§13) and
the 84㎡-range auto-default already gives Hero/timeline/metrics a sensible
value on load, so most users never need to touch the selector at all.
**Decision: no duplicate selector added this STEP** — documented here as the
explicit judgment call requested by §15/§21 of the STEP prompt, not a
default/oversight.

## 8. Summary Layout

`최근 매매` / `최근 전세` two-column summary — no functional changes; added
`flex-wrap: nowrap` at the mobile breakpoint alongside the legend fix (§ next)
for structural guarantee rather than relying on it being coincidentally narrow
enough not to wrap. Verified in live QA: label above value above date, no
price wrapping, columns balanced, no clipping at 360/375/390px (see §14).

Also hardened `.legend { flex-wrap: nowrap }` at the mobile breakpoint (the
base rule had `flex-wrap: wrap`, which was never observed to actually wrap in
practice, but the STEP explicitly requires "legend wrap 금지" as a guarantee,
not a coincidence).

## 9-11. Mobile 360 / 375 / 390

All three verified live via a 3-column same-page iframe technique (this
project's established workaround — `resize_window` does not change the
top-level page's actual viewport here). Confirmed at all three widths:

- `SIDE_GRAY_GUTTER = 0` (white card touches the injected iframe's edge —
  the true viewport edge — directly).
- Y-axis labels (`4.9억`…`2.1억`), X-axis labels (`23.09`…`25.12`), period
  buttons (`1년/3년/5년`), legend (`매매`/`전세`), volume legend text, and the
  summary block all render with no clipping and no wrapping.
- `document.documentElement.scrollWidth <= window.innerWidth` at all three
  widths (350≤358, 365≤373, 380≤388) — `HORIZONTAL_OVERFLOW = 0`.
- Real (`computer`-tool, not synthetic) clicks on the volume-bar area and on
  a line point at 390px showed the tooltip rendering correctly and **no
  black rectangle** in the resulting screenshot.
- Re-verified on 연산동일동미라주더스타 (no Unit Master) at 375px: same
  full-bleed result, and real Hero/summary/metrics data (`4억 6,000만` /
  `보 3억 2,500만`) rendered correctly with the new layout.

## 12. Desktop

The full-bleed rule is scoped to `@media (max-width: 420px)` only — desktop
(`min-width: 720px` rule bumps `.card` padding to `1.25rem 1.35rem` and chart
height to `350px`, both pre-existing and untouched) is structurally
unaffected. Verified live: the chart card retains its bordered, rounded,
padded appearance at the session's native ~1707px viewport, with no
full-bleed or negative-margin leakage. A real click on the chart at desktop
width also showed no black focus rectangle and a working tooltip.

## 13. State Contract Regression

No change to `selectedUnitMasterArea`, `selectedTradeArea`, their
independence, or any Unit Master ↔ Transaction mapping. This STEP touched
only `PriceTrendChart.tsx` and `PriceTrendChart.module.css` — `apt-client.tsx`,
`InvestmentMetrics.tsx`, `AreaSelector.tsx`, and the `src/lib/trade-area-
selection.ts` / `src/lib/investment-metrics.ts` helpers from the previous
STEP are untouched (confirmed via `git diff --stat`, see §37).
`UNIT_MASTER_AREA_STATE = SEPARATED`, `TRANSACTION_AREA_STATE = SEPARATED`,
`UNIT_TRADE_FORCED_MAPPING = ABSENT`, `CROSS_UNIT_FALLBACK = ABSENT` all still
hold, re-verified live on 대신롯데캐슬: clicking a Unit Master chip did not
change the chart/Hero, matching the previous STEP's documented contract.

## 14. Known Limitations

- **Touch simulation ceiling**: `document.hasFocus()` is `false` in this
  browser-automation environment (confirmed directly), so the CSS `:focus`
  pseudo-class never truly paints regardless of `element.focus()` calls —
  this environment cannot pixel-verify the *final* outline-paint step. What
  *was* verified directly: the DOM-level modality tracking (`pointerdown` →
  `dataset.inputModality = 'pointer'`, Tab `keydown` → `'keyboard'`) fires
  correctly and the CSS attribute selector matches as expected; real
  (non-synthetic) `computer`-tool clicks in an actual rendered page showed no
  visible black box. Genuine mobile-device touch confirmation is still
  recommended: `TOUCH_VISUAL_QA = MANUAL_REQUIRED`.
- The transaction-area `<select>` remains the only interactive selector for
  transaction area (see §7's documented decision not to duplicate it near
  Hero this STEP).
- Plot width is now bounded by `.card`'s own `0.75rem` padding at mobile,
  not by the page's `16px` container gutter — a further, more careful pass at
  shrinking that inset (with per-width clipping verification, unlike the
  reverted attempt in §5) is possible but out of this STEP's scope.
