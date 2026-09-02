# RENT TRADE HISTORY V1 — PHASE D.2: Dashboard SQL Aggregate + Completed-Month Incremental Sync

**Date:** 2026-09-02
**Baseline commit:** `9b19c15` (branch `main`, follows PHASE D)
**Supersedes/continues:** `RENT_TRADE_HISTORY_V1_PHASE_D_DB_FIRST.md` — that document's §14/§17 risks
("Busan-wide cold does not meet target", "verified coverage shrinks every month") are the two
things this PHASE directly closes (the first fully, the second with a repeatable tool rather than
a permanent fix). Read PHASE D first; this document only covers what changed on top of it.

---

## 1. Phase D Root Cause (corrected)

PHASE D's own document attributed its 8.7s Busan-wide cold time to rent row materialization
(48,768 rows). That was **incomplete** — this PHASE's performance audit isolated every piece of
the `Promise.all` and found the actual dominant cost was **sale's `queryTrades()`**
(`fetchApt12MonthBucketsFromDb`, unchanged since `TRADE_DB_FIRST_V1 STEP B-2`): **6.2 seconds** for
31,993 Busan 12-month rows via Prisma's model-mapped `findMany` — the exact same
`PERFORMANCE_V1.1-A` root cause (row-materialization overhead, not SQL execution time) that had
already been fixed for `area84`/decline/rising/record-high, but never applied to this specific
dashboard fetch. This was already present and dominant in PHASE D's 8.7s number; PHASE D's rent
optimizations were real and correct, but they were optimizing the smaller of two problems.

## 2. Consumer Separation

Confirmed by re-auditing every use of `rentMonthly` in `dashboard/route.ts`:

| Consumer | Needs | Path |
|---|---|---|
| `chartDataByType.jeonse/wolse` (12-month volume+avg) | count + avg(deposit) per month | **Aggregate** (SQL GROUP BY) |
| `volumeSummaryByPeriod` (7d/30d/3m current/previous) | count per day-range | **Aggregate** (SQL COUNT with date range) |
| `gapInvest` / `jeonseRate` (last 3 months only) | individual row: name+dong+area+deposit+date for exact-area matching against sale | **Row-level** (raw SQL row fetch, unavoidable) |

Path A never calls path B's row fetcher. Row-level fetch is narrowed to only the verified months
that intersect the "last 3 months" slice (currently 2 of 11 verified months, not all 11) — the
other verified months are represented as `[]` in `rentMonthly` and their chart contribution comes
entirely from the aggregate map.

## 3. SQL Aggregate

Two new functions in `src/lib/rent-history-read.ts`, both single-query, both defensively re-clip to
`RENT_VERIFIED_FROM`/`RENT_VERIFIED_TO` internally (same double-safety pattern as PHASE D's
`fetchRentMonthBucketsFromDb` — never queries outside verified coverage even if a caller passes a
wider range by mistake):

- **`getRentMonthlyAggregateFromDb(lawdCds, months)`** — `SELECT deal_ymd, deal_type, COUNT(*),
  AVG(deposit) ... GROUP BY deal_ymd, deal_type`, `deposit > 0` (replicates `isValidTrade`'s
  `dealAmount > 0` exclusion exactly — the known 순수월세 deposit=0 edge case is excluded
  identically to the old JS path). One query covers all districts × all verified months.
- **`getRentPeriodComparisonFromDb(lawdCds, currentRange, previousRange)`** — one query with two
  `COUNT(*) FILTER (WHERE ...)` clauses (current/previous), each range independently clipped to
  verified coverage via `clipDateRangeToVerified` (new pure function, `rent-verified-range.ts`). A
  range with zero overlap with verified coverage is queried against a sentinel date (year 9999)
  that can never match real data — avoids conditionally-shaped SQL while still returning a clean 0.

Feasibility reference: PHASE C's original `region+dealType GROUP BY` preview (119ms, 32 rows) is
now the *actual* production path, not just a preview.

## 4. Raw Rows Before/After

