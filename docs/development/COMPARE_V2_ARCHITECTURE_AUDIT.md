# COMPARE V2 — PHASE 1: Architecture Audit

**Date:** 2026-09-02
**Baseline commit:** `71ef90d` (branch `main`, follows `DECISION_JOURNEY_V1.1`)
**Scope:** Analysis and design only. No UI implementation, no new API, no schema change. Goal:
decide whether/how to unify the two existing Compare implementations into one trustworthy
decision-support tool, and produce a concrete Phase 2 implementation plan.

---

## 1. Current Implementations

Two genuinely separate, non-interoperating implementations exist.

### A. `CompareView` (chart-based)

`src/app/stats/[type]/type-client.tsx:50-184`, mounted at `/stats/compare` (`maxComplexes=2`) and
`/stats/multi-compare` (`maxComplexes=5`).

- **Entry:** `/stats` menu grid, Home quick-menu ("단지비교" → `/stats/compare` only, not
  multi-compare), and the Apartment Detail page's "비슷한 단지와 비교" NextAction
  (`?prefillName=&prefillLawdCd=&prefillDong=&prefillAptSeq=`).
- **State:** `selected: {name, lawdCd?, dong?, aptSeq?}[]`, `series: Record<name, {date,price}[]>`.
- **Identity key:** `name` — used pervasively: `series[name]` lookup, dedupe
  (`s.name === result.name`), removal (`removeComplex(name)`), React `key={s.name}` on both the
  slot list (line 141) and each chart `<Line>` (line 176). `aptSeq` is captured into `selected`
  (from `ApartmentSearchResult.aptSeq` on manual add, or `?prefillAptSeq=` on Detail-seeded entry)
  but is **never sent to the trades fetch** — only used to build the "상세보기" outbound link.
- **API calls:** exactly 1 per newly-added complex — `GET /api/apt/{name}?lawdCd=&dong=&type=apt&period=36`.
- **Metrics rendered:** a single Recharts line chart, 매매(sale)-only, 36-month trailing window, one
  line per complex. That is the **entire** metric surface — no households/parking/far/bcr/facilities/
  score/jeonse anywhere in this component.
- **Mobile:** chart is fluid-width (`ResponsiveContainer`); slot-list rows have no
  truncation/overflow handling for long names (no `text-overflow`/`white-space:nowrap`).
- **Max count:** 2 or 5 depending on slug; the component itself has no hardcoded column layout, so
  it already scales to N complexes without structural rework.
- **Next actions:** per-slot "상세보기" link (added in `DECISION_JOURNEY_V1`), remove button, add
  more via `ApartmentAutocomplete`.

### B. `CompareResult` (table-based)

`src/app/ai-search/ai-search-client.tsx:445-514`, rendered when `/api/ai-search`'s Gemini
classifier returns `intent: 'compare'`. Backed by `fetchCompareTarget()`/`runCompare()` in
`src/lib/ai-search.ts:416-533`.

- **Entry:** only `/ai-search`, and only reliably via one hardcoded suggestion chip
  (`'대신더샵 vs 대신롯데캐슬 비교'`) — otherwise depends on Gemini correctly classifying free
  text as `compare` intent, which **this audit live-reproduced as unreliable** (see §17).
- **State:** two fixed props `a`/`b` (not a list) — `CompareComplexData{name, latestPrice,
  latestArea, tradeCount, totalHouseholds, parking, far, bcr, buildYear, facilities, areaOptions,
  resolvedLawdCd?, dong?, aptSeq?}`. No name-as-list-key risk exists structurally (no list), but
  `name` is the *only* input available at LLM-classification time — `lawdCd`/`dong`/`aptSeq` are
  all resolved downstream, not supplied by the user's selection the way `CompareView`'s
  autocomplete-driven entry does.
- **API calls:** **3 per complex** — trades (`/api/apt/{name}`), building info (`/api/apt/{name}/info`),
  facilities (`/api/apt/{name}/facilities`) — 6 total for 2 complexes, up to 9 in the worst case
  (when B needs an unscoped retry).
- **Metrics rendered:** 최근 실거래가, 평형 (both area-selector-dependent), 세대수, 주차, 용적률,
  건폐율, 준공, 커뮤니티시설 — 8 rows, zero time-series (only a single "latest" snapshot per
  selected 평형). No score, no jeonse, no volume.
- **Mobile:** deliberately fixed-width, no-horizontal-scroll 2-column table with ellipsis
  truncation — a **considered, already-solved** mobile pattern (explicit code comment rejects an
  earlier min-width-scroll approach).
- **Max count:** hard-coded to exactly 2 (`a`/`b` props, fixed 3-column `<colgroup>` with
  28/36/36% widths) — extending to 3+ requires converting the whole component to an array-mapped
  structure, structurally similar to what `CompareView` already does.
- **Next actions:** per-column "상세보기"-equivalent link (only when `resolvedLawdCd` is present),
  area-selector dropdown per column.

### Neither implementation shows what the product goal requires

`CompareView` shows price trend only; `CompareResult` shows static building facts + price snapshot
only. **Neither shows Score, parking-per-household as a comparable ratio, jeonse/jeonse ratio, or
volume.** Unifying these two is not a cosmetic merge — it requires building a materially larger
metric set that exists today only as scattered, unconnected data sources (§6, §12).

### Two-implementation comparison (side by side)

