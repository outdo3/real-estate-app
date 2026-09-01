# PERFORMANCE V1.1-A — 84㎡ Busan-Wide Query Index Optimization

**Date:** 2026-09-01
**Baseline commit:** `d69eb98` (branch `main`, follows `PERFORMANCE_V1.md`)
**Scope:** Add one production DB index for the Busan-wide 84㎡ ranking query, per explicit user approval. No other schema change, no rent pipeline change, no preaggregation table.

---

## 1. Baseline

- Busan-wide area84 (`GET /api/stats/price-rankings?mode=area84&sidoCode=26`) measured in `PERFORMANCE_V1.md`: **3.4–6s**.
- Target: warm ≤500ms, cold ≤1–1.5s, no repeated >2s.

## 2. Query Audit (route → helper → SQL, no guessing)

`GET /api/stats/price-rankings?mode=area84&sidoCode=26...` → `fetchArea84TradesFromDb(lawdCds)` (`src/app/api/stats/price-rankings/route.ts`) → `queryTrades()` (`src/lib/trade-history-read.ts`) → `buildTradeQuery()` produces:

```sql
SELECT * FROM apartment_trade_histories
WHERE deal_type = 'sale'
  AND lawd_cd = ANY(<16 Busan district codes>)
  AND exclusive_area >= 84 AND exclusive_area < 85
  AND deal_date >= <24 months ago>
  AND deal_canceled = false
ORDER BY deal_date DESC, id DESC
```

(plus a second, parallel `aggregate({_max: {dealDate}})` call with the identical `WHERE`, for `latestDealDate` metadata.)

`includeCanceled` defaults to `false` and is never passed as `true` anywhere in the live codebase (grep-confirmed) — `deal_canceled = false` is always present in this query shape.

## 3. Existing Index Inventory (`apartment_trade_histories`)

| Index | Columns |
|---|---|
| `apartment_trade_histories_pkey` | `id` (PK) |
| `trade_natural_key` (unique) | `group_key, deal_amount, deal_date, floor, occurrence_index` |
| `apartment_trade_histories_apt_seq_exclusive_area_deal_date_idx` | `apt_seq, exclusive_area, deal_date` |
| `apartment_trade_histories_lawd_cd_deal_date_idx` | `lawd_cd, deal_date` |
| `apartment_trade_histories_identity_key_deal_date_idx` | `identity_key, deal_date` |
| `apartment_trade_histories_deal_date_idx` | `deal_date` |

None of these cover `lawd_cd IN(...) + exclusive_area range + deal_date range` together — the closest, `(lawd_cd, deal_date)`, can only narrow by district+date, leaving `exclusive_area`/`deal_canceled`/`deal_type` to be filtered row-by-row after fetch.

## 4. Selectivity (measured, not assumed)

Read-only queries against the live table (855,179 total rows):

| Predicate | Match rate |
|---|---|
| `deal_canceled = true` | 0.55% (i.e. `= false` matches 99.45% — very low selectivity, not useful as a leading/filtering column) |
| `deal_type = 'sale'` | 100% (only `sale` populated — V1 scope; non-selective today) |
| `exclusive_area` in `[84, 85)` | 29.66% of the whole table |
| `deal_date >= 24 months ago` | 7.92% of the whole table |
| `lawd_cd LIKE '26%'` (Busan) | 855,047 / 855,179 = **99.98%** — the table is currently Busan-only (`TRADE_HISTORY_DATA_V1` backfill scope), so `lawd_cd IN(16 Busan codes)` provides **no real filtering today**, though it will become meaningful again once the in-progress nationwide sync adds other regions. |
| All four combined (`sale` + `!canceled` + `84–85㎡` + `24mo`) | 22,954 / 855,179 = **2.68%** — the real, highly-selective query. |

## 5. Baseline `EXPLAIN (ANALYZE, BUFFERS)`

