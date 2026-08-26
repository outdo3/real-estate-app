# BUSAN DATA / UX AUTOMATED QA V1

작성일: 2026-08-27
성격: **읽기 전용 자동화 QA 시스템 구축**. `APARTMENT_BASIC_DATA_COVERAGE_AUDIT_V1`/`DATA_COVERAGE_FIX_V1`의 후속 STEP으로, 사용자가 부산 3,402개 단지를 직접 눌러보며 오류를 찾는 방식에서 벗어나 자동화된 QA가 데이터 누락/모순/API 오류/거래 신뢰도/검색·지도 identity 문제를 먼저 탐지하게 한다. 대량 Production 데이터 수정 STEP이 아니다 — DB 쓰기는 0건(SELECT류 Prisma 호출만). 감사 중 발견한 명확하고 안전한 read-path 버그 1개 클래스(4개 라우트)만 최소 범위로 수정했다(§17).

---

## 1. Purpose

3,402건 규모의 부산 `ApartmentMaster`를 사람이 수동으로 QA하는 것은 불가능한 규모다. 이 STEP은 재사용 가능한 read-only QA runner(`scripts/run-busan-data-ux-qa.ts`)를 만들어, DB 커버리지/일관성/identity/거래 신뢰도/Unit Master/검색·지도 계약을 매번 같은 기준으로 자동 재검사할 수 있게 한다. 목표는 "값이 존재한다"가 아니라 "**올바른 아파트 → 올바른 API → 올바른 UI 계약**까지 확인"이다(§1 core principle) — 잘못된 fallback으로 값이 채워진 상태를 PASS로 보지 않는다.

---

## 2. QA Architecture

4개 레이어 + 부가 체크로 구성했다.

```
scripts/
  busan-qa-logic.ts        — 순수 판정 로직(부작용 없음, 단위 테스트 대상)
  busan-qa-logic.test.mjs  — 20개 유닛 테스트
  run-busan-data-ux-qa.ts  — CLI 본체(Prisma 읽기 + 로컬 dev 서버 HTTP 호출)
```

| 레이어 | 대상 모집단 | 방법 |
|---|---|---|
| L1 DATABASE COVERAGE | `ApartmentMaster` 3,402건 전체 | Prisma SELECT, 필드별 present/total |
| L2 DATA CONSISTENCY | 3,402건 전체 | per-row 이상값 판정(`classifyConsistency`) |
| L3 API CONTRACT | 대표 set(최대 39건) | 로컬 dev 서버(`http://localhost:3000`)에 실제 HTTP 요청 |
| L4 PRODUCT CONTRADICTION | 대표 set | L3 응답을 DB 값과 대조 |

IDENTITY/UNIT MASTER QA는 전체 모집단(ApartmentMaster 3,402건 + legacy `Apartment` 38건)을 DB만으로 검사하고, TRADE TRUST/SEARCH/MAP QA는 L3/L4에 종속되어 대표 set에서만 실행한다.

**정직한 한계**: L3/L4/SEARCH/MAP은 대표 set(최대 39건)에서만 실행한다 — 매 요청마다 MOLIT/건축물대장/Kakao 같은 외부 공공 API를 부르는 라이브 라우트라, 3,402건 전부를 API 레벨로 재수집하면 AGENTS.md가 금지하는 대량 외부 API 재호출이 된다. 이 실행 환경엔 browser automation 인프라가 없어 UI 렌더링/시각 회귀는 자동 검사하지 못하고 `MANUAL_REQUIRED`로 분류한다(§19).

---

## 3. Coverage (L1, ApartmentMaster 3,402건 전체)

| 필드 | Present | Coverage |
|---|---|---|
| householdCount | 3,181 | 93.5% |
| buildYear | 3,402 | 100.0% |
| mainBuildingCount | 1,379 | 40.5% |
| parkingCount | 2,417 | 71.0% |
| parkingPerHousehold | 2,357 | 69.3% |
| floorAreaRatio | 2,514 | 73.9% |
| buildingCoverageRatio | 2,521 | 74.1% |
| mgmBldrgstPk | 2,626 | 77.2% |
| coordinates | 3,401 | 100.0% |

`basicSpecSource` 분포: `BUILDINGHUB_GENERAL_TITLE` 994(29.2%) / `BUILDINGHUB_TITLE` 1,720(50.6%) / `UNKNOWN` 688(20.2%) — `DATA_COVERAGE_FIX_V1` 산출물과 정확히 일치(회귀 없음 확인).

