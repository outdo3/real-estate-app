# PERFORMANCE V1 — User-Perceived Performance Audit & Optimization

**Date:** 2026-09-01
**Baseline commit:** `f9acb40` (branch `main`, follows `EJIP_SCORE_V2_PHASE2_IMPLEMENTATION.md`)
**Scope:** Measure real user-perceived latency across the core journeys (search → detail → stats → map), remove large pre-launch bottlenecks. No new user-facing features, no schema/migration, no new paid infra.

---

## 1. Performance Budget (from task spec)

| Journey type | Target | Reconsider | Blocker | Fail |
|---|---|---|---|---|
| Search autocomplete | ≤300ms perceived | — | — | — |
| Warm API | ≤500ms | — | — | — |
| Core screen usable state | ≤1–1.5s | — | — | — |
| Cold | ≤1.5s | 1.5–2s | >2s not allowed on core paths | >3s blocker, >5s fail |

External-API-bound paths are called out separately rather than forced to meet these targets, per the task's own instruction.

---

## 2. Environment Setup

- Pre-existing dev server for this repo: single instance (`next dev`, PID chain 40568→35112→18348), port 3000 — no duplicates found.
- Found an **unrelated** project (`C:\psi\goodlife`, Next dev on port 4000 + vitest runs) also running on the machine — left untouched, out of scope for this repo.
- DB pool check (read-only `pg_stat_activity`): 11 connections (1 active, 9 idle, 1 unlabeled) out of the documented pool of 15 — healthy headroom before benchmarking.
- Measured across three environments as required: **DEV** (`next dev`, port 3000), **PROD-LOCAL** (`next build && next start`, port 3001, started/stopped fresh for cold-cache tests), **VERCEL PRODUCTION** (`https://real-estate-app-park11.vercel.app`, read-only, non-abusive request volume — confirmed running in `icn1` (Incheon/Seoul region), same region as the Supabase DB, so cross-region latency is ruled out as a cause of the gap described in §6).
- Both benchmark test servers (prod-local on 3001) were fully stopped and the port verified clear at the end of the session.

---

## 3. Journey Baseline (representative results; full data in session log)

All values are `curl -w time_starttransfer/time_total`, cold = first hit, warm = second hit, same process.

| Journey | DEV cold/warm | PROD-LOCAL cold/warm (before fixes) |
|---|---|---|
| A. Home | 0.44s / 0.17s | 0.03s / 0.01s |
| B. Search autocomplete | 0.08s / 0.09s | 1.78s* / 0.12s |
| C. Search → detail page | 0.32s / 0.28s | 0.52s / 0.06s |
| E. Score API | 0.50s / 1.18s** | 2.35s / 0.29s |
| F. Decline | 0.30s / 0.21s (page), 0.13s / 0.13s (API) | fast |
| G. Rising | fast | fast |
| H. Area84 (Busan-wide) | 0.27s (page) / **6.59s (API cold)** / 1.61s (API warm) | 0.03s (page) / **4.83s (API cold)** / 1.77s (API warm) |
| I. Volume/Dashboard (Busan-wide) | fast (dev, explained in §6) | 0.05s (page) / **timeout>20s (API cold)** / **17.35s (API warm, see §6)** |
| J. Region-change | fast | fast |
| K. Record-high | 0.27s / 0.20s (page), 0.61s / 0.72s (API) | fast |
| L. Map | 0.35s / 0.13s | 0.03s / 0.01s |
| N. Compare | 0.30s / 0.18s | 0.02s / 0.02s |

\* PROD-LOCAL's first hit to any route pays a one-time fresh-process cost (module init, first Prisma connection) — not a real per-request cost; confirmed by re-testing.
\*\* DEV's "warm" Score number here was noise from an in-flight peer-universe cache expiry mid-test, not a real regression — see §5 for controlled measurements.

**Immediately promoted to P0 investigation:** H (area84 Busan-wide) and I (dashboard Busan-wide) — both far exceeded every threshold and were **not** part of the previously-known Score cold-path issue.

---

## 4. Score Cold Path — Root Cause Breakdown