```
Sort  (actual time=107.861..113.832 rows=22902 loops=1)
  Sort Method: external merge  Disk: 5440kB
  Buffers: shared hit=42532, temp read=680 written=682
  ->  Index Scan using apartment_trade_histories_lawd_cd_deal_date_idx
        Index Cond: (lawd_cd = ANY(...) AND deal_date >= ...)
        Filter: (NOT deal_canceled) AND (exclusive_area >= 84) AND (exclusive_area < 85) AND (deal_type = 'sale')
        Rows Removed by Filter: 44736
        Buffers: shared hit=42529
Execution Time: 116.026 ms
```

The old index can only use `lawd_cd`+`deal_date` to narrow to 67,638 candidate rows, then discards **44,736** of them (66%) via a non-index filter — real, measurable waste, even though raw execution time was already only ~116ms (see §9 for why this SQL-level number is not the real bottleneck).

## 6. Area84 Exact-Area Rule — Preserved

No change to the `84.0000 <= exclusive_area < 85.0000` predicate, no `ROUND`/`CAST`/`/3.3058` conversion introduced anywhere in this STEP. Verified post-deploy via a live API call returning raw values `84.994`, `84.8758` (both correctly inside range, un-rounded).

## 7. Cancelled-Trade Policy — Preserved

`deal_canceled = false` policy unchanged. A **partial index** (`WHERE deal_canceled = false`) was considered (§8) but rejected: at 99.45% match rate, a partial index would exclude only 0.55% of rows, giving negligible size/performance benefit while adding planner complexity and losing usefulness for the (currently unused, but still a public function parameter) `includeCanceled: true` path.

## 8. Index Candidates Compared

