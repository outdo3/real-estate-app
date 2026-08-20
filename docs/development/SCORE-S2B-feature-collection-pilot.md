# STEP SCORE S2B — Feature Cache Production 적용 + 부산 서구·해운대 Raw Feature Collection Pilot

상태: **완료(수집만), commit/push 안 함 — 승인 대기**

이번 STEP의 목적은 S1/S1.1/S2A에서 승인된 스키마를 production에 적용하고, 부산
서구·해운대구를 대상으로 실제 raw feature(위치·시세)를 수집하는 것이다. **점수
계산/가중치/Regional Premium/오션뷰 추정/학군 점수는 전혀 만들지 않았다.**

## 1. Migration 적용

`prisma migrate deploy`로 `20260819145602_score_s2a_feature_cache_schema`
적용 성공(`Database schema is up to date!`). 적용 전후 기존 테이블 row count
비교로 부작용 없음을 실측 확인:

| 테이블 | 적용 전 | 적용 후(수집 완료 시점) |
|---|---|---|
| Apartment | 32 | 32 |
| ApartmentMaster | 3402 | 3402 |
| RedevelopmentProject | 1798 | 1798 |
| Presale | 1046 | 1046 |

## 2. Apartment.aptSeq backfill

S2A 문서 §3의 jibun-우선 매칭 로직을 다시 구현해(추측이 아니라 실제 DB 재조회)
dry-run했더니 S2A 감사 결과(**MATCHED_EXACT 20 / AMBIGUOUS_SHARED_JIBUN 2 /
UNMATCHED_NO_REGION_CANDIDATE 10**, 같은 6쌍 중복·같은 2건 ambiguous 케이스)와
정확히 일치함을 확인한 뒤, MATCHED_EXACT 20건만 적용했다. AMBIGUOUS(레이카운티,
엘지메트로시티3)와 UNMATCHED(서울 강남 5·영등포 3, 경남 진주 2) 12건은 강제
연결하지 않았다.

**Idempotency**: 동일 backfill을 2회 실행해 `aptSeqFilled` 값이 20→20으로
변화 없고 값도 동일함을 확인했다.

## 3. Collector 구현

`KakaoPlaces.tsx`는 브라우저 SDK 전용이라 재사용 불가(S1.1/S2A에서 이미 확인)
— `src/lib/ai-search.ts`의 `findNearestElementarySchool`(서버 REST + KA/Origin
헤더 우회)와 `src/app/api/transit/bus-stops/route.ts`(TAGO 좌표기반 근접정류소)
가 이미 production에서 검증한 패턴을 그대로 재사용해 신규 모듈을 만들었다.

```text
src/lib/apartment-score/collectors/kakao.ts    — Kakao REST 카테고리/키워드 검색
src/lib/apartment-score/collectors/tago.ts     — TAGO 버스정류소(nodeid dedup, 1회 재시도)
src/lib/apartment-score/collectors/location.ts — 단지 1건의 위치 raw feature 오케스트레이션
src/lib/apartment-score/collectors/market.ts   — MOLIT 구·군+월 배치 시세 집계
scripts/apartment-score/collect-location-features.ts
scripts/apartment-score/collect-market-features.ts
scripts/apartment-score/verify-collectors.ts
```

**API 키**: 새 키를 추가하지 않았다. 이 프로젝트는 서버 코드(`ai-search.ts`,
`sigunguResolver.ts`, `api/transactions/route.ts` 등)에서도 이미
`NEXT_PUBLIC_KAKAO_MAP_API_KEY`를 재사용하는 기존 관례가 있어(클라이언트 노출
범위는 기존과 동일, 새로 넓어지지 않음) 그대로 따랐다. 값/로그 출력 없음,
`.env` 미출력.

## 4. Canary batch(10건) — 실제 발견 및 수정한 버그

사용자 지시대로 전체 402건 전에 서구 5 + 해운대 5(구축/신축, 원도심/해안,
역세권/비역세권 혼합) 캐너리를 먼저 실행했다.

