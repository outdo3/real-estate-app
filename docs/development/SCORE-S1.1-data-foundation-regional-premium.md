# STEP SCORE S1.1 — Score Data Foundation + Regional Location Premium 설계

상태: **설계 문서만 — 점수 계산 코드/DB schema/migration/production write/UI 변경
없음**

S1의 결론(6개 후보 카테고리 전부 PARTIAL/NOT AVAILABLE, "전국 Core Score" 전제
자체가 현재 데이터로 성립 안 함)은 **뒤집지 않는다.** 이 문서는 S1이 남긴 질문
— "그렇다면 실제로 무엇부터, 어떤 구조로 만들 수 있는가" — 에 답한다.

## 1. S1 findings(재확인, 변경 없음)

Apartment 32건(비대표) / ApartmentMaster 3,402건(부산 전용) / TradeHistory
0건 / 교통·생활은 라이브 API·DB 미저장 / 가격은 개별 조회만 정확·배치
캐시 없음 / 학군 성과 데이터 소스 자체 없음 / V1 INCLUDED 카테고리 없음.

## 2. ApartmentMaster 실제 구조(전체 필드, 이번 STEP에서 처음부터 재조사)

```prisma
model ApartmentMaster {
  id, aptSeq, mgmBldrgstPk,
  name, normalizedName,
  sido, sigungu, sggCd, umdName, umdCd, jibun, roadAddress, jibunAddress,
  latitude, longitude, geocodeQuality,
  buildYear, useApprovalDate, mainBuildingCount, totalHouseholds, parkingCount,
  createdAt, updatedAt
}
```

**"area"(면적) 필드는 없다** — 원 지시가 후보로 든 필드지만 실제 schema에
없음을 확인(추정하지 않고 정직하게 보고). 면적이 필요하면 MOLIT 거래
응답(`excluUseAr`)에서 거래 시점마다 얻거나, 별도 배치가 필요하다.

### 필드별 coverage(3,402건 전체, read-only 재확인)

| 필드 | coverage | 비고 |
|---|---|---|
| aptSeq | 3,402/3,402(100%) | MOLIT 조인키, canonical identity 후보 |
| sido/sigungu/sggCd/umdName/umdCd/jibun | 3,402/3,402(100%) | |
| roadAddress/jibunAddress | 1,389/3,402(40.8%) | 완성형 주소는 절반 이하만 |
| latitude+longitude | 3,067/3,402(90.2%) | 점수 데이터 foundation의 핵심 — 아래 상세 |
| geocodeQuality | 3,402/3,402(100%, 값 자체는 항상 있음) | exact 1,333(39.2%) / normalized 1,734(51.0%) / **failed 335(9.8%)** — failed는 좌표 없음과 정확히 일치 |
| buildYear | 3,402/3,402(**100%**) | |
| useApprovalDate | 619/3,402(18.2%) | buildYear보다 훨씬 낮음(다른 소스) |
| mainBuildingCount | 1,365/3,402(40.1%) | |
| totalHouseholds | 1,309/3,402(38.5%) | |
| parkingCount | 876/3,402(25.8%) | |

**출처 재확인**: `ApartmentMaster`는 이미 실행된 **MASTER M4-B**(문서
`14-apartment-master-m4-expansion-analysis.md`)의 산출물이다 — "부산 16개
구·군 / 최근 24개월 MOLIT discovery / aptSeq 기반 upsert / 건축물대장
enrichment / Kakao 좌표 enrichment"를 이미 거쳤다. 이번 조사는 그 실행
결과를 재확인한 것이지 새로 추정한 것이 아니다.

## 3. 위치 좌표 coverage(핵심)

```text
전체 3,402건 중 lat+lng 둘 다 있음: 3,067건(90.2%)

서구:    171건 중 155건(90.6%)
해운대구: 308건 중 247건(80.2%)
수영구:  251건 중 226건(90.0%)
남구:    253건 중 220건(87.0%)
```

**부산 16개 구·군 전체가 이미 `ApartmentMaster`에 포함돼 있다**
(부산진구 404 / 사하구 338 / 동래구 314 / 해운대구 308 / 금정구 308 /
남구 253 / 수영구 251 / 연제구 244 / 북구 173 / 서구 171 / 기장군 152 /
사상구 151 / 영도구 133 / 동구 99 / 중구 59 / 강서구 44, 합계 정확히
3,402). S1은 서구만 pilot했지만, **실제 데이터는 이미 부산 전역을
포괄한다** — 이건 "전국 Beta"는 여전히 불가능하지만 "부산 전체 Beta"는
데이터 관점에서 이미 가능하다는 뜻이다(섹션 30 판단의 핵심 근거).

