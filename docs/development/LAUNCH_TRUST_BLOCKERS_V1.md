# LAUNCH TRUST BLOCKERS V1

**Date:** 2026-09-01
**Baseline commit:** `c1b393d` (branch `main`, follows `USER_EXPERIENCE_BASELINE_AUDIT_V1`)
**Scope:** Close the 5 concrete trust items flagged by the baseline audit as launch blockers. No new large features, no Score formula change, no DB schema/migration, no destructive writes. All 5 items addressed with minimal, targeted fixes.

---

## 1. Auction — fabricated listing data (`/tools`)

**Old behavior:** The "⚖️ 경·공매 비교" tab hardcoded two specific, named fake listings (건물/동/층, 유찰 횟수, 감정가, 최저가, a computed "실거래가 대비 저렴" delta) with no backing data source, rendered with the same visual authority as the app's real MOLIT-backed data.

**Data source:** None — no auction/온비드 API integration exists anywhere in the codebase. Confirmed by search across `src/lib` and `src/app/api`.

**Risk:** A user could read fabricated appraisal prices/bid floors as real, actionable auction inventory. Direct violation of the project's data-truth policy ("never invent missing data or false precision").

**Fix:** Replaced the hardcoded listings with the same honest "준비 중" (`Empty variant="notReady"`) pattern already used by `/map`'s own 경·공매 layer (`COMING_SOON_LAYERS` in `src/app/map/page.tsx`), so both surfaces are now consistent: no fabricated content is ever rendered to a real user.

**User surface after fix:**
```
경매·공매 매물 데이터는 아직 연동 준비 중입니다.
실제 경매/온비드 공매 데이터가 연동될 때까지 임의의 예시 매물을 보여드리지 않습니다.
```

**File:** `src/app/tools/page.tsx`

---

## 2. Community — free-text apartment identity

**Old behavior:** `/community/write` collected the related apartment as a free-text `<input>` (no autocomplete, no canonical picker). `/community` and `/community/[id]` then linked that raw string directly to `/apt/${encodeURIComponent(post.aptName)}` with **no `lawdCd`/`dong`**.

**Schema check (per Blocker B instructions — audited, not migrated):** `prisma/schema.prisma` `model Post` has only `aptName String?` — no `lawdCd`, `dong`, or `aptSeq` column, and no comment suggesting one was ever planned. **COMMUNITY_CANONICAL_ID_SCHEMA_REQUIRED would apply if full canonical storage were required** — but per the task's own escape hatch ("Community에서 apartment linking을 optional로 안전하게 제거/비활성화하여 schema 없이 잘못된 identity를 막을 수 있다면 그 방법도 검토"), a schema-free fix was possible and was used instead. **No migration was performed or proposed.**

**aptSeq:** Not present on `Post`, and not introduced.

**New behavior:**
1. **Write side** (`src/app/community/write/page.tsx`): the free-text input is replaced with the existing `ApartmentAutocomplete` component (the same canonical, dong-disambiguated picker used by search/map/compare). A post can now only be tagged with a real, existing apartment's exact name — never an arbitrary typed string. When arriving from an apartment detail page's own "글쓰기" link (`?aptName=`), that already-confirmed context is shown as a locked chip instead of a free field.
2. **Read side** (`src/app/community/page.tsx`, `src/app/community/[id]/post-client.tsx`): the apartment badge is no longer a `<Link>` to `/apt/[name]`. Since the stored name still carries no `lawdCd`/`dong` (schema unchanged), following it would risk the same-name-different-district collision the project has already found and fixed twice (map, detail). The badge is now a plain, non-navigating label.

**Wrong-link risk:** Reduced to 0 — there is no longer any path from a community post to an apartment detail page that could land on the wrong district's same-named complex, because there is no longer a link at all.

**Blocker:** None triggered — no STOP was needed.

**Files:** `src/app/community/write/page.tsx`, `src/app/community/write/page.module.css`, `src/app/community/page.tsx`, `src/app/community/page.module.css`, `src/app/community/[id]/post-client.tsx`, `src/app/community/[id]/page.module.css`

---

## 3. E-JIP Score — V1/V2 version label mismatch

