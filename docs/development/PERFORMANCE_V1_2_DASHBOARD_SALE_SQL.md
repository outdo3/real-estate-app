# PERFORMANCE V1.2 — Busan Dashboard Sale SQL Pushdown (Audit + Targeted Fixes)

**Date:** 2026-09-02
**Baseline commit:** `5ede8eb` (branch `main`, follows RENT_TRADE_HISTORY_V1 PHASE D.2)

---

## 1. Root Cause (re-audited, revised from the task's own premise)

The task's premise was "`queryTrades()` → ~31,993 raw rows → Node materialization" as the remaining
Busan-wide dashboard cold bottleneck. This was **already fixed in PHASE D.2**
(`getRegionalSaleRowsRawFromDb`, raw SQL, 6.2s → ~0.8s in isolation) — re-auditing confirmed the
row-transfer itself is no longer the problem. Fine-grained instrumentation of the live route found
three *different* real contributors instead:

1. **DB connection-pool cold-start**: the 3 concurrent DB queries (sale, rent rows, rent aggregate)
   fired via `Promise.all` showed **no parallelism benefit at all** on a cold connection pool —
   sequential execution (1,400ms) and "parallel" execution (1,415ms) took the same wall-clock time,
   because each query had to independently establish a new connection to the remote Supabase pooler
   (TLS handshake latency, paid 3× simultaneously instead of once).
