# STATISTICS DATA TRUST + REGION FILTER V2

## 1. Goal

STATISTICS V2(지역별 실거래 피드)의 완료 보고에서 발견된 두 가지 문제를 고친다:
(A) `rankings`/`dashboard`/`transactions` 3개 live route에 남아 있던
`exclusiveArea / 3.3058` 가짜 대표평형 계산, (B) 통계 지역 선택이 시군구 선택을
강제해 "부산광역시 전체"/"서울특별시 전체" 조회가 불가능했던 문제. 신규
실거래 피드는 이미 raw ㎡ only 원칙을 지키고 있었으므로(§ 이전 STEP), 이번
STEP은 그 기준을 기존 화면들에도 맞추는 작업이다.

## 2. Fake Pyeong Problem

전수 검색(`grep -rn "3.3058" src/`) 결과 실제 live 경로 4곳에서 발견:

| 파일 | 용도 | 문제 |
|---|---|---|
| `src/app/api/stats/rankings/route.ts:14` | 표시용 `pyung`(단지 랭킹 meta) | `Math.round(areaNum/3.3058)` |
| `src/app/api/stats/rankings/route.ts:79-82(구)` | 추세(pctChange) 계산의 단가 분모 | 동일 |
| `src/app/api/stats/dashboard/route.ts:8` | hotIssues/topPrices 표시·집계 | 동일 |
| `src/app/api/stats/dashboard/route.ts:129(구)` | gapInvest 표시 | `exclusiveAreaM2/3.3058` |
| `src/app/api/transactions/route.ts:48` | 실거래 목록 표시 | 동일 |

`src/components/RankCard.tsx:59`도 동일 계산을 갖고 있지만 `src/app`
어디에서도 import되지 않는 orphan 컴포넌트라(실측 확인) 손대지 않았다 —
살아있는 경로가 아니므로 이번 STEP 대상이 아니다.

## 3. Canonical Area Rules

고정한 원칙(§AGENTS.md 그대로):

- raw transaction area = MOLIT `excluUseArea` 그대로(반올림/변환 없음).
- representative pyeong = `ApartmentUnitType.representativePyeong`(Unit
  Master)이 있고 `representativePyeongSource !== 'UNKNOWN'`일 때만.
- `exclusiveArea / 3.3058`을 대표 평형으로 표시 금지 — 이번 STEP에서 4곳 전부
  제거.
- 없으면 raw ㎡만 표시(`pyung: null`), 억지로 채우지 않는다.

## 4. Unit Master Resolution

신규 `src/lib/statistics-pyeong-resolver.ts`(순수 함수 + 얇은 Prisma batch
래퍼):

- `matchTrustworthyPyeong(unitTypes, rawAreaM2)`: `canonicalExclusiveArea`가
  `rawAreaM2`와 오차 0.001 이내로 정확히 일치하는 것만 매칭(84.7855 vs
  84.9950 collision-safe, 테스트로 고정).
- `resolvePyeongFromApartments(keys, apartments)`: canonical 식별은 aptSeq
  우선, 없으면 (name, dong) 폴백 — 둘 다 후보가 2건 이상이면(중복 데이터,
  동명이단지) 매칭하지 않는다(다른 단지로 fallback 금지).
- `resolveTrustworthyPyeongBatch(prisma, keys)`: 거래 개수만큼이 아니라
  **쿼리 2회**(aptSeq IN / (name,dong) IN)로 전체를 batch 조회한다 — N+1 없음.
- 11개 단위 테스트(`statistics-pyeong-resolver.test.mjs`) 전부 PASS.

세 route 모두 이 resolver로 교체했다. `rankings`의 추세(pctChange) 계산은
평형이 아니라 **raw ㎡ 단가 비율**로 바꿨다 — 상수 배율(1/3.3058)이 비율
계산에서 정확히 상쇄되므로 결과값은 수학적으로 동일하며, 반올림된 평형으로
뭉개지던 정밀도까지 개선됐다(주석/코드에 근거 명시).

