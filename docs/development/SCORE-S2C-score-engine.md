# STEP SCORE S2C — 이집점수 Score Engine + Explanation Engine + Algorithmic Briefing Engine

상태: **구현 완료, commit/push 안 함 — ChatGPT 검수 대기(§59)**

시작 HEAD: `b115202`(S2B `feat: collect apartment score raw features` 커밋 직후,
origin/main과 일치 확인).

## 1. 목적

S2B에서 수집한 raw feature(`ApartmentLocationFeature` 402건,
`ApartmentMarketFeature` 417건)를 기반으로, DB schema 변경/신규 수집/UI 변경/
score 저장 없이 **read-only 서버 계산**만으로 이집점수 V1을 설계·구현하고,
부산 서구·해운대 실데이터로 pilot을 검증했다.

## 2. 설계 근거 — 실측 분석(구현 전 승인 단계)

`scripts/apartment-score/analyze-score-pilot.ts`(read-only, DB 쓰기 없음)로
서구·해운대 raw feature 분포를 먼저 실측하고, 그 결과를 사용자에게 제시해
**명시적 승인**을 받은 뒤 구현했다(CLAUDE.md 분석→설계→승인→구현 원칙).

| 항목 | 서구 | 해운대 | 설계 반영 |
|---|---|---|---|
| 지하철 거리 coverage | 80.0% | 79.4% | null=사각지대 확인(qualityFlag=complete), §8 |
| 병원 45-cap 도달률 | 74.8% | 71.3% | 생활편의 내 sub-weight 축소(사용자 확인) |
| totalHouseholds/parkingCount coverage | 15.2~15.8% | 31.8~34.4% | 주차/단지 카테고리는 재분배가 기본 케이스 |
| dong별 표본 | 19개, 중앙값 6(최소1) | 7개, 중앙값 41 | dong-level peer는 서구에서 사실상 불가 → sigungu 기본 |
| 거래 1건 비중 | 33.8% | 17.6% | Market 최소표본(≥3) 게이팅 |
| Spearman(beachDistance, price) tx≥3 | rho=0.121(n=59, 약함) | rho=-0.485(n=170, 뚜렷) | Regional Premium은 통계 유의성이 아닌 지역 내 percentile로만 판정(인과 단정 금지) |
| Spearman(subwayDistance, price) tx≥3 | rho=-0.064(n=43, 거의 0) | rho=-0.387(n=143, 뚜렷) | 서구 SUBWAY_ACCESS는 briefing에서 인과 단정 없이 신중히 표현 |

사용자 확정 판단(2026-08-20):
- **Market category는 Core Score에서 완전히 제외**(weight 0, informational-only) — "가격=좋음" 편향 원천 차단.
- **hospitalCount1000m은 생활편의 내부 sub-weight 축소**(45-cap 도달률이 71~75%로 상위 구간 변별력 상실).

## 3. V1 카테고리 & weight (scoreVersion = `EJIP_SCORE_V1_BETA`)

| 카테고리 | weight | 상태 |
|---|---|---|
| 교통 | 30 | INCLUDED |
| 생활편의 | 25 | INCLUDED |
| 주차 | 15 | INCLUDED(coverage 낮아 재분배 빈발) |
| 단지 | 15 | INCLUDED(buildYear 100%, 나머지 낮아 재분배 빈발) |
| 학교 접근성 | 15 | INCLUDED(coverage 98.4~100%, DEFER 취소) |
| 시장/거래 | 0 | **제외(EXCLUDED)** — informational-only |

합 100(Market 제외). 근거: coverage(교통/생활/학교 80~100% vs 주차/단지
15~34%), 중복도(교통 내부 거리·개수 동시 과다가산 금지), 사용자 의사결정
가치, 지역 비교가능성(전부 sigungu peer 정규화).

### 카테고리 내부 formula (`config.ts`)

- **교통**(§7): `nearestSubwayDistanceM` 45 + `subwayCount1000m` 25 +
  `nearestBusStopDistanceM` 18 + `busStopCount300m` 12 = 100(subway:bus ≈ 70:30)
- **생활편의**(§10): mart 20 / convenience 20 / pharmacy 15 / **hospital 10(축소)**
  / park 20 / daycare 15 = 100. count류 전부 percentile 계산 전 `log1p` 변환으로
  diminishing returns.