## 4. 교통 raw feature 설계(raw metric만, score 아님)

```ts
interface TransportRawFeature {
  nearestSubwayDistanceM: number | null;
  nearestSubwayName: string | null;
  subwayCount1000m: number | null;

  nearestBusStopDistanceM: number | null;
  busStopCount300m: number | null;
  busStopCount500m: number | null;
  majorTransitCount: number | null; // 지하철+버스정류장 합산, "주요 교통 접근성"용

  nearestKtxDistanceM: number | null; // 부산은 부산역/구포역 정도만 해당 — 의미는 있으나 대다수 단지에서 편차가 크지 않을 수 있음(실제 분포 확인 필요, 이번 STEP에서 실행 안 함)
}
```

- 지하철: Kakao SW8 카테고리(이미 `KakaoPlaces.tsx`가 쓰는 코드) — REST API로
  전환하면 서버 배치 가능.
- 버스: TAGO 좌표기반근접정류소(`/api/transit/bus-stops`, 이미 서버 라우트,
  **그대로 배치 재사용 가능** — 클라이언트 SDK 아님).
- KTX: 카테고리 코드가 없어 키워드 검색("KTX", "기차역") + 기존
  `isRailwayStation()`/`isClosedStation()` 필터 로직(`KakaoPlaces.tsx`)을
  그대로 재사용 — 폐역/오탐 제거 로직 이미 검증됨.

**중요**: `KakaoPlaces.tsx`는 `window.kakao.maps.services.Places`(브라우저
JS SDK)를 쓴다 — **서버 배치 스크립트는 이 컴포넌트를 재사용할 수 없고**,
`cheongyakService.ts`/`geocode-apt.ts`가 이미 쓰는 Kakao REST API
(`KakaoAK` + `KA`/`Origin` 헤더) 패턴으로 새로 작성해야 한다(로직/필터
규칙은 재사용, 호출 방식만 REST로 전환).

## 5. 생활편의 raw feature 설계

```ts
interface LifeConvenienceRawFeature {
  martCount1000m: number | null;
  convenienceCount500m: number | null;
  pharmacyCount500m: number | null;
  hospitalCount1000m: number | null;
  parkCount1000m: number | null; // 카테고리 코드 없음 — 키워드 검색
  daycareCount500m: number | null; // PS3 = 어린이집+유치원 혼합(Kakao 공식 분류, 분리 불가)
}
```

Kakao 카테고리 코드 6종 그대로 재사용(MT1/CS2/PM9/HP8/PS3 + 공원 키워드) —
`NeighborhoodInfoPanel.tsx`가 이미 실사용 중인 정확히 같은 코드다. Radius는
기존 상세페이지 UI가 실사용 중인 값(대형마트/편의점/약국 1000m 또는
500m, 병원 1000m)을 그대로 따르는 것을 제안 — 새 radius를 임의로
확정하지 않고 이미 검증된 값을 재사용(원칙 준수).

**중복 POI 문제**: Kakao 카테고리 검색은 최대 15건/페이지, `size` 파라미터로
페이지네이션 가능(최대 45건까지 3페이지) — count만 필요하면 `meta.total_count`
필드를 그대로 쓰면 되고 전체 목록을 다 받을 필요가 없다(호출 비용 절감).
이 최적화는 이번 STEP에서 코드로 구현하지 않고 설계로만 기록한다.

## 6. 가격 raw feature 설계

```ts
interface PriceRawFeature {
  latestTradePrice: number | null;
  medianPricePerM2_12m: number | null;
  transactionCount12m: number | null;
  medianPricePerM2_36m: number | null;
  priceChange12m: number | null; // peer 비교 입력용, "상승=좋음" 판단에 직접 쓰지 않음
}
```

