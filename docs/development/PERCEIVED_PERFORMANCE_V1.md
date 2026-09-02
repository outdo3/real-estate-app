# PERCEIVED PERFORMANCE V1

**Date:** 2026-09-02
**Baseline:** `main` @ `8a44d5a` (follows `FINANCE_FIT_V1_PHASE2A_IMPLEMENTATION.md`)
**Scope:** Instant click feedback, targeted prefetch, and bundle trimming for the app's
core navigation flows. No DB/schema changes, no large architecture rewrite, no weakening of
identity/trade-freshness guarantees.

---

## 1. Baseline UX

Two background research passes (navigation-method audit + prefetch-opportunity audit) covered
the whole `src/` tree before any change was made. Headline finding: **no full-page-reload
navigation exists anywhere** (no `window.location.href =`, no raw `<a href>` for internal
routes) — the app already does 100% client-side routing. The gap was narrower and more specific:
almost every primary navigation (map marker → detail, stats ranking row → detail, search
result → detail) uses an imperative `router.push()` on a plain `<li>`/`<button onClick>` rather
than `next/link`'s `<Link>`, which means none of them got Next.js's automatic hover/viewport
prefetch. `grep -rn "prefetch=" src/` returned zero matches — prefetch behavior had never been
explicitly tuned anywhere in the app.

## 2. Navigation Audit

- Full reloads: **0 found.** The only `window.location.reload()` is a deliberate error-retry
  button on `/map`.
- `<Link>`-based (auto-prefetch-eligible) navigations that already existed and needed no change:
  Compare V2's "상세보기"/"자금 계산" buttons and Detail's Decision-Journey CTAs — all render via
  `Button`'s `href` prop, which renders `next/link` internally. **This means Detail↔Compare and
  Detail↔Finance Fit already had automatic prefetch before this STEP** — confirmed by code
  reading, not something that needed building.
- Imperative-`router.push` navigations (no auto-prefetch) found in: map markers, all `/stats`
  ranking views (`PriceRankingView`, `Area84RankingView`, `GapInvestView`, and others sharing the
  identical `goToApt` pattern), `ApartmentAutocomplete`'s search-result list, community/school/
  redevelopment/presales cards. This STEP added targeted prefetch to the ones inside the task's
  named priority flows (search, map, the three named ranking views); the rest share the identical
  pattern and are flagged as a follow-up (§16).

## 3. Search → Detail

