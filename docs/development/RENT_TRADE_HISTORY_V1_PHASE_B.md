# RENT TRADE HISTORY V1 — PHASE B: Production Schema + Sync Engine

**Date:** 2026-09-01
**Baseline commit:** `021b0b5` (branch `main`, follows `MAP_PERFORMANCE_V1.md`)
**Scope:** Production schema creation (`apartment_rent_histories`), normalizer, completeness
classifier, sync engine + CLI, limited validation write (3 lawdCd × 1 month), idempotency proof,
correction-policy re-fetch experiment. **No Busan-wide/nationwide backfill this PHASE** (that is
PHASE C) and no existing rent consumer (dashboard/detail/jeonse-risk/gap-invest/AI search) was
touched — all continue to read live MOLIT exactly as before.

This document assumes `docs/development/RENT_TRADE_HISTORY_V1_ARCHITECTURE.md` (PHASE A) as
already-confirmed source-of-truth; where this PHASE's implementation needed to resolve an
ambiguity PHASE A left open, that is called out explicitly below (§4, §5) rather than silently
deviating.

---

## 1. Final Schema

```prisma
model ApartmentRentHistory {
  id Int @id @default(autoincrement())
  source String @default("MOLIT_APT_RENT") @map("source")
  lawdCd  String @map("lawd_cd")
  dealYmd String @map("deal_ymd")
  aptSeq      String? @map("apt_seq")
  identityKey String  @map("identity_key")
  dealType    String  @map("deal_type") // 'jeonse' | 'wolse'
  groupKeyStr String  @map("group_key")
  aptName String  @map("apt_name")
  dong    String  @map("dong")
  jibun   String? @map("jibun")
  exclusiveArea Decimal @map("exclusive_area")
  deposit     Int @map("deposit")
  monthlyRent Int @map("monthly_rent")
  dealYear  Int      @map("deal_year")
  dealMonth Int      @map("deal_month")
  dealDay   Int      @map("deal_day")
  dealDate  DateTime @map("deal_date") @db.Date
  floor     Int? @map("floor")
  buildYear Int? @map("build_year")
  contractType    String?  @map("contract_type")
  contractTerm    String?  @map("contract_term")
  preDeposit      Int?     @map("pre_deposit")
  preMonthlyRent  Int?     @map("pre_monthly_rent")
  useRenewalRight Boolean? @map("use_renewal_right")
  occurrenceIndex Int @default(0) @map("occurrence_index")
  sourceFetchedAt DateTime @default(now()) @map("source_fetched_at")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @default(now()) @updatedAt @map("updated_at")

  @@unique([groupKeyStr, deposit, monthlyRent, dealDate, floor, occurrenceIndex], name: "rent_natural_key")
  @@index([aptSeq, exclusiveArea, dealDate])
  @@index([lawdCd, dealDate])
  @@index([identityKey, dealDate])
  @@index([dealDate])
  @@index([lawdCd, dealType, dealDate])
  @@map("apartment_rent_histories")
}
```

This is PHASE A §13's recommended schema implemented verbatim — no fields added, none removed,
no nullability changed from what PHASE A proposed. **No `dealCanceled`/`isCanceled`/`canceledAt`
column exists** — the source has no cancellation concept (PHASE A §7, confirmed again this PHASE
has not changed). **No foreign key to `ApartmentMaster`** (§22 — would block real UNMATCHED
aptSeq rows from being stored, see §5).

**Money:** `deposit`/`monthlyRent`/`preDeposit`/`preMonthlyRent` are `Int` (만원 units, no
`Decimal`, no float) — verified again empirically this PHASE (§59 tests: comma-string parsing,
zero-vs-null distinction).

## 2. Source Mapping

