# COMPARE V2 — PHASE 2: Unified 2-Complex Decision Compare

**Date:** 2026-09-02
**Baseline commit:** `60ad444` (branch `main`, follows `COMPARE_V2_ARCHITECTURE_AUDIT.md`)
**Approved decisions (Phase 1 → Phase 2 handoff):** canonical = extend `CompareView`; max complexes
this phase = 2; jeonse excluded from default screen; raw volume/liquidity excluded; personalization
deferred; 3+ compare deferred.

---

## 1. Final Architecture

New module tree, matching the Phase 1 recommendation (shared data model + one canonical UI):

- `src/lib/compare-v2/types.ts` — `ComparableIdentity`, `CompareMetric`, `CompareScore`,
  `CompareDifference`, `TradeoffSummary`.
- `src/lib/compare-v2/fetch.ts` — `fetchCompareApartment()`, exactly 2 API calls per complex
  (trades + score), fired with zero dependency between them.
- `src/lib/compare-v2/metrics.ts` — builds `CompareMetric[]` from the trades/score JSON already
  fetched; no new endpoints.
- `src/lib/compare-v2/difference.ts` — the difference engine + trade-off summarizer, pure
  functions, unit-tested.
- `src/lib/compare-v2/format.ts` — deterministic copy templates (headline bullets, peer summary).
- `src/lib/compare-v2/url.ts` — `buildCompareUrl`/`parseCompareUrl`.
- `src/components/compare/CompareV2.tsx` (+ `.module.css`) — the canonical UI, mounted at
  `/stats/compare`.

`CompareResult` (the AI-search table) is retired as a rendering surface — see §12. `/stats/
multi-compare` (5-complex, chart-only) is explicitly untouched — still the pre-existing
`CompareView` in `type-client.tsx`, since 3+ compare is deferred per the approved scope.

## 2. Identity

`aptSeq` is the primary internal key wherever a single, name+dong-verified value exists
(`deriveCanonicalAptSeq`, reused unmodified from `DECISION_JOURNEY_V1.1`); otherwise the
`{lawdCd, dong, name}` composite. `name` is never a lookup/dedupe key in the new code — `CompareV2`
keys its two slots by array index (fixed 2-slot model), not by name, closing the exact risk Phase 1
flagged in the old `CompareView` (`series[name]`, `key={s.name}`).

