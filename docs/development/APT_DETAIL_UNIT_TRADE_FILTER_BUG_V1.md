# APT DETAIL — UNIT / TRADE FILTER BUG V1 (P0 DATA TRUST)

> **Production write 없음 / schema 변경 없음 / migration 없음.**
> 재현 단지: 대신롯데캐슬 (`aptSeq 26140-1164`)

## 1. 증상 (Production 재현)

상세페이지에서 평형 칩을 눌러도 **거래 데이터가 전혀 바뀌지 않았다.**

- 50평 칩이 시각적으로만 활성화됨
- 최근 실거래가는 계속 84.79㎡의 3.87억
- 타임라인 헤더는 계속 `전용 84.79㎡ · 총 8건`

사용자가 A 평형을 선택했는데 **B 평형의 거래를 A의 것처럼** 보게 되는 상태 — P0
데이터 신뢰 버그다.

## 2. 근본 원인 — 같은 면적, 두 개의 문자열 도메인

상세페이지에는 같은 전용면적이 서로 다른 문자열로 존재한다:

| 출처 | 값 | 생성 위치 |
|---|---|---|
| Unit Master `canonicalExclusiveArea` | `"129.7178"` | `apartment_unit_types` (bare Decimal 문자열) |
| 실거래 `trade.area` | `"129.7178m²"` | `api-molit.ts:217` — `` `${areaVal}m²` `` |

`AreaSelector`는 Unit Master가 있으면 칩 값을 **canonical**에서 뽑고
(`AreaSelector.tsx:38-40`), 없으면 raw `trade.area`에서 뽑는다.
모든 거래 필터는 **문자열 `===`** 로 raw `trade.area`와 비교했다.

→ Unit Master가 있는 단지에서는 칩 값이 어떤 거래와도 일치할 수 없었다.

### 2.1 이전 조치가 남긴 것 (DETAIL_TRADE_AREA_STATE_SPLIT_V1)

이 mismatch는 이미 한 번 발견됐고, 그때는 **상태를 둘로 쪼개는** 방식으로 대응했다:

- `selectedUnitMasterArea` — 칩 하이라이트 **전용**
- `selectedTradeArea` — 모든 거래 파생 UI 전용

그 문서는 두 도메인 사이에 "verified 1:1 mapping이 없다"고 적었고, 그래서
`selectedUnitMasterArea`는 **"Never used to filter, join, or fetch transaction data"**
로 못박혔다.

결과적으로 "잘못된 데이터"는 막았지만 **칩이 완전히 무력해졌다.** Unit Master가 있는
단지에서 평형 선택은 그저 색깔만 바뀌는 버튼이 됐고, 거래 데이터는 로드 시점의
84㎡ 기본값에 영원히 고정됐다. 그게 이번에 신고된 증상이다.

### 2.2 왜 그 전제가 틀렸나

두 값은 **문자열 포맷만** 다르고 숫자는 같다. 그리고 이 프로젝트에는 두 도메인을
잇는 **이미 배포되어 production에서 동작 중인 규칙**이 있다:

```ts
// src/lib/statistics-pyeong-resolver.ts
export const AREA_MATCH_EPSILON = 0.001;
export function matchTrustworthyPyeong(unitTypes, rawAreaM2) {
  const match = unitTypes.find((u) => Math.abs(u.canonicalExclusiveArea - rawAreaM2) < AREA_MATCH_EPSILON);
  ...
}
```

지도/통계 경로가 바로 이 규칙으로 Unit Master ↔ raw 실거래를 이어 평형 라벨을 붙인다.
epsilon은 Decimal↔float 왕복 오차 흡수용이며, `84.7855` vs `84.9950`,
`59.8826` vs `59.8839` 같은 실존 micro-variant가 병합되지 않도록 이미 검증돼 있다.

즉 "검증된 매핑이 없다"는 전제는 사실이 아니었다. 새 허용치를 만들 필요도 없었다.

## 3. 수정 — 단일 평형 선택 계약

새 순수 모듈 `src/lib/unit-area-match.ts`:

```ts
parseAreaM2("84.7855m²")            // → 84.7855   (suffix 무관)
areaMatchesSelection(tradeArea, sel) // → 숫자 비교, |a-b| < AREA_MATCH_EPSILON
selectTradesForArea(trades, sel)     // → 선택 평형 거래만 (없으면 빈 배열)
findUnitForArea(unitMaster, area)    // → 라벨용 Unit Master 조회
countTradesByArea(trades, areas)     // → 칩 건수
```

허용치는 `statistics-pyeong-resolver.ts`의 `AREA_MATCH_EPSILON`을 **그대로 재사용**한다
(export만 추가). 임의의 tolerance를 새로 만들지 않았다.

매칭이 **숫자 기반**이라 선택값이 canonical(`"129.7178"`)이든 raw(`"129.7178m²"`)든
동일하게 동작한다. 그래서 상태를 나눠 둘 이유가 사라졌다:

- `selectedUnitMasterArea` **삭제**
- `selectedTradeArea` 하나가 칩 하이라이트와 모든 거래 필터를 함께 구동

### 3.1 변경된 소비자 (전부 같은 계약을 쓴다)

