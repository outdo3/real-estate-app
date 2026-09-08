# MOLIT PARTIAL TRUST V2 — 파생 지표/비교 화면까지 부분 실패 계약 확장

작업일: 2026-09-08
시작 HEAD: `bb8e6c3` (feat(map): make apartment and officetel independent layer toggles)

## 목적

`APT_DETAIL_MOLIT_PARTIAL_FAILURE_TRUST_FIX`에서 `/api/apt/[name]`은 이미
`partial / failedMonths / monthsRequested / monthsSucceeded`를 정직하게 내려주고 있었고,
거래 목록과 `PriceTrendChart`는 그 상태를 화면에 반영하고 있었다.

문제는 **그 응답을 받아 값을 계산하는 나머지 소비자들**이었다. 이들은 `data.trades`만
읽고 완전성 필드를 통째로 버렸다. 그래서 한 달만 실패해도:

- 전세가율/갭이 빠진 달을 반영하지 않은 채 확정 수치처럼 표시되고,
- 두 단지 비교에서 한쪽만 불완전한 데이터가 완전한 데이터와 나란히 놓이고,
- 조회 실패가 "데이터 부족"/"최근 거래 없음"이라는 **무거래 표현**으로 둔갑했다.

`FAILED != ZERO`를 원본 라우트에서 끝내지 않고 사용자 눈에 보이는 마지막 지점까지
밀어 넣는 것이 이 STEP의 범위다.

## 현재 상태 (변경 전)

`/api/apt/[name]` 거래 응답 소비자 전수 조사 결과:

| # | 소비자 | 계산하는 값 | 완전성 반영 |
|---|--------|-------------|-------------|
| 1 | `apt/[name]/apt-client.tsx` | Hero 가격, 거래 목록, 평형 라벨 | O (기존) |
| 2 | `components/PriceTrendChart.tsx` | 월별 평균 추이 | O (기존) |
| 3 | `components/InvestmentMetrics.tsx` | 매매가/전세가/전세가율/갭 | **X** |
| 4 | `app/stats/[type]/type-client.tsx` (multi-compare) | 최대 5단지 시세선 비교 | **X** |
| 5 | `lib/compare-v2/fetch.ts` (`/stats/compare`) | 최근 실거래가 비교/차이 문장 | **X** |
| 6 | `lib/ai-search.ts` `fetchCompareTarget` | 비교 브리핑 입력(가격/거래건수) | **X** |
| 7 | `api/stats/large-complex` + `LargeComplexView` | 단지별 "최근 매매" | **X** |

추가로 `/api/stats/supply`는 Presale DB만 쓰므로 MOLIT 완전성과 무관하다(해당 없음).

## 설계 결정

### 1. 완전성 계약은 하나만 둔다 (§6)

각 화면이 제 나름의 완전성 판정을 만들면 "완전함"의 뜻이 화면마다 갈라진다. 이미
존재하던 `lib/trade-read-state.ts`의 `resolveTradeReadState()`를 **유일한 계약**으로
삼고, 빠져 있던 메타데이터만 추가로 실어 나른다.

```
TradeReadState = {
  trades, apiError, partial, incompleteMessage,   // 기존 — 의미/값 불변
  failedMonths, monthsRequested, monthsSucceeded  // 추가
}
```

메타데이터가 없는 예전 응답은 `[] / 0 / 0`으로 채우되, **신뢰 판정 자체는 기존
`partial`/`apiError`만으로 내린다** — 0을 "완전함"으로 오해하지 않기 위해서다.

### 2. 지표를 두 종류로 나눈다 (§3)

불완전성의 영향은 지표마다 다르다. 하나의 규칙으로 뭉뚱그리면 과잉 억제(실제로 일어난
거래까지 숨김)나 과소 억제(틀릴 수 있는 계산값 노출) 중 하나가 된다.

- **관측 사실** (매매가, 전세가, 최근 실거래가): 빠진 달이 있어도 "이 가격에 실제로
  거래됐다"는 참이다. 흔들리는 건 "가장 최근"이라는 단정뿐 → `QUALIFIED`
  (값 유지 + 단서).
- **결합 계산값** (전세가율 = 전세/매매, 갭 = 매매−전세): 어느 한쪽에서 한 달만
  빠져도 값 자체가 달라진다 → `SUPPRESSED` (숫자를 만들지 않음).

판정 함수는 `resolveObservedMetricTrust()` / `resolveDerivedMetricTrust()` 두 개이며
`trade-read-state.ts`에만 있다.

### 3. 단일 계열 지표는 자기 계열만 본다 (§5)

전월세 조회가 실패했다고 매매가까지 가릴 이유는 없다. 관측값은 자기 원천의 완전성만,
결합 계산값은 두 원천 모두를 본다. 이것이 혼합 원천 매트릭스(§5) 6조합의 근거다.

### 4. 비교는 없애지 않고 표시한다 (§4/§12)