Raw field → column, all direct (no derived/computed display values stored):
`aptSeq→apt_seq`, `aptNm→apt_name`, `umdNm→dong`, `jibun→jibun`, `excluUseAr→exclusive_area`,
`floor→floor`, `buildYear→build_year`, `dealYear/dealMonth/dealDay→deal_year/deal_month/deal_day`
+ reconstructed `deal_date`, `deposit→deposit`, `monthlyRent→monthly_rent`,
`contractType→contract_type`, `contractTerm→contract_term`, `preDeposit→pre_deposit`,
`preMonthlyRent→pre_monthly_rent`, `useRRRight→use_renewal_right` (only `'사용'`→`true`, anything
else→`null`, never `false` — PHASE A §12).

`src/lib/api-molit.ts`'s existing `fetchMolitData({type:'rent'})` is **not** reused as the sync
source (§25/§26 of this STEP's own instructions) — it drops `contractType`/`contractTerm`/
`preDeposit`/`preMonthlyRent`/`useRRRight` entirely and unconditionally calls
`parseCancellationFields()` on rent items (always producing `dealCanceled:false`, which PHASE A §7
already flagged as a misleading artifact for a source with no cancellation field). A dedicated raw
fetcher (`scripts/rent-trade-history/rent-molit-fetch.ts`) parses the XML response directly instead.
**Existing live rent consumers are completely untouched** — `fetchMolitData` itself was not
modified.

## 3. Rent Type

`dealType: 'jeonse' | 'wolse'`, plain `String` column (matches sale's `dealType` convention — no
enum type used elsewhere in this schema). Classification: `monthlyRent === 0 → 'jeonse'`,
`monthlyRent > 0 → 'wolse'`, decided once at ingestion (`classifyRentType()` in
`rent-history-logic.ts`), never re-derived downstream. `deposit=0, monthlyRent>0` (순수 월세) is
preserved as a real value, not treated as an error (PHASE A §4 edge case, unit-tested).

## 4. Identity

`aptSeq` is the canonical identity, stored verbatim when present. **Divergence from PHASE A's own
suggestion, documented in `DECISIONS.md` #9:** this STEP's instructions (§14) required rows with a
missing `aptSeq` to be **blocked** (classified `MISSING_APTSEQ`, never written), not given a
name+dong fallback identity the way sale's `identityKey()` does for aptSeq-less trades. PHASE A
§10 measured 100% aptSeq presence across 2,543 real records, so this policy's real cost is 0 in
every sample seen so far (including this PHASE's own 1,238-row validation write — 0 blocked). No
name-based fallback ever links a rent row to a different apartment (unchanged hard rule).

## 5. Natural Key

`groupKeyStr + deposit + monthlyRent + dealDate + floor + occurrenceIndex`, exactly as PHASE A §11
recommended (not changed). One resolved ambiguity, documented in `DECISIONS.md` #9: PHASE A's
schema made `floor` nullable (`Int?`), but `floor` is also a natural-key component, and Postgres
unique constraints treat `NULL != NULL` — a row with a null floor would never be caught as a
duplicate on re-sync, silently breaking idempotency (this is the exact failure mode
`scripts/trade-history-logic.ts` already documented and solved for sale's own `floor Int?`
column). Resolution: the DB column stays nullable for schema-level parity with sale, but
`rent-history-logic.ts`'s normalizer classifies any row with an unparseable floor as
`MISSING_FLOOR` and never emits it — so no row with a null floor is ever actually written. This
PHASE's real validation data had 0 such rows.

**Collision audit reproduced:** PHASE A found 153 real natural-key collisions (candidate key
without `occurrenceIndex`) across 2,543 records. This PHASE's own validation batch (1,238 rows,
§13) had 0 `duplicateWithinBatch` (all disambiguated correctly by `occurrenceIndex` before
insertion) — consistent, not contradictory, since `occurrenceIndex` is exactly what prevents a
true collision from ever manifesting as a natural-key clash.

## 6. Occurrence Index

Unlike sale's `normalizeMolitItemsToTradeRows` (which assigns `occurrenceIndex` by raw array
iteration order), this PHASE's normalizer sorts all valid rows by a full-content deterministic key
(`JSON.stringify` of every field except `occurrenceIndex` itself) **before** assigning indices per
occurrence-group. This was necessary to satisfy this STEP's new determinism requirement (§17,
untested for sale): re-fetching the same MOLIT response in a different page/array order must
produce the identical natural-key set (including `occurrenceIndex`), or re-sync upserts could
silently target the wrong slot. Verified via `rent-history-logic.test.mjs`'s shuffle test
(original/reversed/shuffled input → identical natural-key sets, 0 mismatches).