## 5. Region Problem

기존 `RegionSelectModal`은 시도 → 시군구(필수) → 읍면동(선택) 3단계로,
시군구를 반드시 하나 골라야 했다. "구 전체"는 이미 읍면동 단계에
있었지만(§동 단계 첫 옵션), "시도 전체"에 해당하는 옵션 자체가 없었다 —
사용자가 실제로 보고한 정확한 문제.

## 6. Region Hierarchy

`RegionState`(`src/contexts/RegionContext.tsx`)를 확장:

```
lawdCd: string | null   // null = 시도 전체
sidoCode: string        // 항상 채워짐(2자리)
dong, sido, sigungu, displayRegionName  // 기존과 동일 의미
```

레벨 개념(3단계, project 기존 naming 그대로 재사용 — 새 enum 도입 안 함):
`SIDO_ALL`(`lawdCd=null`) / `SIGUNGU_ALL`(`lawdCd` 있음, `dong='all'`) /
`DONG`(`lawdCd`+`dong` 둘 다 구체적).

## 7. Sido All

`RegionSelectModal`의 시군구 그리드 최상단에 "{시도명} 전체" 버튼 추가(기존
"동 전체" 버튼과 동일한 패턴, §11). 선택 시 `lawdCd: null`, `sidoCode`만
채워 확정한다. 지역 코드는 기존 `resolveLawdCd`/`resolveLawdCdByNames`와
동일한 **전국 법정동코드 프록시**를 그대로 재사용(`src/lib/region-utils.ts`에
`resolveSidoCode`/`getSigunguListForSido` 신규 추가) — 부산 16개/서울 25개 구
하드코딩 없음, 전국 어디든 동적으로 동작(§28).

## 8. Sigungu All

기존 UX 그대로 유지 — 읍면동 선택 화면의 "OO구 전체" 버튼(이미 존재).
이번 STEP에서 새로 만들지 않았다.

## 9. Dong

기존과 동일하게 선택 사항. 시도 전체 상태에서는 dong 필터가 적용되지 않는다
(구를 특정하지 않은 상태에서 동 이름만으로 필터링하면 다른 구의 동명 동과
섞일 위험이 있어 의도적으로 비활성화).

## 10. Common Region Selector

`RegionSelectModal`(기존 컴포넌트) 하나를 그대로 확장했다 — 실거래 화면
전용 별도 selector를 새로 만들지 않았다(§14 지시 그대로). 통계 세부화면 전체가
`useRegion()` 하나로 지역 상태를 공유하는 기존 구조를 그대로 재사용.

## 11. Sido All — 대상 화면 확장

`/api/stats/feed`, `/api/stats/rankings`(하락/최고가/상승/많이산단지/역전세),
`/api/stats/dashboard`(거래량/갭투자) 3개 API 전부 `lawdCd` 없이 `sidoCode`만
오면 시도 전체로 동작하도록 확장했다 — "실거래뿐 아니라 모든 세부화면"
지시를 반영. `compare`/`multi-compare`(단지 자동완성 검색이 구 단위 전제)와
`price-map`(지도 렌더링이 구 단위 전제), `volume`의 연도별(2014~현재) 표
토글은 시도 전체에서 **정직하게 미지원 처리**한다(§26, 가짜 부분 지원 금지 —
근거는 §14 STATISTICS MENU COVERAGE 표 참고).

## 12. Aggregation

전국 법정동코드 프록시로 시도의 전체 시군구 목록을 동적으로 조회한 뒤(신규
하드코딩 없음), 구/월/거래유형 조합으로 만든 task 목록을 **기존 공유
`fetchMonthsThrottled` 세마포어**(동시 3개, 200ms 페이싱)에 그대로 태운다 —
시도 전체 전용 별도 동시성 풀을 만들지 않았다(만들면 실제 동시 요청 수가
배로 늘어 API 자체 속도 제한에 걸림, 기존 파일의 경고 그대로 준수).