| Candidate | Reasoning | Verdict |
|---|---|---|
| A. `(lawd_cd, exclusive_area, deal_date)` | Groups by district (currently non-selective, but future-correct as nationwide data lands and matches the existing `(lawd_cd, deal_date)` index's proven pattern for single-district queries), then the narrow `exclusive_area` range, then `deal_date` as the final range/sort-supporting column. | **Selected.** |
| B. `(exclusive_area, deal_date)` | Leads with the query's most powerful *today* discriminator, ignoring `lawd_cd` entirely. Would perform similarly well right now, but degrades as non-Busan rows are added (the `exclusive_area` range would then match candidates across all regions, requiring a `lawd_cd` recheck over an increasingly large candidate set). | Rejected — not future-correct for the in-progress nationwide expansion. |
| C. Partial index on B or A `WHERE deal_canceled = false` | Marginal benefit given 99.45% baseline match rate (§7). | Rejected — complexity not justified by the data. |

Only one index was created, per the approval scope (§1 of the task: "최소한의 index 변경만 허용").

## 9. Selected Index

- **Name:** `apartment_trade_histories_lawd_cd_exclusive_area_deal_date_idx`
- **Columns:** `(lawd_cd, exclusive_area, deal_date)`
- **Predicate:** none (full index, not partial — see §7)
- **Why:** Matches the query's actual `WHERE` shape (`lawd_cd IN(...)` + `exclusive_area` range + `deal_date` range) column-for-column, with the equality/IN-list-like columns leading (per standard B-tree design: a composite index can only use a second column as an additional range-narrowing condition if the preceding column is an equality/IN condition — both `lawd_cd IN(16)` and the narrow `exclusive_area` range behave close enough to that for this purpose), and reuses the already-proven `lawd_cd`-leading pattern from the existing single-district index.

## 10. Migration Safety

- Table size: 855,179 rows, ~464MB total (data + all indexes).
- Prisma Migrate convention: folder-based migrations under `prisma/migrations/`, applied via `prisma migrate deploy`.
- **Used `CREATE INDEX CONCURRENTLY IF NOT EXISTS`** — a plain `CREATE INDEX` on a table this size takes a `SHARE` lock that blocks concurrent writes (this table receives ongoing incremental trade-sync writes) for the full duration of the index build; `CONCURRENTLY` avoids that at the cost of a (here, unused) doubled build pass. Prisma Migrate detects `CONCURRENTLY` in a migration's SQL and runs it outside a transaction automatically (required — Postgres rejects `CREATE INDEX CONCURRENTLY` inside a transaction block), confirmed compatible with this repo's Prisma version (5.22.0) and the Supabase session-pooler connection (port 5432, not the transaction-pooling 6543 port — session-level DDL like this is fully supported on that connection mode).
- Applied via `npx prisma migrate deploy` (non-interactive, no shadow-database creation attempted).
- Migration file: `prisma/migrations/20260901084417_area84_lawd_exclusive_deal_date_idx/migration.sql`.

## 11. Production Apply — Verified

- Pre-apply: confirmed the index did not exist (`pg_indexes` query), confirmed DB pool healthy (13 connections, well under the 15 limit, 1 active/11 idle/1 unlabeled).
- Applied successfully via `prisma migrate deploy` — "All migrations have been successfully applied."
- Post-apply verification (`pg_index`/`pg_class`): `indisvalid = true`, `indisready = true`, size = **33 MB** (≈7% of the table's 464MB total footprint — not excessive for a 3-column composite index over 855K rows).
- `ANALYZE apartment_trade_histories` run explicitly after index creation (4.1s, read/stats-only, no data write) to ensure the planner has fresh statistics for the new index immediately.

## 12. `EXPLAIN (ANALYZE, BUFFERS)` — After (3 repeated runs for stability)

```
Sort  (actual time=...)
  Sort Method: external merge  Disk: 5440kB
  Buffers: shared hit=23599 (down from 42532, -44%)
  ->  Index Scan using apartment_trade_histories_lawd_cd_exclusive_area_deal_date_idx
        Index Cond: (lawd_cd = ANY(...) AND exclusive_area >= 84 AND exclusive_area < 85 AND deal_date >= ...)
        Filter: (NOT deal_canceled) AND (deal_type = 'sale')
        Rows Removed by Filter: 1935  (down from 44736, -96%)
Execution Time: 73–146ms across repeated runs (first post-ANALYZE run showed a one-off 1073ms, not reproducible on 3 subsequent runs — attributed to transient cache/IO state right after the CONCURRENTLY build + ANALYZE, not the index itself)
```

**Real, reproducible, DB-level win:** buffer touches down 44%, wasted (filtered-out) rows down 96%, all three query predicates now expressed directly as index conditions instead of two of them being a post-scan filter. Execution time was already fast pre-index (~116ms) and remains fast/slightly better post-index (~75–150ms) — the SQL plan was never the dominant cost (see §13).

## 13. Application-Level (Prisma) Benchmark — The Honest Result

Directly timing `queryTrades()` (the actual function the API calls), same process, repeated:

| | Before index | After index |
|---|---|---|
| Sido-wide (16 districts), `findMany` | 3,226–3,844ms | 3,401–3,844ms |
| Single-district (서구) | ~629ms (`PERFORMANCE_V1.md`) | 179ms |

**The sido-wide application-level latency did not meaningfully improve.** Cross-checking directly: raw SQL via `$queryRawUnsafe` for the identical query executes in ~75–150ms both before and after, while Prisma's `findMany()` for the same query consistently takes **3.2–3.8 seconds** — a ~25–40× gap that has nothing to do with the query plan. This points conclusively at Prisma ORM's client-side row materialization (Decimal-type marshaling + object construction across ~22,910 rows × 15+ columns) as the true dominant cost, not the database. This is the same class of problem this codebase already diagnosed and fixed once before for a different query (`getYearlySaleAggregate`'s own comment: "69,025 row를 Node로 끌어와 JS에서 reduce하면 12.9초가 걸렸다" — solved there by moving aggregation into raw SQL so far fewer rows cross the ORM boundary).

## 14. User-Facing API Benchmark

`GET /api/stats/price-rankings?mode=area84&sidoCode=26&...` still returns correctly (verified: exact raw `excluUseArea` values like `84.994`, `84.8758`, unrounded, matching §6). End-to-end API latency is dominated by the same `queryTrades()` cost documented in §13 — the index did not change the user-facing number in any way that would be distinguishable from noise.

## 15. Result Regression — Confirmed Zero

- Row counts before/after (via repeated live queries) consistently ~22,900–22,910 (small variance is the 24-month sliding window moving forward by minutes between separate test runs — not a correctness issue).
- Live API spot-check post-deploy returns correct exact-area values, correct ranking fields (`recent2yHighAmount`, `changePct`, `interpretation`), correct identity fields (`aptSeq`, `groupKey`, `lawdCd`).
- `deal_canceled = false` and `deal_type = 'sale'` policy unchanged (still applied as `Filter` conditions in the plan, just now over a much smaller candidate set).

## 16. Other Trade Query Regression — Confirmed None

`getDeclineRowsFromDb`/`getRisingRowsFromDb` (Busan-wide, `STEP C-2`'s SQL-pushdown path — a different query shape that doesn't filter on `exclusive_area`, so it doesn't use the new index either way) re-tested post-deploy: decline 1.4s/920 rows, rising 0.47s/492 rows — consistent with pre-existing `PERFORMANCE_V1` numbers, no regression. Adding an index cannot remove a query plan option the planner already had — only add one — so no other query can correctness-regress from this change.

## 17. DB Pool

Checked before (13 connections, 11 idle) and confirmed no pool exhaustion during the benchmark/EXPLAIN session (a handful of short-lived script connections, well under the 15-connection limit throughout).

## 18. Performance Verdict: **PARTIAL**

The index itself is a genuine, measured, reproducible success at the database layer (buffers -44%, wasted rows -96%, matches the query's actual filter shape exactly, production-safely applied via `CONCURRENTLY`). It does **not**, however, bring the user-facing 84㎡ Busan-wide endpoint under the ≤2s repeated-latency bar, because the query was never SQL-bound — it is Prisma-ORM-row-materialization-bound. Per the task's own §24 instruction, a second or third index was **not** added to chase this — the correct next lever is different in kind, not degree.

## 19. Recommendation for the Next STEP: `QUERY_REWRITE_RECOMMENDED`

The fix is to stop pulling ~23K raw rows across the Prisma/ORM boundary into Node for this endpoint, mirroring the pattern this codebase already used successfully for `decline`/`rising` (`TRADE_DB_FIRST_V1 STEP C-2`) and `getYearlySaleAggregate`: compute the area84 ranking (grouping by apartment/area identity, taking the most recent + comparison trade per group, sorting, paginating) directly in a raw SQL query using window functions, and return only the already-paginated ~30 result rows to Node instead of the full 22,910-row candidate set. This is an application-code change (not a schema/index change), so it was correctly **not** attempted in this index-only-approved STEP — flagged here for a dedicated future STEP.

## 20. Rollback

If ever needed, a plain, reversible drop (no data loss — this is an index-only change):

```sql
DROP INDEX CONCURRENTLY IF EXISTS apartment_trade_histories_lawd_cd_exclusive_area_deal_date_idx;
```

(Also remove the corresponding `@@index([lawdCd, exclusiveArea, dealDate])` line from `prisma/schema.prisma` and mark the migration as rolled back per normal Prisma convention if this is ever reverted.)

---

## Database Change Log

| Field | Value |
|---|---|
| Index name | `apartment_trade_histories_lawd_cd_exclusive_area_deal_date_idx` |
| Table | `apartment_trade_histories` |
| Columns | `lawd_cd, exclusive_area, deal_date` |
| Predicate | none (full index) |
| Size | 33 MB |
| Creation method | `CREATE INDEX CONCURRENTLY IF NOT EXISTS` |
| Migration path | `prisma/migrations/20260901084417_area84_lawd_exclusive_deal_date_idx/migration.sql` |
| Applied via | `npx prisma migrate deploy` |
| Production applied | 2026-09-01 (this session) |
| Rollback SQL | `DROP INDEX CONCURRENTLY IF EXISTS apartment_trade_histories_lawd_cd_exclusive_area_deal_date_idx;` |
| Data writes | None (`ANALYZE` only — statistics refresh, not a data mutation) |

---

Linked from `docs/development/PERFORMANCE_V1.md` §10 (Index Recommendations).
