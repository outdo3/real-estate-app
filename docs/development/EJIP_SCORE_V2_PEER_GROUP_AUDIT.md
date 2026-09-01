# E-JIP SCORE V2 — PHASE 1.5: Peer Group & Housing-Type Trust Gate

**Date:** 2026-09-01
**Baseline commit:** `3742257` (branch `main`, follows `EJIP_SCORE_V2_PRODUCT_FORMULA_AUDIT.md`)
**Scope:** Validate the fairness/explainability of the peer group before Model D's peer-relative context is shown to users. No production score change, no UI change, no schema change, no writes, no personalization implementation.

**Method:** A schema/pipeline trace (not name-guessing) to answer the housing-type question, plus a full read-only production simulation across the entire Busan universe (n=3,401, 2,833 scoreable) comparing Phase 1's plain `sigungu × decade` peer model against a new size-band-aware hierarchical model, at 4 different minimum-sample thresholds. A second, independent code-reading pass re-verified and extended the Phase 1 V1/V2 gate finding and produced a field-by-field USED/DEAD/SHARED classification of V1's output. Artifacts: `scripts/apartment-score/ejip-score-v2-phase1_5-peer-analysis.ts` and its output JSON, kept for reproducibility.

---

## 1. Housing-Type Data

**Available fields:** none. `ApartmentMaster` (`prisma/schema.prisma:205-263`) has no `housingType`, `buildingType`, or any 공동주택 sub-classification (아파트/연립주택/다세대주택/주상복합) field. Confirmed by reading the full model definition — the only building-shape fields are `buildYear`, `mainBuildingCount` (동수), `totalHouseholds`, `parkingCount`, `floorAreaRatio`, `buildingCoverageRatio`.

**But this is not actually a gap** — traced the data pipeline instead of guessing from names, per the task's explicit instruction:

- `scripts/apartment_master_seed.ts:50` — the **only** discovery source for every `ApartmentMaster` row is `RTMSDataSvcAptTradeDev` (국토부 "아파트 매매 상세" — the apartment-only MOLIT operation). MOLIT publishes housing categories as genuinely separate government API operations: `RTMSDataSvcAptTradeDev`/`RTMSDataSvcAptRent` (아파트), `RTMSDataSvcRHTrade` (연립다세대/"빌라"), `RTMSDataSvcOffiTrade` (오피스텔) — confirmed in `src/lib/api-molit.ts:54-66`.
- Confirmed via grep: `RTMSDataSvcRHTrade` (연립다세대) is defined as a supported endpoint type in `api-molit.ts` but is **never actually invoked** anywhere in `src/` or `scripts/` with `type: 'rh'`. The live backfill pipeline (`scripts/backfill-trade-history.ts`) only ever requests `type: 'apt'`.
- The 건축물대장 (building registry) enrichment step that fills in `buildYear`/`totalHouseholds`/`parkingCount` afterward only enriches buildings that already passed the MOLIT-아파트 discovery gate — it does not independently sweep buildings by address.

**Conclusion:** every apartment in `ApartmentMaster` — and therefore in the score universe — is **already, by construction, MOLIT's own official "아파트" category**. There is no 연립다세대/다세대주택/오피스텔 mixed into the universe. A building whose registered name happens to contain "빌라" (e.g. "그린빌라," "동부썬빌라" — both found in Phase 1's bottom-20) is legally an 아파트 under Korean housing law (5+ stories or unit-count threshold under 주택법) despite its colloquial name — the name string is not evidence of misclassification, and this audit did not use name strings to classify anything, per instruction.

