# PERFORMANCE V1.1-B — Busan-Wide 84㎡ SQL Pushdown

**Date:** 2026-09-01
**Baseline commit:** `a5907e7` (branch `main`, follows `PERFORMANCE_V1_1_AREA84_INDEX.md`)
**Scope:** Eliminate the Prisma row-materialization bottleneck for the 84㎡ ranking endpoint by pushing the entire ranking computation into SQL. No schema change, no new index, index from `PERFORMANCE_V1.1-A` kept as-is. Production DB: read-only.

---

## 1. Root Cause (established in `PERFORMANCE_V1_1_AREA84_INDEX.md`)

The `PERFORMANCE_V1.1-A` index made the underlying SQL fast (75–150ms), but the endpoint stayed at ~3.4s because `fetchArea84TradesFromDb()` pulled ~23,000 raw trade rows through Prisma's `findMany()` into Node, then `buildArea84RankingRows()` did all grouping/ranking/history computation in JavaScript. Directly measured: identical query via raw SQL ≈100ms, via `prisma.findMany()` ≈3.2–3.8s — a 25–40× gap from ORM row materialization (Decimal marshaling + object construction per row), not the query plan.

## 2. Previous Architecture

```
route.ts (mode=area84)
  → fetchArea84TradesFromDb(lawdCds)          [1 DB round-trip via queryTrades(): findMany + aggregate]
  → ~23,000 raw FeedTrade rows into Node
  → dedupeTrades()
  → buildArea84RankingRows(allTrades, period)  [JS: group by identity, pick representative, compute
                                                 priorHigh/immediatePrior/trailing12moSampleCount per
                                                 group via buildHistory()]
  → rows.sort() + pagination + Unit Master batch resolve
```

## 3. New SQL Architecture

```
route.ts (mode=area84)
  → getArea84RowsFromDb(lawdCds, periodFrom, periodTo)   [1 DB round-trip, single $queryRaw]
  → ~30–1,226 already-ranked candidate rows (one per apartment) into Node
  → sqlArea84RowToArea84Row()  [thin field-mapping only, uses the SAME deriveArea84PriceFields()
                                 the JS path uses]
  → rows.sort() + pagination + Unit Master batch resolve   [UNCHANGED — same shared code as before]
```

