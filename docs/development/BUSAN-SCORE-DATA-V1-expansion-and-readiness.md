# BUSAN SCORE DATA V1 — 부산 16개 구·군 Feature 확대 + 학교거리 Correctness Preflight

## 1. Before coverage (시작 상태)

SCORE V1.1 = ChatGPT 승인 완료, 커밋(`1da0c0a fix: calibrate school
accessibility score explanations`) + push 완료(이 STEP §0에서 수행,
HEAD==origin/main 확인).

시작 시점 실측 coverage: 서구 155/171(90.6%), 해운대구 247/308(80.2%),
나머지 14개 구·군 0/2,923(0%).

## 2. Pipeline architecture (기존 파이프라인 구조)

- `scripts/apartment-score/collect-location-features.ts` — 아파트 좌표 기준
  Kakao Local(카테고리/키워드 검색 9종) + TAGO(버스정류소 1종) 호출,
  `ApartmentLocationFeature`에 upsert. `validUntil`(30일) 기준 freshness-skip으로
  이미 수집됐고 유효한 단지는 재수집하지 않음 — 이게 곧 idempotency이자
  resumability다(새 상태 파일 불필요).
- `scripts/apartment-score/collect-market-features.ts` — 구·군+월 단위로
  MOLIT 실거래를 묶어서 조회(단지별 호출 아님), `ApartmentMarketFeature`에
  upsert(7일 TTL).
- `src/lib/apartment-score/collectors/{location,kakao,tago,market}.ts` — 실제
  호출/파싱 로직. 카테고리별 실패는 해당 feature만 null로 남기고
  (`qualityFlag: 'partial'`) 전체 실패로 취급하지 않음.
- `src/lib/apartment-score/server/calculate.ts` — 위 두 feature 테이블 +
  `ApartmentMaster`를 읽어 실제 점수를 계산(§9 무변경).

## 3. Source inventory (외부 API 인벤토리)

| API | 용도 | 인증 | rate limit 처리 |
|---|---|---|---|
| Kakao Local REST(`dapi.kakao.com`) | 지하철/마트/편의점/약국/병원/어린이집/학교/공원/해변 카테고리·키워드 검색 | `NEXT_PUBLIC_KAKAO_MAP_API_KEY`(기존 client 키 재사용, 새 키 아님) + KA/Origin 우회 헤더 | 호출 사이 150ms 고정 페이싱, 429 시 1회만 1초 backoff 후 재시도, 그래도 실패면 해당 feature만 null |
| TAGO(`apis.data.go.kr` BusSttnInfoInqireService) | 좌표기반 최근접 버스정류소 | `DATA_GO_KR_API_KEY`(기존 키 재사용) | 실패 시 400ms 후 1회 재시도, 그래도 실패면 null |
| MOLIT(`fetchMolitData`, 기존 공용 헬퍼) | 구·군+월 단위 아파트 매매 실거래 | 기존 재사용 | 기존 프로젝트 전역 동시성 제한 재사용(신규 아님) |

정확한 일일/QPS 한도는 공식 문서로 확인되지 않아(기존 코드 주석에도
"EXTERNAL_VERIFICATION_REQUIRED"로 표기돼 있음) 보수적 페이싱 + 짧은
고정 재시도 정책을 그대로 유지했다. **실제 부산 전체(2,610건 신규 +
기존) 수집을 마치는 동안 429는 관측되지 않았다.**

## 4. "송도 +5분" correctness audit(§1)

`src/app/api/school/apartments/route.ts`(학교 상세페이지의 "인근 아파트"
도보시간 계산, Score Engine과 무관)에서 발견:

```ts
if (schoolName.includes('송도')) { walkMin += 5; }
```

- **조건**: 학교 **이름** 문자열에 "송도"가 포함되면(예: "송도초등학교")
  적용 — 특정 아파트가 아니라 그 학교 반경 내 **모든** 아파트에 획일 적용.
- **대상**: `distance`가 아니라 최종 `walkMin`(표시용 도보 분)에 가산.
- **영향 범위**: `/school/[id]` 학교 상세페이지의 "인근 아파트" 목록 카드
  (`walkTime` 필드)뿐 — **Score Engine에는 영향 없음**(`apartment-score/`
  디렉토리 전체에서 이 라우트나 이 로직을 참조하는 곳 0건, 정적 확인).
