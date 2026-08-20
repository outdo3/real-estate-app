# SCORE V1.1 — 학교 접근성 설명 보정 + 부산 16개 구·군 Coverage Audit + 준비중 원인 진단

## 1. 목적

이집점수 V1 Beta(교통30/생활25/주차15/단지규모15/학교접근성15)의 학교
접근성 설명이 실제 생활 거리와 모순되는 사례가 발견됐다. 이 STEP은
(1) 그 모순의 근본 원인을 찾아 설명 생성 로직만 보정하고(score 산출
공식은 변경하지 않는다), (2) 부산 16개 구·군 전체의 점수 coverage를
실측 감사하며, (3) "이집점수 준비 중" 상태의 원인을 운영자가 구분할
수 있는 진단 구조를 만드는 것을 목표로 한다.

## 2. 시작 상태

- HEAD = origin/main = `292ad15`(STATISTICS V2.1 FINAL 종료 커밋
  `fix: ensure accurate gap investment matching`), working tree clean.
- 이집점수 V1 Beta 기존 사실: `scoreVersion: EJIP_SCORE_V1_BETA`,
  Market은 informational-only, `MIN_TOTAL_COVERAGE=0.6`, missing data는
  가능한 범위에서 weight redistribution, Regional Premium은 total
  score에 직접 가산하지 않음, "학군 점수"가 아니라 "학교 접근성",
  Algorithmic Briefing은 deterministic(AI 미사용). 기존 pilot: 부산
  서구·해운대구.

## 3. 문제 재현(실측)

부산 서구 "구덕금호"(aptSeq `26140-11`, 동대신동3가)로 실제 버그를
재현했다:

- 실제 최근접 초등학교(동신초등학교)까지 거리 **201m**(Kakao Local
  SC4 카테고리 검색 결과, 직선거리) — KakaoPlaces가 이를 "도보 약
  3분"으로 표시(사용자가 보고한 "도보 3~4분"과 일치).
- 수정 전 이집점수 학교 접근성 설명: "초등학교 접근성이 서구 비교
  단지보다 다소 아쉬운 편이라 확인해볼 만합니다." briefing.caution도
  동일 취지의 "다만 초등학교 접근성은 서구 비교 단지보다 다소 아쉬운
  편입니다."
- 같은 조건(거리 201~299m, CLOSE band)의 서구 실제 단지 3곳(구덕금호
  26140-11, 해오름 26140-917, 봄여름가을겨울 26140-212)에서 동일하게
  재현됨 — 우연이 아니라 구조적 문제임을 확인.

## 4. 근본 원인 분석

| 후보 | 배제/채택 근거 |
|---|---|
| A. identity mismatch | route.ts의 exact-name-first 매칭, aptSeq 기반 조회 확인 — 문제 없음. 배제. |
| B. distance-source mismatch | `collectors/location.ts`가 Kakao SC4 카테고리 검색 최근접 결과의 `.distance`를 그대로 저장 — 정상. 배제. |
| C. 초/중/고 혼입 | `filterElementary()`로 명시적으로 초등학교만 필터링 — 혼입 없음. 배제. |
| **D. percentile interpretation 문제** | **채택.** `explain.ts`/`briefing.ts`가 `bandOf(상대 percentile 점수)`만으로 문장을 생성하고, 원본 절대 거리(`nearestElementaryDistanceM`)를 전혀 참조하지 않았다. 서구는 학교 밀집도가 높아 201m도 지역 내 순위로는 낮게 나올 수 있는데, 이 사실이 텍스트에 전혀 반영되지 않았다. |
| E. peer-group 문제 | peer pool 크기(HIGH tier, 150+)와 계산 자체는 정상 — 배제(단, §14 참고: regionLabel이 실제 peerLevel과 무관하게 항상 sigungu인 점은 별도 발견). |
| F. briefing sentence-selection 문제 | 문장 "선택" 로직(어떤 카테고리를 caution/strength로 뽑을지)은 정상 동작 — 골라진 카테고리의 "문장 생성" 쪽이 문제였다(D와 사실상 같은 근본 원인). |
| G. 기타 | 해당 없음. |

**결론: score 산출 공식(percentile.ts, category-helper.ts)은 정상이며
변경하지 않는다. explain.ts/briefing.ts의 텍스트 생성 로직만 보정한다.**

## 5. 절대(실제 거리) vs 상대(지역 내 순위) 분리 설계

- **절대**: `nearestElementaryDistanceM` 원본값에서만 결정되는 생활
  체감 거리. 다른 단지와 무관.
