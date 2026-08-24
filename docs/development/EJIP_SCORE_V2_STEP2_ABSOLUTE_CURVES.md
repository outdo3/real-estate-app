# E-JIP SCORE V2 STEP 2 — Absolute Scoring Curves & Numerical Model Design

## 목적

STEP 0~1.5가 확정한 것: V1 계산 자체는 대체로 정상이지만 LOCAL(법정동)
percentile 기반 상대평가가 구조적 결함이었다. STEP 2는 그 대안으로
"raw fact → absolute quality score"를 처음으로 수치 설계한다 — **부산 3,402건
실측 분포**를 근거로, 4개 Core domain(Transport/Living/Education/Complex)의
factor curve와 domain composition 후보를 만들고 검증한다.

**이 작업은 대신해모로센트럴을 높이기 위한 것이 아니다.** 모든 curve는
벤치마크 2개(대신해모/협성)를 보기 전에 부산 전체 분포에서 anchor를 정했고,
이후 벤치마크에 적용해 결과를 "확인"만 했다(§40-42, §G 순서 그대로 준수) —
결과가 맞춰진 게 아니라 맞아떨어진 것임을 코드/스크립트 실행 순서로 보증한다.

**production Score/DB/API/UI 전부 미변경. domain/factor 최종 weight도 아직
확정하지 않는다(§52) — 이번 STEP은 candidate까지만.**

## 현재 상태

- base: `score-v2-data-foundation`(commit `a7e267f`)
- 신규 branch: `score-v2-step2-absolute-curves`(worktree `.worktrees/score-v2-step2-absolute-curves`)
- main: 미변경

## 방법론 — 작업 순서(§3 A~H 그대로)

1. **A. DATA DISTRIBUTION** — `step2-01-data-distributions.ts`, 부산 3,402건 전수
2. **B. RAW FACT SEMANTICS** — 코드 확인(station-center, straight-line 등 한계 명시)
3. **C. MONOTONICITY** — curve 설계 원칙으로 선반영, 이후 테스트로 재검증
4. **D. CURVE CANDIDATES** — `curves.ts`(순수 함수) + `step2-02-curve-report.ts`
5. **E. SENSITIVITY** — `curves.test.ts`(boundary jump, near-distance saturation)
6. **F. DOMAIN COMPOSITION** — `composition.ts` + `step2-03-model-distributions-and-correlation.ts`
7. **G. BENCHMARK VALIDATION** — `step2-04-benchmark-and-counterexamples.ts`
8. **H. EXPERT CREDIBILITY AUDIT** — 본 문서 하단

## A. Data Distribution(§4-5,8,12,14,16,19,22,26,29-30) — 부산 3,402건 실측

전부 `scripts/score-v2-step2/step2-01-data-distributions.ts` 실행 결과
(`data/score-v2-step2/factor-distributions.json`).

| factor | eligible/coverage | 분포 요약 |
|---|---|---|
| subway distance | coordOk 2,833(전체 83.3%), 실값 2,291(confirmed-absent 489, 기타미수집 53) | min19 p10=164 median=397 p90=758 p99=971 max=999(수집반경 캡) |
| subway count(1000m) | 2,831 | median 2, p90 4 |
| bus distance | 2,555 | min1 p10=34 median=87 p90=187 max=467 |
| bus count(300m) | 2,555 | median 12, p90 22 |
| age(buildYear 기준) | **3,402/3,402(100%)** | min0 p25=12 median=23 p75=33 p99=51 max=64 |
| households | 2,544/3,402(74.8%) | min5 p25=46 median=118 p75=352 p90=793 max=7374 |
| parking ratio | **862/3,402(25.3%)** — STEP0.8/STEP1.5와 동일, 변화 없음 재확인 | min0.02 p10=0.66 median=1.106 p90=1.6 max=5.56 |
| FAR/BCR | **ApartmentMaster 0%**(컬럼 자체 없음), legacy `Apartment` 34건 중 32건 | STEP1과 동일 결론, 이번 STEP Core 제외 재확정 |
| elementary distance(Kakao POI) | 2,815 | min40 p10=151 median=341 p75=461 p90=592 max=990 |
| **School(고교/중/초) 좌표** | **0건(0%)** | "공식 통학구역 학교까지 거리"는 계산 불가 확정(§B) |
| kindergarten(DB 실좌표) | 367/367(100%) | within 500m 79.3%, within 1000m 98.9% — 변별력이 낮은 구간 존재(§D 참고) |
| mart(1000m) | 2,832 | median 2, **p90=4**(캡 45 대비 거의 안 참) |
| convenience(500m) | 2,832 | median 11, p90 26 |
| pharmacy(500m) | 2,833 | median 7, p90 17 |
| **hospital(1000m)** | 2,833 | **median=45(캡 자체), p75=p90=p95=p99=45 — 상위 절반이 이미 캡에 도달** |
| **park(1000m)** | 2,833 | **p75=14,p90=15,p95=15,p99=15(캡 15) — 대부분 캡 근접** |
| daycare/kindergarten(500m, Kakao) | 2,833 | median 4, p90 8 |