| | CompareView | CompareResult |
|---|---|---|
| Identity | `name` is the state key; `aptSeq`/`lawdCd`/`dong` carried but unused for fetching | No list-key issue (2 fixed props), but resolved from raw text with zero identity at dispatch |
| Metrics | Price trend chart only (36mo, 매매 only) | 8 static rows (facts + one latest price snapshot), zero time-series |
| Source | `/api/apt/{name}` (1 call/complex) | `/api/apt/{name}` + `/info` + `/facilities` (3 calls/complex) |
| Layout | Vertical slot list + chart, scales to N | Fixed 2-column table, hard-coded for exactly 2 |
| Actions | 상세보기 link, remove, add more (autocomplete) | 상세보기-equivalent link (conditional), area dropdown per column |
| Mobile | Fluid chart, un-truncated slot rows (name overflow risk) | Deliberately fixed-width, no-scroll, ellipsis-truncated — already solved |
| State | `{selected[], series{}}`, name-keyed | Two fixed props, no shared list state |
| API reliability | Reliable (3 solid entry points) | **Entry point itself unreliable — live-reproduced failure, §17** |
| Strengths | N-complex scaling, full identity plumbing, reliable entry, reusable pattern | Solved mobile table pattern, richer static metric set than CompareView shows today |
| Weaknesses | Shows almost no metrics beyond price | Fixed at 2, unreliable entry, 3x the API cost per complex, no time-series |

### A third, unrelated "compare" feature (not to be confused)

