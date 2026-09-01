# E-JIP SCORE V2 — PHASE 2: Peer Context Production Implementation

**Date:** 2026-09-01
**Baseline commit:** `c817671` (branch `main`, follows `EJIP_SCORE_V2_PEER_SAMPLE_VERIFICATION.md`)
**Scope:** Implement the PM-approved Model D (Absolute Evidence + Hierarchical Peer Context + Confidence), validated in Phase 1/1.5/1.6, into production API + UI. Absolute 25/25/25/25 formula unchanged. No DB schema/migration, no personalization, no Score storage table.

**Related docs:** `EJIP_SCORE_V2_PRODUCT_FORMULA_AUDIT.md` (Phase 1) → `EJIP_SCORE_V2_PEER_GROUP_AUDIT.md` (Phase 1.5) → `EJIP_SCORE_V2_PEER_SAMPLE_VERIFICATION.md` (Phase 1.6) → this document (Phase 2).

---

## 1. What Changed, In One Paragraph

Before this STEP, V2 (`_shadowV2`) was already computed on every score request but was invisible whenever V1's own `status !== 'OK'` (e.g. `INSUFFICIENT_DATA` from V1's peer-percentile coverage<0.6) — a structural gate bug found in Phase 1.5/1.6. This STEP (a) fixes that gate so V2's display depends only on V2's own `eligibility`, and (b) adds a new, entirely-outside-the-engine peer-comparison layer that ranks each apartment's already-computed absolute V2 score against a hierarchical peer pool (L1 sigungu+decade+size → L2 sigungu+decade → L3 decade/Busan-wide → L4 Busan-wide), exactly as validated in Phase 1.5/1.6, with confidence-tiered wording so low-certainty peer comparisons never show a precise, possibly-misleading percentile.

---

## 2. Architecture

### 2.1 Eligibility gate fix

`src/lib/apartment-score/server/calculate.ts` already computed `shadowV2Result` early in `calculateApartmentScore()`, but the `INSUFFICIENT_DATA` (V1 coverage<0.6) return branch omitted it from the returned object. Fixed by attaching `_shadowV2: shadowV2Result` to that branch too. `src/components/ApartmentScoreCard.tsx` was changed from gating on `result.status !== 'OK'` (V1) to gating on `result._shadowV2` existing and its own `eligibility` field (V2) — logic now lives in the pure, tested `deriveScoreCardState()` (see §4).

V1's own coverage/status computation is untouched — only the *display decision* changed. V1's briefing (`ApartmentBriefingV2`) still reads V1's own fields and is unaffected (verified in QA, §6).

### 2.2 Peer context module

New pure module `src/lib/apartment-score/peer-context-pure.ts` (zero imports — matches this repo's existing testable-pure-module convention, e.g. `src/lib/map-marker-coords.ts`) implements, verbatim from Phase 1.5/1.6:

- `MIN_PEER_SAMPLE = 8`
- Size-band tertiles: `small <50`, `mid 50–220`, `large ≥221` (`SIZE_BAND_T1=50`, `SIZE_BAND_T2=221`)
- 4-level fallback: `SIGUNGU_DECADE_SIZE (L1) → SIGUNGU_DECADE (L2) → DECADE_BUSAN (L3) → BUSAN_ALL (L4)`, each requiring `pool.length >= MIN_PEER_SAMPLE`; unavailable if even L4 falls short
- `totalHouseholds == null` → skips L1 entirely regardless of pool size (unknown-household apartments are never force-assigned a size band), per Phase 2's explicit requirement
- `percentileRank()` — self-included denominator, `(below + equal/2) / pool.length * 100`, rounded to 1 decimal
- `comparisonCount` (self-included, the actual percentile denominator) vs `peerCount = comparisonCount - 1` (user-facing, self excluded) — kept as two distinct fields, never conflated
- `confidenceFor(level, comparisonCount)`: `HIGH` = L1 with comparisonCount≥15; `MEDIUM` = L1(8–14) or L2; `LOW` = L3 or L4

The DB-facing wrapper `src/lib/apartment-score/peer-context.ts` re-exports all of the above and adds only: `buildPeerUniverse()` (batch-fetches `ApartmentMaster` + `ApartmentLocationFeature` for Busan once, then calls `adaptToV2Input`/`calculateScoreV2` directly per row — see §3 for why), `getPeerUniverse()` (wraps it in the existing `getOrSetCache` with a 1-hour TTL, no new cache infra), and `getPeerContext(target)` (ensures the target apartment is included exactly once in its own comparison pool, then delegates to `computePeerContext`).

### 2.3 API + UI wiring

`src/app/api/apt/[name]/score/route.ts` fetches the target's `{sigungu, buildYear, totalHouseholds}` (one extra `findUnique`, only when V2 is eligible) and adds a `peerContext` field to the JSON response. `src/lib/apartment-score/client-types.ts` gained the `ApartmentScorePeerContext` type. `src/components/ApartmentScoreCard.tsx` renders a new "비슷한 단지와 비교" section below the domain cards, plus a `dataStatusRow` distinguishing `dataConfidence` (V2's own eligibility) from `peerConfidence` (the new peer-comparison confidence) — these are never merged into one label.