**1차 실행에서 실제 버그 발견**: 해운대구 반여동(`26350-156`, 내륙) 단지의
`beachDistanceM`이 null로 나왔다 — 지리적으로 의심스러워 원인을 직접 조회했더니,
Kakao "해수욕장" 키워드 검색 결과 상위 15건이 전부 "OO해수욕장점 안경점/PC방/
환전소/화장실/주차장"처럼 실제 해변 근처 상호명에 "해수욕장"이 붙은 업체였고,
진짜 해변(공식 `category_name` "관광,명소 > 해수욕장,해변")은 그 뒤 순위에
있어 15건 필터링에서 아예 누락됐다. `keywordSearch`에 페이지네이션을 추가해
공식 category_name 일치가 나올 때까지 최대 3페이지(Kakao 상한)까지 조기
종료(early-stop) 방식으로 조회하도록 `keywordSearchNearestMatch`를 새로
구현해 수정했다 — 이후 재실행에서 `26350-156`의 beachDistanceM이 5,079m로
정상 수집됨을 확인(canary 10건 전체 재실행, `--force`).

**Idempotency 검증**: (1) `--force` 없이 재실행 → 10건 전부 fresh-skip(API
호출 0건), (2) `--force`로 재실행 → row 수 10 유지, 값 전부 동일(업데이트
타임스탬프만 갱신).

Canary 결과: 10/10 success, partial 0, failed 0, **429 rate-limit 0건**.

## 5. 서구·해운대 전체 수집

Canary가 이상 없어(429 없음, auth 문제 없음, 호출량 예상치 부합, aptSeq
오매칭 없음, 가격 단위 정상, POI 중복 폭증 없음, DB row 이상 증가 없음) 사용자
사전 승인 조건에 따라 별도 확인 없이 전체 eligible cohort로 이어서 진행했다.

| 지역 | ApartmentMaster 전체 | 좌표+aptSeq eligible | 수집 결과 |
|---|---|---|---|
| 서구(26140) | 171 | 155 | success 150 / partial 0 / failed 0(canary 5건은 fresh-skip) |
| 해운대(26350) | 308 | 247 | success 242 / partial 0 / failed 0(canary 5건은 fresh-skip) |

두 지역 모두 **429 rate-limit 0건**, `failuresByCategory` 빈 객체(카테고리별
실패 0건). checkpoint(fresh-cache skip) 정책이 정상 동작해 canary에서 이미
수집한 10건은 전체 배치에서 자동 skip됐다(중복 호출 없음).

## 6. MOLIT 시세 수집

`fetchMolitData()`를 아파트마다 호출하지 않고 구·군+월 단위로 호출(§19 지시) —
서구/해운대 최근 12개월(2025-08~2026-07, 당월 2026-08 제외) = **24회** 호출로
두 지역 시세 전체를 확보했다. 실패 0건.

| 항목 | 결과 |
|---|---|
| 원본 거래 row | 5,980건 |
| 전용면적(excluUseArea) non-null | 5,980/5,980 (100.0%) |
| 거래금액(dealAmount) non-null | 5,980/5,980 (100.0%) |
| aptSeq non-null | 5,980/5,980 (100.0%) |

S2A가 `EXTERNAL_VERIFICATION_REQUIRED`로 남겨뒀던 면적/가격 결측률 우려가
**기우였음을 실측으로 확정**했다 — `fetchMolitData()`가 이미 `excluUseArea`
(float)/`dealAmount`(int, 만원)/`aptSeq`(string)를 파싱해 반환하고 있었고,
이 12개월 표본에서 결측이 전혀 없었다.

**Identity 매핑**: 이름 fuzzy matching을 전혀 쓰지 않고 MOLIT 원본
`item.aptSeq`를 그대로 사용했다(§23 지시 그대로). `aptSeq`가 없는 거래는
매핑하지 않고 skip(AMBIGUOUS 취급) — 이번 12개월 표본에서는 0건.

**단위 검증**: `dealAmount`(만원) ÷ `excluUseArea`(㎡) = `medianPricePerM2`
(만원/㎡)로 통일했고, `scripts/apartment-score/verify-collectors.ts`에
"50000만원 ÷ 84.5㎡ = 592만원/㎡" 케이스로 단위 오류 방지 검증을 넣었다(실행
중 실제로 반올림 버그 1건을 이 테스트로 잡아 수정했다 — 아래 §9).