`ApartmentScoreCard`'s "비슷한 단지와 비교" peer-percentile line (`src/components/
score-card-presenter.ts`, `derivePeerVerdict`) reuses the same Korean phrase but is a **single-
apartment-vs-peer-group percentile**, not a two-complex side-by-side view. Architecturally
unrelated; not a third implementation to unify, but its peer-context data (§8) is directly reusable
inside the unified Compare's Score section.

## 2. Identity

**Current:** `name` is `CompareView`'s de facto primary key (React reconciliation, series lookup,
dedupe, removal). `CompareResult` has no list-key problem structurally but resolves its two
targets from raw free text with zero identity until `/api/apt/{name}` runs its own name+dong
verification downstream.

**aptSeq coverage today:**
- `CompareView`: captured when available (search result or `?prefillAptSeq=`), stored, used only
  for the outbound detail link — **not used as the internal key, and not sent to the trades fetch**.
- `CompareResult`: derived server-side via `deriveCanonicalAptSeq(trades)` (added in
  `DECISION_JOURNEY_V1.1`) — non-null only when the fetched trades for that name+dong resolve to
  exactly one distinct `aptSeq`. Used only for the outbound detail link, same as `CompareView`.
- `Favorite`/`RecentView` tables **now have a nullable `aptSeq` column** (schema already advanced
  since `DECISION_JOURNEY_V1.1`'s audit — confirmed via live schema read this phase) but the
  **unique constraint is still `[userId, lawdCd, dong, name]`**, not `aptSeq` — so `aptSeq` is
  present but not authoritative identity even there.

**name-key risk, live-reproduced:** with no `lawdCd`/`dong` supplied, `GET /api/apt/현대` (a
maximally ambiguous name — 4 distinct real Busan complexes share it in this DB) resolved via
name-only geocoding to an apartment **entirely outside Busan** (`lawdCd 27110`, a different city)
and returned `trades: []`. This is not a hypothetical — it is the exact failure mode AGENTS.md's
"이름만으로 재식별 금지" principle exists to prevent, and it is currently only avoided in Compare
because both current implementations happen to always have *some* lawdCd context by the time they
call `/api/apt/{name}` (`CompareView` via the search result's own region;
`CompareResult` via its own resolved-region heuristic). This is fragile, not structurally
guaranteed, and is exactly what a canonical-identity-first data contract should close off
permanently rather than rely on incidental context.

**Recommended key (confirmed feasible, not just aspirational):** `aptSeq` when a single
unambiguous value exists (reusing `deriveCanonicalAptSeq`, already shipped and tested in
`DECISION_JOURNEY_V1.1`); otherwise the strong-verified `lawdCd+dong+exact-name` composite
(reusing `resolveStrongIdentityAptSeqs`/`matchesTradeIdentity`, already shipped); **never**
name-only. `name` remains the *display* label — never the key — throughout the new data model
(§19).

## 3. Entry Paths

| Entry | Identity carried | Reliability |
|---|---|---|
| Detail → Compare | `aptSeq` (when canonical), `lawdCd`, `dong`, `name` — full identity | Reliable (deterministic button, shipped V1) |
| Stats → Compare (menu/Home) | none (user builds the comparison manually via autocomplete, which itself supplies full identity per pick) | Reliable |
| AI Search → Compare | `name` only, at dispatch time; identity resolved downstream, imperfectly | **Unreliable at the intent-classification layer itself** — live-reproduced twice this phase: neither `"부산 서구 대신더샵 vs 대신롯데캐슬 비교"` nor the literal hardcoded suggestion-chip string `"대신더샵 vs 대신롯데캐슬 비교"` classified as `compare` intent in two separate live test calls (`intent: undefined`, `"비교할 두 단지명을 정확히 알려주세요"`). The one UI element meant to reliably reach this feature did not, in this test session. |
| Direct URL → Compare | Whatever query params are hand-typed (`/stats/compare?prefillName=...`) — same contract as Detail's link, safe by construction (prefill only seeds one slot; the region-context gate still applies) | Reliable |

## 4. Metric Inventory

Complete list of every metric found anywhere across both implementations plus everything the
supporting-data audit confirmed exists and is reachable without a new API:

price(latest/trend) · area(평형) · build year · households · parking(count, per-household ratio)
· transport(subway/bus distance+count) · education(elementary distance+count) · living/facilities
(POI counts + community facilities list) · Score V2 (overall + 4 domains + peer percentile) ·
volume/liquidity(trailing transaction count) · jeonse(latest deposit) · jeonse ratio (전세가율) ·
far/bcr(용적률/건폐율).

## 5. Metric Trust

Classification is drawn directly from the supporting-data audit (source/API/period/coverage
confirmed by reading the actual code, not estimated):

| Metric | Class | Why |
|---|---|---|
| Sale price (latest, exact area) | **SAFE** (with explicit period/area tagging) | Real MOLIT trade, exact-area matched, `dealCanceled`-filtered for the verified-recent window |
| Build year, households | **SAFE** | 건축물대장, high-confidence when present |
| Parking count / per-household ratio | **LIMITED** | 71.0% Busan coverage (not 25.7% — that figure is pre-fix; not "31%" — that number doesn't refer to parking anywhere in the codebase, see §21), no freshness timestamp |
| Transport distance (subway/bus) | **SAFE, with caveat** | Real API data, but straight-line not routed distance; label accordingly, never call it "walking distance" |
| Education (distance/count) | **LIMITED for distance, UNSAFE for 학군** | Kakao proximity only — **no official zoning/학군 dataset exists in this pipeline at all**. Never imply "assigned school" |
| Living/facilities | **LIMITED** | Two disjoint sources (one-time crawl + live Kakao); crawl freshness unverified |
| Score V2 (per-domain) | **SAFE** (as absolute evidence) | Deterministic, no price input, documented anti-bias design — see §8 |
| Score V2 peer percentile | **SAFE only at HIGH/MEDIUM confidence** | Tiered display already exists; LOW confidence must hide the number, exactly as the Score card already does |
| Jeonse (latest deposit) | **LIMITED** | No cancellation flag exists in the source at all (confirmed: RTMSDataSvcAptRent has zero cancellation fields) — can never be "cancellation-clean" |
| 전세가율 (jeonse ratio) | **UNSAFE as currently computed on the Detail page** (`investment-metrics.ts`, no date-window check) / **LIMITED if computed the dashboard's way** (`gap-invest-calc.ts`, 90-day window cap) | Two non-identical formulas exist in this codebase today — Compare must pick the windowed one, not silently inherit the unwindowed one |
| Volume / liquidity (raw trailing count) | **UNSAFE for cross-complex comparison as-is** | Confirmed: not normalized by household count anywhere in the codebase — a 7,374-household complex and a 554-household complex are not liquidity-comparable on raw count alone |
| Far/bcr (용적률/건폐율) | **LIMITED** | Same coverage tier as parking; already explicitly excluded from any "winner" highlighting in `CompareResult` today (no consensus on directionality) |

**UNSAFE metrics are excluded from Compare V2's default/base screen** per this task's own rule.
Volume must be per-household-normalized before it can be shown at all; jeonse ratio must use the
90-day-windowed formula, not the unwindowed detail-page one.

## 6. Price / Area / Period

**Definition today:** `CompareView` charts 매매(sale)-only, 36-month trailing, no area selector
(whatever `PriceTrendChart`-style trade filtering the trades endpoint returns for the requested
dong). `CompareResult` shows a single "최근 실거래가" value **for whichever 평형 the user has
selected in the per-column dropdown** — i.e., area IS accounted for, but only by forcing the user
to manually pick a comparable area per side; there is no automatic "same market unit" pairing.

**Area fairness recommendation (no redesign of the pyeong system itself, per this task's own
constraint):** default each side's price to the **same national-standard band (84㎡, 80–89㎡)**
when both complexes have a trade in that band (reusing the exact `NATIONAL_STANDARD_AREA_MIN/MAX`
constant already defined in `src/lib/ai-search.ts`) — falling back to each complex's own most-traded
area only when the standard band has no data for that complex, and **always labeling which area
the price actually reflects** (never presenting two different-area prices as directly comparable
without the label).

**Period fairness:** neither implementation currently attaches a recency badge to the displayed
price. Recommend every price metric carry an explicit `period`/trade-date context and — per this
task's explicit rule — flag (not hide) a pairing where one side's reference trade is materially
older than the other's (e.g., >90 days apart, reusing the exact threshold `gap-invest-calc.ts`
already uses and justifies for the same class of problem).

**No-trade case:** never render `0`. Both current implementations already avoid this specific
mistake (`CompareResult` shows `'정보 없음'`; `CompareView`'s chart simply has no line for that
period) — Compare V2 must preserve this, using an explicit "비교 가능한 거래 부족" state per metric,
not a shared page-level error.

**Price difference display:** show absolute difference (already meaningful, no design risk) and
percentage difference **only** with an explicit, visible denominator statement (e.g., "B 대비 +7%")
— never a bare percentage.

## 7. Score

**Current:** neither implementation shows Score today (confirmed: not present anywhere in
`CompareView` or `CompareResult`'s rendered fields).

**Recommended:** show the 4 domain scores (교통/생활/교육/단지, each already backed by structured,
non-fabricated `evidence` in the existing `_shadowV2` result) side by side per apartment — never
collapse to a single-number comparison. This is not just a UX preference; it is the documented,
existing product principle in three independent places already found in this codebase (the Score
card's own disclaimer footer, the deliberately-unused `isParetoSuperior()` test utility, and the
`EJIP_SCORE_V2_PRODUCT_FORMULA_AUDIT.md` finding that two apartments with an identical total can
have opposite domain profiles). Show peer-percentile only at HIGH/MEDIUM confidence, reusing the
exact same gating `score-card-presenter.ts` already implements — do not re-derive a separate rule.

**Price-bias-aware design requirement:** the same audit doc measured a real ρ=0.51 correlation
between price and overall score. A Compare view that shows "A: 62 vs B: 55" without price sitting
directly alongside it would visually reinforce exactly that conflation. Price and Score must be
shown as clearly separate sections, not blended into one "overall verdict" number.

## 8. Parking

LIMITED (§5). 71.0% Busan-wide coverage (current, post-fix figure — not the unsubstantiated "31%"
figure named in the task brief, see §21). When both sides have a value, show
`parkingPerHousehold` (already precomputed and stored per complex, `ApartmentMaster.
parkingPerHousehold` — zero new computation needed). When either side is missing, show "정보
없음" — never treat missing as worse than a real low number.

## 9. Transport

SAFE-with-caveat. Straight-line distance to nearest subway/bus, not routed/walking distance —
label as such. This is Score's own raw evidence data (`DomainResult.evidence` for `transport`,
already computed, already structured) — Compare should reuse it directly rather than re-fetching
or re-deriving. Do not conflate with any future personalized-commute feature (§34) — this is
static proximity, not "time to your workplace."

## 10. Education

LIMITED for distance/count, **UNSAFE for any 학군 (zoning) claim** — confirmed no official
school-zoning dataset feeds this pipeline; it is Kakao-proximity to the nearest elementary school
only, with no middle/high-school distance signal at all. Compare must not imply "assigned school"
or rank by education distance as if it universally matters — the task's own §23 principle (don't
assume every user has children) argues for framing this as a raw fact ("가까운 초등학교까지
420m"), not a value judgment.

## 11. Living

LIMITED. Two genuinely different sources: a one-time community-facilities crawl (golf/pool/etc,
freshness unverified) and live Kakao POI counts (convenience/mart/pharmacy/hospital, each with a
different fixed radius per category — 500m vs 1000m — must never be presented as directly
comparable magnitudes across categories). Sufficient to explain a real difference between two
complexes (e.g., "편의점 8개 vs 2개 반경 500m 이내"), but each count must carry its own radius
label, not a shared unlabeled "생활 점수."

## 12. Rent / Jeonse

LIMITED, with a hard, permanent caveat: the MOLIT rent source has **zero cancellation fields at
all** (confirmed empirically across the full ingested dataset) — rent/jeonse figures can never be
labeled "cancellation-verified" the way sale prices increasingly can. Verified range is a fixed
snapshot (Aug 2024–Aug 2026, Busan 16/16 districts complete as of last sync), not "recent N
months" — Compare must not imply a rolling live window.

전세가율 must use the 90-day-windowed formula (`gap-invest-calc.ts`'s approach) — the detail
page's own `investment-metrics.ts` formula has no date-window check at all and is classified
UNSAFE for reuse in Compare as-is.

## 13. Missing Data

The task's own example is the exact right rule and the codebase already substantially agrees with
it: "주차 데이터 없음" must never resolve to "the side with a number automatically wins." Every
`CompareMetric` (§19) carries an explicit `comparable: boolean` — a missing side on either
apartment sets `comparable = false` for that metric's difference row, which renders as "비교
불가," never as an implicit win for the present side.

## 14. Difference Engine

Design (proposal only, not implemented this phase):

```
CompareDifference {
  metricKey, label
  a: CompareMetric   // full metric object for apartment A, including its own confidence/source
  b: CompareMetric
  direction: 'higher-better' | 'lower-better' | 'neutral' | 'context-only'
  comparable: boolean         // false on missing/period-mismatch/area-mismatch/UNSAFE source
  differenceValue, differenceDisplay   // only populated when comparable
  contextSentence: string | null       // deterministic template, see §16 — never LLM-generated
}
```

Only metrics classified SAFE or LIMITED (§5) ever populate a `CompareDifference` on the default
screen; UNSAFE metrics are excluded entirely, not shown-but-disabled.

## 15. Trade-off Model

**Explicitly not** a "wins: 5, wins: 3" tally (forbidden by the task and inconsistent with the
Score audit's own finding that a single aggregate number hides real character differences).
Recommended structure instead:

- **A의 강점** — metrics where A is comparably, meaningfully ahead (a minimum-difference threshold
  per metric type, not "any nonzero difference")
- **B의 강점** — same, for B
- **비슷한 항목** — differences below the meaningful threshold
- **확인 필요** — `comparable: false` items (missing/mismatched data), shown honestly rather than
  omitted, so users know what *couldn't* be compared, not just what was

No numeric score is summed across categories to produce an implicit winner.

## 16. Sample Audit

20 real Busan pairs sampled from `ApartmentMaster` (read-only query, `sggCd LIKE '26%'`), covering
every category the task requested. Two identity-risk cases were live-tested against the running
dev server this phase (results below); the remainder are analyzed against the confirmed behavior
from §1/§2/§5 (no further live clicks needed once the exact code paths were understood).

| # | Type | Pair | Finding |
|---|---|---|---|
| 1 | 신축 vs 구축 | 롯데캐슬라센트(2025, 부암동, 2195세대) vs 동래럭키(1983, 온천동, 1536세대) | Neither implementation currently shows build-year-adjusted anything — a naive Score display would already reflect age via the `complex` domain's 45%-weighted age factor; must show it as a labeled fact, not fold it silently into one number |
| 2 | 대단지 vs 소단지 | 엘지메트로시티1(2001, 용호동, **7,374세대**) vs 연지2청구(2002, 연지동, **554세대**) | Raw trailing transaction count would make the 7,374-household complex look far more "liquid" purely from size — confirms §5's UNSAFE classification for unnormalized volume |
| 3 | 고가 vs 중저가 | (requires live price fetch, not run this phase — documented as a Phase 2 verification item, not fabricated here) | — |
| 4 | 같은 구 | 롯데캐슬라센트 vs 백양산서희스타힐스 (both 부산진구, `sggCd 26230`) | Same-district pairing is the easy case — no identity risk, area/period fairness is the only concern |
| 5 | 다른 구 | 엘지메트로시티1(남구 26290) vs 동래럭키(동래구 26260) | No structural risk beyond ensuring both sides' region labels are shown so users aren't confused why prices differ |
| 6 | 비슷한 가격 | (requires live price fetch, deferred to Phase 2) | — |
| 7 | 비슷한 연식 | 조양비취맨션(1985, 동삼동, 630세대) vs 선경1(1985, 구서동, 616세대) | Same build year, similar size, different district — a clean "apples to apples" case that should show *few* flagged mismatches once implemented |
| 8 | **같은 이름** | 롯데캐슬(엄궁동, `sggCd 26530`, aptSeq `26530-837`) vs 롯데캐슬(명지동, `sggCd 26440`) | **Live-tested**: `GET /api/apt/롯데캐슬?lawdCd=26530&dong=엄궁동` correctly scoped to the single 엄궁동 complex (all 15 returned trades shared the one aptSeq `26530-837`) — confirms the existing dong-scoped identity protection works correctly *when dong is supplied*. `CompareView`'s manual-add path always supplies dong (from the autocomplete pick), so this pair is safe there. `CompareResult`'s free-text path has no such guarantee up front — see #9 |
| 9 | **같은 이름, no region hint** | "현대" (4 distinct real complexes in the sample: 수영동/신평동/기장읍청강리/문현동) | **Live-tested**: `GET /api/apt/현대` with no `lawdCd`/`dong` resolved via name-only geocoding to a complex **outside Busan entirely** (`lawdCd 27110`) and returned `trades: []`. This is the exact failure class AGENTS.md's identity principle exists to prevent — reproduced live, not hypothetical. Confirms CompareResult's free-text entry path (§3) is the actual risk surface, not CompareView |
| 10 | 같은 이름 | 삼성(문현동 26290) vs 삼성(망미동 26500) | Same risk class as #8/#9; not independently re-tested (pattern already confirmed) |
| 11 | 같은 이름 | 한신(기장읍동부리 26710) vs 한신(신평동 26380) | Same risk class |
| 12 | 같은 이름 | 벽산1(가야동 26230) vs 벽산1(좌동 26350) | Same risk class |
| 13 | 신축, 같은 구, 다른 규모 | 가야역롯데캐슬스카이엘(2026, 725세대, 가야동) vs 양정자이더샵SKVIEW아파트(2025, 1343세대, 양정동) — both 부산진구 | Good "비슷한 연식, 다른 대단지" control case |
| 14 | 구축 vs 신축, 다른 규모 | 삼익비치(1979, 2508세대, 남천동) vs 백양산서희스타힐스(2025, 1295세대, 부암동) | Extreme age gap (46 years) — a build-year-based Score `complex` domain difference should be large and clearly explainable, a good UI-copy test case |
| 15 | 비슷한 연식+규모 | 덕천삼정그린코아(2007, 560세대, 덕천동) vs 사직2차삼정그린코아(2006, 560세대, 사직동) | **Exactly matching household count** (560=560) — the single cleanest "compare like-for-like" pair in the sample; also both contain "삼정그린코아" in the name (partial-name collision risk, distinct from full-name collision) |
| 16-18 | 같은 이름 (additional) | 동원로얄듀크 (3 dong), 반도보라 (2 dong), 삼정그린코아 (2 dong) | Same risk class as #8-12; 11 total duplicate-name groups found in a 400-row sample — this is not a rare edge case in this market |
| 19 | 알려진 실제 케이스 | 대신해모로센트럴아파트 (서구, 2022, 733세대, aptSeq `26140-1356` — the exact complex used to live-verify `DECISION_JOURNEY_V1`/`V1.1`) | Already known-good end-to-end (Detail↔Map↔Compare aptSeq round trip verified in `V1.1`) — useful as the Phase 2 implementation's first manual smoke-test target |
| 20 | AI-search entry reliability | free-text `"부산 서구 대신더샵 vs 대신롯데캐슬 비교"` and the literal hardcoded suggestion chip `"대신더샵 vs 대신롯데캐슬 비교"` | **Live-tested, both failed**: neither classified as `compare` intent (`intent: undefined`, error `"비교할 두 단지명을 정확히 알려주세요"`) in this session. This is the most consequential finding of the sample audit — see §17 |

## 17. Misleading Comparison Findings

- **Identity risk (confirmed live, #9):** name-only resolution with no region hint can silently
  land on a completely different city's same-named complex and report "0 trades" — indistinguishable
  from "this real apartment has no recent trades" unless the caller already knows to be suspicious.
  Not currently possible through either Compare UI's *normal* flow (both supply region context by
  construction today), but it is the exact class of bug a canonical `aptSeq`-first data contract
  should make structurally impossible rather than incidentally avoided.
- **AI-search compare entry unreliability (confirmed live, #20):** the one intended deterministic
  trigger for `CompareResult` did not fire in two out of two live attempts this session, including
  the literal hardcoded suggestion-chip text. Combined with `CompareResult`'s already-known
  discoverability gap (`DECISION_JOURNEY_V1` §10: "no UI element leads here except free text"),
  this substantially weakens the case for keeping `CompareResult` as a maintained, separate
  rendering surface — see §18's recommendation.
- **Area mismatch (structural, not live-tested):** `CompareResult` requires the user to manually
  align 평형 per side via two independent dropdowns; nothing defaults them to a comparable band.
  `CompareView` has no area concept at all — its chart is whatever period/area mix
  `/api/apt/{name}` returns.
- **Period mismatch (structural):** neither implementation attaches a recency badge to a displayed
  price today.
- **Volume/liquidity size bias (structural, confirmed via code + sample pair #2):** raw trailing
  transaction count is not household-normalized anywhere in the codebase.
- **전세가율 formula inconsistency (structural, confirmed via code, §12):** two different formulas
  exist; the detail-page one has no date-window guard.

## 18. Unification Options

| | **A: Extend `CompareView`** | **B: New `UnifiedCompare`** | **C: Shared data model, UI stays split** |
|---|---|---|---|
| Risk | Low — builds on a component already proven to scale to N complexes and already the more-connected, more-reliable entry point | Medium-high — throws away working aptSeq/N-complex plumbing, full mobile re-verification needed | Low short-term, but leaves the reliability gap (§17) and duplicate metric-set problem unresolved long-term |
| Complexity | Medium — needs a real metric-table/difference-engine layer added alongside the existing chart, but no new routing/entry-point work | High — new routing decisions for every entry point, new mobile pattern from scratch | Medium — data layer work is shared, but two renderers must both be kept current forever |
| Migration | Low — `CompareResult`'s already-solved fixed-width no-scroll mobile table pattern can be **ported into** the new metric table (not thrown away, just relocated) | High | Low, but permanent — two surfaces never converge |
| Reuse | High (chart, N-complex state model, aptSeq plumbing, mobile-proven table pattern from the other implementation) | Low | High for data, low for UI |
| Mobile | Builds on a component with a real (if incomplete) mobile story already | Fully new work | Two separate mobile stories to maintain forever |
| Future personalization | Straightforward — one canonical UI to attach a future weighting layer to | Straightforward | Ambiguous — which surface gets personalized first? |

## 19. Recommended Architecture

**Option A, with one structural change beyond the task's own suggestion:** extend `CompareView`
into the canonical Compare UI, and **retire `CompareResult` as a separate rendering surface**
rather than trying to keep two UIs in sync forever. Justification, grounded directly in this
audit's own live evidence, not preference:

1. `CompareResult`'s one reliable entry point (the suggestion chip) **did not work** in live
   testing this session (§17) — it is not currently a dependable feature to keep maintaining as-is.
2. `CompareView` already handles N complexes, already carries `aptSeq` end-to-end, and is reachable
   from three solid entry points (Home, Stats menu, Detail) versus `CompareResult`'s one unreliable
   one.
3. `CompareResult`'s only genuine advantage — the fixed-width, no-horizontal-scroll mobile table
   with ellipsis truncation — is a **reusable pattern**, not a reason to keep the component. Port
   the pattern into `CompareView`'s new metric section; don't keep the component alive to preserve it.
4. The AI-search `compare` intent, once it *does* classify correctly, should **redirect into the
   canonical `/stats/compare` UI** (prefilled with both extracted names, same mechanism Detail's
   NextAction already uses) rather than render its own table — this closes the discoverability gap
   (`DECISION_JOURNEY_V1` §10's documented limitation) for free, since the canonical UI is reachable
   and shareable on its own.
5. `fetchCompareTarget`'s three-call-per-complex data-fetching logic (trades+info+facilities) is
   still valuable — it should be **ported into the shared Compare data layer** (§20), not deleted;
   only the separate `CompareResult` *rendering* is retired.

Shared Compare Data Model + Shared Metric/Difference Engine + one canonical UI (evolved
`CompareView`) is the target shape — matching the task's own suggested "Shared Compare Data Model
+ Shared Metric Definitions + UI variants" framing, except the "UI variants" collapse to one
canonical UI plus a redirect, since the audit found no product reason to keep two.

## 20. Data Contract (proposal, not implemented this phase)

```ts
// Canonical identity — aptSeq first, verified composite fallback, never name-only
type ComparableIdentity =
  | { kind: 'aptSeq'; aptSeq: string }
  | { kind: 'composite'; lawdCd: string; dong: string; name: string };

