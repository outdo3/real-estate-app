# DETAIL TRADE AREA STATE SPLIT V1

## 1. Previous Conflated State

`src/app/apt/[name]/apt-client.tsx` held a single `selectedArea: string` state
written by three sources: the top `AreaSelector` chip bar, `PriceTrendChart`'s
own unit `<select>`, and an auto-selection effect on trade load. The same value
was read by `filteredTrades` (Hero, `TradeTimelineList`, `AptSpecGrid` context),
`PriceTrendChart`, and `InvestmentMetrics`.

`AreaSelector` sourced its chip values from `unitMaster.map(u =>
u.canonicalExclusiveArea)` whenever Unit Master data existed for the complex,
falling back to raw `trade.area` only when it didn't
(`src/components/AreaSelector.tsx:38-40`). Every other consumer filtered with
exact string equality against raw `trade.area`
(`trade.area !== selectedArea` in `apt-client.tsx`;
`trade.area === selectedArea` in `InvestmentMetrics.tsx`;
`filterTradesForArea` in `price-trend-data.ts`).

## 2. Root Cause

Unit Master `canonicalExclusiveArea` and transaction API `trade.area` are two
different identity domains with no verified 1:1 mapping:

- No shared unit suffix convention. Real production data confirms
  `canonicalExclusiveArea` is a bare number string (`"84.7855"`) while raw
  `trade.area` carries a unit suffix (`"84.7855m²"`) — verified via
  `/api/apt/대신롯데캐슬/info` and `/api/apt/대신롯데캐슬?type=apt` on 2026-08-26.
- Even ignoring the suffix, precision can differ, and the codebase already
  treats micro-variants (e.g. `59.8826` vs `59.8839`) as distinct identities
  that must never be merged.

When a complex had Unit Master data, clicking any top chip set `selectedArea`
to a Unit Master canonical string. Every downstream exact-match filter then
compared that string against raw `trade.area` and never matched — Hero,
`InvestmentMetrics`, `TradeTimelineList`, and `PriceTrendChart` all silently
fell back to their "no data" states even though real trades existed. Confirmed
live for 대신롯데캐슬 (8 Unit Master types, 108 real sale trades, previously 0
matches for any chip) and 대신해모로센트럴아파트 (10 Unit Master types, same
mismatch pattern).

## 3. selectedUnitMasterArea Contract

- Holds Unit Master `canonicalExclusiveArea` identity only, or `'전체'`.
- Written only by the top `AreaSelector` when `hasUnitMaster` is true (its
  existing chip-sourcing branch, unchanged).
- Read only to highlight the active chip inside `AreaSelector` itself
  (`hasUnitMaster ? selectedUnitMasterArea : selectedTradeArea` passed as its
  `selectedArea` prop from `apt-client.tsx`).
- Never used to filter, join, or fetch transaction data.
- No auto-default is applied — it starts and stays `'전체'` until a user
  clicks a Unit Master chip. There is no verified rule yet for which Unit
  Master type should be "default."

## 4. selectedTradeArea Contract

- Holds raw transaction API `trade.area` identity only, or `'전체'`.
- Written by: the top `AreaSelector` when `hasUnitMaster` is false (its raw
  fallback branch already produced raw values, so this is not a new mapping);
  `PriceTrendChart`'s own unit `<select>`; and the 84㎡-range default-selection
  effect on trade load (`pickDefaultTradeArea`).
