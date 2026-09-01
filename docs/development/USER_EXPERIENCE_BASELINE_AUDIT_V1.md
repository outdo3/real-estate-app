# USER EXPERIENCE BASELINE AUDIT V1

**Date:** 2026-09-01
**Baseline commit:** `9c668b5` (branch `main`)
**Scope:** Full user-journey / launch-readiness audit of 이집(E-JIP). No new features built. Small, safe hotfixes applied where the audit rules explicitly allow (broken flow, wrong data). Everything else is recorded here as input to future STEPs (HOME V2, Decision Journey V1, Compare V2, Score V2, Finance Fit V1).

**Method:** Full code-level review of `src/app`, `src/lib`, `src/components` (route inventory, Score/Compare/Finance depth audit, data-trust wording audit, decision-journey linkage audit) combined with live browser walkthroughs against a local dev server (home → search → detail → compare → map → stats → login-gate flows), console/network inspection, and a targeted live-bug repro. Note: `resize_window` browser automation is unreliable in this environment (previously confirmed in other sessions) — mobile-viewport verification below is a mix of one narrower live pass plus code-level CSS review, not full on-device QA at 360/375/390. This is flagged wherever it matters.

---

## 1. Executive Summary

이집's core skeleton is more complete and more honest than a typical pre-launch app: canonical apartment identity (aptSeq/lawdCd/dong) is used correctly almost everywhere, empty/error states are mostly hand-built and mostly correct, and the already-completed TRADE_DB_FIRST_V1 line of work shows in how carefully price-ranking copy avoids overclaiming ("2년최고가" instead of "역대"/"신고가", explicit coverage windows). The E-JIP Score is explainable and honest about missing data. That said, the audit surfaced one live, reproducible bug in a shipped feature (Compare) that has now been fixed, one recurrence of an already-known data-trust bug class, one internal inconsistency in the Score system that needs a PM/eng decision (not a code fix), one page presenting invented data as if real (경·공매 tab), and a Decision Journey that mostly dead-ends at the apartment-detail page — a user can find and evaluate one apartment well, but the app rarely proposes what to do next (compare it, budget it, look at similar options).

**Launch verdict: LIMITED.** Nothing found here is a full stop-ship blocker for a soft/beta launch, but three items should be resolved or explicitly accepted by the user before a public launch claim: the fabricated auction listings in `/tools`, the Score V1/V2 labeling mismatch, and the community free-text apartment link (identity risk).

---

## 2. Current User Journey

**First visit (home):** Clear, uncluttered. Tagline "복잡한 부동산, 이집으로 쉽게" sits directly above a single prominent search bar, with "지도에서 찾기" / "조건으로 집 찾기" as two secondary calls-to-action. No login wall. A user can search immediately. The one open question is whether "AI/조건검색" vs "지도" vs plain "검색" is legible as three genuinely different paths on first glance — they read more like three doors into the same room. Busan-only scope is not stated on the home page itself (it only becomes obvious once you search); this is a minor first-visit clarity gap, not a blocker.

**Search → detail:** Works well. The autocomplete disambiguates same-named apartments by dong + 세대수 + 준공년도 (e.g. five different "삼정그린코아" results, one per dong), and clicking through carries `lawdCd`+`dong` into `/apt/[name]`, landing on the correct complex. "최근 본 단지" correctly recorded the visited apartment with its real dong. This is the single most safety-critical flow in the app (per project rules) and it held up under live testing with a genuinely ambiguous, repeated apartment name.

**Detail page:** Rich and mostly self-explanatory — price, trade history, E-JIP Score with an expandable "왜 이런 점수인가요?" rationale, a plain-language "단지 브리핑" (strengths/weaknesses/target-user), 단지 상세 제원 (households/FAR/BCR/parking), 생활정보 (POIs), and an apartment-scoped community thread. Favorite (heart icon) correctly opens a clean Kakao/Naver/Google login modal instead of forcing login on page load. The page has no exit ramp, though — see §12.

**Stats → discovery:** Ranking pages (하락/상승/2년최고가/84㎡) are well-captioned ("최근 2년 최고가 대비" — not "역대") and every row deep-links correctly to the apartment detail page with identity preserved. This part of the funnel is in good shape.