interface CompareApartment {
  identity: ComparableIdentity;
  displayName: string;                 // canonical MOLIT name — display only, never a key
  region: { lawdCd: string; dong: string; sigunguLabel: string | null };
  facts: {
    buildYear: number | null;
    totalHouseholds: number | null;
    parkingPerHousehold: number | null;  // already precomputed/stored — zero new computation
  };
  score: {
    available: boolean;
    domains: Record<'transport' | 'living' | 'education' | 'complex', {
      score: number | null; coverage: number; evidence: Record<string, unknown>;
    }>;
    overallScore: number | null;
    peerContext: ApartmentScorePeerContext | null;  // reuse existing shape verbatim
  } | null;
  metrics: CompareMetric[];
}

interface CompareMetric {
  key: string;                          // 'salePrice84' | 'jeonseRatio' | 'volumeTrailing12mo' | ...
  label: string;                        // Korean display label
  value: number | string | null;
  displayValue: string;                 // pre-formatted (reuse existing priceStr-style conventions)
  unit: string | null;
  period: { from: string; to: string } | null;
  area: { exclusiveAreaM2: number; label: string } | null;
  trust: 'SAFE' | 'LIMITED' | 'UNSAFE' | 'MISSING';   // per §5 classification
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW';
}

interface CompareDifference {
  metricKey: string;
  a: CompareMetric;
  b: CompareMetric;
  direction: 'higher-better' | 'lower-better' | 'neutral' | 'context-only';
  comparable: boolean;
  differenceValue: number | null;
  differenceDisplay: string | null;
  contextSentence: string | null;       // deterministic template only — see §15, never LLM text
}
```

This mirrors the existing `NextAction`/`decision-journey` convention (typed, small, composable
objects with an explicit trust/priority field) rather than inventing a new style.

## 21. API / Performance

**Current request counts (confirmed via code, not live-timed this phase — proportionate for an
analysis-only STEP; live timing is a Phase 2 verification item):** `CompareView` = 1 API call per
complex (trades only — which is *why* it shows so little). `CompareResult` = 3 API calls per
complex (trades, info, facilities in a trades→then-parallel-info+facilities pattern), 6 total for
2 complexes, up to 9 in the no-region-retry worst case.

**No new API this phase** (per explicit constraint). For Phase 2, the richer metric set this task
wants (Score, jeonse, volume) requires adding `/api/apt/[name]/score` to the per-complex fetch set
— reusing it as-is, already computed, no new endpoint needed. Recommended fetch shape per complex:
fire `trades` and `score` in parallel immediately (score resolves its own `aptSeq` independently,
does not depend on trades resolving first); once `trades` resolves (needed for `dong`/`jibun`),
fire `info` and `facilities` in parallel. That is **2 dependency tiers, 4 calls per complex** — for
a 2-complex compare, both complexes' tier-1 calls run together and both complexes' tier-2 calls run
together, so wall-clock depth stays at 2 round trips regardless of complex count, not N tiers.

**N+1 risk:** call count still scales linearly with complex count (4 × N). This is the concrete
reason to cap the Phase 2 default at 2 complexes (§26) rather than promising 3-5 immediately.

**Target:** ≤1–1.5s initial usable render, matching this task's own goal — realistic based on the
`PERFORMANCE_V1` series' demonstrated pattern (DB-first reads + regional cache reuse already
brought comparable per-complex detail-page loads well under 1s in production after the V1.4 region
fix); needs to be verified with the same curl-based before/after methodology once Phase 2 code
exists, not assumed here.

## 22. URL / Share

Recommend `?aptSeq=A,B` as the primary shareable state (reusing the exact comma-list convention
already established for other multi-value query params in this codebase's stats views), with a
`?name=` fallback pair only for the rare composite-identity case where no `aptSeq` exists for one
side — **never a name-only URL for either side**. The existing global `ShareAction` infrastructure
(already reused by `/stats/[type]` for region shares) is directly reusable — no new share
infrastructure needed, matching this task's explicit ask to check reuse before proposing anything
new.

## 23. Mobile

**2-complex (Phase 2 default):** port `CompareResult`'s already-solved fixed-width, no-horizontal-
scroll, ellipsis-truncated table pattern into the new metric/difference table, preceded by a
"핵심 차이" summary card (top 3 flagged differences, per §16's first-screen-decision-value
requirement, so a user never has to scroll to the bottom to learn the headline differences) and
`CompareView`'s existing price chart above it. Sticky per-apartment headers (name + region) so
users scrolling a long metric list don't lose track of which column is which.

**3+ (explicitly deferred, per §26):** the fixed-width 2-column table pattern does not extend
cleanly (confirmed structurally in §1's `CompareResult` analysis — `colgroup`/`winnerFor` are
hard-coded to 2). A future 3+ mobile design would need `CompareView`'s already-N-scalable
vertical-slot-list pattern extended with swipeable per-apartment metric cards, not the table —
worth prototyping in a later phase, not designed in detail here.

**Desktop:** same content, more horizontal room (wider columns, room for 2-3 side-by-side domain
score bars instead of stacked); not a different product, per this task's own §46 requirement.

## 24. Phase 2 Scope

**Implement:**
- `aptSeq`-first `ComparableIdentity` as the actual internal key (replacing `name`-as-key in the
  evolved `CompareView`)
- The shared `CompareApartment`/`CompareMetric`/`CompareDifference` data contract (§20)
- 2-complex compare only (default; existing `maxComplexes=5` UI path can remain but is not the
  Phase 2 focus)
- Core metrics: price (area/period-labeled), Score 4-domains + peer context, parking-per-household,
  transport/education distance, living facility counts — all already SAFE/LIMITED per §5
- Difference engine + trade-off model (§14/§15), no numeric winner tally
- Mobile fixed-width table + summary card (§23)
- Shareable `?aptSeq=A,B` URL (§22)
- AI-search `compare` intent redirect into the canonical UI (§19), once/if its classification
  reliability is separately fixed — that classification bug itself is **not** in Phase 2's scope
  (it's an `/api/ai-search` prompt/classification issue, unrelated to Compare's own architecture)

**Defer:**
- 3+ complex compare UI redesign
- Personalized/weighted comparison (architecture must not block it — §20's typed contract already
  doesn't — but no implementation)
- Liquidity/volume normalization work beyond "exclude it from the default screen" (needs its own
  design pass on what a fair per-household or per-price-tier normalization looks like)
- Jeonse-ratio formula consolidation between `investment-metrics.ts` and `gap-invest-calc.ts`
  (Compare should use the safer one; unifying them everywhere else is a separate cleanup)
- Fixing `/api/ai-search`'s compare-intent classification reliability (§17/§20 note)

## 25. Favorites Relation

`Favorite`/`RecentView` now have a nullable `aptSeq` column (schema has advanced since
`DECISION_JOURNEY_V1.1`'s audit, which found none — confirmed current state by reading the live
schema this phase), but the unique constraint is still `[userId, lawdCd, dong, name]`, not
`aptSeq`. **Risk if Compare treats a favorite row as canonical identity by itself:** `aptSeq` may
be null on older rows (written before the column existed, or written through a path that never
resolved one), and even when present it is not guaranteed to be the row's true dedup key — two
favorite rows could theoretically represent the same physical complex under slightly different
`name` normalization. **Recommendation:** if a future "compare my favorites" entry point is built,
treat the favorite's `aptSeq` as a hint only (same validate-don't-trust pattern as
`deriveCanonicalAptSeq`'s `incomingAptSeq` handling) — re-verify against `/api/apt/[name]` trades
before treating it as canonical, never assume the stored value is authoritative. No schema change
proposed or needed for Phase 2 (Compare doesn't need a favorites entry point to ship its core
scope).

## 26. Resident-Sensitive Language

Directly reusing the same banned/recommended vocabulary already established for Score (this task's
own §50 list matches the Score card's own existing constraints almost verbatim — one shared style
guide, not two):

**Never:** 압승, 완패, 열세, 최악, 낮은 수준, "A가 B보다 무조건 좋다," "A 승."
**Use instead:** 상대적으로 유리, 비슷한 수준, 확인 필요, "이 조건에서는 차이가 있습니다."

Deterministic template example for `contextSentence` (§14) — plain data-rule string interpolation,
never LLM-generated (per this task's explicit §33 prohibition):
`"{metricLabel} 기준으로 {winnerLabel}가 상대적으로 여유 있습니다 (차이 {differenceDisplay})."`
— only emitted when `comparable: true` and the difference clears the meaningful-threshold bar
(§15); otherwise no sentence is shown for that metric at all, not a filler one.

## 27. Accessibility

Table semantics: reuse `<table>`/`<th scope="col">` (already used correctly in `CompareResult`,
per the code read in §1) rather than div-grids, which cost nothing extra to carry into the unified
metric table. Each metric row needs an `aria-label` that includes both values and which side is
which (screen readers can't rely on column position the way sighted users do) — e.g. `"주차:
A 1.15대, B 정보 없음"` rather than leaving it to visual column alignment alone. Touch targets for
the area-selector dropdowns and remove/add buttons must stay ≥44px, matching the standard already
enforced elsewhere in this app (`NextActionSection` §19 precedent). Color must not be the only
signal for "A의 강점" vs "B의 강점" — pair the existing color-dot convention with a text label,
not color alone (relevant since `CompareView` already assigns a color per complex via
`COMPARE_COLORS`).