## B. Raw Fact Semantics — 코드로 확인한 한계

1. **Subway station-center**(§7): `nearestSubwayDistanceM`은 Kakao SW8 "역 대표점"
   좌표 기준(STEP0.5 감사 재확인) — 실제 출입구 거리와 다를 수 있다. curve 설계
   시 근거리(80~150m) 구간을 의도적으로 평탄하게 만들어(§D) 이 한계를 과대
   해석하지 않도록 했다.
2. **공식 통학구역 거리 계산 불가**(§22): `School.latitude/longitude` coverage가
   **0건**임을 이번 STEP에서 실측 재확인했다(STEP1.5도 동일 결론). 따라서
   Education curve의 유일한 거리 입력은 **Kakao POI 기준
   `nearestElementaryDistanceM`뿐**이다 — 공식 통학구역(배정 학교) 자체는
   categorical(배정 여부/SHARED/REVIEW_REQUIRED)로만 다룬다(§24).
3. **Living count 캡의 서로 다른 의미**(§31): 코드 확인
   (`src/lib/apartment-score/collectors/location.ts:119-120`) 결과
   `hospitalCount1000m`=Kakao `pageableCount`(최대 45, "45개 **이상**"),
   `parkCount1000m`=단일 페이지 `length`(최대 15, "15개 **이상**") — 두 캡의
   의미가 다르다. 실측 분포(위 표)를 보면 **병원은 이미 median부터 캡에
   도달**해 있어, "count가 많을수록 좋다"는 가정 자체가 상위 절반에서는
   변별력을 잃는다 — 이는 curve 설계로 해결할 수 없는 **수집 단계의
   구조적 한계**이며, halfLife를 크게 잡아 완만하게 처리하는 정도가 최선이다
   (STEP3에서 병원 수집 방식 자체(다중 페이지 fetch)를 재검토할 가치 있음).
4. **Bus route 정보 미영속화**(STEP1.5 §11-a 재확인): 노선번호/유형은 TAGO
   라이브 조회만 있고 저장되지 않아 전체 universe curve에는 편입 불가.
5. **Kindergarten은 실좌표 기반 정밀 거리 계산 가능**(유일하게 100% 좌표
   보유) — 그러나 within-500m가 79.3%로 이미 높아 "누구나 웬만하면 가깝다"는
   특성상 변별력이 원래 제한적이다(부산 도심 밀도 특성, 결함 아님).

## C-D. Monotonicity + Curve Candidates(§6-9,13,15,17,23) — `curves.ts`

전체 anchor 표는 `data/score-v2-step2/curve-candidates.json`에 보존. 핵심만:

### Subway(4개 후보, §6)

| distance | A_PIECEWISE | B_LOGISTIC | C_EXP_DECAY | D_MANUAL_SAT |
|---|---|---|---|---|
| 100m | 90.0 | 88.2 | 74.2 | 80.2 |
| 200m | 80.7 | 82.1 | 58.2 | 68.5 |
| 300m | 68.0 | 72.0 | 45.9 | 59.9 |
| 500m | 48.0 | 42.0 | 29.1 | 48.0 |
| 800m | 28.0 | 11.8 | 16.0 | 37.4 |
| 1000m | 20.0 | 6.7 | 11.5 | 32.9 |
| 1500m | 10.0 | 5.0 | 6.7 | 25.6 |
| 2000m | 5.0 | 5.0 | 5.5 | 21.3 |

- **근거리 saturation(§7, 80m vs 120m diff≤10pt)**: 전 후보 PASS(A:1.6 B:1.8
  C:7.3 D:5.4) — C(지수감쇠)가 구조적으로 가장 약함(d=0에서 기울기 최대라는
  형태적 특성, 아래 비교 참고).
- **dominance(140m>306m>800m>1500m)**: 전 후보 PASS.
- **비교**: B(로지스틱)는 수학적으로 양끝이 자동으로 평평해지는 구조라 §7을
  formula 자체로 만족하지만 800m 이후 너무 빨리 floor에 붙는다(1000m=6.7).
  C(지수감쇠)는 d=0 근처 기울기가 가장 가파른 구조적 약점이 있어 §7 철학과
  형태적으로 상충한다(다른 후보보다 근거리 diff가 4배 이상 큼). D(rational
  saturation)는 원거리에서 floor(5)에 너무 늦게 수렴한다(2000m=21.3). **A(구간
  선형)가 가장 투명하고(§50) 근거리/원거리 모두 무리 없이 saturating** —
  추천(아래 §H).

### Bus(§8-9)

`nearestBusStopDistanceM`(logistic, midpoint110/scale45) + `busStopCount300m`
(saturating, halfLife6) 50:50 결합. diminishing-returns 확인:
**2→5개 delta=25.4pt, 20→25개 delta=1.8pt** — §9 요구 그대로 재현.

### Age(3개 후보, §13)