**중요한 재발견**: `fetchMolitData({ lawdCd, dealYmd, type })`는 **구/군+월
단위로 그 지역 전체 거래를 한 번에 반환한다** — 아파트 1건당 1회 호출이
아니다. 즉 부산 전체 가격 raw feature를 만드는 비용은 **아파트
수(3,402)가 아니라 (구·군 수 × 개월 수)에 비례**한다 — 16개 구·군 ×
12개월 = **192회**면 최근 12개월 부산 전체 실거래를 확보할 수 있다(M4
문서의 "MOLIT 약 384회" 추정치와 같은 패턴, 거기는 24개월 기준이라
16×24=384로 정확히 일치 — 기존 추정과 교차검증됨). 받은 거래를
`aptNm`(+동)으로 그룹핑해 `ApartmentMaster.name`/`umdName`과 매칭하면
개별 아파트 가격 feature를 만들 수 있다 — 단, 이름 매칭은 R3A/R4가 이미
증명한 "동명이인" 위험이 여기도 그대로 적용되므로 sido/sigungu/umdName
까지 결합한 안전한 매칭이 필요(재개발 파이프라인에서 검증된 것과 같은
원칙 재사용).

## 7. 단지 raw feature + 이상치 검사

`buildYear`(100%), `totalHouseholds`(38.5%), `mainBuildingCount`(40.1%),
`parkingCount`(25.8%) 그대로 사용. **주차 이상치 재확인**: S1이 발견한
삼경빌라맨션(0.29대/세대, 1989년, 181세대)을 이번에도 재확인 — 매우
낮은 값이지만 원본 건축물대장 총괄표제부 값을 그대로 캐싱한 것이라
(코드 주석 "총괄표제부 확정값만" 참고) 데이터 자체가 틀렸다고 단정할
근거는 없다. **정책 제안**: 세대당 주차가 0.1대 미만이거나 5대를
초과하는 값은 "확인 필요" 플래그를 달아 자동 정규화 계산에서 제외하고
사람이 검수하게 한다(0.29는 이 범위 밖이라 이번 기준으로는 그대로 포함
가능 — 임계값 예시일 뿐 확정 아님).

## 8. 학교 접근성 vs 학군(명칭 엄격 구분)

**학군 score는 여전히 금지**(S1 결론 유지). 다음은 별도로 검토 가능:

```ts
interface SchoolAccessRawFeature {
  nearestElementaryDistanceM: number | null;
  schoolCount1000m: number | null; // SC4 카테고리, 초/중/고 미구분(Kakao 응답의 category_name으로 급별 구분은 가능 — 별도 파싱 필요)
}
```

**명칭 원칙**: UI/API 어디에서도 "학군"이라는 단어를 이 feature에 쓰지
않는다 — "인근 초등학교까지 350m", "반경 1km 내 학교 4곳" 같은 **접근성
서술만** 허용, "학군이 좋다/나쁘다"로 해석될 수 있는 표현·점수화는
전면 금지.

## 9. Regional Location Premium 구조(핵심 설계)

```text
CORE QUALITY              전국(현재는 부산) 공통 기준으로 계산 가능한 raw feature 기반 percentile
+ LOCAL RELATIVE POSITION  같은 지역(peer group) 내 상대적 위치
+ REGIONAL LOCATION PREMIUM 그 지역만의 고유한 입지 요소(예: 해변 접근성)
```

세 번째 layer(Regional Location Premium)가 원 지시의 "서구 85점과
해운대 85점이 전혀 다른 의미가 되지 않게"라는 요구와 "해운대는 해변
접근성이 강점"이라는 요구를 **동시에** 만족시키는 방법은, Regional
Premium을 **총점에 섞지 않고 별도 배지/설명으로 분리**하는 것이다 —
아래 섹션 18에서 A/B 방식을 비교한다.

## 10. 서구 vs 해운대 비교(실측 가능한 것만)

| 항목 | 서구(171건, 좌표 155건) | 해운대구(308건, 좌표 247건) | 측정 가능 여부 |
|---|---|---|---|
| 지하철 접근 | 측정 가능(Kakao SW8) | 측정 가능 | O(라이브, 배치 미실행) |
| 버스 접근 | 측정 가능(TAGO) | 측정 가능 | O |
| 병원 접근 | 측정 가능(HP8) | 측정 가능 | O |
| 해변 접근 | **의미 없음**(서구는 해안 아님) | **핵심 차별점** | O(아래 섹션 11) |
| 지형/경사 | **측정 불가** — 이 프로젝트에 지형/경사 데이터 소스가 없음 | 동일 | **NOT AVAILABLE** |

경사/지형은 원 지시의 서구 후보 예시에 있었지만 **실제 데이터 소스가
없어 채택하지 않는다**(원칙 0 재확인 — 국토지리정보원 등 별도 API가
필요, 이번 STEP에서 신규 연결 금지).

## 11. 해변 접근성 vs 오션뷰(엄격 분리, 실측 확인)

