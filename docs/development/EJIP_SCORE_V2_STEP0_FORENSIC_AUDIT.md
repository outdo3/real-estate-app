# E-JIP SCORE V2 — STEP 0: 현재 Score 법의학적 감사 + 경쟁사 비교 프레임

- 작성일: 2026-08-23
- Worktree: `D:\anti2\aaa\real-estate-app\.worktrees\score-v2-step0-forensic-audit`
- Branch: `score-v2-step0-forensic-audit` (base: `score-geocode-recovery`, HEAD `6e06e01`)
- 성격: **FORENSIC AUDIT ONLY.** weight/formula 변경 없음, DB migration 없음,
  production write 없음, 점수 재계산 write 없음, main merge 없음. 목적은
  "점수를 고치는 것"이 아니라 "왜 지금 이런 결과가 나오는가"를 코드+실 데이터로
  완전히 해부하는 것.

---

## 0. base branch 선정 근거

```
main(local)             HEAD = ec23919 (2026-08-22 15:43)
origin/main              = 82f4914 (2026-08-21 11:19, main보다 1커밋 뒤짐 — ec23919 미푸시)
score-geocode-recovery   HEAD = 6e06e01 (2026-08-21 17:47)
```

`main`과 `score-geocode-recovery`는 `82f4914`에서 갈라진 형제 branch다.
`git diff --stat`으로 직접 비교한 결과, **main이 score-geocode-recovery보다
가진 것은 `.gitignore` 3줄뿐**이고, `score-geocode-recovery`는 main에 없는
실제 score 데이터 복구 작업(`scripts/apartment-score/recover-missing-geocodes.ts`
등 716줄, 부산 3,401/3,402 좌표 확보 → score 계산 가능)을 갖고 있다 — 즉
**main은 "더 최신"이 아니라 "이 복구 커밋을 아직 병합받지 못한 상태"**다.
지시사항이 경고한 함정을 그대로 확인했다: 단순히 커밋 날짜가 최신인 branch가
아니라, Score 관련 코드+데이터가 실제로 가장 완전한 branch(`score-geocode-recovery`)를
base로 채택했다.

---

## 1. E-jip Score V1 공식 완전 해부 (코드 기준, `src/lib/apartment-score/server/*`)

### 1-1. 진입점 — `calculate.ts:calculateApartmentScore(aptSeq)`

```
1) ApartmentMaster에서 대상 단지 + 같은 sggCd(구·군) 전체를 cohort로 조회
2) cohort의 ApartmentLocationFeature/ApartmentMarketFeature를 일괄 조회
3) 5개 카테고리(transport/living/parking/complex/schoolAccess)를 각각
   computeCategoryWithFallback()으로 계산
   - non-parking 4개: peer LOCAL = 같은 umdName(동)
   - parking 1개:     peer LOCAL = 같은 sggCd + buildYear decade band(10년 단위)
   - 카테고리별로 LOCAL→SIGUNGU→REGION_WIDE 순서로, 표본이 부족하면(NOT_SCORED)
     다음 레벨로 자동 재시도
4) scoredCategories(score != null)만 모아 baseWeight 합으로 나눈 usedWeightSum 산출
   coverage = usedWeightSum / 100
5) coverage < MIN_TOTAL_COVERAGE(0.6) 이거나 scoredCategories가 0개면
   status='INSUFFICIENT_DATA'(score=null)로 즉시 반환
6) finalScore = Σ (category.baseWeight / usedWeightSum) × category.score
   → Math.round()
7) confidence = coverage>=0.85 && HIGH-tier 카테고리>=3개면 HIGH,
                coverage>=0.6이면 MEDIUM, 아니면 LOW
```

**DB write 없음** — 이 함수는 매 요청마다 전부 재계산하고 어디에도 저장하지
않는다(주석 §56 명시, 실측 확인).

### 1-2. 카테고리 가중치(합 100) — `config.ts:CATEGORY_WEIGHTS`

```
transport     30
living        25
parking       15
complex       15
schoolAccess  15
market         0  ← Core Score에서 완전 제외, informational-only(§18 사용자 승인 이력)
```

과거 문서를 신뢰하지 않고 코드로 재확인한 결과, 지시사항이 제시한 값(30/25/15/15/15)과
**정확히 일치**한다. market=0은 "가격=좋음" 편향을 원천 차단하기 위한 명시적
설계 결정(주석: "사용자 승인에 따라 총점에서 제외")이며, 실제로 `market.ts`는
가격 자체를 절대 평가하지 않고 거래량(유동성 프록시)만, 그것도 3건 이상일
때만 서술한다 — **V2가 승계할 만한 이미 검증된 좋은 원칙.**

### 1-3. 카테고리 내부 sub-weight(각 카테고리 내부 합 100)

```
transport(§7):   nearestSubwayDistanceM 45, subwayCount1000m 25,
                 nearestBusStopDistanceM 18, busStopCount300m 12
living(§10):     martCount1000m 20, convenienceCount500m 20, pharmacyCount500m 15,
                 hospitalCount1000m 10, parkCount1000m 20, daycareKindergartenCount500m 15
parking(§11):    parkingPerHousehold 100(단일 지표)
complex(§12):    buildYear 50, totalHouseholds 30, mainBuildingCount 20
schoolAccess(§13): nearestElementaryDistanceM 60, elementaryCount1000m 40
```

### 1-4. Normalization / Percentile (`percentile.ts:rankFeature`)

**tie-aware 평균순위 percentile**(scipy 'average' rank와 동일 방식) — 절대값이
아니라 **peer pool 내 순위**만 본다. `direction`(lowerIsBetter/higherIsBetter)에
따라 항상 "0(나쁨)~100(좋음)"으로 정규화. count류 feature(마트/편의점/병원/공원/
어린이집유치원/세대수/동수)는 `log1p` 변환 후 순위(§17 diminishing returns —
"0→1개는 크게, 그 이상은 완만하게").

`n=1`(peer가 target 혼자)이면 percentile=50 고정. 결측 null 처리:
- `qualityFlag='complete'`인데 값이 null(=반경 내 대상이 실제로 없음 확인됨) +
  `treatCompleteNullAsWorst=true`(거리류만) → 관측 최댓값보다 나쁜 sentinel
  값으로 순위에 포함(방향 문제, 재분배 대상 아님)
- 그 외 null → 순위 계산에서 **완전히 제외**(재분배 대상)

**score-scale 완화**(§17, `scoreFromPercentile`): `score = 5 + percentile/100 × 90`
— percentile 0이 0점이 아니라 5점, 100이 100점이 아니라 95점(극단값 절벽 방지).

### 1-5. missing-data 재분배 (2단계, `category-helper.ts`)

1. **카테고리 내부**: sub-metric 하나가 결측(peer 내 유효 표본 < `PEER_SAMPLE_MEDIUM`=5)이면
   그 sub-weight를 나머지 sub-metric들에 비례 재분배. 전부 결측이면 카테고리
   자체가 `NOT_SCORED`(score=null).
2. **카테고리 간**(`calculate.ts`): `NOT_SCORED` 카테고리의 `baseWeight`를
   나머지 스코어된 카테고리에 비례 재분배(`usedWeightSum`으로 나눔).

두 단계 모두 **동일한 "사용 가능한 weight로 재정규화" 원칙**을 공유 — 별도
휴리스틱 없음.

### 1-6. coverage / confidence 규칙

```
coverage  = (스코어된 카테고리 baseWeight 합) / 100
MIN_TOTAL_COVERAGE = 0.6  → 미만이면 status='INSUFFICIENT_DATA'
confidence:
  HIGH   coverage>=0.85 AND HIGH-tier(peer 표본>=10) 카테고리 3개 이상
  MEDIUM coverage>=0.6
  LOW    그 외(이론상 INSUFFICIENT_DATA로 먼저 걸러짐 — 실제 노출 거의 없음)
```

### 1-7. peer tier / clipping / threshold

```
PEER_SAMPLE_HIGH   = 10  (표본 >=10 → HIGH tier)
PEER_SAMPLE_MEDIUM = 5   (표본 >=5  → MEDIUM tier, 계산 최소선. <5는 NOT_SCORED)
KAKAO_COUNT_CAP    = 45  (Kakao pageable_count 상한 — "45개 이상"으로 해석,
                          그 이상 차이는 변별 안 함)
```

### 1-8. peer fallback 구조 (`peer-groups.ts`)

```
LOCAL(조건 충족 시) → SIGUNGU(조건 충족 시) → REGION_WIDE(항상 마지막 안전망)
```

**중요 발견(§12 관련)**: `REGION_WIDE`는 이름과 달리 **부산 전체/타 지역이 아니라
SIGUNGU와 완전히 동일한 후보 집합**이다 — `calculate.ts`가 `resolvePeerPoolLevels()`의
`cohortOtherRegions` 인자를 항상 빈 배열로 호출하기 때문(코드 주석에 이미
명시된 known limitation, 이번 STEP에서 발견한 새 버그 아님 — 다만 지시사항
§12 "peer distortion" 분석의 핵심 재료이므로 명확히 기록).

---

## 2. 각 영역 raw feature 전수 (RAW → TRANSFORM → SCORE)

### TRANSPORT (`categories/transport.ts`, 출처: `ApartmentLocationFeature`)

