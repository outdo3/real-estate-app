# FINANCE FIT V1 — PHASE 2A IMPLEMENTATION

**Date:** 2026-09-02
**Baseline:** `main` @ `4e7f99b` (follows `FINANCE_TOOLS_TRUST_PATCH.md` / `FINANCE_FIT_V1_PHASE1_AUDIT.md`)
**Scope:** 월상환액 + 필요자기자금 + 중개보수상한 + 금리 스트레스테스트, client-side only,
no DB writes. Acquisition tax / LTV / DSR / loan-approval judgment explicitly out of scope
(Phase 1's own recommendation — those need official-source verification first).

---

## 1. Architecture

New route `/finance-fit` (`src/app/finance-fit/page.tsx` + `finance-fit-client.tsx`, `'use client'`,
`useSearchParams` inside a `Suspense` boundary — the same pattern already used by
`/stats/[type]`). Zero API calls: all data either arrives via URL query params (identity +
public reference price, handed off by Detail/Compare) or is typed directly by the user. All
math is pure functions in `src/lib/finance-fit/`:

- `types.ts` — `FinanceFitInputs`/`FinanceFitResult` contract, `ResultConfidence`, rule version metadata.
- `amortization.ts` — 원리금균등 monthly payment formula.
- `brokerage.ts` — 중개보수 법정 상한 band table + lookup.
- `calculate.ts` — orchestrates the above into one `FinanceFitResult` (required cash, cash gap, stress test).
- `validation.ts` — input validation, boundary rules.
- `format.ts` — Korean money display (억/만원, no fake precision).
- `url.ts` — `buildFinanceFitUrl`/`parseFinanceFitUrl` (identity + public reference price only).

38 unit tests (`node:test`) cover amortization, brokerage boundaries, required-cash/cash-gap
edge cases, and URL round-tripping — all passing, plus the existing 21 compare-v2 tests
re-run alongside to confirm no cross-module regression (59/59 pass total).

## 2. Inputs

`purchasePrice` (원), `availableCash` (원, optional — `null` means "not entered," distinct from
`0`), `loanAmount` (원), `interestRatePercent` (연 %, always user-entered — no external rate
source this phase), `loanYears`. Repayment method is fixed to 원리금균등 — no picker is shown
since no other method is implemented (spec §4's explicit ban on exposing unsupported methods).

## 3. Reference Price

Detail and Compare V2 both pass identity + a public reference price/date via URL
(`buildDetailFinanceFitUrl` in `src/lib/decision-journey/registry.ts`, and
`buildFinanceFitHref` inside `CompareV2.tsx`) — reusing Compare V2's own price-selection
policy: Detail hands off `heroTrade.price`, Compare hands off the same `salePrice` metric
(84㎡-band-preferred, falls back to most recent) that already powers the Compare UI. Never
labeled "현재 매수가" — always "최근 실거래 기준 참고금액," with the trade date shown alongside.
The reference price only pre-fills the 매수가 field; the user can freely overwrite it
(§6 requirement) — editing it does not change the URL.

## 4. Monthly Payment

Standard 원리금균등 amortization: `P × r × (1+r)^n / ((1+r)^n − 1)`, `r` = monthly rate,
`n` = months. 0% rate is special-cased to `P / n` (avoids division by zero). Verified against
a hand-computed reference in a unit test (3% / 30yr), plus 0%/5%/15%/1yr/40yr edge cases — all
finite, all positive, all correct. Only 원리금균등 is implemented; 원금균등/만기일시 are not
exposed anywhere in the UI.

## 5. Required Cash

`매수가 − 예상 대출액 + 중개보수 상한 = 예상 필요 자기자금`. 취득세와 등기/법무/인지/채권 등은
Phase 2A 계산에 포함하지 않으며, 결과 바로 아래 "취득세 및 등기·법무 등 기타 부대비용은
별도입니다"를 항상 표시한다. 준비자금을 입력하면 `requiredCash − availableCash`의 절대값과
방향(SHORT/SURPLUS)만 보여준다 — "구매 가능/불가능" 판정 문구는 코드 어디에도 없다(문구:
"현재 입력 기준 약 ○○원이 추가로 필요합니다" / "...의 여유가 있습니다").

## 6. Brokerage Ceiling

`src/lib/finance-fit/brokerage.ts`의 6개 구간 테이블은 이 STEP의 사용자 작업 지시(§11)에서
직접 제공된 공인중개사법 시행규칙 별표 1 기준값을 그대로 반영했다 — Phase 1 감사에서 "공식
외부 근거 확인 필요"로 남겨졌던 항목이 이번 STEP에서 사용자가 정확한 표를 제공해 해소됨.
10개 경계값(49,999,999원 ~ 1,500,000,000원)을 전수 단위 테스트로 검증했다. 상한액이 있는
구간(5천만원 미만/5천만원~2억원)은 `min(요율×가격, 상한액)`, 그 이상 구간은 요율만 적용.
UI 라벨은 항상 "중개보수 법정 상한"이며, "실제 금액은 상한 내에서 협의됩니다. 확정 금액이
아닙니다" 고지를 결과 바로 아래 항상 표시한다.

## 7. Rule Version

`types.ts`의 `BROKERAGE_RULE_VERSION = { source: '공인중개사법 시행규칙 별표 1 (주택 매매
기준)', referenceDate: '2026-09-02' }` — 계산 로직(`brokerage.ts`)과 완전히 분리돼 있어, 향후
법령 개정 시 이 두 값만 교체하면 된다. Assumptions 패널에 항상 노출된다.

## 8. Stress Test

기준 금리, +1%p, +2%p 세 시나리오의 월상환액을 모두 계산해 보여주며, +1/+2 시나리오는
기준 대비 월 증가액(`월 +○만원`)도 함께 표시한다. 대출액/기간은 기준과 동일하게 고정.

## 9. Privacy

전체 계산이 클라이언트에서 즉시 실행되며(§31 확인: live 네트워크 로그상 이 페이지 자체가
발생시키는 아파트 데이터 API 호출은 0건 — 사이트 공통 세션/하트비트/analytics 호출만 존재),
DB write 0건. `trackEvent`의 `TrackEventContext`가 애초에 `complexId`/`aptName`만 지원하는
구조라 금액/금리 필드를 실수로 함께 보낼 수 있는 경로 자체가 없다. URL에는 identity(name/
lawdCd/dong/aptSeq)와 공개 참고가격(refPrice/refDate)만 있고, `availableCash`/`loanAmount`
등 사용자의 실제 재무 입력은 client state에만 존재하며 새로고침 시 사라진다(자동 persistence
없음, localStorage 미사용 — 코드에 전혀 없음).

## 10. Detail Integration

`src/app/apt/[name]/apt-client.tsx`의 `nextActions` 배열에 기존에 예약만 돼 있던
`NextActionType`의 `'BUDGET'` 항목(Decision Journey V1 때부터 미사용 상태로 남아있던 타입)을
처음으로 실제로 연결했다 — "이 집 자금 계획 세우기" 버튼, `canonicalAptSeq`(이미 검증된
Decision Journey V1.1의 identity)와 `heroTrade.price`/`tradeDate`를 그대로 넘긴다. 잘못된
identity로 연결될 가능성 없음 — 이미 그 페이지에서 검증을 마친 동일한 `canonicalAptSeq`를
재사용할 뿐, 별도의 name 재검색을 하지 않는다.

## 11. Compare Integration

`CompareV2.tsx`의 `nextActions` 영역을 두 단지 컬럼으로 나눠, 각 컬럼에 "상세보기" + "자금
계산" 버튼을 세로로 묶었다(`.nextActionGroup`). `buildFinanceFitHref()`가 각 `CompareApartment`의
`identity`(aptSeq-first)와 `salePrice` metric의 value/period를 사용 — 실측으로 동명(롯데캐슬
2개 구) 단지를 비교한 뒤 우측 카드의 "자금 계산"을 클릭해 lawdCd=26440/dong=명지동/
aptSeq=26440-16/refPrice=322000000이 정확히 그 카드 자체의 값과 일치하게 넘어가는지 확인함
— 교차오염 없음.

## 12. Mobile

390px/360px 실측(dev 서버, 실제 부산 단지 데이터) — 입력 폼, 결과 카드, 스트레스 테스트,
assumptions/exclusions 패널 모두 overflow 없이 렌더링됨. 375px 독립 확인은 생략 —
`resize_window` 도구가 이 환경에서 실제 CSS viewport를 안정적으로 축소하지 못하는 기존
한계(`FINANCE_TOOLS_TRUST_PATCH.md` §7에서도 동일하게 기록됨)로, 400px 이하 전용 CSS 변경
(금리/기간 2열→1열)도 이번 실측으로는 독립 검증하지 못했다 — 구조상 안전한 표준 미디어
쿼리이므로 대표성으로 간주.

## 13. Tests

`src/lib/finance-fit/*.test.ts` 38개(amortization 7, brokerage 9, calculate 8, url 4,
validation 11) 전부 통과. 경계값 전수(중개보수 10개 가격 구간 경계), edge case(0원/음수/
대출초과/현금0/현금충분/1년/40년/고금리) 모두 포함.

## 14. Limitations

- 취득세/LTV/DSR 정식 계산은 이번 Phase에 없음 — 여전히 `/tools`, apt-detail LTV 모달의
  간편 추정(Trust Patch로 라벨링 정리됨)만 존재.
- 대출 승인 가능 여부, 금융상품 추천 없음.
- 등기/법무/인지/채권 등 부대비용은 추정하지 않고 "별도"로만 표시.
- 375px 독립 mobile 실측 생략(§12).
- 브로커리지 표는 사용자가 이번 작업 지시에서 직접 제공한 값을 그대로 반영한 것으로, Claude가
  별도로 법령 원문을 대조 검증하지는 않았다 — 실제 시행 시점에 공식 소스로 재확인 권장.

## 15. Deferred Phase 2B

취득세 정식 계산(지역/면적/취득유형/생애최초/가격 구간 누진), LTV 정식 계산(지역/규제/
생애최초), DSR 정식 계산, 원금균등/만기일시 상환방식, Finance Fit 결과의 총 초기 필요자금에
등기/법무 비용 포함(신뢰 가능한 소스 확보 시), 375px 실측(다른 도구 확보 시).