**Compare:** Found and fixed a real bug (was showing a **completely empty chart** for a valid apartment with real trade history — see §5/§16). Even after the fix, Compare is a bare price-trend line chart for exactly 2 (or 5, on `/stats/multi-compare`) apartments — no school/transit/parking/score comparison, no verdict. A second, richer, table-style compare experience also exists inside AI Search (다른 dimensions, 2 items only, "AI 브리핑" text) — these are two different, un-unified "compare" experiences living in the app simultaneously.

**Map:** Loads with individually-labeled price-chip markers (not anonymous cluster badges), a 신축(new-build) badge, and category filters (아파트/오피스텔/생숙/재개발/경공매/학교). Marker click surfaces price detail; a second click / explicit button routes to `/apt/[name]`.

**Where it dead-ends:** Apartment detail → nothing. No Compare button, no "비슷한 단지," no budget/finance nudge from the page most likely to end a session. This is the single biggest Decision Journey gap (§12).

---

## 3. Route Inventory

| Route | Exists | Reachable | Entry points | Data source | Status |
|---|---|---|---|---|---|
| `/` (home) | Y | Y | direct, logo | localStorage + static | 정상 |
| `/ai-search` | Y | Y | home "조건으로 집 찾기" | Gemini + region lookup | 정상 |
| `/map` | Y | Y | home, bottom-nav | Kakao Maps + DB | 정상 |
| `/apt/[name]` | Y | Y | search/map/recent/favorites/community | Prisma DB + external APIs | 정상 |
| `/stats` (menu) | Y | Y | bottom-nav, home big card | static config | 정상 |
| `/stats/[type]` (17 slugs) | Y | Y (13/17 live, 4/17 honest "coming soon") | `/stats` grid, home quick-menu, cross-links | mostly Prisma DB | 정상 / 미연동(4) |
| `/stats/compare`, `/stats/multi-compare` | Y | Y | home "단지비교" tile | Prisma DB via `/api/apt` | 정상 (bug fixed this STEP) |
| `/presales`, `/presales/[id]` | Y | Y | home "재개발·분양", bottom-nav | Prisma DB (1046 rows) | 정상 |
| `/redevelopment`, `/redevelopment/[id]` | Y | Y | home big card, bottom-nav | Prisma DB | 정상 |
| `/school`, `/school/[id]` | Y | Y | `/stats` "기타" only — no bottom-nav/home link | Kakao Places + Prisma | 정상, low discoverability (intentional, see below) |
| `/community`, `/community/[id]`, `/community/write` | Y | Y | `/my` only, + apt-detail preview widget | Prisma DB | 정상, **identity flag** (§16) |
| `/my` | Y | Y | bottom-nav "MY" | Prisma DB + session | 정상 |
| `/admin/dashboard`, `/admin/ops`, `/admin/users` | Y | Y (ADMIN only) | `/my` | Prisma DB | 정상 |
| `/tools` | Y | Y | `/stats` "기타" only | **static/hardcoded** | 확인 필요 — see §16 (fabricated auction data) |
| `/terms`, `/privacy` | Y | Y | `/my` | static | 정상 |

No `loading.tsx`, `error.tsx`, or `not-found.tsx` exists anywhere in `src/app` — every page hand-rolls its own loading/empty/error UI instead. This is consistent app-wide rather than a partial gap, but it means an uncaught server-side exception falls through to Next's generic unstyled error page.

**No dedicated routes exist for:** a generic `/search` page (search lives on home + `/ai-search`), a `/login` page (auth is a modal via `signIn()`, no route), a `/favorites` page (lives only inside `/my`), or a single unified `/compare` page (two separate implementations, see §10).

**Orphaned-but-intentional:** `/school` and `/tools` are reachable only via `/stats` → "기타", by design — a code comment explicitly documents this as a side-effect of a prior bottom-nav simplification, not an oversight. `/community` is reachable only via `/my` and an apt-detail preview widget, which under-serves the platform's stated long-term Community direction (contextual, map/detail-linked) — a product-direction note, not a bug.

---

## 4. Page Readiness