| raw field | 수집 방식 | sub-weight | direction |
|---|---|---|---|
| `nearestSubwayDistanceM` | Kakao Local `category_group_code=SW8`(지하철역), `sort=distance`, 반경 1000m, **문서상 최상위 1건의 직선거리**(`Math.round(Number(documents[0].distance))`) | 45 | lowerIsBetter |
| `nearestSubwayName` | 위와 동일 호출의 `place_name`(점수에는 미사용, 설명 텍스트 전용) | — | — |
| `subwayCount1000m` | 위 호출의 `pageable_count`(최대 45로 상한) | 25 | higherIsBetter |
| `nearestBusStopDistanceM` | TAGO(국토교통부 대중교통 API), `collectNearestBusStop()` | 18 | lowerIsBetter |
| `busStopCount300m` | 위와 동일 | 12 | higherIsBetter |

**"환승역"/"몇 호선"/"급행 여부" 데이터 없음.** Kakao SW8 카테고리 검색
결과 1건(=가장 가까운 지하철 POI)만 쓴다 — **역 "출입구" 단위가 아니라
Kakao가 등록한 해당 역명의 POI 좌표(대체로 역 대표/중심점에 가까움) 기준
직선거리**다. 실제 출입구별 좌표 데이터는 이 프로젝트 어디에도 없다(§4에서
대신해모로 실측으로 재확인).

### LIVING (`categories/living.ts`, 출처: `ApartmentLocationFeature`, 전부 Kakao count)

| raw field | Kakao 카테고리/반경 | sub-weight |
|---|---|---|
| `martCount1000m` | MT1, 1000m | 20 |
| `convenienceCount500m` | CS2, 500m | 20 |
| `pharmacyCount500m` | PM9, 500m | 15 |
| `hospitalCount1000m` | HP8, 1000m | 10(45-cap 도달률 71~75%로 변별력 낮아 축소, 사용자 확인 이력) |
| `parkCount1000m` | 키워드 "공원", 1000m, 아파트/화장실 등 오탐 필터링 | 20 |
| `daycareKindergartenCount500m` | PS3(Kakao가 어린이집·유치원을 공식적으로 한 카테고리로 묶음, 분리 불가) | 15 |

전부 log1p 변환 후 순위 — **6개 항목 전부가 하나의 "생활편의" 점수로 뭉쳐져
있고, 병원/의료·마트/쇼핑·공원/문화가 서로 다른 축으로 분리되지 않는다**
(§7 지시사항이 예상한 그대로 코드로 확인됨). "문화시설"(영화관/도서관/체육시설
등)은 어떤 sub-metric에도 없음.

### PARKING (`categories/parking.ts`, 출처: `ApartmentMaster`)

```
parkingPerHousehold = ApartmentMaster.parkingCount / ApartmentMaster.totalHouseholds
```

단일 sub-metric, weight 100(재분배 대상 자체가 없음 — 이 값이 없으면 카테고리
전체가 NOT_SCORED). "연식 보정"/"peer percentile 외 별도 조정" 없음 — §11의
`useBuildYearDecadeBand=true`를 peer **선택** 단계에서만 쓰고, 점수 계산
로직 자체는 다른 카테고리와 동일한 순수 rank percentile이다(§5에서 이 점이
극단적 결과의 핵심 원인임을 실측으로 확인).

### COMPLEX (`categories/complex.ts`, 출처: `ApartmentMaster`)

| raw field | sub-weight | coverage(코드 주석 실측치) |
|---|---|---|
| `buildYear` | 50 | 100% |
| `totalHouseholds` | 30 | 15.2~34.4% |
| `mainBuildingCount` | 20 | 15.2~34.4% |

**핵심 발견**: 코드 주석이 스스로 명시하듯("대부분 apt는 buildYear 단독으로
카테고리 점수가 결정된다") totalHouseholds/mainBuildingCount의 coverage가
낮아, **"단지" 점수는 실무적으로 거의 buildYear(준공연도) 하나로 결정되는
경우가 대다수**다. FAR(용적률)/BCR(건폐율)/브랜드·시공사/커뮤니티시설/엘리베이터/
지하주차장 연결 여부는 **어느 것도 사용되지 않는다**(§20에서 grep으로 재확인,
0 hits). "단지"라는 이름이 사용자에게 암시하는 의미(규모·브랜드·상품성·설비)와
실제 내부 계산(≈준공연도 단독) 사이에 **의미론적 괴리가 크다** — 이름을 바꾸거나
실제로 그 의미에 맞는 feature를 추가해야 할 후보(§14/§28에서 다룸).

### SCHOOL ACCESS (`categories/school-access.ts`, 출처: `ApartmentLocationFeature`)

| raw field | 수집 | sub-weight |
|---|---|---|
| `nearestElementaryDistanceM` | Kakao SC4(학교) 검색 결과 중 이름에 "초등학교" 포함, 최근접 1건 | 60 |
| `elementaryCount1000m` | 위 필터 결과 개수 | 40 |

코드 주석: **"학교 접근성만 — 학군/교육수준 아님"**(명시적 자기 제약). **공식
통학구역, 중학교 학교군, 유치원, 고등학교, 학원가 — 전부 Score V1에 들어가지
않는다**(코드로 확정, 추측 아님). SCHOOL V2에서 구축된 공식 통학구역
artifact(`data/education/attendance-zone/`)/유치원 데이터(`Kindergarten` 367건)는
`apartment-score/` 어디에서도 import되지 않는다(grep 0 hits) — 두 시스템이
완전히 분리돼 있다.

---

## 3. 준공연도/연식 반영 여부 — 코드 전수 검색 결과

```
completionYear/builtYear/ageYears 등 문자열 검색 → apartment-score 내
buildYear 필드로만 존재(별도 "연식/ageYears" 파생 컬럼 없음, buildYear를
원본 그대로 percentile 계산에 씀)

판정: DIRECT — complex 카테고리(가중치 15) 내부에서 buildYear가 50%
      sub-weight를 차지. 단, 위에서 확인했듯 totalHouseholds/mainBuildingCount
      coverage가 낮아 실질적으로 이 15% 전체가 buildYear 단독으로 결정되는
      경우가 대다수 → "총점 100 중 최대 약 15점, 대부분의 단지에서 거의
      그대로 15점 전체"가 연식의 직접 영향력.

FAR/BCR/브랜드/시공사/엘리베이터/지하주차장연결: NOT_USED(§20 grep 0 hits,
schema에도 FAR/BCR 컬럼 자체가 없음 — 단, apt 상세페이지(`apt-building-info.ts`)는
건축물대장에서 이 값을 이미 실시간 조회하고 있어 SOURCE_AVAILABLE_NOT_INGESTED로
분류, §13 참고).
```

**추측이 아니라 코드 확정: 연식은 "간접"이 아니라 "직접" 반영되지만, 총점
100점 중 최대 15점(그것도 대부분 households/building count가 없어 정확히
15점 그대로) 뿐이고, 나머지 85점(교통30+생활25+주차15+학교15)에는 연식이
전혀 들어가지 않는다** — 사용자가 "신축인데 왜 구축보다 점수가 낮지?"라고
느끼는 것은 데이터 누락이 아니라 **가중치 설계상 연식의 총점 기여도가
작다는 사실 자체**다.

---

## 4. 역세권 계산 방식 해부 — 대신해모로센트럴 실측

```
aptSeq: 26140-1356, 서구 서대신동2가, 2022년 준공, 733세대
ApartmentLocationFeature 실측(2026-08-19 수집):
  nearestSubwayDistanceM = 140m
  nearestSubwayName      = "서대신역 부산1호선"
  subwayCount1000m       = 2
```

**140m는 절대적으로 매우 가까운 거리다(도보 2분 미만)** — 사용자의 "엘리베이터에서
내려와 출입구까지 매우 가까운 초역세권" 체감과 raw 데이터 자체는 모순되지
않는다. 문제는 raw 값이 아니라 **peer 비교 단계**에서 발생한다:

```
LOCAL peer(같은 동, 서대신동2가, 19개 단지) nearestSubwayDistanceM 분포:
  [38, 61, 65, 78, 108, ...(중략)..., 228, 235, 272, 274, 285]
target(140m) percentile = 61.1%  →  transport 내 이 sub-metric 기여 score ≈ 60
```

**서대신동2가 자체가 서대신역을 낀 초역세권 밀집 동네라, 대신해모로(140m)보다
더 가까운 단지가 최소 8개(38~108m) 이미 존재한다.** 즉 "역세권 62점"은
"교통이 나쁘다"는 뜻이 아니라 **"이미 다들 역과 가까운 동네 안에서는 중간
정도"**라는 뜻이다 — 사용자가 이 62라는 숫자만 보고 "역에서 멀구나"로
오해할 위험이 크다(§16 explainability 문제와 직결).

`nearestSubwayName`은 두 벤치마크 단지 모두 **"서대신역 부산1호선"으로
동일**하다(협성르네상스도 같은 역, 306m) — Kakao SW8 카테고리 검색이
"출입구별"이 아니라 "역명 단위 POI"로 응답한다는 근거다. 실제 어느 출입구가
어느 단지에 더 가까운지는 이 raw 데이터로 구분할 수 없다 — **station-center
기준으로 인한 왜곡 가능성이 있다는 사용자 우려는 구조적으로 근거가 있다**(다만
이번 STEP은 실제 출입구 좌표 데이터가 없어 왜곡의 "크기"까지는 확정할 수
없음, NOT_AVAILABLE로 분류).

버스: `nearestBusStopDistanceM=60m`(peer percentile 64.7%), `busStopCount300m=25`(peer
percentile **100%** — LOCAL 동 안에서 버스정류장 개수 1위). subway count
sub-metric은 peer 19곳 전부 값이 2로 동일해 percentile 50(변별력 없음).

---

## 5. 주차 18 vs 95 — peer percentile 완전 분해

```
대신해모로(2022): parkingPerHousehold = 800/733 = 1.091
협성르네상스(2001): parkingPerHousehold = 775/489 = 1.585
```

**핵심 메커니즘**: parking의 LOCAL peer는 "같은 구·군 + 같은 준공연도
10년대(decade band)"다(§11 코드 설계, 그 자체는 신축/구축이 섞이는 걸
막으려는 합리적 의도). 그런데 이 좁힌 peer pool이 **매우 작고(대신해모로 8건,
협성 5건), households/parkingCount가 둘 다 존재하는(=식별 가능한) 단지만
남으면 표본이 극소**해진다.