**해변 접근성(BEACH_ACCESS)은 계산 가능함을 실제로 확인했다** — Kakao
키워드 검색("해수욕장")으로 해운대 좌표 인근 조회 결과:

```text
해운대해수욕장(관광명소 > 해수욕장,해변, 53m)
광안리해수욕장(관광명소 > 해수욕장,해변, 3,825m)
송정해수욕장(관광명소 > 해수욕장,해변, 4,208m)
```

`category_name`이 Kakao 공식 분류로 "관광,명소 > 해수욕장,해변" 경로를
갖는다 — KTX/폐역 필터와 같은 방식(이름 추정이 아니라 공식 category_name
필터)으로 안전하게 걸러낼 수 있음을 실측으로 확인했다. **새 외부 API
없이 기존 Kakao 키워드 검색 패턴을 그대로 재사용 가능.**

**오션뷰(OCEAN_VIEW)는 명확히 NOT_AVAILABLE로 유지한다** — 동/층/방향/
차폐건물 데이터가 이 프로젝트 어디에도 없다. "해변에서 가깝다"와
"바다가 보인다"는 완전히 다른 사실이고, 후자를 추정하면 실제로 바다가
안 보이는 저층/후면 세대에 잘못된 정보를 주게 된다 — 절대 계산하지
않는다.

## 12. 해안 거리 source

새 외부 API가 필요 없다(섹션 11에서 실측 확인) — Kakao 키워드 검색
("해수욕장")만으로 충분하다. 별도 해안선 GIS 데이터는 검토 후보로도
필요 없다는 결론.

## 13. 주요 생활권 접근성(architecture만)

Kakao에 "상권/생활권" 공식 카테고리 코드가 없다 — 지역 전체에 수백 개
지점을 운영자가 입력하는 방식은 피하되, **부산 광역 단위의 소수(10~20개
내외) 핵심 거점**(서면/센텀시티/남포동/부산역 등)을 **좌표 reference
데이터**로만 관리하는 것을 제안한다. 이건 섹션 14가 금지하는 "지역별
가중치 테이블"과 성격이 다르다 — "서면역은 이 좌표에 있다"는 객관적
사실(위치 reference)이지 "서구에서 주차가 20% 중요하다"는 주관적
가중치가 아니다. 이 구분을 명확히 문서에 남긴다.

## 14. 지역 가중치 수동 테이블 금지 — 재확인

동의하고 그대로 채택. `SEO_GU: subway=30` 같은 하드코딩 테이블은 설계
어디에도 넣지 않았다(섹션 9/13 참고).

## 15. 지역별 feature importance(장기, ML 아님)

장기적으로 "찜/조회/문의" 같은 사용자 행동 데이터가 쌓이면 지역별 feature
importance를 데이터로 도출할 수 있다는 방향에 동의 — 이번 S1.1은 이
아키텍처 존재만 언급하고 ML/통계 로직은 만들지 않는다(섹션 15 그대로).

## 16. Phase 구조 평가

```text
PHASE A  데이터 기반 rule/percentile        → 지금 당장 설계 가능한 범위
PHASE B  실거래 기반 regional premium 검증   → 가격 feature 배치 캐시가 생긴 후
PHASE C  사용자 행동데이터 기반 보정         → 찜/조회 로그가 충분히 쌓인 후(현재 없음)
```

이 3단계 구조가 적절하다고 판단한다 — 각 Phase가 서로 다른 전제조건에
의존해 억지로 동시에 시작할 이유가 없다.

## 17. Peer group — category별 재설계

S1의 단일 지리 반경(`findNearbyApartments`)을 모든 카테고리에 그대로
쓰지 않는 것에 동의한다:

```text
교통       findNearbyApartments() 그대로(생활권 근접성이 목적과 일치)
주차/단지   같은 sigungu + buildYear ±5년(연식 유사 단지끼리 비교해야
            "이 시기 지어진 단지치고 주차가 넓다/좁다"는 의미가 생김)
가격       같은 sigungu + 면적 유사(면적 데이터가 없어 현재는 세대수
            규모로 근사할 수밖에 없음 — 면적 feature 확보 전까지는 정확도 제한)
단지규모   지역 전체 분포(peer group 자체가 불필요, 지역 내 percentile로 충분)
```

표본 부족 시(섹션 9 정책과 동일하게) percentile 계산을 생략하고 "비교
데이터 부족"으로 표시한다.

## 18. Core vs Regional — A/B 비교