- **주차**(§11): `parkingPerHousehold`(=parkingCount/totalHouseholds) 단일
  sub-metric weight 100. percentile(순위 기반)이라 S2B가 남긴 이상치
  (0.20~0.29, 3.19~4.84)를 별도 winsorization 없이도 흡수함(값 크기가 아니라
  순위만 쓰므로 극단값이 다른 단지 순위를 왜곡하지 않음) — 자동 삭제/clamp 안 함.
- **단지**(§12): `buildYear` 50 + `totalHouseholds` 30 + `mainBuildingCount` 20 =
  100. buildYear coverage 100%라 나머지 결측 시 buildYear가 재분배로 최대 100%
  흡수.
- **학교 접근성**(§13): `nearestElementaryDistanceM` 60 + `elementaryCount1000m`
  40 = 100. "학군" 아님, 접근성만.

## 4. Peer group & fallback (`peer-groups.ts`)

LEVEL1(LOCAL) → LEVEL2(SIGUNGU) → LEVEL3(REGION_WIDE), 첫 5건 이상 되는
레벨 채택(§15). LOCAL 정의: 교통/생활/단지/학교접근성=같은 dong,
주차=sigungu+buildYear decade band. 표본 등급: ≥10 HIGH / 5~9 MEDIUM / <5
NOT_SCORED.

**실측 확인**: 서구는 dong 표본이 너무 작아(중앙값 6, 최소 1) 사실상 항상
SIGUNGU로 폴백, 해운대는 dong 표본이 충분(중앙값 41)해 LOCAL이 자주 채택됨.
REGION_WIDE 폴백은 sigungu 표본이 139~278건이라 실제 pilot에서 한 번도
발동하지 않았다(known limitation §63 참고 — `cohortOtherRegions`는 항상 빈
배열로만 호출됨, 지연 조회 로직은 구현하지 않음).

## 5. Percentile & score-scale (`percentile.ts`)

Tie-aware 평균순위 percentile, feature별 명시적 방향(`FEATURE_DIRECTIONS`,
무조건 역순 금지). score = 5 + percentile/100 × 90(0→5, 100→95, 극단값 절벽
방지).

**§8 null 처리**: `qualityFlag='complete'`인데 값이 null이면 "확인된 부재"로
간주해(거리류 feature만) 관측 최댓값보다 나쁜 sentinel로 순위에 포함시킨다.
`qualityFlag='partial'` + null은 DB에 feature 단위 실패 기록이 없어 구분
불가라 안전하게 순위에서 제외(재분배). **실측**: 이번 pilot 데이터는
402/402, 417/417 전부 `complete` — 즉 현재 모든 null은 확인된 부재다.

**45-cap**(§9): tie-aware percentile이 동점을 자동으로 같은 순위로 처리해
별도 코드 없이 자연히 "45개 이상"으로 묶인다.

## 6. Missing-data 재분배 (`category-helper.ts`)

sub-metric이 결측(비대상/표본<5)이면 나머지 sub-metric weight로 비례
재분배, 카테고리 전체가 결측이면 카테고리 NOT_SCORED. 카테고리가
NOT_SCORED면 그 weight를 나머지 카테고리로 비례 재분배해 최종 coverage를
계산한다.

## 7. 최소 coverage & confidence (`calculate.ts`)

- **MIN_TOTAL_COVERAGE = 0.6**. 실측 근거: 주차(15)+단지(15) 둘 다 완전
  missing인 최악의 경우에도 교통(30)+생활(25)+학교(15)=70%가 남고, 실제
  pilot에서는 거의 모든 apt가 coverage=0.85(주차만 NOT_SCORED)로 계산됐다 —
  0.6 기준은 여유 있게 통과하면서 "전 카테고리 데이터 없음"인 예외적 경우만
  걸러낸다.
- coverage 미달 또는 scored category 0개 → `status='INSUFFICIENT_DATA'`,
  `score=null`(§21).
- **confidence**(§22): coverage≥0.85 & peerTier=HIGH인 카테고리 ≥3개 → HIGH,
  coverage≥0.6 → MEDIUM, 미만 → LOW(사실상 도달 안 함, score 자체가 null이므로).