```
대신해모로(2020년대, 서구) 유효 표본 8건, 오름차순:
  1.09  1.09  1.13  1.16  1.27  1.28  1.32  2.05
  ↑target(공동 최하위) → percentile 14.3 → score 17.86 ≈ 18(실측 정확히 일치)

협성르네상스(2000년대, 서구) 유효 표본 5건, 오름차순:
  0.69  0.96  1.04  1.52  1.58
                          ↑target(최댓값) → percentile 100 → score 95(실측 정확히 일치)
```

**주차 하나가 전체 점수를 뒤집는 구조인가 — 그렇다, 다음 3가지가 결합될 때만.**
(1) parking baseWeight 자체는 15%로 다른 카테고리와 같으나, (2) **percentile이
순수 순위(pure rank)라 절대 차이가 아무리 작아도 표본이 작으면 5점↔95점처럼
극단으로 벌어질 수 있고**, (3) **peer 표본이 극소(5~13건)일 때 이 민감도가
극대화**된다. 1.09대와 1.58대라는 "실생활 체감으로는 둘 다 나쁘지 않은"
차이가, 각자의 10년대 코호트 안에서는 정반대 극단(최하위 vs 최상위)이 된 것 —
**데이터 오류가 아니라 설계 그대로 동작한 결과**이지만, 사용자가 "1.09대가
정말 하위 15%인가?"라고 물으면 "부산 전체가 아니라 '서구+2020년대 준공' 8개
단지 중에서"라는 맥락이 반드시 필요하다(§16).

참고 threshold 감(다른 단지 실측 사례, §11 Seo-gu ranking 데이터에서 발견):
`브라운스톤하이포레`(2020, 554세대)는 parkingPerHousehold가 낮아 parking=5,
그 자체로 전체 표본 최하위권이었다 — 대신해모로와 같은 "신축 소표본" 패턴이
Seo-gu 안에서 **최소 2건 반복**됨을 확인(우연한 1회성 사례가 아님).

---

## 6. 단지점수 95 vs 56 해부

```
대신해모로: buildYear=2022, totalHouseholds=733, mainBuildingCount=9 → complex=95
협성르네상스: buildYear=2001, totalHouseholds=489, mainBuildingCount=10 → complex=56
```

두 단지 모두 households/mainBuildingCount 데이터가 **실제로 존재**해(§2에서
확인한 15~34% coverage 그룹에 둘 다 포함) 3개 sub-metric이 전부 반영된
케이스다. peer는 LOCAL(같은 동) — 대신해모로는 서대신동2가, 협성은
서대신동3가로 서로 다른 동이라 직접 비교 표본은 다르지만, 방향성은
`buildYear: higherIsBetter`이므로 **2022년생이 2001년생보다 훨씬 유리한
것은 설계 의도 그대로**다(§6 "세대수 하나에 과도 의존"이라는 사용자 추측은
부분적으로만 맞음 — 실제로는 buildYear가 지배적).

"단지"라는 이름의 의미론 평가(§6 지시사항): 사용자가 "단지"라는 말에서
기대하는 연식/브랜드/커뮤니티/규모/용적률/건폐율/주차/상품성 중, 실제
반영되는 것은 **연식(강함) + 세대수(약함, coverage 낮음) + 동수(약함,
coverage 낮음)** 뿐이고, 브랜드/커뮤니티/용적률/건폐율/주차(별도 카테고리로
이미 분리됨)는 전혀 없다 — **이름과 실제 의미가 상당히 어긋난다.**

---

## 7. 생활편의 점수 해부

```
대신해모로: martCount1000m=2, convenienceCount500m=10, pharmacyCount500m=8,
            hospitalCount1000m=45(상한 도달), parkCount1000m=4,
            daycareKindergartenCount500m=6  →  living=36
협성르네상스: martCount1000m=2, convenienceCount500m=9, pharmacyCount500m=7,
            hospitalCount1000m=45(상한 도달), parkCount1000m=8,
            daycareKindergartenCount500m=6  →  living=38
```

두 단지가 서로 raw 값이 거의 비슷하다(둘 다 병원 45개 상한 도달, 마트 2개
동일) — living 점수가 비슷한(36 vs 38) 것은 **peer 비교 왜곡이 아니라 실제로
두 단지 주변 생활 인프라 밀도 자체가 비슷하기 때문**으로 판단된다(다른
카테고리와 달리 이 케이스에서는 특이 왜곡을 발견하지 못함). 다만 구조적으로
확인한 문제: **병원/의료 + 마트/쇼핑 + 편의점 + 약국 + 공원 + 어린이집·유치원
6개 항목이 전부 하나의 log1p count 합산으로 뭉쳐져 있어, "병원은 많은데
공원이 없다"/"마트는 없는데 편의점만 많다" 같은 구성상 강약을 사용자가
전혀 구분할 수 없다.** 경쟁사(호갱노노류) UX가 "의료"/"쇼핑"/"문화"를
별도 축으로 보여주는 것과 대비된다(§15).

---

## 8. 학교 접근성 점수 해부

```
대신해모로: nearestElementaryDistanceM=545m, elementaryCount1000m=4 → schoolAccess=22
협성르네상스: nearestElementaryDistanceM=341m, elementaryCount1000m=3 → schoolAccess=11
```

**얼핏 역설적**: 341m(협성)가 545m(대신해모로)보다 절대적으로 더 가까운데
협성이 더 낮은 점수(11<22)를 받았다. peer LOCAL(동) 분포로 확인:

```
협성(서대신동3가, peer 29곳) nearestElementaryDistanceM 분포:
  [50, 72, 80, 121, ..., 296, 341]  ← target(341)이 정확히 최댓값(꼴찌) → percentile 0.0
대신해모로(서대신동2가, peer 19곳) 분포:
  [270, 283, 307, ..., 545, ..., 711] ← target(545)은 중하위(22.2%)
```

§4/§5와 **완전히 동일한 메커니즘**이다 — 협성의 동(서대신동3가)은 초등학교가
극도로 밀집한(최근접 50m짜리 단지도 있는) 동네라, 341m라는 객관적으로
나쁘지 않은 거리가 그 동 안에서는 꼴찌가 된다. **"학교 접근성 22 vs 11"이
"대신해모로가 학교에 실제로 더 가깝다"는 뜻이 절대 아니다** — 오히려 반대
(341m<545m)다. 이 항목의 코드 주석("학군/교육수준 아님, 접근성만")은 정확하지만,
현재 UI가 이 숫자 하나만 노출한다면 사용자는 필연적으로 오독한다.

---

## 9. 세 대표단지 full trace

`scripts/apartment-score/step0-01-benchmark-trace.ts`(read-only, calculateApartmentScore()
그대로 호출) 실행 결과:

| | 대신해모로센트럴 | 협성르네상스(서구) | 구덕금호 |
|---|---|---|---|
| aptSeq | 26140-1356 | 26140-51 | 26140-11 |
| 동 | 서대신동2가 | 서대신동3가 | 동대신동3가 |
| buildYear | 2022 | 2001 | 2001 |
| totalHouseholds | 733 | 489 | **null**(미확보) |
| parkingCount | 800 | 775 | **null** |
| parkingPerHousehold | 1.091 | 1.585 | N/A |
| mainBuildingCount | 9 | 10 | **null** |
| nearestSubwayDistanceM(역명) | 140(서대신역) | 306(서대신역) | 615(동대신역) |
| nearestElementaryDistanceM | 545 | 341 | 201 |
| **transport** | 62(LOCAL,n=19,HIGH) | 79(LOCAL,n=29,HIGH) | 55(LOCAL,n=8,HIGH) |
| **living** | 36(LOCAL,n=19,HIGH) | 38(LOCAL,n=29,HIGH) | 59(LOCAL,n=8,HIGH) |
| **parking** | 18(LOCAL,n=8유효,HIGH) | 95(LOCAL,n=5유효,HIGH) | **NOT_SCORED**(households null) |
| **complex** | 95(LOCAL,n=19,HIGH) | 56(LOCAL,n=29,HIGH) | 56(LOCAL,n=8,MEDIUM→buildYear단독) |
| **schoolAccess** | 22(LOCAL,n=19,HIGH) | 11(LOCAL,n=29,HIGH) | 41(LOCAL,n=8,HIGH) |
| coverage | 1.00 | 1.00 | **0.85**(parking 15% 제외 재분배) |
| confidence | HIGH | HIGH | MEDIUM |
| **total** | **48** | **57** | **54** |

가중합 검증(30/25/15/15/15 그대로 대입): 대신해모로
`62×.3+36×.25+18×.15+95×.15+22×.15=47.85→48`, 협성 `79×.3+38×.25+95×.15+56×.15+11×.15=57.5→57` —
**공식이 정확히 문서대로 동작하고 있음을 재확인**(숨은 버그·오타 없음).