| age | A_PIECEWISE | B_SLOW_DECAY | C_LIFECYCLE |
|---|---|---|---|
| 0y | 95.0 | 95.0 | 92.0 |
| 5y | 88.0 | 73.9 | 88.0 |
| 10y | 76.0 | 57.9 | 73.7 |
| 20y | 55.0 | 36.6 | 45.0 |
| 30y | 37.0 | 24.4 | 30.0 |
| 35y | 28.0 | 20.4 | 22.5 |
| 64y | 8.0 | 10.5 | 8.0 |

전 후보 5y>20y>35y PASS, 0~64y 전 구간 단조 비증가 PASS(테스트 확인).
재건축 기대는 어떤 후보에도 반영하지 않았다 — 오직 "현재 상품성"만(§13
원칙).

### Scale/households(3개 후보, §15)

100→500 구간과 1000→1500 구간의 증가폭 비교(saturating 여부):

| candidate | 100→500 gap | 1000→1500 gap |
|---|---|---|
| A_LOG_NORMALIZED | +17.9 | +4.5 |
| B_LOGISTIC | +34.0 | +2.9 |
| C_PIECEWISE | +33.0 | +3.0 |

3개 후보 모두 saturating 확인. 699/700 경계에서 jump 없음(§38, diff<1 전
후보 PASS).

### Parking(3개 후보, §17) — **V1 재발 방지 핵심 검증**

| ratio | A(mid1.0,scale.22) | B(wide,scale.35) | C(piecewise) |
|---|---|---|---|
| 0.5 | 13.4 | 25.5 | 15.0 |
| 0.9 | 39.9 | 44.3 | 42.0 |
| 1.0 | 50.0 | 50.0 | 50.0 |
| **1.09** | **59.1** | **55.1** | **57.2** |
| 1.2 | 69.2 | 61.1 | 68.0 |
| 1.4 | 82.4 | 70.7 | 80.0 |
| **1.58** | **89.0** | **77.2** | **87.2** |
| 2.0 | 94.1 | 85.7 | 93.0 |

**1.09→1.58 격차**: A=29.9pt, B=22.1pt, C=30.0pt — **V1의 77pt(18→95) 대비
2.5~3.5배 완화**됐다. 순서(1.58>1.09)는 3개 후보 전부 유지하되, 격차의
"의미"가 실제 체감(둘 다 "괜찮은 주차"이지 "매우 나쁨 vs 거의 만점" 수준
차이가 아님)에 훨씬 가까워졌다. **이 결과는 대신해모/협성을 맞추기 위해
만든 게 아니라 실측 median(1.106)을 변곡점으로 잡았더니 나온 결과다** —
공교롭게도 median이 대신해모의 실제 비율(1.09)과 거의 같아서 대신해모가
"딱 중간(50점 근방)"으로 나오는 것은 우연이 아니라 **대신해모의 주차가
정말로 부산 중앙값 수준**이라는 사실 그 자체다.

### Elementary(§23)

341m(협성 실제값)=60.9, 545m(대신해모 실제값)=37.0 — **협성 > 대신해모,
raw fact(341m<545m)와 정확히 일치**. 이것이 STEP0.8이 지적한 V1 역전
사례(V1에서는 대신해모 22.0 > 협성 11.4로 반대였음)를 curve 레벨에서
바로잡은 첫 실증이다.

## E. Sensitivity(§37-38) — `curves.test.ts`(18/18 PASS)

- 모든 curve가 **연속함수**(구간선형/로지스틱/포화형)라 경계 jump가 구조적으로
  존재하지 않는다 — 299/300m, 499/500m, 0.99/1.00, 9/10y, 499/500세대
  경계에서 전부 실측 확인(테스트: households 699/700 diff<1).
- **결측은 절대 0점으로 치환하지 않는다** — `subwayDistanceScore(null)`,
  `parkingScore(null)`, `livingCountScore(null)` 전부 `null` 반환(fake-zero
  금지 테스트 3건 PASS).
- **low-confidence가 high-confidence로 위장 불가**:
  `attendanceZoneConfidenceAdjustment('REVIEW_REQUIRED')<0`,
  `NOT_AVAILABLE`이 `REVIEW_REQUIRED`보다 더 나쁨을 테스트로 보증.

## F. Domain Composition(§10,28,32,34-35) + Correlation(§36) — `composition.ts`

### 후보 정의