---

## 4. Data Trust (L2 Consistency, 3,402건 전체)

PASS 3,400 / WARN 2 / FAIL 0.

- **FAIL(hard) 기준**: FAR/BCR ≤ 0, household ≤ 0, parkingCount < 0, buildYear가 미래연도(2027 초과)이거나 1900 미만, `parkingPerHousehold` 저장값이 `parkingCount/totalHouseholds` 계산값과 1% 넘게 다름, 좌표가 부산 bbox(lat 34.9~35.45, lng 128.6~129.35) 밖. — **0건**(부산 데이터는 이 기준으로 완전히 깨끗함).
- **WARN(soft) 기준**: 법정 상한을 넘지만 이론상 존재 가능해 자동으로 FAIL 단정하지 않는 값(건폐율 > 100%, 용적률 > 2000%) — **2건**:
  - 동원화인패밀리(aptSeq `26230-128`): `buildingCoverageRatio=122.37`
  - 광안동에스케이뷰(aptSeq `26500-1384`): `buildingCoverageRatio=110.7`

  건폐율은 법적으로 100%를 넘을 수 없어(대지면적 대비 건축면적) 이 두 건은 데이터 파싱 오류(자릿수/필드 혼동) 가능성이 높지만, 이번 STEP은 audit-only라 자동 수정하지 않고 사람 확인이 필요한 WARN으로만 분류했다.

null은 전부 허용(§4 원칙과 일치) — 위 판정은 값이 **존재할 때만** 검사한다.

---

## 5. Identity

- `aptSeq` 중복: **0건**(DB `@unique` 제약과 실제 데이터 일치).
- `normalizedName` collision(같은 정규화 이름이 서로 다른 구/동에 존재): **206개 그룹**. 이 자체는 버그가 아니라 실제로 존재하는 정상 데이터 패턴이다(예: "한솔솔파크"가 연제구 연산동/해운대구 우동 양쪽에 존재) — "이름만으로 재식별 금지" 원칙이 왜 필요한지 보여주는 회귀 감시 대상으로 개수를 추적한다.
- **legacy `Apartment`(38건) name-only fallback 위험 — 1건 실측**: "대신롯데캐슬"이라는 이름이 서울 강남구 대치동(id=14, lawdCd=11680)과 부산 서구 서대신동3가(id=11, lawdCd=26140, 이번 STEP의 회귀 fixture)에 **동시에 존재**한다. `Apartment` 모델은 `@@unique([name, dong])`만 걸려 있어 name 단독으로는 유일하지 않다.

### 5-1. 실제로 재현·수정한 버그

정적 코드 감사로 4개 라이브 API 라우트에서 `lawdCd`(또는 `dong`)가 없을 때 `{ name: aptName }`만으로 `prisma.apartment.findFirst`를 호출하는 패턴을 발견했다:

| 라우트 | 패턴 |
|---|---|
| `/api/apt/[name]` (거래) | `where: lawdCd ? {name, lawdCd} : {name}` |
| `/api/apt/[name]/score` | 동일 패턴(자체 주석은 "이름만으로는 절대 다른 단지의 score를 반환하지 않는다"고 명시했으나 실제 구현은 이를 지키지 못했음) |
| `/api/apt/[name]/education` | 동일 패턴 |
| `/api/apt/[name]/facilities` | `where: dong ? {name, dong} : {name}` |

로컬 dev 서버로 실제 재현: `GET /api/apt/대신롯데캐슬` (lawdCd/dong 파라미터 없음) → 수정 전 `lawdCd=11680, dong=대치동`(서울 강남구, 잘못된 단지) 반환. 이 진입 경로는 라우트 자체 주석에 "지도 마커 클릭, 커뮤니티 글 링크처럼 lawdCd/dong을 안 넘기는 진입 경로가 실제로 있다"고 이미 문서화되어 있어, 이론적 위험이 아니라 실제 도달 가능한 경로였다.

**수정**: lawdCd(또는 facilities의 경우 dong)가 이미 있을 때만 이 캐시 조회를 시도하도록 변경 — lawdCd/dong이 둘 다 없으면 name-only 쿼리 대신 그대로 지오코딩 폴백(route.ts) 또는 `facilities: null`(facilities.ts, "미해결 identity"로 정직하게 남김)로 넘어간다. 수정 후 재현: `GET /api/apt/대신롯데캐슬`(파라미터 없음) → Kakao 지오코딩이 올바르게 `lawdCd=26140, dong=서대신동3가`(부산, 올바른 단지)를 반환.