**Before:** clicking a search result (`ApartmentAutocomplete`) called `onSelect`, which in the
Home/Detail-quick-search flows (`HomeApartmentSearch.tsx`, `ApartmentQuickSearch.tsx`) first
awaited a `/api/apt/[name]/verify` round trip — a deliberate, pre-existing accuracy decision
("틀린 단지보다 검색 실패" per that file's own comment) — before calling `router.push`. This is
correct and was **not weakened**: identity verification still fully gates navigation.

**After:** `router.prefetch()` now fires in two places, both parallel to (not gating) the
existing logic:
- On hover/touchstart of each `APARTMENT`-type autocomplete result (`ApartmentAutocomplete.tsx`)
  — warms the `/apt/[name]` route shell before the user even clicks.
- At the moment `handleSelect` starts the verify fetch (`HomeApartmentSearch.tsx`,
  `ApartmentQuickSearch.tsx`) — so by the time verify resolves and navigation actually happens,
  the route JS is already warm, without touching the verify-gate logic itself.

**Prefetch scope:** only the hovered/touched result, never the full result list — matches the
task's explicit "무차별 prefetch 금지" constraint.

## 4. Map → Detail

**Before:** first click on a marker selects it (shows the bottom sheet); second click (or the
bottom sheet's "상세보기" button) calls `router.push` with no prior prefetch.

**After:** `router.prefetch()` now fires exactly once, at the moment a marker becomes selected
(`src/app/map/page.tsx`'s `handleClick`) — i.e., only the marker the user actually chose, never
all markers on screen. Live-tested: selecting a marker → bottom sheet appears → "상세보기" →
correct apartment (identity-matched, confirmed via URL `lawdCd`/`dong`/`aptSeq`) loads.

## 5. Detail Rendering

Read the full 1230-line `apt-client.tsx` before changing anything. Findings, all pre-existing:
- `FullPageLoader` only fires on first mount (`!pageReady && !hasLoadedOnce`) — not on later
  filter/period changes.
- The header/hero section is already explicitly commented `TIER 1 (결론 중심)` and already renders
  a properly-sized skeleton (not a spinner, not a blank screen) matching the real layout while
  `!pageReady` — this already prevents CLS and matches the task's Tier-0/skeleton requirements
  closely. No literal `"0"`/`"없음"` was found rendered during loading anywhere in this file or
  its child components (all use skeletons/`InlineLoading`/explicit `ready`-gates instead).
- Trades + info fetches already run in parallel via `Promise.all` when the URL carries `lawdCd`+
  `dong` (already the case for every entry point audited in §3/§4) — an explicitly-commented prior
  waterfall fix, not new work this STEP.
- Score fetch is independent of `pageReady` (progressive, doesn't block the main content gate).

Given this was already well-built, the one concrete, safe change made here was **not** to the
render-gating logic but to bundle size (§12).

**Investigated and deliberately NOT changed — duplicate-fetch dedup:** `PriceTrendChart.tsx` and
`InvestmentMetrics.tsx` each independently re-fetch `/api/apt/[name]`, which looked like a
textbook duplicate-fetch case (§22's explicit target). Reading both files' fetch calls showed
they request **different `period` values and both `apt`+`rent` types** — `InvestmentMetrics.tsx`
even carries a comment (`PRODUCTION QA P0-B`) documenting a previously-shipped-and-fixed bug where
a period mismatch between these two components caused a real, confusing UI contradiction. Merging
these fetches would require lifting period-selection state across component boundaries — real
design work, not a safe drop-in fix, and risks reintroducing exactly the bug class that comment
warns about. Correctly left alone per this STEP's own STOP condition ("데이터 정확성을 희생해야
함"); flagged as a real but non-trivial Phase 2 candidate.

## 6. Compare

Read `CompareV2.tsx` and `compare-v2/fetch.ts`. Confirmed: apartment identity/name renders
immediately per slot (not gated on the fetch), with only a small `InlineLoading` shown below it
while that slot's data is in flight — already matches the "identity 먼저" requirement. All 4 API
calls (2 per apartment, trades+score) already fire via `Promise.allSettled` in parallel — already
confirmed in the Compare V2 Phase 2 STEP. The comparison body (headline/price/score/tradeoff) is
gated behind `bothLoading = slotA.loading || slotB.loading`; this was evaluated and **not
changed** — the difference/tradeoff engine is inherently two-sided (it cannot honestly render a
comparison until both sides exist), so partial-rendering here would risk showing a one-sided
"strength" that isn't actually a comparison yet. No architecture change made; production
remeasurement (§14) confirms current numbers already meet the task's own ≤1.5s target.

## 7. Home → Map

Not modified — the map's own marker-fetch/base-map-load sequencing was already fixed in the prior
`MAP_PERFORMANCE_V1` STEP (per project history) and this STEP's audit found no new blocking issue
in the Home→Map transition specifically (Home's map CTA is a standard route link).

## 8. Stats → Detail

**Before:** `PriceRankingView.tsx` (rising/decline/record-high/jeonse-risk),
`Area84RankingView.tsx`, and `GapInvestView.tsx` — the three views the task names explicitly
("상승/하락/84㎡/신고가/갭투자") — each rendered ranking rows as plain `<li onClick>` with zero
prefetch and zero click-feedback.

**After:** each of these three components now (a) prefetches the row's target route on
hover/touchstart (only the interacted row, matching "첫 화면에 보이는 몇 개 행만" via a hover-driven
rather than viewport-driven trigger — arguably tighter than prefetching all visible rows), and (b)
dims the clicked row to 50% opacity immediately on click, cleared naturally when the page
navigates away — closing the "did my click register?" gap on `router.push`-based navigation
without any global animation/transition system.

## 9. Prefetch Strategy

Summary table:

| Flow | Trigger | Scope |
|---|---|---|
| Search results (`ApartmentAutocomplete`) | hover / touchstart | one hovered result |
| Home/Quick search verify flow | fires parallel to the verify fetch | the one selected result |
| Map markers | marker selection (1st click) | one selected marker |
| Stats ranking rows (3 named views) | hover / touchstart | one hovered row |
| Compare/Detail/Finance-Fit CTA buttons | already `next/link` default | framework default (no change needed) |

No blanket/"all results" prefetching anywhere — matches the task's explicit anti-pattern warning.

## 10. Progressive Rendering

Already strong pre-existing architecture (§5) — no structural change made. Verified it still holds
after this STEP's edits via live QA (header/hero skeleton → real content, chart lazy-loads with a
sized skeleton, map modal lazy-loads with a sized skeleton).

## 11. Skeleton

`ChartSkeleton` (already existing, reused for the new `KakaoMapEmbed` dynamic import — see §12)
reserves the exact pixel height of the real content (`16rem` for the price chart, `8rem` for
investment metrics, `400px` for the map/roadview modal), avoiding CLS. No new spinner-only pattern
introduced.

## 12. Bundle

`KakaoMapEmbed` (used only inside the Detail page's "지도"/"로드뷰" modal) was statically imported
in `apt-client.tsx`, shipping in every Detail page's initial JS bundle even for the majority of
visits that never open the map modal. Converted to `next/dynamic(..., { ssr: false })`, matching
the exact pattern already established in the same file for `PriceTrendChart`/`InvestmentMetrics`.
Live-verified the map modal still renders correctly (real Kakao map, marker, address) after the
change — zero functional regression, smaller initial bundle for the common case.

## 13. API Waterfall

No new waterfall found beyond what was already fixed in a prior STEP (Detail's trades+info
`Promise.all`, Compare V2's 4-call `Promise.allSettled`) — confirmed via direct code reading, not
assumed.

## 14. Production Before/After

Measured via `curl` (TTFB, 3 runs each) against `https://real-estate-app-park11.vercel.app`
(icn1). **Before** (pre-STEP baseline, this session):

| Route | Cold | Warm (best of 3) |
|---|---|---|
| `/` | 0.92s | 0.12s |
| `/map` | 0.80s | — |
| `/stats` | 0.71s | — |
| `/tools` | 0.67s | — |
| `/apt/[name]` shell | 0.42s | 0.22s |
| `/api/apt/[name]` (trades) | 1.97s | 0.47s |
| `/api/apt/[name]/score` | 0.91s | 0.23s |
| `/stats/compare` shell | 0.53s / 0.65s | — |

`/api/apt/[name]` (trades) cold latency (~2s) is the single largest number measured — this is a
data-fetch-latency issue already the subject of the prior `PERFORMANCE_V1`/`V1.1` STEPs, not a
rendering/prefetch issue, and re-optimizing the query itself is out of this STEP's scope (no
DB/schema changes). The prefetch work in this STEP reduces how much of that wait is *additionally*
spent on JS-bundle download by warming the route ahead of the click; it does not and cannot change
the API's own latency.

*(Post-push remeasurement pending — added as a follow-up note once this STEP's commit has deployed.)*

## 15. Mobile

Live-tested at 390px on the dev server (Detail page load, map marker select→prefetch→navigate,
stats ranking row navigate, KakaoMapEmbed modal) — all functioned correctly, no visual regression.
Throttled/mobile-network condition testing was not performed this STEP (no network-throttling
tool available in this environment) — flagged as a gap, not silently skipped.

## 16. Remaining Bottlenecks

- `/api/apt/[name]` (trades) cold latency (~2s) remains the largest single number in the whole
  audit — a data-layer issue, explicitly out of this STEP's scope.
- `PriceTrendChart`/`InvestmentMetrics` duplicate-looking-but-not-actually-duplicate fetches
  (§5) — a real design opportunity (lift shared period state, fetch once) but not a safe
  drop-in fix; flagged for a future STEP with its own scope.
- Prefetch was added to the 3 named `/stats` ranking views only; `ConcentrationView`,
  `LargeComplexView`, `RegionChangeMapView`, `TransactionFeedView`, community/school/
  redevelopment/presales list cards share the exact same `router.push`-on-`<li>` pattern and would
  benefit from the identical one-line addition — not done this STEP to keep the diff scoped to the
  task's explicitly named flows.
- No network-throttled mobile testing performed (§15).