**priceChange12m 계산 안 함**: 12개월치만 수집한 이번 pilot 범위에서는 "12개월
전 대비" 비교에 필요한 이전 기준선(t-24~t-12) 데이터가 없다. 거래 1건으로
증감률을 계산하는 것과 같은 무리한 통계이므로 null로 남기고
`EXTERNAL_VERIFICATION_REQUIRED`로 S2C에 넘긴다(§20 12개월 우선 허용). 36개월
feature도 이번 pilot에서는 수집하지 않았다(같은 이유, §20 명시적 허용 범위).

**Idempotency**: 동일 배치 2회 실행 → `ApartmentMarketFeature` row 수
417→417, 값 동일.

## 7. Feature Coverage 실측

| feature | 서구(n=155) | 해운대(n=247) |
|---|---|---|
| nearestSubwayDistanceM | 124 (80.0%) | 196 (79.4%) |
| subwayCount1000m | 155 (100%) | 247 (100%) |
| busStop(TAGO) | 155 (100%) | 247 (100%) |
| mart/convenience/pharmacy | 155 (100%) | 247 (100%) |
| hospitalCount1000m | 155 (100%, 단 아래 §8 상한 참고) | 247 (100%, 동일) |
| parkCount1000m | 155 (100%) | 247 (100%) |
| daycareKindergartenCount500m | 155 (100%) | 247 (100%) |
| nearestElementaryDistanceM | 155 (100%) | 243 (98.4%) |
| beachDistanceM | 155 (100%) | 247 (100%) |

학교 접근성(§15 DEFER 검토 대상)은 실제로는 98.4~100% coverage로 안정적으로
연결됨을 확인했다 — **DEFER하지 않고 유지**하는 것으로 결론을 바꾼다(당초
우려와 달리 실측 결과가 좋았다).

지하철 결측(20%대)은 실제로 지하철이 1km 이내에 없는 지역(예: 암남동/송도,
반여동 일부)을 정직하게 반영한 것으로, 음수·이상값은 0건이었다.

## 8. 알려진 한계 — Kakao `pageable_count` 45건 상한

Kakao 카테고리 검색의 `meta.pageable_count`는 문서상 최대 45(3페이지)로
상한이 걸린다. `hospitalCount1000m`이 정확히 45로 찍힌 단지가 **서구
116/155(74.8%), 해운대 176/247(71.3%)** — 이 지역 병원 밀도가 실제로 45개를
넘는 곳이 대부분이라는 뜻으로, **이 필드의 실제 의미는 "정확한 개수"가
아니라 "45개 이상(고밀도)"에 가깝다**. `convenienceCount500m`은 45 상한에
걸린 사례가 0건이라 그 값은 신뢰할 수 있는 정확한 개수다. S2C에서 이 필드를
쓸 때는 45를 "≥45"로 해석해야 한다 — 자동 보정하지 않고 raw 값 그대로
저장했다.

## 9. verify-collectors.ts — 실행 중 발견한 실제 버그

`aggregateByAptSeq`의 내부 `median()` 함수가 표본이 홀수(특히 1건)일 때
반올림을 하지 않고 짝수일 때만 `Math.round`를 적용하는 버그가 있었다 —
`medianPricePerM2_12m` 컬럼은 Prisma에서 `Int`인데 이 버그 상태로는 소수
그대로 insert 시도 시 실패했을 것이다. 테스트 작성 중 이 케이스로 실제로
잡아 수정했다(모든 분기에서 `Math.round` 적용).

## 10. 이상치(raw, 자동 수정 안 함)

- **음수/불가능값**: 거리·개수 필드 전체에서 음수 0건.
- **주차대수/세대수 비율**(기존 `ApartmentMaster.parkingCount`/
  `totalHouseholds`, 이번 STEP에서 새 컬럼 만들지 않음, 계산만 확인):
  서구 26/171건 계산 가능, 그중 2건이 세대당 0.3대 미만(`26140-97` 0.29,
  `26140-103` 0.20). 해운대 97/308건 계산 가능, 그중 5건이 세대당 3대
  초과(`26350-2117` 4.84, `26350-2120` 4.11, `26350-2206` 3.19 등) —
  전부 raw 관찰만 기록, S2C 검수 후보로 남긴다.