## 8. Regional Premium (`regional-premium.ts`)

하드코딩 없음(§24) — 5개 타입(BEACH_ACCESS/SUBWAY_ACCESS/MEDICAL_ACCESS/
PARK_ACCESS/SCHOOL_ACCESS) 전부 모든 sigungu에서 동일 기준(같은 sigungu
peer 내 percentile)으로 판정. 상위 10% STRONG / 상위 20% NOTABLE. eligibility
게이트(§25): 표본 ≥20 & 분포 variance(IQR>0) — 둘 다 없으면 badge 자체를
만들지 않는다. 총점에는 더하지 않음.

**§27 상관관계와의 관계**: 해운대 beach-price rho=-0.485는 통계적으로
뒷받침되지만, 서구 subway-price rho=-0.064는 거의 0이다. Regional Premium
판정 자체는 상관관계가 아니라 "그 지역 안에서 상대적으로 상위인가"만 보므로
서구 단지도 SUBWAY_ACCESS를 받을 수 있다(실제 pilot에서 다수 관찰) — 다만
가격과의 인과관계를 단정하지 않도록 briefing 문구를 "접근성이 좋은 편"으로만
제한했다.

## 9. Explanation Engine (`explain.ts`)

raw metric(카테고리 점수 band)+peer 결과에서만 결정론적으로 문장 생성.
AI 호출 없음(§32). 점수 4구간(EXCELLENT≥85/GOOD≥65/AVERAGE≥45/BELOW_AVERAGE)
× 카테고리별 2 variant, `aptSeq+category` 해시로 결정론적 선택(§36 — random
없음, 같은 데이터는 항상 같은 문장).

## 10. Algorithmic Briefing Engine (`briefing.ts`)

**AI 호출 없음**(§33, §52). 강점 최대 2개(카테고리 EXCELLENT/GOOD + regional
strength 최대 1개, weight 기반 우선순위) + 확인사항 최대 1개
(BELOW_AVERAGE 중 최저점) + 종합 한 줄. 조사(이/가·은/는·과/와)는 한글 종성
유무 공식으로 동적 계산(§35). 과장 어휘(최고/완벽/반드시/명문 등) 금지 —
unit test로 검증.

**실측 QA에서 발견하고 수정한 문제**: "단지" 카테고리가 유일한 강점일 때
종결부 "~단지입니다"와 겹쳐 "단지는 중요하게 본다면 눈여겨볼 만한
단지입니다"처럼 주어가 반복되는 부자연스러운 문장이 나왔다(§54, §35 위반).
종결부를 "~곳입니다"로 바꿔 모든 카테고리 라벨과 겹치지 않게 수정, 재QA로
확인.

## 11. 기존 AI briefing 감사(§40) — 실제로는 AI 호출이 없었음

`src/app/apt/[name]/apt-client.tsx`가 쓰는 `src/lib/apt-brief.ts`
(`buildAptBrief`)를 확인한 결과, **이미 완전히 규칙 기반(non-AI)** 이었다
— `src/lib/gemini.ts`(`callGeminiJSON`)는 `src/lib/ai-search.ts`(홈 AI
검색 기능)에서만 쓰이고 apt 상세 브리핑과는 무관함을 확인. 스펙이 가정한
"AI 호출/fallback/template 구조"는 이 프로젝트의 실제 상태와 다르다 — 이번
STEP에서는 기존 `apt-brief.ts`를 제거/교체하지 않았고(§40 지시대로), 이
문서에 사실 그대로 기록한다. S3에서 교체를 계획할 때는 "AI를 규칙기반으로
바꾼다"가 아니라 "기존 규칙기반(거래 추세/세대수 위주)을 새 알고리즘
브리핑(카테고리 점수/peer 비교 위주)으로 교체"가 된다.

## 12. Score API

`GET /api/apt/[name]/score?lawdCd=...&dong=...` — 기존
`/api/apt/[name]/route.ts`, `/info/route.ts`와 동일한 identity 관례
재사용(lawdCd/dong 쿼리 파라미터 우선, 없으면 `Apartment` 캐시 테이블로만
보강 — 지오코딩 추정은 하지 않음, score identity는 오매칭 허용폭을 더
좁게 잡음). `ApartmentMaster.aptSeq`를 `sggCd`+`umdName`+`aptNamesMatch`로
찾고, 매칭 0건이면 `NOT_FOUND`, 2건 이상(동 미지정 등으로 모호)이면
`AMBIGUOUS`로 안전하게 응답한다(§41, §52 — 절대 다른 단지 score를 주지
않음).

