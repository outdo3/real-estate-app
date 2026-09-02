# FINANCE FIT V1 — PHASE 1: Financial Rules / Existing Tools / Trust Audit

**Date:** 2026-09-02
**Baseline commit:** `79f4e16` (branch `main`, follows `COMPARE_V2_PHASE2_IMPLEMENTATION.md`)
**Scope:** Audit only. No UI implementation, no new API, no schema change. Goal: inventory every
existing calculation this app already exposes to users touching price/tax/loan/brokerage, classify
each as SAFE/LIMITED/UNSAFE/NOT_IMPLEMENTED, and produce a Phase 2 implementation plan.

---

## 1. Existing Tools

Two dispatched research agents independently confirmed the same inventory (cross-checked, not
duplicated). Full list:

| # | Feature | Route/File | Real calc or mock? | User-facing? |
|---|---|---|---|---|
| A1a | 취득세 계산기 | `/tools` (calc tab), `src/app/tools/page.tsx:19-28` | **Real calc** (computes from live input) | Yes — linked from `/stats` "기타" section |
| A1b | DSR 대출 가능 한도 추정 | `/tools` (calc tab), `page.tsx:30` | **Real calc**, but not actually a DSR formula | Yes, same tab |
| A2 | 안전계약 체크 | `/tools` (safety tab), `page.tsx:94-128` | Static reference text, no calculation | Yes |
| A3 | 경·공매 비교 | `/tools` (auction tab), `page.tsx:130-150` | **Was fabricated example listings; already fixed** (commit `35dfe75`, 2026-09-01, "fix(trust): resolve launch data trust blockers") to an honest `<Empty variant="notReady">` state | Yes (now honest placeholder) |
| A4 | 임장 노트 | `/tools` (note tab), `page.tsx:152-191` | Decorative — "저장하기" button has **no onClick handler**, does nothing | Yes, but non-functional |
| A5 | 대출한도 (LTV) modal | `/apt/[name]` detail, `apt-client.tsx:653-673`, triggered by "이 집 사려면 얼마 필요할까?" | **Real calc** off live MOLIT trade price, guards the no-trade case | Yes — prominent button |
| A6 | 갭투자/전세가율 | `src/lib/gap-invest-calc.ts`, `investment-metrics.ts` | **Real calc**, extensively `§`-documented | Yes (`/stats`, apt detail) — market statistic, not a personal-finance calculator |

**Not found anywhere in the repo:** 중개보수/브로커리지 계산기 (no fee schedule, no price-band
table, no 매매/전세 distinction exists at all), 월 상환액/원리금균등/원금균등/만기일시 (no
amortization formula, no `Math.pow`-based compounding, nothing), a real DSR formula (only the flat
multiplier in A1b, which its own code comment self-labels a "단순 시뮬레이션").

## 2. Current User Risk

None of the found calculators are literally "mock" in the fabricated-example-data sense (that
pattern already existed once — A3 — and was already corrected before this audit even started,
which is itself the right template). A1a/A1b/A5 are **real** calculations that compute from live
user/trade input. The risk is different and, in its own way, more subtle: convincing UI treatment
(result boxes, percentages, ✅ checklists) sitting on top of formulas that are single-flat-rate
stand-ins with no legal citation, no effective-date, and — for DSR — no resemblance to the actual
regulatory metric it's named after.

**P0/P1/P2:**
- **P1 — DSR mislabeling** (A1b): a flat `연소득 × 8` multiplier is presented under the label "DSR
  대출 가능 한도 추정." Real DSR requires existing debt, interest rate, term, and a regulatory
  ratio (40%/50%) — none of which this formula uses. The disclaimer text is present but small
  relative to the confident result box. **Not P0** because the UI already consistently hedges with
  "예상"/"추정"/"시뮬레이션" language and never claims bank approval or a confirmed loan amount —
  the task's own explicit red lines ("대출 가능 여부 확정", "실제 금융기관 승인 가능액이라고
  표현") are not crossed. Flagged as a PM decision item (§28), not unilaterally taken down this
  phase (Phase 1 is audit-only, and this is a live user-facing feature — pulling it is a call for
  the user, not something to do silently mid-audit).