**구덕금호는 이번 조사로 새로 드러난 사례**: 건축물대장 총괄표제부 데이터
(households/parkingCount/mainBuildingCount)가 전부 미확보라 parking이
완전히 NOT_SCORED, complex는 buildYear 단독(2001년생이라 협성과 우연히
동일한 56점)으로만 계산된다 — coverage 85%로 하락, confidence MEDIUM.
"데이터 없음"이 정직하게 반영된 정상 동작(§13 CLAUDE.md 원칙 그대로).

---

## 10. Seo-gu(서구) 171개 단지 ranking 상식 정합성 검사

`scripts/apartment-score/step0-03-seogu-ranking.ts` 실행(read-only, 171/171 OK).

**TOP 30**: 최고점 75(골든캐슬, 2005, T88/C95), 60점대 초중반이 대다수 —
극단적으로 튀는 1위 없이 완만한 분포. **BOTTOM 30**: 1993~2003년생 소형/구축
위주, transport/living/complex가 골고루 낮아 raw feature와 맞아떨어짐(명백한
모순 없음).

**교차 검증(같은 "신축"/"대단지" 카테고리 안에서 재확인)**: 대신해모로센트럴은
"신축(2020+) TOP 10"에서 9위(10건 중), "대단지(500+) TOP 10"에서 5위(10건
중)에 그친다 — **자신에게 유리해야 할 필터 안에서도 하위권**이다. 같은
신축/대단지 그룹의 상위 단지(`e편한세상송도더퍼스트비치` 60점, `힐스테이트이진베이시티` 55점)는
parking(56/95)·living(48/38)이 대신해모로(18/36)보다 훨씬 높다 — **총점 48이
"신축/대단지에 대한 공식의 구조적 불이익"이 아니라 "이 특정 단지의 parking/living
raw 값이 같은 신축군 안에서도 낮다"는 개별 사실**임을 확인했다.

**FLAG 결과**:
- `buildYear>=2020인데 complex<50`(신축인데 단지점수 낮음): **0건** — complex
  카테고리는 monotonic하게 신축을 우대(모순 없음).
- `buildYear<=2005인데 complex>=80`(구축인데 단지점수 매우 높음): **1건** —
  `골든캐슬`(2005, complex=95). LOCAL peer(동대신동2가)가 상대적으로 더 오래된
  단지 위주라 2005년생이 그 동 안에서는 "신축 쪽"으로 분류된 것 — §5/§8과
  동일한 "peer 상대성" 패턴의 3번째 실제 사례.
- **주차 취약(≤15) 목록에 브라운스톤하이포레(2020년, 554세대, parking=5)** —
  대신해모로와 같은 "신축 소표본 극단값" 패턴이 최소 2건 반복됨을 확인.

**결론**: Seo-gu 171건 전체를 훑어봐도 "formula가 깨졌다"고 볼 명백한 반례는
없다. 대신해모로/협성 비교가 이상해 보이는 이유는 **버그가 아니라 (a) parking의
극소 표본 민감도(§5), (b) LOCAL(동) peer의 극단적 이질성(§4/§8) 두 가지
설계 속성이 동시에 이 두 단지에서 강하게 작용한 것**이다.

---

## 11. 부산 전체 Score/subscore distribution + district bias + correlation

`scripts/apartment-score/step0-04-busan-distribution.ts` 실행(read-only, 부산
전체 ApartmentMaster 3,402건, calculateApartmentScore() 순회, 3,401/3,402 OK —
1건은 §5 SCHOOL V2 최종 QA에서도 확인된 좌표 미확보 단지와 동일 케이스로 추정).

### 11-1. TOTAL SCORE 분포

```
n=3401  mean=49.9  median=51  p10=34  p25=42  p75=58  p90=64  min=14  max=81
```

중앙에 과도하게 몰리지 않고 완만한 종형 분포(p10~p90 폭 30점) — score-scale
완화(§1-4, 5~95 clipping)가 의도대로 작동해 극단값 절벽이 없다.

### 11-2. 5개 subscore 분포

| domain | coverage | mean | median | p10 | p90 | ≤10점 비율 | ≥90점 비율 |
|---|---|---|---|---|---|---|---|
| transport | 100.0%(3401/3401) | 50.1 | 50 | 26 | 73 | 0.6% | 0.4% |
| living | 100.0%(3401/3401) | 49.8 | 51 | 30 | 68 | 0.7% | **0.0%** |
| **parking** | **25.3%(859/3401)** | 49.1 | 50 | **10** | **88** | **10.4%** | **8.5%** |
| complex | 100.0%(3401/3401) | 50.0 | 50 | 15 | 84 | 5.4% | 4.9% |
| school | 100.0%(3401/3401) | 49.8 | 51 | 21 | 76 | 1.9% | 0.7% |

**parking이 유일하게 낮은 coverage(25.3% — households+parkingCount가 동시에
확보된 단지만) + 압도적으로 넓은 분포(p10~p90 폭 78점, 다른 도메인은
40~55점)를 보인다.** ≤10점과 ≥90점에 몰린 비율 합이 **18.9%**(다른 도메인은
전부 6% 미만) — §5/§10에서 대신해모로/협성/브라운스톤하이포레 3건으로
확인한 "parking 극단 편향"이 **개별 사례가 아니라 부산 전체 데이터셋의
구조적 특성**임을 정량적으로 재확인했다. living은 반대로 ≥90점이 0건 —
KAKAO_COUNT_CAP(45) 상한 근처에서 여러 sub-metric이 동시에 몰려 최상위권을
찍기 어려운 구조로 추정(원인 확정은 이번 STEP 범위 밖, 상관관계까지만 확인).

### 11-3. 구·군별 편향(district bias)

| 구·군 | n | mean | median |
|---|---|---|---|
| 강서구 | 43 | 48.2 | 47 |
| 금정구 | 308 | 50.0 | 52 |
| 기장군 | 152 | 48.7 | 49 |
| 남구 | 253 | 50.0 | 49 |
| 동구 | 99 | 49.8 | 50 |
| 동래구 | 314 | 50.0 | 50 |
| 부산진구 | 404 | 50.0 | 52 |
| 북구 | 173 | 50.0 | 51 |
| 사상구 | 151 | 49.9 | 51 |
| 사하구 | 338 | 50.1 | 50 |
| 서구 | 171 | 50.5 | 52 |
| 수영구 | 251 | 50.0 | 49 |
| 연제구 | 244 | 50.0 | 50 |
| 영도구 | 133 | 51.3 | 51 |
| 중구 | 59 | 50.0 | 49 |
| 해운대구 | 308 | 49.1 | 51 |