**회귀 확인**: lawdCd/dong이 이미 전달되는 기존 정상 경로(예: 연산동한솔솔파크에 정확한 lawdCd/dong 지정)는 수정 전후 동일하게 동작함을 재확인했다.

**`WRONG_APARTMENT_FALLBACK` = 이번 STEP에서 발견 시점 기준 PRESENT였고, 4개 라우트를 이번 STEP에서 즉시 수정해 ABSENT로 전환했다.** 근본 데이터(legacy `Apartment`의 name 비유일성)는 그대로 남아 있어 향후 신규 라우트가 같은 실수를 반복할 위험은 여전히 존재한다 — QA 스크립트가 이 legacy name 충돌 존재 자체를 계속 카운트해 회귀를 감시한다.

---

## 6. Trade

대표 set 39건에 대해 `/api/apt/[name]`(거래 API)을 실제 호출(`period=12`)했다.

- `apiError`가 있는데 `trades.length===0`인 오분류(§6-A/B 규칙 위반) 사례: **0건**.
- 매매/순수전세(반전세 제외) gap·ratio는 `src/lib/gap-invest-calc.ts`의 실제 프로덕션 함수(`buildGapCandidates`)를 그대로 재사용해 계산했다 — 이 STEP이 별도로 계산 로직을 중복 구현하지 않는다. 반전세(monthlyRent>0) 거래는 "순수 전세" 집합에서 명시적으로 제외한다(이전 STEP에서 발견/수정했던 "반전세 혼입 → 가짜 역전세" 회귀의 재발 방지 지점).
- ratio(매매/전세) < 1(전세가 매매가보다 비쌈)인 이례적 조합: **0건**(대표 set 범위 내).

**정직한 한계**: `/api/stats/dashboard`(전세가율 통계 대시보드) 자체는 이번 스크립트의 검증 대상이 아니다 — `/api/apt/[name]` 거래 API 응답만으로 같은 계산이 올바른지 자체 재현해 검증했다.

---

## 7. Unit Master

legacy `Apartment` 테이블(Unit Master의 FK 대상) 기준, DB-only로 검사:

- `ApartmentUnitType` 총 99건 / Unit Master를 보유한 단지 11곳.
- `representativePyeongSource=UNKNOWN`인데 `representativePyeong` 값이 채워진 계약 위반: **0건**.
- 근접(diff<0.5)하지만 서로 다른 `canonicalExclusiveArea` 쌍(정상 — merge되지 않아야 함): 52쌍.

### 7-1. API 계층 회귀 검증(§20 고정 fixture)

대신롯데캐슬(aptSeq `26140-1164`)의 `/api/apt/[name]/info` 응답을 DB 원본과 대조: 스키마가 허용하는 정상 케이스인 `84.7855`/`84.9950`, `59.8826`/`59.8839`(같은 단지 안의 서로 다른 정확 전용면적)가 API 응답에서도 **병합되지 않고 그대로 구분 유지**됨을 확인했다(PASS).

대신해모로센트럴아파트(aptSeq `26140-1356`)에서 처음에 오탐(false positive)을 하나 발견해 즉시 고쳤다: 이 단지는 `84.9442`라는 같은 정확 면적을 서로 다른 `variantKey`(`supply_112.7524` vs `supply_112.7930`)로 **정당하게 2번** 갖고 있다(스키마 `@@unique([apartmentId, canonicalExclusiveArea, variantKey])` 자체가 허용하는 설계). 초기 버전 QA 로직은 "같은 면적이 배열에 두 번 나오면 collision"으로 단순 판정해 이를 오탐으로 잡아냈다 — `(canonicalExclusiveArea, variantKey)` 조합 기준으로 DB와 API를 대조하도록 즉시 수정해 오탐을 제거했다. 이 사례 자체가 "억지로 문제를 진단하지 않는다"(§1 core principle)는 이 STEP의 원칙을 실제로 재확인한 경험이다.

---

## 8. Basic Specs (DB vs Detail API, L4)

대표 set 39건에 대해 `/api/apt/[name]/info`를 호출해 `ApartmentMaster.floorAreaRatio/buildingCoverageRatio/parkingCount`가 있는데 API 응답에 없는 케이스(`L4_BASIC_SPEC_MISMATCH`)를 검사했다 — **0건**(`DATA_COVERAGE_FIX_V1`의 tier2(ApartmentMaster) 병합 경로가 정상 작동 중임을 재확인).