- **P1 — 취득세 flat-rate formula** (A1a): directly affects "how much cash do I need," Finance
  Fit's own stated core question. Missing 지역/면적/취득유형/price-banding, and the UI offers a
  "무주택 (첫 매수)" option that the math silently ignores (falls through to the same rate as
  "1주택"). See §6 for detail.
- **P2 — LTV flat percentages** (A5): same class of oversimplification as A1a, but lower severity
  — correctly guards the zero-trade case, uses real transaction data as its base, and is already
  named accurately ("LTV") with a fuller disclaimer sentence already present.
- **P2 — 임장노트 non-functional save button** (A4): not a financial-trust issue, but a real UX
  bug worth flagging since it was found in the same file. Out of Finance Fit's scope; noted for
  awareness only.

## 3. Purchase Price

**Current, per surface:**
- Detail page: `heroTrade` (`apt-client.tsx:404`) — the most recent trade matching whatever is
  **currently selected** in the area picker + trade-type + period filters, not a fixed "latest
  overall" value. Carries both `price`/`priceStr` and `tradeDate` together.
- Compare V2: `selectPriceMetric()` (`compare-v2/metrics.ts:27-58`) — prefers a trade in the
  84–89㎡ national-standard band; falls back to the most recent trade of any area and flags
  `trust: 'LIMITED'` with an explicit area-mismatch label when no band trade exists. **This is a
  different selection rule than Detail's `heroTrade`** — the same apartment could show a different
  reference price depending on which page fed Finance Fit.

**Recommendation:** never call this "현재 매수가격." Label it "최근 실거래 기준 참고금액" (§25)
and let §8 (user-editable price) be the actual input Finance Fit computes from. Phase 2 should pick
ONE canonical selection rule (recommend reusing Compare V2's 84㎡-band-preferred rule, since it's
already the more defensible "apples to apples" choice and is freshly built/tested) rather than
inheriting Detail's filter-dependent `heroTrade`.

## 4. Acquisition Tax (취득세)

**Current formula** (`tools/page.tsx:27-28`):
```
const taxRate = houseCount === '1주택' ? 0.033 : (houseCount === '2주택' ? 0.08 : 0.12);
const taxAmount = numericPrice * taxRate;
```

**Required inputs vs. what's collected:**

| Real-world required variable | Currently collected? |
|---|---|
| 매매가 | Yes |
| 주택 수 | Partially — 4-option dropdown (무주택/1주택/2주택/3주택+) collapses to 3 effective rate buckets; "무주택" and "1주택" share the same rate |
| 지역 (규제지역 여부) | **No** |
| 면적 (85㎡ 이하 농특세 면제) | **No** |
| 취득유형 (매매/증여/상속) | **No** — 매매 assumed always |
| 가격 구간별 누진세율 (1주택은 실제로 6억 이하/6~9억/9억 초과 구간별로 1~3% 슬라이딩) | **No** — one flat rate per house-count bucket regardless of price |
| 생애최초 특례 감면 | **No** — despite the UI offering "무주택 (첫 매수)" as an option |

**Trust:** LIMITED at best for the 1주택 case (right order of magnitude, wrong precision — real
1주택 취득세 is price-banded, not flat 3.3%), UNSAFE to treat as authoritative for anyone in a
규제지역, claiming 생애최초, or trading in 증여/상속 대신 매매. **Gap:** a single flat-rate
calculation is not sufficient for Phase 2's default screen without at minimum adding price-banding
and a 생애최초 branch — implementing partial variables while ignoring others risks look-alike
precision that's actually wrong for a large share of real users.

## 5. Tax Versioning