- Read by `filteredTrades` (Hero, `TradeTimelineList`, timeline summary label,
  `AptSpecGrid`'s surrounding context), `PriceTrendChart`, and
  `InvestmentMetrics`.
- `apt-client.tsx` dispatches `AreaSelector`'s `onSelect` through
  `handleAreaSelectorChange`, which mirrors `AreaSelector`'s own
  `hasUnitMaster` branch exactly — so a chip click always writes into the
  state whose identity domain matches the value `AreaSelector` actually
  produced, never a cross-domain write.

## 5. Transaction Selector Source

`src/lib/trade-area-selection.ts::buildTransactionAreaOptions(saleTrades,
pureJeonseTrades)` — union of raw sale + pure-jeonse (`monthlyRent === 0`)
`trade.area` values, deduplicated via `Set`, sorted ascending by
`parseFloat`. Never reads Unit Master. Used by `PriceTrendChart`'s
`selectableAreas` (replacing its previous inline calculation with identical
semantics). `AreaSelector`'s no-Unit-Master fallback path already sourced raw
areas directly from `trades` and is unchanged.

## 6. Default Selection Policy

`src/lib/trade-area-selection.ts::pickDefaultTradeArea(trades)`:
1. Group by raw `area`, keep each area's most recent trade by `tradeDate`.
2. If any candidate's `parseFloat(area)` is in `[84, 85)`, restrict to those.
3. Sort the remaining pool by `tradeDate` descending, take the first.
4. Empty input → `'전체'`.

This is the same logic previously inlined in `apt-client.tsx`, extracted
unchanged for testability and reused verbatim (see §11 for real-data
verification, including the 대신롯데캐슬 tie-break between `84.7855m²` and
`84.995m²`).

## 7. Chart Contract (PriceTrendChart)

`selectedTradeArea`/`selectedTradeAreaLabel` props (renamed from
`selectedArea`/`selectedAreaLabel`) carry raw trade-area identity exclusively.
`unitMaster` is retained only for `unitLabel()`'s display enrichment — an
exact-string lookup that gracefully falls back to a formatted raw label when
no match exists (unchanged, still non-authoritative). `onSelectArea` now wires
to `setSelectedTradeArea` directly. Individual-trade rendering, 1/3/5-year
periods, and no aggregation are all unchanged.

## 8. Recent Sale / Rent (InvestmentMetrics)

Extracted to `src/lib/investment-metrics.ts::computeInvestmentMetrics(
saleTrades, rentTrades, selectedTradeArea)` — byte-for-byte the same filter,
sort, and pure-jeonse narrowing logic that was previously inline in
`InvestmentMetrics.tsx`, moved only for unit-testability. No `'전체'`/cross-area
fallback existed before and none was introduced.

## 9. Jeonse Ratio / Gap

Computed inside the same `computeInvestmentMetrics` call — `matchedRent` is
found only among rent trades already narrowed to `selectedTradeArea`, so a
ratio/gap is only ever produced when both sides share the exact same raw
area. Verified with real sale-only (`83.8957m²`) and rent-only (`49.839m²`)
areas at 대신해모로센트럴아파트: both correctly report `데이터 부족`, no
cross-unit substitution.

## 10. Timeline (TradeTimelineList)

Receives `filteredTrades` (already narrowed by `selectedTradeArea` in
`apt-client.tsx`) — no `selectedArea`-shaped prop of its own, so no wiring
change was needed. Its own `unitMaster` lookup is unchanged: a display-only,
exact-string enrichment attempt on each row's raw `trade.area`, with the same
graceful fallback as before.

## 11. Sticky/Hero Semantics

Hero's price block (`heroTrade`, `latestPrice`, max/min, price-context string)
now derives from `filteredTrades`, which filters on `selectedTradeArea`
exclusively — this is the "Transaction price context" per AGENTS.md §15.
`StickyPriceBar` takes only the already-resolved `latestPrice` string; its
interface was unchanged. The top chip bar (Unit Master browsing, when present)
no longer feeds Hero — see §13 for why this is required, not a regression.

## 12. Cross-unit Protection

No component performs a cross-area fallback for sale, rent, ratio, or gap.
`filteredTrades`'s area check remains a strict `!==` guard with no substitute
area. `computeInvestmentMetrics` returns `null` fields rather than borrowing
another area's data. Verified with real sale-only/rent-only areas (§9).

## 13. Known Limitation

For complexes with Unit Master data, the top `AreaSelector` chips no longer
drive Hero/Chart/Timeline/Metrics directly — they only track Unit Master
identity (household count, representative pyeong, in the "전체 평형" modal).
Selecting a specific raw transaction area for those complexes currently
requires `PriceTrendChart`'s own dropdown (visible after scrolling to the
price-trend card). This is an intentional consequence of §17 in the STEP
prompt ("모르는 관계를 아는 척 연결하지 않는다") — the previous behavior looked
more convenient but silently produced false "no data" states for every
Unit-Master-equipped complex tested. Relocating or duplicating a
transaction-area selector nearer the Hero block is deferred to
`DETAIL_PRICE_CHART_UI_FINAL` per this STEP's scope limits (§22 of the STEP
prompt).