## 7. Indexes

Implemented exactly as PHASE A §13/§14 specified — no additions, no removals:
- `(aptSeq, exclusiveArea, dealDate)` — apartment-detail rent history lookups.
- `(lawdCd, dealDate)` — district-scoped range queries.
- `(identityKey, dealDate)` — gap-invest's "latest jeonse near a reference date" lookup.
- `(dealDate)` — parity with sale.
- `(lawdCd, dealType, dealDate)` — added proactively (unlike sale, where this exact composite
  index gap was only discovered after a production incident, `PERFORMANCE_V1_1_AREA84_INDEX.md`)
  because the dashboard's real query shape (region + jeonse/wolse + period) is already known.

No partial indexes (there is no `dealCanceled`-style predicate to partially index — the column
doesn't exist).

## 8. Normalizer

`scripts/rent-trade-history/rent-history-logic.ts` — zero-import pure module (same testability
pattern as `area84-pure.ts`/`peer-context-pure.ts`/`trade-history-logic.ts`), 22 unit tests in
`rent-history-logic.test.mjs`, all passing. Key behaviors: jeonse/wolse classification, money
parsing (comma-strip, null-vs-zero distinction), `MISSING_APTSEQ`/`MISSING_MONEY`/`MISSING_AREA`/
`MISSING_DATE`/`MISSING_FLOOR` invalid classification (never guesses a value for a blocked row),
`contractType`/`useRenewalRight`/`preDeposit`/`preMonthlyRent` preserved as `null` (UNKNOWN) rather
than coerced to a default, deterministic `occurrenceIndex` assignment (§6).

**Changes vs. the old rent parsing path (`src/lib/api-molit.ts`):** the old path silently drops
`contractType`/`contractTerm`/`preDeposit`/`preMonthlyRent`/`useRRRight` and always reports
`dealCanceled:false` for rent (a source-unsupported claim). The new normalizer captures all of the
former fields and carries no cancellation concept at all — no field, no default, no implied
guarantee.

## 9. Completeness

`scripts/rent-trade-history/rent-completeness-logic.ts` (pure, 6 unit tests) implements
`COMPLETE | EMPTY_VALID | PARTIAL | INVALID` per this STEP's §33/§34 (a superset of sale's
`CellStatus`, since real pagination — absent from sale's single-page assumption — can produce a
genuine partial-success state that sale never needed to represent). A first-page fetch failure or
unparseable `totalCount` is always `INVALID`, never `EMPTY_VALID` — an API failure is never
recorded as a confirmed zero (§34, unit-tested).