한쪽만 불완전할 때 비교를 통째로 숨기면 사용자가 얻을 수 있는 정보까지 사라진다.
선/값은 유지하되 **어느 쪽이 불완전한지 반드시 밝힌다.** 점선 같은 새 시각 문법은
만들지 않았다(§12 지시) — 기존 텍스트 라벨과 기존 `partialBanner` 배색만 확장했다.

CompareV2는 이미 `MetricTrust(SAFE/LIMITED/UNSAFE/MISSING)` 체계와, `MISSING`이면
비교 불가로 접는 `difference.ts`를 갖고 있었다. 새 상태를 만들지 않고 그 위에 얹었다.

### 5. 실패한 0건으로 identity를 다시 풀지 않는다 (§2/§9)

`ai-search`의 `runCompare`는 B단지 거래가 0건이면 **지역 제약을 풀고 이름만으로 다시
검색**했다. 조회 실패로 0건이 된 경우까지 그러면 스로틀링 한 번에 동명의 타 지역 단지가
비교 대상으로 바뀔 수 있다(AGENTS.md "이름만으로 재식별 금지"). 재검색 조건에
"검증된 0건일 것"을 추가했다.

## 구현 내용

### 신뢰 계약

- `lib/trade-read-state.ts`
  - `TradeReadPayload`/`TradeReadState`에 `failedMonths`/`monthsRequested`/`monthsSucceeded` 추가
  - `TRADE_DERIVED_SUPPRESSED_MESSAGE` 추가 ("일부 기간의 데이터가 없어 현재 계산할 수 없습니다.")
  - `isAnySourceIncomplete()` / `resolveDerivedMetricTrust()` / `resolveObservedMetricTrust()` 추가
  - 기존 4개 필드의 값·의미는 한 글자도 바뀌지 않았다.

### InvestmentMetrics

- 실패(`!res.ok`/throw)를 빈 배열로 뭉개던 fetch를 `resolveTradeReadState`로 교체.
  이전에는 API 실패가 "데이터 부족"(=진짜 무거래)과 구분되지 않았다.
- 매매가/전세가: 값 + `일부 기간 미반영` 단서.
- 전세가율/갭: 억제 문구로 대체.
- 카드 아래 안내 배너 1개만 노출(카드마다 긴 문장을 반복하지 않는다 — §13 중복 금지).

### /stats/[type]

- `CompareView`(multi-compare): 계열별 불완전 여부 추적, 상단 안내 배너 + 범례
  `(일부 기간 미반영)` 표시.
- `LargeComplexView` + `api/stats/large-complex`: 라우트가 월별 `failed`를 세어
  `partial`/`failedDistricts`를 응답에 싣고, 화면은 기존 `partialBanner` 패턴으로 표시.
  경고 범위를 "최근 매매 칸"으로 한정한다 — 순위/세대수는 DB 기반이라 완전하다.

### CompareV2 (/stats/compare)

- `selectPriceMetric(trades, sourceIncomplete)`:
  불완전+거래있음 → `LIMITED`, 불완전+거래없음 → `MISSING`이되 **"최근 거래 없음"이라고
  말하지 않는다.**
- `CompareMetric.sourceIncomplete` optional 필드 추가(면적 불일치로 인한 LIMITED와
  구분하기 위함).
- `difference.ts`: 어느 쪽이 불완전한지 밝히는 주의 문구를 기존 거래일 차이 경고와
  함께 노출.

### ai-search

- `CompareComplexData.tradesIncomplete` 추가.
- 브리핑 요약 입력에 불완전 표시(기존 `regional_stats` partial 처리와 같은 규칙).
- `runCompare`의 이름 재검색을 "검증된 0건"으로만 제한.

### 보안 (§1/§17)

정밀 감사 결과 **실제 유출 경로 1건**을 발견해 수정했다.

- `app/api/ledger/route.ts`: `return NextResponse.json({ error: error.message })`.
  이 라우트의 `apiUrl`에는 `serviceKey`가 들어 있고, fetch/JSON 파싱 실패 메시지에는
  그 URL이 통째로 담길 수 있어 **인증키가 클라이언트 응답으로 나갈 수 있었다**
  (api-molit.ts에서 이미 막아둔 것과 정확히 같은 경로가 남아 있었다).
  → 응답에는 고정 문구만, 로그는 공유 마스킹 함수 경유.
- `lib/molit-month-cache.ts`: catch의 `console.warn`이 원본 예외 메시지를 그대로 찍던
  마지막 비마스킹 경로 → 마스킹 적용.
- `lib/apt-building-info.ts`: `console.warn(..., e)`로 원본 오류 객체를 통째로 기록 →
  오류 종류만 기록. (이 모듈은 순수 파서 단위 테스트를 그대로 돌리기 위해 의도적으로
  의존성이 없어야 해서, 마스킹 함수를 import하는 대신 원본 메시지를 아예 쓰지 않는
  방식을 택했다.)

## 테스트 결과

실제 실행한 명령과 실제 결과만 기록한다.

```
node --test --experimental-strip-types "src/lib/*.test.mjs"
  → tests 289 / pass 288 / fail 1
```