**Reliable / Limited / Unavailable:** reliable = none needed (category is uniform); limited = N/A; **unavailable = a true sub-type distinction (아파트 vs 주상복합 vs 도시형생활주택, all of which MOLIT's "아파트" operation can still lump together) does not exist in current data and was not fabricated for this audit.**

**This corrects the parent task's premise**, similar to Phase 1's correction of the V1-briefing assumption: the real structural risk Phase 1 found in the bottom-20 sample was never "housing type mixing" — it was **scale** (household count), which the codebase already tracks reliably (`totalHouseholds`, 93.1% coverage per Phase 1's data-trust audit). This document treats **size-band as the substitute axis** the parent task's P2-P5 candidates intended `housingType` to be, since it is the real, available, honest signal behind the same underlying concern.

---

## 2. Score Universe

Total (Busan, location-feature covered): **3,401**. Scoreable (V2 `SCORE_AVAILABLE`): **2,833** (83.3%). By construction (§1), 100% of both are MOLIT-아파트-category. No further housing-type breakdown exists or was fabricated.

**Size-band thresholds** (data-driven tertiles over the 2,833 scoreable apartments' `totalHouseholds`, following the same percentile methodology Phase 1 used for its large/small-complex comparison): **small &lt;50 세대, mid 50–221 세대, large ≥221 세대.**

---

## 3. Current Peer Model

**Definition (Phase 1's recommendation, "P1" in this document):** `sigungu × build-year decade`. **Groups:** 95 distinct peer keys across the 2,833-apartment sample. **Median size:** 24 (p10=5, p25=9, p75=45, p90=69, max=101, min=1). **Fallback:** at MIN_SAMPLE=8, only 3.1% of apartments fall into a group too small and drop to the Busan-wide pool.

**Risk identified in this STEP:** P1 alone does not control for building **scale**. Within the same district and construction era, a 10-household building and a 700-household tower are compared in the same pool — Phase 1's own bottom-20 sample showed this can leave small buildings looking artificially worse than a truly fair (same-scale) comparison would.

---

## 4. Model P1 (baseline, re-measured as a percentile this STEP)

- **Coverage:** 95 groups, median size 24, 96.9% direct-match at MIN_SAMPLE=8.
- **Bias (Spearman, peer-percentile vs. raw signal, n=2,833 at MIN_SAMPLE=8):** price ρ=**0.267**, buildYear ρ=**0.068**, households ρ=**0.165**.
  - Compared to Model A (absolute score) from Phase 1: price bias dropped from 0.51→0.27 and buildYear bias dropped dramatically from 0.49→0.07 — peer-grouping by district+decade already does most of the work on price/age bias by itself.
  - **But household bias actually went UP slightly relative to the absolute score (0.09→0.17)** — grouping by district+era without controlling for scale means a large complex's real scale advantage now shows up more consistently as "beating the local peer average," since its era-and-district peers include the small buildings it structurally outperforms on the complex domain.
- **Resident risk:** improved vs. absolute Model A (per Phase 1), but the household-bias increase means P1 alone is not sufficient — this is the concrete evidence for needing a scale-aware peer axis.

## 5. Housing-Type-Aware Models (P2/P3 as specified) — not run separately

Per §1, a genuine housing-type split has no available data and no real-world basis in this universe (it's already homogeneous) — running P2 (`housingType × sigungu × decade`) or P3 (`housingType × decade` with regional fallback) as literally specified would be indistinguishable from P1, since the housingType key would be constant for every row. **These are not separately simulated because doing so would produce numerically identical results to P1 — that identity is itself the finding.** The scale-aware hierarchical model below (§6-9) is the substantive replacement.

## 6-9. Hierarchical Size-Aware Model (P4/P5 equivalent)

**Levels:** `L1 = sigungu × decade × size-band` → `L2 = sigungu × decade` (drop size) → `L3 = decade, Busan-wide` (drop district too) → `L4 = Busan-wide, all` (drop era too) → if even L4 has fewer than MIN_SAMPLE members, **no relative score** (§16 — this never actually triggered in the real data, see below).

**Coverage at MIN_SAMPLE=8 (recommended, see §10):** L1 (full match) **82.4%**, L2 14.5%, L3 3.1%, L4/not-available **0%**.

**Bias after peer grouping (MIN_SAMPLE=8):** price ρ=**0.197** (down from P1's 0.267, down from Model A's 0.51), buildYear ρ=**0.032** (down from P1's 0.068, down from Model A's 0.49), households ρ=**0.046** (down from P1's 0.165, down from Model A's 0.09 — this is the key result: adding the size axis doesn't just avoid making household bias worse than the absolute score, it makes it the **lowest of all three models tested**).

**Ranking stability P1 vs. hierarchical:** ρ=0.946-0.956 across all 4 MIN_SAMPLE values tested — high (most apartments don't dramatically reorder) but not trivial: roughly 5-9% of rank variance is attributable to the added size dimension, a genuine, not cosmetic, refinement.

**Verdict: the hierarchical size-aware model strictly dominates P1 on every bias dimension measured, at every MIN_SAMPLE threshold tested, while maintaining strong (82.4%) primary-tier peer-group coverage.** This is the recommended peer architecture (§21/§26).

---

## 10. Minimum Sample

Full sweep, all values measured against real production data (not assumed):

| MIN_SAMPLE | P1 fallback rate | P1 bias (price/year/hh) | Hierarchical L1/L2/L3 coverage | Hierarchical bias (price/year/hh) | Rank stability (P1 vs Hier) |
|---|---|---|---|---|---|
| **8** | 3.1% | 0.27 / 0.07 / 0.16 | 82.4% / 14.5% / 3.1% | **0.20 / 0.03 / 0.05** | 0.946 |
| 10 | 5.0% | 0.28 / 0.09 / 0.17 | 76.4% / 18.7% / 5.0% | 0.21 / 0.03 / 0.05 | 0.947 |
| 15 | 9.7% | 0.30 / 0.13 / 0.18 | 60.3% / 30.0% / 9.3% | 0.22 / 0.04 / 0.08 | 0.952 |
| 20 | 12.6% | 0.31 / 0.15 / 0.18 | 43.2% / 44.2% / 12.2% | 0.24 / 0.05 / 0.09 | 0.956 |

**Recommended: MIN_SAMPLE = 8 (Phase 1's original recommendation, now empirically confirmed as the best of the 4 tested, not just "acceptable").** Raising the threshold does not improve fairness — it makes every bias measurement *worse* (more apartments fall back to broader, less-specific comparison pools) while directly trading away primary-tier ("compared to genuinely similar peers") coverage from 82.4% down to as low as 43.2% at MIN_SAMPLE=20. There is no dimension on which a higher minimum sample wins in this dataset — the only reason to consider raising it would be per-group percentile *precision* (see §8 below), not fairness.

## 8 (percentile sensitivity at small n)

Real example groups of exactly 8 members: rank-1 lands at the **93.8th percentile**, rank-2 at **81.3rd percentile** — consistent with the task's own concern (a group of 8 is a small enough sample that a single rank position swings the displayed percentile by ~12 points). However, this affects a small minority of groups: only **9 of 291 total L1 peer groups** (3.1% of groups, not of apartments) sit at exactly the MIN_SAMPLE=8 floor — most L1 groups are comfortably larger (median 6... [see note] — actually L1 pool sizing median is smaller than P1's because L1 subdivides further; see the recommended confidence design in §14, which directly compensates for this rather than raising MIN_SAMPLE for everyone). **Recommendation: do not raise MIN_SAMPLE to fix this — instead, attach an explicit confidence/pool-size caveat to percentiles computed from small pools (§14), so the number itself stays honest about its own precision instead of the whole model being made less fair to compensate.**

---

## 11. Bias After Peer (summary)

| Bias | Model A (absolute) | Model P1 (district×decade) | Hierarchical (district×decade×size) |
|---|---|---|---|
| Price | 0.51 | 0.27 | **0.20** |
| Build year | 0.49 | 0.07 | **0.03** |
| Households | 0.09 | 0.17 | **0.05** |

The hierarchical model is the only one of the three that improves on **all three** bias dimensions simultaneously relative to the absolute score. P1 alone trades build-year/price bias for a worse household bias; the hierarchical model avoids that trade.

---

## 12. Housing-Type Mixing Impact

**Affected:** none — confirmed structurally (§1) that no housing-type mixing exists in the current universe; there was nothing to fix on this specific axis. **Impact:** zero, because the premised risk doesn't materialize in this data. **Verdict: the real, measurable version of this concern was a scale (household-count) fairness issue, not a category-mixing issue — addressed in §6-9 via the size-band axis.** This should be explicitly communicated back as a correction to the parent audit's framing, not silently substituted.

---

## 13. Resident Review

**Phase 1's exact bottom-10 apartments, re-scored under the hierarchical model (MIN_SAMPLE=8):**

| aptSeq | name | gu | year | households | size | v2Score | P1 %ile | Hier %ile | peer group |
|---|---|---|---|---|---|---|---|---|---|
| 26530-48 | 엄궁 | 사상구 | 1983 | 10 | small | 15 | 2.3 | **5.6** | 사상구·1980s·small (n=9) |
| 26200-15 | 동산(1106) | 영도구 | 1990 | 52 | mid | 16 | 2.0 | **5.6** | 영도구·1990s·mid (n=9) |
| 26350-297 | 그린빌라 | 해운대구 | 1991 | 19 | small | 18 | 0.5 | **1.7** | 해운대구·1990s·small (n=30) |
| 26350-296 | 라온힐즈 | 해운대구 | 1993 | 19 | small | 19 | 1.5 | **5.0** | 해운대구·1990s·small (n=30) |
| 26350-295 | 영동써니 | 해운대구 | 1992 | 19 | small | 20 | 2.6 | **8.3** | 해운대구·1990s·small (n=30) |
| 26230-42 | 대진파레스필즈 | 부산진구 | 1992 | 160 | mid | 21 | 1.1 | **5.6** | 부산진구·1990s·mid (n=9) |
| 26350-276 | 동부썬빌라 | 해운대구 | 1993 | 19 | small | 22 | 3.6 | **11.7** | 해운대구·1990s·small (n=30) |
| 26410-341 | 동성베스트 | 금정구 | 2004 | 19 | small | 22 | 0.7 | **1.2** | 금정구·2000s·small (n=41) |
| 26140-114 | 송도현대 | 서구 | 1992 | 208 | mid | 22 | 2.5 | **3.6** | 서구·1990s·mid (n=14) |
| 26230-43 | 삼환 | 부산진구 | 2002 | 230 | large | 23 | 0.5 | **1.5** | 부산진구·2000s·large (n=33) |

**Honest finding — the hierarchical model helps, but does not "rescue" these apartments to mid-range:** every single one improves (roughly 2-4x higher percentile than under P1), because they're no longer diluted by comparison against large complexes in the same district/era. But most remain in the bottom ~2-12% **even among genuinely comparable same-size, same-era, same-district peers** — meaning their weak scores are not an artifact of unfair peer selection, they reflect real, comparatively weak transit/living facts *even relative to true peers*. This is a more defensible, more honest result than either extreme (neither "these are unfairly compared against skyscrapers" nor "the model is broken/unfixable for these apartments") — it is exactly the kind of nuanced finding a fair peer group should produce.

**Middle/top samples (illustrative, MIN_SAMPLE=8):** 해운대자이2차1단지 (2018, 734세대, large) — P1 percentile 40.4, hierarchical 40.0 (essentially unchanged — a large modern complex compared against other large modern complexes doesn't move much, as expected). 세경미가 (연제구, 2016, 30세대, small) — P1 13.8, hierarchical **10.5, i.e. lower** — proof again that the hierarchical model is a genuine re-comparison, not a one-directional favor to small buildings: this particular small new-build actually looks *worse* once compared only against other small new-builds nearby. Top-20 apartments (all large, modern, well-located) shift only slightly (e.g. 99.5→96.7 percentile) since they were already being fairly compared under P1.

**Problematic comparisons found:** none — no case was found where the hierarchical model produced a nonsensical or unexplainable pairing; every peer-key (e.g. "해운대구·1990s·small") is a plain-language, defensible description a resident could be shown directly.

---

## 14. Peer Confidence

Recommended tiers, derived directly from already-computed pipeline state (no new data needed):

- **HIGH:** L1 (full 3-axis match) **and** pool size ≥15.
- **MEDIUM:** L1 with pool size 8-14, **or** any L2 match (district+decade only, size dropped).
- **LOW:** L3 match (decade only, Busan-wide) — comparison basis is broad enough that the number should read as directional, not precise.
- **NOT_AVAILABLE:** no level reaches MIN_SAMPLE (did not occur in current data, but the code path must exist — see §15).

This directly addresses §8's small-pool percentile-sensitivity risk: a HIGH-confidence percentile can be shown with more numeric precision/framing ("상위 12%"), while MEDIUM/LOW should be shown with a softer framing ("비슷한 단지 중 상위권" rather than a precise number) and an explicit pool-size caveat.

---

## 15. No-Peer Policy

**Confirmed feasible and confirmed to never currently trigger:** even the broadest fallback (L4, Busan-wide, same decade dropped — effectively "all 2,833 scoreable Busan apartments") always has far more than any tested MIN_SAMPLE (8-20) members, so `NOT_AVAILABLE` was 0% at every threshold tested. The code path must still exist for correctness (a future much-smaller dataset, e.g. a new region launch, could hit it) — when it does, **the product must show "상대 비교 불가" rather than mixing in a different housing type or dropping the decade/region constraint further to force a number.** This is a direct, confirmed application of the task's own principle: wrong comparison is worse than no relative score.

---

## 16. Total Score

Re-examined against Phase 1's own resident-risk evidence (§6/§7 of the Phase 1 doc: same-total apartments can have opposite domain profiles; the 0-100 absolute framing was the single clearest resident-backlash risk found). **Recommendation unchanged from Phase 1: Option A-refined — keep the absolute total, but no longer let it stand alone.** Every display of the absolute total should be paired with the peer-relative context established in this document (with its confidence tier, §14) rather than shown as a bare number. This is a refinement of Phase 1's Model D, not a new option — Options B/C (shrinking or hiding the absolute total) are not recommended, because the absolute number remains the only stable, comparison-group-independent fact a user can rely on across time; hiding it would remove real information Phase 1 confirmed is trustworthy (§2 of the Phase 1 doc — SAFE raw inputs).

---

## 17. User-Facing Percentile Wording

**Avoid:** "하위 10%," "꼴찌," "최하위," any bare percentile number sourced from a LOW-confidence (broad-fallback) peer group.

**Recommended, tiered by confidence (§14):**
- HIGH: *"부산진구의 비슷한 연식·규모 아파트 32개와 비교하면 교통은 상위 20%입니다."* — names the actual comparison group size and composition, matches the task's own explainability test sentence almost exactly, and is achievable today for 82.4% of scoreable apartments.
- MEDIUM: *"○○구의 비슷한 연식 아파트와 비교하면 평균보다 높은 편입니다"* (규모 조건 없이, 순위 대신 방향성만).
- LOW: *"부산 전체의 비슷한 연식 아파트와 비교한 참고값입니다"* — explicitly frames the number as a lower-confidence reference point.
- NOT_AVAILABLE: no percentile shown at all, absolute evidence only.

**How far to show the raw percentile number:** show the exact number only at HIGH confidence; at MEDIUM, show a qualitative direction only ("평균보다 높음/비슷함/낮음"); at LOW, either omit the number or show it clearly marked as low-precision.

---

## 18. Score Name

Base (non-personalized, today's default 25/25/25/25) and personalized scores should be named differently, since a personalized number is a different kind of claim (per Phase 1 §9's own recommendation that personalization must be explicit user choice, not an inferred persona):

- **Base score name candidates:** 이집점수 (keep current — already has real brand recognition risk/benefit; changing it invalidates all existing user-facing references and requires broader product buy-in beyond this audit's scope), 이집 분석, 단지 분석.
- **Personalized score name candidates:** "내 조건 적합도" — but only once a user has actually set personalized weights; **must not** be the name of the default/base score, since an untouched-default score is not actually "tailored to me" and calling it that would misrepresent it (the task's own explicit warning).
- **Recommendation:** keep **"이집점수"** as the base/default name (lowest-disruption choice, defer a full rename decision to a dedicated future STEP if desired — not blocking for Phase 2), and reserve **"내 조건 적합도"** exclusively for the personalized variant once §9's weight-selection UI ships. Do not rename the base score in Phase 2 as a side effect of shipping peer context — that's a separate, larger brand decision.

---

## 19. V1/V2 Eligibility Gate (re-audited, independently re-verified this STEP)

**Mismatch, precisely:** `calculateApartmentScore()` has exactly 3 non-`'OK'` return paths (`calculate.ts:39-41` NOT_FOUND, `calculate.ts:42-44` INSUFFICIENT_DATA for missing region code, `calculate.ts:155-168` INSUFFICIENT_DATA for V1 coverage &lt;0.6). Only the third can theoretically discard an already-computed `_shadowV2` — the first two occur *before* V2 is even computed, so they're not really a "V1 vs V2" mismatch, just genuinely no-data cases for both engines. The reverse case (V1 OK, V2 `NOT_ENOUGH_DATA`) was independently re-verified as **already correctly handled** — `ApartmentScoreCard.tsx` has a distinct, correct UI state for it, not a bug.

**Affected cases:** re-confirmed via full-population simulation in Phase 1: **0 apartments today.** The concrete drift scenario that *would* trigger it: a sigungu/dong where `ApartmentLocationFeature` collection is incomplete enough that fewer than 5 apartments total have location data (starving V1's peer pool for the location-dependent categories: transport/living/schoolAccess), while the *specific* apartment being viewed already has good location data itself (satisfying V2's purely-own-data `identityEligible` gate). This requires uneven/partial rollout, not a uniform gap — a uniform regional gap would fail both engines' gates together.

**Phase 2 fix (confirmed scope, not built this STEP):** change the display/eligibility gate to key off V2's own `eligibility` field, independent of V1's `coverage`.

---

## 20. V1 Dependencies (USED / DEAD / SHARED)

| Field | Classification | Safe to remove from public API response in Phase 2? |
|---|---|---|
| `status` | **USED** — primary display gate | No — load-bearing gate |
| `score` (V1's number) | Gate-only use; displayed value is DEAD | Unsure — redundant null-check only, low risk either way |
| `confidence` | DEAD in UI; used by internal audit scripts (direct in-process calls, not via the route) | Yes, from the route response |
| `categories` | DEAD in UI (superseded by a documented UI rewrite); used by internal scripts | Yes, from the route response |
| `briefing` | DEAD in UI (superseded); used by internal scripts | Yes, from the route response |
| `regionalStrengths` | DEAD in UI (superseded); used by internal scripts | Yes, from the route response |
| `market` | DEAD in UI — **explicitly documented as an intentional non-render decision**, not an oversight | Yes, but flag the existing doc note if removed |
| `coverage` | DEAD in UI; used by internal scripts | Yes, from the route response |
| `preparingReason` | Never sent to the client at all (internal-only by design); used by internal scripts | No — already correctly internal-only, still needed there |
| `scoreVersion` | **SHARED** — server-side fallback value inside `resolveDisplayedScoreVersion()`, itself tested and load-bearing | No — needed as the fallback source |

**Important nuance confirmed this STEP:** the *internal computations* that produce the DEAD-in-UI fields (`explainAllCategories`, `buildBriefing`, `computeRegionalStrengths`, `computeMarketInfo`) cannot be deleted independently of the public API trimming, because several `scripts/apartment-score/*` audit/benchmark tools call `calculateApartmentScore()` **in-process** (not via the HTTP route) and depend on the full `FinalScoreResult` shape. **Only the public route's JSON response can be safely trimmed in Phase 2 (dropping `confidence`/`categories`/`briefing`/`regionalStrengths`/`market`/`coverage` from what's sent to the browser); the underlying V1 computation and its internal script consumers are a separate, larger, not-yet-approved removal that PM has not authorized (per the parent task's explicit statement that full V1 removal is not yet approved).**

---

## 21. Recommended Model D (finalized structure)

- **Absolute:** unchanged V2 domain scores/curves (Phase 1, §1) — always shown, the stable "here are the facts" layer.
- **Peer:** hierarchical `sigungu × decade × size-band` (this STEP), MIN_SAMPLE=8, 4-level fallback (§6-9, §15), percentile only shown at a precision matched to its confidence tier (§14/§17).
- **Confidence:** HIGH/MEDIUM/LOW/NOT_AVAILABLE per §14, derived from existing pipeline state (peer level reached + pool size), no new computation.
- **Final display:** absolute evidence card (unchanged) + a new, clearly-labeled peer-context line, framed per §17's tiered wording, never a bare unlabeled percentile.

---

## 22. Phase 2 Scope Recommendation

**Implement:** Base Score (unchanged), Peer Context (hierarchical model exactly as validated in this document), Confidence tiers, the tiered UI wording from §17, and the V1/V2 eligibility-gate fix from §19. Also implement the public-API-response trimming from §20 (dropping the 6 confirmed-DEAD-in-UI fields from `route.ts`'s outward JSON only — not touching the internal computation or the scripts that depend on it).

**Defer:** Personalization / user-adjustable weights (Phase 1 §9-10 of the parent chain) — depends on the peer/confidence layer above being stable first, and is explicitly a separate, larger UI/UX design effort. A full base-score renaming decision (§18) is also deferred, not blocking.

---

## 23. Database

READ: yes (Prisma SELECT only, full Busan universe). WRITE: 0. Schema: 0. Migration: 0.

---

## Appendix: Raw analysis artifacts

- `scripts/apartment-score/ejip-score-v2-phase1_5-peer-analysis.ts` — peer-model simulation script (read-only, reusable).
- `scripts/apartment-score/output/score-v2-phase1_5-peer-analysis.json` — full result data backing §4-13 above (MIN_SAMPLE sweep, bottom/middle/top-20 with peer detail, tiny-pool sensitivity examples).
- Builds on `docs/development/EJIP_SCORE_V2_PRODUCT_FORMULA_AUDIT.md` (Phase 1).