**Current:** zero version tracking anywhere in A1a. No effective-date, no rule-version identifier,
no source/reference comment — an outlier against this codebase's own established convention
(`gap-invest-calc.ts`'s `§`-numbered audit comments, `rent-verified-range.ts`'s explicit
`RENT_VERIFIED_FROM/TO` constants, `DECISION_JOURNEY_V1_1_IDENTITY.md`'s pattern of dating every
claim). **Recommendation for Phase 2:** every tax/fee rule constant should carry `{ rate, effectiveFrom, source }` at minimum, structurally, so a future legal change has an obvious single place to update and a visible "as of" date to show users (§10 task ask). This phase does not attempt to verify current 2026 취득세 law itself — that verification is explicitly flagged as an official-source gap (§19), not assumed.

## 6. Loan

Two independent, **mutually inconsistent** loan-adjacent calculators exist:
- A1b (`/tools`): income-based, flat `연소득 × 8` — no price/property involved at all.
- A5 (`/apt/[name]`): price-based, flat 40/70/80% LTV tiers — no income/debt involved at all.

A user comparing both tools for the same purchase could receive contradictory impressions with no
way to reconcile them, since neither references the other's inputs. Neither computes a genuine
"대출 가능액" (loan amount) in the sense of what a bank would actually approve (both are explicitly
disclaimed as estimates) — this audit treats "A. 대출 가능액 추정" and "B. 원리금 상환 계산" as the
task instructs: genuinely separate concerns, and confirms **B (repayment calculation) does not
exist at all** (§14).

## 7. LTV

**Current** (`apt-client.tsx:655-657`): `Math.floor(latestPriceNum * 0.4/0.7/0.8 * 10) / 10`, keyed
only to a 3-way self-reported status label (생애최초/무주택자/1주택자), plus a static
"다주택자(규제지역): 주담대 불가" line.

**Required variables missing:** 지역 (규제지역/비규제지역 — real LTV limits differ materially by
region), 대출 목적 (구입 vs 생활안정), actual verification of 생애최초 eligibility (income/price
caps exist in reality), and current regulatory state (LTV caps have changed multiple times in
recent Korean policy history — this audit does not itself verify what the current caps are, see
§19).

**Trust:** LIMITED — real transaction-price base, correctly refuses to compute when
`latestPriceNum === 0` (follows the "don't fabricate" convention for that one case), but the three
percentages themselves are undated, uncited hardcoded literals (`git log -S"ltv80"` shows one
introducing commit, `2cf9d356`, with no provenance comment, unlike this codebase's typical
convention elsewhere).

## 8. DSR

**Current:** not implemented as DSR. `dsrLimit = numericIncome * 8` (`tools/page.tsx:30`) — a flat
income multiplier the code's own comment already calls a "단순 시뮬레이션." Real DSR needs: 연소득,
기존 부채의 연간 원리금상환액 (existing debt service, all loans summed), 신규 대출의 금리·만기·
상환방식, and the regulatory DSR ratio itself (40% or 50%) — the "40%" only appears in the
disclaimer sentence, never actually used in the formula. **Trust: UNSAFE if displayed under the
label "DSR"** — this is the audit's clearest recommendation for immediate relabeling regardless of
whether the underlying calculation methodology is upgraded later (§28).

## 9. Monthly Payment (월 상환액)

**Not found anywhere in the repo.** No 원리금균등(equal installment)/원금균등(equal principal)/
만기일시(bullet) formula exists — confirmed by both agents independently, no `Math.pow`-based
compounding logic anywhere in `src/`. This is the single largest concrete gap relative to Finance
Fit's stated core question ("매달 어느 정도 부담하는가") — Phase 2 must build this from scratch; it
is, however, the most purely deterministic of all the candidate metrics (no legal/regulatory
ambiguity, just amortization math), making it the best SAFE-classification candidate for Phase 2
(§15).

## 10. Brokerage (중개보수)