**Actual calculator shown to users:** `src/lib/score-v2/engine.ts` (`calculateScoreV2`) — absolute, 25/25/25/25 (교통/생활/교육/단지), explainable, honest missing-data handling. `ApartmentScoreCard.tsx` renders `_shadowV2.overallScore` whenever `_shadowV2` exists (effectively always), and never falls back to displaying the legacy V1 number even when V1 succeeded.

**Actual formula:** Unchanged. 25/25/25/25 weighting was **not** touched, per explicit instruction — this STEP only fixes the label/plumbing mismatch, not the math.

**API before:** `scoreVersion` always echoed `SCORE_VERSION` (`'EJIP_SCORE_V1_BETA'`, from `src/lib/apartment-score/server/config.ts`), regardless of which engine's number the client actually displayed.

**API after:** `scoreVersion` now resolves to `_shadowV2.scoreVersion` (`'EJIP_SCORE_V2_1'`) whenever a V2 result exists, falling back to the V1 label only in the rare case V2's computation itself failed (matching exactly what `ApartmentScoreCard.tsx` does: show V2 if present, otherwise show an "unavailable" state — V1's raw number is never shown either way). Implemented via a small pure function `resolveDisplayedScoreVersion()` (`src/lib/apartment-score/resolve-score-version.ts`), unit-tested (`resolve-score-version.test.mjs`, 3/3 pass), and wired into `src/app/api/apt/[name]/score/route.ts`.

**UI label:** No change needed — `ApartmentScoreCard.tsx` already says "Beta" and already explains the 25/25/25/25 weighting and per-domain evidence in its "왜 이런 점수인가요?" expandable section. This was already accurate; only the *API's* version field was wrong.

**Dead V1 computation — audited, not removed:** V1's full pipeline (`calculateApartmentScore` in `calculate.ts`) is **not** dead code. Its `score`/`confidence` fields are unused (superseded by V2's card), but its `categories`, `regionalStrengths`, `market`, and `briefing` outputs are still actively rendered elsewhere on the apartment detail page (the "단지 브리핑" strengths/weaknesses section, "왜 이런 점수인가요?" school/transport evidence). Removing any of that would break a live feature, so nothing was deleted — this STEP is plumbing/labeling only, exactly as scoped.

**Formula changed?** No.

**Files:** `src/app/api/apt/[name]/score/route.ts`, `src/lib/apartment-score/resolve-score-version.ts` (new), `src/lib/apartment-score/resolve-score-version.test.mjs` (new)

---

## 4. Zero vs. NO DATA — dashboard volume

**Affected route:** `src/app/api/stats/dashboard/route.ts` (single-region branch, i.e. any request with a specific `lawdCd` rather than a whole-`sido` request).

**Old behavior:** The single-region branch used `fetchMonthsThrottled()`, a wrapper that discards MOLIT fetch-failure status and returns an empty array for a failed month — identical in shape to a month with a genuine 0 transactions. The whole-`sido` branch already tracked `partial`/`failedLawdCds` for exactly this reason; the single-region branch never did. `volume = aptMonthly[11]?.filter(isValidTrade).length || 0` then could report "0건" for either a real zero or a silent fetch failure, with no way to tell which — and this number is also injected verbatim into the AI-search summary sentence ("최근 1개월 거래량 0건").