유일한 실패는 `trade-history-read.test.mjs`이며 원인은
`Cannot find module '.../src/lib/prisma'` — 이 러너가 `@/` 별칭/확장자 없는 상대
import를 해석하지 못하는 **기존 인프라 이슈**다. 이 STEP에서 그 파일들을 건드리지
않았고, 수정 전 HEAD에서도 동일하게 실패한다(확인함).

같은 이유로 `src/lib/*.test.ts` 파일들(`apt-trade-completeness.test.ts`,
`molit-month-cache.test.ts`, `compare-v2/*.test.ts`)도 로컬에서 실행되지 않는다 —
이 역시 기존 상태이며 이번 변경과 무관하다. 그래서 이번에 추가한 회귀 테스트는
**실제로 실행되는 `.mjs` + 명시적 확장자 import** 관례를 따랐다.

추가한 테스트:

- `lib/trade-read-state.test.mjs` — 완전성 메타데이터 전달, 혼합 원천 매트릭스 A~F,
  전체 실패, 로딩 vs 실패 구분, 회복, 문구 규칙 (22/22 PASS)
- `lib/molit-credential-safety.test.mjs` — 마스킹 계약 4종 + 키가 든 URL을 만드는
  파일들의 소스 수준 가드 (8/8 PASS)
- `lib/compare-price-completeness.test.mjs` — 비교 가격 지표 완전성 분기 5종 +
  구현 가드 7종 (12/12 PASS)
- `lib/api-molit.test.mjs` — 인코딩 키 조각, 파싱 실패, 상대 URL, 다중 등장,
  외부 지정 가능한 `type`의 전수 확인 (기존 포함 25/25 PASS)

검증:

```
npx tsc --noEmit  → src 신규 오류 0 (저장소 전체 24건은 FAIL_EXISTING_SCRIPT_ERRORS:
                    scripts/ 20, tmp/ 4 — 기존과 동일)
npx eslint src    → 0 errors, 5 warnings (전부 기존 unused eslint-disable)
npm run build     → 성공
```

로컬 실측(dev, Production 키 사용):

| 케이스 | 결과 |
|---|---|
| 완전(매매) 대신푸르지오2차 60개월 | `partial=false ok=60/60 trades=237` |
| 완전(전월세) 동일 단지 60개월 | `partial=false ok=60/60 trades=446` |
| 검증된 0건 (dong 필터로 매칭 0) | `partial=false ok=60/60 trades=0` — 부분 경고 없음 |
| 전체 실패 (`type=bogus`, 외부 지정 가능) | `ok=0/6 apiError` + **응답에 serviceKey/URL 없음** |
| large-complex 부산 | `status=OK partial=false failedDistricts=[]` |

`/` `/map` `/stats` `/stats/multi-compare` `/stats/compare` `/stats/large-complex`
`/apt/대신푸르지오2차` `/officetel/2413` 전부 200.

## 알려진 문제 / 한계

- **자연 발생 partial을 QA 시점에 재현하지 못했다.** 이 세션 초반에 실제로 관측된 적은
  있으나(36개월 중 202312 1개월이 초당 제한으로 실패), QA 시점에는 MOLIT가 정상이라
  60/60이 계속 성공했다. §16 "MOLIT를 의도적으로 두들기지 말 것"에 따라 인위적으로
  실패를 유발하지 않았다. partial 경로의 보장은 단위 테스트(매트릭스 A~F)와 소스 가드로
  결정적으로 고정했다.
- **시각 QA(360/375/390px)를 브라우저로 수행하지 못했다.** 이 환경에 브라우저 자동화가
  없다. 레이아웃은 코드 수준 검토만 했다 — 상세는 CHANGELOG 검증 항목 참고.
- `.ts` 단위 테스트가 로컬에서 실행되지 않는 기존 인프라 이슈는 이 STEP 범위 밖이라
  손대지 않았다.

## 상태 요약

READY:

- 거래 목록 완전성 (기존)
- 추이 차트 완전성 (기존)
- **파생 지표 완전성** (전세가율/갭 억제, 매매가/전세가 단서)
- **비교 화면 완전성** (CompareV2, multi-compare, large-complex, ai-search 비교)
- **인증키 마스킹** (응답/로그 유출 경로 3건 차단)

LIMITED:

- 원천 데이터 가용성 그 자체 (MOLIT에 없는 달은 여전히 없다)
- MOLIT 일시적 타임아웃/초당 제한의 신뢰도

DEFERRED (이 STEP에서 의도적으로 건드리지 않음):

- 동시성 튜닝
- 타임아웃 튜닝
- stale-if-error
- 전역 분산 로그 억제

## 다음 STEP 후보

1. 실제 partial 상황에서의 시각 회귀 확인(브라우저 QA 가능해지면).
2. `.ts` 단위 테스트 러너 정비 — 지금은 완전성/식별자 관련 핵심 테스트 상당수가
   작성돼 있으나 로컬에서 실행되지 않는다.