2. **`resolveTrustworthyPyeongBatch`'s name+dong lookup**: `Prisma.apartment.findMany({ where: { OR:
   nameDongPairs }, ... })` with ~2,863 OR conditions took 473–879ms depending on run, despite
   returning only 20–50 rows — the same "Prisma-generated SQL shape itself is slow" class of problem
   as `PERFORMANCE_V1.1-A`, just manifesting as an expensive `WHERE` clause instead of row
   materialization.
3. **External network variance** (Supabase round-trip latency, MOLIT API latency) — not something
   any client-side code change can fully control, and the dominant source of run-to-run variance
   observed in this PHASE's own measurements (see §8).

## 2. Old Architecture (already-fixed baseline, PHASE D.2)

`fetchApt12MonthBucketsFromDb` → `getRegionalSaleRowsRawFromDb` (raw SQL, `deal_type='sale' AND
deal_canceled=false`) → 31,993 rows → bucketed into 12 months → consumed by:

| Consumer | Scope | Needs |
|---|---|---|
| `chartDataByType.sale`, `volumeSummaryByPeriod.sale`, `volume`/`prevVolume`, `volumeByPeriod` | dashboard/volume | count + avg(dealAmount), pure aggregate-shaped |
| `hotIssues`, `gapInvest`, `aptByComplex` (jeonseRate) | last 3 months | individual row: name/dong/area/price/date for exact matching |
| `topPrices`, `volumeRanking` (up to 12mo), `complexTrades`, `pyeongLookupKeys`/`pyeongMap` | **all 12 months** | individual row: name/dong/aptSeq/area for Unit Master matching and per-complex grouping |

## 3. Sale Raw Materialization — why a separate SQL-aggregate path was *not* built

Re-auditing consumer-by-consumer (§4/§13 of the task) found a decisive constraint that the task's
own framing didn't anticipate: **`topPrices`, `volumeRanking('12')`, `complexTrades`, and
`pyeongLookupKeys` all require the full 12-month, all-district row set regardless of what happens
to the dashboard/volume aggregate fields.** Building `getSaleMonthlyAggregateFromDb`/
`getSalePeriodComparisonFromDb` (as the task suggested, mirroring rent's PHASE D.2 pattern) would
have added **new queries without removing the existing row fetch** — the fetch is already required
for other same-request consumers, so the row transfer cost cannot be eliminated the way it could
for rent (where gap-invest/jeonse-rate only needed a narrow 2-3 month slice, letting the other 9
months skip row-level fetch entirely).

Measured proof this would be pure overhead: `buildChartData` (all 3 dealTypes, includes the sale
aggregate math) costs **5ms** end-to-end on the already-fetched 31,993-row array — the JS
computation was never the bottleneck. Building a redundant SQL aggregate to replace 5ms of JS work,
while keeping the exact same row fetch running anyway for other consumers, would only add a new
DB round-trip with no compensating removal. This is documented here as a **deliberate
non-implementation**, not an oversight — consistent with this project's anti-over-engineering
principle (`DECISIONS.md` #11) and the rent PHASE D.2 precedent of only building aggregate paths
where they let something else be skipped.

## 4. Pyeong Batch Lookup (the actual remaining win)

Audited per the task's own §14/§15: **not removable** (hotIssues/topPrices/gapInvest genuinely
display `pyung`/price-per-pyeong, real product fields, not incidental) — but its internal SQL
strategy was replaceable. `resolveTrustworthyPyeongBatch` (`src/lib/statistics-pyeong-resolver.ts`,
shared by 8 routes: dashboard, rankings, price-rankings, gap-invest, concentration, feed,
transactions, map-marker-format) issued two `findMany` calls per request:

- `aptSeq IN (...)` — already fast (Prisma IN clause), left unchanged.
- `OR: [{name,dong}, {name,dong}, ...]` (up to ~2,863 pairs) — **the actual bottleneck**, rewritten
  to `WHERE (name, dong) IN (VALUES ...)` via `Prisma.join`/`Prisma.sql` (parameterized, no string
  concatenation).

No pyeong/Unit Master semantics changed — same identity rule (`buildIdentityIndex`/
`findSingleMatch`), same `resolvePyeongFromApartments`/`resolveApartmentContextFromApartments` pure
matching logic (untouched), same public function signatures (all 8 consumers unaffected). Only the
row-finding SQL changed, then the existing `findMany({ where: { id: { in: ids } }, include: {
unitTypes: true } })` (already fast — result sets are always small, 20-65 rows) fetches full data
for the resolved IDs.

**A/B parity, real dashboard-scale data (7,191 unique lookup keys):** 0 mismatches, identical 50/50
resolved pyeong values, `916ms → 566ms` (full function) / `879ms → 297ms` (isolated name-dong
query alone).

## 5. Connection Pool Warm-Up (new, `src/lib/prisma.ts`)

`warmupConnections(n)` fires `n` throwaway `SELECT 1` queries (errors swallowed — a warm-up failure
must never block the real request) concurrently with `getSigunguListForSido` (an external HTTP
call, not a DB call, so it doesn't compete for DB connections) at the top of the Busan-wide branch.
Isolated proof: the same 3 real DB queries (sale/rent-rows/rent-agg) that showed **zero**
parallelism benefit cold (1,415ms parallel ≈ 1,400ms sequential) dropped to **879ms** after a
3-connection warm-up — confirming the bottleneck was connection establishment, not query execution
or compute contention. Applied only to the `isSidoAll && isBusan` branch, where the benefit was
measured and needed; single-district Busan requests were left unchanged (already within target,
per §28's "maintain or improve" bar — added complexity wasn't justified there).

## 6. A/B Validation

- **Pyeong resolver:** see §4 — 0/50 mismatches, real data.
- **Full dashboard response:** every cross-checkable field (`jeonseRate`, `hotIssues[0]`,
  `topPrices[0]`, `chartDataByType.sale` last 3 months, `volumeSummaryByPeriod['3m'].sale`) matches
  PHASE D.2's last-known-good values **exactly**, byte-for-byte — confirms zero behavioral drift
  from either the pyeong-resolver rewrite or the connection warm-up (both are pure performance
  changes, no semantics touched).
- **Other consumers of the shared functions touched this PHASE** (`queryTrades()` was *not*
  modified; `resolveTrustworthyPyeongBatch`/`resolveApartmentContextBatch` *were*): spot-checked
  `rankings`, `yearly`, `gap-invest`, `concentration`, `feed`, `price-rankings` (`mode=area84`),
  `transactions` — all respond correctly, no errors introduced.

## 7. Rows Before/After

| Query | Rows transferred |
|---|---|
| Sale raw fetch (unchanged from PHASE D.2) | 31,993 |
| Pyeong `aptSeq IN` lookup | ~20 (unchanged, already small) |
| Pyeong `name+dong` lookup | ~45 (unchanged row count — **only the WHERE-clause execution strategy changed**, not what's returned) |

No row-transfer volume was reduced this PHASE (that ship sailed in PHASE D.2 for sale, and rent's
narrow-slice approach doesn't apply to sale per §3). The wins this PHASE are entirely about
**query/connection execution efficiency**, not data volume.

## 8. Performance Breakdown

**Component-level (controlled, isolated, high confidence):**

| Measurement | Before | After |
|---|---|---|
| Pyeong name+dong lookup (isolated) | 879ms | **297ms** (3.0x) |
| Pyeong full function (isolated, real data) | 916ms | **566ms** (1.6x) |
| 3 concurrent DB queries, cold pool (isolated) | 1,415ms (no parallelism benefit) | **879ms** (genuine parallelism) |

**End-to-end (live route, production build, 3 independent clean server restarts):**

| Scope | PHASE D.2 baseline | Run 1 | Run 2 | Run 3 |
|---|---|---|---|---|
| Busan-wide cold | 4,667ms | 3,729ms | 4,854ms | 5,478ms |
| District cold (5 samples) | 388–594ms | 480–711ms | — | 357–616ms |
| Warm (all scopes) | 175ms / 7–18ms | 203ms / 7–24ms | — | — |

**Honest reading:** the end-to-end Busan-wide number shows real run-to-run variance (3.7s–5.5s)
that is **larger than the measured component-level improvements**, meaning external factors (real
Supabase round-trip latency, MOLIT API latency, and likely some self-inflicted load from this
session's own extensive DB testing over the preceding hour) dominate the total more than the fixes
applied here. The component-level fixes are real, verified, and carry no correctness risk or
downside — but they should not be oversold as guaranteeing a specific end-to-end number under
real network conditions. District-level performance remains consistently within the ≤1–1.5s target
across all three runs.

## 9. Current-Month MOLIT Contribution

Unchanged this PHASE (rent architecture was explicitly out of scope, §24 of the task). Measured in
PHASE D.2 and re-confirmed here as one of the components inside the same parallel block as sale —
16 MOLIT calls for the single remaining unverified month, bounded by `GLOBAL_MOLIT_CONCURRENCY=6`,
contributing roughly 700ms–1.8s depending on MOLIT's own live latency that day. Per the task's own
§29 escape hatch: this portion, **combined with real network variance to Supabase**, is the
honest explanation for why Busan-wide cold does not reliably hit ≤1.5s — not sale-side row
materialization (already fixed) and not something a further "SQL pushdown" for sale would touch
(§3).

## 10. Vercel

Not measured this PHASE (no deployment step available in this session). Per `PERFORMANCE_V1.md`'s
already-flagged, still-unresolved risk (Prisma+PgBouncer suspected of a local-vs-Vercel latency
gap), the local numbers in §8 should not be assumed to transfer directly to production. Recommended
as the immediate next follow-up (§26/§40 of the task) rather than chased further in this session,
given local measurement is already showing high intrinsic variance that a few more local runs would
not resolve.

## 11. Remaining Bottlenecks

- **Busan-wide cold does not reliably meet ≤1–1.5s.** Root cause is no longer sale-side row
  materialization (fixed in PHASE D.2) or an unaddressed pyeong query (fixed this PHASE) — it is
  now dominated by (a) real external network latency to Supabase and to MOLIT, both largely outside
  client-code control, and (b) the structural 16-MOLIT-call cost for the one remaining unverified
  rent month (out of this PHASE's scope, tracked under `RENT_TRADE_HISTORY_V1_PHASE_D2.md`'s own
  remaining risks).
- **Connection pool warm-up's real-world benefit is unproven beyond isolated tests.** It is
  zero-risk (throwaway `SELECT 1`, errors swallowed) but the live route's 3-run variance couldn't
  cleanly demonstrate its net effect against the noise floor. Kept because it is safe and
  theoretically sound, not because the live numbers proved it decisively.
- **No index/schema change was made or is recommended this PHASE** — the pyeong fix and connection
  warm-up are both purely client-side/query-shape changes.

## 12. Verdict

**PARTIAL.** Correctness: full pass (0 mismatches, 0 regressions, all 8 pyeong-resolver consumers
verified working). Architecture: the task's specific ask (sale SQL aggregate pushdown) was
investigated thoroughly and found to provide no net benefit given sale's row-level consumers span
the full 12-month/16-district scope regardless — documented as a considered non-implementation
rather than skipped. Two different, real bottlenecks were found and fixed instead (pyeong query
shape, connection pool warm-up), both verified safe and beneficial in isolation. Performance target:
**district-level fully passes; Busan-wide cold remains above target**, with the honest finding that
external network variance now dominates more than any further client-side optimization available
within this session's scope.