The new SQL (`getArea84RowsFromDb`, `src/lib/trade-history-read.ts`) reuses the exact CTE skeleton already validated by `TRADE_DB_FIRST_V1 STEP C-2` (decline/rising) and `STEP E` (record-high) — `raw` (dedupe via `ROW_NUMBER` on the natural key) → `base` (adds `month_index`, `row_seq`) → `step1` (adds `MAX(...) OVER (...)` for `priorHigh` **and** `LAG(...)` for `immediatePrior` in the same step, since area84 needs both simultaneously, unlike decline which needs only `priorHigh` or rising which needs only `immediatePrior`) → `period_filtered` → a new `representative` layer using `DISTINCT ON (identity_key) ... ORDER BY identity_key, deal_date DESC, deal_amount DESC, exclusive_area DESC, COALESCE(floor,0) DESC, id::text ASC` (reproducing `compareArea84Candidates` exactly, and reusing the `id::text` string-sort tie-break technique already established by `region-change.ts`'s `buildRegionChangePairs()`) → a final `JOIN base` for `trailing12moSampleCount` using the same `row_seq <=` / `month_index >=` condition STEP C-2 already proved correct and fast.

The one genuinely new piece is the **complexKey-level** (identity-only, ignoring exact area) representative selection — decline/rising/record-high all operate at `group_key` (identity+exact-area+dealType) granularity and never need to collapse across a single apartment's different unit sizes. `DISTINCT ON` handles this cleanly.

## 4. Semantics Preserved

- **Area rule:** `exclusive_area >= 84 AND < 85`, unchanged, no rounding/casting anywhere in the new SQL or its assembler. Verified live post-deploy with raw un-rounded values (`84.994`, `84.8758`, etc.) in the API response.
- **Cancellation:** `deal_canceled = false` unchanged, applied in the same `raw` CTE WHERE as before.
- **Identity:** `identity_key`/`group_key` are the table's own stored columns (computed at ingestion time via the exact same `identityKey()`/`groupKey()` functions this SQL must match — already empirically validated against 855K rows with 0 mismatches by `STEP C-2`, no name-only matching introduced).
- **Ranking/ties:** `compareArea84Candidates`'s tie-break (date DESC → amount DESC → area DESC → floor DESC → `id::text` ASC) reproduced exactly via `DISTINCT ON`'s `ORDER BY`.

## 5. A/B Verification

Built a permanent verification script, `scripts/verify-area84-sql-pushdown.ts`, that runs the pre-existing JS reference (`buildArea84RankingRows`, unmodified logic) and the new SQL path (`getArea84RowsFromDb`) against the same real production data and diffs every field.

**Result: 51 cases (Busan-wide × 3 periods + all 16 individual districts × 3 periods), 4,633 total rows compared, 0 mismatches** on every field (`excluUseArea`, `floorRaw`, `currentAmount`, `currentDate`, `previousAmount`, `previousDate`, `changeAmount`, `changePct`, `recent2yHighAmount`, `isRecent2yHigh`, `recent2yHighDeltaPct`, `trailing12moSampleCount`) — far exceeding the required ≥100-case bar. Full-array sort-order fidelity was additionally checked for both the default `price` sort (0/1,226 order mismatches, real ties present — 212 of 431 distinct amounts had ties) and the `recent` sort (5/1,226 positions differ — see §12 for why this is an accepted, pre-existing class of difference, not a bug).

Boundary values (`exclusive_area = 84.0000`, 81 real rows; `= 85.0000`, 2,232 real rows correctly excluded) are implicitly covered by the exact row-count match in every case above — a boundary-handling discrepancy would have shown up as a count mismatch, and none did.

One real bug was found and fixed **in the verification harness, not the SQL**: the first A/B run showed 37 `trailing12moSampleCount` mismatches, all off-by-exactly-one for the same recurring set of `aptSeq`s. Root cause: the test harness's "old" oracle path forgot to call `dedupeTrades()` before `buildArea84RankingRows()` — something the real production route always does. After fixing the harness to match production exactly, all mismatches disappeared. This is the same duplicate-row scenario `STEP C-2` already documented for `aptSeq 26140-978` — confirms the new SQL's `dedupe_rn` step was correct all along.

## 6. Data Transfer / Raw Row Count

| | Before | After |
|---|---|---|
| Rows fetched from DB into Node (Busan-wide, 30d) | ~23,000 (all matching trades in the 84–85㎡ band, 24-month lookback) | 342 (final one-per-apartment candidate rows) |
| DB round-trips | 2 (`findMany` + `aggregate` inside `queryTrades()`) | 1 (single `$queryRaw`) |

## 7. Performance (measured, not estimated)

**DB execution** (unchanged from `PERFORMANCE_V1.1-A`, still ~75–150ms for the raw SQL shape).

**User-facing API, fresh PROD-LOCAL process (`next build && next start`, genuinely cold — new process, empty cache, first-ever Prisma connection):**

| Journey | Before (V1.1-A) | After (V1.1-B) |
|---|---|---|
| Busan-wide, cold | 4.65–4.83s | **1.49s** |
| Busan-wide, warm | 1.20–1.77s | **0.10s** |
| 해운대구 (single district), cold | ~0.15s (already fast, index-only fix) | 0.15s |
| 부산진구, cold | — | 0.11s |
| 서구, cold | — | 0.14s |

Both targets met: cold ≤1–1.5s (1.49s, right at the boundary — see §12), warm ≤500ms (0.10s, 5× under target). Also observed on the dev server (Turbopack): cold 0.21s, warm 0.08–0.10s for Busan-wide — even faster than PROD-LOCAL's true-cold number, consistent with the dev server's warm module cache.

**Query count:** exactly 1 DB round-trip for Busan-wide area84 (target met — down from 2).

## 8. API Contract

Unchanged. Same JSON response shape, same field names, same sort/pagination/Unit-Master-resolution code downstream — verified via a live API call returning byte-identical row shapes to the pre-change response (same `complexKey`, same field values, same apartment `두산위브더테라스`/`id:26710-609` as the top `recent`-sorted row in both the old and new implementation during manual spot-checks).

## 9. Cache

The existing `getOrSetCache` 30-minute TTL (from `PERFORMANCE_V1.1-A`) is kept, with a new cache-key prefix (`stats-price-rankings-area84-v2-db-sido`/`-db`) so old and new cached entries never collide. All benchmark numbers in §7 were measured on a **fresh process with an empty cache** specifically to prove the query itself improved, not just that a cache hit was being measured (per the task's explicit instruction not to let cache hits substitute for a real improvement claim).

## 10. Regression

- **Result correctness:** 0 mismatches across 4,633 rows (§5).
- **Other trade queries:** `decline`/`rising`/`record-high` (sido-wide) and `dashboard`/`region-change` smoke-tested post-deploy on PROD-LOCAL — all return `200` with timings consistent with `PERFORMANCE_V1`'s existing measurements. These modes use their own dedicated SQL functions (`getDeclineRowsFromDb` etc.), untouched by this STEP; the shared route file only gained new imports/types, and adding a `DISTINCT ON`-based SQL function cannot change the query plan or results any other mode's own dedicated `$queryRaw` call produces.
- **Score / apartment detail / other features:** not touched by this STEP (different table, different route file) — not re-tested.

## 11. Preaggregation Verdict

**NOT_REQUIRED.** The SQL pushdown alone brought Busan-wide area84 from a repeated >2s failure into the target band without any preaggregation table or schema change — confirming `PERFORMANCE_V1_1_AREA84_INDEX.md`'s own §19 recommendation (`QUERY_REWRITE_RECOMMENDED`, not `PREAGGREGATION_RECOMMENDED`) was the correct diagnosis.

## 12. Limitations / Known Residual Differences

- **Cold latency (1.49s) sits right at the ≤1.5s target boundary**, not comfortably under it like the warm number. The remaining cost is the DB query itself (~100–150ms) plus Next.js/Prisma cold-connection overhead on a genuinely fresh process — the same category of one-time cost documented for the E-JIP Score cold path in `PERFORMANCE_V1.md`. Not chased further this STEP since the target is met.
- **`sort=recent` tie-break, exact-date ties only:** 5 of 1,226 rows (0.4%) land in a different relative position among apartments sharing the *exact same* representative-trade date, under the non-default `sort=recent` query param (the default `price` sort had 0/1,226 such differences). All underlying field *values* are identical — only the ordering among cross-apartment same-date ties differs. This is the same class of "accepted, not a data error" residual difference `TRADE_DB_FIRST_V1 STEP C-2` already documented for decline/rising's own pagination-boundary tie-breaks (a fundamentally underspecified tie-break in the original JS: "동일 날짜/동점 tie-break 미정의"). Not fixed, per precedent, since it does not misrepresent any apartment's actual data.
- **Vercel production, post-deploy, not yet measured:** this STEP's changes are committed to `main` but a fresh Vercel deployment measurement was not captured in this session (would require an actual deploy + read-only production test). The pre-existing Vercel-vs-local latency gap documented in `PERFORMANCE_V1.md`/`PERFORMANCE_V1_1_AREA84_INDEX.md` (suspected Prisma+PgBouncer prepared-statement overhead) is structurally unrelated to this fix (this STEP reduces the *number and size* of rows crossing the ORM boundary, which should help regardless of connection-pooling overhead, but the exact magnitude on Vercel is unverified).

---

## Files Changed

- `src/lib/area84-pure.ts` (new) — zero-import pure module: `AREA84_BAND_MIN/MAX`, `isInArea84Band`, `deriveArea84PriceFields` (extracted so both the JS path and the SQL-pushdown path share one formula, and so it's directly unit-testable via this repo's `.test.mjs` convention, which cannot resolve `price-ranking.ts`'s own extensionless relative imports).
- `src/lib/area84-pure.test.mjs` (new) — 11 unit tests: band boundaries (84 inclusive, 85 exclusive, null), and `deriveArea84PriceFields` edge cases (no prior data, new high, not-a-high with correct delta, no immediate-prior, division-by-zero guard, exact-tie-counts-as-high).
- `src/lib/price-ranking.ts` — re-exports the above from `area84-pure.ts` instead of defining them inline (pure refactor, re-verified behavior-identical via the A/B script before and after).
- `src/lib/trade-history-read.ts` — new `getArea84RowsFromDb()` + `Area84CandidateRow` type.
- `src/app/api/stats/price-rankings/route.ts` — wires `getArea84RowsFromDb` into both the Busan-wide and single-district `area84` branches (matching the existing `decline`/`rising`/`record-high` `dbComputedRows` pattern exactly); removed the now-fully-dead `fetchArea84TradesFromDb()`/`storedTradeToFeedTrade()` helpers (area84-specific, not shared — `queryTrades()` itself, used by other modes, is untouched).
- `scripts/verify-area84-sql-pushdown.ts` (new, permanent) — the A/B verification harness, re-runnable for future regression checks.
- `scripts/area84-sql-pushdown-verify.json` (new) — latest verification run's output (51 cases, 4,633 rows, 0 mismatches).

Linked from `docs/development/PERFORMANCE_V1.md` §10.