---

## 9. Representative Set

16개 구/군 각각 최대 3건(대단지 1 + 소단지 1 + `basicSpecSource=UNKNOWN` 표본 1, 존재할 때만) + 고정 회귀 fixture 4건 = **총 39건**(fixture 4건 포함, 일부 구/군은 UNKNOWN 표본이 없어 2건만). 대단지/소단지 세대수 대비, `basicSpecSource`(총괄표제부/표제부/미확보) 다양성을 확보했다. Unit Master 유무는 legacy `Apartment`가 38건뿐이라 강제 균형은 시도하지 않고 fixture(대신롯데캐슬)로 대표성을 확보했다.

---

## 10. 16 District Coverage

| 구/군 | 총 단지 | 세대수 | 주차 | FAR | BCR |
|---|---|---|---|---|---|
| 부산진구(26230) | 404 | 85.4% | 70.0% | 73.5% | 74.3% |
| 사하구(26380) | 338 | 92.3% | 56.2% | 71.6% | 71.6% |
| 동래구(26260) | 314 | 97.1% | 68.5% | 69.4% | 69.4% |
| 해운대구(26350) | 308 | 90.9% | 77.3% | 78.2% | 78.2% |
| 금정구(26410) | 308 | 98.7% | 74.7% | 75.3% | 75.6% |
| 남구(26290) | 253 | 96.4% | 66.4% | 68.8% | 68.8% |
| 수영구(26500) | 251 | 95.6% | 73.7% | 74.5% | 74.9% |
| 연제구(26470) | 244 | 96.7% | 68.4% | 68.4% | 68.4% |
| 북구(26320) | 173 | 97.1% | 78.6% | 80.9% | 80.9% |
| 서구(26140) | 171 | 94.2% | 78.9% | 80.1% | 80.7% |
| 기장군(26710) | 152 | 92.8% | 88.2% | 90.1% | 90.1% |
| 사상구(26530) | 151 | 91.4% | 74.8% | 73.5% | 74.2% |
| 영도구(26200) | 133 | 94.0% | 55.6% | 60.2% | 59.4% |
| 동구(26170) | 99 | 96.0% | 74.7% | 75.8% | 75.8% |
| 중구(26110) | 59 | 83.1% | 62.7% | 64.4% | 66.1% |
| 강서구(26440) | 44 | 86.4% | 86.4% | 86.4% | 86.4% |

16개 구/군 전부 실측(모집단 0건인 구/군 없음). 영도구/사하구는 주차·FAR·BCR coverage가 특히 낮아(55~60%대) 향후 backfill 우선순위 후보다.

---

## 11. Search

대표 쿼리 5개(`/api/search`): "연산동", "대신동", "해운대", "명지", "서면".

- 전부 HTTP 200, 중복 `aptSeq` 0건.
- "연산동"/"대신동"/"명지"는 `regions`(동 단위 REGION 결과)가 정상 반환됨.
- "해운대"/"서면"은 `regions=0`건 — **버그 아님, 설계상 정상**: `/api/search`의 REGION 매칭은 `ApartmentMaster.umdName`(공식 법정동명) 기준 `contains`인데, "해운대"는 구 이름(해운대구, 실제 동은 우동/중동/좌동 등)이고 "서면"은 여러 법정동(부전동/전포동 등)에 걸친 비공식 통칭이라 애초에 이 매칭 방식으로 잡히지 않는다. `apartments`(단지) 결과는 두 쿼리 모두 정상 15건 반환됨. 이 자체를 FAIL로 처리하지 않았다(§1 "억지 진단 금지" 원칙) — 다만 실제 사용자가 자주 쓰는 통칭 지역명이 REGION 결과를 못 받는 것은 제품 관점에서 개선 여지가 있어 §21 향후 권고에 기록한다.

---

## 12. Map

`/api/search`의 `apartments[]`가 실제로 지도 마커가 쓰는 identity/좌표 소스임을 코드로 확인했다(`ApartmentLocationFeature` 테이블 기반 — `ApartmentMaster.latitude/longitude`와는 별개 파이프라인, 3,401/3,402건으로 거의 완전히 겹침). 대표 set 39건에 대해 두 좌표 소스를 교차검증:

- `ApartmentLocationFeature` 결측: 0건.
- 두 좌표 소스 간 괴리(>200m): 0건.

검색 결과와 지도 마커가 대표 set 범위에서 동일 identity/좌표를 쓰고 있음을 확인했다.

---

## 13. Performance Baseline

이번 STEP은 최적화가 아니라 baseline 측정이 목적이다(§21).

| 항목 | 평균 | 표본 |
|---|---|---|
| `/api/search` | 135ms | 5 |
| `/api/apt/[name]/info` | 791ms | 39 |
| `/api/apt/[name]`(거래) | 37ms | 39 |

**주의**: 거래 API 37ms는 `getOrSetCache`(lawdCd+월 단위 TTL 캐시)가 이 세션에서 반복 호출로 이미 워밍업된 결과일 가능성이 높다 — "첫 방문 캐시 미스" 시나리오의 실제 체감 시간(사용자 보고 "약 3초")과는 다른 숫자다. `SEARCH_MAP_PERFORMANCE_V2_2`에서 캐시 콜드 상태 기준으로 재측정 필요.

---

## 14. Failure Classification

| 분류 | 건수 | 내용 |
|---|---|---|
| P0_DATA_TRUST | 1 | legacy Apartment name-only fallback 위험(§5) — 라이브 버그는 이번 STEP에서 수정, 근본 데이터는 잔존 |
| P0_BROKEN_FLOW | 0 | — |
| P1_COVERAGE | 2 | buildingCoverageRatio>100 이례값 2건(§4) |
| P1_PERFORMANCE | 0 | — |
| P2_UI | 0 | — |
| SOURCE_LIMITATION | 1 | UI 시각 회귀 자동화 불가(MANUAL_REQUIRED) |

---

## 15. Automated Fixtures

`scripts/run-busan-data-ux-qa.ts`의 `KNOWN_REGRESSIONS`에 4개 고정:

| Fixture | aptSeq | 결과 |
|---|---|---|
| 연산동한솔솔파크 | 26470-1040 | PASS |
| 대신롯데캐슬 | 26140-1164 | PASS(Unit Master collision 회귀 포함) |
| 연산동일동미라주더스타 | 26470-1481 | PASS |
| 대신해모로센트럴아파트 | 26140-1356 | PASS |

`scripts/busan-qa-logic.test.mjs`(20개 유닛 테스트)에도 핵심 회귀를 고정했다: null 허용 원칙, BCR>100 soft 분류(동원화인패밀리/광안동에스케이뷰 사례 반영), API 실패≠거래없음(§6 핵심 규칙).

---

## 16. Release Gate

```
P0_DATA_TRUST > 0        → RELEASE BLOCK 후보(단, 이번 1건은 이미 코드 수정 완료 — 잔존 리스크는 데이터 landscape 자체)
P0_BROKEN_FLOW > 0        → RELEASE BLOCK
대표 16개 구/군 journey API 실패 → RELEASE BLOCK
P1_COVERAGE               → WARNING, 출시 가능
P0_DATA_TRUST + P0_BROKEN_FLOW 합계 > 20 → BLOCKED, 그 이하면 LIMITED
```

이번 실행 결과: `RELEASE_GATE = LIMITED`(P0_DATA_TRUST=1, P0_BROKEN_FLOW=0). 임계값(20건)은 이번 STEP의 실측 근거로 잠정 설정한 것이며, 향후 반복 실행 데이터가 쌓이면 재조정을 권고한다(과도한 정책 확정은 지양).

---

## 17. Current P0

**P0_DATA_TRUST 1건**: legacy `Apartment` 테이블에 "대신롯데캐슬"이라는 이름이 서울(id=14)/부산(id=11) 양쪽에 존재. 4개 라이브 라우트(`route.ts`/`score/route.ts`/`education/route.ts`/`facilities/route.ts`)의 name-only fallback 버그는 **이번 STEP에서 즉시 수정 완료**(§5-1). 근본 원인(legacy Apartment의 name 비유일성 자체)은 스키마 변경 없이는 해소 불가하고 이번 STEP 승인 범위 밖이라 그대로 남겨두고, QA 스크립트가 계속 감시한다.

---

## 18. Current P1