```text
A. Core 80% + Regional 20%(고정 비중 합산)
   장점: 계산 단순, 설명하기 쉬움
   단점: "85점"의 의미가 지역마다 달라지는 문제를 구조적으로 못 막음
        (Regional 20%가 큰 지역과 작은 지역에서 실제 영향력이 다르게 느껴질 수 있음)

B. Core category 자체를 지역 percentile로 정규화(비중 분리 없음)
   장점: "85점"이 항상 "이 지역 내 상위 X%"라는 일관된 의미를 가짐
        —이미 섹션 11(percentile 정규화)과 방향이 같음
   단점: 지역 간 절대 비교(서구 A단지 vs 해운대 B단지 중 어디가 "객관적으로"
        더 좋은가)는 애초에 답할 수 없는 질문이 됨 — 단, 이건 단점이
        아니라 오히려 "가짜 절대 서열을 만들지 않는다"는 이 프로젝트의
        원칙(섹션 19)에 더 부합한다.
```

**제안: B 방식.** 이유는 섹션 19(철학)와 직결된다 — 이집점수는 "전국
절대 서열"이 아니라 "이 지역에서 이 단지가 왜 괜찭은가"를 설명하는
도구이므로, 애초에 지역 간 절대 비교를 시도하지 않는 B가 더 정직하다.
Regional Location Premium(섹션 9의 3번째 layer, 해변 접근성 등)은 총점에
섞지 않고 **별도 배지/설명 문구**로만 노출한다.

## 19. 철학 반영

```text
score(percentile, B방식) + reason(explain.ts) + regional context(premium 배지)
```

세 가지가 항상 함께 나오는 구조로 설계 — 숫자 하나만 보여주는 API는
만들지 않는다(섹션 19/26 그대로 반영).

## 20. Cache 필요량(코드 기반 실측 + 명시적 추정)

**가격(MOLIT)**: 구/군 단위 배치이므로 **16구 × 12개월 = 192회**(24개월
기준이면 384회 — M4 문서의 기존 추정과 정확히 일치, 교차검증됨).

**교통+생활편의(Kakao)**: 좌표 있는 3,067개 단지 × (지하철 1 + KTX 1 +
마트 1 + 편의점 1 + 약국 1 + 병원 1 + 공원 1 + 어린이집 1) = **8회/단지 ×
3,067 ≈ 24,536회**.

**버스(TAGO)**: 좌표 있는 3,067개 단지 × 1회 = **3,067회**(정류소별경유
노선까지 원하면 정류소 수만큼 추가 호출 필요 — 이번 견적에는 포함 안
함).

**총 추정**: MOLIT 192~384회 + Kakao 약 24,536회 + TAGO 약 3,067회 ≈
**28,000회 내외**(1회성 초기 구축 기준, 추정치 — M4 문서와 동일하게
"정확한 API별 일일 한도는 추측해서 기록하지 않는다" 원칙을 그대로
따른다).

## 21. API rate limit / 비용(코드/문서 근거만, 추측 없음)

```text
TAGO(국토교통부 버스정류소정보): 개발계정 10,000건/일
  (docs/development/44-apartment-detail-bus-access.md 기존 확인 재인용)
  → 3,067회는 하루 안에 여유 있게 가능.

MOLIT(RTMS 실거래): 정확한 일일 한도 — EXTERNAL_VERIFICATION_REQUIRED
  (M4 문서도 동일하게 "추측해서 기록하지 않는다"고 명시한 그대로 유지).
  단 192~384회는 이 프로젝트의 다른 배치 작업(M4-B 등)에서 이미
  문제없이 처리한 규모와 같은 자릿수라 위험도는 낮다고 판단.

Kakao Local API 일일 한도: EXTERNAL_VERIFICATION_REQUIRED
  (developers.kakao.com 콘솔에서 사용자가 직접 확인 필요 — 이 세션은
  콘솔 접근 권한 없음). 약 24,536회라는 추정치가 하루 한도를 넘을
  가능성을 배제할 수 없으므로, **다회차 batch 실행**(M4-B가 이미 쓰는
  "1개 구·군 실행 → 검증 → 다음"과 동일한 안전 패턴)을 전제로 설계.
```

## 22. Refresh cadence(제안)

```text
지하철/해변 거리                거의 static → 반기~연 단위
버스 정류장/노선                 준-static → 분기 단위
생활 POI(마트/편의점/약국 등)     월 단위(신규 개업/폐업 반영)
가격(MOLIT)                     일/주 단위(실거래 자체가 계약일 기준 갱신)
단지정보(세대수/준공연도 등)      장기(건축물대장 자체가 거의 안 바뀜)
```

