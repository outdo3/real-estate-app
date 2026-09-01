# RENT TRADE HISTORY V1 — PHASE A: Source, Identity & Data Model Audit

**Date:** 2026-09-01
**Baseline commit:** `4173917` (branch `main`, follows `PERFORMANCE_V1_1_AREA84_SQL_PUSHDOWN.md`)
**Scope:** Audit-only. Confirm real MOLIT rent source/semantics/identity, design a schema candidate, and produce a phased implementation plan. **No production schema, migration, or data writes in this PHASE.** All findings below are backed by real, live MOLIT API responses (`RTMSDataSvcAptRent`) and real `ApartmentMaster` queries captured via `scripts/rent-trade-history/phase-a-source-audit.ts` (read-only) — nothing here is assumed.

---

## 1. Current Rent Architecture

Rent (전세/월세) data is used by, and only by, the following consumers today — all fetch MOLIT on every user request, no caching beyond the existing generic 5-minute `getOrSetCache` wrappers, no DB storage:

| Consumer | Route | What it needs | External calls |
|---|---|---|---|
| **Dashboard/Volume** (§26 root cause) | `/api/stats/dashboard` | 전세/월세 raw trades, 12-month chart, volume-change summary | Busan-wide: 16 districts × 12 months = **192 rent MOLIT calls** per cold cache miss. Single-district: ≤12 calls. |
| Apartment detail | `/api/apt/[name]` (`type=rent`) | Recent rent trades for one apartment | 1 district × N months (per period filter) |
| Stats — 전세위험 (jeonse-risk) | `/api/stats/price-rankings?mode=jeonse-risk` | Rent trades for jeonse-drop ranking | Same district×month fan-out pattern as decline/rising, but rent-typed |
| 갭투자 (gap-invest) | `/api/stats/gap-invest` | Latest jeonse trade matched to latest sale trade, same identity+area, within 90-day window | District×month rent fetch |
| AI search | `src/lib/ai-search.ts` | Rent trades as a supporting signal | Delegates to the same MOLIT helpers |
| 단지 브리핑 (apt-brief) | `src/lib/apt-brief.ts` | Rent context for narrative text | Reuses already-fetched rent trades, no extra calls |

**All of the above are the exact same class of problem `TRADE_DB_FIRST_V1` already solved for sale trades** — the only reason it hasn't been solved for rent is the absence of a `TradeHistory`-equivalent DB table for rent (`TRADE_DB_FIRST_V1`'s own scope was explicitly `dealType='sale'` only).

## 2. MOLIT Source (confirmed, not assumed)