**New behavior:**
- Single-region branch now uses `fetchMonthsThrottledWithStatus()` (the same status-preserving fetch the sido-wide branch already used) and sets `partial=true` / `failedLawdCds=[lawdCd]` if any of the 12 monthly MOLIT calls failed.
- `VolumeChartCard.tsx` (the 거래량 stats page) now renders the same "일부 지역(N곳) 데이터 조회가 지연되고 있어요" banner that 5 other stats views already use — it had never been wired up even though the API already produced the field for sido-wide requests.
- `runRegionalStats()` (AI-search's data layer, `src/lib/ai-search.ts`) now also surfaces `partial`, and the AI-search summary sentence no longer states a specific volume number when the underlying fetch was incomplete — it instead says the data couldn't be confirmed, rather than asserting a possibly-wrong "0건".

**Real zero:** A month with `partial=false` and `volume=0` is a genuine, verified zero-transaction month (Busan regions are DB-sourced for the apt side and never hit this failure path at all; only the rent/MOLIT side can fail even for Busan).

**Missing:** A month where the MOLIT call itself failed is now `partial=true`, distinct from a real zero.

**Error:** A full request-level failure (e.g., invalid region) was already handled by the route's outer `try/catch` returning `{success:false}` — unaffected by this change.

**Files:** `src/app/api/stats/dashboard/route.ts`, `src/components/stats/VolumeChartCard.tsx`, `src/components/stats/VolumeChartCard.module.css`, `src/lib/ai-search.ts`, `src/app/api/ai-search/route.ts`

---

## 5. Region Change — error vs. NO DATA

Two separate features were audited under this heading (the baseline audit used "지역 변동지도" loosely for both; both are now fixed):

### 5a. `/stats/change-map` (RegionChangeMapView) — "지역 변동지도" proper

**Old behavior:** `src/app/api/stats/region-change/route.ts` already computed an honest `apiError` field (true when 100% of the relevant districts' MOLIT fetches failed) at both the `sigungu`/`dong` aggregate level and the `complex` (row-list) level — but `RegionChangeMapView.tsx` never read it. A complete fetch failure (`apiError:true`, empty result set) rendered through the exact same code path as a genuine "no comparable trades this period" finding, both showing `Empty variant="noResult"` "선택한 기간에 비교 가능한 거래가 없어요."

**New behavior:** `ScopedLevel()` now checks `data.apiError` first, in both the dong-level row list and the sido/sigungu bucket list, and renders `ErrorState` ("데이터를 불러오지 못했어요. 잠시 후 다시 시도해주세요.") instead of the no-data Empty state when the failure was a fetch error rather than a confirmed empty result.

**File:** `src/components/stats/RegionChangeMapView.tsx`

### 5b. `/stats/price-map` (PriceMapView, "분위지도") — the literal `type-client.tsx:220` citation from the baseline audit

**Old behavior:** `fetch('/api/transactions?...').then(res => res.json()).then(data => ...).catch(() => setLoading(false))`. Two separate conflations existed: (1) a thrown/network exception fell into `.catch()` and just stopped loading with no error flag; (2) more commonly, `/api/transactions`'s own failure response is `{ error: '...' }` (not an array, HTTP 500) — since `fetch().then(res => res.json())` doesn't check `res.ok`, this never threw at all and silently became `[]` via the existing `Array.isArray(data) ? data : []` guard. Either way, `markers.length === 0` rendered the same `Empty variant="noData"` regardless of cause.

**New behavior:** Both paths now set a new `apiError` state (checked before the "no data" branch), rendering `ErrorState` instead. A genuine empty result (successful fetch, zero valid coordinate-bearing trades) still renders `Empty variant="noData"` as before.

**File:** `src/app/stats/[type]/type-client.tsx`

---

## 6. Remaining E-JIP Score V2 redesign requirements (for the separate, later STEP)

Recorded here per the task's request, not acted on in this STEP:

- Confirm whether promoting `score-v2` to be the sole live-displayed score (with V1 now purely a gate + still-used briefing/evidence source) was an intended, approved architectural decision, or should be revisited.
- Decide whether the score should eventually show relative/peer context (V2 is currently absolute-only; V1's peer-percentile machinery exists but is unused for the number itself).
- Consider whether the "Beta" badge should eventually be retired once the labeling above is confirmed intentional.
- No wording found in the current pipeline risks reading as an insult to current residents (checked again this STEP — same conclusion as the baseline audit).

---

## 7. Launch Trust Verdict

All 5 requested blockers are closed with minimal, targeted, schema-free fixes:

- Auction fabricated data → **removed**, honest "준비 중" state.
- Community free-text identity → **wrong-link risk reduced to 0** (write-side canonical picker + read-side link removal), no schema change.
- Score V1/V2 labeling → **fixed** (API `scoreVersion` now matches the engine actually shown), formula untouched.
- Zero vs. NO DATA (dashboard volume) → **fixed** for the single-region path, plus a previously-dead `partial` field is now actually surfaced in the UI and in AI-search text.
- Region-change error vs. NO DATA → **fixed** for both `change-map` and `price-map`.

No DB writes, no schema changes, no formula changes, no destructive actions were performed. **Verdict: trust blockers resolved — ready to proceed to `E-JIP SCORE V2 — PRODUCT & FORMULA REDESIGN`** as the next scoped STEP (see §6 for what that STEP will need to decide).