| Fetch | Rows | Before | After |
|---|---|---|---|
| Rent row-level (PHASE D: all 11 verified months) | 48,768 | 2.34s (PHASE D's own raw-SQL fix) | — |
| Rent row-level (PHASE D.2: only last-3-slice ∩ verified = 2 months) | 6,797 | — | included in the ~1.6s parallel block below |
| **Sale (`getRegionalSaleRowsRawFromDb`, new this PHASE)** | 31,993 | **6,175ms** (`queryTrades()`, unchanged Prisma `findMany`) | **790ms** (raw SQL) |

The sale fix mirrors PHASE D's rent fix exactly (same `PERFORMANCE_V1.1-A/B` class of problem) but
is added as a **new, narrowly-scoped function** rather than a change to the shared `queryTrades()`
— `queryTrades()` itself is untouched (still used by other consumers: gap-invest's own route,
`qa-trade-history.ts`, etc.) so this fix has zero blast radius outside `dashboard/route.ts`. Row-set
parity verified: identical 31,993 IDs, identical `dealAmount` sum, before adopting.

## 5. 202608 Sync

Approved production scope this PHASE. Pre-sweep (dry-run, 16 cells) → apply → idempotency, using
PHASE B's unchanged sync engine (`sync-rent-history.ts`):

```
Pre-sweep:  DONE mode=DRY_RUN  cells=16 fetched=2889 invalid=0 blockedMissingAptSeq=0 wouldInsert=2889 duplicateWithinBatch=0
Apply:      DONE mode=APPLY   cells=16 fetched=2889 invalid=0 blockedMissingAptSeq=0 wouldInsert=2889 wouldUpdate=0 unchanged=0 persisted=2889 duplicateWithinBatch=0
2nd apply:  DONE mode=APPLY   cells=16 fetched=2889 invalid=0 blockedMissingAptSeq=0 wouldInsert=0    wouldUpdate=0 unchanged=2889 persisted=0 duplicateWithinBatch=0
```

**16/16 COMPLETE, 0 invalid/blocked, 0 mutations observed** (idempotency re-run: 0 insert, 0
update, 0 duplicate — all 2,889 rows byte-identical on re-fetch).

## 6. Completeness

| Status | Count |
|---|---|
| COMPLETE | 16 |
| EMPTY_VALID / PARTIAL / INVALID | 0 |
| **Resolved** | **16 / 16** |

DB verification: total rows 122,431 → **125,320** (+2,889, exact match). `dealYmd='202608'` count =
2,889 (exact). Structural duplicate check (natural-key `GROUP BY ... HAVING COUNT(*) > 1`) on the
new month: **0**.

## 7. Coverage Snapshot (updated provenance)

```
from: 202408
to:   202608   (was 202607)
verifiedAt: 2026-09-02T03:29:25.618Z (202608 --apply DONE)
districts: 부산 16/16
cells: PHASE C 384/384 + PHASE D.2 16/16 = 400/400 COMPLETE (24 months cumulative)
sync version: scripts/rent-trade-history/sync-rent-history.ts (PHASE B, unmodified)
```

Recorded as a code comment directly on `RENT_VERIFIED_FROM`/`RENT_VERIFIED_TO`
(`src/lib/rent-verified-range.ts`) — not a database row, not a rolling computation. `202609` was
**not** included (still the in-progress current month at execution time) — `splitVerifiedMonths()`
correctly classifies it as unverified.

## 8. Incremental Strategy

New: `scripts/rent-trade-history/incremental-sync-completed-month.ts` (+ pure logic module
`incremental-sync-completed-month-logic.ts`, 4 unit tests). Reuses PHASE B's `runRentSyncJob`
unchanged — no new sync logic, only a new *range-selection* wrapper around it.

- **Latest-complete-month rule (§23):** `now`'s previous calendar month. Considered and rejected an
  arbitrary extra grace-period delay — no evidence supports one (see §9).
- **Overlap policy (§25):** default `--overlap=2` — re-syncs the latest complete month **and** the
  one before it on every run, not just the newest. Cost is cheap because the sync engine is already
  idempotent (unchanged rows cost a `findMany` compare, not a write) — confirmed by this PHASE's own
  dry-run: 32 cells (16 districts × 2 months), 6,797 rows, **0 insert / 0 update / 0 duplicate**
  when run again after the manual 202608 sync above.
- **Does not auto-update `RENT_VERIFIED_FROM`/`RENT_VERIFIED_TO`.** The runner syncs data and
  reports completeness/mutation counts; bumping the verified-range constant remains a deliberate,
  reviewed step (this PHASE's own §7 update was done by hand after confirming clean results) — this
  matches `DECISIONS.md` #10's principle that the verified range is evidence-curated, not
  auto-computed.
- **Correction handling (§17):** the runner logs `OBSERVED_CONTENT_DIFF` prominently if any cell
  reports `wouldUpdate > 0` (a real content mutation, not just a new row) — the policy is
  deliberately **not** auto-expanded to a broad update rule; a real mutation would require human
  review, not a silent policy change. None observed this PHASE.

## 9. Reporting Lag

No arbitrary delay was added to the latest-complete-month rule. Evidence considered:

- PHASE C: 부산진구 202607 grew 557→559 over ~11 hours (one real append, 0 mutations).
- This PHASE: 202608, synced same-day (2 days after month-end), showed **0 append** on immediate
  re-run, and **0 append** again ~8 minutes later via the incremental-sync-runner's own dry-run
  overlap re-check.

Two data points, both showing append is rare/small and settles quickly — not evidence for a
multi-day or multi-week safety delay. The **overlap resync** (§8) is the chosen mitigation instead:
rather than guessing a "safe" delay before the first sync, always re-check the last 2 completed
months on every run, so any late append is caught on the *next* scheduled run regardless of timing.

## 10. Routing

Unchanged in structure from PHASE D, narrowed in scope:

| Scope | Sale | Rent (verified month) | Rent (current/unverified month) |
|---|---|---|---|
| Busan | DB (raw SQL, new) | DB (aggregate, new) + DB (rows, only if in last-3 slice) | MOLIT (unchanged) |
| Non-Busan | MOLIT (unchanged) | MOLIT (unchanged) | MOLIT (unchanged) |

## 11. External Call Count

| Scope | Phase D | Phase D.2 |
|---|---|---|
| Busan-wide rent MOLIT calls | 32 (2 unverified months × 16) | **16** (1 unverified month × 16, now that 202608 is verified) |
| Single Busan district | 2 | **1** |
| Sale DB queries | 1 (`queryTrades`, slow) | 1 (`getRegionalSaleRowsRawFromDb`, fast) |
| Rent DB queries | 1 row fetch (all verified months) | 1 row fetch (narrow, last-3∩verified) + 1 aggregate fetch + up to 3 period-comparison fetches |

## 12. A/B

Two independent validations, both **0 mismatches / 0 unexplained**:

1. **Same-instant OLD-vs-NEW** (`tmp/ab_aggregate_vs_rowbased.ts`, not committed — scratch
   validation script): for Busan-wide + 서구/해운대구/부산진구/동래구/기장군, computed
   `chartDataByType.jeonse/wolse` (all 12 months) and `volumeSummaryByPeriod` (7d/30d/3m,
   current+previous, both dealTypes) **twice** from the identical DB snapshot — once via the OLD
   PHASE D row-based JS method (full row fetch + JS filter/reduce), once via the NEW aggregate
   method (SQL GROUP BY/COUNT + hybrid remainder). This isolates pure logic correctness from any
   timing noise. **Result: 0/144 field checks differ, across all 6 scopes.**
2. **Live endpoint cross-check:** `volumeSummaryByPeriod['3m'].jeonse.currentCount` = 5,674 on the
   live Busan-wide endpoint = DB aggregate portion (5,638, clipped to `verifiedTo`) + remainder
   portion (36, counted from the already-fetched September MOLIT rows) — confirmed by direct
   computation, `5638 + 36 = 5674` exactly, end-to-end through the real running route.

No `DB_MISMATCH` or `UNEXPLAINED` cases this PHASE (PHASE D's own root-caused Busan-wide diffs from
the *previous* validation round were about live-MOLIT timing noise on unverified months, not this
PHASE's aggregate logic — not re-litigated here since the underlying cause was already identified).

## 13. Performance

Real production build (`next build && next start`, not dev mode — isolates from Next.js dev-mode
route-compile overhead per §41 PROD-LOCAL):

| Scope | Before (Phase D cold) | After (Phase D.2 cold) | After (warm) |
|---|---|---|---|
| Busan-wide | 8,703ms | **4,667ms** (1.9x vs Phase D, 7.8x vs original 36.2s) | **175ms** |
| 서구 | 481ms | **407ms** | 18ms |
| 해운대구 | 950ms | **542ms** | 14ms |
| 부산진구 | 1,037ms | **594ms** | 10ms |
| 동래구 | 801ms | **519ms** | 7ms |
| 기장군 | 505ms | **388ms** | 7ms |

**Single-district cold target (≤1–1.5s) is now fully met for every sampled district** (388–594ms,
well under the target). **Busan-wide cold target (≤1–1.5s) is not met** (4.67s) — honestly reported,
not adjusted or hidden.

### 13a. Verified-only breakdown (isolates architecture from external MOLIT/pyeong cost)

Direct instrumentation of a single request (production build):

| Segment | Time |
|---|---|
| `getSigunguListForSido` (one-time per process, cached after) | 386ms |
| `Promise.all` (MOLIT 16 calls + sale raw SQL + rent row fetch + rent aggregate, parallel) | ~1,625ms |
| `volumeSummaryByPeriod` (3× `getRentPeriodComparisonFromDb`) + `buildChartData` | ~274ms |
| `resolveTrustworthyPyeongBatch` (sale Unit Master lookup, **pre-existing, unrelated to rent**) | ~693ms |
| hotIssues/topPrices/gapInvest/jeonseRate/volumeRanking + serialization | ~355ms |
| **Total fetcher** | **~3,438ms** |
| HTTP round-trip overhead (middleware, network) | ~600–1,200ms |

The remaining gap to ≤1.5s is **not** attributable to rent anymore — it is: (a) MOLIT's own network
latency for the 16 remaining unverified-month calls (bounded by `GLOBAL_MOLIT_CONCURRENCY=6`,
irreducible without an incremental sync closing that last month too), (b) the pre-existing sale
`pyeong` batch lookup (~693ms, untouched — no index/schema change approved this PHASE to speed it
further), and (c) one-time per-process cache warm-up for the district list (~386ms, amortizes to
~0 after the first request in a warm serverless instance). None of these are rent-side issues this
PHASE was scoped to fix.

## 14. Vercel

Not measured this PHASE — only local (dev + production build) numbers are reported, honestly
labeled as such. PHASE V1's own finding (Vercel prod materially slower than local, Prisma+PgBouncer
suspected) means the local production numbers above should **not** be assumed to hold in
production without a follow-up measurement.

## 15. Scheduler Readiness

**SCHEDULER_READY = CLI ready, infra not configured.** The incremental sync runner
(`incremental-sync-completed-month.ts`) is a safe, idempotent, repeatable CLI — confirmed via this
PHASE's own dry-run re-check (0 insert/update/duplicate on a clean re-run). No `vercel.json` exists
in this repo (confirmed) — actually registering a Vercel Cron job (or any other scheduler) requires
external infra/plan changes (a new cron entry, a protected API route or serverless function
invocation target, function timeout configuration) that are explicitly out of this PHASE's approved
scope (§26: "외부 infra/secret/plan 변경 필요하면 STOP 후 SCHEDULER_READY 판정까지만"). Recommended
follow-up for a future PHASE: wrap this CLI behind an authenticated API route, register it as a
Vercel Cron target (e.g. monthly, a few days after month-end), and reuse the existing
`requireAdmin()`-style auth pattern already established for ADMIN OPS.

## 16. Remaining Risk

- **Busan-wide cold (4.67s) still exceeds the ≤1–1.5s target.** Root cause fully understood (§13a)
  and none of it is a rent-side gap anymore. Closing it further would require either (a) the
  incremental sync above running regularly enough that the unverified-month MOLIT calls shrink
  toward 0 over time (structural, not immediate), or (b) touching the pre-existing sale `pyeong`
  batch lookup performance (~693ms) or `getSigunguListForSido`'s cold-cache cost — both outside
  this PHASE's rent-focused approved scope, flagged as a candidate for a future performance PHASE.
- **Verified coverage still decays without a scheduled incremental sync.** The CLI exists and is
  proven safe/idempotent, but nothing currently invokes it automatically — coverage will start
  shrinking again (202609 becomes the new "1 unverified month" once October starts, then November,
  etc.) unless a human or a future-approved scheduler runs it monthly.
- **`RENT_VERIFIED_TO` bump is still a manual step.** This is a deliberate design choice (§8), not
  an oversight — but it means coverage growth requires someone to review sync results and edit
  source code, which does not scale indefinitely without the scheduler follow-up in §15.
- **UNMATCHED aptSeq / correction-policy long-horizon risk** — unchanged from PHASE C/D, not
  re-investigated this PHASE.

## Next Step

Candidates (not decided this PHASE): (a) register the incremental sync CLI behind Vercel Cron once
infra approval is obtained, closing the coverage-decay risk permanently; (b) a follow-up
performance PHASE targeting the sale `pyeong` batch lookup and/or `getSigunguListForSido` cold-cache
cost, if Busan-wide cold time is still judged worth chasing after (a); (c) Vercel production
measurement to confirm the local production-build numbers hold in the real deployed environment.