- **Service/Operation:** `RTMSDataSvcAptRent` / `getRTMSDataSvcAptRent` (아파트 전월세), confirmed directly in `src/lib/api-molit.ts:57`.
- **Endpoint:** `http://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent`
- **Params:** `LAWD_CD` (5-digit region code), `DEAL_YMD` (YYYYMM), `numOfRows=1000` (this app always requests the full month in one page).
- **Historical range:** live-tested — `202601`/`201501`/`201101` all return real data; `201001` and `200801` returned `resultCode=0` with 0 items for 서구. This is consistent with rent-deal reporting starting materially later than sale (sale goes back to 2006 per this app's existing sale backfill). **Recommend one more targeted check in PHASE B** (multiple districts, months between 2010–2012) before finalizing the "full history" backfill boundary — this PHASE only establishes that ~2011-01 has real data and ~2010-01 does not, for one district.

## 3. Field Dictionary (from real, live API responses — 서구/해운대구/부산진구/동래구/기장군, 2,543 real records)

| Raw field | Classification | Notes |
|---|---|---|
| `aptSeq` | IDENTITY | **100% present** across all 5 districts tested (0 missing) — same canonical MOLIT apartment-complex id used by sale data. |
| `aptNm` | IDENTITY (display) | Apartment display name. |
| `sggCd`, `umdNm`, `jibun`, `roadnm*` | ADDRESS | `umdNm` = 법정동 (dong). Road-address fields (`roadnm`, `roadnmcd`, `roadnmbonbun`, etc.) exist but this app does not currently parse them for sale either — out of scope. |
| `excluUseAr` | AREA | Raw exclusive area (㎡), same field name and semantics as sale's `excluUseAr` — no unit ambiguity. |
| `floor` | CONTRACT | Integer floor. |
| `buildYear` | META | Same semantics as sale. |
| `dealYear`, `dealMonth`, `dealDay` | DATE | Contract/reporting date, same 3-integer pattern as sale (no separate "계약 시작일/종료일" fields — see §7). |
| `deposit` | MONEY | 보증금, string with comma separators, **만원 (10,000 KRW) units** — same convention as sale's `dealAmount`. |
| `monthlyRent` | MONEY | 월세금액, 만원 units, integer-like (no comma formatting observed, but treat identically to `deposit` for safety). |
| `contractType` | CONTRACT | Values observed: exactly `신규` (new) or `갱신` (renewal), or empty string. See §8 for coverage/rollout. |
| `contractTerm` | CONTRACT | Free-text lease term string, e.g. `"26.01~27.01"`. Present whenever `contractType` is present, empty otherwise. |
| `preDeposit`, `preMonthlyRent` | RENEWAL | 종전 보증금/월세 — see §9, only meaningful for renewals. |
| `useRRRight` | RENEWAL | 갱신요구권 사용 여부. Only value ever observed when filled: `사용`. Empty otherwise — **empty is NOT "not used," it is unknown/not-recorded** (§12 requirement). |
| **(none found)** | CANCELLATION | **No cancellation-related field exists in this endpoint's response at all** — see §7, this is the single most important finding of this PHASE. |

**Field-rollout coverage over time** (서구, `contractType`/`contractTerm`/`useRRRight`/`preDeposit`, live-tested across 8 months from 2018-12 to 2026-01):

| Month | n | `contractType` filled | `useRRRight` filled | `preDeposit` filled |
|---|---|---|---|---|
| 2018-12 | 64 | 0 | 0 | 0 |
| 2019-12 | 67 | 0 | 0 | 0 |
| 2020-06 | 93 | 0 | 0 | 0 |
| 2021-12 | 71 | 54 (76%) | 2 | 5 |
| 2023-12 | 101 | 93 (92%) | 2 | 2 |
| 2024-12 | 161 | 157 (98%) | 6 | 13 |
| 2025-06 | 98 | 95 (97%) | 7 | 17 |
| 2026-01 | 96 | 92 (96%) | 12 | 16 |

These fields did not exist before some point between 2020-06 and 2021-12 (consistent with Korea's 계약갱신청구권제/임대차 3법, effective 2020-07-31, though this PHASE did not verify the exact rollout month and does not assert it as fact). **Records before that rollout will permanently have `contractType`/`contractTerm`/`useRRRight`/`preDeposit`/`preMonthlyRent` empty — this is a real data characteristic, not a collection defect, and the schema/UI must represent it as `UNKNOWN`, never `false`/`0`.**

## 4. Jeonse / Wolse Classification (verified against 2,543 real records)

`monthlyRent === 0` ⟺ 전세(jeonse); `monthlyRent > 0` ⟺ 월세(wolse). Verified: 1,233 jeonse / 1,310 wolse, **zero** records with both `deposit=0` and `monthlyRent=0` (which would be invalid/free), and **zero** ambiguous fractional or negative values. One real edge case found and worth documenting: 6 records (all the same newly-built complex, 해운대하이루프33, 2025년 준공) have `deposit=0, monthlyRent=170` — genuine "순수 월세" (deposit-free monthly rent), a legitimate value, not an error; the classification rule (`monthlyRent>0` → wolse) already handles it correctly without special-casing.

## 5. Money Representation

Both `deposit` and `monthlyRent` are in **만원 (10,000 KRW) units**, matching this app's existing `dealAmount` (sale) convention exactly — no unit conversion needed, and no `float` involved (values are string-or-integer whole numbers, same as sale). Recommend storing as `Int`, matching `ApartmentTradeHistory.dealAmount`'s existing type — **not** `Decimal` (money-in-만원 is always a whole number here, verified across all captured samples; `Decimal` is reserved for `exclusiveArea`, which genuinely has fractional precision).

## 6. Contract Date

`dealYear`/`dealMonth`/`dealDay` is the **reporting/contract date** — there is no separate "계약 시작일" field distinct from this; `contractTerm` (e.g. `"26.01~27.01"`) is a free-text lease-period string, not a queryable start/end date pair. Recommend reconstructing `dealDate` from the 3 integer fields exactly as `ApartmentTradeHistory.dealDate` already does for sale (`@db.Date`, built from `dealYear`/`dealMonth`/`dealDay` — "동일한 원본 정수 3개를 합친 것" per that model's own comment) — same principle, no new judgment call needed. Dashboard/volume aggregation should use this `dealDate`, matching how sale volume aggregation already works.

## 7. Cancellation — Critical Finding

**The `RTMSDataSvcAptRent` response contains no cancellation-related field whatsoever** — confirmed empirically: none of `등기일자`, `rgstDate`, `해제여부`, `cdealType`, `해제사유발생일`, `cdealDay` appear anywhere in the raw response, across all 2,543 records sampled.

This matters because **the app's existing code (`src/lib/api-molit.ts`) currently calls the same `parseCancellationFields(item)` helper on rent items as it does on sale items** — for rent, every one of those lookups silently misses, producing `dealCanceled: false` for literally every rent record, unconditionally. This is not "verified not canceled" — it is **"cancellation cannot be determined from this source at all."** This existing behavior was not introduced by this PHASE and is not changed by it (no code was modified — PHASE A is audit-only), but it must be corrected as part of PHASE B/C so the new rent DB does not silently imply a guarantee (`dealCanceled=false` for all rows) that the source data cannot support.

**Design implication:** the rent schema should **not** carry a `dealCanceled` boolean with a `false` default the way sale does (which is backed by a real, verified source field). Two honest options: (a) omit the concept of cancellation entirely for rent v1, documenting it as `NOT_AVAILABLE` at the product/UI level wherever rent-derived "cancelled excluded" claims are made; or (b) carry a `cancellationStatus: 'NOT_TRACKED'` constant field for schema symmetry/future-proofing without implying real tracking. **Recommend (a)** — don't add a column that can only ever hold one meaningless constant value.

## 8. Renewal / Contract Type

`contractType` ∈ `{신규, 갱신, ''}` (empty = pre-rollout or genuinely unrecorded — never coerce to a guessed value). `useRRRight` ('사용' or empty) is **only meaningful in combination with `contractType='갱신'`** — cross-checked live: of 526 real 갱신 contracts, 525 (99.8%) had `preDeposit` filled; of 1,974 real 신규 contracts, **0** had `preDeposit` filled. This is a clean, real, verifiable correlation (not a guess) — `preDeposit`/`preMonthlyRent` are populated by MOLIT specifically and only for renewal contracts.

## 9. Previous Rent Values

`preDeposit`/`preMonthlyRent` (종전 보증금/월세) — confirmed in §8 to be renewal-only fields, low overall fill rate (13–17 of ~100–160 per month in recent data) simply because renewal contracts are a minority of all rent contracts in any given month, not a data-quality issue.

## 10. Identity

**aptSeq coverage: 100% present**, live-tested across all 5 required districts (서구/해운대구/부산진구/동래구/기장군), most recent month:

| District | n | aptSeq missing | unique aptSeq | ApartmentMaster MATCHED | UNMATCHED |
|---|---|---|---|---|---|
| 서구 | 96 | 0 | 39 | 35 (90%) | 4 |
| 해운대구 | 784 | 0 | 181 | 171 (94%) | 10 |
| 부산진구 | 868 | 0 | 217 | 181 (83%) | 36 |
| 동래구 | 480 | 0 | 129 | 116 (90%) | 13 |
| 기장군 | 315 | 0 | 80 | 66 (82%) | 14 |

`aptSeq` itself is never missing (`MISSING_APTSEQ = 0` everywhere tested), but **10–18% of aptSeq values seen in rent data do not currently exist in `ApartmentMaster`** — this PHASE does not determine why (could be `ApartmentMaster`'s own coverage gaps for buildings with rentals but no recent sales, or non-apartment housing types loosely included by MOLIT's rent endpoint) and does **not** recommend guessing a fallback. **Recommend for PHASE B/C:** UNMATCHED aptSeq rows are still stored (aptSeq is real, verifiable MOLIT identity — never discarded), but flagged (e.g. via a `masterMatched: boolean` derived check at query time, not a stored guess) so consumers can distinguish "linked to a known apartment" from "real MOLIT identity, but not yet in our master registry" — never silently fall back to name-only matching (per this project's hard identity rule).

## 11. Natural Key

**Candidate:** `aptSeq + dealDate + exclusiveArea + floor + deposit + monthlyRent`. Live duplicate audit (2,543 records, 5 districts, one month): **153 duplicate keys** out of 2,375 unique combinations — genuine collisions exist. Root cause (verified, not guessed): MOLIT's public rent data does **not** disclose unit/호 (unit) number for privacy — a large complex can have multiple physically-distinct units sharing the exact same floor+area+price+date (a very plausible, observed pattern especially in newly-leased buildings — one duplicate sample was a brand-new complex leasing several identical-layout units on its first reporting day). Dropping `floor` from the key made collisions *worse* (178 vs 153), confirming floor should stay in the key.

**This is the same class of problem the existing sale `ApartmentTradeHistory` model already solved** via `occurrenceIndex` (`같은 자연키 내 MOLIT 응답 원본 등장 순서(0부터)`). **Recommendation: adopt the identical pattern** — natural key = `groupKeyStr + deposit + monthlyRent + dealDate + floor + occurrenceIndex`, with `occurrenceIndex` disambiguating true duplicates rather than merging or discarding them.

## 12. Data Model Options

### Option A — Separate `apartment_rent_histories` table (recommended)
- **Pros:** Money semantics are genuinely different (two money fields — deposit + monthlyRent — vs. sale's one; no cancellation field vs. sale's real cancellation tracking; renewal/previous-value fields with no sale equivalent). A separate table keeps each domain's `NOT NULL`/nullable constraints honest instead of forcing sale-only columns to be nullable for rent rows and vice versa. Matches this project's own established pattern of one table per genuinely-distinct MOLIT operation (`ApartmentTradeHistory` for `RTMSDataSvcAptTradeDev` only — sale). Query simplicity: no `WHERE dealType='sale'` guard needed on every sale query to exclude rent rows (a real, current cost avoided). Clean future nationwide sync (independent completeness manifest, independent backfill schedule, doesn't risk cross-contaminating sale's already-stable 855K-row table).
- **Cons:** A second manifest/completeness-tracking scheme to maintain; some duplicated infrastructure code (mitigated by extracting shared pure logic, e.g. `computeMonthsForRegion` from `incremental-sync-logic.ts`, into a data-source-agnostic form during PHASE B).

### Option B — Extend `ApartmentTradeHistory` with nullable rent columns
- **Pros:** One less table; some shared indexes/infra.
- **Cons:** `dealAmount` (required, `Int`, matey sale semantics) would need to become optional or repurposed, breaking its current guarantee for every existing sale consumer. `deposit`/`monthlyRent`/`contractType`/`preDeposit`/`useRRRight` would all be nullable on every sale row forever. `dealCanceled` (real, verified for sale) would coexist confusingly with rent rows where it's structurally meaningless (§7). The existing 855K-row, production-stable sale table would need a migration touching its most heavily-queried columns — meaningfully higher risk for zero real benefit over Option A.

### Recommended: **Option A.**

## 13. Recommended Schema Candidate (design only — no migration created this PHASE)

```prisma
model ApartmentRentHistory {
  id Int @id @default(autoincrement())

  source String @default("MOLIT_APT_RENT") @map("source")

  lawdCd  String @map("lawd_cd")
  dealYmd String @map("deal_ymd")

  aptSeq      String? @map("apt_seq")            // §10: present in 100% of samples so far, but keep nullable to match sale's own defensive convention rather than assume permanence
  identityKey String  @map("identity_key")        // aptSeq 우선, 없으면 name+dong — regional-feed.ts identityKey() 재사용
  dealType    String  @map("deal_type")           // 'jeonse' | 'wolse' — derived once at ingestion from monthlyRent===0, never re-derived per-query
  groupKeyStr String  @map("group_key")           // identityKey::areaKey::dealType (전세/월세는 서로 다른 비교군)

  aptName String  @map("apt_name")
  dong    String  @map("dong")
  jibun   String? @map("jibun")

  exclusiveArea Decimal @map("exclusive_area")    // raw, 그대로 — Unit Master identity 원칙과 동일

  deposit     Int @map("deposit")                 // 만원 단위, Int(sale의 dealAmount와 동일 관례)
  monthlyRent Int @map("monthly_rent")             // 만원 단위, Int, jeonse는 항상 0

  dealYear  Int      @map("deal_year")
  dealMonth Int      @map("deal_month")
  dealDay   Int      @map("deal_day")
  dealDate  DateTime @map("deal_date") @db.Date

  floor     Int? @map("floor")
  buildYear Int? @map("build_year")

  // §8/§9 — 갱신계약 전용, 신규계약은 항상 null(강제 채움 금지)
  contractType     String? @map("contract_type")      // '신규' | '갱신' | null(수집 이전/미기재)
  contractTerm     String? @map("contract_term")       // free-text lease period, e.g. "26.01~27.01"
  preDeposit       Int?    @map("pre_deposit")
  preMonthlyRent   Int?    @map("pre_monthly_rent")
  useRenewalRight  Boolean? @map("use_renewal_right")  // §12: null=UNKNOWN(미기재), true=사용 확인, **false는 절대 쓰지 않음**(소스에 "미사용" 값이 없음)

  // §7 — 의도적으로 dealCanceled 필드를 두지 않는다. 소스 자체에 취소 개념이 없다
  // (RTMSDataSvcAptRent에 해제여부/해제사유발생일류 필드가 존재하지 않음, 실측
  // 확인). 있지도 않은 신뢰를 암시하는 컬럼을 만들지 않는다.

  occurrenceIndex Int @default(0) @map("occurrence_index") // §11 — 자연키 충돌(동일 층/면적/가격/날짜의 서로 다른 호실) 시 구분자

  sourceFetchedAt DateTime @default(now()) @map("source_fetched_at")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @default(now()) @updatedAt @map("updated_at")

  @@unique([groupKeyStr, deposit, monthlyRent, dealDate, floor, occurrenceIndex], name: "rent_natural_key")
  @@index([aptSeq, exclusiveArea, dealDate])
  @@index([lawdCd, dealDate])
  @@index([identityKey, dealDate])
  @@index([dealDate])
  @@index([lawdCd, dealType, dealDate]) // §14/§23 — PERFORMANCE_V1.1-A's lesson applied upfront: dashboard's actual query shape (region + jeonse/wolse + period) gets this composite index from day one instead of discovering the gap after launch
  @@map("apartment_rent_histories")
}
```

## 14. Index Design Rationale

- `(aptSeq, exclusiveArea, dealDate)` — apartment-detail rent history, mirrors sale's own proven index for the same access pattern.
- `(lawdCd, dealDate)` — general district-scoped range queries.
- `(identityKey, dealDate)` — gap-invest's "latest jeonse for this identity+area near a reference date" lookup.
- `(dealDate)` — date-only scans (rare, kept for parity with sale).
- `(lawdCd, dealType, dealDate)` — **added proactively**, unlike sale where this exact gap (`PERFORMANCE_V1.1-A`) was only discovered after a production performance incident. Dashboard's actual query is always "this region + jeonse or wolse + this period" — designing the index to match that shape from the start avoids repeating the missing-composite-index mistake.

No partial indexes recommended (mirrors the `PERFORMANCE_V1.1-A` finding that `dealCanceled`-style partial predicates gave negligible benefit for sale; rent has no such column at all).

## 15. Completeness Model

Reuse the existing, already-proven `CellStatus` type from `scripts/incremental-sync-logic.ts` (`COMPLETE | EMPTY_VALID | FAILED | INVALID`) unchanged — this is a data-source-agnostic concept (a month×district cell either completed successfully with N≥0 real rows, completed successfully with 0 rows, failed to fetch, or returned malformed data) and applies identically to rent. **Failed cells must never be recorded as `EMPTY_VALID`** (§34) — same principle already enforced for sale.

## 16. Sync Architecture

Reuse, not reinvent, from `scripts/incremental-sync-logic.ts` / `incremental-sync-nationwide.ts`:
- **Region enumeration** — identical (same `lawdCd` list, same district-code source).
- **Bounded concurrency** — `GLOBAL_MOLIT_CONCURRENCY=6` already exists as a *global* limiter in `molit-stats-helpers.ts` shared across all MOLIT call types — rent sync should register through the same limiter, not a separate one (avoids doubling real external load).
- **Overlap window** — sale's `DEFAULT_OVERLAP_MONTHS=3` was derived from a *measured* cancellation-lag percentile distribution (p90=3 months). **Rent has no cancellation field to measure a lag from (§7)**, so that specific justification does not transfer. What *can* recur for rent without a cancellation flag: a late-reported contract appearing in a re-fetch of an already-"complete" month, or (unverified this PHASE) a corrected record replacing an earlier one at the same natural key. **Recommend PHASE B start with the same 3-month overlap as a starting default** (consistent, conservative, no reason yet to differ) but explicitly flag it as a placeholder pending real measurement — PHASE B/C should re-fetch the same rent month twice, weeks apart, and diff the results to establish a real, rent-specific late-reporting curve before finalizing this number.
- **Idempotency** — the natural key (§11, with `occurrenceIndex`) plus an upsert-by-natural-key sync (not blind insert) gives the same duplicate-insert-proof guarantee sale already has.

## 17. Correction Policy (open question — do not implement without confirming in PHASE B)

Because there is no cancellation/correction signal in the raw response (§7), this PHASE **cannot** determine from the source alone whether MOLIT ever revises an already-published rent record in place, or only ever adds new records. **Recommend:** PHASE B's first empirical step should be exactly the re-fetch-and-diff test described in §16 before choosing between overwrite / new-version / cancel+new — implementing a correction policy on an unverified assumption would violate this project's "no guessing" principle.

## 18. Volume Semantics

Each row = one reported contract (jeonse or wolse), matching sale's "each row = one reported trade" convention exactly. Since there is no cancellation flag, volume counts for rent **cannot exclude "cancelled" trades** the way sale volume does — this must be stated honestly in any rent-volume UI/API (no silent parity with sale's `dealCanceled=false` filtering, since the concept doesn't exist here).

## 19. Jeonse Ratio (전세가율) — Current Semantics, Unchanged

`gap-invest-calc.ts` matches "latest sale" against "latest jeonse, same identity+area, within a 90-day window" to compute a gap (`sale.dealAmount - jeonse.dealAmount`). This PHASE does not change this formula (explicitly out of scope, §38) — the recommended schema (§13) supports the same query shape via `(identityKey, dealDate)`, so this consumer's existing logic can migrate to DB-first without a formula change.

## 20. Future Use — Schema Does Not Block

- **갭 분석 (gap-invest):** supported as-is (§19).
- **신규/갱신계약 breakdown:** `contractType` column, already present, supports this directly.
- **임대료 변화 tracking:** `preDeposit`/`preMonthlyRent` + `deposit`/`monthlyRent` on renewal rows directly support "how much did rent change on renewal" queries without new columns.
- **Finance Fit (future):** deposit/monthlyRent as separate integer columns (not pre-combined into one "cost" figure) keeps this flexible for whatever affordability formula a future STEP designs — this PHASE does not define that formula.

## 21. Dashboard Root Cause — Quantified

Confirmed directly in `src/app/api/stats/dashboard/route.ts`: for Busan-wide (`isSidoAll` + `isBusanScopedRequest`), sale tasks are skipped (already DB-first) but **rent tasks are pushed for every district × every month unconditionally** — `16 districts × 12 months = 192 rent MOLIT calls`, bounded by the shared `GLOBAL_MOLIT_CONCURRENCY=6` limiter, i.e. a minimum of `192/6 = 32` sequential concurrency-waves. At even a modest ~0.6–1s average external-call latency per wave, this alone accounts for the observed 20–30+ second latency — no other computation in that code path is remotely this expensive (matches `PERFORMANCE_V1.md` §6's finding exactly, now with the precise task-count arithmetic behind it).

## 22. Expected Performance After DB-First (design target, not yet implemented)

Applying the two hard lessons from `PERFORMANCE_V1.1-A`/`-B` (index alone is not enough; raw-row Prisma materialization is usually the real cost) **from day one**:
- Dashboard's rent aggregation (counts/sums by period, by jeonse/wolse) should be computed via SQL `GROUP BY`/window functions returning only final summary rows — never pulling raw rent rows into Node for JS-side reduction, mirroring `getYearlySaleAggregate`'s and `STEP C-2`'s already-proven pattern.
- Target: **1 DB query** for Busan-wide dashboard rent aggregation (matching area84's post-`V1.1-B` single-`$queryRaw` shape), warm ≤500ms, cold ≤1–1.5s — same targets `PERFORMANCE_V1` established, now achievable because the data will be local instead of a 192-call external fan-out.

## 23. Storage Estimate

Order-of-magnitude only (PHASE A does not backfill, so this is not a live count): sale's Busan backfill was ~855K rows for 2006–2026 (20 years). Rent reporting is confirmed to start later (~2011, §2) and — based on the per-district-per-month sample sizes observed in this PHASE (e.g. 부산진구 868 rent records in one month, 서구 96) — is a comparable or somewhat smaller order of magnitude per district-month than sale. A rough Busan-wide 24-month estimate: ~2,500 records/month (5-district sample total) scaled to 16 districts and adjusted for district-size variance suggests **tens of thousands of rows for a 24-month Busan backfill**, and plausibly 300K–500K+ for full history back to ~2011 — **this is a rough order-of-magnitude placeholder for planning, not a commitment; PHASE B/C should compute a real count via a bounded read-only MOLIT sweep before backfill, exactly as the sale backfill did.**

## 24. Launch Minimum Backfill (recommendation)

Dashboard/volume's own existing lookback is 12 months (`last12Months`); price-ranking's shared lookback constant is 24 months (`HISTORICAL_LOOKBACK_MONTHS`). **Recommend a 24-month Busan-wide launch backfill** — sufficient to DB-first the dashboard (12mo) with headroom matching the same lookback convention already used everywhere else in this app (consistency, and covers `jeonse-risk` mode's own period needs), with full historical backfill (~2011–present) as an explicit, separate, later PHASE decision (not required to unblock the dashboard bottleneck this project is chasing).

## 25. Privacy

No personally-identifying fields were observed in the raw response (no names, phone numbers, or unit/호 numbers — MOLIT's public rent data is already anonymized at the source, consistent with sale). Nothing to exclude beyond what sale already handles.

## 26. Vercel / Prisma Materialization Warning Carried Forward

`PERFORMANCE_V1.md`/`PERFORMANCE_V1_1_AREA84_INDEX.md` documented a suspected Prisma+PgBouncer prepared-statement overhead gap between local and Vercel production, unrelated to and not fixed by this PHASE. Separately and directly actionable here: **PHASE B/C's dashboard rewrite must not repeat `PERFORMANCE_V1.1-A`'s original mistake** of building an index without first confirming the query returns few enough rows to avoid Prisma's row-materialization cost — §22 already designs around this from the start.

---

## 27. Implementation Phases (proposed)

- **PHASE B — Schema + Sync Engine:** create the actual Prisma migration for `ApartmentRentHistory` (§13), implement the ingestion/normalization function (`RTMSDataSvcAptRent` → `ApartmentRentHistory` rows), implement the re-fetch-and-diff correction-policy experiment (§17), wire into the existing manifest/completeness infra (§15/§16).
- **PHASE C — Busan Backfill:** execute the 24-month Busan-wide backfill (§24) using the sync engine from PHASE B, with real row-count/runtime/storage numbers replacing this PHASE's estimates (§23).
- **PHASE D — Dashboard DB-First:** rewrite `/api/stats/dashboard`'s rent aggregation to SQL-first (§22), closing the 20–30s bottleneck this whole initiative exists to fix.
- **PHASE E — Other Rent Consumers:** migrate apartment-detail rent history, `jeonse-risk` ranking, and `gap-invest` to the new DB-first path (P1/P2 per §25 of the task spec), in that order.

## 28. Risks / PM Decisions Required (STOP gate for this PHASE)

1. **No cancellation tracking for rent** (§7) — confirm the product is comfortable presenting rent volume/history without a "cancelled excluded" guarantee, unlike sale.
2. **10–18% ApartmentMaster UNMATCHED rate** (§10) — confirm storing real-but-unmatched aptSeq rows (never falling back to name-only identity) is acceptable, with those rows simply not linking to a detail page until `ApartmentMaster` coverage improves.
3. **Correction policy unverified** (§17) — needs a PHASE B experiment before implementation, not a PHASE A guess.
4. **Backfill range** (§24) — 24-month launch minimum vs. full-history (~2011–present) is a scope/cost decision, not a technical one.
5. **Schema approval** (§13) — this is a new production table; per this project's own DB-safety rules, creating it requires explicit approval before PHASE B proceeds (this PHASE created no migration).

No production schema, migration, or data write was performed in this PHASE.
