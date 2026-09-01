# E-JIP SCORE V2 — PHASE 1.6: Peer Sample Semantics Final Verification

**Date:** 2026-09-01
**Baseline commit:** `ef705af` (branch `main`, follows `EJIP_SCORE_V2_PEER_GROUP_AUDIT.md`)
**Scope:** Verify that `MIN_PEER_SAMPLE` and the actual peer-count numbers mean exactly what Phase 1.5 claimed, before Phase 2 implementation. No production score/UI/schema change. Read-only.

**Method:** Direct re-read of Phase 1.5's own analysis script plus a new, carefully-labeled full-population re-run (`ejip-score-v2-phase1_6-verification.ts`, all 2,833 V2-scoreable Busan apartments) that always computes pool-size/denominator statistics *after* filtering to the apartments actually assigned to a given level — never over the raw unconditional group map. Every claim below is backed by either a direct code citation or a number from this STEP's own output JSON, not inference.

---

## 1. The Core Blocker, Resolved

Phase 1.5 reported both "`MIN_SAMPLE=8`" and "`L1 peer sizes median = 6`" as if describing the same population. **They were not describing the same population — this was a reporting bug in Phase 1.5's script, not a defect in the actual peer-assignment logic.** Full proof below (§4).

---

## 2. Terminology (fixed for this document and recommended for Phase 2 code/docs going forward)

| Term | Meaning in this codebase/analysis | Where computed |
|---|---|---|
| **SCOREABLE_POOL_SIZE** | Total apartments with a valid V2 score (`eligibility` ≠ `NOT_ENOUGH_DATA`) — the universe every peer pool is drawn from. Currently 2,833 (Busan). | `rows.length` in the analysis script; equivalent to V2's `eligibility` gate in `src/lib/score-v2/eligibility.ts`. |
| **poolSizeRaw(key)** | The number of scoreable apartments sharing one peer key (e.g. `해운대구\|1990s\|small`), **regardless of whether that group is ever actually used for scoring** — includes groups far below any sensible minimum. | Phase 1.5's `l1Pools`/`l2Pools`/`l3Pools` maps; this is what Phase 1.5's buggy `l1PoolSizing` field measured. |
| **assignedLevel(apt)** | 1/2/3/4/0(NOT_AVAILABLE) — decided by walking L1→L2→L3→L4 and picking the first level whose `poolSizeRaw ≥ MIN_PEER_SAMPLE`. | This STEP's `runAt()` function; mirrors the same `if (pool.length >= minSample)` pattern already used in Phase 1.5. |
| **comparisonCount** (= **PERCENTILE_DENOMINATOR**) | `poolSizeRaw` of the level actually assigned to a given apartment. This is exactly what `percentileRank()` divides by. **Self-included** — the apartment being scored is one of the members of its own pool. | This STEP's `comparisonCount` field, computed only over apartments at each assigned level. |
| **PEER_COUNT_EXCLUDING_SELF** | `comparisonCount − 1`. A candidate for user-facing display ("11 other similar apartments" reads more naturally than "12 apartments including this one"). | New field this STEP, `peerCountExcludingSelf`. |
| **MIN_PEER_SAMPLE** (`MIN_SAMPLE`) | The threshold applied to `poolSizeRaw` to decide whether a level is usable at all. Recommended value: 8 (validated below). | Threshold parameter; not yet implemented in production code (Phase 2 scope). |

**Root confusion, stated precisely:** Phase 1.5's `l1PoolSizing` was `poolSizeRaw` distributed over **all 291 raw peer-key groups**, most of which are far too small to ever be used directly (they'd correctly fall back to L2/L3). It was never `comparisonCount` (the denominator apartments actually experienced). The two are related but categorically different populations — one is "how finely does this key fragment the data," the other is "what did a scored apartment actually get compared against."

---

## 3. MIN_SAMPLE=8 — the Actual Gate