- **근거 추적**: git history(`git log -p`)에서 과거 코멘트
  `// 특정 지형(송도) 언덕 페널티 보정`을 발견 — 송도(서구 암남동 일대)가
  실제 해안 언덕 지형이라는 정성적 의도는 있었으나, 이후 리팩터에서
  코멘트만 유실됐고 "+5"라는 값 자체는 실측 경사/고도 데이터가 아닌
  임의 추정치였다.
- **결정**: **제거**. 절대 원칙("학교거리 임의 보정 금지", "다른 숫자로
  대체 금지")에 따라 다른 계수로 바꾸지 않았다. 실제 경사가 반영된
  추정이 필요하면 SCHOOL V2에서 정식 보행경로 API로 처리할 사안이라고
  코드 주석에 남겼다.
- **실측 전/후 비교**(서구 e편한세상송도더퍼스트비치, 송도초등학교 기준,
  거리 208m): 수정 전 "도보 14분" → 수정 후 "도보 9분"(정확히 -5).
  같은 학교의 다른 인접 아파트들도 동일하게 -5분. 통제군(송도 아닌
  동신초등학교 인근 아파트들)은 변화 없음을 확인.

## 5. Walking time 실제 방식(§2)

두 곳 모두 **B(거리÷속도 단순 계산)** — 실제 보행경로 API가 아니다.

- `KakaoPlaces.tsx::formatEta`: `walkMin = Math.ceil(distance/80)`, 이미
  "도보 약 N분"으로 "약"을 붙여 표기(변경 없음, 기존에 이미 정직했음).
- `api/school/apartments/route.ts`: `realDistance = dist*1.45` 보정 후
  `walkMin = round(realDistance*15) + 구간별 padding`. **"약"이 빠져 있던
  것을 발견** — "도보 N분"이 실제 경로처럼 확정적으로 읽힐 수 있어
  "도보 약 N분"으로 수정(§35 wording 정책과 일관).
- 실제 routing API 연동(정확도 개선)은 이번 STEP에서 금지된 "새로운
  외부 API 연결"에 해당해 SCHOOL V2로 이관.

## 6. regionLabel 문제(§3)

**문제**: `calculate.ts`가 카테고리별 실제 peer level(LOCAL/SIGUNGU/
REGION_WIDE)과 무관하게 항상 sigungu 이름을 설명 문구에 썼다. 실측(§13
아래)상 96.5%가 실제로는 LOCAL(동) 비교인데도 "서구 비교 단지보다"로
표현돼, 실제보다 넓은 지역 비교인 것처럼 보였다.

**수정**: `src/lib/apartment-score/server/region-label.ts` 신규 —
`regionLabelForPeerLevel(peerLevel, sigungu, umdName, isParkingLike)`이
카테고리별 실제 peerLevel에 맞는 표현을 고른다: LOCAL(동 단위)→동 이름,
주차 LOCAL(sigungu+연식대라 동 단위 아님)→"{구} 유사 연식", SIGUNGU→구
이름(기존과 동일), REGION_WIDE→"부산 전체". `explain.ts`/`briefing.ts`가
`CategoryResult.peerLevel`(이미 존재하던 필드)을 보고 문구를 고르도록
시그니처를 변경했다 — **score/formula는 전혀 건드리지 않았다**.

**실측 검증**(구덕금호 aptSeq 26140-11): 수정 전후 score는 정확히 동일
(54점, 카테고리별 55/59/null/56/41 — 완전히 동일). 텍스트만 "서구
비교 단지와 비슷한 수준입니다" → "동대신동3가 비교 단지와 비슷한
수준입니다"(실제 LOCAL 비교였음)로 정확해짐.

## 7. 부산 16개 구·군 확대 collection — 완료

MOLIT 시세 데이터는 16개 구·군 즉시 수집 완료(총 192회 호출, 실패
0건, 2,937건 upsert). 위치 feature(교통/생활/학교)는
`expand-busan-location-features.ts`로 사용자 지정 순서(부산진구→
동래구→연제구→남구→수영구→사하구→동구→중구→영도구→북구→사상구→
금정구→강서구→기장군)에 따라 순차 수집했다.

수집 도중 실행 프로세스가 한 번 외부 요인으로 중단됐으나(부산진구
100%, 동래구 100%, 연제구 146/222까지 진행된 상태), **동일 스크립트를
재실행하는 것만으로 이어서 완료됐다** — freshness-skip이 이미 수집된
816건을 자동으로 건너뛰고 나머지부터 재개함을 실측으로 증명했다(§19
resume, 새 상태 파일 불필요).

**최종 결과 — 부산 16개 구·군 전체 location feature 수집 완료**:

| 구·군 | 단지수(좌표 보유) | location feature | market feature |
|---|---:|---:|---:|
| 강서구 | 44 | 42(95.5%) | 42(95.5%) |
| 금정구 | 308 | 282(91.6%) | 238(77.3%) |
| 기장군 | 152 | 136(89.5%) | 124(81.6%) |
| 남구 | 253 | 220(87.0%) | 220(87.0%) |
| 동구 | 99 | 88(88.9%) | 79(79.8%) |
| 동래구 | 314 | 292(93.0%) | 283(90.1%) |
| 부산진구 | 404 | 378(93.6%) | 357(88.4%) |
| 북구 | 173 | 165(95.4%) | 154(89.0%) |
| 사상구 | 151 | 137(90.7%) | 141(93.4%) |
| 사하구 | 338 | 303(89.6%) | 294(87.0%) |
| 서구 | 171 | 155(90.6%) | 139(81.3%) |
| 수영구 | 251 | 226(90.0%) | 217(86.5%) |
| 연제구 | 244 | 222(91.0%) | 206(84.4%) |
| 영도구 | 133 | 119(89.5%) | 113(85.0%) |
| 중구 | 59 | 55(93.2%) | 52(88.1%) |
| 해운대구 | 308 | 247(80.2%) | 278(90.3%) |

합계: `ApartmentLocationFeature` 3,067건, `ApartmentMarketFeature`
2,937건. **429(rate limit) 0건.** 데이터 품질: complete 2,838건
(92.5%) / partial 229건(7.5%, 주로 TAGO 개별 실패 — 좌표/학교/교통
자체는 대부분 정상).

기존 서구/해운대 155/247건은 **재수집되지 않고 원본 그대로 보존**됨을
확인(구덕금호 aptSeq 26140-11의 `fetchedAt`이 이 STEP 시작 이전
시각으로 그대로 남아있음 — freshness-skip이 실제로 작동한 증거).

## 8. 카테고리별 coverage(3,067건 전체)

- transport/living/schoolAccess: 0.3%(8건) 미채점 — 전부 개별 API
  전체 실패로 위치 feature 행 자체는 있지만 카테고리 계산에 필요한
  값이 하나도 안 잡힌 극소수 사례(정직하게 INSUFFICIENT_DATA 처리됨).
- parking: 74.2%(2,276건) 미채점 — 기존과 동일 수준(ApartmentMaster
  자체의 parkingCount 결측, 이번 STEP과 무관한 기존 한계).
- complex: 0% 미채점.

## 9. Score coverage(최종)

3,067건 중 **OK 3,059건(99.7%)**, INSUFFICIENT_DATA 8건(전부
FEATURE_CACHE_MISSING) — score가 "잘못" 나온 케이스는 0건(§25
wrong-score prevention 전부 통과).

## 10. Preparing reasons

`FEATURE_CACHE_MISSING` 8건뿐 — 다른 reason 코드(MISSING_TRANSPORT
등 단일 카테고리 결측, INSUFFICIENT_TOTAL_COVERAGE)는 이번 실측에서
관측되지 않았다(모든 구가 충분히 높은 coverage를 확보해 부분 결측
패턴이 나타나지 않음).

## 11. Anomalies(실제 발견 + 조사 결과)

- **school anomaly**: 0m 거리 1건, 20m 미만 0건, 3000m 초과 0건,
  null-but-complete 16건. **둘 다 직접 조사해 실제 이상이 아님을
  확인했다**:
  - 0m 사례(수영구 남천동 "광남", aptSeq 26500-229): `elementaryCount
    1000m=2`(반경 내 학교 2곳 존재) — 단지가 초등학교와 사실상 붙어
    있는 실제 "초품아" 케이스. 절대 band 로직(VERY_CLOSE, ≤200m)이
    정상 처리한다.
  - null-but-complete 16건: 전부 기장군 일광읍/기장읍(해안 리조트형
    저밀도 지역)과 해운대 송정동(서핑 마을) — 실제로 반경 1000m 내
    초등학교가 없는 지역이 맞다(지리적으로 타당, `elementaryCount
    1000m=0`과 일치). 데이터 결함이 아니라 진짜 "확인된 부재".
- **wrong-score prevention**: OK인데 coverage<0.6인 케이스 0건, 중복
  aptSeq 0건. **master.sggCd가 2개 이상 sigungu에 걸쳐 쓰인 경우
  0건**(=score engine이 실제로 쓰는 cohort key는 100% 자기 일관적,
  실측 확인) — cross-district 오염 위험 없음.
  - (참고, score 무관) aptSeq **접두어**와 현재 sigungu가 다른 사례
    1건 발견(래미안포레스티지1단지, aptSeq `26260-3648`, 현재
    sigungu=금정구·sggCd=26410, 접두어는 옛 동래구 코드 26260) —
    조사 결과 1988년 금정구가 동래구에서 분리된 행정구역 변천사로
    MOLIT의 옛 단지 고유번호 접두어가 남아있는 것으로 확인했다.
    score engine은 aptSeq 접두어가 아니라 `sggCd` 필드로 cohort를
    묶으므로(코드 확인) **실제 채점에는 전혀 영향 없음** — 정보성
    기록으로만 남긴다.
- 좌표 이상치(전체 3,402건 사전 점검): 0,0 좌표 0건, 부산 범위 밖
  좌표 0건, 동일좌표 5건 이상 군집 0건.

## 12. Score distribution(구별, 최종)

| 구·군 | n | min | p25 | median | p75 | max |
|---|---:|---:|---:|---:|---:|---:|
| 서구 | 155 | 21 | 43 | 53 | 59 | 75 |
| 동래구 | 292 | 18 | 44 | 51 | 58 | 73 |
| 해운대구 | 247 | 16 | 41 | 50 | 59 | 78 |
| 부산진구 | 378 | 20 | 43 | 52 | 58 | 80 |
| 중구 | 51 | 30 | 42 | 51 | 58 | 79 |
| 남구 | 220 | 14 | 42 | 49 | 59 | 77 |
| 연제구 | 222 | 22 | 42 | 50 | 58 | 74 |
| 강서구 | 42 | 32 | 41 | 47 | 56 | 67 |
| 동구 | 88 | 28 | 44 | 51 | 57 | 72 |
| 영도구 | 119 | 31 | 45 | 51 | 57 | 76 |
| 사상구 | 137 | 20 | 43 | 50 | 56 | 77 |
| 기장군 | 132 | 27 | 41 | 50 | 57 | 71 |
| 북구 | 165 | 19 | 43 | 51 | 57 | 73 |
| 수영구 | 226 | 18 | 43 | 49 | 57 | 81 |
| 금정구 | 282 | 15 | 41 | 52 | 59 | 80 |
| 사하구 | 303 | 22 | 40 | 50 | 60 | 79 |

전체(3,059건 OK): min=14, p25=42, median=51, p75=58, max=81. ≤10점/
≥90점 0건 — 부산 전역에서 SCORE V1.1의 "정상 분포, 극단 클러스터링
없음" 결론이 그대로 유지된다. 16개 구 모두 median이 47~53 좁은
범위에 모여 있어, 특정 구가 구조적으로 부당하게 높거나 낮게 나오는
패턴도 없다.

## 13. Peer fallback(최종)

전체 3,067건: LOCAL 96.5% / SIGUNGU 3.5% / REGION_WIDE 0%. **16개
구·군 어디서도 REGION_WIDE 폴백이 한 번도 발생하지 않았다** — 구
표본이 충분히 커서(최소 42건, 대부분 100건 이상) SIGUNGU 레벨에서
항상 5건 이상 확보됨.

## 14. QA

- 서구/해운대/중구 regression: 재수집되지 않고 원본 값 그대로 보존
  확인(§7). score 분포도 SCORE V1.1 실행 결과와 사실상 동일.
- 신규 13개 구·군: `calculateApartmentScore()`(수정 없는 production
  함수) 전수 실행 결과 OK 비율 92.7%(중구)~100%(대부분) — 강서구/
  기장군처럼 표본이 작은 구(42/136건)도 정상 분포.
- 대표 단지 샘플(구별 3건, 총 48건)을 실제 aptSeq/score/coverage와
  함께 감사 스크립트 출력에 남겼다(문서 부록 대신 스크립트 재실행으로
  항상 최신 샘플을 볼 수 있게 함 — 고정 스냅샷을 문서에 박아두면 다음
  재수집 후 stale해지므로).

## 15/16/17. READY / LIMITED / BLOCKED — 최종

**부산 16개 구·군 전체가 READY다**(location coverage 80.2~95.5%,
전부 50% 기준 상회). LIMITED/BLOCKED 구는 0개.

이것이 "부산 전체 score 품질이 완벽하다"는 뜻은 아니다 — parking
카테고리는 여전히 74.2% 결측(기존부터 있던 한계, 이번 STEP 범위 밖)
이고, coverage가 낮은 개별 단지(좌표 없음 5~20%)는 여전히 준비중으로
남는다. 하지만 **"위치 feature 자체가 없어 통째로 준비중"이던 14개
구·군의 구조적 문제는 해소됐다**.

## 18. SCHOOL V2 handoff

- `api/school/apartments/route.ts` 실제 보행경로 API 연동(현재는 직선거리
  ×1.45 근사).
- `송도` 하드코딩 제거 이후 실제 언덕/경사 반영이 필요하다면 정식
  경사 데이터 소스로.
- SCORE V1.1에서 이미 기록된 handoff 항목(좌표 이상, 학교종류, duplicate
  등) — 이번 부산 전역 실측에서도 추가 이상치가 발견되지 않아 그대로
  유지.
- (참고) MOLIT aptSeq 접두어가 행정구역 변천사로 현재 sigungu와 다른
  경우가 존재함(§11) — score engine에는 무해하지만, 향후 aptSeq 기반
  UI 라우팅/링크 생성 로직을 새로 만들 일이 있다면 sggCd/sigungu
  필드를 신뢰하고 aptSeq 접두어는 신뢰하지 말 것.

## 18-A. FINAL 8 CHECK — non-OK 8건 정밀 재조사(§8/§9/§10 정정)

**목적**: §8/§9/§10에서 "8건 전부 개별 API 전체 실패로 위치 feature 행 자체는
있지만 카테고리 계산에 필요한 값이 하나도 안 잡힌 극소수 사례"라고 서술했다.
commit/push 전 최종 확인 차원에서 8건을 `calculateApartmentScore()` +
`resolvePeerPool()` + `computeCategoryFromSubMetrics()`를 직접 재현해
개별 조사했다(`scripts/apartment-score/busan-final8-check.ts`, read-only).

**결론: §8/§9/§10의 원인 서술은 부정확했다.** 8건 전부 raw location feature
값 자체는 정상적으로 존재한다(`qualityFlag=complete`가 대부분, 대상 단지
본인의 subway/bus/mart/학교 거리 값도 실제로 채워져 있음). "API 전체 실패"가
아니다.

**실제 원인(8건 전부 동일 패턴)**:

1. 8건은 정확히 2개 동(대청동4가·중구 4건, 일광읍 이천리·기장군 4건)에
   몰려 있다.
2. 두 동 모두 `resolvePeerPool()`의 LOCAL(동) 후보 수가 정확히
   `PEER_SAMPLE_MEDIUM`(5) — 딱 문턱값이라 SIGUNGU(중구 59건/기장군 152건,
   location feature 보유 55건/136건의 훨씬 안정적인 표본)로 폴백하지 않고
   LOCAL이 채택된다.
3. `resolvePeerPool`은 **후보 개수(구조적 존재 여부)만** 보고 레벨을
   정하고, 그 후보들이 실제로 해당 sub-metric 값을 갖고 있는지는
   전혀 보지 않는다(peer-groups.ts 자체 주석: "관심사 분리").
4. `computeCategoryFromSubMetrics`는 sub-metric마다 별도로
   `includedCount < PEER_SAMPLE_MEDIUM`이면 그 sub-metric을 제외(재분배
   대상)한다. LOCAL 풀이 5명뿐인데 그중 1~3명이 해당 필드 값이 없으면
   `includedCount`가 4 이하로 떨어져 **문턱값 미달** → 그 sub-metric
   전체가 빠진다.
5. transport/living/schoolAccess의 sub-metric이 전부 이 조건에 걸려
   카테고리 전체가 NOT_SCORED가 된다 — 대상 단지 자신의 값이 멀쩡해도
   "같은 동 5명 중 1명이라도 결측이면 전체 무효" 구조라 살아남지 못한다.
6. 이때 레벨은 LOCAL로 고정된 채이고, 표본이 충분한 SIGUNGU로 재폴백하는
   경로가 없다 — `resolvePeerPool`이 레벨을 한 번만 구조적으로 결정하고,
   `computeCategoryFromSubMetrics`가 그 레벨의 실제 사용 가능 표본이
   부족함을 발견해도 상위 레벨로 다시 시도하지 않는다.

**실측 예시**(aptSeq 26110-9, 새들맨션, 중구 대청동4가):
peerPool(non-parking) = LOCAL/MEDIUM/size=5. `nearestSubwayDistanceM`
non-null 4/5, `nearestBusStopDistanceM`/`busStopCount300m` non-null 3/5 —
전부 5 미만이라 transport 전체 NOT_SCORED. 정작 이 단지 자신의
`nearestSubwayDistanceM=625`, `nearestBusStopDistanceM=76` 등은 실제
존재하는 값이다. 같은 sggCd(26110) 안에는 location feature를 가진 단지가
55건 있어 SIGUNGU 레벨이면 충분히 점수를 낼 수 있었을 것으로 보이나,
현재 구현은 그 경로로 가지 않는다.

**분류**: A(EXPECTED_PREPARING)가 아니라 **C(FEATURE_ISSUE)** — 정확히는
"peer-pool 레벨 선택이 실제 데이터 완전성을 반영하지 않는" 기존
SCORE V1.1 알고리즘의 구조적 엣지케이스다. 이번 STEP(부산 16개 구·군
확장)이 새로 만든 버그가 아니라 **기존에 있었지만 서구/해운대 pilot
표본(동 단위 표본이 대부분 6건 이상)에서는 드러나지 않았던 경계 조건**이
이번 확장으로 동 표본이 정확히 5명뿐인 두 동(대청동4가, 일광읍 이천리)이
포함되면서 처음 실측으로 드러났다. `peer-groups.ts`/`category-helper.ts`
자체는 이번 STEP에서 수정하지 않았다(§7 git diff 확인 — 두 파일 모두
unmodified).

**영향 범위 확인**: 사용자에게는 안전하다 — `ApartmentScoreCard.tsx:31`이
`result.status !== 'OK' || result.score == null`이면 무조건 "점수 산정
준비 중입니다"만 보여준다(원인 무관, 잘못된 점수 노출 경로 없음).
`preparingReason=FEATURE_CACHE_MISSING` 라벨 자체는 운영자 전용
문구(`PREPARING_REASON_ADMIN_LABEL`, 사용자 비노출)인데 이 8건에는 부정확한
설명("이 지역에 아직 수집되지 않음")이다 — 실제로는 수집은 됐고 peer-pool
경계조건 때문이다. 사용자 노출 문구(`PREPARING_REASON_PUBLIC_MESSAGE`)는
원인을 구분하지 않아 무관하다.

**이번 STEP에서 코드 수정을 하지 않은 이유**: `resolvePeerPool`에 상위
레벨 재시도 로직을 추가하는 것은 SCORE V1.1 핵심 알고리즘(peer 선택 규칙)
변경이라 AGENTS.md 작업 흐름(분석→설계→승인→구현)상 별도 승인이 필요한
설계 변경이다. 이번 STEP 범위(부산 데이터 확장 + 최종 8건 확인)를 넘어서
임의로 확장 수정하지 않는다(CLAUDE.md 원칙 3).

## 18-B. PEER FALLBACK HOTFIX — 구현 + regression 결과

**목적**: §18-A에서 발견한 peer-pool 레벨 선택 구조적 엣지케이스(LOCAL
nominal candidate 수는 충분해도 실제 usable sub-metric 표본이 부족하면
카테고리 전체가 NOT_SCORED로 빠지고 SIGUNGU로 재폴백하지 못하던 문제)를
수정한다.

**선택한 설계(Option C, 승인됨)**: category 단위 LOCAL→SIGUNGU→REGION_WIDE
재시도, calculate.ts 오케스트레이션 레이어에 구현.

- `peer-groups.ts`: `resolvePeerPoolLevels()` 신규 추가 — 기존
  `resolvePeerPool()`의 LOCAL/SIGUNGU/REGION_WIDE 판정을 그대로 재사용해
  "시도 순서" 배열(최대 3개, 조건 미충족 레벨은 제외하되 REGION_WIDE는
  항상 마지막 안전망으로 포함)로 반환한다. `resolvePeerPool()`은 이제
  `resolvePeerPoolLevels()[0]`을 반환하도록 위임만 하며, 시그니처·반환값·
  기존 테스트 결과는 100% 동일 유지(verify-score-engine.ts 신규 테스트로
  이 동등성 자체를 assert로 고정했다).
- `calculate.ts`: `computeCategoryWithFallback()` 신규 추가 — levels 배열을
  순서대로 시도하다 `status !== 'NOT_SCORED'`가 나오면 즉시 그 결과를
  채택한다. 기존 3,059건은 전부 1차(LOCAL) 시도에서 바로 성공하므로 동작·
  성능 영향이 없다. 카테고리 안에서 sub-metric마다 다른 레벨을 섞어 쓰지
  않는다(항상 카테고리 전체가 한 레벨로 통일) — `CategoryResult.peerLevel`이
  실제 채택된 레벨을 그대로 담아 반환되므로 `regionLabel`도 자동으로
  정확해진다(별도 수정 불필요, 아래 실측으로 확인).
- **변경하지 않은 것**: `category-helper.ts`, `percentile.ts`, `config.ts`
  (CATEGORY_WEIGHTS/SUBWEIGHTS/`MIN_TOTAL_COVERAGE`/`PEER_SAMPLE_MEDIUM`
  전부 무변경), 5개 category 파일(`transport.ts` 등) — 전부 승인된 범위
  그대로.

**[추가 확인 1] REGION_WIDE 실제 동작**: `resolvePeerPoolLevels()`에
`cohortOtherRegions`를 넘기지 않으면(calculate.ts는 항상 생략) REGION_WIDE의
후보 집합은 SIGUNGU와 **완전히 동일**하다(`[...cohortSameSigungu]`만 채워짐).
즉 이름(`REGION_WIDE`, "부산 전체")과 달리 실제로는 SIGUNGU의 동의어이며,
SIGUNGU가 실패하면 REGION_WIDE 재시도는 항상 no-op으로 같은 결과를 반환한다.
이 사실을 `peer-groups.ts`/`types.ts`(`PeerLevel` 타입 주석)에 명시했다.
새 API 의존성을 추가하지 않는 이번 STEP 범위에서는 실제 타 지역 조회를
구현하지 않았다 — 필요해지면(SIGUNGU까지 실패하는 사례가 실측되면) 별도
STEP으로 `cohortOtherRegions`를 채우는 설계가 필요하다.

**[추가 확인 2] peerLevel 정확성 실측**: 새들맨션(26110-9) 수정 후 실제
API 응답 텍스트 확인 결과 —
`transport: "교통 접근성이 중구 비교 단지와 비슷한 수준입니다."`(SIGUNGU로
폴백된 카테고리는 "중구"로),
`complex: "단지 특성이 대청동4가 비교 단지보다 다소 아쉬운 편..."`(LOCAL이
그대로 성공한 카테고리는 "대청동4가"로) — **한 단지 안에서 카테고리마다
실제로 다른 레벨에 착지하고, 그게 각각 정확한 지역명으로 설명 문구에
반영됨을 실측으로 확인**했다(verify-score-engine.ts `[F/H]` 테스트로도
동일 시나리오를 unit-level로 고정).

**Target 8 before/after**:

| aptSeq | 단지명 | before | after |
|---|---|---|---|
| 26110-9 | 새들맨션 | preparing | OK, 51점 |
| 26110-65 | 경우빌라 | preparing | OK, 42점 |
| 26110-780 | 동호이루마시티 | preparing | OK, 59점 |
| 26110-8 | 동림 | preparing | OK, 46점 |
| 26710-546 | 동부산쏠마레 | preparing | OK, 34점 |
| 26710-642 | 일광신도시비스타동원2차 | preparing | OK, 63점 |
| 26710-437 | 가화일광타워 | preparing | OK, 32점 |
| 26710-38 | 부전비치 | preparing | OK, 44점 |

8건 전부 transport/living/schoolAccess가 LOCAL(동, n=5) 실패 후 SIGUNGU로
폴백되며 정상 score를 회복했다(부산진구 등 대규모 구 표본이 아니라 각자의
sggCd cohort — 중구 55건/기장군 136건 — 로 안정적으로 계산됨).

**부산 3,067건 전체 regression(before→after)**:

- OK: 3,059건 → **3,067건**(+8, target 8 전부 회복)
- preparing: 8건 → **0건**
- 억지로 100%를 만들려 한 게 아니라(§11 원칙 준수), 실제로 8건 전부가
  "SIGUNGU 표본은 충분한데 LOCAL만 실패했던" 동일 패턴이라 자연스럽게
  전부 해소됐다 — 남은 실제 표본 부족 사례가 있었다면 REGION_WIDE까지도
  실패해 그대로 preparing으로 남았을 것이다(§18-A [E] 케이스, 테스트로
  검증됨).

**기존 3,059건 score drift**:

- 점수가 변한 단지: **30건(0.981%)**, 평균 |변화| 5.13점, 최대 -9점
  (26710-35 현대, 기장읍 청강리)
- **카테고리별 drift**: transport/living/complex/schoolAccess **0건**(0.000%)
  변경 — 완전히 무변경. **parking만 33건(1.079%) 변경.**
- 원인: parking은 sigungu+buildYear decade band를 LOCAL로 쓰는데
  (§11), 특정 연식대의 소규모 표본에서 §18-A와 **동일한 구조적 버그**가
  이미 발생하고 있었다 — 이전에는 parking이 NOT_SCORED로 빠지고
  가중치가 나머지 카테고리로 재분배돼 "parking 없음"을 숨긴 채 OK로
  표시됐다. 예: 26710-35(현대) before parking=null(coverage 0.85, 총점
  69) → after parking=11(coverage 1.0, 총점 60) — **실제로는 안 좋은
  주차 여건이 이전엔 숨겨져 있었고, 이번 수정으로 정직하게 반영**된 것이다.
  weight/formula 변경이 아니라 "이미 존재하던 낮은 parking 점수를
  이제는 빼지 않고 포함시킨" 결과다 — CLAUDE.md #10(추천 알고리즘
  설명가능성) 원칙에 부합하는 방향의 변화로 판단한다.