중복 방지: 거래 fetch 시 원본 lawdCd를 각 거래에 태그해(`lawdCd: dLawdCd`)
구별로 완전히 분리된 채 합치므로 같은 거래가 두 구에 걸쳐 중복 집계될 여지가
없다. 단지 identity 그룹핑도 이번에 강화했다 — 기존 `rankings`/`dashboard`는
이름만으로 단지를 묶었는데(같은 이름의 다른 단지가 섞일 위험, 시도 전체
집계에서 특히 커짐), aptSeq 우선·없으면 (구, 동, 이름) 폴백으로
`complexIdentityKey`를 통일했다(`gap-invest-calc.ts`가 이미 확립한 원칙과
동일).

## 13. Partial Failure

`fetchMonthsThrottledWithStatus`(신규, `molit-stats-helpers.ts`에 추가 — 기존
`fetchMonthsThrottled`는 시그니처 그대로 유지되는 하위호환 래퍼로 남겨
기존 rankings/dashboard/yearly/feed 단일-구 호출부는 전혀 바뀌지 않음)가
재시도까지 실패한 월/구를 `failed: true`로 표시한다. 일부 구만 실패하면
`partial: true` + `failedDistricts: [...]`를 응답에 포함, 전체가 실패하면
`apiError: true`(거래 0건과 절대 혼동하지 않음). UI(`TransactionFeedView`)는
`partial`일 때 "일부 지역 데이터 조회가 지연되고 있어요" 배너를 보여준다.

## 14. Performance

| 조회 | Cold | Warm(5분 캐시) |
|---|---|---|
| 부산 전체 실거래 피드(최근 7일) | 4.5s | (별도 측정 안 함, feed는 짧은 lookback이라 이미 빠름) |
| 부산 전체 rankings(12개월) | 30.6s | 0.76s |
| 부산 전체 dashboard(거래량/갭투자, 12개월) | 62.6s | 0.27s |
| 부산 서구 rankings(기존, 단일 구) | (기존과 동일, 변경 없음) | - |