- **상대**: 기존 percentile 기반 `bandOf` 점수(0~100 → EXCELLENT/
  GOOD/AVERAGE/BELOW_AVERAGE). 변경 없음, 그대로 재사용.
- 원칙: 문장은 항상 절대를 먼저 말하고, 상대는 모순되지 않는 보조
  caveat로만 붙인다.

## 6. 절대 거리 band 도출(실측 근거)

부산 실제 `nearestElementaryDistanceM` 분포(location feature 402건 중
non-null 398건, `busan-coverage-audit.ts` 실측, 2026-08-20):

```
min=45, p10=138, p25=214, median=329, p75=472, p90=647, max=933
```

이 값에 앵커링해 `school-distance-band.ts`에 threshold를 정했다(임의
하드코딩 아님):

| Band | 조건 | 앵커 |
|---|---|---|
| VERY_CLOSE | ≤200m | p10(138)~p25(214) 사이 |
| CLOSE | ≤400m | median(329) 근방 |
| NORMAL | ≤650m | p90(647) 근방 |
| FAR | ≤933m | 실측 최댓값(933)까지 |
| VERY_FAR | >933m | 이론적 잔여 구간(수집 반경이 1000m라 실측 표본엔 없음) |
| UNKNOWN | null | 반경 1000m 내 초등학교 미확인(수집 자체가 1000m 반경 검색이라 "없다"를 단정하지 않고 "확인되지 않음"으로만 표현) |

## 7. 상대 band

기존 `explain.ts::bandOf` 그대로 재사용(EXCELLENT≥85/GOOD≥65/
AVERAGE≥45/BELOW_AVERAGE<45) — 변경 없음.

## 8. 모순 방지 규칙(§11)

`school-access-sentence.ts`가 절대 band를 리드 문장으로, 상대 band를
꼬리 caveat로 조합한다. 핵심 규칙:

- 절대=VERY_CLOSE/CLOSE + 상대=BELOW_AVERAGE → **"가까운 편입니다.
  다만 {지역} 내에서는 더 가까운 단지도 있습니다."** (단독 "아쉽다"
  문장 금지, §34 시나리오 A)
- 절대=FAR/VERY_FAR + 상대=EXCELLENT/GOOD → **"거리가 있는 편이라
  확인해볼 필요가 있습니다. 다만 {지역} 내 비교로는 상대적으로 나은
  편입니다."** (상대만으로 "매우 좋다" 과장 금지, §34 시나리오 B)
- 절대=CLOSE + 상대=EXCELLENT/GOOD → 강한 긍정 문장 허용(모순 없음,
  §34 시나리오 C)
- 절대=FAR + 상대=BELOW_AVERAGE → caution 포함 허용(절대도 이미 멀다는
  사실과 일치, §34 시나리오 D)
- 절대=UNKNOWN → 품질/거리 추정 없이 "정보가 확인되지 않았습니다"만
  말하고, briefing caution 후보에서도 제외(§34 시나리오 E)
- 초/중/고 혼입 없음(수집 자체가 elementary 전용, §34 시나리오 F)

## 9. formula 변경 여부

**변경하지 않음.** percentile.ts/category-helper.ts/school-access.ts는
무수정. CATEGORY_WEIGHTS, MIN_TOTAL_COVERAGE 등 config.ts 상수도
무수정. explain.ts/briefing.ts/calculate.ts만 수정(텍스트 생성 경로).

## 10. 구현 내용(파일별)

신규:
- `src/lib/apartment-score/server/school-distance-band.ts` — 절대
  거리 band 판정 함수 + threshold 상수.
- `src/lib/apartment-score/server/school-access-sentence.ts` — 절대+
  상대 조합 문장 생성(explain용 `buildSchoolAccessSentence`, briefing
  caution용 `buildSchoolAccessCaution`).
- `src/lib/apartment-score/server/preparing-reason.ts` — §13 참고,
  준비중 원인 분류.
- `scripts/apartment-score/busan-coverage-audit.ts` — 부산 16개
  구·군 coverage 실측 감사 스크립트(읽기 전용, production 로직 재사용).

수정:
- `src/lib/apartment-score/server/types.ts` — `AbsoluteDistanceBand`,
  `Band`(explain.ts에서 이동), `PreparingReasonCode` 타입 추가,
  `FinalScoreResult.preparingReason` 필드 추가.