| Domain | 후보 A | 후보 B | 후보 C |
|---|---|---|---|
| Transport | T1: Subway70/Bus30(V1 철학 계승) | T2: 55/45 균형 | T3: Best-mode(주모드80%+보조20%) |
| Complex | C1: Age50/Scale25/Parking25 | C2: 34/33/33 균형 | C3: Age45/Scale40/**Parking15**(낮은 coverage 반영) |
| Education | E-A: Elementary80/Kindergarten20 | E-B: 60/40 | E-C: Elementary100(최소모델) |
| Living | L1: Daily+Medical 중심 | L2: 6개 균형(daycare 5%) | L3: essential75%+park25%(daycare 완전 제외) |

**Bounded redistribution**(§18-B, `composeBoundedRedistribution`) 적용 — 결측
factor의 weight를 present factor가 흡수하되 흡수량 상한(기본 40%)을 둬서
V1처럼 소수 factor가 도메인 전체를 대표하지 않게 했다. score 자체는 present
factor 가중평균, coverage만 별도 추적(§53 confidence 설계와 연동 예정).

### Correlation / duplication audit(부산 전체, §36)

| 쌍 | r | 해석 |
|---|---|---|
| age vs parking ratio | -0.369 | 중간 음의 상관 — **연식이 오래될수록 세대당 주차가 적은 것은 실제 건축 규범 변화**(1990년대 이전 저밀도 주차 설계), 중복가중이 아니라 실제 confound. §14 "시대별 context" 필요성을 데이터로 재확인 |
| age vs households | -0.115 | 약함, 문제 없음 |
| households vs parking | 0.152 | 약함, 문제 없음 |
| subway distance vs living POI합계 | -0.349 | 중간 — 역세권=상업밀집이라는 도시구조적 특성(당연한 결과, 결함 아님) |
| **mart vs convenience(living 내부)** | **0.750** | **높음** — 둘 다 "일상 상업시설 밀도"를 재는 셈이라 L2/L1처럼 둘 다 비중 있게 넣으면 사실상 같은 신호를 두 번 세는 중복가중 위험. L3가 essential 묶음 안에서 이미 완만하게 처리했지만, STEP3에서 이 둘을 하나의 "일상편의" 축으로 합치는 것을 검토 권고 |
| education(elementary) vs living POI합계 | 0.104 | 약함, 독립적 |
| kindergarten distance-score vs elementary distance-score | 0.300 | 중간 — 둘 다 "도보권 교육시설"이라 어느 정도 상관은 자연스러우나, Education 내부에서 elementary를 80%(E-A) 비중으로 둔 것이 이 중복을 완화하는 근거가 된다 |

### 부산 전체 domain 분포(3개 MODEL, §44-45)

| MODEL | domain | mean | median | p10 | p90 | 90-100 비율 |
|---|---|---|---|---|---|---|
| V2-A | transport | 61.3 | 62.0 | 39.9 | 82.4 | 0.4% |
| V2-A | complex | 49.7 | 49.6 | 24.8 | 76.0 | 0.7% |
| V2-A | education | 58.1 | 60.3 | 35.4 | 77.2 | 0% |
| V2-A | living | 57.1 | 59.9 | 32.7 | 76.5 | 0% |
| V2-B | transport | 60.5 | 63.1 | 36.2 | 81.9 | 0.1% |
| V2-B | complex | 41.5 | 37.1 | 23.6 | 65.6 | 0.1% |
| V2-C | transport | 65.8 | 68.4 | 46.3 | 80.4 | 0.1% |
| V2-C | complex | 49.1 | 44.8 | 26.0 | 76.3 | 0.4% |

**압축/폭발 없음 확인**(§45 목표): 어느 domain도 90점 이상이 40%를 넘거나
0/100 양극단에 쏠리지 않는다(전부 1% 미만). V2-B의 complex만 다소 좌측
치우침(mean41.5, 47.1%가 20~39 구간) — ageB(slow-decay, floor8)와
parkingA(steep logistic)의 결합이 원인으로 분석된다(§H에서 V2-B 약점으로
기록).

### District bias(§46)

| MODEL | min 구 | max 구 | ratio |
|---|---|---|---|
| V2-A | 중구(53.5) | 강서구(74.2) | **1.39x** |
| V2-B | 중구(52.5) | 강서구(74.2) | 1.41x |
| V2-C | 연제구(60.6) | 강서구(74.0) | **1.22x** |

STEP0.7-A의 peer-quality gap(1.38x)과 같은 수준 또는 더 낮다 — LOCAL
percentile을 완전히 배제했음에도(§18 정책) district bias가 악화되지
않았고, 오히려 V2-C는 개선됐다. **좋은 지역이 높은 평균을 갖는 것 자체는
정상**(강서구 신도시 지역 특성상 광역 대중교통 계획 자체가 최근에 짜여
접근성이 실제로 좋을 수 있음) — peer artifact가 아니라 절대 데이터 반영
결과임을 위 correlation/distribution 분석으로 뒷받침한다.

## G. Benchmark Validation(§39-43,47-48) — 41개, `step2-04` 실행 결과

### 확장 benchmark(§39)

부산 16개 구·군 전부 포함 + 13개 archetype(NEW_LARGE/OLD_LARGE/ULTRA_SUBWAY/
MID_SUBWAY/NON_SUBWAY/HIGH_PARKING/LOW_PARKING/ELEMENTARY_CLOSE/
ELEMENTARY_FAR/LIVING_DENSE/LIVING_SPARSE/HIGH_CONFIDENCE/LOW_CONFIDENCE)
+ 고정 3개 = **총 41개**(목표 30~50 달성). 전체 목록:
`data/score-v2-step2/benchmark-factor-scores.json`.

### 대신해모 / 협성 factor-level candidate scores(MODEL V2-A 곡선, §40-41)

| factor | 대신해모(raw) | 대신해모(score) | 협성(raw) | 협성(score) |
|---|---|---|---|---|
| subway | 140m | **87.6** | 306m | 67.4 |
| bus(결합) | - | 83.8 | - | 82.9 |
| age | 4년 | **90.0** | 25년 | 46.0 |
| scale | 733세대 | **84.5** | 489세대 | 77.4 |
| parking | 1.09 | 57.3 | 1.58 | **87.4** |
| elementary | 545m | 37.0 | 341m | **60.9** |
| **Transport(domain)** | | **86.5** | | 72.1 |
| **Complex(domain)** | | **82.9** | | 64.8 |
| **Education(domain)** | | 37.0 | | **60.9** |
| **Living(domain)** | | **60.7** | | 58.4 |

### Dominance check(§42) — **전부 PASS**

```
subway:  대신해모(87.6) > 협성(67.4)   PASS
parking: 협성(87.4) > 대신해모(57.3)   PASS
age:     대신해모(90.0) > 협성(46.0)   PASS
scale:   대신해모(84.5) > 협성(77.4)   PASS
```

raw fact 방향과 curve 결과 방향이 4개 factor 전부 일치한다. **Education
domain에서는 STEP0.8이 지적한 V1 역전(대신해모 22.0>협성 11.4)이 정확히
반대로 뒤집혀 협성(60.9)>대신해모(37.0)로 나온다 — 이것이 정답이다**(raw
fact: 협성 341m가 대신해모 545m보다 실제로 가깝다).

### 구덕금호(§43)

`peerEligibility=DISPLAY_ONLY`, `coord=COORD_LOW` — transport/education/
living factor는 좌표 신뢰 불가로 애초에 `null`(계산 자체를 시도하지 않음).
complex domain만 age(46.0) 단일 factor로 PARTIAL(coverage 0.75, bounded
redistribution 상한 적용). **Core 종합점수는 생성하지 않는다**
(STEP1.5 NOT_ENOUGH_DATA 정책 그대로 승계) — factor 하나가 계산된다고
전체를 완성된 것처럼 보여주지 않는다.

### Expert sanity cases(§47) — 부산 전체 3,402건, 5가지 패턴 전부 0건

```
ultraSubwayLowTransport: 0   highParkingLowParking: 0   newAgeLowAge: 0
largeScaleLowScale: 0        closeSchoolLowEducation: 0
```

factor-level(parking/age/scale/subway)은 단일변수 순수함수라 모순이
구조적으로 발생할 수 없다(0건이 정상). domain-level(transport/education)도
0건 — 즉 "초역세권인데 종합 transport가 낮은" 경우가 부산 전체에 단 한
건도 없다.

### Counterexample search(§48) — 발견된 실제 한계

의도적으로 모델을 깨보려는 5가지 케이스 중, **"지하철 없음(confirmed
absent) + 버스 매우 많음"** 조합에서 설계 공백을 발견했다: 현재
prototype은 "confirmed absent"(반경 내 지하철 없음이 확인됨, `qualityFlag=
'complete'`+null)와 "단순 결측"(수집 실패 등)을 **구분하지 않고 둘 다
`null`로 처리**한다. 그 결과 지하철이 전혀 없는 단지도 버스만으로 transport
domain이 계산돼(bounded redistribution이 bus 단독 100% 흡수) 실제로는
"교통이 좋다"고 보기 어려운 케이스가 상당히 높은 transport 점수를 받을 수
있다. **이는 이번 STEP에서 발견했을 뿐 수정하지 않았다** — V1
`percentile.ts`가 이미 가진 `treatCompleteNullAsWorst` sentinel 처리
패턴을 STEP3에서 그대로 재사용해 고칠 것을 권고한다(알려진 문제 참고).
그 외 "신축 소단지/구축 초대단지/주차 좋으나 구축/학교 가까우나 생활시설
적음"은 각 domain이 독립적으로 유지되는 한 자연스러운 trade-off로
나타나며(예: ELEMENTARY_CLOSE 벤치마크가 Education은 높고 Living은
평범 — 정상), 도메인을 하나의 총점으로 성급히 합치지 않는 한 문제가 되지
않는다.

## H. Expert Credibility Audit(§49)

STEP1.5의 8개 gate를 이번 STEP의 3개 MODEL 후보에 적용:

| # | 항목 | V2-A | V2-B | V2-C | 근거 |
|---|---|---|---|---|---|
| 1 | raw fact correctness | PASS | PASS | PASS | 전부 §A 실측 분포 기반, 추정 없음 |
| 2 | obvious dominance | PASS | PASS | PASS | §47 sanity 0건, §42 dominance 4/4 PASS |
| 3 | cross-district consistency | PARTIAL | PARTIAL | PARTIAL | ratio 1.22~1.41x(0에 도달 불가능·불필요, STEP0.7-A 1.38x 수준 유지·개선) |
| 4 | explainability | **PASS(최고)** | PASS | PARTIAL | A는 전부 구간선형(재현 가능), C는 rational/lifecycle 혼합이라 상대적으로 복잡 |
| 5 | missing-data honesty | PASS | PASS | PASS | bounded redistribution + null 전파, fake-zero 0건(테스트 확인) |
| 6 | sensitivity | PASS | PASS | PASS | 18/18 테스트, 경계 jump 없음 |
| 7 | local expert review readiness | PARTIAL | PARTIAL | PARTIAL | 표 구조는 준비(STEP0.8 §AC 계승), 실제 실행은 미착수(이월) |
| 8 | benchmark regression | PASS | PASS | PASS | 41개 벤치마크, V1의 두 가지 유명 역전(transport/education) 전부 해소 확인 |

## 설계 결정 — MODEL 후보 비교(§55) 및 추천(§56)

| | MODEL V2-A(투명우선) | MODEL V2-B(매끄러움우선) | MODEL V2-C(하이브리드) |
|---|---|---|---|
| subway | A_PIECEWISE_LINEAR | B_LOGISTIC | D_MANUAL_SATURATION |
| age | A_PIECEWISE | B_SLOW_DECAY | C_LIFECYCLE_BANDS |
| scale | C_PIECEWISE | B_LOGISTIC | A_LOG_NORMALIZED |
| parking | C_PIECEWISE | A_LOGISTIC(mid1,.22) | C_PIECEWISE |
| transport 조합 | T1(70/30) | T2(55/45) | T3(best-mode) |
| complex 조합 | C3(parking 15%) | C2(균형) | C1(parking 25%) |
| education 조합 | E-A(elementary80%) | E-B(60%) | E-C(최소, elementary만) |
| living 조합 | L1(daily+medical) | L2(6개균형) | L3(essential+park) |
| district bias | 1.39x | 1.41x | **1.22x(최선)** |
| complex 분포 | 정상(mean49.7) | **좌측치우침(mean41.5)** | 정상(mean49.1) |
| explainability | **최고(전부 구간선형)** | 중간 | 낮음(혼합 형태) |

**RECOMMENDED_FOR_SHADOW_TEST = MODEL V2-A.**

근거: (1) §50 투명성 요구("전문가가 재현 가능해야 한다")를 가장 직접적으로
만족 — 전 factor가 구간선형(lookup+보간)이라 계산기 없이 손으로도 검증
가능하다. (2) Expert Credibility Gate에서 유일하게 항목4(explainability)를
"최고"로 받았고 나머지는 B/C와 동률. (3) district bias(1.39x)가 C(1.22x)보다
다소 높지만 STEP0.7-A가 이미 달성한 1.38x 수준과 사실상 동일해 "악화"가
아니다. (4) V2-B는 complex 분포가 눈에 띄게 좌측 치우쳐(§F) 첫 shadow
테스트로는 리스크가 더 크다.

**단, V2-C의 district bias 개선(1.22x)과 T3(best-mode) transport 철학은
STEP3에서 V2-A의 개선안으로 부분 채택 검토를 권고한다** — "하나를 최종
선택"이 아니라 "하나를 대표로 shadow 검증하되 다른 후보의 강점을 이어서
반영"하는 것이 STEP3의 과제다.

## 구현 내용

신규 파일(전부 `scripts/score-v2-step2/`, production 코드 미변경, 미import):

- `curves.ts` — factor curve 순수 함수(subway 4·age 3·scale 3·parking 3·bus·elementary·living)
- `curves.test.ts` — 18개 node:test
- `composition.ts` — domain composition 후보 + bounded redistribution
- `step2-01-data-distributions.ts` — §A 실측
- `step2-02-curve-report.ts` — §D anchor 표 + `curve-candidates.json`
- `step2-03-model-distributions-and-correlation.ts` — §F 분포/correlation/district bias
- `step2-04-benchmark-and-counterexamples.ts` — §G 벤치마크/dominance/sanity
- `data/score-v2-step2/*.json` — 4개 산출물(총 ~100KB, 개인정보 없음)

## 테스트 결과

- `curves.test.ts`: **18/18 PASS**
- 기존 회귀: `peer-quality.test.ts` 20/20, `shadow-score.test.ts` 8/8 — **전부 PASS, 회귀 없음**
- `npx tsc --noEmit`: 신규 파일 0 errors(기존 School V2 SHP 스크립트 7건은 STEP1.5부터 알려진 환경 설치 공백, 무관)
- `npx eslint scripts/score-v2-step2/`: 0 errors, 0 warnings
- `next build`: **미실행** — 신규 코드가 전부 `scripts/score-v2-step2/`에 격리돼 있고 `src/app` 등 app import path에 전혀 포함되지 않음(§60 조건에 따라 build 불필요 판단, grep으로 `src/`에서 참조 0건 확인)

## 알려진 문제

1. **confirmed-absent subway sentinel 미구현**(§48 counterexample에서 발견) —
   "지하철 없음 확인됨"과 "단순 결측"을 curve 레벨에서 구분하지 않는다.
   V1 `percentile.ts`의 `treatCompleteNullAsWorst` 패턴을 STEP3에서 재사용
   권고.
2. **hospital/park count의 낮은 변별력**(§B) — 수집 캡(45/15) 자체의 한계로,
   curve 설계로 완전히 해결 불가. STEP3 또는 별도 STEP에서 다중 페이지
   수집으로 재수집 여부 검토 권고(비용/API 쿼터 트레이드오프 있음, 이번
   STEP에서 결정하지 않음).
3. **mart/convenience 높은 상관(r=0.75)**(§36) — Living composition에서
   중복가중 위험, STEP3에서 "일상편의" 단일 축 통합 검토 권고.
4. **Education 도메인이 elementary 단일 raw-distance factor에 크게 의존**
   — 공식 통학구역(categorical)·kindergarten·middle/high는 아직 domain
   score에 실질적으로 반영되지 않음(School V2 branch 병합 전이라 §STEP1.5
   과제 그대로 이월). School.latitude/longitude 0% 문제가 해결되지 않는 한
   구조적 한계로 남는다.
5. **local expert review 미실행**(gate 항목7 PARTIAL 유지) — STEP0.8부터
   이월된 과제, 이번 STEP에서도 실행하지 않음.

## 다음 STEP

STEP3에서: (1) 확인된 confirmed-absent sentinel 버그 수정, (2) V2-A를
기준으로 V2-C의 T3(best-mode)/낮은 district-bias 요소 부분 채택 실험,
(3) domain-level/factor-level 최종 weight 확정을 위한 shadow validation
(부산 전체 + 41개 벤치마크에서 V2-A를 실제 shadow score로 계산해 STEP0.8과
동일한 방법론으로 재검증), (4) mart/convenience 통합 여부 결정, (5) local
expert review 실행.

---

## 최종 보고 (E-JIP SCORE V2 STEP 2)

1. branch = `score-v2-step2-absolute-curves`
2. base = `score-v2-data-foundation`(`a7e267f`)

3. total apartments = 3,402
4. factor coverage summary = transport-eligible 2,833(83.3%), parking-eligible 862(25.3%), households 2,544(74.8%), age 3,402(100%), kindergarten-distance 계산가능 2,833(100% of transport-eligible), FAR/BCR 0%

**TRANSPORT**
5. subway eligible = 2,833(실값 2,291)
6. subway distribution = min19/p10=164/median=397/p90=758/p99=971/max=999
7. curve candidates = A_PIECEWISE_LINEAR/B_LOGISTIC/C_EXPONENTIAL_DECAY/D_MANUAL_ANCHORED_SATURATION
8. recommended subway curve = **A_PIECEWISE_LINEAR**
9. score@100m=90.0
10. @200m=80.7
11. @300m=68.0
12. @500m=48.0
13. @800m=28.0
14. @1000m=20.0
15. @1500m=10.0(@2000m=5.0)
16. bus raw features = `nearestBusStopDistanceM`, `busStopCount300m`(코드 확인, route 정보는 미영속)
17. bus distribution = distance min1/p10=34/median=87/p90=187/max=467, count median=12/p90=22
18. bus curve recommendation = 거리(logistic mid110/scale45)+개수(saturating halfLife6) 50:50 결합
19. transport composition candidates = T1(70/30)/T2(55/45)/T3(best-mode)
20. recommended transport candidate = **T1**(V2-A 채택분)

**COMPLEX**
21. age distribution = min0/p25=12/median=23/p75=33/p99=51/max=64(100% coverage)
22. age curve candidates = A_PIECEWISE/B_SLOW_DECAY_SATURATION/C_LIFECYCLE_BANDS
23. recommended age curve = **A_PIECEWISE**
24. households distribution = min5/p25=46/median=118/p75=352/p90=793/max=7374(coverage 74.8%)
25. scale curve = 3개 후보(A_LOG/B_LOGISTIC/C_PIECEWISE) 전부 saturating 확인, 추천 **C_PIECEWISE**
26. parking coverage = **25.3%**(862/3,402, STEP0.8/STEP1.5와 동일 — 변화 없음)
27. parking distribution = min0.02/p10=0.66/median=1.106/p90=1.6/max=5.56
28. recommended parking curve = **C_PIECEWISE**(A/B와 유사 성능, 가장 투명)
29. score@1.09 = 57.2(C 기준, A=59.1)
30. score@1.58 = 87.2(C 기준, A=89.0) — **격차 30pt 내외, V1의 77pt 대비 대폭 완화**
31. FAR/BCR status = ApartmentMaster 0%(컬럼 없음), legacy 34건 한정 — **V2 first release 제외 확정**
32. brand status = 기축 아파트 데이터 전무 재확인 — **제외 유지**
33. complex composition candidates = C1(25/25)/C2(균형)/C3(parking 15%)
34. recommended complex candidate = **C3**(parking 낮은 coverage 반영)

**EDUCATION**
35. official elementary distance availability = **불가**(School 좌표 0%, STEP1.5·STEP2 양쪽에서 재확인)
36. elementary distance distribution(Kakao POI) = min40/p10=151/median=341/p75=461/p90=592/max=990
37. recommended school access curve = logistic(mid420/scale180/floor8/ceil95)
38. shared-zone treatment = categorical만, score 미반영(confidence만 조정 후보)
39. middle treatment = categorical만(school group 존재/학교 수), score 미반영
40. kindergarten treatment = 실좌표 기반 거리 계산 가능(100%), elementary와 동일 곡선족 재사용, E-A/E-B에서 20~40% 비중
41. high-school treatment = 좌표 0%로 domain score 미반영, low-weight/display만 유지
42. education composition candidates = E-A(80/20)/E-B(60/40)/E-C(elementary만)
43. recommended education candidate = **E-A**

**LIVING**
44. life raw categories = mart/convenience/pharmacy/hospital/park/daycare 6개(코드 확인, 그 이상 세분화 없음)
45. category distributions = 위 §A 표 참고(hospital·park가 수집 캡에 근접/도달)
46. saturation design = half-life 포화 공식(category별 half-life 상이: mart2/convenience8/pharmacy5/hospital20/park6/daycare3)
47. distance/count duplication findings = mart↔convenience r=0.75(높음, 중복가중 위험), daycare는 Education과 중복 위험으로 L3에서 제외
48. living composition candidates = L1(daily+medical)/L2(6개균형)/L3(essential+park 2-layer)
49. recommended living candidate = **L1**

**MODEL**
50. correlation findings = age↔parking -0.369(실제 시대적 confound), mart↔convenience 0.75(중복위험), subway↔living -0.349(도시구조 confound, 결함 아님)
51. sensitivity findings = 근거리 saturation 전 후보 PASS(≤10pt), dominance 전 후보 PASS
52. boundary-jump findings = 699/700 등 전 경계 continuous(jump<1), 구조적으로 discrete threshold 없음
53. district-bias findings = ratio 1.22~1.41x(STEP0.7-A의 1.38x 수준 유지/개선, 8.8x 원본 대비 대폭 개선 유지)

54. benchmark count = **41개**(목표 30~50 달성, 16개 구·군 전부 + 13개 archetype)

55. 대신해모 candidate: subway=87.6, parking=57.3, age=90.0, scale=84.5, education=37.0, living=60.7
56. 협성 candidate: subway=67.4, parking=87.4, age=46.0, scale=77.4, education=60.9, living=58.4

57. monotonic dominance pass? = **YES(4/4: subway/parking/age/scale 전부 PASS)**
58. 구덕금호 handling = transport/education/living factor 계산 자체 불가(coordOk=false), complex만 PARTIAL(age 단일, coverage 0.75) — **Core 종합점수 미생성 유지**

59. contradiction count = ultraSubwayLowTransport 0 / highParkingLowParking 0 / newAgeLowAge 0 / largeScaleLowScale 0 / closeSchoolLowEducation 0 — **전부 0건**

60. MODEL V2-A = 투명우선(전 factor 구간선형), district bias 1.39x
61. MODEL V2-B = 매끄러움우선(로지스틱 중심), complex 분포 좌측치우침 발견
62. MODEL V2-C = 하이브리드(best-mode transport), district bias 1.22x(최선)이나 explainability 낮음

63. RECOMMENDED_FOR_SHADOW_TEST = **MODEL V2-A**(V2-C의 강점은 STEP3 부분 채택 검토)

64. missing-data prototype = bounded redistribution(흡수상한 40%) 구현·적용
65. confidence prototype = coverage(구현됨) + attendanceZoneConfidenceAdjustment(구현됨), 최종 formula 미확정(§53 그대로)

66. Expert Credibility Gate: raw facts=PASS, dominance=PASS, cross-district=PARTIAL(1.22~1.41x), explainability=PASS(V2-A 최고), missing=PASS, sensitivity=PASS, expert-review-ready=PARTIAL(미실행), benchmark=PASS

67. production Score changed? = NO
68. DB write? = NO
69. migration? = NO
70. API changed? = NO
71. UI changed? = NO

72. tests = 18/18(신규) + 20/20 + 8/8(기존 회귀) = **46/46 PASS**
73. tsc = 신규 파일 0 errors(기존 환경 gap 7건 무관, STEP1.5부터 알려짐)
74. lint = 0 errors/0 warnings
75. build if applicable = **미실행**(신규 코드가 app import path에 포함되지 않음, grep으로 0건 확인)

76. docs = 본 문서(`docs/development/EJIP_SCORE_V2_STEP2_ABSOLUTE_CURVES.md`)
77. commit = 진행 예정
78. push = 진행 예정
79. worktree clean = 진행 예정(커밋 후 확인)
80. main untouched = 진행 예정(확인 후 보고)

81. BLOCKER = 없음

82. SCORE_V2_STEP2_CLOSE = YES
83. ABSOLUTE_CURVES_READY = YES
84. SCORE_V2_STEP3_READY = YES

85. NEXT_RECOMMENDATION = STEP3에서 MODEL V2-A를 기준으로 (1) confirmed-absent subway sentinel 수정, (2) V2-C의 best-mode/낮은 district-bias 요소 부분 채택, (3) 부산 전체+41개 벤치마크 shadow validation, (4) domain/factor 최종 weight 확정, (5) local expert review 실행을 진행할 것을 권고한다.