응답 형태(§42):
```json
{
  "status": "OK",
  "score": 75,
  "scoreVersion": "EJIP_SCORE_V1_BETA",
  "coverage": 0.85,
  "confidence": "HIGH",
  "categories": [{ "key": "transport", "label": "교통", "score": 88, "explanation": "..." }],
  "regionalStrengths": [{ "type": "SUBWAY_ACCESS", "level": "STRONG", "label": "..." }],
  "market": { "status": "AVAILABLE", "transactionCount12m": 12, "medianPricePerM2_12m": 450, "activityLabel": "..." },
  "briefing": { "summary": "...", "strengths": ["..."], "caution": "..." }
}
```
weight/raw percentile/peer 규칙/정규화 공식/`percentileInSigungu`는 응답에
없음 — unit test(`verify-score-engine.ts`)로 정적 검증.
데이터 부족은 `200 + score:null + status:'INSUFFICIENT_DATA'`(§43, 404/500
아님).

## 13. 부산 서구·해운대 pilot 결과(§45~49)

`scripts/apartment-score/run-score-pilot.ts` 실행(read-only, score 미저장).

| | 서구 | 해운대 |
|---|---|---|
| 대상(aptSeq 확보) | 171 | 308 |
| OK(score 산출) | 155 | 247 |
| INSUFFICIENT_DATA | 16(S2B 비eligible과 동일) | 61 |
| score range | 21~75 | 16~78 |
| median | 53 | 50 |
| P10 / P90 | 35 / 64 | 29 / 65 |

**지역 간 비교(§46)**: 해운대 median(50)이 서구 median(53)보다 오히려 낮음
— "해운대가 무조건 서구보다 높다" 편향은 관찰되지 않았다(local percentile
설계가 의도대로 동작).

**대표 5단지**는 §47대로 각 지역 상위3/하위2를 코드에 그대로 남겼다(재현
가능, `run-score-pilot.ts` 실행 결과 참조).

## 14. Bias test(§29, §36~41)

| bias | 서구 rho(n) | 해운대 rho(n) | 판단 |
|---|---|---|---|
| 신축(buildYear vs score) | 0.332(155) | 0.496(247) | 중간 정도 양의 상관 — buildYear가 단지 카테고리를 통해 점수에 기여하는 건 설계대로지만, 무조건 지배하는 수준(1에 근접)은 아님 |
| 대단지(totalHouseholds vs score) | 0.071(27) | 0.245(84) | 약함, 대단지 편향 없음 |
| 가격(medianPricePerM2 vs score) | 0.297(124) | 0.340(223) | Market weight=0인데도 중간 정도 양의 상관 — **회로 자체가 가격을 참조하지 않으므로 이는 "점수가 가격을 반영"이 아니라 "점수가 측정하는 입지·생활 인프라가 실제 가격과도 상관된다"는 실세계 현상**(인과 방향 다름). 편향으로 보지 않음. |
| 지역(서구 vs 해운대) | median 53 vs 50 | | 편향 없음(§13) |
| missing(coverage vs score) | -0.174(155) | 0.228(247) | 방향이 지역마다 다르고 약함 — 뚜렷한 방향성 편향 없음, 모니터링 대상으로 기록 |

**Sensitivity(§49)**: 서구 top10에서 5개 카테고리를 각각 하나씩 빼고
재계산해도 top10 구성원이 **10/10 그대로 유지**됨 — 특정 카테고리가
순위를 독점하지 않음.

## 15. Briefing QA 20건(§54)

`run-score-pilot.ts` 실행 결과 서구 20건 자동 생성, 검수:
- 초기 실행에서 "단지" 카테고리가 유일 강점일 때 "단지는 ... 단지입니다"
  주어 반복 발견 → §10에서 기술한 수정 적용, 재검수 통과.