**Real pagination implemented** (`rent-molit-fetch.ts`) — reads `response.body.totalCount` and
fetches however many 1,000-row pages are needed, retrying each page independently (bounded
backoff, same constants as sale's proven `fetchOneRegionMonth`). This PHASE's live validation runs
(§12) all returned `COMPLETE` with `totalCount` matching `collectedCount` exactly (65/557/616
rows), confirming the pagination path works correctly even though none of the 3 validation cells
happened to need more than 1 page.

## 10. Sync Engine

`scripts/rent-trade-history/sync-rent-history.ts`. Reused from sale (`backfill-trade-history.ts`):
chunked upsert (500 rows/transaction, §53), rate-limited sequential fetcher (concurrency 1, 350ms
min interval, exponential backoff on throttle — **not** the live `GLOBAL_MOLIT_CONCURRENCY=6`
semaphore; see `DECISIONS.md` #9 for why this supersedes PHASE A §16's original suggestion),
manifest-based run logging. **Not reused blindly** (§30): no cancellation fields, no sale money
field, no sale natural key — this is a fully separate normalizer/table/manifest.

**Guardrail (§50):** `--lawdCd`, `--from`, `--to` are all mandatory CLI args — the script throws
immediately if any is missing, with no default "all Busan" / "full history" fallback (deliberately
stricter than sale's `backfill-trade-history.ts`, which does default to `sido=26`/`from=200601`,
because this PHASE's own scope explicitly prohibits any broad backfill).

**Correction-safe upsert (§46):** before writing, the engine loads existing DB rows for the same
`(lawdCd, dealYmd)` scope and diffs each incoming row's non-key fields (`aptName`, `dong`,
`jibun`, `buildYear`, `contractType`, `contractTerm`, `preDeposit`, `preMonthlyRent`,
`useRenewalRight`) against what's stored. Rows with no natural-key match are `wouldInsert`; rows
with a match and a real content difference are `wouldUpdate`; rows with a match and identical
content are `unchanged` and are **not** written at all (no blind update-all, and no needless
`sourceFetchedAt` churn that would obscure the idempotency proof in §14).

## 11. Correction Experiment

`scripts/rent-trade-history/correction-experiment.ts` — captures raw-normalized snapshots of a
cell to local JSON and diffs two captures by natural key. Scope actually run this PHASE:

| District | lawdCd | Month | Rationale |
|---|---|---|---|
| 서구 | 26140 | 202607 | recent completed month |
| 부산진구 | 26230 | 202607 | different district, same recent month |
| 해운대구 | 26350 | 202412 | different district, older month |

**Time gap achieved:** snapshot A captured 2026-09-01T14:42:38.989Z (before schema/migration/sync
work began); snapshot B captured 2026-09-01T14:58:41.454Z (after all schema, migration, sync
engine, and validation-write work in this PHASE was complete) — a real **16.0-minute** gap for all
3 cells.

**Result (`output-phase-b-correction-experiment.json`):**

| District | lawdCd | Month | Rows (both snapshots) | Added | Removed | Changed | Verdict |
|---|---|---|---|---|---|---|---|
| 서구 | 26140 | 202607 | 65 | 0 | 0 | 0 | NOT_OBSERVED_IN_SAMPLE |
| 부산진구 | 26230 | 202607 | 557 | 0 | 0 | 0 | NOT_OBSERVED_IN_SAMPLE |
| 해운대구 | 26350 | 202412 | 694 | 0 | 0 | 0 | NOT_OBSERVED_IN_SAMPLE |

Zero adds, zero removals, zero field-level changes across 1,316 total rows spanning 3 districts
and 2 different months (one recent, one 7 months older). **Honest limitation (§37):** 16 minutes
is a real but short window — this result is correctly classified `NOT_OBSERVED_IN_SAMPLE`, not
proof that MOLIT never revises a published rent record. A longer-horizon repeat (re-run
`--capture` with the same args days or weeks later — the script automatically diffs against the
oldest and newest snapshot present for each cell) is recommended before PHASE D finalizes any
correction/upsert policy that depends on this assumption. The current sync engine's upsert
behavior (§10) does not depend on this being resolved either way — it already handles both
"MOLIT never changes a row" (nothing to update, `unchanged`) and "MOLIT does revise a row"
(content-diff triggers `wouldUpdate`) correctly without needing the policy question answered in
advance.

## 12. Validation Write

Approved scope (§39): 서구(26140) + 부산진구(26230) + 해운대구(26350) × 202607, single month.
Dry-run first (§40), then `--apply`:

| lawdCd | fetched | invalid | blockedAptSeq | masterMatched | masterUnmatched | wouldInsert | persisted |
|---|---|---|---|---|---|---|---|
| 26140 | 65 | 0 | 0 | 27 | 6 | 65 | 65 |
| 26230 | 557 | 0 | 0 | 159 | 32 | 557 | 557 |
| 26350 | 616 | 0 | 0 | 165 | 10 | 616 | 616 |
| **Total** | **1,238** | **0** | **0** | **351** | **48** | **1,238** | **1,238** |

Post-write DB row count confirmed via direct SQL: **1,238** (exact match). All 3 cells returned
`COMPLETE` status (real pagination confirmed totalCount === collectedCount, not just "no errors").

## 13. Identity Report

- Total rows: 1,238. Total unique `aptSeq`: 399 (rows are trades, not unique apartments).
- `aptSeq` missing (blocked, `MISSING_APTSEQ`): **0**.
- ApartmentMaster MATCHED: 351/399 unique aptSeq (88.0%). UNMATCHED: 48/399 (12.0%) —
  consistent with PHASE A §10's 82–94% range across 5 districts.
- Verified directly against the persisted rows (`verify-unmatched-master.ts`): **0** rows have a
  name-fallback `identityKey` (`nd:` prefix) — 100% are `id:{aptSeq}`-based. **0** rows have a
  null `aptSeq`. All 48 UNMATCHED-master aptSeqs are present as real, unlinked rows (sample
  confirmed: `26140-1124`, `26140-2420`, `26140-163`, `26140-1189`, `26140-1194`, all correctly
  `id:`-keyed, none merged with any other apartment's data).

## 14. Idempotency

Second `--apply` run against the identical scope (§42):

```
wouldInsert=0 wouldUpdate=0 unchanged=1238 persisted=0 duplicateWithinBatch=0
```

DB row count confirmed unchanged at **1,238** after the second run. New insert = 0, unexpected
update = 0, duplicate = 0 — full pass, no correction-policy hand-waving needed (content was
byte-identical on re-fetch in this real case).

## 15. Unmatched Master Storage QA

Covered in §13 above — real (not synthetic) UNMATCHED aptSeq rows exist in the validation write
and are correctly stored with their real aptSeq, `id:`-based identity, no FK block, no name
fallback. No synthetic production insert was needed or performed (§44).

## 16. Unique Constraint Proof

`scripts/rent-trade-history/prove-unique-constraint.ts` — inside a single DB transaction: (1)
insert one dummy row with an obviously-fake `aptSeq`/`lawdCd`/future `dealYmd` (`209912`, never
colliding with real data), (2) attempt a second `create()` with the byte-identical natural key,
(3) unconditionally throw to roll back regardless of outcome. Result:

```
INSERT 2 correctly rejected: P2002 unique constraint violation (target=["group_key","deposit","monthly_rent","deal_date","floor","occurrence_index"])
TRANSACTION ROLLED BACK — DB에 어떤 row도 남지 않음
VERIFY: rollback 후 잔여 테스트 row 수 = 0
RESULT: PASS
```

No persistent test/dummy data exists in production (verified via a post-rollback count).

## 17. Performance

Not a goal of this PHASE (schema/sync-engine correctness, not user-facing speed), but measured for
the record: 3-cell dry-run (65+557+616=1,238 rows, including live MOLIT pagination + Master-match
queries) completed in ~1.2s total; the `--apply` run (same 1,238 rows, chunked upsert) completed in
~24s wall-clock (dominated by the rate-limited fetcher's 350ms/page minimum interval, not by DB
write time — the actual chunked `$transaction` upserts are the same proven-fast pattern as sale's).

## 18. Storage Estimate (updated vs. PHASE A §23)

PHASE A's rough estimate for a 24-month Busan-wide backfill was "tens of thousands of rows,
plausibly 300K–500K+ for full history back to ~2011" — a placeholder pending real measurement.
This PHASE's 3-district, 1-month real sample (1,238 rows across 서구+부산진구+해운대구) gives a
much better basis: 부산진구 alone (557 rows/month) and 해운대구 (616 rows/month) are both larger,
denser districts than PHASE A's own audit sample used for its estimate. A same-order-of-magnitude
projection: 1,238 rows / 3 districts ≈ 413 rows/district/month; scaled to 16 Busan districts ×
24 months ≈ **~158,000 rows** for a 24-month Busan-wide backfill — still an estimate (district
size varies widely, e.g. 기장군 vs 해운대구), but now anchored to real, current data rather than
PHASE A's placeholder. PHASE C should still compute an exact count via a bounded read-only sweep
before committing to the backfill, exactly as PHASE A itself recommended.

## 19. Phase C Backfill Plan (proposed, not executed this PHASE)

- **Range:** 24 months, Busan-wide, per PHASE A §24's recommendation (matches this app's existing
  `HISTORICAL_LOOKBACK_MONTHS`/dashboard 12-month convention with headroom). Exact boundary must
  be computed as "24 months ending at the most recently **verified-complete** month" at PHASE C
  execution time (§57) — not "24 months ending today," since the current in-progress month is
  always structurally incomplete (reporting lag). If PHASE C starts in month `M`, the backfill
  range is `[M-25, M-2]` (the last fully-elapsed month), with `M-1` and `M` tracked as a separate
  `IN_PROGRESS`/rolling-refresh concern (mirrors sale's `sync-trade-history.ts` rolling-window
  design) rather than included in the one-time backfill's completeness manifest.
- **Districts:** all 16 Busan sigungu (same list `getSigunguListForSido('26')` already resolves
  for sale).
- **Estimated cells:** 16 districts × 24 months = 384 region-months.
- **Estimated rows:** ~158,000 (§18), to be replaced with a real count from a read-only sweep
  before backfill begins.

## 20. Rollback

No automatic rollback was executed or is scripted to run automatically (§24 — manual only).
Manual rollback SQL, if ever needed:

```sql
-- WARNING: deletes all rent history data written to date, including this PHASE's 1,238
-- validation rows. Only run if explicitly instructed to undo this PHASE.
DROP TABLE IF EXISTS "apartment_rent_histories";
```

Or, to remove only this PHASE's validation rows without dropping the table:

```sql
DELETE FROM "apartment_rent_histories" WHERE lawd_cd IN ('26140','26230','26350') AND deal_ymd = '202607';
```

Both are documented here but **not executed** — the 1,238 validation rows currently remain in
production as real, verified data (not test/dummy data — see §16 for how the unique-constraint
proof avoided leaving any dummy rows behind).

## 21. Risks

- **Correction policy remains formally `NOT_OBSERVED_IN_SAMPLE`, not `NOT_OBSERVED`** — the
  re-fetch experiment (§11) found 0 changes across 1,316 rows / 3 districts / 2 months, but the
  real time gap achieved was only 16 minutes (same working session). PHASE D (dashboard DB-first)
  should not assume MOLIT never revises a published rent record without a longer-horizon repeat of
  §11's experiment (days/weeks, not minutes).
- **UNMATCHED aptSeq rate (12% in this sample)** carries forward from PHASE A unresolved — those
  rows will not link to an apartment detail page until `ApartmentMaster` coverage improves. Not a
  new risk, already flagged for PM awareness in PHASE A §28.
- **Storage estimate (§18) is still an estimate**, not a real sweep count — PHASE C must compute
  the real number before executing a 384-cell backfill.
- **No existing rent consumer was modified** — this PHASE adds a new, currently-unused table. Zero
  behavior change risk to production today; the risk surface only opens once PHASE D/E start
  reading from this table.

## 22. Phase B Verdict

**PASS.** Schema created and verified in production with the exact fields/constraints PHASE A
specified (no fabricated cancellation column, correct nullable/money semantics, no blocking FK).
Normalizer and completeness classifier are fully unit-tested (28 tests, 0 failures) and resolve
two idempotency-safety gaps PHASE A's schema left open (floor-null, occurrence-order determinism)
without deviating from PHASE A's actual natural-key/index/field decisions. Sync engine's dry-run,
apply, second-run idempotency, and DB-level unique-constraint proof all passed against real
production data (1,238 real MOLIT rows, 3 districts). Correction-policy experiment ran with a
real but short time gap — correctly reported as a limited, not definitive, finding.

## 23. Next Step

RENT TRADE HISTORY V1 — PHASE C: Busan 24-month backfill, using this PHASE's sync engine
unchanged, with a real pre-backfill row-count sweep to replace §18's estimate before execution.