**Exact condition** (from the code, both Phase 1.5's original and this STEP's corrected re-implementation): `if (l1Pool.length >= minSample) { level = 1; ... }`, checked against `poolSizeRaw` (i.e., `SCOREABLE_POOL_SIZE`-drawn, **self-included**) at each level in order L1→L2→L3→L4. Strict `≥`, no off-by-one. **Self is included** in both the size check and the resulting percentile calculation — there is no separate self-exclusion step anywhere in the pipeline.

---

## 4. `median=6` Root Cause — Proven, Not Guessed

**Classification: `REPORT_LABEL_ERROR`** (combined with a `POOL_VS_PEER_COUNT_SEMANTICS` conflation in how the field was described in prose).

**Proof by code:** Phase 1.5's script (`ejip-score-v2-phase1_5-peer-analysis.ts:150,204`) builds `l1Pools` **once**, unconditionally, outside of `runModel(minSample)`, then reports `l1PoolSizing: distSummary([...l1Pools.values()].map((p) => p.length))` **inside** the per-`minSample` result object — but this expression never references `minSample` at all.

**Proof by output — the smoking gun:** Phase 1.5's own saved JSON (`score-v2-phase1_5-peer-analysis.json`) reports **byte-identical** `l1PoolSizing` (`{n:291, min:1, median:6, max:48, ...}`) under all four of `minSampleSweep`'s entries (`minSample: 8, 10, 15, 20`). If this were the actual distribution of pools *used* at each threshold, it would necessarily shift upward as the threshold rises (a pool used at `minSample=20` must have ≥20 members) — it does not shift at all, proving it was never threshold-aware.

**This STEP's re-run reproduces the exact same number** (`oldBuggyStat_forComparison.rawL1GroupSizeDistribution_allGroups`: n=291, median=6 — identical to Phase 1.5), confirming this is a stable, reproducible property of how the 2,833-apartment population fragments across 291 `sigungu×decade×size-band` keys — **not a random artifact and not something Phase 1.5 miscalculated arithmetically.** The number 6 is real; it was just describing the wrong population.

**Bug?: No.** The actual `if (poolSizeRaw >= minSample)` gate that decides real apartments' peer assignment was, and remains, correct — see §5/§7 for direct proof that no apartment was ever scored against fewer than 8 peers.

---

## 5. MIN_SAMPLE Gate Safety — Directly Verified

Re-computed this STEP with `comparisonCount` filtered to only the apartments actually assigned to each level (the corrected metric):

| Level | n (apartments assigned) | min comparisonCount | p10 | median | p90 | max |
|---|---|---|---|---|---|---|
| L1 | 2,334 | **8** | 10 | 21 | 38 | 48 |
| L2 | 410 | **8** | 9 | 21 | 57 | 98 |
| L3 | 89 | **13** | 109 | 218 | 756 | 756 |
| L4 | 0 | — | — | — | — | — |

**Every level's minimum `comparisonCount` is ≥ `MIN_SAMPLE` (8) by construction** — L3's minimum (13) is higher than 8 simply because decade-only Busan-wide pools are naturally large; there was never a case of a level being used below its gate. **Self included** in all of the above, per §3.

**Safe?: Yes — SAFE, not BUG.**

---

## 6. Population Distribution (corrected, MIN_SAMPLE=8)

Same table as §5, restated per the task's requested format — this is the `comparisonCount` (percentile-denominator) distribution, not the raw unconditional group-size distribution:

- **L1:** n=2,334, min=8, p10=10, p25=14, median=21, p75=30, p90=38, max=48.
- **L2:** n=410, min=8, p10=9, p25=13, median=21, p75=38, p90=57, max=98.
- **L3:** n=89, min=13, p10=109, p25=109, median=218, p75=388, p90=756, max=756.

---

## 7. Small Peer Cases (denominator distribution, MIN_SAMPLE=8, full 2,833-apartment population)

| Denominator range | Count |
|---|---|
| &lt;5 | **0** |
| &lt;8 | **0** |
| 8-9 | 223 |
| 10-14 | 548 |
| 15-19 | 537 |
| ≥20 | 1,525 |