시도 전체 rankings/dashboard의 cold 시간이 목표(§21 warm ≤2s)보다 훨씬 큰
것은 **cold**이기 때문이며(§21 "cold는 더 느릴 수 있으나 무반응 장시간
금지"), 실제로 loading indicator가 즉시 표시되고(§44) warm 응답은 목표를
만족한다. 12개월 × 16개 구 × 2타입 = 384개 task가 물리적 하한이라(MOLIT
자체 속도 제한), 이 이상 줄이려면 persisted 캐시/스키마가 필요해
TRUE GATE(#7) 영역이다 — 이번 STEP에서는 시도 전체 feed(짧은 기간)의
lookback을 표시 기간과 동일하게 좁혀(§ 아래 참고) 실용적인 응답 시간을
확보했다.

**신고가/직전거래 비교 범위 축소(feed 한정)**: 시도 전체 실거래 피드는
신고가/직전거래 비교를 "최근 12개월"이 아니라 "표시 기간 내"로 좁혔다(§19
정의 왜곡 방지) — 응답의 `recordHighWindow` 필드와 UI 캡션("신고가/직전거래
비교 기준: YYYY-MM-DD~YYYY-MM-DD")으로 항상 명시한다. rankings/dashboard의
시도 전체는 기존과 동일하게 12개월 그대로 유지했다(month 배수만 늘어날 뿐
lookback 확장은 없어 상대적으로 부담이 적음).

## 15. Statistics Menu Coverage

| MENU | REGION_SELECTOR | SIDO_ALL | SIGUNGU_ALL | DONG | APT | AREA | DATA_SOURCE | STATUS |
|---|---|---|---|---|---|---|---|---|
| 실거래(feed) | 공통 | PASS | PASS | PASS | PASS | PASS(raw ㎡) | MOLIT live | PASS |
| 최근하락 | 공통 | PASS | PASS | N/A* | PASS | - | MOLIT live | PASS |
| 최고가 | 공통 | PASS | PASS | N/A* | PASS | - | MOLIT live | PASS |
| 최고상승 | 공통 | PASS | PASS | N/A* | PASS | - | MOLIT live | PASS |
| 역전세 | 공통 | PASS | PASS | N/A* | PASS | - | MOLIT live | PASS |
| 많이산단지 | 공통 | PASS | PASS | N/A* | PASS | - | MOLIT live | PASS |
| 거래량(그래프) | 공통 | PASS | PASS | N/A* | - | - | MOLIT live | PASS |
| 거래량(연도별 표) | 공통 | **미지원(정직)** | PASS | N/A* | - | - | MOLIT live | PARTIAL |
| 갭투자 | 공통 | PASS | PASS | N/A* | PASS | PASS | MOLIT live | PASS |
| 가격비교 | 공통 | **미지원(정직)** | PASS | N/A* | PASS | - | MOLIT live | PARTIAL |
| 여러단지비교 | 공통 | **미지원(정직)** | PASS | N/A* | PASS | - | MOLIT live | PARTIAL |
| 분위지도 | 공통 | **미지원(정직)** | PASS | N/A* | - | - | MOLIT live | PARTIAL |
| 공급물량/인구변화/외지인비율/경사고도/대단지/인기단지 | 공통 | N/A(soon) | N/A(soon) | N/A | - | - | 없음 | soon(변경 없음) |

\* 랭킹류는 원래부터 dong 단위 drilldown이 없다(단지 단위 랭킹) — 이번
STEP이 새로 제한한 것이 아니라 기존 계약 그대로.

미지원 화면(거래량 표, 비교 2종, 분위지도)은 §14에서 설명한 성능/설계 한계로
정직하게 안내 메시지를 표시하며, 억지로 부분 결과를 보여주지 않는다.

## 16. Mobile

360/375/390 확인(iframe-isolation, `/stats/feed` 기준): 지역 선택 모달의 시도
그리드/"{시도} 전체" 버튼/시군구 그리드 전부 가로 스크롤 없이 정상 렌더,
breadcrumb 정상 표시, 버튼 탭 영역 충분.

## 17. Desktop

852px 데스크톱에서도 동일 컴포넌트로 정상 동작(모바일 전용 상태 누수 없음).

## 18. QA

`scripts/run-statistics-v2-qa.ts` 확장(기존 스크립트, §40 지시대로 신규 대신
확장): SIDO_ALL(부산/서울) 응답 구조·서로 다른 구 혼재 여부·lawdCd 누락 여부·
partial 플래그, fake-pyeong 정적 가드(4개 route 파일의 실제 코드 라인만
검사, 설명 주석은 오탐하지 않도록 `//` 이전 부분만 검사), Unit Master
collision(대신롯데캐슬 84.7855/84.9950/102.7835/59.8839/59.8826 5종 raw
area가 병합되지 않고 유지되며 각각 신뢰 가능한 평형을 얻는지) 검사를
추가했다. 실행 결과: P0 findings 0건, RELEASE GATE = READY.

## 19. Remaining V2.1 Work

- 거래량 연도별 표/단지 비교 2종/분위지도의 시도 전체 지원은 이번 STEP
  범위 밖(성능/설계 한계, §14/§15) — 필요하면 별도 STEP에서 캐시 전략(TRUE
  GATE 필요할 수 있음)과 함께 재검토.
- `region.lawdCd`가 null인 상태에서 `ai-search`는 빈 문자열로 안전 폴백만
  했고(크래시 방지), AI 검색 자체의 시도 전체 지원은 다루지 않았다(스코프
  밖).
- URL에 `sidoCode`/`sido-all` 상태를 인코딩하는 공유 가능한 링크는 API
  파라미터 수준에서는 이미 가능(`?sidoCode=26`)하지만, `/stats` 페이지의
  기존 `?sido=&sigungu=` 동기화 로직을 시도 전체까지 확장하지는 않았다(선택
  사항, LATER).
- 시각 디자인 전면 개편은 이번 STEP 대상이 아니다(§43 지시대로) — 다음은
  STATISTICS V2.1 DETAIL METRICS.