| 위젯 | 파일 | 이전 | 이후 |
|---|---|---|---|
| Hero 최근 실거래 / 최고·최저 / 건수 / 타임라인 | `apt-client.tsx:446` | `trade.area !== selectedTradeArea` | `areaMatchesSelection(...)` |
| 가격 차트 | `price-trend-data.ts` | `trade.area === selectedArea` | `areaMatchesSelection(...)` |
| 전세가율 / 갭 | `investment-metrics.ts` | `t.area === selectedTradeArea` | `areaMatchesSelection(...)` |
| 칩 활성 / 건수 / 라벨 | `AreaSelector.tsx` | 문자열 `===` | 숫자 매칭 + `countTradesByArea` |
| 타임라인 행 라벨 / 직전거래 비교 | `TradeTimelineList.tsx` | 문자열 `===` | `findUnitForArea` / `areaMatchesSelection` |
| 차트 평형 라벨 | `PriceTrendChart.tsx` | 문자열 `===` | `findUnitForArea` |

부수 효과로 **suffix 때문에 조용히 실패하던 평형 라벨 조회들이 함께 복구**됐다.
타임라인 헤더가 `전용 84.79㎡`에서 `34평 · 전용 84.79㎡`로 바뀐 것이 그 예다.

## 4. 지키기로 한 규칙

- **거래 없는 평형은 빈 상태.** 다른 평형/기본 84㎡/전체 최신으로 대체하지 않는다.
  화면 문구는 기존 `선택한 조건의 최근 거래가 없습니다.`를 그대로 쓴다.
- **micro-variant 병합 금지.** `84.6518` vs `84.6565`(0.0047㎡ 차이)는 끝까지 별개다.
- **평 라벨을 만들어내지 않는다.** 라벨은 Unit Master가 준 값만 쓴다.
- **단지 identity 불변.** `unit-area-match.ts`는 면적만 본다 — 이름/aptSeq를 입력으로
  받지도 반환하지도 않으므로 평형 전환이 단지를 재해석할 경로가 아예 없다.
- **취소 의미론 불변.** 면적 필터는 `dealCanceled`를 읽지도 바꾸지도 않는다(§7 참고).
- **네트워크 재조회 없음.** 어떤 API도 area 파라미터를 받지 않는다. 전 평형 데이터를
  한 번 받아 클라이언트에서 필터링하므로 칩 전환은 순수 로컬 연산이다.

## 5. 두 번째 결함 — 상세페이지와 지도가 서로 다른 데이터 소스를 본다

**이건 이번 수정으로 해결되지 않는 별개의 문제이며, 확인된 사실이다.**

문제의 거래는 Production DB에 분명히 존재한다:

```
apt_seq=26140-1164  129.7178㎡  2026-09-05  66,500만원  12층
deal_canceled=false  created_at=2026-09-09T19:59:35Z
```

같은 서버·같은 시각에 두 API를 호출한 결과:

| API | 소스 | 129.7178㎡ 2026-09-05 |
|---|---|---|
| `/api/transactions` (지도·통계) | **DB-first** (`fetchApt12MonthsFromDb`) | **있음** — `pyung=50`, `6억 6,500만` |
| `/api/apt/[name]` (상세) | **MOLIT 라이브** (`fetchMolitMonthCached`) | **없음** |

상세 응답은 `monthsRequested=12 / monthsSucceeded=12 / partial=false / apiError=null`
로 **정상**이었다. 즉 실패를 숨긴 게 아니라, MOLIT가 오늘 돌려준 202609 응답에 그 행이
들어 있지 않다. E-JIP sync는 2026-09-09에 그 행을 받아 저장했고, 26140/202609 셀은
그 이후 다시 수집되지 않았다(최신 `source_fetched_at` = 2026-09-09).

이것이 **"지도는 50평 6.65억을 보여주는데 상세페이지는 못 보여주는"** 진짜 이유다.
평형 필터 버그와는 독립적인 원인이다.

이번 STEP에서 고치지 않은 이유: 상세 라우트의 데이터 소스를 MOLIT-라이브에서
DB-first로 바꾸는 것은 identity/completeness 의미론에 영향을 주는 아키텍처 변경이라
이 버그의 범위를 넘는다. **별도 승인 후 진행할 항목으로 남긴다.**

## 6. 회귀 테스트

`src/lib/unit-area-match.test.ts` — 16개, DB 없이 순수 규칙만. fixture 값은
대신롯데캐슬 실제 Production 면적이지만 검증 규칙은 전부 일반 규칙이다.

suffix 매칭 / micro-variant 비병합 / 평형 A·B 전환 / A→B→A 왕복 / 기본 평형 잔존 없음 /
건수 변화 / 거래 없는 평형의 빈 결과 / 전체 평형 / 해석 불가값 / 취소 플래그 보존 /
라벨 조회 / 칩 건수 / 위젯 간 동기화 / identity 불변.

## 7. 알려진 한계

- **취소 거래**: 상세페이지는 예전부터 `dealCanceled`를 필터하지 않는다 —
  취소 건이 타임라인·최고/최저·최신 거래에 포함될 수 있다. 이번 수정은 이 동작을
  **바꾸지 않았다**(면적 필터는 취소 플래그를 건드리지 않는다). 별개의 선행 이슈이며
  수정하면 표시 가격·건수가 달라지므로 별도 STEP이 필요하다.
- **칩 라벨 충돌**: `59.8826`과 `59.8839`가 칩에서 둘 다 `전용 59.88㎡`로 보인다
  (Unit Master `displayExclusiveArea`가 2자리). 선택·필터는 정확히 분리되지만
  라벨만 같아 보인다. 표시 문제이며 데이터 문제는 아니다.
- §5의 소스 분기 — 위 참고.
