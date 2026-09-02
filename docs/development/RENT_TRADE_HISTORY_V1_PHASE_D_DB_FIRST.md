# RENT TRADE HISTORY V1 — PHASE D: Dashboard / Volume DB-First

**Date:** 2026-09-02
**Baseline commit:** `4c74371` (branch `main`, follows PHASE C)
**Scope:** Route the dashboard/volume rent (전세/월세) data path to `apartment_rent_histories` for
Busan requests whose months fall inside PHASE C's verified snapshot (202408–202607). Sale stays on
its existing DB-first path (`TRADE_DB_FIRST_V1`, unchanged). No schema/index/migration this PHASE.
No other rent consumer (detail/jeonse-risk/gap-invest routes, AI search's own DB queries) converted
— deferred to a future PHASE per this task's own §37.

---

## 1. Old Architecture

`src/app/api/stats/dashboard/route.ts`'s `last12Months` (always `now`-anchored, rolling) built a
`MonthTask` per `(lawdCd, month, type)` for **both** `apt` and `rent`, then called MOLIT via
`fetchMonthsThrottledWithStatus` (shared semaphore, concurrency 6, 200ms pacing per slot). Sale
(`apt`) tasks were already skipped for Busan since `TRADE_DB_FIRST_V1 STEP B-2` (replaced by
`fetchApt12MonthBucketsFromDb`), but rent tasks were **never** skipped — PHASE B/C explicitly
deferred this (`PERFORMANCE_V1.md` §6: "이번 STEP에서 전월세 DB 구축까지 확장하지 않는다").

**Cost:** Busan-wide (`sidoCode=26`) — 16 districts × 12 months = 192 rent MOLIT calls. Single
district — 12 rent MOLIT calls. Measured cold: Busan-wide 36.2s, single-district 1.0–3.4s (§14).

## 2. New Architecture

```
SALE   → apartment_trade_histories DB (unchanged, TRADE_DB_FIRST_V1)
JEONSE → apartment_rent_histories DB for verified months (Busan only) | MOLIT for unverified months
WOLSE  → apartment_rent_histories DB for verified months (Busan only) | MOLIT for unverified months
```

New files:
- `src/lib/rent-verified-range.ts` — zero-import pure module: `RENT_VERIFIED_FROM`/`RENT_VERIFIED_TO`
  constants (`'202408'`/`'202607'`, PHASE C's fixed snapshot boundary) + `splitVerifiedMonths()`.
  Split into its own file (not inside `rent-history-read.ts`) because this repo's `.test.mjs`
  convention (`node --experimental-strip-types --test`) cannot resolve `./prisma`'s extensionless
  relative import (confirmed pre-existing: `trade-history-read.test.mjs` has the identical failure
  today, unrelated to this PHASE) — same pattern `EJIP_SCORE_V2_PHASE2` already used
  (`score-card-presenter.ts`) for exactly this reason.
- `src/lib/rent-history-read.ts` — `fetchRentMonthBucketsFromDb(lawdCds, months)`: single raw-SQL
  query (no MOLIT import, grep-verifiable) returning `apartment_rent_histories` rows bucketed by
  `dealYmd`, defensively re-filtered to the verified range even if a caller passes unverified months
  (double safety against ever presenting unverified data as DB-complete, §5/§16).
- `dashboard/route.ts` gained `storedRentToDashboardTrade()` (mirrors the existing
  `storedTradeToDashboardTrade` sale adapter) and per-branch verified/unverified month splitting.

## 3. Verified Coverage

Unchanged from PHASE C — **not** recomputed as "today minus 24 months":

- from: `202408`, to: `202607`, districts: 16 (Busan), cells: 384 (all COMPLETE).
- Dashboard's rolling `last12Months` is checked against this **fixed** range on every request via
  `splitVerifiedMonths()`. As of this PHASE's execution date (2026-09-02), the rolling window is
  `202510`–`202609`; the verified/unverified split is **10 verified / 2 unverified**
  (`202608`, `202609` — current + reporting-lag month, per PHASE C §19's own `[M-25, M-2]`
  reasoning). This split recomputes correctly every day as `now` advances — it is not hardcoded to
  today's specific 10/2 numbers.

## 4. Current Month / Unverified Month Handling

`202608`/`202609` are never queried from DB (defended twice: caller-side `splitVerifiedMonths()`
and callee-side re-filter inside `fetchRentMonthBucketsFromDb`) — they continue through the
existing MOLIT `MonthTask` path exactly as before this PHASE, including existing failure/partial
semantics. No new "IN_PROGRESS" UI label was added (§22 — no UI redesign this PHASE); the existing
`partial`/`failedDistricts` mechanism already covers a failed unverified-month fetch correctly.

## 5. Routing

| Scope | Sale | Rent |
|---|---|---|
| Busan, verified month | DB (unchanged) | **DB (new this PHASE)** |
| Busan, unverified month | DB (unchanged) | MOLIT (unchanged) |
| Non-Busan (any month) | MOLIT (unchanged) | MOLIT (unchanged) |

Both the `isSidoAll` (Busan-wide) and single-district branches were changed identically — no
special-casing that would let the two paths' semantics drift apart.

## 6. MOLIT Call Elimination

| Scope | Before | After |
|---|---|---|
| Busan-wide (`sidoCode=26`) | 192 (16×12) | **32** (16×2 unverified months) |
| Single Busan district | 12 | **2** (2 unverified months) |
| Non-Busan | unchanged | unchanged |

**0 MOLIT rent calls is achieved for every verified month** — the honest, non-overclaiming
statement, since the literal "0 forever" reading is structurally impossible under a rolling window
against a fixed past snapshot without an ongoing incremental sync (§16 Risks).

## 7. A/B Validation

Reference oracle: full dashboard JSON captured **before** any code change (old code, live MOLIT
only) for Busan-wide + 서구/해운대구/부산진구/동래구/기장군, comparing `chartDataByType.jeonse/wolse`
(12-month volume arrays), `volumeSummaryByPeriod` (7d/30d/3m sale/jeonse/wolse comparisons),
`jeonseRate`, and `gapInvest` names. Same capture repeated **after** the code change (new code, DB
for verified months).

**Result: 36/42 fields MATCH exactly.** All 6 diffs are confined to the Busan-wide aggregate only —
**every one of the 5 individually-tested districts matched byte-for-byte**, meaning the new
per-district DB path is provably correct; the Busan-wide-only diffs come from districts outside the
5 samples.

## 8. Source Drift — Root Cause, Not Guessed

The 6 Busan-wide diffs were fully explained, not hand-waved:

- **Trailing 2 months (`202608`, `202609`, unverified in both old and new code — MOLIT-sourced
  either way):** both counts grew between the "before" and "after" captures (~20–30 min apart).
  Classification: **EXPECTED_SOURCE_APPEND** — `202609` is 2 days into a new month and `202608` just
  ended, both actively receiving new registrations; unrelated to this PHASE's code change (same
  MOLIT path used in both captures).
- **Verified month `202607` (jeonse +7, wolse +8 in the "after"/DB run vs "before"/live run):**
  investigated directly rather than assumed. A **fresh, non-bursty** re-check of all 16 districts
  for `202607` (sequential `fetchMolitData` calls, not part of a 192-call burst) showed **live MOLIT
  === DB exactly (3,901 = 3,901, 0 diff, 0 per-district discrepancies)**. Two consecutive live calls
  to the same district/month also matched each other exactly (no random flakiness). This proves the
  DB is correct and the "before" oracle capture undercounted due to **transient noise specific to
  the old path's 192-concurrent-call Busan-wide burst** — not a DB bug, and not something Phase D's
  code introduces (the old path already made that exact 192-call burst on every Busan-wide cold
  request; DB-first now *removes* most of that burst instead of adding to it). A pagination-cap
  theory (`api-molit.ts`'s `fetchMolitData` fixes `numOfRows=1000`, `pageNo` defaults to 1, unlike
  PHASE B's dedicated fetcher which paginates and verifies `totalCount`) was checked and ruled out —
  no district/month in the current rolling window reaches even 900 rows, let alone 1,000.
- **`volumeSummaryByPeriod`/`jeonseRate` diffs:** downstream consequences of the same trailing-month
  timing noise above (7d/30d/3m windows overlap heavily with `202608`/`202609`), not a separate
  issue.

**No UNEXPLAINED or DB_MISMATCH-against-DB verdict was needed** — every diff traces to a specific,
verified cause.

## 9. Rent Contract Count / Rent Type

Re-confirmed (not re-derived): 1 `apartment_rent_histories` row = 1 contract (PHASE A/B/C's natural
key already guarantees this). `dealType` column is `'jeonse'`/`'wolse'` lowercase strings exactly as
PHASE B defined; the adapter passes `monthlyRent` straight through so the dashboard's existing
`!t.monthlyRent || t.monthlyRent === 0` (jeonse) / `t.monthlyRent > 0` (wolse) filters keep working
unchanged and agree with the stored `dealType` by construction (both derive from the same rule,
`classifyRentType()` in `rent-history-logic.ts`).

## 10. Cancellation

No cancellation field was added anywhere in this PHASE. `storedRentToDashboardTrade()` sets
`dealCanceled: false` as a **fixed constant**, not a re-derived judgment — this exactly matches what
the old live path already produced for every rent trade (MOLIT's rent API has no cancellation field;
`parseCancellationFields()` already always returned `false` for it, PHASE A §7). No new semantic
claim ("취소건 제외 완료") is made anywhere in code or UI.

## 11–13. SQL Aggregation / Target Query / One-Query Preference

**Deliberately not implemented as a separate aggregate-only code path**, and this is a documented
decision, not an oversight: `gapInvest`/`jeonseRate` (computed inline in this same route) need
individual-row matching by exact apartment name + area across a multi-month window, and
`volumeSummaryByPeriod`'s 7d/30d/3m comparisons need day-level `dealDate` granularity that a
per-month `COUNT`/`AVG` aggregate cannot reconstruct — see §17 for why a partial "some months
aggregate, some months rows" split was analyzed and rejected as unsafe. Given that a real row-level
need already exists for effectively the whole verified window, adding a second, unused aggregate-only
query path (as `getRentMonthlyAggregateFromDb`, drafted and then removed during this PHASE) would
have been dead code — contrary to this project's anti-over-engineering principle. The **one query
per request** goal (§13) is still met: `fetchRentMonthBucketsFromDb` issues exactly one query for
however many verified months × however many districts are needed (Busan-wide = 1 query covering all
16 districts, not 16 district-scoped queries) — confirmed by the A/B and performance measurements
using a single call per dashboard request.

## 14. Performance

Real E2E measurements against a locally running dev server (not estimated), before/after code
change, same machine, same DB:

| Scope | Before (cold) | After (cold) | Before (warm) | After (warm) |
|---|---|---|---|---|
| Busan-wide | 36,171ms | **8,703ms** (4.2x) | 330ms | **224ms** |
| 서구 | 1,006ms | **481ms** | 38ms | 31ms |
| 해운대구 | 3,440ms | **950ms** | 38ms | 41ms |
| 부산진구 | 3,175ms | **1,037ms** | 71ms | 36ms |
| 동래구 | 1,869ms | **801ms** | 52ms | 28ms |
| 기장군 | 1,737ms | **505ms** | 26ms | 23ms |

**Warm target (≤500ms) met for every scope.** **Cold target (≤1–1.5s) met for all 5 sampled
districts**, but **not met for Busan-wide** (8.7s) — see §17 for why closing this last gap safely
was judged to require either an incremental rent sync (removing the 2-month MOLIT tail entirely) or
restructuring `volumeSummaryByPeriod` (out of this PHASE's safe-change budget), and is reported
honestly as a partial result rather than claimed as a full pass.

### 14a. DB row-fetch optimization (within this PHASE)

The Busan-wide DB fetch itself (10 verified months × 16 districts ≈ 48,768 rows) was profiled and
optimized in two steps, reusing the exact lesson `PERFORMANCE_V1.1-A`/`-B` already established
(Prisma's ORM row-materialization overhead dominates over actual query execution time for
row-count-heavy fetches):

| Method | Time (48,768 rows) |
|---|---|
| `findMany()`, no `select` | 8,028ms |
| `findMany()`, explicit `select` | 3,864ms |
| `$queryRaw` (final, adopted) | **2,339ms** |

Row-count and content were verified identical across all three methods before adopting raw SQL —
this is a pure performance swap with 0 semantic change (re-confirmed by re-running the full A/B in
§7 after the swap; same 36/42 match result).

## 15. Dashboard SQL Preview

PHASE C's `region+dealType GROUP BY` aggregate preview (119ms, 32 rows) is not wired into a live
consumer this PHASE — see §11–13 for why. It remains valid as a feasibility reference for a future
PHASE that restructures the volume-comparison logic to not need row-level matching.

## 16. Database

| Operation | This PHASE |
|---|---|
| READ | Yes (`apartment_rent_histories`, verified months only) |
| INSERT | 0 |
| UPDATE | 0 |
| DELETE | 0 |
| Schema change | 0 |
| Migration | 0 |
| Index | 0 |

## 17. Regression

- **Diff scope, verified via `git status`:** only `src/app/api/stats/dashboard/route.ts` modified;
  3 new files added (`rent-verified-range.ts`, `rent-verified-range.test.mjs`,
  `rent-history-read.ts`). No other route file touched.
- **Import audit:** `grep` confirms only `dashboard/route.ts` imports the two new lib modules — no
  other consumer exists yet, so no other route could have regressed by construction.
- **VolumeChartCard** (`/stats/volume`, 서구): 매매/전세/월세 tabs all rendered correctly with the
  new DB-sourced rent series (screenshot-verified, live dev server).
- **갭투자** (`/stats/gap-invest`, separate route/file, never touched): rendered correctly —
  confirms no collateral damage, though this route was never expected to be affected.
- **AI search summary** (`src/lib/ai-search.ts`'s `runRegionalStats`): consumes
  `chartData`/`volume`/`volumeChange`/`jeonseRate`/`volumeRanking`/`volumeByPeriod`/`partial` from
  this same dashboard endpoint — all fields structurally unchanged (additive-only response shape);
  `partial` can now only become *more* reliable (fewer MOLIT calls = fewer failure points), not less.
- **Other stats routes** (`rankings`, `yearly`, `feed`, `concentration`, `price-rankings`,
  `region-change`): spot-checked responding (200, or 400 from this session's own guessed query
  params on files never touched by this PHASE's diff — not a regression by definition, since the
  code producing those responses is byte-identical to before this PHASE).

## 18. Tests / Build

- New: `rent-verified-range.test.mjs`, 7/7 pass (`node --experimental-strip-types --test`).
- Re-run: PHASE B's 28 rent-history/completeness unit tests, still 28/28 pass (unchanged logic).
- `npx tsc --noEmit`: 0 errors in any file this PHASE touched. Pre-existing unrelated
  repository-wide errors remain (education/shapefile scripts, `apartment-score` verify scripts,
  `list-zips.ts`, `fetch-api-info.ts` — `FAIL_EXISTING_SCRIPT_ERRORS` per CLAUDE.md §11).
- `npm run lint`: 0 issues in any file this PHASE touched.
- `npm run build`: succeeds, all routes compile.

## Risks

- **The 10/2 verified/unverified split is not permanent — it shrinks every month.** Without an
  ongoing incremental rent sync (which does not exist yet, unlike sale's
  `incremental-sync-nationwide.ts`), the verified window's upper bound (`202607`) stays fixed while
  `now` keeps advancing. In ~10 more months, the entire rolling 12-month window will have moved past
  `202607`, and this PHASE's DB-first routing will silently stop firing for Busan (falling back to
  100% MOLIT again) — not a bug, but a real expiration date on this PHASE's performance win that
  should be tracked, not forgotten.
- **Busan-wide cold (8.7s) does not meet the ≤1–1.5s target.** Honestly reported, not
  papered over. Root cause: `gapInvest`/`jeonseRate`/`volumeSummaryByPeriod` genuinely need
  row-level rent data for most of the verified window (not just the "last 3 months" naive
  assumption — the 3-month volume comparison alone needs 6 months of row-level lookback). Closing
  this gap safely would need either the incremental sync above (removing the MOLIT tail) or a
  larger restructuring of the volume-comparison logic to compute its 7d/30d/3m windows in SQL
  directly — both deferred as genuinely separate, riskier pieces of work, not bundled into this
  PHASE under time pressure.
- **UNMATCHED aptSeq (10.7%, PHASE C)** is unaffected by this PHASE (dashboard region aggregates
  never filtered by master-match status, confirmed unchanged — every real MOLIT-sourced rent row is
  included in volume/chart counts regardless of `ApartmentMaster` match, matching PHASE C's §35
  requirement).
- **No other rent consumer converted this PHASE** (apartment detail, jeonse-risk, gap-invest's own
  standalone route) — all still read live MOLIT, unaffected, deferred per §37.

## Next Step

RENT TRADE HISTORY V1 — PHASE E candidates (not decided this PHASE): (a) a scheduled incremental
rent sync closing the rolling-window gap permanently, mirroring sale's nationwide incremental sync;
(b) converting the remaining rent consumers (detail page, jeonse-risk, gap-invest's own route) to
DB-first; (c) a longer-horizon repeat of PHASE B/C's correction-policy experiment now that two
independent short-horizon samples (16 min, ~11 hours) have both shown 0 mutations of already-stored
rows.