- `src/lib/apartment-score/server/explain.ts` — schoolAccess 카테고리만
  절대+상대 조합 문장으로 분기, 나머지 4개 카테고리는 무변경.
- `src/lib/apartment-score/server/briefing.ts` — schoolAccess가
  strength/caution 후보로 뽑혔을 때 절대 band를 고려하도록 수정,
  UNKNOWN이면 caution 후보에서 제외.
- `src/lib/apartment-score/server/calculate.ts` — 대상 단지의 원본
  `nearestElementaryDistanceM`을 읽어 explain/briefing에 전달,
  `preparingReason` 계산 추가.
- `src/components/KakaoPlaces.tsx` — 초품아 배지 "교육 환경이 매우
  우수합니다" → "도보 통학이 가능한 거리입니다"(§35 금지 어휘 회피).
- `scripts/apartment-score/verify-score-engine.ts` — SCORE V1.1 회귀
  테스트 12개 추가.

## 11. "학군" vs "학교 접근성" 용어 감사(§14)

Score 카드/briefing/explain 문구는 전부 "학교 접근성"만 쓴다(확인됨,
변경 불필요). Apartment Detail의 "🏫 학군" 탭 라벨은 이 STEP 범위
밖(§14 지시대로 SCHOOL V2로 이관) — 탭 안의 실제 내용(KakaoPlaces
학교 목록)은 "학군(학업성취도)"이 아니라 순수 거리 목록이라 당장
사용자를 오도하진 않지만, 탭 이름 자체의 재검토는 SCHOOL V2 항목으로
남긴다.

## 12. 부산 16개 구·군 인벤토리 + coverage(실측, 2026-08-20)

`ApartmentMaster`(부산, aptSeq not null) = **3,402건**, `sigungu` null
0건. `ApartmentLocationFeature` 402건, `ApartmentMarketFeature` 417건.

| 구·군 | 단지수 | location feature | market feature |
|---|---:|---:|---:|
| 강서구 | 44 | 0 (0.0%) | 0 (0.0%) |
| 금정구 | 308 | 0 (0.0%) | 0 (0.0%) |
| 기장군 | 152 | 0 (0.0%) | 0 (0.0%) |
| 남구 | 253 | 0 (0.0%) | 0 (0.0%) |
| 동구 | 99 | 0 (0.0%) | 0 (0.0%) |
| 동래구 | 314 | 0 (0.0%) | 0 (0.0%) |
| 부산진구 | 404 | 0 (0.0%) | 0 (0.0%) |
| 북구 | 173 | 0 (0.0%) | 0 (0.0%) |
| 사상구 | 151 | 0 (0.0%) | 0 (0.0%) |
| 사하구 | 338 | 0 (0.0%) | 0 (0.0%) |
| **서구** | 171 | **155 (90.6%)** | **139 (81.3%)** |
| 수영구 | 251 | 0 (0.0%) | 0 (0.0%) |
| 연제구 | 244 | 0 (0.0%) | 0 (0.0%) |
| 영도구 | 133 | 0 (0.0%) | 0 (0.0%) |
| 중구 | 59 | 0 (0.0%) | 0 (0.0%) |
| **해운대구** | 308 | **247 (80.2%)** | **278 (90.3%)** |

**핵심 발견: 16개 구·군 중 서구·해운대구 2곳만 location/market
feature가 존재한다. 나머지 14곳은 문자 그대로 0%다.** 이는 score
엔진의 결함이 아니라 feature 수집 자체가 애초에 이 2개 pilot 구에만
실행됐기 때문(구조적으로 예상된 상태).

## 13. 카테고리별 coverage(pilot 2개구, location feature 보유 402건 전수)

`calculateApartmentScore()`(수정 없는 production 함수) 실제 실행 결과:

- **402/402건(100%) OK**, INSUFFICIENT_DATA 0건.
- score 분포: n=402, min=16, p25=42, median=52, p75=59, max=78. ≤10점
  0건, ≥90점 0건 — 극단값 클러스터링 없음.
- coverage 분포: min=0.85, median=0.85, max=1.00.
- 카테고리별 미채점(NOT_SCORED) 비율: transport 0%, living 0%,
  **parking 75.4%(303/402)**, complex 0%, schoolAccess 0%. parking만
  실제로 큰 결측 — 기존에 알려진 데이터 한계(§17 "missing≠0점" 원칙대로
  집계, weight redistribution으로 처리됨).

## 14. 준비중 원인 taxonomy(§18) + public/admin 분리(§19)

