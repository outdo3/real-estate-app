# E-JIP SCORE V2 — PHASE 1: Product / Formula Architecture Audit

**Date:** 2026-09-01
**Baseline commit:** `35dfe75` (branch `main`)
**Scope:** Audit only. No production formula/weight change, no UI change, no schema change, no writes. Deliverable is a recommendation for a future Phase 2 implementation STEP.

**Method:** Full line-by-line reconstruction of both score engines (V1 legacy, V2 live), a raw-input trust audit, and a real production-data simulation (read-only) across the entire Busan apartment universe with location-feature coverage (3,401 apartments, 2,833 of which produce a V2 score today). Two throwaway analysis scripts were written for this STEP and are kept under `scripts/apartment-score/` for reproducibility: `ejip-score-v2-phase1-analysis.ts` (distribution/bias/model-simulation) and `ejip-score-v2-phase1-blocker-check.ts` (quantifies one specific finding below). Both are read-only.

---

## 1. Current Model

**What users actually see today is V2** (`src/lib/score-v2/engine.ts`), not the "official" V1. This was already fixed for API-label correctness in the prior `LAUNCH_TRUST_BLOCKERS_V1` STEP; this Phase 1 audit reconstructs the actual math.

**Categories (domains):** transport, living, education, complex — each weighted exactly **25%**, as a literal hardcoded object (`DOMAIN_WEIGHTS`, `engine.ts:32-37`), confirmed genuinely equal (not derived from anything).

**Per-domain pipeline** (input → normalization → subscore → composition):

| Domain | Inputs | Normalization | Composition |
|---|---|---|---|
| **Transport** | subway status (4-state: VALUE/CONFIRMED_ABSENT/MISSING/INVALID) + distance, bus stop distance, bus stop count/300m | Subway: piecewise-linear on distance, anchors `[0,92]…[2000,5]`, clamp `[5,95]`; `CONFIRMED_ABSENT`→ floor `5` (not excluded, not null); bus distance: logistic decreasing (mid=110m); bus count: saturating curve | subway 70% + bus(dist 50%/count 50%) 30% |
| **Living** | mart/convenience/pharmacy/hospital counts within 500m–1000m | Saturating half-life curve per type: `95·(1-0.5^(count/halfLife))`, clamp `[0,95]`; a real `0` scores `0` (not treated as missing) | convenience 30 / mart 20 / pharmacy 25 / hospital 25 |
| **Education** | nearest elementary distance only (attendance-zone status is evidence-only, does **not** affect the score) | Single-factor logistic decreasing (mid=420m), clamp `[8,95]` | 100% one factor |
| **Complex** | build year (age), total households (scale), parking ratio | Age: piecewise-linear, `[0,95]…[64,8]`; Scale: piecewise-linear on households, `[0,15]…[3000,95]`; Parking: piecewise-linear on ratio `[0,5]…[2.5,95]`, or an era-conditioned neutral prior when parking data is missing (see §5) | age 45% + scale 40% + parking 15% |

**Overall composition:** weighted average of the 4 present domains, renormalized over whichever domains are actually present (`composeDomains`, `engine.ts:56-81`). No `Math.round` inside the engine — rounding happens only at render time (`Math.round()` in `ApartmentScoreCard.tsx`).

**Normalization method:** absolute, not relative. Every curve is a **fixed anchor table calibrated once** from a historical Busan percentile study (per code comments, "STEP 3.5/3.7 frozen candidate") — the score never compares one apartment against another at request time. `RelativeContext` (busanPercentile/sigunguPercentile/rank) is a fully-defined type that is **never populated** (`engine.ts:168` hardcodes it `null`) and **never read** by any UI component — dead scaffolding, not a bug, but notably it means the type contract for a peer-relative extension already exists in the codebase today.

**Missing data handling:** exclusion + renormalization, with a hard **40% absorption cap** (`maxAbsorbShare=0.4`) at both the intra-domain and inter-domain level. A missing factor's weight is removed from the denominator used to average present factors — it is never averaged in as a zero. The 0.4 cap prevents a single present factor from masquerading as full confidence; the shortfall instead reduces `coverage`, which gates `eligibility`: **coverage ≥0.75 → SCORE_AVAILABLE, ≥0.4 → LIMITED, else → NOT_ENOUGH_DATA** (score forced to `null` in the last case). An `identityEligible` gate (`location != null && sggCd != null && geocodeQuality === 'exact'`) additionally zeroes out transport/living/education entirely (complex domain alone survives) for coordinate-unreliable apartments.

**Formula version:** `SCORE_V2_VERSION = 'EJIP_SCORE_V2_1'`. Confirmed (per the prior STEP) that the API's `scoreVersion` field now correctly reports this — no drift found.

---

## 2. Data Inputs