- **거래 표본 부족**: `transactionCount12m == 1`인 aptSeq가 서구
  47/139(33.8%), 해운대 49/278(17.6%) — 이 표본에서 나온
  `medianPricePerM2`는 단일 거래값과 동일하므로 S2C에서 최소 표본 조건
  없이 그대로 신뢰하면 안 된다(quality flag 상 `complete`로 저장돼 있지만
  표본 수 자체를 반드시 같이 확인해야 함).

## 11. 지역 간 관찰(인과 단정 없음, raw 데이터만)

- 해운대 표본의 `medianPricePerM2_12m`가 서구 표본보다 대체로 높게
  관찰됨(예: 26350-2093 1,353만원/㎡ vs 26140-1361 702만원/㎡).
- 해운대 표본의 `beachDistanceM`이 서구보다 전반적으로 짧게 관찰됨(당연히
  지리적 사실 — 해운대구가 해변 인접 지역이 더 많음).
- 이 관찰들 사이의 인과관계(예: "해변이 가까워서 비싸다")는 이번 STEP에서
  전혀 검증하지 않았다 — S2C에서 실거래 관계를 별도 분석해야 할 사안으로
  남긴다.

## 12. 만들지 않은 것(재확인)

`totalScore`/`transportScore`/`livingScore`/`marketScore`/`premiumScore`/
`finalScore` 컬럼 없음. 가중치/정규화/peer-group 로직 없음. 새 public API
route 없음(`next build` 결과 확인, 라우트 목록에 신규 apartment-score 관련
엔드포인트 없음). UI/페이지/컴포넌트 변경 없음. 학군 점수/오션뷰 추정 없음.

## 13. 검증

```text
npx prisma validate   — schema is valid
npx prisma generate   — 성공
npx tsc --noEmit      — 0 errors
npx eslint src/lib/apartment-score scripts/apartment-score — clean
npx next build        — 성공, 신규 라우트 없음
verify-collectors.ts  — 10/10 pass(collector parsing/distance/dedup/시세
                         단위/aptSeq mapping/retry 에러 처리 커버, 이
                         프로젝트에 별도 테스트 러너가 없어 기존
                         scripts/ assert 기반 검증 관례를 따름)
```

## 14. S2C(다음 STEP)에 넘기는 것

- **EXTERNAL_VERIFICATION_REQUIRED**: `priceChange12m`(24개월 기준선 필요,
  이번 STEP 미계산), 36개월 시세 feature(미수집, §20 범위 밖으로 명시적
  보류).
- `hospitalCount1000m` 등 Kakao 45-cap에 걸리는 필드는 "정확한 개수"가
  아니라 "≥45"로 해석해야 함을 점수 엔진 설계에 반영 필요.
- `transactionCount12m == 1`인 aptSeq는 최소 표본 조건(예: 3건 이상)을
  점수 엔진 단에서 별도로 걸어야 함 — raw 테이블에는 그대로 저장돼 있음.
- 주차 이상치 12건(§10)은 raw 그대로 두었으니 S2C에서 quality 검수 대상.
- 학교 접근성은 DEFER 취소, 정식 feature로 사용 가능(coverage 98.4~100%).

## 15. 결론

Migration 적용/backfill 20건/canary 10건/서구 150건/해운대 242건 =
**LocationFeature 402 rows, MarketFeature 417 rows** 전부 idempotent 수집
완료. 429 rate-limit 0건, API 실패 0건, aptSeq 오매칭 0건, 음수 이상치
0건. Canary 단계에서 실제 버그(해변 검색 크라우딩아웃) 1건, 유닛테스트
단계에서 실제 버그(median 반올림 누락) 1건을 발견해 수정했다. commit/push는
이번 STEP에서 하지 않는다(사용자 지시 §45, ChatGPT 검수 대기).

**S2C_GO** — 조건: §14의 EXTERNAL_VERIFICATION_REQUIRED 2건(priceChange12m,
36개월 feature)과 45-cap/최소표본 해석 규칙을 점수 엔진 설계에 명시적으로
반영할 것.