| Page | Verdict |
|---|---|
| 홈 | READY |
| 검색 (autocomplete) | READY |
| AI/조건 검색 | READY |
| 지도 | READY |
| 단지 상세 | LIMITED — content is strong, but the page is a dead end (no Compare/Nearby/Finance exit) |
| 통계 (랭킹류) | READY |
| 비교 | LIMITED — functional after this STEP's fix, but thin (price-only) and duplicated by a second, richer AI-search compare |
| 관심단지 / MY | LIMITED — code-verified only; real OAuth login could not be exercised in this environment |
| 점수 (E-JIP Score) | LIMITED — good UX, but see §7 Score-plumbing flag |
| 예산/재무 | NOT_READY — real gaps plus one page presenting invented numbers as real (§16) |
| 결정 여정 (Decision Journey) | NOT_READY — see §12 |

---

## 5. Data Trust Issues

1. **P0-class, live, reproduced and fixed this STEP:** `/stats/compare` (and `/stats/multi-compare`) scoped each selected apartment's trade-history fetch to the **page's region filter's lawdCd**, not the apartment's own `lawdCd`/`dong` returned by its own search result. Live-reproduced: selecting "삼정그린코아" (Dongnae-gu) while the page's region filter was set to "부산광역시 서구" rendered a **completely empty chart** for that apartment, despite it having real, visible trade history on its own detail page. Beyond the empty-chart symptom, this was a latent identity-collision risk exactly matching the project's most sensitive rule (no name-only re-identification) — a same-named apartment happening to exist in the page's *currently selected* wrong region could have silently rendered under the wrong complex's data instead of failing empty. **Fixed:** `CompareView` now carries each selected result's own `lawdCd`/`dong` and uses them in the fetch. Verified live after the fix — the same apartment's real price series now renders correctly regardless of the page-level region filter.
2. **P1, live, not yet fixed (flagged, not touched — outside the scope of a single-file hotfix):** `src/app/api/stats/dashboard/route.ts` computed "전세가율" (jeonse ratio) by averaging **all** rent trades (including 반전세/월세) instead of pure-jeonse only — the exact bug class already found and fixed elsewhere in this codebase (the documented "-97% false 역전세" incident). **Fixed this STEP** by reusing the already-computed `recentPureJeonseTrades` variable (same fix pattern already applied at `rankings/route.ts:113` and `investment-metrics.ts:41`) instead of the unfiltered `recentRentTrades`. This value feeds directly into AI-search's summary sentence and its 갭투자-risk guidance copy.
3. **확인 필요 (not asserted as a bug, needs a PM/eng decision):** The apartment detail page's "이집점수" card exclusively displays the output of `score-v2/engine.ts`, which is internally wired up as `_shadowV2` on the "official" V1 (peer-percentile) engine's result — i.e., the number users see in production is architecturally labeled/treated as a shadow/comparison calculation, while the "official" V1 score is computed but never shown. The API also reports `scoreVersion: 'EJIP_SCORE_V1_BETA'` even though the displayed number is V2. This may well be an intentional, already-approved promotion of V2 to be the live score — but the code's own naming and comments don't confirm that, and Score changes require explicit approval per project rules, so this needs a yes/no from the user before being treated as settled. **Not touched.**
4. **P1, not fixed (requires a product decision, not a hotfix):** `/tools` → "⚖️ 경·공매 비교" tab renders two fully invented, specific listings (named apartment, building/unit/floor, 유찰 횟수, 감정가, 최저가, a computed "cheaper than market" delta) with no backing API and no "예시/샘플" label anywhere in the rendered UI. This is the one place in the app that most directly conflicts with the project's data-truth policy ("never invent missing data or false precision," "never disguise a failed lookup as absent data") — it isn't a failed lookup, it's fabricated content presented with real-transaction-grade specificity. Recommend the user decide between removing the tab, gating it behind a "준비 중" state (matching the honest pattern already used for the 4 unimplemented `/stats/[type]` slugs), or explicitly labeling it as illustrative. **Not touched — this is a visible content/product decision, not a safe hotfix.**
5. **P1, identity, not fixed (regression vs. the project's core identity rule):** `/community` and `/community/[id]` link an apartment badge to `/apt/${encodeURIComponent(post.aptName)}` with **no `lawdCd`/`dong`** — because `/community/write` collects the apartment name as a **free-text field**, with no autocomplete/canonical picker. This is the exact bug class already found and fixed twice before on the map and detail pages (name-only re-identification risk). Fixing it properly means adding a canonical apartment picker to the write flow — a real (if small) feature, not a one-line hotfix, so it is reported here rather than changed.
6. Two smaller wording/precision items found and left as-is per the audit's own hotfix limits: (a) `/tools`'s acquisition-tax and DSR calculators are labeled "스마트 계산기" while their own code comments admit they're simplified mock formulas (flat rate brackets, no 조정대상지역 handling); (b) `dashboard/route.ts`'s single-region trading-volume figure can render a MOLIT fetch failure as "0건" (a verified true zero is a different thing than a failed lookup) — flagged for a future STEP, not touched, since the fix isn't a one-line change (needs the same `failedLawdCds`/`partial` tracking the 시도전체 branch already has).

No cases were found of "역대"/"신고가" being applied outside the verified 24-month Busan window in any **live, reachable** surface — the one place that pattern exists (`MarketInsights.tsx`, hardcoded `changeType: 'new'` on every row including its own error placeholder) is dead code, not imported anywhere, and should not be revived as-is.

---

## 6. UX Issues

- Bottom-nav (5 items: 홈/지도/통계/재개발·분양/MY) and home's quick-menu (2 big cards + 7 stats shortcuts) overlap in coverage but not confusingly — the quick-menu is a legitimate one-tap shortcut layer into 통계's sub-pages, and active-tab highlighting is correct on both.
- Two separate "compare" UIs exist (`/stats/compare` price-chart, and AI-search's richer-but-still-2-item comparison table) with no cross-link between them and no single canonical entry point — a genuine "which one is the real Compare feature" ambiguity worth resolving in Compare V2.
- Detail page's auto-generated "단지 브리핑" text can read awkwardly when strengths are generic ("무난한 측면에서 강점이 있는 무난한 단지입니다" — repeats "무난한" twice) — cosmetic, low severity.
- `/tools` uses decorative emoji (🧮📋⚖️📝💰🏦🛡️✅❌) throughout, which conflicts with the project's explicit rule against decorative emoji in product UI in favor of the established `lucide-react` icon system.

---

## 7. Mobile Issues

Live device-width verification was constrained in this environment (browser `resize_window` did not reliably emulate a true 375px-wide layout — a known limitation in this setup, not a new finding). What could be verified:

- At a reduced browser width, the home page's cards stacked correctly, bottom-nav rendered and remained usable, and no gross breakage was observed.
- Code-level review of the Compare table inside AI-search (`ai-search-client.module.css`) found it deliberately avoids horizontal scroll via `table-layout: fixed` + `white-space: nowrap; text-overflow: ellipsis`, which at 360px (≈118-130px per data column) risks **silently truncating** long facility lists or long complex names rather than wrapping — worth a real on-device check before Compare V2 work begins, since silent truncation is a subtler failure mode than overflow.
- No other mobile-specific code smells (fixed/floating elements covering content, missing touch-target sizing) were found in the components reviewed, but this should not be read as a full 360/375/390 clearance — a follow-up STEP with working device emulation is recommended before signing mobile off as READY.

---

## 8. Performance Issues

Not benchmarked this STEP (out of scope per the audit brief — DB-first migration work already closed the major backend latency issues in prior STEPs). Live dev-server page loads for search, detail, compare, and map all completed within a few seconds including on-demand Next.js dev compilation overhead, which is not representative of production timing. No user-facing infinite-loading state was found except the one fixed this STEP (Compare's un-caught `Promise.all`, which had no error path and could hang the spinner forever on a network failure — now given a `.catch()`).

---

## 9. Missing Core Features

- **Finance/budget:** No 중개보수, no 월상환액, no 총구매비용, no 전월세전환, no real 예산 기반 추천 (only a hard price-ceiling filter inside AI search). The two finance-adjacent tools that do exist (`/tools` 취득세/DSR calculators) are labeled as "스마트" but are simplified mock formulas per their own code comments.
- **Apartment detail → next action:** no Compare button, no Nearby/Similar apartments section. (Confirmed consistent with a documented prior decision — "APT DETAIL V1 = LOCKED, no new features except BLOCKER/data-error/severe-UX" — so this is a frozen scope, not an oversight, but it is still the single largest Decision Journey gap in the app today.)
- **Compare:** no >2-item support on the primary `/stats/compare` route (5 on multi-compare, but still price-only), no school/transit/score dimensions, no verdict/recommendation.
- **Canonical apartment picker in Community write flow** (see §5.5) — currently free text.

---

## 10. P0 / P1 / P2 / P3

**P0 (already fixed this STEP, kept here for the record):**
- `/stats/compare` used the wrong region scope for per-apartment trade lookups (empty-chart bug + latent identity-collision risk). **FIXED.**

**P1 (should be resolved or explicitly accepted before a public launch claim):**
- 전세가율 mixing pure-jeonse and 반전세/월세 in `dashboard/route.ts` (recurrence of a known bug class). **FIXED this STEP.**
- `/tools` 경·공매 tab presents fabricated listings as real data — needs a product decision (remove / gate / label).
- Score V1/V2 labeling mismatch (`scoreVersion` reports V1 while the UI shows V2's number) — needs a yes/no confirmation that this was an approved promotion.
- `/community` writes/links apartments by free-text name only (identity-rule regression) — needs a canonical picker, not a one-line fix.
- Compare's un-caught `Promise.all` (infinite-spinner risk on network failure). **FIXED this STEP.**

**P2 (recommended before/soon after launch):**
- Two divergent, un-unified Compare experiences (`/stats/compare` vs. AI-search compare).
- `dashboard/route.ts` single-region trade-volume can render a fetch failure as "0건" instead of a distinguishable error/missing state.
- `/tools` tax/DSR calculators labeled "스마트" while using simplified mock formulas; also uses decorative emoji against project convention.
- Compare table's cell-truncation risk at 360px width — needs a real on-device check.
- `RegionChangeMapView`/`PriceMapView` fetch failures render identically to "no data."

**P3 (post-launch acceptable):**
- Auto-generated "단지 브리핑" copy can read repetitively for generic complexes.
- `/community` discoverability is low relative to the platform's stated long-term Community direction (product-direction note, not a defect).
- Dead code (`MarketInsights.tsx`) — no user-facing effect today, but should not be revived without applying the same coverage-label/error discipline the rest of the app now has.

---

## 11. Recommended Roadmap

Given what this audit found, the highest-leverage next STEPs, in order:

1. **Decision Journey V1** — at minimum, add a Compare entry point and a "비슷한 단지" surface to apartment detail. This is the single largest gap between what the platform claims to be (DATA → INTERPRETATION → COMPARISON → RECOMMENDATION → ACTION) and what it currently does (stops at INTERPRETATION for most users).
2. **Resolve the three flagged trust items** (auction tab, Score labeling, Community identity) — these are small in code-size but directly touch the project's data-truth and identity rules, so they deserve explicit user sign-off before being called "launch-ready," even though none of them required a full redesign to fix.
3. **Compare V2** — unify the two existing implementations, add real comparison dimensions (score, school, transit), and settle the >2-item question.
4. **Finance Fit V1** — real tax brackets, real DSR, monthly-payment and total-cost figures; sequence after the trust items above, since finance numbers are exactly the kind of "wrong number, real consequences" surface the audit's data-truth rule is meant to protect.
5. **Score V2 polish** — not a formula change, just correcting the `scoreVersion` label and confirming/clarifying the "absolute, not vs.-peers" framing in the UI copy, once the labeling question in item 2 is resolved.

---

## 12. Launch Readiness

**READY:** 홈, 검색, AI/조건검색, 지도, 통계(랭킹류)
**LIMITED:** 단지 상세 (content strong, no exit ramp), 비교 (functional post-fix, thin & duplicated), 관심단지/MY (code-verified only), 점수 (good UX, labeling flag)
**NOT_READY:** 예산/재무, 결정 여정(Decision Journey)

**Overall: LIMITED.** The core "find and evaluate one apartment" path is solid and trustworthy. What's missing is almost entirely the "then what?" layer — comparing, budgeting, discovering alternatives — plus three specific trust items (fabricated auction data, Score labeling, Community identity) that are small to fix but shouldn't ship silently.