**mean이 16개 구·군 전부 48.2~51.3 범위 안(폭 3.1점)에 몰려 있다** — 이건
LOCAL peer가 기본적으로 "같은 동"(또는 parking만 같은 구+연대)이라 각
구·군 내부에서 스스로 정규화되기 때문에 나타나는 **구조적으로 당연한
결과**이지, 실제 지역 간 절대적 우열이 사라진다는 뜻은 아니다(§12/§19
absolute-vs-relative 논의와 직결 — 현재 시스템은 애초에 "지역 간 절대
비교"를 하지 않도록 설계돼 있어 district bias 자체가 낮게 나오는 게 당연함).

### 11-4. correlation(단순 Pearson, 인과 아님)

```
buildYear vs totalScore     = 0.424 (n=3401)  — 중간 정도 양의 상관
totalHouseholds vs totalScore = 0.229 (n=1309) — 약한 양의 상관
buildYear vs complexScore   = 0.825 (n=3401)  — 매우 강한 양의 상관
parkingPerHousehold(raw) vs parkingScore = 0.635 (n=859) — 중간~강한 양의 상관(방향 정상)
```

`buildYear ↔ complexScore = 0.825`가 §3/§6에서 코드로 확인한 "complex는
사실상 buildYear 단독 도메인"이라는 결론을 **부산 전체 데이터로 정량
재확인**한다. `buildYear ↔ totalScore = 0.424`로 크게 낮아지는 것은
complex의 총점 가중치가 15%뿐이기 때문(예상과 일치, 숨은 이중가중 없음).
`parkingPerHousehold ↔ parkingScore = 0.635`는 방향이 뒤집히지 않았음을
확인하는 sanity check(계산 로직 오류 없음 재확인).

---

## 12. 현재 peer system 분석

### 12-1. 구조(코드 그대로)

```
LOCAL(non-parking: 같은 동 / parking: 같은 구·군+준공연대)
  → SIGUNGU(같은 구·군 전체)
  → REGION_WIDE(현재 실제로는 SIGUNGU와 동일 — §1-8 기존 known limitation)
```

**모든 카테고리가 항상 상대(peer-relative) 값만 쓴다 — 절대값 기반 점수는
어디에도 없다.** §16 design proposal의 출발점.

### 12-2. peer distortion 실측 사례 (이번 STEP에서 3건 확인, §4/§5/§8/§10)

| 사례 | 현상 | 원인 |
|---|---|---|
| 대신해모로 transport 62 | 140m(절대적으로 매우 가까움)인데 percentile 61% | 서대신동2가 자체가 초역세권 밀집지라 peer 중 8곳이 더 가까움 |
| 대신해모로/협성 parking 18/95 | 1.09대/1.58대(둘 다 나쁘지 않은 절대 수치)가 5점/95점 근접 극단 | 준공연대별 peer 표본이 5~8건으로 극소, 순수 rank라 민감도 극대 |
| 협성 schoolAccess 11 | 341m(대신해모로 545m보다 가까움)인데 더 낮은 점수 | 협성의 동(서대신동3가)이 초등학교 극밀집지라 341m가 그 안에서 꼴찌 |
| 골든캐슬 complex 95 | 2005년생(21년차)인데 거의 만점 | LOCAL peer(그 동)가 더 노후한 단지 위주라 상대적으로 신축 취급 |

**ABSOLUTE vs PEER RELATIVE 제안(§12 지시사항, proposal만)**:

| 카테고리 | 현재 | 제안 |
|---|---|---|
| transport(거리류) | 순수 peer relative | **절대 밴드(예: VERY_CLOSE/CLOSE/NORMAL — school-access-sentence.ts에 이미 있는 패턴)를 병기**하지 않으면 "역이 가까운데 낮은 점수"라는 모순 문장이 계속 발생 |
| living(count류) | 순수 peer relative | count류는 절대 상한(KAKAO_COUNT_CAP)이 이미 있어 상대적으로 덜 위험 — 유지 가능 |
| parking | 순수 peer relative, 표본 극소 시 극단화 | 표본이 작을 때(<10) 절대적 참고선(예: 전국/부산 평균 0.7~1.0대 등, 단 이 평균값 자체가 이번 STEP에서 산출되지 않았으므로 실제 채택 전 검증 필요)을 함께 보여줘 percentile 단독 의존 완화 |
| complex(buildYear) | 순수 peer relative | 절대 연식(예: "OO년차")을 이미 원본 그대로 갖고 있으니 그대로 병기 — 계산 변경 없이 표시만 추가 가능 |
| schoolAccess | 순수 peer relative(단, explain.ts 레이어는 이미 절대 밴드 보유) | **score 자체는 relative지만, 이미 구현된 absolute band(§8, school-access-sentence.ts)를 총점 그대로도 아니라 UI에 항상 노출하도록 확장** — 사실상 4개 카테고리 중 가장 먼저 V2 패턴을 적용할 수 있는 선례 |

---

## 13. Score V1에서 빠진 평가요소 inventory

분류: A=NOW_DATA_AVAILABLE(이미 raw 데이터 있음, Score만 미반영) /
B=DERIVABLE_SAFELY(기존 데이터로 안전 계산 가능) /
C=SOURCE_AVAILABLE_NOT_INGESTED(공식 소스는 있으나 이 프로젝트에 적재 안 됨) /
D=NOT_AVAILABLE / E=LEGAL_REVIEW / F=MANUAL_UNSAFE.

### 입지

| 요소 | 분류 | 근거 |
|---|---|---|
| 지하철 접근(거리/개수) | A | 이미 Score에 반영(§2) |
| 버스 | A | 이미 Score에 반영 |
| 주요 업무지구 접근 | D | 업무지구 좌표/정의 자체가 이 프로젝트에 없음 |
| 평지/경사 | D | 고도 데이터 없음(DEM 등 신규 소스 필요, 원칙8 유료API 금지 고려 시 신중 검토 대상) |
| 중심상권 접근 | D | "상권" 정의/POI 밀집도 지표 없음(생활편의 count와 별개) |

### 단지

| 요소 | 분류 | 근거 |
|---|---|---|
| 준공연도/연식 | A | 이미 Score에 반영(§3, buildYear) |
| 세대수 | A | 이미 반영(coverage 낮음) |
| 동수 | A | 이미 반영(coverage 낮음) |
| 주차 | A | 이미 반영(별도 카테고리) |
| 용적률(FAR) | **C** | `apt-building-info.ts`(건축물대장 API)가 이미 이 값을 실시간 조회 중(다른 기능, apt 상세페이지) — Score 파이프라인에 조인만 하면 A로 승격 가능 |
| 건폐율(BCR) | **C** | 위와 동일 |
| 브랜드/시공사 | D | 어떤 테이블에도 시공사 필드 없음 |
| 커뮤니티시설 | D | 별도 소스 필요(관리사무소/분양 공고 등 비정형) |
| 엘리베이터 | D | 데이터 없음 |
| 지하주차장 연결 | D | 데이터 없음 |

### 교육

| 요소 | 분류 | 근거 |
|---|---|---|
| 공식 통학구역 | **C** | SCHOOL V2가 이미 부산 3,402단지 전수 artifact로 갖고 있음(`data/education/attendance-zone/`) — Score와 완전 분리 운영 중, 조인만 하면 A |
| 초등학교 접근(거리) | A | 이미 Score에 반영(단, §16처럼 절대/상대 분리 필요) |
| 중학교 학교군 | **C** | SCHOOL V2 artifact에 존재, Score 미반영 |
| 유치원 | **C** | `Kindergarten`/`KindergartenStat`(367건) 존재, Score 미반영 |
| 어린이집 | D | ingestion 자체가 아직 없음(SCHOOL V2 C3A 진행 중) |
| 학원가 | D | 데이터 없음 |
| 고등학교 | **C** | SCHOOL V2가 NEIS 기반 위치는 갖고 있으나 "접근성 feature"로 가공되진 않음 |

### 생활

| 요소 | 분류 | 근거 |
|---|---|---|
| 의료 | A | 이미 반영(hospital) |
| 쇼핑 | A | 이미 반영(mart) |
| 마트 | A | 이미 반영 |
| 문화(영화관/도서관/체육시설 등) | D | 별도 Kakao 카테고리 미수집, 현재 "공원"만 문화/여가 프록시 |
| 공원 | A | 이미 반영 |
| 생활시설(편의점/약국) | A | 이미 반영 |

### 시장

| 요소 | 분류 | 근거 |
|---|---|---|
| 실거래 가격 | A | `ApartmentMarketFeature`(medianPricePerM2) 존재, market 카테고리가 이미 참조(단, weight=0으로 총점 미반영, 의도적) |
| 거래량 | A | 위와 동일(transactionCount12m) |
| 전고점 대비 | D | "전고점" 계산 로직 자체가 이 프로젝트 score 레이어에 없음(단, `TradeHistory` 원본 데이터로 파생 가능성 있어 향후 B로 재평가 여지) |
| 가격변동률 | D | 별도 계산 없음(단, TradeHistory 시계열로 B 승격 가능성) |
| 매물 | D | 매물(호가) 데이터 소스 없음(실거래만 있음) |
| 전세가율 | **C** | `TradeHistory`에 매매/전세 거래가 섞여 있어 파생 가능해 보이나, 이번 STEP에서 실제 코드 검증은 안 함(stats/dashboard route 등 다른 기능에서 유사 계산 흔적 발견, §24 참고 — 재검증 필요) |
| 공급/미분양 | D | 이 프로젝트에 미분양 통계 소스 없음(청약 관련 Presale 테이블은 신규 분양 정보이지 미분양 통계 아님) |

### 미래

| 요소 | 분류 | 근거 |
|---|---|---|
| 재개발/재건축 | **C** | `RedevelopmentProject`/`RedevelopmentSourceRecord` 테이블 이미 존재(별도 기능), Score 미반영 |
| 교통호재 | D | 계획 단계 교통망 데이터 없음 |
| 개발계획 | D | 데이터 없음 |

---

## 14. "점수에 넣을 것"과 "별도 지표" 분리 (proposal only)

| 후보 | 성격 | 근거 |
|---|---|---|
| **CORE_SCORE** | 현재 5개 카테고리(transport/living/parking/complex/schoolAccess) 유지 | 실측 coverage가 이미 높고 사용자 의사결정에 직결 — 그대로 승계, weight/구성은 별도 재설계 |
| **EDUCATION_SCORE**(신설 후보) | 통학구역+학교군+유치원+고등학교를 별도 축으로 | SCHOOL V2 데이터가 이미 완비돼 있고, "학교 접근성"(거리)과 "교육 환경"(공식 배정/학교군)은 서로 다른 질문이라 하나로 섞으면 §8의 오독이 재발할 위험 |
| **COMPLEX_QUALITY**(재정의 후보) | FAR/BCR 편입 시 "단지" 재정의, 또는 이름 자체를 "연식"으로 명확화 | §6 의미론적 괴리 해소 |
| **MARKET_TEMPERATURE**(display-only 유지) | 현재 이미 weight=0으로 분리돼 있음 — 좋은 선례, 그대로 유지 권장 | 원칙7 "가격이 비싸다는 이유만으로 좋은 점수 금지" 충족 |
| **INVESTMENT_SCORE**(신설 후보, 신중) | 전고점/변동률/재개발 반영 시 실거주 점수와 분리 | 원칙6 "실거주와 투자 개념을 무작정 혼합하지 않음" |
| **PERSONALIZED_SCORE**(장기 후보) | 사용자가 가중치를 조절하는 개인화 버전 | 원칙12, 이번 STEP 범위 아님, 방향만 기록 |
| **DISPLAY_ONLY** | 절대 밴드(초근접/근접/보통/원거리), 원본 raw fact | 현재 school-access-sentence.ts가 이미 이 패턴의 선례 |

이번 STEP은 **분류 proposal만** — 실제 스키마/카테고리 재편은 하지 않았다.

---

## 15. 경쟁사 비교 UX 관찰 (호갱노노류 화면, 사용자 제공)

정확한 scoring formula는 화면만으로 알 수 없어 **추정하지 않는다.** 관찰
가능한 UX 원칙만 참고:

- 교육/교통/의료/쇼핑/문화 **5개 축을 radar(레이더 차트) 형태로 동시 비교** —
  "한눈에 강약 비교"가 핵심 가치.
- 이집 V1의 5개 카테고리(교통/생활/주차/단지/학교)와 **축 구성 자체가 다르다**:
  이집은 "생활"이 의료+쇼핑+문화를 전부 흡수한 단일 축이라, 경쟁사처럼
  "의료는 강한데 문화는 약하다"는 세분화된 비교를 UI 레벨에서 원천적으로
  할 수 없다(§7 확인 사실과 연결).

**E-jip 강화 proposal(§15 지시사항)**:
1. 총점 하나(유지) + 영역별 score(유지, 단 §16 explainability 보강)
2. **raw evidence 상시 노출**(예: "지하철 140m", "세대당 1.09대") — 현재도
   일부 briefing 텍스트에 있으나 구조화된 data contract로 격상 필요(§16)
3. **"왜 차이가 나는지" 비교 문장** — 두 단지를 나란히 볼 때 "A는 주차가
   B보다 77점 높음, 그 이유는 준공연대별 비교에서 B가 상위 100%이기 때문" 같은
   자동 생성 diff 텍스트(현재 `briefing.ts`가 단일 단지 설명만 하고 비교
   전용 로직은 없음 — 신규 필요)
4. **목적별 score**(§14 CORE/EDUCATION/INVESTMENT 분리) — 경쟁사보다 더 세분화된
   비교가 가능해지는 지점
5. 주요 장단점 자동 요약(이미 `briefing.ts`의 strengths/caution이 유사 기능 —
   비교 UX로 확장 가능)
6. 가격까지 비교(이미 `market` 카테고리 데이터 존재, display-only 원칙 유지한 채
   비교 화면에 병기 가능)

---

## 16. 점수 설명가능성(explainability) 문제 — data contract 제안

**현재 이미 존재하는 좋은 선례**: `school-access-sentence.ts`가 "절대 사실
(리드 문장) → 상대 비교(보조 문장)" 순서를 강제하고, "가깝지만 상대적으로는
낮다"처럼 **모순되는 단독 문장을 구조적으로 방지**하는 템플릿을 이미 구현해
뒀다(§8). **V2의 핵심 설계 방향은 이 패턴을 5개 카테고리 전부로 일반화하는
것**이지 처음부터 새로 만드는 게 아니다.

data contract 제안(예시, §16 지시사항 형식 그대로):

```
교통 91
"지하철 출입구 약 140m" (절대 fact, raw 그대로)
"서대신동2가 내에서는 중간 정도"(상대, peerLevel 텍스트화)

주차 62
"세대당 1.09대"(절대 fact)
"서구 2020년대 준공 단지 중에서는 낮은 편"(상대 + peer 정의를 문장에 명시 —
현재는 "서구 내에서"로만 뭉뚱그려져 실제 비교 기준(준공연대 필터)이
숨겨져 있음, §16 explainability의 핵심 결함)

단지 95
"2022년 준공(4년차)"(절대 fact, buildYear 그대로)
"서대신동2가 내 최상위권"(상대)
```

**각 domain에 필요한 최소 필드(제안, 스키마 변경은 이번 STEP에서 하지 않음)**:
`rawFact`(원본 값+단위), `comparisonBasis`(peer 정의를 사람이 읽는 문장으로:
"서구 2020년대 준공 단지"처럼 실제 peerLevel+decade band까지 노출),
`strength`/`weakness`(있으면), `confidence`(카테고리별 peerTier).

---

## 17. 현재 Score V1 trust decision

```
판정: B. KEEP_BETA_WITH_WARNING
```

**근거**:
- **ranking distortion**: §10 Seo-gu 171건 전수 검사에서 "formula가 깨졌다"고
  볼 명백한 monotonicity 위반은 발견하지 못함(FLAG 조건 중 1건만, 그것도
  peer 상대성으로 설명 가능). 완전히 신뢰 불가능한 수준은 아니다.
- **missing major factors**: 학교 접근성이 "거리"만이고 "학군/배정"이 아님,
  단지가 사실상 "연식"만인 점 등은 **버그가 아니라 아직 안 채운 설계
  공백**(§13/§14) — URGENT_FIX보다는 "다음 버전에서 구조적으로 보강"이 맞는
  대응.
- **raw data correctness**: §2~§9에서 확인한 raw 값(거리/개수/세대수) 자체는
  전부 정확했다(계산 오류 없음, 공식이 문서와 정확히 일치).
- **extreme subscore sensitivity**: §5에서 확인했듯 parking처럼 표본이
  극소(5~13건)인 카테고리는 **작은 절대 차이가 5점↔95점으로 벌어질 수
  있다** — 이것은 실제 사용자 신뢰를 해칠 수 있는 진짜 리스크이며, "경고"
  수준의 조치가 필요하다(예: peer 표본 크기를 총점 옆에 함께 보여주거나,
  §16 explainability 보강으로 왜 그런지 설명).
- **user interpretation risk**: §4/§8에서 확인한 "가까운데 낮은 점수" 류
  역설은 explainability 부재와 결합하면 **"점수가 틀렸다"는 오해**로
  직결된다 — 이게 이번 STEP을 촉발한 실제 사용자 불만의 근본 원인이다.

**HIDE_TEMPORARILY로 가지 않는 이유**: raw 데이터/공식 자체는 정확하고,
Seo-gu 전수 검사에서 명백한 오류가 없었다. **URGENT_FIX_REQUIRED로 가지
않는 이유**: 지금 당장 weight/formula를 고친다고 해서 "peer 상대성으로 인한
역설"이라는 근본 원인(§12)이 해소되지 않는다 — 오히려 §16(explainability)을
먼저 보강하는 것이 더 시급하고 안전한 다음 조치다.

---

## 18. Score V2 design principles (지시사항 12개 + 이번 STEP 실증 근거 매핑)

| # | 원칙 | 이번 STEP 실증 근거 |
|---|---|---|
| 1 | 상식과 크게 어긋나지 않을 것 | §9/§10에서 "상식과 어긋나 보이는" 케이스가 실제로는 peer 상대성으로 설명 가능함을 확인 — V2는 "설명"을 더 잘해야지 반드시 "값"을 바꿔야 하는 건 아닐 수 있음 |
| 2 | 없는 데이터 추정 금지 | V1이 이미 잘 지키고 있음(§1-4 null 처리, §13 D분류 항목들을 임의로 채우지 않음) — V2도 승계 |
| 3 | 한 항목이 전체를 과도 지배 금지 | §5 parking 사례가 정확히 이 원칙의 위반 위험 사례 — 표본 크기에 따른 민감도 상한/최소 표본 규칙 필요 |
| 4 | 절대적 장점과 지역상대 장점 분리 | §12 proposal(절대 밴드 병기)이 직접 대응 |
| 5 | 신축/구축 공정 평가 | §3에서 신축이 buildYear를 통해 정당하게 유리함을 확인 — "불공정"이 아니라 "가중치가 작다"는 게 실제 이슈 |
| 6 | 실거주/투자 무분별 혼합 금지 | V1은 market weight=0으로 이미 지킴(§1-2) — §14 INVESTMENT_SCORE 분리안이 이 원칙 확장 |
| 7 | 가격 비싸다고 좋은 점수 금지 | V1이 이미 지킴(§1-2, market.ts 주석) — 유지 권장 |
| 8 | 설명 가능 | §16이 핵심 대응(school-access-sentence.ts 선례 일반화) |
| 9 | coverage/confidence 유지 | V1이 이미 구현(§1-6) — 그대로 승계 |
| 10 | 부산 benchmark로 regression | §19 benchmark set이 대응 |
| 11 | 향후 전국 확장 가능 | V1의 peer 구조(sggCd 기반)는 이미 지역 코드 일반화돼 있어 구조적으로는 확장 가능 — REGION_WIDE가 실제로는 SIGUNGU와 동일한 현재 한계(§1-8)만 해소되면 됨 |
| 12 | 개인화/공통점수 분리 | §14 PERSONALIZED_SCORE 후보로 방향만 기록 |

---

## 19. 절대점수 vs 상대점수 proposal

§12에서 이미 다룬 내용의 요약: **"핵심 절대 품질 + 지역 내 위치"를 동시에
보여주는 구조**(예: "교통 88점 · 부산 상위 12% · 서구 상위 8%")가 현재의
peer distortion을 완화할 수 있는지 평가하면 — **완화할 수 있다, 단 "절대
품질 88점"을 무엇으로 정의할지가 새로운 설계 문제다.** 현재 V1에는 "절대
품질" 개념 자체가 없다(전부 상대). 후보:

1. **원본 값 그대로 노출**(예: "140m") — 계산 불필요, 가장 안전하지만
   "88점" 같은 단일 숫자로 환산은 안 됨.
2. **고정 임계치 기반 절대 밴드**(school-access-sentence.ts의 VERY_CLOSE~VERY_FAR
   패턴을 4개 카테고리에도 적용) — 이미 검증된 패턴, 구현 비용 낮음.
3. **부산 전체(REGION_WIDE를 이름 그대로 진짜 구현) 기준 percentile을 "절대"로
   재정의** — §1-8의 기존 한계를 해소해야 함(타 지역/전체 조회 신규 구현 필요,
   이번 STEP 범위 밖).

**권장(잠정, V2 설계 STEP에서 확정)**: 2번(절대 밴드)을 먼저 적용 — 이미
검증된 패턴이고 신규 데이터/계산이 필요 없다.

---

## 20. benchmark validation methodology proposal

§11 지시사항 그대로, 이번 STEP은 **방법론만 제안**(실행은 §19 benchmark set
문서화까지만):

- 대표 30~50단지 pairwise comparison — "어느 한 쪽이 모든 요소에서 우위는
  아니지만 왜 그 순서인지 설명 가능해야 함"(§20 예시, 대신해모로 vs 협성
  사례 자체가 이미 첫 테스트 케이스)