`preparing-reason.ts`(내부·운영자 전용 — `FinalScoreResult.
preparingReason` 필드, 공개 API route는 절대 응답에 포함하지 않음.
기존 route.ts가 필드를 하나씩 whitelist로 골라 응답을 만드는 방식임을
재확인해 안전하게 필드를 추가할 수 있었다):

| 코드 | 의미 | 실측 근거 |
|---|---|---|
| `FEATURE_CACHE_MISSING` | transport+living+schoolAccess 전부 미채점(위치 feature 자체 없음) | 14/16 구·군의 실제 지배적 원인 |
| `MISSING_TRANSPORT`/`MISSING_LIVING`/`MISSING_PARKING`/`MISSING_COMPLEX`/`MISSING_SCHOOL` | 해당 카테고리 1개만 단독 미채점 | parking 단독 결측이 pilot 내 75.4% 사례에 해당 |
| `INSUFFICIENT_TOTAL_COVERAGE` | 여러 카테고리가 부분적으로 미채점 | pilot 표본엔 사례 없음(향후 발생 가능) |
| `OTHER` | 방어적 폴백 | — |

사용자 노출 문구(§19, 원인과 무관하게 항상 동일):
> **이집점수 준비 중** — 일부 단지 정보가 아직 충분하지 않습니다.

내부 원인/coverage%/missing 카테고리는 운영자 전용 채널(스크립트 출력,
이 문서)에만 노출한다.

## 15. MIN_TOTAL_COVERAGE=0.6 감사(§22)

- pilot 2개구(402건)에서 coverage는 항상 0.85 이상 — threshold를
  실제로 건드린 적이 없다(변경 근거 없음).
- **비-pilot 14개 구 실측 샘플**(부산진구/동래구/중구/기장군 각 3건,
  location feature 없음): coverage가 **0.15~0.30**에 그침(parking+
  complex만 ApartmentMaster 원본에서 채점 가능, transport/living/
  schoolAccess는 위치 feature 자체가 없어 전부 미채점) — 전부
  0.6 미만이라 정확히 `INSUFFICIENT_DATA`로 처리됨을 확인.
- **결론: threshold는 의도대로 정확히 동작 중이며 변경하지 않는다.**

## 16. missing-weight-redistribution 감사(§23)

parking(75.4% 결측)만 빠진 케이스가 pilot 내 지배적 패턴인데, 이때
coverage는 정확히 0.85(=100-15)이고 score 분포에 이상 클러스터링이
없다(§13 참고) — "다른 카테고리가 좋아서 결측 카테고리 덕에 부당하게
고점"이 되는 패턴은 이번 실측에서 발견되지 않았다.

## 17. peer-level fallback 감사(§25)

pilot 402건 기준(non-parking 카테고리): **LOCAL 94.3%, SIGUNGU 5.7%,
REGION_WIDE 0%.** 구별: 서구는 LOCAL 85.2%/SIGUNGU 14.8%, 해운대구는
LOCAL 100%. REGION_WIDE 폴백은 실제로 한 번도 발생하지 않았다. 주차
(buildYear decade band 기준)는 100% LOCAL.

**발견(미수정)**: `regionLabel`이 실제 peerLevel과 무관하게 항상
sigungu 이름을 쓴다 — LOCAL(동 단위) 비교인데도 "서구 비교 단지"라고
표현되는 경우가 94.3%에 달한다. 방향성은 오히려 "실제보다 넓은 비교인
것처럼" 보이는 쪽(동 단위 비교를 구 단위처럼 표현)이라 심각한 오도는
아니라고 판단했지만, 정확도 이슈이긴 하다. 5개 카테고리 전체 텍스트에
영향을 주는 구조 변경이라 schoolAccess 단독 calibration인 이번 STEP
범위를 넘어선다고 판단해 **의도적으로 보류**했다(SCHOOL V2/차기 STEP
후보로 기록).

## 18. Regional Premium 감사(§26)

pilot 402건 중 65.7%(264건)가 regional strength 1개 이상, 34.3%는
0개. 타입별 발동률(전체 대비): PARK_ACCESS 14.9%(NOTABLE)+8.0%
(STRONG), SUBWAY_ACCESS 10.4%+9.7%, BEACH_ACCESS 10.2%+10.0%,
SCHOOL_ACCESS 10.0%+10.0%. 특정 타입 과다 발동 없이 고르게 분포 —
이상 없음. total score에 직접 가산되지 않는 원칙도 코드상 재확인됨
(변경 없음).

## 19. 학교 이상치 감사(§27)