`selectedUnitMasterArea` currently has no consumer beyond its own chip
highlight — there is no other Unit-Master-identity-driven UI on this page yet.

## 14. Future Canonical Mapping

If a verified, deterministic Unit Master ↔ transaction mapping is built later
(e.g. a backfilled join table keyed by a stable identifier, not string
equality on area), `selectedUnitMasterArea` selection could then safely derive
a `selectedTradeArea` default. Until such a mapping exists and is verified,
the two states must remain independent.

## 15. Regression Tests

- `src/lib/trade-area-selection.test.mjs` (6 tests): raw union/dedup/sort,
  84.7855 vs 84.9950 and 59.8826 vs 59.8839 stay distinct, empty→`'전체'`,
  84-range preference, 84-range tie-break by most recent date, fallback to
  most-recent-overall when no 84-range area exists.
- `src/lib/investment-metrics.test.mjs` (6 tests): same-area sale/rent match
  with correct ratio/gap, different-area leaves ratio/gap unavailable
  (no cross-unit fallback), sale-only, rent-only, mixed 전세/반전세 excluded,
  no-area-selected returns all-unavailable.
- Existing `src/lib/price-trend-data.test.mjs` (3 tests) continues to pass
  unchanged and already covers exact-vs-rounded area filtering.
- Run: `node --experimental-strip-types --test src/lib/*.test.mjs` → 19/19
  pass (see §16).
- No component-test framework (Jest/RTL/Vitest) exists in this repo — adding
  one was out of this STEP's scope. `selectedUnitMasterArea`/`selectedTradeArea`
  independence is therefore verified structurally (separate `useState` calls,
  a single dispatcher whose branch mirrors `AreaSelector`'s own
  `hasUnitMaster` check) and confirmed against a live dev server with real
  production data (§16), rather than by a component-level unit test.

## 16. Real Data QA (2026-08-26, local dev server, live DB)

**대신롯데캐슬** (Unit Master: 8 types, sale: 108 trades, rent: 309 trades,
120-month window):
- Raw sale areas: `59.8826m², 59.8839m², 84.7855m², 84.995m², 102.7835m²,
  129.7178m²`. Unit Master canonical: `33.2024, 59.8826, 59.8839, 84.7855,
  84.995, 102.7835, 129.7178` (bare, no `m²` suffix — confirms §2).
- `pickDefaultTradeArea` picked `84.7855m²` (latest 2026-08-21, 3억 8,700만)
  over the other 84-range candidate `84.995m²` (latest 2026-04-27) — correct
  tie-break by most recent date.
- Browser: Hero loaded showing `3억 8,700만 · 전용 84.79m² · 2026.08.21 · 9층`
  with no chip highlighted (Unit Master identity untouched). Clicking the top
  `전용 85m²` chip (canonicalExclusiveArea `84.995`) highlighted it but Hero's
  price **did not change** — proving no forced mapping. Changing
  `PriceTrendChart`'s own dropdown to `전용 85m²` (raw `84.995m²`) updated
  Hero to `4억 3,000만 · 전용 85m² · 2026.04.27 · 5층`, matching the raw API
  data exactly, and the chart/summary updated together.
- `InvestmentMetrics` at `84.995m²`: 매매가 `4억 3,000만` (6-month window,
  unchanged pre-existing fetch scope); 전세가/전세가율/갭 correctly show
  `데이터 부족` because the matching pure-jeonse trade (2026-02-08) falls just
  outside `InvestmentMetrics`'s independent 6-month window — verified as a
  pre-existing, untouched design (`period=6` fetch), not a regression;
  `PriceTrendChart`'s own 3-year-window summary correctly shows that same
  rent (`보 2억 9,000만`, 2026-02-08).

**연산동일동미라주더스타** (no Unit Master; `unitTypes: []`):
- Raw sale/rent areas: `31.7359m², 39.2018m², 70.9956m², 77.3526m², 77.86m²`.
- `AreaSelector` fallback path chips are raw areas already; `handleAreaSelectorChange`
  correctly routed to `setSelectedTradeArea`. Browser: `71m²` chip auto-highlighted,
  Hero showed `4억 6,000만 · 전용 71m² · 2026.08.05 · 28층` — matches
  `TRADE_DATA_TRUST_REPRO_AUDIT.md`'s independently documented latest trade
  (`2026-08-05, 4억 6,000만, 70.9956㎡`) exactly. No regression.