**Live same-name collision test:** 롯데캐슬(엄궁동, `lawdCd 26530`) vs 롯데캐슬(명지동,
`lawdCd 26440`) — both resolved correctly to their own district's data with zero cross-
contamination (verified via `read_network_requests`: each `/api/apt/롯데캐슬` call carried its own
`lawdCd`/`dong`, returned only that district's trades).

## 3. URL State

`?aName=&aLawdCd=&aDong=&aptSeq=A,B&bName=&bLawdCd=&bDong=` — `aptSeq` is the canonical,
shareable identity marker (per the task's explicit ask), but a bare `aptSeq` cannot by itself
re-run the existing name-keyed `/api/apt/[name]` routes (no aptSeq-resolver endpoint exists, and
building one is outside this phase's "no new API" constraint) — so each slot's `name`/`lawdCd`/
`dong` travel alongside as the actual fetch key, while `aptSeq` is passed through to
`deriveCanonicalAptSeq` as a **validated hint, never trusted blindly** (identical pattern to
`DECISION_JOURNEY_V1.1`'s Detail-page `?aptSeq=`). `Detail → Compare` (`buildDetailCompareUrl` in
`decision-journey/registry.ts`) now emits this same contract directly — no separate prefill scheme.

Round-trip correctness is unit-tested (`url.test.ts`) and live-verified (Detail's "비슷한 단지와
비교" link → `/stats/compare?aName=...&aptSeq=26140-1356` → slot A correctly seeded).

## 4. Metrics

Per the approved core-metric list, sourced entirely from the 2 fetched responses:

| Metric | Source | Class |
|---|---|---|
| 최근 실거래가 | trades (84㎡-band-preferred) | SAFE / LIMITED (area mismatch) |
| 준공, 세대수 | score `_shadowV2.domains.complex.evidence` | SAFE |
| 세대당 주차 | score `complex.evidence.parkingRatio` (only when `parkingRawStatus==='KNOWN'`) | LIMITED |
| 지하철·버스 최근거리 | score `transport.evidence` | SAFE (straight-line caveat) |
| 초등학교 최근거리 | score `education.evidence` | LIMITED |
| 편의점(500m) | score `living.evidence.convenienceCount500m` | LIMITED |
| Score 4 domains + peer | score endpoint directly | SAFE / confidence-gated |

Explicitly excluded from the default screen (per approved decisions): jeonse/전세가율, raw
volume/liquidity, far/bcr, community-facilities list, middle/high school distance, any 학군/zoning
claim. `/api/apt/[name]/info` and `/api/apt/[name]/facilities` are **not called at all** —
everything needed already exists in the trades+score pair (§13 API strategy).

## 5. Price Fairness

`selectPriceMetric()` (`metrics.ts`) prefers a trade within the 84–89㎡ national-standard band
(reusing `NATIONAL_STANDARD_AREA_MIN/MAX`, now exported from `ai-search.ts` rather than
redeclared); falls back to the most recent trade in any area when no band trade exists, and labels
the area explicitly either way (never silently substitutes). `dealCanceled` trades are excluded.
`buildDifference()` marks the pair `comparable: false` with an explicit reason when the two
apartments' compared areas differ by more than 3㎡ — never computes a difference across
mismatched units. A recency caution (>90 days apart between the two reference trade dates, reusing
`gap-invest-calc.ts`'s own threshold) is attached without ever hiding the price itself.

## 6. Score

Both apartments' 4 domain scores render as side-by-side bars, never a single combined number —
`ScoreSection` in `CompareV2.tsx` explicitly labels the panel "이집 분석 (절대 평가 — 순위 아님)".
Peer percentile text reuses the exact same confidence-gated wording rule the Score card itself
already uses (`scoreDomainSummary()` — HIGH shows a number, MEDIUM shows directional text only, LOW/
NOT_AVAILABLE shows neither). No `winnerFor`-style highlighting exists anywhere in the Score
section.

## 7. Difference Engine

`buildDifference(a, b)` per metric:
1. Both `MISSING` → not comparable (never guessed).
2. Both confirmed-absent-but-not-MISSING (e.g. both sides genuinely have no subway within radius)
   → **comparable, no favor** — a real bug caught during live A/B testing: the first implementation
   treated this identically to MISSING, incorrectly routing "both sides have no subway" into "확인
   필요" instead of "비슷한 항목." Fixed and covered by 2 new tests (`difference.test.ts`).
3. One side confirmed-absent, other has a real value → not comparable (no distance value is
   fabricated for "absent").
4. Price area mismatch (>3㎡ apart) → not comparable.
5. Otherwise: numeric difference computed, `favors` set only for `higher-better`/`lower-better`
   metrics past a documented meaningful-difference threshold (`MEANINGFUL_THRESHOLDS` in
   `difference.ts`) — `context-only` metrics (price, build year, households, living counts,
   education distance) **never** set `favors`, no matter how large the numeric difference.

## 8. Trade-offs

`buildTradeoffSummary()` buckets directional (`higher-better`/`lower-better`) differences into
`aStrengths`/`bStrengths`/`similar`; everything non-comparable lands in `needsReview` regardless of
direction type. No win-tally exists anywhere — `TradeoffSection` renders each bucket as a plain
label list, never a score. Live-verified: a pair with severe data asymmetry (one very new complex
with almost no score/trade data) correctly produced an **empty** strengths section and a full
`needsReview` list — the data-rich side was never declared a winner just because the other side had
less data.

## 9. Missing Data

No `0` is ever synthesized for a missing metric — `metrics.ts`'s builders return `null`/`'정보
없음'`/`'최근 거래 없음'` explicitly per field, each carrying its own `trust` tag. Live-verified on
a genuinely new complex (2025-built, no 매매 trades yet in the 36-month window): price showed "최근
거래 없음", every score-derived fact showed "정보 없음", and the trade-off summary correctly placed
all of them under "확인 필요" — not a single field defaulted to 0 or was silently omitted.

## 10. UI

Wire priority follows the Phase 1 mock closely: identity header → 핵심 차이 (headline, ≤3 items) →
가격 → Score domains → 단지 여건 → 교통·생활·교육 → 요약 (trade-off buckets) → next actions
(상세보기 ×2). Headline bullets and trade-off labels use only deterministic templates
(`format.ts`) — no LLM call anywhere in Compare. Resident-safe vocabulary matches Score's existing
style guide exactly (no 압승/완패/열세, only 상대적으로 유리/비슷한 수준/확인 필요).

## 11. Mobile

360/375/390px verified via the iframe-isolation harness (still the only reliable technique in this
environment, `resize_window` remains non-functional). **Two real bugs found and fixed live during
this QA pass:**
1. The confirmed-absent display string ("반경 내 없음(확인됨)", 11 chars) overflowed the fixed-
   width metric-value cell at 360px, ellipsis-truncating to an unreadable fragment — shortened to
   "없음(확인)".
2. Metric row **labels** (not just values) were being ellipsis-truncated by the same `.metricTable
   td` rule via CSS specificity (`.metricTable td` class+element selector beat the plain
   `.metricLabel` class selector) — a truncated label is worse than a truncated value, since it
   obscures which metric the row even is. Fixed by adding a correctly-specific `.metricTable
   td.metricLabel` override that allows the label column to wrap instead of truncate.

Desktop renders the identical structure with more breathing room — same information hierarchy, not
a different product, per the task's explicit requirement.

## 12. AI Search Compare (retirement)

**Old:** `CompareResult` — a self-contained table component with its own area-selector state,
`winnerFor()` highlighting, and detail links, rendered inline in `/ai-search`.
**New:** when `/api/ai-search` classifies `compare` intent and resolves both complexes, a
`useEffect` in `ai-search-client.tsx` redirects to `/stats/compare` with the already-resolved
identity (`name`+`resolvedLawdCd`+`dong`+`aptSeq` per side) — no re-search, no name-only
fallback. `CompareResult`, `AreaDropdown`, `winnerFor`, `parseLeadingNumber`,
`compareComplexDetailHref`, `COMPARE_ROWS`, `HIGHLIGHTABLE_KEYS` were all removed as dead code.
`CompareAreaOption`/`CompareComplexData` types and `fetchCompareTarget`/`runCompare` in
`lib/ai-search.ts` are kept — the identity-resolution logic is still exactly what feeds the
redirect.

**Known, unresolved limitation carried over from Phase 1 (explicitly out of this phase's scope):**
the compare-intent classification itself remains unreliable — re-tested live this phase, the exact
hardcoded suggestion-chip query again did not classify as `compare` intent. This means the redirect
code path exists and is correct, but is rarely exercised in practice until `/api/ai-search`'s
classification is separately fixed.

## 13. API / Request Count

**Measured (not estimated), via `read_network_requests` on a live 2-complex compare:** exactly 4
requests, 2 per complex (`/api/apt/{name}?lawdCd=&dong=&type=apt&period=36` and `/api/apt/{name}/
score?lawdCd=&dong=`), all `200`, zero duplicates, zero retries. This beats the Phase 1 plan (which
projected 4 calls in 2 dependency tiers) — because `/api/apt/[name]/info` and `/facilities` turned
out to be unnecessary once it was confirmed the score endpoint's domain `evidence` already carries
buildYear/totalHouseholds/parkingRatio/subway/bus/education/living raw facts (same underlying
`ApartmentMaster`-derived data, already computed for scoring). Request count scales as 2×N
complexes, not 4×N — even better than projected for a future 3+ compare, though that remains
deferred per scope.

## 14. Performance

Local dev-server measurement only this phase (production/Vercel timing needs the code live first —
see Next Step). Both API calls per complex fire in parallel with no dependency, and both
complexes' calls fire together — so total network depth is 1 round trip regardless of complex
count, matching the ≤1–1.5s target's spirit; a proper cold/warm curl-based measurement against
production (matching the `PERFORMANCE_V1` series' own methodology) is the natural immediate
follow-up once this ships.

## 15. A/B Validation

Live-tested end-to-end (dev server, `read_network_requests`-confirmed, screenshotted):
1. **Same-name collision** (롯데캐슬 × 2 districts) — correct per-district resolution, no
   cross-contamination, confirmed-absent subway data correctly bucketed as "비슷한 항목" after the
   §7 fix.
2. **Severe data asymmetry** (2508-household 1979 complex vs newly-built complex with almost no
   trade/score data) — honest "정보 없음"/"최근 거래 없음" everywhere on the data-poor side, zero
   automatic-win behavior.
3. **Detail → Compare single-slot seed** — confirmed slot A pre-fills correctly from the Detail
   page's NextAction link, slot B left open for search.
4. **Mobile 360/375/390** — confirmed clean after the two fixes in §11.

The remaining 16 pairs from the Phase 1 sample-audit table are covered analytically: the same code
paths exercised by the 2 live-tested pairs (identity resolution, price-band selection, missing-data
handling, trade-off bucketing) are the same paths any other pair would exercise — combined with 39
passing unit tests covering the specific edge cases (ambiguous same-dong aptSeq, area mismatch,
recency caution, meaningful-difference thresholds, confirmed-absent-vs-missing), this is reported
honestly as "live-tested on 4 scenarios + unit-tested on the full logic space," not "all 20 pairs
individually clicked through."

## 16. Same-Name QA

Covered by §2/§15 point 1 above — the highest-risk same-name pair in the Phase 1 sample (롯데캐슬,
2 districts) was live-tested with zero wrong-city/wrong-complex linking. The other 10 duplicate-name
groups found in Phase 1's sample were not individually re-tested this phase, since they exercise
the identical `deriveCanonicalAptSeq`/composite-fallback code path already proven correct — the
underlying identity guarantee comes from `resolveStrongIdentityAptSeqs`/`matchesTradeIdentity`
(unmodified, already unit-tested with real same-name fixtures in `apt-name-match.test.ts` since
`DECISION_JOURNEY_V1`), not from anything pair-specific.

## 17. Limitations

- AI-search compare-intent classification reliability is unfixed (§12) — the redirect is correct
  but rarely triggered today.
- Production/Vercel timing not yet measured (§14) — needs the code live.
- 390px mobile verification (like prior phases) relies on the same CSS breakpoint bucket as
  360/375 rather than being independently screenshotted pixel-by-pixel at every panel.
- The `parseLeadingNumber`-style string-parsing risk that existed in the old `CompareResult` is
  fully eliminated — all new metrics are typed numbers end-to-end, never re-parsed from formatted
  Korean strings.

## 18. Deferred Work (per approved scope)

- 3+ complex compare UI (the fixed-2-slot data model and fixed-width mobile table would both need
  rework — `/stats/multi-compare`'s old chart-only `CompareView` remains the only N-complex option
  for now).
- Personalized/weighted comparison — the `CompareMetric`/`CompareDifference` contract does not
  block this (each metric already carries `direction`/`trust` independently), but no UI/weighting
  logic was built.
- Liquidity/volume normalization design.
- 전세/전세가율 metrics (excluded from the default screen per approved decision — not merely
  deferred technically, but a product decision already made this phase).
- Fixing `/api/ai-search`'s compare-intent classification (§12) — a prompt/classifier issue in a
  different system, not Compare's own architecture.

## 19. Database

READ only. WRITE: 0. Schema: 0. Migration: 0.

## 20. Docs

This file; `docs/development/CHANGELOG.md` updated;
`docs/development/COMPARE_V2_ARCHITECTURE_AUDIT.md` (Phase 1) referenced throughout.