location feature 402건 기준: 0m 거리 0건, <20m 0건, >3000m 0건,
"null인데 qualityFlag=complete"(반경 1000m 내 초등학교 확인 안 됨)
4건 — 이 4건은 UNKNOWN band로 정상 처리됨(품질 추정 없음). 심각한
이상치 없음.

## 20. BUSAN SCORE READINESS(§38~40)

| 구·군 | 단지수 | score 가능 | 상태 |
|---|---:|---:|---|
| 서구 | 171 | 155(90.6%) | **READY** |
| 해운대구 | 308 | 247(80.2%) | **READY** |
| 나머지 14개 구·군 | 3,209 | 0(0.0%) | **LIMITED**(사실상 BLOCKED — 위치 feature 수집 자체가 안 됨, score 엔진 결함 아님) |

**부산 전체 지원 완료라고 말할 수 없다**(§40). 14개 구·군의 score
subsystem 확대는 feature 수집(collectors/*.ts 실행 범위 확대) 없이는
불가능 — 이는 이번 STEP 범위(DB/외부 API 신규 연결 금지) 밖이라 이번
STEP에서 처리하지 않았다.

## 21. SCHOOL V2 handoff(§37)

- `regionLabel`이 실제 peerLevel(LOCAL/SIGUNGU/REGION_WIDE)을 반영하지
  않는 문제(§17 참고) — 5개 카테고리 전체에 영향, 구조 변경 필요.
- `/api/school/apartments/route.ts`의 도보시간 계산에 문서화되지 않은
  `schoolName.includes('송도') → +5분` 하드코딩 발견 — 별개 기능(학교
  상세페이지)이라 이번 STEP에서 미수정, 제거 또는 근거 문서화 필요.
- 직선거리 기반 도보시간 추정("도보 약 N분")은 실제 routing이 아닌
  단순 속도 환산(§36) — 정확도 개선(실제 도보 경로 API 연동)은 이번
  STEP에서 금지된 "새로운 외부 유료 API 연결"에 해당해 SCHOOL V2로
  이관.
- "🏫 학군" 탭 이름 자체의 재검토(§14).

## 22. 테스트 결과

`verify-score-engine.ts` 기존 26개 + SCORE V1.1 신규 12개(절대 band
경계값 1개, §34 시나리오 A~D+F 5개, UNKNOWN 처리 1개, briefing caution
구조 1개, §35 금지어휘 1개, preparing-reason taxonomy 3개) = **38개
전부 PASS**.

## 23. 회귀 QA

- `npx tsc --noEmit` 0 errors, `npx eslint`(대상 파일) 0 errors,
  `npx next build` 성공(동일 라우트 구성, DB/schema 무변경 재확인).
- 실 DB 데이터 8건(서구 6건: 26140-11/-917/-212/-1361/-154/-1290,
  해운대구 2건: 26350-2374/-2335)으로 수정 전/후 문장을 직접 비교해
  §34 시나리오 A~E를 전부 실측 확인.
- 브라우저(Chrome, localhost:3000)로 구덕금호(aptSeq 26140-11) 실제
  Apartment Detail 페이지 렌더링 확인: 이집점수 카드의 "왜 이런
  점수인가요" 펼침, 단지 브리핑 박스, 학군 탭 학교 목록 세 곳
  모두에서 "가까운 편입니다. 다만 서구 내에서는 더 가까운 단지도
  있습니다" 문구가 "동신초등학교 201m 도보 약 3분"과 모순 없이
  일관되게 표시됨을 확인. KakaoPlaces 초품아 배지도 새 문구로 표시됨.
  모바일 폭(375/390/430px) 시각 확인은 이번 회차에 수행하지 않음(데스크톱
  경로로 핵심 회귀는 검증됨, 다음 STEP에서 보완 권장).

## 24. 알려진 문제 / 다음 STEP

- §21에 기록한 `regionLabel`/peerLevel 정확도 이슈 — SCORE 후속 STEP.
- `송도` 하드코딩 — SCHOOL V2.
- 14개 구·군의 feature 미수집 — score subsystem 확대를 위해서는
  collectors 실행 범위를 넓히는 별도 STEP 필요(이번 STEP 범위 밖).
- 모바일 실기기/좁은 화면 시각 회귀 미실시.

## 25. 커밋/푸시

**commit·push 하지 않음** — 사용자 지시대로 ChatGPT 검수 후 처리.

**SCORE_V1_1_CLOSE** — BLOCKER 없음.