Isolated via a standalone timing script calling the same functions the API route calls (masters fetch → locations fetch → per-row `calculateScoreV2` compute loop over all 3,401 Busan apartments):

| Stage | Before | After (this STEP) |
|---|---|---|
| masters fetch | ~870ms | ~650ms (process variance) |
| locations fetch | ~760ms | ~570ms (process variance) |
| compute loop (3,401 rows) | **1,370ms** | **~460ms** |
| **TOTAL (peer-universe build)** | **~3,004ms** | **~1,660ms (−45%)** |

The compute-loop reduction is a direct, controlled before/after of removing one `console.log` (§5) that fired 3,401 times per cold build.

End-to-end Score API (fresh PROD-LOCAL process, includes route overhead + V1's own computation + peer-universe cold build):
- Cold: 2.86s → 1.48–2.86s (variance from V1's own per-request cost, addressed separately in §5's cohort-cache fix)
- **Warm: 0.294s → 0.09–0.16s (2–3× faster)**, thanks to §5's cohort cache — this is the number that matters most since it's what the overwhelming majority of real requests experience once any apartment in a district has been viewed once.

---

## 5. Fixes Applied

### 5.1 Debug log removal (`src/lib/score-v2/adapter.ts`)
Removed a `console.log('ADAPTER MASTER:', ...)` line that fired once per apartment (~3,400×) during every cold peer-universe build — pure debug noise, zero operational value, classified DEBUG. Full audit of `console.log`/`console.debug` across `src/` found only 5 files total:
- `adapter.ts` — **DEBUG, removed** (this fix).
- `src/lib/perf-debug.ts` — already gated behind `NEXT_PUBLIC_EJIP_PERF_DEBUG` (default off), zero production cost by design. No action.
- `src/lib/api-molit.ts` — logs MOLIT API errors/timeouts. Classified **OPERATIONAL** (useful ops signal for a known-flaky external dependency) — kept.
- `src/app/map/page.tsx`, `src/components/MapViewer.tsx` — client-side geolocation-fallback notices, fire at most once per session, not in a hot loop. Classified DEBUG but **not in a hot path** per the task's own targeting criteria (§9 specifically asks for hot-path removal) — left as-is, noted for a future cleanup pass.

### 5.2 V1 score cohort caching (`src/lib/apartment-score/server/calculate.ts`)
`calculateApartmentScore()` re-fetched the target apartment's entire district (`sggCd`) cohort — `ApartmentMaster` + `ApartmentLocationFeature` + `ApartmentMarketFeature`, potentially hundreds of rows — on **every single score request, with zero caching**, independent of whether V2's own peer-universe cache was warm. Measured directly: **~800–950ms per request**, unconditionally.

Wrapped in the existing `getOrSetCache` (no new cache infrastructure), keyed by `sggCd`, TTL 30 minutes (shorter than V2 peer-universe's 1 hour, since this also feeds V1's live categories/briefing). Verified the cache correctly shares across *different* apartments in the same district — a second, different apartment in an already-cached district benefited immediately (0.088s vs the first apartment's 0.156s own-cache warm-up).

### 5.3 Cache TTL increase for two proven-expensive sido-wide aggregates
Both increases are schema-free, cache-config-only changes, scoped narrowly to the specific slow branch (not a blanket TTL change across the ~20 other 5-minute cache call sites in the codebase):

- `src/app/api/stats/price-rankings/route.ts` — `area84` mode, Busan-wide (`stats-price-rankings-area84-db-sido:*`): 5min → 30min.
- `src/app/api/stats/dashboard/route.ts` — Busan-wide only (`isSidoAll` branch; single-district requests keep the original 5-minute TTL since they don't have this cost): 5min → 30min.

This does **not** reduce the underlying cold-computation cost (see §6/§7 for why that needs a schema change or a rent-trade DB respectively) — it only reduces how often real users pay it, the only schema-free lever available.

### 5.4 Detail page: non-blocking region-name lookup (`src/app/apt/[name]/apt-client.tsx`)
Found a real blocking-waterfall bug: an external third-party regcode-proxy call (`grpc-proxy-server-*.run.app`, ~300ms) was `await`-ed inside the trades-fetch effect, which gated `setLoading(false)` — and `loading` gates both a full-screen "데이터를 수집 중입니다..." overlay and the Score section's render. This call only runs when the URL lacks a `region` query param, which is the case for the majority of real entry paths (search results, stats-page links, favorites) — only map-marker and AI-search links currently pass `region`. `primaryAddress`/`heroRegionLabel` already have a working fallback to `firstTrade?.dong`, so the fetch is not on the critical path at all. Changed to fire-and-forget (matching the non-blocking pattern already used elsewhere in the same file for the info-refinement re-fetch): `setLoading(false)` no longer waits on it; the display quietly upgrades to the fuller region name once/if it resolves.

### 5.5 Audited and found already-optimal (no changes needed)
- **Search autocomplete** (`ApartmentAutocomplete.tsx`): already has debounce (250ms), per-query result caching, `AbortController`-based stale-request cancellation, a 150ms delay before showing a spinner (avoids flicker), and existing `perfMark`/`perfMeasure` instrumentation. Input→result total (~250ms debounce + ~85–100ms API) is close to the 300ms perceived target; the debounce value itself is a UX/product choice, not touched (STOP-condition territory).
- **Map bundle isolation**: confirmed via `performance.getEntriesByType('resource')` in a real browser session that the Home page makes **zero** Kakao-domain requests (SDK correctly isolated to `/map`), and `/map`'s own JS (~160KB encoded) is in the same range as Home's (~155KB) — no bundle leakage.
- **Client/server component boundaries**: `page.tsx` for `/`, `/apt/[name]`, `/stats` are all Server Components delegating to a `*-client.tsx` for interactivity (correct App Router pattern, already in place). `/map/page.tsx` is `'use client'` at the top level, which is reasonable for an inherently fully-interactive map page — not changed (would be an architecture call, out of this STEP's scope).
- **Already-DB-first stats** (decline/rising/record-high/region-change, per prior `TRADE_DB_FIRST_V1` steps): re-measured, still fast, not touched — matches the task's own "don't re-tune what's already fast" instruction.
- **Detail page duplicate-fetch check**: score/briefing/investment-metrics/price-trend components all receive data via props from a single parent fetch each — no duplicate fetching found. Favorites/log/recent-view calls are already `fire-and-forget` with `keepalive: true`.
- **Cache stampede protection**: `getOrSetCache` (`src/lib/server-cache.ts`) already de-duplicates concurrent in-flight requests to the same key via a shared `inFlight` Promise map — confirmed by reading the implementation; no fix needed, this pattern was already built for exactly this concern.

---

## 6. External API Bottleneck — Dashboard Busan-Wide (NOT fixed this STEP)

**Root cause:** `/api/stats/dashboard?sidoCode=26` (전체 부산 거래량), for the rent (전세/월세) side only, has no DB-backed data source (`TRADE_DB_FIRST_V1`'s scope is `dealType='sale'` only) and falls back to calling MOLIT's API per district × per month: **16 districts × 12 months = 192 sequential/throttled external HTTP calls**. Measured: first-computation cost is 20–30+ real seconds (client curl timed out at 20s in testing; the server-side computation continues past that).

This is the exact, previously-known bottleneck from `TRADE_DB_FIRST_V1 STEP B-2`'s own documentation ("rent MOLIT is the only remaining bottleneck") — not a new bug, but far more severe in practice than that STEP's own numbers suggested for the single-district case, because the sido-wide case multiplies the call count by 16.

**Mitigation applied this STEP:** cache TTL raised 5min→30min for this specific branch only (§5.3) — reduces recurrence, does not reduce the underlying cost.

**Full fix requires building a rent/jeonse TradeHistory DB table and backfill pipeline** — explicitly out of scope per the task's own §21 instruction ("이번 STEP에서 전월세 DB 구축까지 확장하지 않는다"). **Verdict: EXTERNAL_API_BOTTLENECK, confirmed, not resolved — requires a future approved STEP (rent DB backfill) to fully close.**

---

## 7. Index Recommendation — Area84 Busan-Wide (NOT applied this STEP)

**Root cause, isolated by direct timing:** `queryTrades({ lawdCd: [16 districts], from: 24-months-ago, exclusiveAreaRange: {gte:84, lt:85} })` costs **~3.4–6s** consistently (confirmed across a cold process and 3 warm-process repeats — not a connection-warmup artifact). The equivalent single-district query costs **~0.63s**. `resolveTrustworthyPyeongBatch` (the other suspected cost) is fine (~300–450ms, already properly batched — 2 `findMany` calls, no N+1).

`ApartmentTradeHistory` currently has indexes on `(aptSeq, exclusiveArea, dealDate)`, `(lawdCd, dealDate)`, `(identityKey, dealDate)`, `(dealDate)` — **none of these efficiently cover the combination of `lawdCd IN (16 values)` + `exclusiveArea` range + `dealDate` range together**, which is exactly this query's shape. A composite index such as `@@index([exclusiveArea, lawdCd, dealDate])` (narrowing by the selective `exclusiveArea` range first) would very likely collapse this to sub-second, matching the single-district number.

**This was not applied** — creating or altering an index is an explicit STOP condition in this task (§4.1: "DB/schema/index migration 필요") and requires separate approval per `AGENTS.md`. **Verdict: INDEX_RECOMMENDED, pending approval.** Until then, §5.3's TTL increase is the only available mitigation.

There is also a residual, uncached ~1.2s of post-cache-hit JS-side cost (pyeong resolution + sort/pagination over ~22,910 rows) even once the DB fetch itself is cached — flagged as a remaining P2 item, not chased further this STEP (already within the "acceptable, revisit later" band, not P0/P1).

---

## 8. Search / Map / Stats / Bundle Summary

| Area | Verdict |
|---|---|
| Search autocomplete | Already well-optimized (debounce, cache, abort, perf instrumentation). No change. |
| Map bundle isolation | Confirmed clean via live browser measurement — no SDK leakage onto other pages. |
| Map/Home JS size | ~155–160KB encoded each — reasonable, no single bloated chunk found. |
| Client/server component boundaries | Already following the correct pattern (Server `page.tsx` + Client `*-client.tsx`). No rewrite needed. |
| decline/rising/record-high/region-change | Re-verified fast (prior `TRADE_DB_FIRST_V1`/`STEP C-2` work holds). Not re-tuned. |
| Score cold path | Root-caused and improved 45% (peer-universe build) via debug-log removal; separately, V1's own per-request cohort cost (~800–950ms, previously uncached) fixed via a 30-min cache — this is the larger real-world win. |
| Area84 Busan-wide | Root-caused (missing composite index) — documented, not applied (needs approval); mitigated via TTL only. |
| Dashboard Busan-wide (rent) | Root-caused (192 sequential external MOLIT calls, no rent DB) — documented, not applied (needs rent-DB STEP); mitigated via TTL only. |
| Detail page waterfall | One real blocking bug found and fixed (non-blocking region-name lookup); everything else already progressively-loaded/deferred correctly from prior STEPs. |

---

## 9. Preaggregation Verdict

- **Score:** `NOT_REQUIRED` this STEP — the debug-log removal + cohort caching already brought the dominant real-world cost (warm requests, which are the overwhelming majority of traffic) down 2–3×. Cold-path preaggregation (e.g., a scheduled peer-universe rebuild) is a reasonable future idea if cold-path latency becomes user-visible in practice, but is not justified by current evidence.
- **Stats (area84/dashboard Busan-wide):** `RECOMMENDED` for a future STEP — but the correct next lever is the missing index (§7) and the rent DB (§6), not a new preaggregation layer; introducing preaggregation before those would treat a symptom instead of the cause.
- **Other stats endpoints:** `NOT_REQUIRED` — already SQL-pushdown-optimized in prior STEPs, re-confirmed fast.

## 10. Index Recommendations (for future approval)

1. `ApartmentTradeHistory`: add a composite index covering the sido-wide 84㎡ ranking query's actual filter shape (`lawdCd IN(...)` + `exclusiveArea` range + `dealDate` range). **Update (2026-09-01, `PERFORMANCE_V1.1-A`):** user approved and this index was applied to production — see `docs/development/PERFORMANCE_V1_1_AREA84_INDEX.md`. Result: the index is a real, measured DB-level win (buffers -44%, wasted filtered rows -96%), but it did **not** bring the endpoint's user-facing latency under target, because the true bottleneck turned out to be Prisma ORM row-materialization of ~23K rows, not the SQL plan. Verdict: PARTIAL — see that doc's §19 for the follow-up recommendation (`QUERY_REWRITE_RECOMMENDED`, not a further index).
2. **Update (2026-09-01, `PERFORMANCE_V1.1-B`):** the recommended query rewrite was implemented — see `docs/development/PERFORMANCE_V1_1_AREA84_SQL_PUSHDOWN.md`. Busan-wide area84 cold latency 4.65-4.83s → 1.49s, warm 1.20-1.77s → 0.10s. 51-case/4,633-row A/B verification against the pre-existing JS implementation: 0 mismatches. This closes the area84 performance item opened in this document.

## 11. Launch Performance Risks

- The two Busan-wide stats aggregates (area84, dashboard/volume) will still show slow first-load behavior (multi-second to 20+ seconds) for whoever happens to trigger the first cache miss after a deploy or a 30-minute TTL expiry. This is now rarer (30 min vs 5 min) but not eliminated.
- Vercel production numbers for Score/area84 (single read-only spot-check) were noticeably higher than local PROD-LOCAL numbers (e.g., Score cold ~11.8s vs ~1.5–2.9s locally) even though the deployment region (`icn1`) matches the DB region — consistent with the well-known Prisma+PgBouncer prepared-statement re-negotiation cost under serverless connection churn. This was **not** touched (a `DATABASE_URL`/pooler-mode change is a production infra change outside this STEP's safe-autonomous scope) but is flagged here as the most likely reason local and production numbers diverge, worth investigating in a dedicated future STEP before assuming today's local measurements fully represent production.

## 12. Not Investigated / Deferred

- Full Lighthouse/Core Web Vitals capture (LCP/INP/CLS) — this audit used `curl`/`performance.getEntriesByType` timing rather than a full Lighthouse run; no dedicated Lighthouse tooling was configured in this environment.
- Real mobile-network throttling — no throttling tool was available in this environment; mobile QA here confirmed layout correctness (no overflow/clipping) at 375px, not network-speed simulation. Per the task's own instruction, this is reported honestly rather than claimed.

---

## 13. Regression Verification

- Score peer-math: re-ran `peer-context.test.mjs` + `score-card-presenter.test.mjs` (34/34 passing) and the Phase 2 cross-check script (`ejip-score-v2-phase2-crosscheck.ts`) against Phase 1.6's saved simulation — **30/30 matched, 0 mismatches**, both before and after every perf change in this STEP.
- Live-verified in browser (dev server, real data): Score card for 더샵센텀파크1차 renders identically (69/100, HIGH-confidence peer section) after all fixes; no new console errors (the only console entries were a generic Chrome-extension messaging artifact unrelated to app code).
- Mobile QA: re-checked the apartment detail page at 375px after the region-fetch change — no overflow, no clipping, score section renders correctly.
- `npx tsc --noEmit`: exactly 20 errors, matching the documented pre-existing baseline — 0 new errors from this STEP's changes.
- `npm run lint` (scoped to changed files): 0 errors (1 pre-existing, unrelated warning on an untouched line).
- `npm run build`: succeeds cleanly.

---

## 14. Files Changed

- `src/lib/score-v2/adapter.ts` — removed hot-path debug log.
- `src/lib/apartment-score/server/calculate.ts` — added 30-min district-cohort cache via existing `getOrSetCache`.
- `src/app/api/stats/price-rankings/route.ts` — raised TTL 5min→30min for the area84 Busan-wide cache key only.
- `src/app/api/stats/dashboard/route.ts` — raised TTL 5min→30min for the sido-wide branch only (single-district unchanged).
- `src/app/apt/[name]/apt-client.tsx` — made the external region-name lookup fire-and-forget instead of blocking `setLoading(false)`.
- `scripts/apartment-score/output/score-v2-phase2-crosscheck.json` — regenerated (same 30/30/0-mismatch result) after re-running the cross-check post-fix.

No DB writes, no schema changes, no new dependencies, no auth/security changes.