All four raw-input families were classified **SAFE** by an independent trust audit (see full detail in that agent's findings, summarized here):

| Input | Source | Coverage (Busan) | Classification |
|---|---|---|---|
| Subway/bus distance | Kakao Local API POI, batch-collected, 30-day TTL (no scheduled re-run found — a process gap, not a live-data problem: 0 stale rows today) | 81.7% non-null subway (of the null 622, 91% are `CONFIRMED_ABSENT`, i.e. verified-no-station, only 1.6% of the total universe is genuinely unresolved); 90%+ for bus | **SAFE** |
| Living POI counts | Kakao Local API, same batch | ~99.5-100% | **SAFE** |
| Elementary distance | Kakao Local API POI (straight-line, explicitly documented as accessibility not zoning truth) | 98.9% | **SAFE** |
| Attendance-zone status | Static official artifact (학구도안내서비스), point-in-time snapshot (2026-03-20), no scheduled refresh | 99.5%; but **evidence-only, never affects the score** | **SAFE (moot for scoring)** |
| Build year / households | 건축물대장 registry via `ApartmentMaster`, aptSeq-keyed | buildYear 100%, households 93.1% | **SAFE** |
| Parking ratio | Same registry | **69.1% `KNOWN`**, 30.9% `MISSING` | **LIMITED** — real, quantified gap, but handled via a disclosed era-conditioned neutral-prior substitution (see §5), not silent zero-fill |

**No BLOCKER-class raw-input finding.** Confirmed, with code citations: (a) missing data never silently becomes 0 anywhere in the V2 pipeline; (b) V2 pulls **zero** cross-apartment/peer data into the score — every curve is a fixed absolute anchor, and the adapter feeds only the target apartment's own rows; (c) every DB read in the score path (route → `calculateApartmentScore` → `adaptToV2Input`) is keyed by `aptSeq`, never by name — the one name-based lookup in the API route is deliberately `lawdCd`-scoped and fails closed to `AMBIGUOUS` rather than guessing.

---

## 3. Distribution (real production data, n=2,833 scoreable Busan apartments)

| Stratum | n | min | p10 | p25 | median | p75 | p90 | max | mean | std |
|---|---|---|---|---|---|---|---|---|---|---|
| **Overall** | 2,833 | 15 | 40 | 47 | 55 | 62 | 67 | 78 | 54.2 | 10.4 |
| 해운대구 | 238 | 18 | 35 | 43 | 54 | 61 | 66 | 74 | 51.7 | 12.0 |
| 서구 | 129 | 22 | 38 | 49 | 61 | 65 | 67 | 73 | 56.1 | 12.2 |
| 동래구 | 284 | 35 | 48 | 53 | 59 | 65 | 68 | 77 | 58.9 | 8.0 |
| 부산진구 | 338 | 21 | 42 | 49 | 59 | 65 | 68 | 78 | 56.6 | 10.3 |
| 기장군 | 116 | 23 | 36 | 42 | 48 | 54 | 57 | 66 | 47.3 | 8.5 |
| 신축 (2015+) | 718 | 23 | 49 | 56 | 62 | 66 | 70 | 78 | 60.5 | 8.5 |
| 구축 (2000 미만) | 1,102 | 15 | 36 | 42 | 49 | 55 | 60 | 74 | 48.6 | 9.4 |
| 대단지 (≥312세대, p75) | 686 | 26 | 43 | 50 | 57 | 63 | 69 | 78 | 56.3 | 9.9 |
| 소단지 (≤40세대, p25) | 718 | 15 | 40 | 47 | 55 | 61 | 65 | 75 | 53.3 | 10.2 |
| 고가 (평당가 상위25%) | 678 | 29 | 48 | 55 | 60 | 66 | 71 | 78 | 59.9 | 8.7 |
| 중저가 (평당가 하위25%) | 675 | 15 | 35 | 40 | 47 | 53 | 58 | 72 | 46.4 | 9.3 |

**Eligibility breakdown (full universe, n=3,401):** `SCORE_AVAILABLE` 2,833 (83.3%), `NOT_ENOUGH_DATA` 568 (16.7%).

**Clustering:** 29.6% of scoreable apartments fall in the 60-70 band — a real concentration, but not extreme relative to the overall spread (std=10.4, range effectively 15-78, not a narrow band). Score is **not** artificially compressed into a tight middle; the max observed (78) never approaches the curve ceiling (95), meaning even the best-scoring real Busan apartment today is well short of "perfect" — the absolute scale has headroom.

---

## 4. Bias

Spearman correlations against the full 2,833-apartment sample:

| Relationship | ρ | Verdict |
|---|---|---|
| Price (평당가) vs. overall score | **0.51** | **Real, moderate-strong bias.** 고가 mean 59.9 vs. 중저가 mean 46.4 — a 13.5-point gap. |
| Build year vs. overall score | **0.49** | **Real, moderate-strong bias.** 신축 mean 60.5 vs. 구축 mean 48.6 — a 11.9-point gap. |
| Households vs. overall score | **0.09** | **Weak at the whole-population level** — large-complex bias is NOT a strong linear effect across the full range. |
| Households vs. complex-domain score | 0.62 | Expected/definitional (complex domain directly scores scale) — not itself evidence of cross-domain double counting. |
| Transport domain vs. overall | 0.73 | Transport is the single strongest driver of where an apartment lands overall. |
| Living domain vs. overall | 0.69 | Second-strongest driver. |
| Complex domain vs. overall | 0.44 | Moderate driver. |
| Education domain vs. overall | **0.37** | **Weakest driver of overall variance** — despite carrying an equal 25% nominal weight, education explains the least of the observed spread. |

**Interpretation:**
- **Price and build-year bias are real and measurable**, not imagined. An apartment is not scored "expensive = good" directly (price is not an input to the formula at all — confirmed, no price/market field feeds any V2 domain), but the *underlying real-world correlates* of price (transit access, newer construction, denser amenities) are exactly what the formula measures, so the resulting score correlates with price as a side effect. This is the expected behavior of an "objective livability facts" score, not evidence of a formula literally rewarding price — but it means the score **cannot currently answer "is this a good value for the price," only "does this location/building have good raw facts,"** and users may conflate the two.
- **Large-complex bias is weaker than commonly assumed** at the full-population level (ρ=0.09) — while the complex domain itself rewards scale heavily, that domain is only 25% of the total, and the other 75% (transport/living/education) is driven by location, not unit count, which dilutes the household effect on the *overall* number. However, see §6 below: the effect is **not linear** — the extreme low end (very small buildings, <20 households) is where a real structural penalty shows up.
- **Education is nominally equal-weighted but empirically the least influential domain.** This directly supports the task's own concern (§16) that a fixed 25% for a factor that matters enormously to some users (families with school-age children) and not at all to others (no plan to homeschool nearby, no children) is exactly the kind of factor most suited to becoming user-adjustable rather than fixed.
- **No evidence of literal double-counting** (the same raw fact entering two different domains' formulas) was found in the code reconstruction — each domain's inputs are disjoint (transport uses transit distances, living uses POI counts, education uses school distance, complex uses building facts). The households↔complex-domain correlation is domain-internal by design, not a bug.

---

## 5. Missing Data

**Confirmed policy: exclusion + renormalization + confidence downgrade — never silent 0.** See §1/§2 for the exact mechanism (40% absorption cap, coverage→eligibility gating). Two specific mechanics worth flagging for the record:

1. **Parking (`complex.ts`):** when parking is `MISSING` (31% of Busan), the domain doesn't just exclude it — it substitutes a **real, DB-measured era-conditioned average** (e.g. 53 points for a 21-30-year-old building) into the *score* while still marking it `missingFactors` for *coverage* purposes. This is a previously-approved, frozen, fully-disclosed design (STEP 3.5/3.7) — the one place in the whole engine where "missing" becomes an *estimated* number rather than a purely excluded one. A hard safeguard exists: if age AND scale are *also* missing, the whole complex-domain score is forced to `null` rather than returning a lone guessed parking number.
2. **`identityEligible` gate:** an apartment with unreliable geocoding (`geocodeQuality !== 'exact'`) gets transport/living/education all forced to an explicit `emptyDomain` with a machine-readable reason — it cannot produce a plausible-looking score built on wrong coordinates.

**⚠️ BLOCKER-class finding (confirmed by direct code read, not delegated):** `calculateApartmentScore()` (`src/lib/apartment-score/server/calculate.ts`) computes V2's result unconditionally at line 150, **before** V1's own unrelated peer-percentile coverage check at line 155. But the `INSUFFICIENT_DATA` return branch (lines 156-167, triggered when **V1's** category coverage <60%) **omits `_shadowV2` from the returned object entirely** — even though it was already computed successfully two lines earlier. Since `ApartmentScoreCard.tsx` gates on `result.status !== 'OK'` **before** ever looking at `_shadowV2`, this means: **an apartment can have a fully valid, computable V2 score, and still show the generic "점수 산정 준비 중입니다" empty state, purely because V1's separate, no-longer-displayed peer-percentile machinery didn't clear an unrelated 60% threshold.** This is exactly the audit's own STOP condition #5 ("계산 근거가 코드와 UI 설명에서 서로 다름" — the UI's implicit story is "V2 governs display," but the actual gate is V1's).

**Measured real-world impact:** a dedicated verification script (`ejip-score-v2-phase1-blocker-check.ts`) ran `calculateApartmentScore()` for the **entire** Busan universe (n=3,401) to find every apartment where V1's top-level `status` is not `'OK'` (i.e., where the coverage gate could have suppressed `_shadowV2`). **Result: 0 out of 3,401 (0.0%).** V1's `MIN_TOTAL_COVERAGE=0.6` gate never actually trips in the current Busan dataset — likely because V1's category-to-total combination is **uncapped** (§ code-reconstruction finding: unlike V2's 0.4 absorption cap, V1 lets a single surviving category carry 100% of the total score's weight), which makes clearing 60% coverage comparatively easy even with sparse per-category data.

**So the measured, present-day impact of this specific defect is zero apartments today.** This does not make it a non-issue: the code path is a real, confirmed architectural inconsistency ("계산 based on V1, displayed as V2") that happens to not currently bite because V1's own gate is looser than V2's, purely by coincidence of two independently-tuned thresholds. It is a latent correctness bug — a future change to either engine's thresholds (or new data patterns) could silently start suppressing valid V2 scores with no test currently guarding against it. **Recommendation downgraded from "urgent BLOCKER" to "must-fix-before-Phase-2, not urgent-today":** the bug should still be closed by making the display gate key off V2's own `eligibility` (see §14), both for correctness and so this stops being a coincidental non-issue and becomes a guaranteed non-issue — but it is not currently costing any real user a score.

**A second, related correction to this audit's own starting premise:** the task assumed V1's `categories`/`briefing`/`regionalStrengths`/`market` are "still shown separately" on the detail page. **This is not accurate in the current codebase.** A full grep of `apt-client.tsx` found zero references to any of those V1 fields. The "단지 브리핑" UI block is powered by a **second, entirely independent, V2-based** component (`ApartmentBriefingV2.tsx`) with its own hardcoded threshold rules (e.g., "신축" if age≤5, "대단지" if households≥1000) — not derived from V1's `briefing.ts` at all. **V1's briefing/categories/regionalStrengths/market are computed on every single request and shipped in the API JSON payload, but consumed by nobody.** This is a second, independent argument (beyond the coverage-gate bug above) for retiring V1's non-score computation entirely in Phase 2 — it is pure server cost for zero user value today.

---

## 6. Resident Risk

Real bottom/middle/top-20 samples were pulled from the production simulation (full lists in `scripts/apartment-score/output/score-v2-phase1-analysis.json`).

**Bottom 10 (scores 15-23):** Overwhelmingly **very small buildings** (10-230 households, several literally named "○○빌라" — low-rise multi-family housing registered in the same `ApartmentMaster` table as large apartment complexes) in older construction (1975-2004, most pre-2000). Representative case: 엄궁 (사상구, 1983, 10 households) scores transport=7/living=22/education=14/complex=19 → overall 15. Every domain is genuinely weak for this specific building — small scale, older construction, and (per the domain breakdown) poor transit access — the low score is **fully explainable by real facts**, not a data-missing artifact or a computation error.

**Would a real resident find this explainable?** Partially. The *mechanism* is explainable (transport 7/100, complex 19/100 — a resident could see exactly why). But an absolute "15/100" on a 0-100 scale reads as a near-failing grade to a Korean audience regardless of the underlying explanation, and the comparison implied by "/100" is against an unstated universe that includes 3,000+-household new-build towers — a genuinely unfair comparison for a 10-household 1983 building that was never going to be evaluated as a "modern high-amenity apartment" in the first place. **This is the single clearest resident-backlash risk found in this audit**: small/older buildings are not being penalized by a bug, but the **absolute 0-100 framing invites a comparison the formula was never designed to make fairly.**

**Middle 20 (score ≈55):** Very high *domain* variance despite identical totals — e.g. one apartment scores transport=78/education=21 while another at the same overall total scores transport=36/education=54. **The total score alone tells a user almost nothing about what kind of apartment it is** — two "55-point" apartments can be nearly opposite in character. This is strong, concrete evidence for de-emphasizing the total in favor of category-level display (see §10/§13).

**Top 10 (scores 74-78):** Exclusively recent construction (2006-2024, mostly 2016+) in centrally-located, well-connected districts (부산진구/동래구/연제구/수영구). These look **legitimately justified** — no outlier/gaming pattern found; the top scorers are genuinely well-served by transit and amenities, not merely expensive-by-coincidence.

**Verdict:** Low scores are data-driven and explainable at the mechanism level, but the **absolute framing itself, not the math, is the main resident-backlash risk** — especially for the ~25% of the universe in small/older buildings that structurally cannot compete with new large towers on this scale's own terms. This is a strong argument for Model C/D (relative-to-comparable-peers) over continuing Model A/B as the primary user-facing number.

---

## 7. Absolute vs. Relative

Four models were compared using the **same already-computed V2 domain data** (no new formula was run in production — Models B/C below are post-hoc re-rankings of the identical raw numbers Model A already produces):

- **Model A (current):** absolute, fixed curves, no comparison group. Score is stable over time (an apartment's score doesn't change just because a new building opened nearby) and interpretable ("this specific fact is true or not"), but as shown in §6, the 0-100 absolute framing invites unfair comparisons across incomparable building types.
- **Model B (Busan-wide percentile of the same V2 score):** `Spearman(A, B) = 0.9999996` — essentially a monotonic relabeling. **Model B does not fix any of the biases found in §4**, because it's a strictly rank-preserving transform of the identical underlying number — whatever ordering price/build-year bias produced in Model A is exactly preserved in Model B. Its only benefit is guaranteeing a full 0-100 spread and an easy "상위 N%" framing; it does not change *which* apartments are considered good or bad.
- **Model C (peer-group percentile, sigungu × build-decade):** `Spearman(A, C) = 0.76` — a **materially different ranking**, not just relabeling. 24% of rank variance is explained by something other than the absolute score — i.e., comparing within a same-era, same-district peer group genuinely changes many apartments' relative standing (typically: older/smaller buildings that were penalized in Model A rise when compared only against similar-era peers instead of the whole city's new-build stock).
- **Model D (hybrid — keep Model A's absolute evidence as-is, add Model C's peer-relative percentile as a second, clearly-labeled number, don't replace one with the other):** not separately simulated as a new score (it reuses A and C's already-computed numbers side by side) — see §13 (Model D) and §15 (Implementation Plan) for the concrete proposal.

**Peer-group feasibility (Model C):** with a sigungu×decade key, there are 95 distinct peer groups across the 2,833-apartment sample; **median pool size 24, only 3.1% of apartments fall into a group smaller than the 8-sample safety threshold** (which then falls back to the Busan-wide pool). This peer-group design is realistically implementable without a severe small-sample problem.

---

## 8. Peer Groups

**Recommended candidate: sigungu (구/군) × build-year decade band.** Justification from real data (§7): materially reorders rankings vs. the absolute score (unlike price-tier or household-count grouping, which would mostly re-derive what the absolute score already encodes), and empirically has enough samples (median 24/group, only 3.1% needing fallback).

**Rejected/secondary candidates considered:**
- **Price-band peer group:** circular — price already correlates 0.51 with the score, so grouping by price band would mostly just re-normalize away the very signal the score is supposed to measure independently. Not recommended as a primary peer key.
- **Household-count band:** weak overall bias (ρ=0.09) means this axis carries less unfairness to correct for than build-year; still useful as a *secondary* qualifier if sigungu×decade pools are ever too coarse.
- **Housing type (아파트 vs 빌라):** the bottom-sample finding in §6 suggests this may actually be the single most important peer-group axis to add in a future iteration — comparing a 10-household 빌라 against other 빌라, not against 3,000-household towers, likely addresses the clearest resident-backlash case found in this audit. **Not implemented/tested in this Phase 1 pass** (would require a reliable building-type classification field, which was not confirmed to exist during this audit) — flagged as the top candidate for Phase 2 data-readiness investigation.
- **Pyeong/area band:** not tested this STEP; a plausible future refinement once housing-type grouping is validated.

**Minimum sample rule:** ≥8 apartments in a peer group to use that group directly; otherwise fall back to the next-broadest group (e.g. sigungu-only, then Busan-wide) — mirrors the existing, already-proven LOCAL→SIGUNGU→REGION_WIDE fallback pattern already implemented for V1's peer pooling (`peer-groups.ts`), so this is not a new pattern for the codebase, just applied to a different score.

---

## 9. Model Simulations

Real production data, not synthetic — see §Appendix for the reusable script. 16 representative rows below (6 bottom, 4 middle, 6 top by current absolute score), showing Model A (current), Model B (Busan-wide percentile of the same score), Model C (sigungu×decade peer percentile of the same score), and the domain that most explains the result:

| aptSeq | name | region | buildYear | households | currentScore (A) | Model B %ile | Model C %ile | majorReason |
|---|---|---|---|---|---|---|---|---|
| 26530-48 | 엄궁 | 사상구 | 1983 | 10 | 15 | 0.0 | 2.3 | weakest: transport(7); strongest: living(22) |
| 26200-15 | 동산(1106) | 영도구 | 1990 | 52 | 16 | 0.1 | 2.0 | weakest: living(3); strongest: complex(28) |
| 26350-297 | 그린빌라 | 해운대구 | 1991 | 19 | 18 | 0.1 | 0.5 | weakest: living(12); strongest: complex(25) |
| 26350-296 | 라온힐즈 | 해운대구 | 1993 | 19 | 19 | 0.1 | 1.5 | weakest: transport(12); strongest: complex(31) |
| 26350-295 | 영동써니 | 해운대구 | 1992 | 19 | 20 | 0.2 | 2.6 | weakest: transport(15); strongest: complex(28) |
| 26230-42 | 대진파레스필즈 | 부산진구 | 1992 | 160 | 21 | 0.2 | 1.1 | weakest: living(8); strongest: complex(40) |
| 26380-13 | 동덕 | 사하구 | 1987 | 40 | 55 | 48.9 | **76.6** | weakest: complex(24); strongest: transport(75) |
| 26380-31 | 새괴정화신 | 사하구 | 1981 | 100 | 55 | 48.9 | **76.6** | weakest: complex(29); strongest: education(74) |
| 26350-131 | 엘지 | 해운대구 | 1996 | 48 | 55 | 48.9 | 64.9 | weakest: complex(43); strongest: education(71) |
| 26350-2342 | 해운대자이2차1단지 | 해운대구 | 2018 | 734 | 55 | 48.9 | **40.4** | weakest: transport(36); strongest: complex(79) |
| 26230-2523 | 개금역금강펜테리움더스퀘어 | 부산진구 | 2018 | 620 | 78 | 100.0 | 99.5 | weakest: living(72); strongest: transport(88) |
| 26260-2110 | 동래효성해링턴플레이스 | 동래구 | 2019 | 762 | 77 | 99.9 | 99.4 | weakest: education(71); strongest: complex(83) |
| 26230-1682 | 전포동에메랄드홈 | 부산진구 | 2006 | 241 | 77 | 99.9 | 99.5 | weakest: complex(60); strongest: transport(89) |
| 26230-2845 | 서면롯데캐슬엘루체 | 부산진구 | 2023 | 450 | 77 | 99.9 | 97.7 | weakest: transport(60); strongest: complex(85) |
| 26230-2853 | 서면동원시티비스타 | 부산진구 | 2024 | 176 | 77 | 99.9 | 97.7 | weakest: education(67); strongest: transport(88) |
| 26470-1566 | 아시아드코오롱하늘채 | 연제구 | 2019 | 660 | 76 | 99.8 | 99.1 | weakest: transport(68); strongest: complex(80) |

**Two examples that best illustrate why Model C is not merely "charitable to old buildings":**
- **새괴정화신** (사하구, 1981, 100 households): Model B (city-wide) percentile 48.9 — an unremarkable middle-of-the-pack score against all of Busan including new towers. Model C (peer group: 1980s 사하구 buildings) percentile **76.6** — genuinely a strong performer *for its actual category*. This is the exact resident-backlash mitigation case from §6: same underlying facts, but the fair comparison group changes the story from "average" to "good for what it is."
- **해운대자이2차1단지** (해운대구, 2018, 734 households — a well-known, well-regarded large complex): Model B percentile 48.9, but Model C (peer group: 2010s 해운대구 buildings) percentile is **40.4 — lower**, because within its own true peer group its transport domain (36) is below the local new-build norm. This proves Model C is a genuine re-ranking based on real comparison, not a one-directional "give old buildings a break" adjustment — a large, modern, popular complex can score *below* its absolute-percentile position once compared against equally-modern local peers.

**Ranking stability (full sample, n=2,833):** Spearman(A,B)≈1.00 (B is a pure relabeling, confirmed no bias correction); Spearman(A,C)=0.76 (C is a genuine, substantial re-ranking — roughly a quarter of relative rank position is attributable to peer-group context rather than the absolute score alone).

**Outlier check:** no nonsensical high or low scores were found in the top/bottom-20 review (§6) — every extreme score traces to real, verifiable underlying facts (verified subway/POI distances, real registry build year/household counts), not a data error or formula glitch.

---

## 10. Personalization

**Recommendation: user-selected importance weights, not an inferred user "persona."** Per the task's own explicit instruction, the app should not guess whether a user is "a family with kids" or "an investor" — instead, let the user directly declare which domains matter to them (교통/생활/교육/단지 sliders or presets), and recompute a **personalized weighted average of the same 4 domain scores** already being computed today. This requires no new raw data collection — only a new weighted-combination step on top of existing domain scores.

**Default weights:** 25/25/25/25 (today's behavior) when no personalization is set — this preserves the current objective, comparable "이집점수" as the default/baseline number for non-personalizing users and for any cross-apartment default comparison (e.g., ranking pages).

**User weights:** presented as either presets ("교통 중심," "학군 중심," "생활 편의 중심," "균형") or a raw per-domain importance slider. Given §4's finding that education has the least natural influence on the current score despite equal nominal weight, an explicit "학교 중요" toggle would give the family-with-kids segment real, visible control that the fixed formula currently denies them.

---

## 11. Score Confidence

Recommend a confidence label be shown alongside any future score, derived directly from the already-computed `eligibility`/`coverage` value (no new computation needed — V2 already tracks this internally, it's just not surfaced beyond the "제한된 데이터" tag today):

- **High confidence:** `SCORE_AVAILABLE` (coverage ≥0.75) — shown as-is.
- **Partial data:** `LIMITED` (coverage 0.4-0.75) — shown with a visible "일부 데이터 부족" tag (already exists in the UI, just needs to be paired with an explicit confidence framing rather than a bare score number).
- **Not available:** `NOT_ENOUGH_DATA` — no number shown at all (already the case), but **must be based on V2's own eligibility, not V1's**, per the §5 BLOCKER fix.

---

## 12. Explainability

Already reasonably strong today (per the code audit): the "왜 이런 점수인가요?" section shows real per-domain evidence (raw distances/counts), and `ApartmentBriefingV2` synthesizes a plain-language strengths/weaknesses/target-user summary. Recommended additions for Phase 2, informed by this audit's findings:

- Show the **comparison basis explicitly** whenever a relative/peer number is displayed ("동래구·2010년대 준공 단지 중 상위 20%" rather than a bare percentile).
- Show **domain-level breakdown more prominently than the total**, given §6's finding that same-total apartments can have opposite characters.
- For any domain relying on the era-conditioned parking substitution (§5), the evidence text should say so explicitly ("주차 정보가 없어 이 지역·연식 단지의 평균값으로 추정했습니다"), not just list it under a generic missing-data note.

---

## 13. Model Candidates

### Model A — Absolute (current, unchanged)
- **Concept:** fixed curves against real-world facts, no comparison.
- **Formula:** unchanged 25/25/25/25 over transport/living/education/complex.
- **Normalization:** frozen anchor tables (STEP 3.5/3.7).
- **Peer group:** none.
- **Weights:** fixed, equal.
- **Missing data:** exclude+renormalize, 0.4 cap, coverage-gated eligibility.
- **Confidence:** already computed (`eligibility`), not fully surfaced.
- **Personalization:** none possible without a weight-recombination layer.
- **Pros:** stable over time, easy to reason about ("subway is 300m away" is just a fact), already implemented and validated.
- **Cons:** measurable price/build-year bias (§4); structurally unfair to small/older buildings (§6); total number invites an unintended "grade" reading; education's fixed weight doesn't match its actual (low) influence or its high importance to a specific user segment.
- **Resident risk:** **High** for the bottom ~10-15% (small/older buildings) — confirmed by real sample.
- **Implementation complexity:** N/A (already shipped) — but has the §5 BLOCKER that must be fixed regardless.

### Model B — Busan-wide percentile of the same V2 score
- **Concept:** relabel Model A's number as a percentile rank.
- **Formula:** same as A; percentile transform only.
- **Normalization:** rank-based, city-wide pool.
- **Peer group:** all of Busan.
- **Weights:** same as A.
- **Missing data:** same as A (percentile only applies to already-scored apartments).
- **Confidence:** same as A.
- **Personalization:** would need per-personalized-weight percentile pools — nontrivial (a different percentile pool for every possible weight combination).
- **Pros:** guarantees full 0-100 spread; simple "상위 N%" story.
- **Cons:** **does not fix any bias** (ρ(A,B)≈1.0 — provably a pure relabeling); city-wide pool means an apartment's displayed number can silently drift over time purely because other apartments' data changed, with nothing about the apartment itself changing — a confusing property for a "why did my score change" support conversation.
- **Resident risk:** same as A, cosmetically repackaged.
- **Implementation complexity:** Low (pure post-processing step over existing scores).

### Model C — Peer-group (sigungu × build-decade) percentile
- **Concept:** compare each apartment only against genuinely comparable peers.
- **Formula:** same underlying domain scores as A; percentile within peer group instead of absolute display.
- **Normalization:** rank-based within group, city-wide fallback for small groups.
- **Peer group:** sigungu × build-year-decade (95 groups in current data, median size 24, 3.1% fallback rate).
- **Weights:** same domain scores as A feed the ranking.
- **Missing data:** same domain-level policy as A; peer-pool minimum-size fallback (≥8) mirrors V1's already-proven pattern.
- **Confidence:** same as A, plus a peer-pool-size-based caveat when falling back.
- **Personalization:** compatible — a personalized weighted score could be peer-ranked the same way.
- **Pros:** **materially changes rankings in a bias-correcting direction** (ρ(A,C)=0.76 — real reordering, not cosmetic); directly addresses the price/build-year bias by comparing like-with-like; addresses the resident-backlash risk in §6 far better than A/B.
- **Cons:** loses the "stable absolute fact" property — an apartment's peer percentile can shift when a new peer is added/removed from its group; requires clear UI framing so users understand "80th percentile among similar-era 동래구 apartments" ≠ "objectively great."
- **Resident risk:** **Lower** than A/B for the small/older-building segment; introduces a new smaller risk (an apartment near the top of a "weak" peer group could look artificially strong).
- **Implementation complexity:** Medium — needs a peer-pool computation step (already have a proven pattern to copy from V1's `peer-groups.ts`), needs new UI copy to explain the comparison basis; no new raw data collection needed.

### Model D — Hybrid (recommended, see §14)
- **Concept:** keep A's absolute per-domain facts as the primary, always-shown evidence; add C's peer-relative percentile as a clearly-labeled secondary number, not a replacement.
- **Formula:** A's domain scores, unchanged; C's peer-percentile computed on top, shown alongside rather than instead.
- **Normalization:** both absolute (curves) and relative (peer percentile) shown together.
- **Peer group:** same as C.
- **Weights:** A's fixed default + optional personalized weights (§10), applied to both the absolute number and the peer-percentile ranking consistently.
- **Missing data:** same as A/C.
- **Confidence:** shown explicitly (§11).
- **Personalization:** first-class — this model is designed around it.
- **Pros:** gets C's bias-correction and resident-risk benefit without discarding A's stability/explainability; the `RelativeContext` type already exists in the codebase (dead scaffolding, §1) — meaning roughly half the type-level plumbing for this model is already sitting unused, lowering implementation risk; naturally accommodates de-emphasizing the bare total (§6/§10) by giving the UI two numbers to design around instead of one.
- **Cons:** most UI/copy design work of the four options (though no more backend complexity than C alone); requires care so two numbers don't confuse users more than one did.
- **Resident risk:** **Lowest of the four** — a small/older building can honestly show "낮은 절대 평가, 그러나 비슷한 연식·지역 단지 중에서는 상위권" if that's true, which is both accurate and far less likely to read as an insult than a bare "18/100."
- **Implementation complexity:** Medium-High (mostly UI/copy design + populating the already-defined `RelativeContext` type + peer-pool computation reused from C).

---

## 14. PM Recommendation

**Recommended: Model D (Hybrid absolute + peer-relative), built on top of the existing V2 curves — no formula/weight change to the 4 domains themselves.**

Why, against each of the stated criteria:

- **사용자 신뢰 (user trust):** Model D never hides or replaces the honest absolute facts (subway is/isn't 300m away) that make V2 trustworthy today — it only adds a second, clearly-scoped comparison. Model B would have been trust-neutral-to-negative (a percentile that silently drifts without the apartment changing is a support/trust liability). Model C alone would trade one kind of honesty (absolute fact) for another (relative standing) rather than offering both.
- **의사결정 가치 (decision value):** §6's middle-20 sample proved that a bare total, absolute or relative, materially under-informs a user. Model D's two-number design (absolute evidence + peer-relative standing) is the only candidate that directly answers both "what are the real facts here" and "is this good for what it is," which is the actual decision users are making per the top-level product principle in this task's own §1.
- **설명 가능성 (explainability):** Model D requires no new explanation machinery beyond what's already planned in §12 — domain evidence text stays exactly as useful as it is today, and the peer-percentile only needs one new sentence of framing ("동래구·2010년대 준공 단지 중 상위 20%").
- **데이터 현실성 (data feasibility):** confirmed via real production simulation, not assumption — sigungu×decade peer pools are large enough (median 24, only 3.1% fallback) to support this today, with zero new raw-data collection.
- **개인화 확장성 (personalization extensibility):** Model D is the only candidate explicitly designed to carry a personalized weight vector through to both the absolute and the relative number consistently; A/B/C-alone would each need retrofitting for this later.
- **최소 위험 (lowest risk to ship):** the type-level `RelativeContext` scaffolding for exactly this model already exists in the codebase, unused — Phase 2 implementation risk is materially lower than building something wholly new.

**Independent of which model is chosen, the §5 BLOCKER (V1's coverage gate suppressing an eligible V2 score) must be fixed in Phase 2** — this is not a modeling choice, it's a correctness bug in the current shipped behavior.

---

## 15. Implementation Plan (Phase 2 scope, not built this STEP)

1. **Fix the §5 BLOCKER first, independently of the model decision:** change the eligibility/display gate in `calculateApartmentScore`/`route.ts` to key off V2's own `eligibility`, not V1's `coverage`. Retire V1's now-confirmed-unconsumed `categories`/`briefing`/`regionalStrengths`/`market` computation in the same pass (server-cost reduction, zero user-facing change since nothing reads them today) — requires explicit approval since it touches the score-adjacent code path, per project rules.
2. Implement the sigungu×decade peer-pool percentile computation (reuse the proven fallback pattern from `peer-groups.ts`), populate the already-defined `RelativeContext` type instead of leaving it `null`.
3. Design and ship the two-number UI (absolute evidence card, unchanged in spirit, + a new peer-relative line) — this is the larger design/UX task and should get its own brainstorming/design pass, not be treated as a mechanical add-on.
4. Add the personalized-weight layer (§9/§22/§23 in the parent task — normalization to 100, extreme-weight guardrails) as a distinct, later sub-step, since it depends on #2/#3 being stable first.
5. Revisit naming (§32) and versioning (`EJIP_SCORE_V2_2` once any of the above ships, per semver-like discipline already established by the `EJIP_SCORE_V2_1` constant) as part of the same Phase 2 STEP, not before.

Each of these remains subject to the existing project rule that Score changes require explicit user approval before implementation — this document is the audit and recommendation, not the approval.

---

## Appendix: Raw analysis artifacts

- `scripts/apartment-score/ejip-score-v2-phase1-analysis.ts` — distribution/bias/model-simulation script (read-only, reusable).
- `scripts/apartment-score/ejip-score-v2-phase1-blocker-check.ts` — quantifies the §5 BLOCKER's real-world prevalence (read-only, reusable).
- `scripts/apartment-score/output/score-v2-phase1-analysis.json` — full result data (distributions per stratum, bias correlations, bottom/middle/top-20 samples, peer-pool sizing) backing §3/§4/§6/§7 above.