- **obvious dominance test**: A가 B보다 모든 raw feature에서 우위인데 총점이
  낮으면 FAIL(§10 FLAG 로직이 이미 이 패턴의 초안, complex 카테고리에서는
  0건 확인)
- **sensitivity test**: 표본 크기가 작은 카테고리(parking처럼)에서 값을
  ±5% 흔들었을 때 총점이 얼마나 흔들리는지 측정(이번 STEP에서 실행 안 함,
  V2 설계 단계 권장)
- missing data test / new vs old / subway vs non-subway / parking tradeoff /
  district bias / score distribution — §22 known-pair test proposal과
  통합해서 다룸

---

## 20-1. 부산 대표단지 benchmark set (Score V2 regression용, "정답 순위" 아님)

`scripts/apartment-score/step0-05-benchmark-set.ts` 실행 결과, **28건**
선정(§9의 협성르네상스/구덕금호 2건 포함) — 목표 30~50건에는 약간 못
미친다. 부족분을 채우려 임의로 더 뽑기보다, **실제로 다양성 조건을 만족한
표본만 정직하게 보고**한다(가격 고가/중저가 tier는 이번 STEP에서
`ApartmentMarketFeature`를 조인하지 않아 미포함 — 표에 없는 것이지 "전부
저가"로 조작한 게 아님, V2 착수 시 이어서 채울 것).

| 태그 | 단지 | 구·군/동 | 준공 | 세대수 | 총점 | 교통 | 주차 | 학교 | 지하철거리 |
|---|---|---|---|---|---|---|---|---|---|
| 지역대표 | 비스타동원더비치테라스 | 서구/암남동 | 2023 | 295 | 55 | 42 | 69 | 49 | ? |
| 지역대표 | 더샵센텀파크1차 | 해운대구/재송동 | 2005 | 2752 | 62 | 76 | 75 | 51 | 215 |
| 지역대표 | 에스케이쁘띠메종 | 동래구/안락동 | 2000 | 346 | 45 | 35 | 31 | 72 | 566 |
| 지역대표 | 테넌바움294 | 수영구/민락동 | 2023 | 294 | 51 | 43 | 65 | 38 | ? |
| 지역대표 | 동림리라 | 남구/우암동 | 1984 | 69 | 49 | 70 | - | 38 | 677 |
| 지역대표 | 엘지신개금(2-2) | 부산진구/개금동 | 1999 | 819 | 57 | 50 | 75 | 64 | 382 |
| 지역대표 | 부산더샵시티애비뉴 | 연제구/연산동 | 2015 | 232 | 68 | 84 | 95 | 25 | 121 |
| 지역대표 | 지사금강펜테리움 | 강서구/지사동 | 2013 | 1111 | 36 | 41 | 5 | 60 | ? |
| 지역대표 | 일광대성베르힐 | 기장군/일광읍 | 2020 | 518 | 50 | 30 | 70 | 67 | ? |
| 신축대단지 | 대신푸르지오2차 | 서구/서대신동2가 | 2021 | 815 | 41 | 37 | 44 | 10 | 212 |
| 신축대단지 | 대신해모로센트럴아파트 | 서구/서대신동2가 | 2022 | 733 | 48 | 62 | 18 | 22 | 140 |
| 신축대단지 | e편한세상송도더퍼스트비치 | 서구/암남동 | 2024 | 1302 | 60 | 53 | 56 | 68 | ? |
| 구축대단지 | SKVIEW | 해운대구/좌동 | 1998 | 1721 | 35 | 30 | 19 | 17 | 880 |
| 구축대단지 | 건영1 | 해운대구/좌동 | 1998 | 788 | 46 | 38 | 64 | 45 | 653 |
| 구축대단지 | 경남선경 | 해운대구/좌동 | 1996 | 1358 | 36 | 20 | 77 | 23 | 879 |
| 초역세권 | 협성루에나센텀 | 해운대구/재송동 | 2023 | ? | 77 | 81 | - | 65 | 106 |
| 초역세권 | 서면롯데캐슬스카이 | 부산진구/전포동 | 2004 | 1395 | 51 | 66 | 14 | 51 | 136 |
| 초역세권 | 서면2차봄여름가을겨울 | 부산진구/당감동 | 2019 | 535 | 66 | 78 | 74 | 28 | 184 |
| 고용량(households) | 엘지메트로시티1~5(5개동) | 남구/용호동 | 2001~2004 | 7374 | 63~66 | 50~59 | 79 | 48 | ? |
| 재건축후보(1990이전) | 개금주공2 | 부산진구/개금동 | 1988 | 2544 | 31 | 23 | - | 39 | ? |
| 재건축후보 | 이화 | 부산진구/가야동 | 1982 | 125 | 31 | 37 | - | 8 | 725 |
| 재건축후보 | 삼익아파트 | 부산진구/당감동 | 1978 | 340 | 51 | 50 | - | 71 | 768 |
| 주차우수 | 협성르네상스(서구) | 서구/서대신동3가 | 2001 | 489 | 57 | 79 | **95** | 11 | 306 |
| 데이터갭 표본 | 구덕금호 | 서구/동대신동3가 | 2001 | null | 54 | 55 | **NOT_SCORED** | 41 | 615 |

미포함 카테고리(정직하게 명시, 이번 STEP에서 미실행): **가격 고가/중저가
tier**(market feature 조인 안 함), **주차 취약 전용 태그**(§10에서 이미
Seo-gu 국지적으로 확인한 브라운스톤하이포레 등을 재사용 가능, 이 표에는
미포함), **학군 접근 우수 전용 태그**(schoolAccess 컬럼값으로 사후 필터
가능 — 이 표 자체에서 이미 8~95 범위로 나타나 있어 재선정 없이도 활용 가능).
V2 설계 착수 시 이 스크립트에 가격/주차취약/학군우수 필터를 추가해 30~50건
목표를 마저 채우는 것을 권장.

## 21. Seo-gu/Busan 데이터 기반 known-pair test proposal (§25 지시사항)

이번 STEP 실측으로 확인된 것을 **monotonic constraint 후보**로 구체화(사람
취향 하드코딩 아님, 명백한 단조성만):

```
KP1. 세대당 주차 1.5 이상인 단지가 세대당 주차 1.0 미만인 단지보다
     같은 peer level에서 parking score가 낮으면 FAIL.
     (§5에서 peer level이 다르면 – 즉 준공연대가 다르면 – 이 비교 자체가
     성립하지 않을 수 있음을 확인했으므로, "같은 peer pool 안에서"라는
     조건이 반드시 필요 — 이번 STEP이 발견한 함정을 test 설계에 반영)

KP2. 신축(buildYear 차이 20년 이상)이 complex 카테고리에서 완전히 무시되면
     (=구축과 동일/더 낮은 score) FAIL — 단, LOCAL peer가 다르면 이 비교도
     peer 통제가 필요(§10 골든캐슬 사례처럼 peer 자체가 노후지역이면 예외적으로
     구축이 높을 수 있음을 이미 실측 — 이 경우 FAIL이 아니라 "peer 재확인
     필요" flag로 처리해야 함).

KP3. nearestSubwayDistanceM이 100m 미만인 단지가 500m 이상인 단지보다
     transport score가 낮으면 FAIL — 단 §4에서 확인했듯 절대값이 아니라
     peer 상대값이라 이 test는 "동일 peer pool 내에서"로 한정해야 실효성이 있음.

KP4. peer 표본(peerSampleSize)이 10 미만인 카테고리의 score가 5점 또는
     95점(SCORE_FLOOR/CEIL 경계)에 붙어 있는 비율이 부산 전체에서 일정
     임계치(예: 30%) 이상이면 "표본 부족으로 인한 극단화" 경보 — §5/§10에서
     이미 2건 실측된 패턴을 시스템적으로 감지하는 규칙.
```

---

## 22. tests/tsc/lint

이번 STEP은 `scripts/apartment-score/step0-*.ts` read-only 분석 스크립트
3개만 추가했다(calculateApartmentScore 등 production 코드 0줄 수정). 별도
fixture test는 만들지 않음(순수 조회+집계 스크립트라 단위 테스트 대상 로직이
없음, §28 "app code 미변경이면 build 선택" 원칙에 따라 build는 생략) —
`tsc --noEmit`/`eslint`만 실행해 신규 파일 오류 0건을 확인한다(§26에서 수치
기록).

---

## 23. 최종 보고 (지시사항 1~64 대응)

```
1.  branch                              = score-v2-step0-forensic-audit
2.  base                                = score-geocode-recovery(6e06e01) — main(ec23919)이
                                           아니라 실제로 score 데이터가 더 완전한 branch(§0)
3.  production-equivalent Score code    = confirmed(src/lib/apartment-score/server/*, 8개 파일 전수 정독)

4.  current total formula               = Σ(category.baseWeight/usedWeightSum × category.score), Math.round (§1-1)
5.  domain weights                      = transport30/living25/parking15/complex15/schoolAccess15/market0(§1-2, 지시사항 수치와 정확히 일치)
6.  missing redistribution              = 2단계(sub-metric 내부 + 카테고리 간), 둘 다 "사용 가능 weight로 재정규화"(§1-5)
7.  coverage rule                       = 스코어된 baseWeight합/100, <0.6이면 INSUFFICIENT_DATA(§1-6)
8.  confidence rule                     = coverage>=0.85 & HIGH-tier>=3 → HIGH / >=0.6 → MEDIUM / 그외 LOW(§1-6)

9.  transport raw features              = nearestSubwayDistanceM(45)/subwayCount1000m(25)/nearestBusStopDistanceM(18)/busStopCount300m(12), 전부 Kakao/TAGO(§2)
10. life raw features                   = mart(20)/convenience(20)/pharmacy(15)/hospital(10)/park(20)/daycareKindergarten(15), 전부 Kakao count+log1p(§2)
11. parking raw features                = parkingPerHousehold 단일(100), ApartmentMaster 원본(§2)
12. complex raw features                = buildYear(50)/totalHouseholds(30)/mainBuildingCount(20), ApartmentMaster 원본(§2)
13. school raw features                 = nearestElementaryDistanceM(60)/elementaryCount1000m(40), Kakao(§2)

14. builtYear used?                     = DIRECT(complex 내부 50% sub-weight, 실질적으로 대부분 단지에서 그 15점 전체를 결정)(§3)
15. age used?                           = buildYear로만, 별도 ageYears 파생 없음(§3)
16. brand used?                         = NOT_USED(§3/§6, grep 0 hits)
17. FAR used?                           = NOT_USED(schema에 컬럼 자체 없음, 단 apt 상세페이지가 이미 실시간 조회 중 → C 분류, §13)
18. BCR used?                           = NOT_USED(FAR와 동일, §13)
19. household count used?               = DIRECT(complex 내부 30%, coverage 15~34%뿐이라 실질 영향은 제한적)(§2/§3)
20. subway distance used?               = DIRECT(transport 내부 45%, 최대 sub-weight)(§2)

21. 대신해모로 aptSeq                    = 26140-1356
22. score trace                         = 48(coverage 1.0, confidence HIGH)(§9)
23. transport trace                     = 62(LOCAL 서대신동2가 n=19, subway 140m→percentile 61.1%)(§4/§9)
24. parking trace                       = 18(LOCAL 서구+2020년대 n=8유효, ratio 1.09→공동최하위→percentile 14.3%)(§5/§9)
25. complex trace                       = 95(buildYear 2022 + households 733 + buildings 9, LOCAL 최상위권)(§6/§9)

26. 협성르네상스 trace                    = aptSeq 26140-51, score 57(T79/L38/P95/C56/S11), parking ratio 1.585가 LOCAL(서구+2000년대 n=5유효) 최댓값(§9)
27. 구덕금호 trace                       = aptSeq 26140-11, score 54(T55/L59/P=NOT_SCORED/C56/S41), households/parkingCount 미확보로 coverage 0.85·confidence MEDIUM(§9, 신규 확인 사례)

28. 대신해모로 transport 62 root cause    = raw 140m는 절대적으로 매우 가까우나, 서대신동2가 LOCAL peer 19곳 중 8곳이 더 가까워(38~108m) percentile이 61%로 눌림 — 버그 아님, peer 상대성(§4)
29. parking 18 root cause               = 준공연대(2020년대)+구(서구) peer 8곳 중 공동 최하위 랭크 — 표본 극소 + 순수 rank percentile의 결합(§5)
30. total 48 root cause                 = 가중합 자체는 공식과 정확히 일치(47.85→48) — "이상해 보이는" 원인은 계산 오류가 아니라 parking/living 두 도메인의 낮은 raw 순위가 complex/school의 높은 순위를 상쇄(§9)

31. Seo-gu top30                        = 최고 75점(골든캐슬), 완만한 분포, 명백한 모순 없음(§10)
32. Seo-gu suspicious rankings          = FLAG "구축인데 complex>=80" 1건(골든캐슬, peer 상대성으로 설명됨) — "신축인데 complex<50"은 0건(§10)

33. Busan score distribution            = mean49.9/median51/p10 34/p90 64/min14/max81, n=3401(§11-1)
34. district bias                       = 16개 구·군 mean이 48.2~51.3 범위(폭 3.1점)로 매우 균일 — LOCAL peer가 구 내부에서 자체 정규화되는 구조적 결과(§11-3)
35. subscore distributions              = parking만 유일하게 저-coverage(25.3%)+극단분포(≤10점 10.4%, ≥90점 8.5%, 합 18.9%) — 다른 4개 도메인은 6% 미만(§11-2)

36. current peer logic                  = LOCAL(동 또는 구+연대)→SIGUNGU→REGION_WIDE, REGION_WIDE는 실제로 SIGUNGU와 동일(known limitation, §1-8/§12)
37. peer distortion findings            = 3개 실제 사례(transport/parking/schoolAccess) + 부산 전체 상관관계(buildYear↔complex 0.825)로 정량 재확인(§12)

38. missing important factors           = 공식 통학구역/중학교학교군/유치원(이미 SCHOOL V2에 존재, C분류)/FAR/BCR(이미 apt상세에 존재, C분류)/재개발재건축(이미 테이블 존재, C분류)/문화시설/브랜드/전고점/미분양(D분류)(§13)
39. available-now factors(A)            = 지하철·버스·의료·쇼핑·마트·공원·준공연도·세대수·동수·주차·실거래가·거래량(§13)
40. unavailable factors(D)              = 업무지구접근/경사도/중심상권/브랜드/커뮤니티/엘리베이터/지하주차연결/어린이집/학원가/문화시설/전고점/매물/공급·미분양/교통호재/개발계획(§13)

41. competitor comparison UX observation = 교육/교통/의료/쇼핑/문화 5축 radar, "한눈에 강약 비교" — 이집 V1의 "생활"이 의료+쇼핑+문화를 뭉쳐놔 세분 비교가 UI 레벨에서 불가능(§15)
42. E-jip maximize proposal             = raw evidence 상시노출/비교 diff 텍스트/목적별 score/장단점 자동요약(이미 briefing.ts 일부 보유)/가격 병기(§15)

43. CORE_SCORE candidates               = 현재 5개 카테고리 그대로 승계(§14)
44. separate-index candidates           = EDUCATION_SCORE(신설)/COMPLEX_QUALITY(재정의)/MARKET_TEMPERATURE(기존 유지)/INVESTMENT_SCORE(신설, 신중)(§14)
45. personalized candidates             = 사용자 가중치 조절형(장기, 방향만 기록)(§14)

46. current Score V1 trust decision     = B. KEEP_BETA_WITH_WARNING(§17)

47. Score V2 design principles          = 지시사항 12개 전부, 각각 이번 STEP 실증 근거 매핑 완료(§18)
48. absolute vs relative recommendation = 절대 밴드 우선 도입 권장(school-access-sentence.ts 기존 패턴 재사용, 신규 계산 불요) — REGION_WIDE 실제 구현은 별도 STEP(§19)

49. benchmark apartments count          = 28건(목표 30~50에 근접, 가격 tier 등 일부 카테고리 미포함을 정직하게 기록)(§20-1)
50. known-pair test proposal            = KP1~KP4, 전부 "같은 peer pool 내에서"라는 이번 STEP의 핵심 발견을 조건으로 포함(§21)

51. Score code changed?                 = NO(calculate.ts 등 production 코드 0줄 수정)
52. DB write?                           = NO(전부 read-only 조회, INSERT/UPDATE 0건)
53. migration?                          = NO

54. tests                               = 신규 fixture test 없음(순수 조회/집계 스크립트라 단위 테스트 대상 로직 없음, §22)
55. tsc                                 = 신규 스크립트 4개 포함 전체 0 errors
56. lint                                = 신규 스크립트 4개 0 errors/0 warnings
57. docs                                = 이 문서 신규

58. commit                              = 예정(이 STEP 마지막 단계)
59. push                                = 예정
60. worktree clean                      = scripts/apartment-score/step0-*.ts 5개 + 이 문서 외 변경 없음(확인 예정)

61. BLOCKER                             = 없음(분석 STEP, 구현 아님)

62. SCORE_V2_STEP0_CLOSE                = YES
63. SCORE_V2_REDESIGN_REQUIRED          = **부분적** — formula/weight 자체를 즉시 다시 짤 필요는 없음(§10/§11에서 대규모 모순 발견 안 됨). 시급한 것은 (a) explainability 보강(§16, 기존 school-access-sentence.ts 패턴을 4개 도메인으로 확장), (b) parking처럼 표본 극소 도메인의 민감도 완화 규칙(§5/§21 KP4), (c) SCHOOL V2/재개발 등 이미 존재하는 데이터를 Score와 조인(§13 C분류 항목들). weight 숫자 자체를 흔드는 재설계는 이 3가지 이후 재평가 권장.
64. NEXT_RECOMMENDATION                 = ① school-access-sentence.ts 패턴을 transport/parking/complex/living 4개 도메인에도 일반화하는 explainability STEP을 먼저 진행 ② parking 카테고리에 "peer 표본<10일 때 절대 참고선 병기" 규칙 설계(계산 변경 아닌 표시 변경으로 우선 시도) ③ SCHOOL V2 공식 통학구역/유치원 데이터, apt상세 FAR/BCR, RedevelopmentProject를 Score 파이프라인에 조인하는 별도 ingestion STEP(§13 C분류 항목 전체) ④ 위 3가지 완료 후에도 총점 분포/사용자 체감이 여전히 어긋나면 그때 weight 재산정(§18/§19) 착수
```

**E-JIP SCORE V2 STEP 0 종료. 결과 보고 후 멈추고 ChatGPT/user 검수 대기.**