## 23. 최소 cache schema(proposal만, 적용 안 함)

```prisma
// PROPOSAL — 적용하지 않음, S2 전 별도 승인 필요
model ApartmentLocationFeature {
  id                        Int      @id @default(autoincrement())
  apartmentMasterId         Int      @unique // ApartmentMaster.id FK, canonical identity(섹션 27)

  nearestSubwayDistanceM    Int?
  nearestSubwayName         String?
  subwayCount1000m          Int?
  nearestBusStopDistanceM   Int?
  busStopCount300m          Int?
  busStopCount500m          Int?
  nearestKtxDistanceM       Int?
  nearestBeachDistanceM     Int?
  nearestBeachName          String?

  martCount1000m            Int?
  convenienceCount500m      Int?
  pharmacyCount500m         Int?
  hospitalCount1000m        Int?
  parkCount1000m            Int?
  daycareCount500m          Int?
  nearestElementaryDistanceM Int?
  schoolCount1000m          Int?

  source                    String   // "KAKAO_REST" | "TAGO"
  sourceVersion              String?  // API 응답 스키마 버전 추적용
  fetchedAt                  DateTime
  qualityFlag                String?  // "OK" | "PARTIAL_TIMEOUT" | "NEEDS_REVIEW"

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model ApartmentMarketFeature {
  id                    Int      @id @default(autoincrement())
  apartmentMasterId     Int      @unique

  latestTradePrice      Int?
  medianPricePerM2_12m  Float?
  transactionCount12m   Int?
  medianPricePerM2_36m  Float?
  priceChange12m        Float?

  source      String   // "MOLIT"
  sourceVersion String?
  fetchedAt   DateTime
  qualityFlag String?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

두 테이블로 분리한 이유: **갱신 주기가 완전히 다르다**(위치는 반기~월
단위, 시장 데이터는 일~주 단위) — 하나로 합치면 위치 데이터가 안 바뀌었는데도
매번 통째로 다시 쓰게 된다. 반대로 지나친 파편화(카테고리마다 테이블
분리)는 피했다 — "위치 계열"과 "시장 계열"이라는 갱신주기 기준 2분류만
적용(원 지시의 "과도한 fragmentation 피하기" 그대로 반영).

## 24. Score와 raw data 분리 — 재확인

위 schema에 **score/weight 필드가 전혀 없다** — raw feature + source +
fetchedAt + qualityFlag만 저장한다. 점수 산식은 별도 server-only 모듈
(섹션 25)에서 이 raw feature를 읽어 요청 시점에 계산한다.

## 25. 보안 — server-only 설계

```text
src/lib/apartment-score/
  config.ts        가중치/최소표본/percentile 로직 — 이 파일은 client
                     컴포넌트에서 import되지 않는다('use client' 파일이
                     이 모듈을 import하지 않도록 규칙으로 강제)
  calculate.ts       raw feature → score 계산(server-only)