## 28. Analytics

Reuse the existing fixed-taxonomy event system (`src/lib/analytics/events.ts`,
`ANALYTICS_EVENT_NAMES`) exactly as `DECISION_JOURNEY_V1` did for `next_action_click` — no new
schema, no dedicated Event table. Candidate event names for Phase 2 (additive to the existing
array, each a plain string add, nothing else): `compare_start`, `compare_add`, `compare_remove`,
`compare_detail_click`, `compare_share`. Per this task's explicit constraint, no new fields beyond
what `TrackEventContext` (`complexId`, `aptName`) already carries — do not smuggle metric-level
detail into the event payload.

## 29. Wire-Level Mock (proposal only, not implemented this phase)

```
[← 뒤로]                                    [공유]

  대신해모로센트럴아파트  vs  대신더샵
  부산 서구 서대신동2가       부산 서구 대신동

  핵심 차이
  ─────────────────────────────────────
  · 대신해모로센트럴: 세대당 주차 여유 (1.15 vs 0.82)
  · 대신더샵: 최근 실거래가 더 낮음 (6.2억 vs 6.9억, 84㎡ 기준)
  · 교육: 두 단지 비슷한 수준 (초등학교 거리 420m vs 460m)

  가격 (84㎡ 기준, 2026.08 거래)
  ─────────────────────────────────────
  대신해모로센트럴아파트        대신더샵
  6억 5,200만                  6억 9,000만
  2026.08.31                   2026.08.12
                    차이 3,800만

  이집 분석 (절대 평가 — 순위 아님)
  ─────────────────────────────────────
  교통   ████████░░ 82   ██████░░░░ 61
  생활   ██████░░░░ 58   ███████░░░ 70
  교육   ███████░░░ 71   ███████░░░ 68
  단지   █████░░░░░ 54   ████████░░ 79
  비슷한 단지 대비: 상위 32%       상위 41%

  단지 여건
  ─────────────────────────────────────
  준공          2022년           2019년
  세대수        733세대          1,102세대
  세대당 주차   1.15대           0.82대

  교통 · 생활 · 교육
  ─────────────────────────────────────
  지하철 최근거리    340m         180m
  버스정류장         60m          90m
  편의점(500m)       10개         6개
  초등학교 거리      420m         460m

  거래
  ─────────────────────────────────────
  최근 12개월 거래   확인 필요 (단지 규모 차이로 단순 비교 불가)

  [상세보기]  [지도에서 보기]  [단지 교체]
```