- buildingCoverageRatio > 100인 2건(동원화인패밀리 122.37%, 광안동에스케이뷰 110.7%) — 데이터 파싱 오류 가능성, 사람 확인 필요.
- 영도구/사하구의 주차·FAR·BCR coverage가 부산 평균보다 낮음(§10) — 향후 backfill 우선순위 후보.
- "해운대"/"서면" 같은 통칭 지역명이 `/api/search`의 REGION 결과를 얻지 못함(§11) — 버그는 아니나 제품 개선 후보.

---

## 19. Source Limitations

- browser automation 인프라 부재로 UI 렌더링/시각 회귀는 `MANUAL_REQUIRED`(자동화 불가, §14 SOURCE_LIMITATION 1건).
- L3/L4/SEARCH/MAP은 대표 set(39건)에서만 실행 — 부산 전체 3,402건에 대한 API 레벨 재검증은 대량 외부 API 재호출 금지 원칙(AGENTS.md)에 막혀 이번 STEP 범위 밖.
- `/api/stats/dashboard`(전세가율 통계 대시보드) 자체는 검증 대상이 아니었다 — `/api/apt/[name]` 거래 응답으로 같은 계산을 자체 재현해 검증했을 뿐이다.
- 성능 baseline(§13)은 이 세션 중 캐시가 워밍업된 상태로 측정됐다 — 콜드 스타트 수치가 아니다.

---

## 20. How To Run

```bash
# 부산 전체 DB QA + 대표 set API QA(기본, 로컬 dev 서버 필요: npm run dev)
npx ts-node --compiler-options '{"module":"commonjs"}' scripts/run-busan-data-ux-qa.ts

# 특정 구/군만
npx ts-node --compiler-options '{"module":"commonjs"}' scripts/run-busan-data-ux-qa.ts --district=26470

# 특정 단지 1건만 API QA
npx ts-node --compiler-options '{"module":"commonjs"}' scripts/run-busan-data-ux-qa.ts --aptSeq=26470-1040

# 대표 set을 구/군당 1건 + fixture로 축소(빠른 재실행)
npx ts-node --compiler-options '{"module":"commonjs"}' scripts/run-busan-data-ux-qa.ts --quick

# API 호출 없이 DB만(빠름, 외부 API 의존 없음)
npx ts-node --compiler-options '{"module":"commonjs"}' scripts/run-busan-data-ux-qa.ts --no-api

# 머신 판독 가능 JSON도 저장(tmp/qa/BUSAN_DATA_UX_QA_V1.json, 커밋 대상 아님)
npx ts-node --compiler-options '{"module":"commonjs"}' scripts/run-busan-data-ux-qa.ts --json

# 유닛 테스트
node --experimental-strip-types --test scripts/busan-qa-logic.test.mjs
```

---

## 21. Future Automation

- **성능 재측정**: 캐시를 비운 콜드 상태에서 검색/상세 API를 재측정해 `SEARCH_MAP_PERFORMANCE_V2_2`의 정확한 baseline으로 삼는다.
- **CI 연동**: `--quick --no-api --json`을 PR마다 자동 실행해 L1/L2/Identity/Unit Master 회귀를 상시 감시하는 것을 고려할 수 있다(외부 API 의존 없이 몇 초 내 실행 가능).
- **BCR>100 2건**: 원본 건축물대장 응답 재조회로 파싱 오류인지 실제 예외 건축물인지 확인.
- **통칭 지역명 검색**: "해운대"/"서면" 같은 구/통칭 지명이 REGION 결과를 못 받는 문제를 별도 제품 STEP에서 검토(구 이름→소속 동 목록 매핑 또는 별도 alias 테이블 필요, 이번 STEP에서 결정하지 않음).
- **legacy Apartment name 중복 정리**: 이번 STEP에서 라이브 버그는 막았지만, 근본적으로 `Apartment` 테이블에 이름이 겹치는 행이 존재하는 상태 자체는 남아있다 — 향후 스키마/데이터 정리 STEP에서 승인 하에 검토.

---

## 관련 문서

- `docs/development/APARTMENT_BASIC_DATA_COVERAGE_AUDIT_V1.md` — 이번 STEP이 이어받은 coverage/identity 원칙과 연산동한솔솔파크 사례의 최초 근거.
- `docs/development/DATA_COVERAGE_FIX_V1.md` — `floorAreaRatio`/`buildingCoverageRatio`/`parkingPerHousehold`/`basicSpecSource` 스키마와 3,402건 backfill 산출물(이번 STEP의 coverage 수치가 그대로 재확인됨).
- `docs/development/CHANGELOG.md` — 이번 STEP 항목 추가.