**대신해모로센트럴아파트** (third benchmark; Unit Master: 10 types, sale: 111,
rent: 288, 120-month window) — also used as the sale-only/rent-only case:
- Real sale-only area: `83.8957m²` (present in sale, absent from pure-jeonse
  rent). Real rent-only area: `49.839m²` (present in pure-jeonse rent, absent
  from sale). Ran `computeInvestmentMetrics` against the live-fetched trades:
  sale-only → `latestSale` populated, `matchedRent`/`jeonseRate`/`gap` all
  `null`; rent-only → all fields `null`. No cross-unit substitution occurred.

**84/59 collision preservation**: confirmed directly in the 대신롯데캐슬
Unit Master response and `buildTransactionAreaOptions` output — `84.7855` and
`84.995` remained distinct entries; `59.8826` and `59.8839` remained distinct
entries; none were merged by rounding.

## Validation

- `node --experimental-strip-types --test src/lib/*.test.mjs`: PASS, 19/19
  (6 new trade-area-selection + 6 new investment-metrics + 3 existing
  price-trend-data + 4 existing trade-read-state).
- `npx tsc --noEmit`: `FAIL_EXISTING_SCRIPT_ERRORS`. All reported errors are
  under `scripts/` (pre-existing, e.g. missing `shapefile`/`adm-zip` types,
  a pre-existing `formatPyeong` export mismatch in verification scripts).
  Zero errors under `src/`.
- `npx eslint` targeted on the 5 changed/added files: 0 errors, 0 warnings.
- `npm run lint` (full repo): 1640 errors / 63821 warnings, entirely
  pre-existing across `scripts/`, `.worktrees/`, and unrelated `src/`
  components (`ApartmentScoreCard.tsx`, `ViewTracker.tsx`, `auth.ts`,
  `ai-search-client.tsx`). `apt-client.tsx`'s only entry is the same
  pre-existing "unused eslint-disable" warning noted in
  `TRADE_DATA_TRUST_REPRO_AUDIT.md`. None of the newly added/modified files
  (`trade-area-selection.ts`, `investment-metrics.ts`, `PriceTrendChart.tsx`,
  `InvestmentMetrics.tsx`) appear in the full-lint output at all.
- `npm run build`: PASS (Next.js 16.3.0, Turbopack, all 35 static pages +
  dynamic routes compiled successfully).
- Real-data QA: see §16. Mobile QA at 390px (iframe-viewport technique, since
  `resize_window` does not change the actual page viewport in this
  environment) showed no horizontal overflow, no clipped text, correct chip
  scroll, and correct chart-card layout on both the Hero/chip section and the
  price-trend chart section. 360px/375px were not independently re-tested —
  no width-specific breakpoints exist in the touched components (AreaSelector
  uses `overflow-x: auto` flex, PriceTrendChart uses `ResponsiveContainer`),
  so 390px behavior is expected to hold; flagged as `MANUAL_VISUAL_QA_REQUIRED`
  for 360/375 specifically. Desktop QA (native ~1707px viewport) confirmed
  directly via the same screenshots.

## Files Changed

- `src/lib/trade-area-selection.ts` (new)
- `src/lib/trade-area-selection.test.mjs` (new)
- `src/lib/investment-metrics.ts` (new)
- `src/lib/investment-metrics.test.mjs` (new)
- `src/components/PriceTrendChart.tsx` (prop rename + helper reuse)
- `src/components/InvestmentMetrics.tsx` (prop rename + helper reuse)
- `src/app/apt/[name]/apt-client.tsx` (state split, dispatcher, wiring)
- `docs/development/DETAIL_TRADE_AREA_STATE_SPLIT_V1.md` (this file)

## DB / Schema

DB WRITE: NONE. SCHEMA CHANGE: NONE. MIGRATION: NONE. Read-only queries only,
via the existing `/api/apt/[name]` and `/api/apt/[name]/info` routes.