**Not found anywhere in the repo.** No 법정 상한요율 table, no price-band structure, no 매매 vs
전세/월세 distinction. Real Korean 중개보수 has a legally-capped **upper bound** by price band
(a 상한요율, not a fixed fee) that varies by 매매 vs 임대차 — the actual fee paid is negotiated
within that cap, never a single determined number. Any Phase 2 implementation must show the legal
**ceiling**, explicitly labeled as a maximum, never as "중개보수 = 확정금액" (per this task's own
explicit prohibition).

## 11. Required Cash

**Current:** no formula found anywhere combining 매매가 - 대출 + 부대비용 into a single "필요
자기자금" figure. This is a genuinely new calculation for Phase 2, not an extension of anything
existing. Recommended formula structure (§19 task's own framing, confirmed sound):
`매수가격 − 예상 대출금 + 검증된 부대비용(취득세 + 중개보수 상한 + 기타) = 예상 필요 자기자금` —
critically, **only include cost components this app can compute with a documented, bounded trust
level** (§4/§10); 등기/법무사 보수/인지세/채권매입 등은 이번 phase에서 신뢰 있게 계산할 수 없으므로
추정치로 끼워 넣지 않는다(과소평가된 "필요자금"이 과대평가보다 더 위험함 — 사용자가 실제보다 적은
돈이 필요하다고 믿게 됨).

## 12. Stress Test (금리 변화)

Not implemented anywhere, but purely deterministic once monthly-payment math exists (§9) — no new
legal/regulatory risk, just re-running the same amortization formula at +1%p/+2%p. Good Phase 2
candidate precisely because it inherits whatever confidence level the base monthly-payment
calculation earns, without adding any new trust risk of its own.

## 13. Detail/Compare Integration

**Detail page** (confirmed via agent): `canonicalAptSeq` (via `deriveCanonicalAptSeq`, unchanged
since `DECISION_JOURNEY_V1.1`), `displayName` (canonical MOLIT name, distinct from the raw
search-string `aptName`), and `heroTrade` (carrying both `price`/`priceStr` and `tradeDate`
together) are all in scope and could be handed to a future Finance Fit entry point. No existing
"필요 자금"/"취득세"/loan-estimate computation exists on this page beyond the A5 LTV modal already
audited above.

**Compare V2:** `CompareApartment.identity` (`ComparableIdentity`, aptSeq-first) plus the
`salePrice` metric (which already carries `period.from`/`to` and `area.exclusiveAreaM2`, not just a
formatted display string) are both directly reusable. `CompareV2.tsx`'s existing `nextActions`
section (two "상세보기" buttons, one per compared apartment, built via `buildDetailHref()`) is the
realistic slot where a future "Finance Fit" button per apartment would sit — confirmed to already
exist and already follow exactly this identity-passing pattern, so no new plumbing pattern needs to
be invented.

**Established URL convention** (confirmed unchanged): `lawdCd` + `dong` + `name`(display) +
optional `aptSeq`, with per-slot prefixes (`a*`/`b*`) only when a URL must carry two apartments at
once (Compare). A future `/tools/finance-fit?aptSeq=&lawdCd=&dong=&name=&referencePrice=&referenceTradeDate=`
contract fits this pattern directly — no new convention needed.

**`/tools` page today:** a 4-tab client component with zero apartment-identity wiring anywhere —
no `aptSeq`/`lawdCd`/`dong` query-param reading, no import of `deriveCanonicalAptSeq` or any trade
data. A Finance Fit entry point here would need identity-awareness built from scratch, not extended
from existing state — this argues for Finance Fit being a genuinely new route (§22) rather than a
retrofit of the existing `calc` tab.

## 14. Trust Matrix

| Metric | Class | Why |
|---|---|---|
| 최근 실거래가 (reference price) | **SAFE** (with area/period explicit) | Real MOLIT data, already the trust level established by Compare V2's own price metric |
| 취득세 | **LIMITED** | Real formula, but missing region/area/acquisition-type/price-banding — usable only with explicit assumption disclosure per §28/§29 |
| 브로커리지 상한 | **NOT_IMPLEMENTED** | No formula exists at all today |
| LTV | **LIMITED** | Real price base, flat undated percentages, no regional branching |
| DSR | **UNSAFE as currently labeled** | Not actually DSR math; mislabeling risk, not just imprecision |
| 월 상환액 (monthly payment) | **NOT_IMPLEMENTED** (best SAFE candidate for Phase 2) | Purely deterministic once built — no legal ambiguity |
| 스트레스 테스트 (금리 변화) | **NOT_IMPLEMENTED** (inherits monthly-payment's trust level) | Same math, different rate input |
| 필요 자기자금 (required cash) | **NOT_IMPLEMENTED** | New composite calculation; trust ceiling = the weakest input it includes |
| 등기/법무/인지/채권 등 | **UNSAFE to estimate** | No reliable source in this repo; must stay excluded, not approximated |

## 15. Data Contract (proposal, not implemented this phase)

```ts
// src/lib/finance-fit/types.ts (proposed)
import type { ComparableIdentity } from '@/lib/compare-v2/types'; // reuse, don't reinvent

type ResultConfidence = 'CALCULATED' | 'ESTIMATED' | 'USER_INPUT' | 'LIMITED' | 'UNAVAILABLE';

interface FinanceFitInput {
  identity: ComparableIdentity | null;       // null when entered with no apartment context
  referencePrice: number | null;             // from heroTrade/salePrice metric — display only
  referenceTradeDate: string | null;
  purchasePrice: number;                     // user-editable; defaults to referencePrice when present (§8)
  availableCash: number | null;               // user input, never persisted (§38)
  housingCount: '무주택' | '1주택' | '2주택' | '3주택이상';
  exclusiveAreaM2: number | null;             // needed for the 85㎡ 취득세 exemption check
  regionRegulated: boolean | 'UNKNOWN';       // this repo cannot reliably determine this today — must default to 'UNKNOWN', never guessed
  loanAmount: number | null;                  // user input or a LIMITED-confidence LTV suggestion
  interestRate: number;                       // always user-entered this phase — no external rate source (§16)
  loanYears: number;
  repaymentMethod: '원리금균등' | '원금균등' | '만기일시';
}

interface FinanceFitResultField<T> {
  value: T | null;
  confidence: ResultConfidence;
  assumptions?: string[];
}

interface FinanceFitResult {
  acquisitionTax: FinanceFitResultField<number>;
  brokerageFeeCap: FinanceFitResultField<number>;   // legal ceiling, never a "확정" fee
  monthlyPayment: FinanceFitResultField<number>;
  loanEstimate: FinanceFitResultField<number>;       // LIMITED — never "승인 가능액"
  requiredCash: FinanceFitResultField<number>;
  stressTest: { deltaPct: number; monthlyPayment: number }[];
  warnings: string[];       // e.g. "규제지역 여부를 확인할 수 없어 LTV는 참고용입니다."
  ruleVersions: { key: string; effectiveFrom: string; source: string }[];  // §10 tax-versioning
}
```

Matches the existing `decision-journey`/`compare-v2` convention (small typed objects, explicit
trust/confidence field, no silent estimation) rather than inventing a new style.

## 16. Edge Cases (Phase 2 test-oracle design)

Minimum boundary set, per metric:

- **Monthly payment:** 0원 loan (→ 0, not error), negative input (→ rejected, not computed),
  loanAmount > purchasePrice (→ warning, not silently computed as if valid), 0% interest rate
  (→ simple division, not divide-by-zero crash), very high rate (e.g. 20%+, still computes, flagged
  as unusual), 1-year term, 40-year term, 100%-financed input (edge of LTV concept).
- **Acquisition tax:** 0원 price (→ 0, not skipped/undefined), extremely high price (no overflow),
  extremely low price (still bands correctly).
- **Required cash:** availableCash = 0 (→ shows full amount needed, not an error), availableCash
  fully covers requiredCash (→ shows "여유," never "구매 가능" per §20's explicit ban on
  possible/impossible verdicts).
- **Identity:** no `aptSeq` available (composite fallback, same as Compare V2/Decision Journey),
  entering Finance Fit with zero apartment context at all (fully manual entry must still work).

Each of these should become a literal unit-test case in Phase 2, following the exact pattern
already established in `src/lib/compare-v2/*.test.ts` (pure functions, `node:test`, no framework
dependency).

## 17. Privacy

Task's own explicit default (client-side-first, no DB persistence, no analytics of amounts) is
directly compatible with everything found in this audit — no existing calculator in this repo
persists financial input anywhere (A1a/A1b/A5 are all pure in-memory React state, no `fetch` POST,
no localStorage). Phase 2 should preserve this: **no server round-trip needed for any of the
proposed calculations** (all are pure math over already-available or user-entered numbers), no
income/cash/loan figures in analytics event payloads (only event names like `finance_fit_calculate`
with no amount field, matching the existing `TrackEventContext` shape's `aptName`-only convention
already used by `next_action_click`/`compare_*` events).

## 18. Mobile UX

Not build-tested this phase (audit only), but the task's own progressive-disclosure recommendation
is well-supported by precedent already in this codebase — `NextActionSection`/`CompareV2`'s section-
panel pattern (`docs/development/DECISION_JOURNEY_V1.md`, `COMPARE_V2_PHASE2_IMPLEMENTATION.md`)
already established a proven mobile-safe pattern of stacked, titled panels rather than one long
form. Recommend the same structure for Finance Fit's Phase 2 UI (§34's own proposed section order
is compatible with this).

## 19. Existing Tool Migration

**Recommendation: absorb, don't leave two parallel calculators.** A1a (취득세) and A5 (LTV) should
be superseded by Finance Fit's versions once built, not left running side-by-side with different
formulas for the same concept — precisely the "같은 계산기가 서로 다른 공식으로 존재하지 않도록
한다" risk the task warns about, already partially realized today between A1b and A5's inconsistent
loan-limit framings (§6). A1b (mislabeled DSR) should be **relabeled or removed** independent of
whether/when the rest of Finance Fit ships — this is flagged as a possible near-term hygiene fix,
not gated on Phase 2's full build (see §28's PM decision list). A2 (안전계약 체크)/A4 (임장노트) are
unrelated to Finance Fit and out of this audit's scope, though A4's non-functional save button is
worth a separate, small bug-fix ticket.

## 20. Official Source Gaps

Explicitly flagged as **unverifiable from this repo alone** — not guessed, not assumed correct:
- Current (2026) 취득세 정확한 세율표 (구간별 누진, 규제지역 중과 여부, 생애최초 감면 기준 및 한도).
- Current LTV 규제 한도 by region/생애최초 status.
- Current 중개보수 법정 상한요율표 by price band and transaction type.
- Whether any specific lawdCd/지역 in this app's coverage is currently a 규제지역 — this repo has
  no such dataset today (confirmed: no "규제지역" field found anywhere in `ApartmentMaster` or
  related schema during this audit).

Phase 2 implementation must source these from an authoritative reference **before** shipping any
SAFE-classified tax/LTV/brokerage number — this audit does not itself certify current legal
accuracy, and per the task's own STOP condition #5, if this verification cannot be completed with
confidence, the affected metric should ship LIMITED/UNAVAILABLE rather than guessed SAFE.

## 21. Database

READ only this STEP (code/schema inspection only, no queries against live data were needed — the
existing calculators are all pure client-side arithmetic with no DB dependency). WRITE: 0.
Schema: 0. Migration: 0.