### 2.4 Presentation logic extraction (`score-card-presenter.ts`)

The eligibility-gate decision and the confidence-tiered wording decision were both extracted into a new dependency-free `src/components/score-card-presenter.ts` (`deriveScoreCardState`, `derivePeerVerdict`), for the same reason as `peer-context-pure.ts`: this repo's `.test.mjs` convention (`node --experimental-strip-types --test`) cannot resolve `@/`-aliased imports or render JSX, so decision logic that needs to be independently tested has to live in a plain function. `ApartmentScoreCard.tsx` now calls these functions instead of inlining the branching — the rendered output is unchanged (verified live before/after, §6).

---

## 3. Performance Design

`calculateApartmentScore()` (V1's orchestrator) re-fetches the *entire* sigungu cohort on every single call (`calculate.ts:55-68`) — calling it 2,800+ times to build a peer universe would reproduce the ~15–20 minute cost that made the Phase 1 analysis scripts slow. `calculateScoreV2()` itself has no DB access, so `buildPeerUniverse()` instead batch-fetches `ApartmentMaster` + `ApartmentLocationFeature` for all of Busan **once** (2 queries total) and calls `adaptToV2Input`/`calculateScoreV2` directly per row in memory — O(n) DB cost, no N+1. The result is cached via the existing `getOrSetCache` (1-hour TTL; registry/location data is batch-updated, not real-time) rather than a new cache mechanism.

**Measured:** warm requests ≈500–650ms. True cold cost (isolated via a standalone timing script, excluding one-time Next.js dev-mode route compilation) ≈2.5s (masters fetch ~930ms + locations fetch ~670ms + compute loop over 3,401 rows ~870ms). This exceeds the aspirational ≤1s cold target but is well under the ≤2s "needs structural reconsideration" threshold once compile overhead is excluded — documented honestly as a known limitation rather than further re-architected in this STEP. The 1-hour cache means only one request per hour actually pays this cost.

**Known, pre-existing, unrelated side effect:** `adaptToV2Input()` (`src/lib/score-v2/adapter.ts:25`) contains a `console.log('ADAPTER MASTER:', ...)` debug line that now fires once per apartment (~3,400×) during every cold peer-universe build. This line predates this STEP and is outside its scope; flagged here as a cleanup recommendation, not fixed.

---

## 4. Tests

`src/lib/apartment-score/peer-context.test.mjs` — 21 tests against `peer-context-pure.ts` directly (bypassing the `@/`-alias resolution gap, a pre-existing project-wide limitation also documented in Phase 1's CHANGELOG): size-band boundaries (49/50, 220/221, null→UNKNOWN), decade bucketing, percentile-rank determinism (including the Phase 1.6 rank-1-of-8→93.8 reproduction), all 4 confidence tiers, L1/L2/L3/L4 fallback assignment, the `totalHouseholds==null` → skip-L1 rule, `comparisonCount≥8` invariant, `peerCount = comparisonCount - 1`, and `basis` field correctness (including `sizeBand=null` on L2/L3/L4).

`src/components/score-card-presenter.test.mjs` — 13 tests: `deriveScoreCardState` for all 4 outcomes, explicitly including the case that proves the Phase 2 gate fix (`result.status='INSUFFICIENT_DATA', score=null, coverage=0.2` but `_shadowV2.eligibility='SCORE_AVAILABLE'` still yields `{kind:'ok'}` — V1's failure no longer suppresses V2); `derivePeerVerdict` for HIGH (exact percentage exposed), MEDIUM (directional wording only, asserted to *not* contain a `topPercent` field), and LOW (no percentage or direction at all, asserted to be exactly `{kind:'broad'}`).

**34/34 passing.** A real bug was caught while writing these: the initial `confidenceFor()` had L2 (`SIGUNGU_DECADE`) and L3 (`DECADE_BUSAN`) swapped in the MEDIUM branch, which would have shown L2 apartments as LOW confidence (should be MEDIUM) and L3 apartments as MEDIUM (should be LOW) in production. The earlier manual browser check happened to use an L1 apartment and did not expose this. Fixed and confirmed both by the corrected unit test and by a live L2-fallback apartment (§6).

---

## 5. Cross-Check Against Phase 1.6 (§32 requirement)

`scripts/apartment-score/ejip-score-v2-phase2-crosscheck.ts` (new, read-only) loads Phase 1.6's own recorded `sampleAudit` (bottom10 + middle10 + top10 = 30 real Busan apartments spanning multiple gu/decades/sizes) and re-runs each one through the actual production `getPeerContext()` — not a re-implementation, the exact function the API calls — comparing `level`, `comparisonCount`, `peerCount`, `percentile`, and `confidence` against Phase 1.6's saved values.

**Result: 30/30 matched, 0 mismatches** (exceeds the required ≥20 sample / mismatch=0 bar). Output saved to `scripts/apartment-score/output/score-v2-phase2-crosscheck.json`.

Boundary cases (49/50/220/221 households) were additionally verified against real production apartments via the same `getPeerContext()` call:

| households | apartment | sizeBand | level |
|---|---|---|---|
| 49 | 일산(317-40), 부산진구 | small | L1 |
| 50 | 더샵골드6, 부산진구 | mid | L1 |
| 220 | 연제힐스테이트, 연제구 | mid | L1 |
| 221 | 명장유림노르웨이숲, 동래구 | large | L1 |

---

## 6. Production + Mobile QA

Live-verified via the running dev server (real Supabase data, not mocked) across all three confidence tiers:

| Apartment | Region | Level | comparisonCount | Confidence | Wording shown |
|---|---|---|---|---|---|
| 더샵센텀파크1차 | 해운대구 (2,752세대) | L1 | 29 | HIGH | "비슷한 단지 중 상위 12% 수준" (exact %) |
| 좌천시민(737-1) | 동구 (구축, 1962년) | L2 | 10 | MEDIUM | "비슷한 단지보다 좋은 편" (directional only, no %) |
| 주례 | 사상구 (구축, 1975년) | L3 | 109 | LOW | "넓은 비교군 기준 참고 수준입니다." (no % or direction) |

Confirmed the confidence-tiered percentile-suppression policy (§16 of the task spec) renders correctly for all three tiers, and that the MEDIUM case specifically exercises the L2/L3 confidence bug fixed in §4.

**Mobile QA (360px/375px/390px, iframe-width-isolation technique — `resize_window` remains broken in this environment):** all three apartments above rendered simultaneously at 360/375/390px with no horizontal overflow, no clipped text, and no bottom-nav overlap in the new peer-section/data-status-row markup.

**Regression check:**
- Search → detail (`더샵센텀파크1차` via autocomplete): resolves `lawdCd`/`dong` correctly, score card + peer section render.
- Stats → detail (`/stats/record-high` list item click): resolves `lawdCd`/`dong` correctly, no error.
- `단지 브리핑` (`ApartmentBriefingV2`, V1-dependent): renders normally alongside the score card on every sample above — the V1/V2 gate fix does not affect V1's own briefing computation.
- `/stats/compare`: confirmed independent of all changed files (no `ApartmentScoreCard`/`score-v2`/`apartment-score` imports) — loads normally.
- Favorite button: unchanged component, still renders on the detail page alongside the modified score card.

---

## 7. Language Policy Compliance

No resident-hostile terms (꼴찌/최하위/나쁜 아파트/낮은 수준/열악/저급/가치 낮음) or "하위 N%"-style framing appear anywhere in the new code — verified by direct read of `derivePeerVerdict()` and `renderPeerSection()`. The disclaimer text was extended to state explicitly that the score is an absolute evaluation, not a cross-apartment ranking ("다른 단지와 비교해 매긴 순위가 아닙니다").

---

## 8. `SCORE_V2_VERSION` — Decision: Not Bumped

`SCORE_V2_VERSION` (`EJIP_SCORE_V2_1`) identifies the score **engine** — the absolute curves, category weights, and domain formulas in `score-v2/engine.ts`. None of that changed this STEP. `peerContext` is an additive, purely external field computed by a separate module that never feeds back into the engine's own calculation. Bumping the version string would incorrectly imply the underlying score formula changed, which it did not — see `DECISIONS.md` #6 for the recorded rationale. If a future STEP changes the curves/weights themselves, that is when `EJIP_SCORE_V2_2` should be introduced.

---

## 9. Known Limitations / Deferred

- **Cold-path latency** (~2.5s true cost) exceeds the ≤1s aspirational target; acceptable under the ≤2s reconsideration threshold and mitigated by a 1-hour cache, but a future STEP could pre-warm the peer universe on deploy or via a cron if this becomes user-visible.
- **`ADAPTER MASTER` debug log** in `src/lib/score-v2/adapter.ts:25` now fires ~3,400× per cold peer-universe build; pre-existing, unrelated to this STEP's scope, recommended cleanup for a future pass.
- **Personalization** ("내 조건 적합도" or user-adjustable weights) is explicitly out of scope for this STEP, per the task's own prohibition — the objective E-JIP Score and any future personalized score remain architecturally separate.
- **Continuous-similarity peer matching** (replacing the discrete size-band tertiles) was flagged as a future candidate in Phase 1.6 but not pursued here — the discrete hierarchy's boundary effects are already absorbed by fallback (Phase 1.6 §16) and did not justify the added complexity for this STEP.

---

## 10. Files Changed

- `src/lib/apartment-score/server/calculate.ts` — eligibility-gate fix (attach `_shadowV2` to the `INSUFFICIENT_DATA` branch)
- `src/lib/apartment-score/peer-context-pure.ts` (new) — pure peer hierarchy/percentile/confidence logic
- `src/lib/apartment-score/peer-context.ts` (rewritten) — thin DB/cache wrapper delegating to the pure module
- `src/lib/apartment-score/peer-context.test.mjs` (new) — 21 tests
- `src/lib/apartment-score/client-types.ts` — `ApartmentScorePeerContext` type + response field
- `src/app/api/apt/[name]/score/route.ts` — wires `getPeerContext` into the response
- `src/components/ApartmentScoreCard.tsx` — V2-only gate, peer section, data-status row
- `src/components/ApartmentScoreCard.module.css` — new peer/data-status classes
- `src/components/score-card-presenter.ts` (new) — pure presentation-decision logic
- `src/components/score-card-presenter.test.mjs` (new) — 13 tests
- `scripts/apartment-score/ejip-score-v2-phase2-crosscheck.ts` (new, read-only QA script)
- `scripts/apartment-score/output/score-v2-phase2-crosscheck.json` (new, QA result)

---

## 11. Test/Build Evidence

- `node --experimental-strip-types --test src/lib/apartment-score/peer-context.test.mjs src/components/score-card-presenter.test.mjs` → **34/34 passing**
- `npx ts-node ... scripts/apartment-score/ejip-score-v2-phase2-crosscheck.ts` → **30/30 matched Phase 1.6, 0 mismatches**
- `npx tsc --noEmit` → no new errors introduced by this STEP's files
- Manual production QA (dev server + real Supabase data) across HIGH/MEDIUM/LOW confidence tiers, boundary households, mobile 360/375/390px, and regression paths — see §5/§6

**Next recommended STEP:** DECISION JOURNEY V1.
