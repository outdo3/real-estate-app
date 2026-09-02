# RENT TRADE HISTORY V1 — PHASE C: Busan 24-Month Backfill

**Date:** 2026-09-02
**Baseline commit:** `bbe5cdb` (branch `main`, follows PHASE B)
**Scope:** Production backfill of `apartment_rent_histories` for all 16 Busan sigungu across the
24 most recently verified-complete months. Uses PHASE B's sync engine (`sync-rent-history.ts`)
completely unchanged — no schema change, no index change, no cancellation field, no consumer
switch (dashboard/detail/jeonse-risk/gap-invest/AI search all continue to read live MOLIT exactly
as before).

This document assumes `RENT_TRADE_HISTORY_V1_PHASE_B.md` as already-confirmed baseline; PHASE B's
1,238 validation rows (서구/부산진구/해운대구 × 202607) are treated as pre-existing production data,
never deleted or regenerated.

---

## 1. Verified Range

Today (execution date) = 2026-09-02, current month M = `202609`. Per PHASE B §19's own formula
(`[M-25, M-2]`, excluding both the in-progress current month `M` and the reporting-lag-sensitive
prior month `M-1` from the one-time backfill's completeness manifest):

- **from:** `202408`
- **to:** `202607`
- **24 calendar months**, verified-complete.
- **IN_PROGRESS / NOT_INCLUDED:** `202608` (M-1) and `202609` (M, current) — deliberately excluded
  from this backfill, tracked as a future rolling-refresh concern (PHASE D+ scope, not this STEP).

`202607` is not an arbitrary boundary — it is the exact month PHASE B's own validation write
already covered, so this backfill's upper edge and PHASE B's existing rows land in the same cell.

## 2. Regions

All 16 Busan sigungu, cross-checked live against `REGCODE_PROXY` (`getSigunguListForSido('26')`'s
underlying source) immediately before execution — **16/16, 0 missing, 0 duplicate**, identical to
the list already verified for sale's nationwide backfill (`TRADE_HISTORY_DATA_V1.md`):

| lawdCd | 구/군 | lawdCd | 구/군 |
|---|---|---|---|
| 26110 | 중구 | 26410 | 금정구 |
| 26140 | 서구 | 26440 | 강서구 |
| 26170 | 동구 | 26470 | 연제구 |
| 26200 | 영도구 | 26500 | 수영구 |
| 26230 | 부산진구 | 26530 | 사상구 |
| 26260 | 동래구 | 26710 | 기장군 |
| 26290 | 남구 | | |
| 26320 | 북구 | | |
| 26350 | 해운대구 | | |
| 26380 | 사하구 | | |

## 3. Cell Count

16 districts × 24 months = **384 cells**, verified exactly (not estimated) before execution.

## 4. Pre-Backfill Sweep

Full 384-cell **dry-run** (no `--apply`, read-only against DB — only `SELECT` for existing-row
diff, no writes) executed before any production write, per PHASE A/B's own recommendation to
replace PHASE B §18's ~158K-row estimate with a real measurement:

```
DONE mode=DRY_RUN cells=384 fetched=122431 invalid=0 blockedMissingAptSeq=0
     wouldInsert=121193 wouldUpdate=0 unchanged=1238 persisted=121193 duplicateWithinBatch=0
```

**384/384 cells resolved, 0 failures, 0 empty-invalid.** `unchanged=1238` exactly matches PHASE B's
existing validation row count *before any write in this PHASE* — the correction-safe upsert
comparison (PHASE B §46) correctly recognized all 1,238 pre-existing rows as already-present with
identical content, without needing to touch them. Real total (122,431) is ~23% lower than PHASE
B's placeholder estimate (~158,000) — the estimate is now retired in favor of this measured number.

## 5. Backfill Execution

`--apply` run against the identical 384-cell scope, engine unchanged from PHASE B:

```
START apply=true ... from=202408 to=202607   (2026-09-02T01:15:50.108Z)
DONE mode=APPLY cells=384 fetched=122431 invalid=0 blockedMissingAptSeq=0
     wouldInsert=121193 wouldUpdate=0 unchanged=1238 persisted=121193 duplicateWithinBatch=0
                                              (2026-09-02T01:53:27.052Z)
```

**Identical numbers to the dry-run sweep** (as expected — nothing changed between sweep and apply
except that writes were now committed). Duration: **37m 37s** wall-clock for fetch + normalize +
identity lookup + chunked upsert across all 384 cells.

## 6. Completeness

| Status | Count |
|---|---|
| COMPLETE | 384 |
| EMPTY_VALID | 0 |
| PARTIAL | 0 |
| INVALID | 0 |
| **Resolved** | **384 / 384** |

No retry pass was needed — first-pass execution already resolved 100% of cells. Every cell had a
verified `totalCount === collectedCount` pagination match (COMPLETE, not just "no error").

## 7. Identity

| Metric | Value |
|---|---|
| aptSeq present | 122,431 / 122,431 (100%) |
| aptSeq missing (MISSING_APTSEQ, blocked) | 0 |
| Unique aptSeq — master MATCHED | 29,537 |
| Unique aptSeq — master UNMATCHED | 3,538 |
| Overall unmatched rate | **10.7%** |
| Name-fallback identityKey (`nd:`) rows | 0 (verified directly via DB query) |

Per-district unmatched rate ranged **5.0% (해운대구, best coverage) to 16.2% (기장군)** — no
district is an outlier by an order of magnitude; the full spread is within PHASE A's already-known
82–94% match range. No further investigation triggered.

| lawdCd | 구/군 | rows | matched | unmatched | unmatched% |
|---|---|---|---|---|---|
| 26110 | 중구 | 445 | 219 | 20 | 8.4% |
| 26140 | 서구 | 2,826 | 771 | 141 | 15.5% |
| 26170 | 동구 | 2,531 | 667 | 93 | 12.2% |
| 26200 | 영도구 | 2,645 | 796 | 87 | 9.9% |
| 26230 | 부산진구 | 17,957 | 4,061 | 715 | 15.0% |
| 26260 | 동래구 | 9,017 | 2,601 | 286 | 9.9% |
| 26290 | 남구 | 8,442 | 2,103 | 180 | 7.9% |
| 26320 | 북구 | 8,114 | 1,979 | 179 | 8.3% |
| 26350 | 해운대구 | 16,246 | 3,893 | 204 | 5.0% |
| 26380 | 사하구 | 7,666 | 2,457 | 265 | 9.7% |
| 26410 | 금정구 | 4,619 | 1,773 | 200 | 10.1% |
| 26440 | 강서구 | 13,570 | 889 | 151 | 14.5% |
| 26470 | 연제구 | 8,018 | 2,111 | 303 | 12.6% |
| 26500 | 수영구 | 6,903 | 2,038 | 245 | 10.7% |
| 26530 | 사상구 | 5,259 | 1,624 | 169 | 9.4% |
| 26710 | 기장군 | 8,173 | 1,555 | 300 | 16.2% |

UNMATCHED rows are stored with their real aptSeq and `id:`-based identityKey (never a name
fallback) — same policy PHASE B already proved, unchanged here.

## 8. Natural Key

`groupKeyStr + deposit + monthlyRent + dealDate + floor + occurrenceIndex`, unchanged from PHASE B.
`occurrenceIndex` assignment logic (content-deterministic sort) was not modified for this backfill.

## 9. Duplicates

- **In-batch duplicates** (`duplicateWithinBatch`, computed per-cell during normalization): **0**
  across all 384 cells, both dry-run and apply.
- **Structural duplicate check (DB-wide, natural-key GROUP BY HAVING COUNT>1):** **0** groups.
- **DB unique-constraint violations:** none surfaced during the run (chunked upsert never hit
  P2002 — every row's natural key was either genuinely new or already present).
- **Persistent duplicates:** 0 (verified via the same DB-wide query after the run completed).

## 10. Idempotency

Full 384-cell re-apply was not repeated (cost/time reasons per §32's own allowance), but a
representative **32-cell subset (all 16 districts × 2 months: 202408 and 202607 — first and last
month of the range)** was re-applied a second time immediately after the main backfill:

```
[202408 × 16 districts] DONE mode=APPLY cells=16 fetched=5005  wouldInsert=0 wouldUpdate=0 unchanged=5005  persisted=0 duplicateWithinBatch=0
[202607 × 16 districts] DONE mode=APPLY cells=16 fetched=3908  wouldInsert=0 wouldUpdate=0 unchanged=3908  persisted=0 duplicateWithinBatch=0
```

**Second-run insert = 0, unexpected update = 0, duplicate = 0** across all 32 cells (8,913 rows
re-verified content-identical). DB total row count confirmed unchanged at 122,431 immediately after
this second-apply run. Idempotency: **PASS**.

## 11. Money / Contract / Area / Date / Floor QA

Full-scope (all 122,431 rows in `[202408, 202607]` × 16 Busan lawdCd) SQL checks, read-only:

| Check | Result | Expected |
|---|---|---|
| `deposit < 0` | 0 | 0 |
| `monthlyRent < 0` | 0 | 0 |
| `dealType='jeonse'` with `monthlyRent != 0` | 0 | 0 |
| `dealType='wolse'` with `monthlyRent <= 0` | 0 | 0 |
| `dealType='wolse'` with `deposit = 0` (순수월세, allowed edge case) | 186 | reference only |
| `deal_date` vs `deal_year/month/day` mismatch | 0 | 0 |
| `floor IS NULL` | 0 | 0 (MISSING_FLOOR blocked at normalize) |

30-contract manual sample (서구/26140, 202607): 16 jeonse / 14 wolse, 0 `deposit=0` wolse edge
cases in this particular sample, 0 `useRenewalRight=true`, 3/30 rows carry a non-null
`preDeposit`/`preMonthlyRent` (갱신계약), 27/30 have both null (신규계약 or 미기재), 3/30 include an
UNMATCHED-master aptSeq (still correctly stored, not blocked). No NULL coerced to `false`/`0`
anywhere — contract-field NULL semantics preserved exactly as PHASE B specified.

Area precision: schema stores `exclusiveArea` as `Decimal` populated directly from the parsed MOLIT
value with no rounding/truncation step in the normalizer — unchanged from PHASE B, not re-verified
per-row this PHASE (no code path exists that could alter it).

## 12. Source vs. DB

Live re-fetch of `202607` for 5 representative districts, compared against what is now stored:

| District | MOLIT fetched | Normalized | DB stored | Mismatch |
|---|---|---|---|---|
| 서구 (26140) | 65 | 65 | 65 | no |
| 해운대구 (26350) | 618 | 618 | 618 | no |
| 부산진구 (26230) | 559 | 559 | 559 | no |
| 동래구 (26260) | 278 | 278 | 278 | no |
| 기장군 (26710) | 219 | 219 | 219 | no |

All 5 match exactly. Note on 부산진구: PHASE B's original validation (2026-09-01) recorded 557 rows
for this exact cell; this PHASE's sweep/apply (2026-09-02) found 559 — see §15 below, this is a
real, correctly-classified addition, not a mismatch in this table (the table compares *current*
source against *current* DB, both of which now agree at 559).

## 13. Storage

Measured via `pg_size_pretty`/`pg_relation_size` after the full backfill:

| | Size |
|---|---|
| Table (`apartment_rent_histories`) | 31 MB |
| Indexes (5 total) | 30 MB |
| **Total** | **61 MB** |

For 122,431 rows — in line with sale's own per-row overhead at similar scale (indexes roughly equal
table size due to the 5-index schema PHASE A/B specified, no partial indexes since there is no
`dealCanceled` predicate to partially index).

## 14. Runtime

| Phase | Start | End | Duration |
|---|---|---|---|
| Pre-sweep (dry-run, 384 cells, no writes) | 01:11:29.828Z | 01:13:49.570Z | ~2m 20s |
| Backfill apply (384 cells, fetch+write) | 01:15:50.108Z | 01:53:27.052Z | **37m 37s** |
| Idempotency re-apply (32 cells, all unchanged) | 01:56:36.441Z | 01:57:02.232Z | ~26s |

Fetch-only pace (dry-run, rate-limited at 350ms/request minimum interval, mostly single-page cells)
vastly outpaces the full apply because apply additionally performs chunked (500-row) DB
transactions for every new/changed row — the ~35-minute gap between dry-run and apply duration is
overwhelmingly DB write time, not MOLIT fetch time.

## 15. Row Rate

- Apply run: 121,193 new rows / 37.6 min ≈ **3,223 rows/min**; 384 cells / 37.6 min ≈ **10.2
  cells/min**.
- No 429 (rate-limit) responses observed in either run's logs — the existing 350ms sequential
  fetcher (concurrency 1, unchanged from PHASE B) stayed well within MOLIT's tolerance across all
  768 total API calls (384 sweep + 384 apply, single-page for the overwhelming majority of cells).

## 16. Correction Observations

One real, concrete finding — not hypothetical:

- **부산진구 (26230) × 202607: 557 → 559 rows** between PHASE B's original capture
  (2026-09-01T14:58Z validation write) and this PHASE's sweep/apply (2026-09-02, ~11 hours later).
  Classification: **OBSERVED_CORRECTION** in the sense of "MOLIT published 2 additional trades for
  an already-'complete' past month" — **not** a change to any existing row's content. The
  correction-safe upsert engine handled this exactly as designed: `wouldInsert=2, unchanged=557,
  wouldUpdate=0` — the 557 pre-existing rows were byte-identical, only 2 net-new trades appeared.
  A follow-up re-apply on this same cell (§10's idempotency subset, ~1 hour later) found it stable
  at 559 with `unchanged=559` — the addition was a one-time settle, not ongoing instability in this
  short window.
- All other spot-checked cells (§12) showed **UNCHANGED** — 0 adds, 0 removes, 0 field-level diffs.
- No `wouldUpdate > 0` was observed anywhere in this PHASE's full 384-cell run — every content
  comparison across all districts/months was either a clean new insert or a byte-identical
  unchanged match. The "AMBIGUOUS" classification bucket was never needed.
- This is now the **second** independent observation (after PHASE B's 16-minute-gap experiment) of
  MOLIT rent data being append-only-in-practice over a short window rather than silently mutating
  existing published rows — still not proof of a permanent guarantee (see §18 Risks), but a second
  consistent data point over a materially longer gap (~11 hours vs. 16 minutes).

## 17. Dashboard SQL Preview (feasibility only — no consumer switch)

Read-only aggregate query matching the shape PHASE D would eventually need (region + period +
rentType, `GROUP BY`), run directly against the newly-backfilled table:

```sql
SELECT lawd_cd, deal_type, COUNT(*) as cnt, AVG(deposit)::float as avg_deposit
FROM apartment_rent_histories
WHERE lawd_cd = ANY($busan16) AND deal_ymd >= '202408' AND deal_ymd <= '202607'
GROUP BY lawd_cd, deal_type
ORDER BY lawd_cd, deal_type;
```

- **Execution time:** 119ms.
- **Returned rows:** 32 (16 districts × 2 dealType groups) — pure aggregate output, matching
  PERFORMANCE V1.1-B's lesson (§38 — no raw 122K-row `findMany` materialization anywhere in this
  preview or in this PHASE's own verification tooling).
- This is a feasibility measurement only — **no dashboard/API route was modified**; all existing
  rent consumers still read live MOLIT exactly as before this PHASE.

## 18. Phase D Readiness

| Condition | Status |
|---|---|
| 384 cells resolved | ✅ 384/384 |
| Duplicates = 0 | ✅ (in-batch, DB-wide structural, unique-constraint all 0) |
| Missing aptSeq acceptable/known | ✅ 0 missing (100% aptSeq presence, matches PHASE A/B) |
| Identity fallback = 0 | ✅ 0 `nd:` rows anywhere in scope |
| Row counts consistent | ✅ DB COUNT(*) = manifest total = 122,431, both before and after idempotency re-run |
| Idempotency PASS | ✅ 32-cell representative second-apply: insert=0, update=0, duplicate=0 |
| Schema stable | ✅ 0 migrations this PHASE |
| Correction risk documented | ✅ §16 — 1 real append observed, 0 mutations observed, still short-horizon |

**Verdict: READY**, with the correction-risk caveat carried forward (not eliminated, only
re-confirmed on a longer window than PHASE B had).

## Risks

- **Correction policy is still not permanently proven.** Two consistent short-horizon observations
  (16 minutes in PHASE B, ~11 hours in this PHASE) both show "append-only in practice, 0 mutations
  of already-published rows" — but neither is a long-horizon (weeks/months) guarantee. PHASE D
  should not assume this without a longer repeat, exactly as PHASE B already flagged.
- **UNMATCHED aptSeq rate (10.7% overall, up to 16.2% in 기장군)** carries forward unresolved from
  PHASE A/B — those rows won't link to an apartment detail page until `ApartmentMaster` coverage
  improves. Known, not new.
- **No existing rent consumer was touched.** This PHASE only grows a still-unused table; the risk
  surface for user-facing behavior opens only once PHASE D/E begin reading from it.
- **202608/202609 are intentionally excluded** from this backfill's completeness manifest — any
  future consumer (e.g. ADMIN OPS) must not silently redefine "24 months" as a rolling "today minus
  24" window without re-deriving the same `[M-25, M-2]` boundary logic, or it will disagree with
  this snapshot's documented range.

## Snapshot / Provenance

- **from:** `202408`
- **to:** `202607`
- **verifiedAt:** `2026-09-02T01:53:27.052Z` (apply completion)
- **districts:** 16 (see §2 table)
- **cells:** 384
- **source:** `MOLIT_APT_RENT` (RTMSDataSvcAptRent)
- **sync version:** PHASE B's `sync-rent-history.ts`, unmodified in this PHASE

This exact range is a fixed, documented snapshot — not to be silently recomputed as "24 months
ending today" by any future consumer.

## Database

| Operation | This PHASE |
|---|---|
| READ | Yes (dry-run sweep, existing-row diff, verification queries) |
| INSERT | Yes — 121,193 new rows |
| UPDATE | 0 (no content diffs were found anywhere in scope this PHASE) |
| DELETE | 0 |
| Schema change | 0 |
| Migration | 0 |

## Tests / Build

- Phase B's 28 unit tests (`rent-history-logic.test.mjs` + `rent-completeness-logic.test.mjs`):
  **28/28 pass** (run via `node --experimental-strip-types --test`, unchanged logic, re-run as a
  regression check for this PHASE — no new tests were needed since no normalizer/completeness code
  changed).
- `npx tsc --noEmit`: 0 new errors. Pre-existing repository-wide errors remain (education/shapefile
  scripts, `apartment-score` verify scripts, `list-zips.ts`, `test-api.ts` — all unrelated to
  `rent-trade-history`, `FAIL_EXISTING_SCRIPT_ERRORS` per CLAUDE.md §11 policy).
- `npm run lint`: 0 issues in any `rent-trade-history`/Phase C file. Pre-existing repo-wide lint
  output (1,638 errors / 63,821 warnings, including a separate git worktree) is unrelated to this
  PHASE's scope.
- `npm run build`: succeeds, all routes compile.

## Git

- `docs/development/RENT_TRADE_HISTORY_V1_PHASE_C_BACKFILL.md` (this file), `CHANGELOG.md` update,
  and the new read-only verification script `scripts/rent-trade-history/phase-c-verify.ts` are the
  only files this PHASE adds/changes — no schema/migration file, no consumer code touched.
- Backfilled data itself (`apartment_rent_histories` rows) is production DB content, not a git
  artifact.

## Phase C Verdict

**PASS.** 384/384 cells resolved with 0 failures on the first pass (no retry needed). 122,431 total
rows now in production (121,193 new this PHASE + 1,238 pre-existing from PHASE B, both correctly
accounted for). 0 structural duplicates, 0 identity fallbacks, 0 missing-aptSeq blocks 100%
consistent with PHASE A/B's findings. Idempotency proven on a 32-cell representative re-apply.
Money/contract/area/date/floor QA all clean. One real correction observation (부산진구 202607,
+2 rows) was caught, correctly classified, and documented rather than silently absorbed. No
existing rent consumer was modified — this remains a data-only PHASE.

## Phase D Readiness

**READY** — see §18 above for the condition-by-condition checklist.

## Next Step

RENT TRADE HISTORY V1 — PHASE D: Dashboard / Volume DB-first migration for rent data, following the
same DB-first pattern already proven for sale (`TRADE_DB_FIRST_V1` STEP B/B-2/C/C-2/D). Should also
consider, before or alongside PHASE D, a longer-horizon repeat of the correction-policy check (§16)
now that two short-horizon samples both show 0 mutations.