- **서구 regression**: 155건 중 4건 변경(전부 parking 회복형 drift,
  패턴 동일). **해운대구**: 247건 중 1건. 둘 다 애초에 이번 hotfix가
  타깃한 두 동(대청동4가/일광읍 이천리)이 아니지만, 같은 구조적 버그가
  parking 카테고리에서 더 넓게 존재했음을 보여준다 — 의도치 않은 부작용이
  아니라 승인된 설계(§4 "특정 category만 예외처리 금지")가 자연스럽게
  적용 범위를 넓힌 결과.

**§18-A [E] NOT_SCORED/0-대체 금지 확인**: 합성 테스트로 "REGION_WIDE까지
표본이 5 미만이면 그대로 NOT_SCORED, score=null"을 assert로 고정(0으로
채우지 않음, 사용자 확인 사항). 부산 실측에서는 이 케이스가 실제로
발생하지 않았다(3,067건 전부 최소 SIGUNGU 이상에서 해결됨).

**테스트/빌드**: verify-score-engine.ts 56개 assert 전부 PASS(신규 12개
포함 — resolvePeerPool/Levels 동등성, A~F/H 엣지케이스, 결정론).
`tsc --noEmit` 0 errors. `eslint .` 0 errors(기존 무관 warning 5개만).
`next build` 성공(전체 라우트 정상 생성).