Priority order (top → bottom) follows this task's own §47 hierarchy: 핵심 차이 요약 → 가격 → Score
categories → 단지 여건 → 교통/생활/교육 → 거래 → next actions — adjusted only by moving 단지
여건 (parking/households/build year) above the raw 교통/생활/교육 facts, since `complex`-domain
facts are higher-confidence (SAFE, §5) than the POI-count-based living facts (LIMITED).

## 30. Risks

- **AI-search compare entry reliability (§17):** live-confirmed broken in this session — not a
  Phase 2 blocker for the *canonical UI* (Option A doesn't depend on it), but the redirect-based
  integration (§19 point 4) cannot ship its intended discoverability improvement until this is
  separately fixed — flagged as an explicit dependency, not silently assumed away.
- **Metric-set expansion cost:** the richer metric set this task wants doesn't exist as a single
  fetch anywhere today — Phase 2 must actually build the aggregation layer described in §21, not
  just re-skin existing data.
- **Favorites `aptSeq` reliability (§25):** present but not authoritative; any future
  favorites-driven compare entry must re-verify, not trust.
- **Volume normalization is unsolved, not just deferred:** §5/§17 confirm no per-household
  normalization exists anywhere in the codebase today — this is real, non-trivial design work for
  a later phase, not a small follow-up.

## 31. PM Decisions Required

1. Approve Option A (extend `CompareView`, retire `CompareResult` as a rendering surface) as the
   unification direction (§18/§19), including the AI-search redirect approach once its
   classification reliability is independently fixed.
2. Confirm the Phase 2 default compare count is 2 (not 5) — `multi-compare`'s existing UI can stay
   live unchanged in the interim, but Phase 2 engineering effort focuses on the 2-complex canonical
   experience.
3. Confirm 전세가율/jeonse metrics ship as LIMITED-labeled (not hidden entirely) in Phase 2, given
   the permanent no-cancellation-flag caveat — or decide to exclude jeonse from Phase 2's default
   screen entirely and revisit later.
4. Confirm volume/liquidity stays excluded from Phase 2's default screen until a normalization
   design exists (§30) — no metric ships UNSAFE.

## 32. Database

READ only this STEP (one read-only sample query against `ApartmentMaster`, plus live API calls
against the dev server — no writes anywhere). WRITE: 0. Schema: 0. Migration: 0.