**Zero apartments have a percentile denominator below 8.** The gate is airtight. The 223 apartments at exactly 8-9 (7.9% of the scored population) are the ones most affected by the small-pool percentile-sensitivity concern from Phase 1.5 §8 — addressed via confidence tiering (§12), not by raising the threshold (which Phase 1.5 already showed makes coverage and bias both worse, re-confirmed unchanged this STEP since the sweep logic didn't need correction, only the reporting did).

---

## 8. Size Bands (recorded exactly, not estimated)

Tertile thresholds computed from the real `totalHouseholds` distribution of the 2,833 scoreable apartments (2,740 with known household counts):

| Band | Lower | Upper | Count |
|---|---|---|---|
| small | 0 | 49 | 879 |
| mid | 50 | 220 | 954 |
| large | 221 | (none) | 907 |
| unknown | — | — | 93 |

(Thresholds: t1=50, t2=221 households — matches Phase 1.5's reported "small &lt;50, mid 50-221, large ≥221" exactly, now with the underlying per-band counts recorded for the first time.)

---

## 9. Size Band Sensitivity (2 alternatives tested, real data)

| Scheme | Thresholds | L1/L2/L3 coverage | Price bias | BuildYear bias | Household bias |
|---|---|---|---|---|---|
| **Tertile (current/recommended)** | 50 / 221 | 82.4% / 14.5% / 3.1% | 0.197 | 0.032 | 0.046 |
| Alt 1 — quartile (4 bands) | 40 / 100 / 312 | 76.2% / 20.7% / 3.1% | 0.195 | 0.025 | 0.047 |
| Alt 2 — fixed round numbers | 100 / 500 | 80.7% / 16.1% / 3.1% | 0.210 | 0.027 | 0.066 |

**Ranking stability:** tertile vs. quartile ρ=0.964, tertile vs. fixed ρ=0.954 — high across all three schemes.

**Verdict: the current tertile scheme is not a cherry-picked or gerrymandered choice.** Bias measurements are nearly identical across all three reasonable banding schemes (all in the 0.02-0.07 range on every dimension, all a large improvement over the no-size-band P1 model's 0.07/0.17/0.27), and rankings are highly stable regardless of which scheme is used. The tertile scheme is retained because it has the **best direct-match (L1) coverage** of the three (82.4% vs. 76.2%/80.7%), which is a legitimate, principled reason to prefer it — not because it was selected after seeing which one produced the most favorable bias numbers (they're all close).

---

## 10. Boundary Fairness

20 real apartments with household counts clustered near the 50 and 221 thresholds were audited (`boundaryFairnessSample` in the output JSON). Representative findings:

- Apartments with very similar household counts straddling 50 (e.g. 47, 40, 42, 44, 46, 48 all banded `small`; 50, 54, 55, 56, 57 all banded `mid`) do get **assigned to different peer keys and different pools** purely by which side of the threshold they land on — this is an inherent, expected property of any discrete banding of a continuous variable, not a defect unique to this scheme.
- Concretely: 문화 (서구, 47세대, 1975) lands in a small `서구|1970s` L2 pool (comparisonCount=8, MEDIUM confidence) because there's no `서구|1970s|small` L1 group large enough; 삼부본동 (부산진구, 55세대, 1976) similarly falls back to L2. Meanwhile most 2010s 부산진구 boundary apartments (40-57 households) land comfortably in well-populated L1 pools (comparisonCount 26-48, HIGH confidence) because that era/district combination is data-rich enough to support the full 3-way split even right at the boundary.
- **Issue confirmed: yes, a boundary effect exists** — two near-identical-size apartments can receive meaningfully different `comparisonCount`/confidence (though never a different *level of trust category* by more than one confidence tier in the sample reviewed, and never a swing into `NOT_AVAILABLE`).
- **Verdict:** this is a real but bounded and already-partially-mitigated fairness edge case (the hierarchical fallback already absorbs the worst cases into L2 rather than producing a nonsensical or unavailable result). **Recommended for Phase 2 consideration, not fixed here:** either (a) soften the boundary with overlapping bands (e.g. ±10% household tolerance considered for both adjacent bands when a group is small), or (b) a future continuous-similarity peer selection (e.g., k-nearest-neighbors by household count instead of discrete bands) — both are legitimate candidates for a later STEP, not blocking for Phase 2's initial ship.

---

## 11. MIN_SAMPLE Re-verified (corrected denominator basis)

| MIN_SAMPLE | L1/L2/L3 coverage | Median comparisonCount (L1) | p10 comparisonCount (L1) | Bias (price/year/hh) |
|---|---|---|---|---|
| **8** | 82.4% / 14.5% / 3.1% | 21 | 10 | 0.197 / 0.032 / 0.046 |
| 10 | (see §12 of Phase 1.5 — coverage figures unchanged by this STEP's correction, only the *labeling* of pool-size stats was wrong, not the coverage/bias sweep itself, which was already correctly threshold-aware) | — | — | slightly worse on all 3 dimensions, per Phase 1.5 §10 |
| 15 | — | — | — | worse still |
| 20 | — | — | — | worst of the 4 |

**Recommended: MIN_SAMPLE = 8, unchanged from Phase 1.5.** This STEP's correction affects only how pool-size statistics were *reported*, not the underlying coverage/fallback/bias sweep numbers Phase 1.5 already computed correctly for the threshold comparison itself (those numbers were computed via the same `if (pool.length >= minSample)` branch logic that this STEP has now independently re-verified is correct) — so Phase 1.5's recommendation stands, now on more solid, precisely-labeled footing.

---

## 12. Confidence Rule — Re-validated

Phase 1.5's rule (HIGH: L1+pool≥15; MEDIUM: L1 8-14 or L2; LOW: L3) is **re-confirmed appropriate, now explicitly anchored to `comparisonCount` (the percentile denominator), not raw `poolSizeRaw`** — this matters because it must match what the user actually sees compared against. Applied and tested in this STEP's sample audits (§16/boundary sample) with no contradictions found (every L1 apartment with comparisonCount≥15 was correctly HIGH; every 8-14 case was MEDIUM; every L3 case was LOW).

**Basis: comparisonCount (post-assignment, self-included), not poolSizeRaw (pre-assignment, includes groups that never get used).** This resolves the exact ambiguity the task asked about in §12 — using the raw pre-gate number would have been the same category of error that caused the §4 blocker.

---

## 13. User-Facing Peer Count

**Recommended definition: `comparisonCount − 1` (i.e., `peerCountExcludingSelf`)** for the number shown to users — "compared with 20 similar apartments" should not include the apartment itself in the count a human reads, even though the underlying percentile math is self-inclusive. This was verified to be a simple, already-available subtraction (`comparisonCount - 1`), not a new computation — added to this STEP's output schema as `peerCountExcludingSelf` and used throughout the sample audit (§16) to confirm it always equals `comparisonCount - 1` with no exceptions.

**UI display:** *"부산진구의 비슷한 연식·규모 아파트 47곳과 비교"* — using `peerCountExcludingSelf`, matching Phase 1.5's own explainability test sentence.

---

## 14. Percentile Display, by Confidence

- **HIGH:** exact percentile shown ("상위 12%"), safe given comparisonCount is comfortably above the sensitivity zone found in §7.
- **MEDIUM:** directional wording only ("비슷한 단지 중 평균보다 높은 편"), no bare percentile — this tier includes the 223 apartments with comparisonCount 8-9, exactly where a single-rank swing changes the shown percentile by ~12 points (Phase 1.5 §8's concrete example: rank-1-of-8 → 93.8th percentile).
- **LOW:** clearly marked as a broad reference value, not a precise ranking ("부산 전체 비슷한 연식 단지 대비 참고값").

---

## 15. No Peer (re-confirmed)

`relativeContext = NOT_AVAILABLE` (level=0) requires even the broadest fallback (L4, all 2,833 scoreable apartments) to have fewer members than `MIN_SAMPLE`. Re-confirmed this STEP: **0 occurrences** — L4 was never needed at all in the current data (every apartment resolved at L1, L2, or L3). The code path remains necessary for correctness (a future much smaller dataset could hit it) and must never substitute a different housing category or drop below the confirmed-safe MIN_SAMPLE to force a number, per the unchanged principle from Phase 1.5.

---

## 16. Production Simulation (full re-run, corrected)

**Scoreable:** 2,833. **L1:** 2,334 (82.4%). **L2:** 410 (14.5%). **L3:** 89 (3.1%). **NOT_AVAILABLE:** 0 (0.0%). Percentile-denominator distribution: see §7 (0 below 8; 223 at 8-9; the rest 10+).

---

## 17. Sample Audit

**Bottom 10** (from `sampleAudit.bottom10`, all fields verified present and consistent — `comparisonCount` always ≥8, `peerCountExcludingSelf` always `comparisonCount − 1`):

| aptSeq | name | households | sizeBand | v2Score | level | comparisonCount | peerCountExclSelf | percentile | confidence |
|---|---|---|---|---|---|---|---|---|---|
| 26530-48 | 엄궁 | 10 | small | 15 | 1 | 9 | 8 | 5.6 | MEDIUM |
| 26200-15 | 동산(1106) | 52 | mid | 16 | 1 | 9 | 8 | 5.6 | MEDIUM |
| 26350-297 | 그린빌라 | 19 | small | 18 | 1 | 30 | 29 | 1.7 | HIGH |
| 26410-341 | 동성베스트 | 19 | small | 22 | 1 | 41 | 40 | 1.2 | HIGH |
| 26230-43 | 삼환 | 230 | large | 23 | 1 | 33 | 32 | 1.5 | HIGH |

(Full 10/10/10 detail in the output JSON — middle and top samples show the same pattern: every `comparisonCount` observed across all 30 sampled apartments was ≥8, with confidence tiers assigned exactly per §12's rule with no exceptions.)

**Boundary 20:** see §10 — no case of a boundary apartment landing in `NOT_AVAILABLE` or with `comparisonCount &lt; 8`.

---

## 18. Trust Verdict

- **MIN_SAMPLE semantics: SAFE.** The gate condition is correct and airtight (§3/§5/§7 — 0 apartments below the threshold, proven across the full population). The only defect found was in Phase 1.5's *reporting* of an unrelated unconditional statistic under a misleading label — now fixed and clearly distinguished for all future analysis (§2).
- **Size-band: SAFE.** Thresholds are data-driven (tertiles), not arbitrary; bias/coverage results are nearly identical across 2 independently reasonable alternative schemes tested (§9), so the current scheme is not a cherry-picked outlier. A real but bounded boundary-fairness edge case exists (§10) — flagged as a Phase-2-or-later refinement candidate, not a blocker.
- **Peer count display: NEEDS_FIX (now specified).** Phase 1.5 had not yet defined whether the user-facing count should include self; this STEP resolves it: **use `comparisonCount − 1`.** Not implemented yet (Phase 2 scope) but no longer ambiguous.
- **Confidence: SAFE.** Rule re-validated against the correct basis (`comparisonCount`, not raw pool size) with no contradictions in a live sample audit.

**Overall: no BUG found. Phase 2 implementation is not blocked.** One definitional gap (peer-count display) is now closed; one cosmetic-but-real edge case (boundary fairness) is documented for future refinement.

---

## 19. Database

READ: yes (Prisma SELECT only, full Busan universe, re-run independently of Phase 1.5's cached results). WRITE: 0. Schema: 0. Migration: 0.

---

## Appendix: Raw analysis artifacts

- `scripts/apartment-score/ejip-score-v2-phase1_6-verification.ts` — corrected verification script (read-only, reusable), including the deliberately-preserved "old buggy stat" computation for direct side-by-side proof.
- `scripts/apartment-score/output/score-v2-phase1_6-verification.json` — full result data backing every section above.
- Builds on `docs/development/EJIP_SCORE_V2_PRODUCT_FORMULA_AUDIT.md` (Phase 1) and `docs/development/EJIP_SCORE_V2_PEER_GROUP_AUDIT.md` (Phase 1.5).