## 19. Unresolved / 다음 STEP

- parking coverage(순수 데이터 결측분, hotfix와 무관)는 여전히 낮음 —
  ApartmentMaster의 parkingCount 자체가 대부분 결측이라, feature
  수집만으로는 해결 안 됨(원본 데이터 소스 확대가 필요한 별도 과제).
- `regionLabel`이 REGION_WIDE 상황에서 실제로 어떻게 보이는지는 이번
  실측에서도 검증할 사례가 없었다(부산 3,067건 전부 LOCAL 또는 SIGUNGU
  선에서 해결됨, REGION_WIDE 실사용 0건) — 순수 로직 테스트로만 보장됨.
- REGION_WIDE가 이름과 달리 실제로는 SIGUNGU와 동의어라는 점(§18-B 확인
  1)은 향후 "진짜 타 지역 비교"가 필요해지면 `cohortOtherRegions`를
  채우는 별도 STEP이 필요하다.
- 모바일 실기기 시각 회귀는 SCORE V1.1과 마찬가지로 이번에도 미실시.

## 20. 커밋/푸시

**SCORE V1.1은 §0에서 커밋·푸시 완료**(`1da0c0a`).

**BUSAN_SCORE_DATA_V1_CLOSE = YES(§18-B로 최종 정정)** — §18-A에서 발견한
peer-pool fallback 구조적 엣지케이스를 category-level retry(Option C)로
수정했다. 8건 전부 정상 score를 회복했고(3,067/3,067 OK), 기존 3,059건
중 score/formula가 실제로 바뀐 것은 parking 카테고리의 동일 버그 회복분
30건(0.981%)뿐이며 그 방향은 "숨겨져 있던 낮은 점수를 정직하게 드러냄"으로
CLAUDE.md 원칙에 부합한다. transport/living/complex/schoolAccess는
0건 변경으로 완전히 안정적이다. wrong-score prevention 전부 통과,
0으로 대체하는 경로 없음, weight/threshold/percentile 공식 전부 무변경,
지역별 하드코딩 없음을 테스트+실측 양쪽으로 확인했다.

**"이집점수 100% 제공"이라는 표현은 여전히 쓰지 않는다** — 이번 실측에서
부산 3,067건 전부가 OK가 된 것은 8건이 우연히 전부 "SIGUNGU에서는
해결 가능했던" 동일 패턴이었기 때문이지, 시스템이 모든 경우에 점수를
만들어낸다는 뜻이 아니다(REGION_WIDE까지 실패하면 여전히 정직하게
preparing으로 남는다, §18-A [E] 테스트로 보장).