```

API 응답에는 `finalScore`, `categoryScores`(percentile류 요약값),
`explain`(설명 문구)만 반환 — peer group 목록, 원본 raw feature 전체,
가중치 수치는 응답에 포함하지 않는다. Next.js App Router의 서버
컴포넌트/API route에서만 `calculate.ts`를 호출하고, 클라이언트 번들에는
계산 결과만 전달되는 구조를 S2 설계 원칙으로 명시한다.

## 26. Schema proposal 필수 필드 — 반영 확인

섹션 23의 두 테이블 모두 identity(apartmentMasterId FK) / feature values /
source / sourceVersion / fetchedAt / qualityFlag를 포함한다. `validUntil`은
넣지 않았다 — refresh cadence(섹션 22)가 카테고리마다 달라 단일 만료
시점보다는 `fetchedAt` + 배치 스케줄러가 재계산 대상을 판단하는 편이
더 정확하다고 판단(불필요한 필드 추가 지양).

## 27. Canonical Apartment Identity — 결론(BLOCKER 아님)

```text
Apartment(32건)        — 상세페이지가 쓰는 캐시, name+dong unique
ApartmentMaster(3,402건) — aptSeq(MOLIT 원본) unique, 100% coverage
```

**결론: score feature의 canonical identity는 `ApartmentMaster.id`
(FK로는 `aptSeq`)로 한다.** 이유:

1. `aptSeq`가 MOLIT 원본 식별자라 가격 feature(MOLIT 기반)와 자연스럽게
   조인된다.
2. `ApartmentMaster`가 이미 부산 전역을 커버해(섹션 3) score 데이터
   foundation으로 규모가 맞는 유일한 테이블이다.
3. `Apartment`(32건)는 점수 대상이 아니라 상세페이지 캐시일 뿐이므로
   score 시스템의 identity로 쓰지 않는다.

**주의(BLOCKER는 아니지만 반드시 처리해야 할 연결고리)**: 현재 상세페이지
(`/apt/[name]`)는 `Apartment` 테이블 기준으로 동작하고 `ApartmentMaster`를
아직 안 쓴다(코드 주석에 명시된 사실, S1에서도 확인). **점수를 상세페이지에
실제로 노출하려면 `ApartmentMaster` ↔ `Apartment`(또는 URL의 name+dong)
연결이 필요**하다 — 이름+동 매칭은 R3A/R4가 이미 증명한 동명이인 위험이
있으므로, `ApartmentMaster.aptSeq`를 `Apartment`에도 채우는 별도 backfill
(schema 변경: `Apartment.aptSeq` 컬럼 추가)이 S2 이전에 필요할 수 있다 —
이건 이번 S1.1에서 실행하지 않고 명확한 선행 과제로만 기록한다.

## 28. 전국 확장 고려

Schema(섹션 23)와 identity 전략(섹션 27) 어디에도 "부산"을 하드코딩하지
않았다 — `ApartmentMaster`가 이미 sido/sigungu를 갖고 있고, score
feature 테이블은 `apartmentMasterId`만 참조한다. 향후 `ApartmentMaster`가
다른 시도로 확장되면(M4 이후 STEP) score feature 배치도 그 지역
좌표만으로 그대로 확장 가능 — score 로직 자체에 지역 고유 가정을 넣지
않았다(섹션 28 요구사항 반영).

## 29. 초기 출시 범위 비교

| | A. 서구 V0.5 | B. 부산 전체 Beta | C. 전국 대기 |
|---|---|---|---|
| 개발기간 | 가장 짧음 | 중간(구조는 동일, 규모만 3,402건 전체) | 매우 김(`ApartmentMaster` 전국 확장 자체가 별도 M4+ STEP) |
| 신뢰도 | 표본 155건(좌표 기준)뿐이라 peer group이 종종 부족 | 3,067건으로 peer group 안정적 | 최고(단, 언제 가능한지 불명) |
| 사용자 가치 | 좁음(서구민만) | **부산 전역 사용자에게 즉시 가치** | 없음(출시 자체가 없음) |
| 확장성 | 다른 구로 갈 때 재작업 없음(구조 동일) | 이미 부산 전역, 전국 확장만 남음 | 확장성 논할 단계 아님 |
| "다른 플랫폼"이라는 목표와의 정합성 | 데이터 기반 서구/해운대 지역 특성 비교 자체가 불가능(비교 대상이 없음) | **서구 vs 해운대 같은 지역 특성 비교가 가능**(섹션 10) — 아실/호갱노노가 안 하는 것 | 시기상조 |

**추천: B(부산 전체 Beta).** 근거: (1) 데이터가 이미 부산 전역을
커버해 A로 좁힐 이유가 약하다, (2) 사용자가 요구한 "다른 플랫폼"이라는
목표는 지역 간 특성 비교(서구=생활 인프라, 해운대=해변 접근성)에서
나오는데 이건 최소 2개 이상 지역이 있어야 가능하다 — A(서구 단독)로는
애초에 이 차별화를 보여줄 수 없다. C는 데이터가 없어 시기상조.

## 30. 부산 전체 Beta 가능 여부 — 결론

**가능하다.** `ApartmentMaster` 3,402건이 이미 부산 16개 구·군 전역을
커버하고, 좌표 coverage(90.2%)도 여러 구에서 고르게 80~90%대다. 서구/
해운대구처럼 서로 다른 입지 특성을 가진 지역을 실제로 비교 테스트할 수
있다는 것이 B를 A보다 우선하는 결정적 이유다.

## 31. Regional pilot — 서구 vs 해운대(read-only, DB 미저장)

이번 STEP에서는 실제 배치 API 호출(Kakao 8종 × 다수 단지)을 실행하지
않았다 — 위 섹션 20의 견적(~24,536회)이 "1회 실행으로 끝나는 소규모
조회"가 아니라 정식 배치 인프라(스케줄러, 재시도, quality flag)가
필요한 규모이기 때문에, 설계 문서 STEP에서 무단으로 대량 호출하는 것은
"임의로 확장하여 수정하지 않는다"는 프로젝트 원칙에 어긋난다고 판단했다.
대신 섹션 11에서 **해변 접근성 계산 가능성만 최소 1회 호출로 실증**했고,
S1에서 이미 서구 주차 percentile pilot을 완료했다 — 두 결과를 합치면
"raw feature 계산 방법 자체는 검증됐다"는 결론에는 충분하다. 서구 5건 +
해운대 5건의 전체 raw feature 비교표는 **S2 착수 시 정식 배치 스크립트의
첫 실행 결과로 제공하는 것을 제안**한다(이 문서에서 인위적으로 소수
단지만 골라 만드는 것은 표본 편향 위험이 있음).

## 32. 결과 예시(형식 제안, 실데이터 아님 — 섹션 31 참고)

```text
서구 A단지: "지하철 접근성이 서구 아파트 중 우수한 편입니다."
해운대 B단지: "해변 접근성이 우수하고 해운대 생활권 접근성이 좋습니다."
```

실제 raw feature가 채워진 뒤에만(섹션 25 explain.ts) 이런 문장을 생성한다
— 지금은 형식 예시일 뿐 실제 계산 결과가 아니다.

## 33. S2 단계 재정의(제안)

```text
S2A  Score Feature Cache Schema   섹션 23 proposal을 실제 migration으로(별도 승인)
S2B  Feature Collection            REST 기반 배치 스크립트(Kakao/TAGO/MOLIT), 다회차 실행
S2C  Score Engine                  raw feature → percentile → explain(server-only)
```

원 지시가 우려한 대로 "S2 = Score Engine" 하나로 뭉치면 배치 인프라
없이 점수부터 만들려는 순서가 돼버린다 — **3단계 분리를 제안**한다.

## 34. unresolved

1. `Apartment`(32건, 상세페이지 실사용) ↔ `ApartmentMaster`(3,402건,
   score foundation) 연결이 아직 없다 — S2 이전에 `Apartment.aptSeq`
   backfill(스키마 변경, 별도 승인) 필요.
2. Kakao/MOLIT 일일 호출 한도 미확인(EXTERNAL_VERIFICATION_REQUIRED) —
   ~24,536회 규모 배치를 하루에 끝낼 수 있는지 확정 불가, 다회차 실행
   전제로 설계.
3. `roadAddress`/`jibunAddress` coverage가 40.8%뿐이라 생활권(섹션 13)
   reference 거리 계산 시 좌표(90.2%)를 우선 쓰고 주소는 보조로만 사용.
4. 면적(`area`) 데이터가 `ApartmentMaster`에 없음 — 가격 peer group의
   "면적 유사" 조건(섹션 17)은 현재 정확히 만들 수 없고 세대수 규모로
   근사할 수밖에 없다.
5. 삼경빌라맨션류 이상치에 대한 자동 플래그 임계값(섹션 7)이 예시일
   뿐 확정값 아님 — S2 배치 실행 후 실제 분포로 재조정 필요.

## 35. S2_GO 판단

```text
데이터 foundation 파악        완료 — ApartmentMaster가 부산 전역 커버(신규 확인)
raw feature 설계              완료(교통/생활/가격/단지/학교접근성/해변접근성)
regional premium 구조         완료(Core=지역 percentile, Premium=별도 배지, B안 채택)
서구 vs 해운대 비교            가능한 것만 실측 확인(해변접근성), 전면 비교는 배치 인프라 필요
peer group 재설계              완료(카테고리별로 다르게)
cache schema proposal          완료(2테이블, 위치/시장 계열 분리)
identity 전략                  완료(ApartmentMaster.aptSeq 채택) — 단 Apartment 연결 backfill 필요(unresolved #1)
API 예산 추정                  완료(TAGO 확인됨 10,000/일 여유, Kakao/MOLIT 한도 미확인)
서버 보안 설계                 완료(server-only calculate.ts, raw feature 비노출)
출시 범위 추천                 완료 — 부산 전체 Beta(B) 추천
```

**S2_조건부_GO** — 구조적 설계는 이번 STEP으로 완결됐다. 실제 S2 착수
전 반드시 필요한 것: (1) `Apartment↔ApartmentMaster` 연결 스키마 변경
승인, (2) 섹션 23 cache schema 승인, (3) Kakao/MOLIT 일일 한도 사용자
확인. 이 세 가지가 정리되면 S2A(schema)부터 순서대로 진행 가능.