- 20건 중 summary 완전 중복 11건(서로 다른 종류 9개) — **known
  limitation**(§63)으로 기록: "단지" 카테고리가 buildYear 단일 sub-metric에
  크게 의존해 극단적 percentile이 자주 나오는 경향이 있어 강점으로 뽑히는
  빈도가 높다. 문장 자체는 자연스럽고 사실에 근거하지만, 템플릿 다양성만으로
  완전히 해소되진 않는다 — 향후 weight/redistribution 조정이 필요할 수
  있음(이번 STEP 범위 밖, 임의로 조정하지 않음).
- 과장 어휘(최고/완벽/반드시 등) 미검출.

## 16. 보안 검증(§44)

`next build` 프로덕션 빌드(`.next/static`, 클라이언트 번들) 전체를
`CATEGORY_WEIGHTS`/`*_SUBWEIGHTS`/`PEER_SAMPLE_*`/`KAKAO_COUNT_CAP`/
`MIN_TOTAL_COVERAGE`/`REGIONAL_STRENGTH_*`/`EJIP_SCORE_V1_BETA` 문자열로
grep — **0건**(애초에 이 서버 전용 모듈을 import하는 client 컴포넌트가
없음). API route는 unit test로 config 직접 import 여부와
`percentileInSigungu` 노출 여부를 정적 검증.

## 17. 검증 결과(§55)

```text
npx tsc --noEmit                                        — 0 errors
npx eslint src/lib/apartment-score
  "src/app/api/apt/[name]/score" scripts/apartment-score — clean
npx next build                                           — 성공, /api/apt/[name]/score 라우트 등록 확인
verify-score-engine.ts                                   — 25/25 pass(percentile/inverse/tie/§8 null분리/
                                                             peer fallback 3단계/redistribution/market 최소표본/
                                                             regional strength 상위·무분산·저표본/briefing 결정론·
                                                             최대개수·금지어휘/API secrecy 정적검사/오매칭 방지)
run-score-pilot.ts                                        — 서구 155건 + 해운대 247건 실제 score 산출, bias/
                                                             sensitivity/briefing QA 전부 §14~15 기록대로 확인
```

## 18. DB/UI 영향 없음 확인(§56)

- `prisma/schema.prisma` 미변경(git diff 없음).
- score를 어떤 테이블에도 저장하지 않음 — `calculate.ts`는 순수 조회+계산.
- UI/페이지/컴포넌트 변경 없음(API route 신규 추가만).
- 기존 `apt-brief.ts`/`route.ts`/`info/route.ts` 등 기존 기능 무변경.

## 19. Known limitation / 다음 STEP(S3)로 넘기는 것(§63)

- `resolvePeerPool`의 REGION_WIDE 폴백은 `cohortOtherRegions` 인자를 항상
  빈 배열로 호출한다(현재 sigungu 표본이 항상 충분해 실제로 발동한 적
  없음) — 서구/해운대 외 지역이 추가돼 sigungu 표본이 5 미만으로 얇아지는
  경우가 생기면, 그때 실제 타 지역 조회 로직을 추가해야 한다.
- "단지" 카테고리가 briefing 강점으로 과대표집되는 경향(§15) — weight/
  redistribution 재검토는 S3 이후 별도 승인 필요.
- 이번 STEP은 API 계약만 준비했고 S3 UI에는 아직 연결하지 않았다(§40, §51
  지시대로 — 기존 `apt-brief.ts` 무변경, 신규 API는 아직 어디서도 호출되지
  않음).
- `priceChange12m`/36개월 feature는 여전히 `EXTERNAL_VERIFICATION_REQUIRED`
  (S2B에서 이미 명시, 이번 STEP에서도 사용하지 않음).

## 20. S3 contract(§50~51)

상세페이지 권장 위치: Hero → 이집점수 → 실거래/시세 → 단지 브리핑 → 세부환경.
Apartment Detail V1 LOCK(2026-08-18)이 있으므로 S3는 최소 변경 원칙 —
`GET /api/apt/[name]/score`를 새로 호출하는 카드/섹션만 추가하고 기존
레이아웃은 건드리지 않는 것을 권장한다. score insufficient일 때는 기존
`apt-brief.ts` 폴백을 유지하거나 "분석에 필요한 데이터를 준비 중입니다"
문구로 대체할지는 S3에서 결정한다.
