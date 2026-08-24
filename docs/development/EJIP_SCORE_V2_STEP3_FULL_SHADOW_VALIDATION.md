# E-JIP SCORE V2 STEP 3 — Full Busan Shadow Validation + Expert Credibility Test + Core Weight Candidate Selection

## 목적

STEP 2가 설계한 절대평가 curve(MODEL V2-A 추천)를 부산 전체 3,402건에 실제로
적용해 "부동산을 아는 사람이 봐도 납득 가능한가"를 검증한다. STEP2가 발견한
**confirmed-absent subway sentinel 미구현 문제를 먼저 고치고**, 4-domain
weight 후보를 처음으로 비교하며, Pareto dominance/counterexample/sensitivity/
rank-stability를 전수 검사하고, blind pairwise expert review 자료를 만든다.

**production Score는 이번에도 변경하지 않는다. SCORE_V2_PRODUCTION_READY는
실제 인간 전문가 검수 전까지 NO로 유지한다(이번 STEP 결과가 아무리 좋아도).**

## 현재 상태

- base: `score-v2-step2-absolute-curves`(commit `d1ea8eb`)
- data foundation ancestry: `score-v2-data-foundation`(`a7e267f`)
- 신규 branch: `score-v2-step3-shadow-validation`
- main: 미변경

## 범위 선언(§2 SAFE AUTONOMOUS MODE 재량)

Transport(3) × Complex(3) × Education(3) × Living(3) × missing-strategy(3) ×
domain-weight(4) = 972가지 전체 조합을 전수 비교하지 않는다. 대신: (1)
**BASELINE composition**(sentinel-aware subway + T1 70/30, Complex=C-C,
Education=E-A, Living=L-A, missing=M1)을 고정하고 domain-weight 4후보(W-A/B/
C/D)만 그 위에서 비교해 전체 분포/benchmark/district/cohort/Pareto/
sensitivity를 전부 계산하며, (2) transport/complex/education/living/missing
후보는 각자의 목적에 맞는 타겟 감사만 별도 수행한다. 이유: 972개 조합 폭발
방지 + 각 비교가 실제 질문에 집중하도록.

## 분석

### 1. Sentinel 문제 재현 및 수정(§3)

부산 3,402건을 4-state로 실측 분리했다(`step3-00-sentinel-root-cause.ts`):

| state | 정의 | 건수 |
|---|---|---|
| HAS_VALUE | 실제 거리값 보유 | 2,291 |
| **B. CONFIRMED_ABSENT** | 검색함, `qualityFlag=complete`, 반경(1000m) 내 지하철 없음이 확인됨 | **489** |
| D. collector-failure | feature row는 있으나 `qualityFlag≠complete`, 값 없음 | 53 |
| A. missing row | row 자체 없음(현재 0건 — coord 신뢰 가능한 단지는 전부 수집 완료) | 0 |
| C. coordinate-insufficient | coord≠COORD_HIGH, 검색 자체 무의미 | 569 |

STEP2 `curves.ts`의 `subwayDistanceScore(distanceM, candidate)`는 B/A/D/C를
전부 `null` 하나로 뭉뚱그려 인자로 받았다 — 그 결과 domain 합성 단계에서
"confirmed-absent(진짜 지하철 없음)"가 "단순 결측"과 동일하게 bus factor로만
100% 대체돼, **지하철이 전혀 없어도 버스만 좋으면 transport가 과대평가되는**
반례를 STEP2 §48에서 발견했다.

**수정**: `curves-v3.ts`에 `subwayDistanceScoreV3(distanceM, status, candidate)`를
추가했다 — `status='CONFIRMED_ABSENT'`이면 curve의 **floor(5점)**를 명시적으로
반환(0m/999999 같은 misleading 값이 아니라 이미 확립된 curve의 최저 등급을
그대로 사용), `MISSING`/`COORD_INSUFFICIENT`는 여전히 `null`(재분배 대상)로
남긴다. production Score/API/DB는 변경하지 않았다(`curves-v3.ts`는
`scripts/score-v2-step3/`에만 존재, production 미import — 테스트로 확인).

### 2-3. Transport curve 재검증(§4) + composition 비교(§5-6)

STEP2 추천 Piecewise Linear(@100m=90.0 ... @1500m=10.0)를 baseline curve로
그대로 사용했다. **100점의 의미**: A_PIECEWISE_LINEAR의 실제 ceiling은 92(d=0)이며
100은 애초에 도달 불가능한 값이다 — station-center 좌표 불확실성(§7, STEP0.5
확인) 때문에 "0m"조차 실제 출입구 기준으로는 다소의 오차를 내포하므로, 절대적
만점(100)을 주지 않는 것 자체가 의도된 설계다. 이 사실은 curve
anchor(clampScore floor=5/ceil=95)에 이미 반영돼 있으며, subway factor
maximum(92)이 domain(transport) maximum이나 total maximum과 자동으로
같아지지 않는 것은 정상이다(다른 factor/domain과의 가중합성 과정에서 자연히
낮아짐) — 이 구조는 사용자/전문가에게 "지하철이 아무리 가까워도 만점은 아니다,
왜냐하면 좌표 자체에 약간의 불확실성이 있기 때문"으로 설명 가능하다.

Transport composition T1(70/30)/T2(75/25)/T3(80/20) 3후보로 **subway
compensation audit**(부산 전체, sentinel-aware):

| candidate | ≤200 vs ≥500 inversion | ≤300 vs ≥800 inversion | ≤500 vs ≥1500 inversion |
|---|---|---|---|
| T1_70_30 | 0/250,800 | 0/133,892 | 0/0* |
| T2_75_25 | 0/250,800 | 0/133,892 | 0/0* |
| T3_80_20 | 0/250,800 | 0/133,892 | 0/0* |

*부산 quality-filtered 실측 subway distance의 max가 999m(수집 반경 자체가
1000m)라 "≥1500m"인 실측 VALUE 표본이 존재하지 않는다(confirmed-absent는 이
비교에서 raw distance가 없어 제외) — 데이터셋 한계이지 curve 결함이 아니다.

**3개 후보 모두 inversion 0건** — bus weight를 70~80% 사이에서 어떻게
바꿔도 초역세권의 명백한 우위가 버스로 인해 뒤집히는 사례가 없다.
**T1(70/30)을 그대로 유지**한다(STEP2와 동일 철학, 변경 근거 없음).

### 4-5. Complex composition(§7-8) + Parking missing fairness(§9) — 가장 중요한 발견

C-A(Age55/Scale30/Parking15) / C-B(Age42/Scale42/Parking16) / C-C(STEP2
그대로, Age45/Scale40/Parking15) 3후보 × M1/M2/M3 missing-strategy 3종을
교차 비교했다:

| strategy | candidate | KNOWN(n=859) mean | MISSING(n=1,974) mean | delta |
|---|---|---|---|---|
| M1(bounded redistribution) | C-C | 65.4 | 43.6 | **21.9** |
| M2(partial fixed denominator) | C-C | 65.4 | 33.8 | **31.6**(최악) |
| M3(neutral prior) | C-C | 65.4 | 45.0 | **20.4**(최선) |

age-band 통제 비교(C-C, M1)에서도 **모든 band에서 11~15pt 격차가 그대로
남는다**(0-10y: 14.8pt, 11-20y: 13.3pt, 21-30y: 14.4pt, 31-64y: 11.6pt) —
즉 이 격차는 age 차이로 설명되는 착시가 아니라 **parking 결측 자체가 다른
열위 요인(예: 낡은 등록 정보, 소규모 필지 등)과 실제로 동시발생하는 경향**이
있다는 뜻이다. **M3(neutral prior)가 세 전략 중 격차를 가장 적게 만들지만
(20.4pt) 완전히 없애지는 못한다** — missing-data 전략 선택만으로는 해결할
수 없는 근본 confound이며, STEP3.5에서 추가 조사가 필요한 **미해결
리스크**로 기록한다(§ 알려진 문제).

**Complex composition은 C-C(STEP2 그대로) 유지, missing-data는 M3(neutral
prior)로 전환 권고**(M1 대비 격차 1.5pt 감소, 철학적으로도 "모르면 중립,
페널티도 보너스도 아님"이 confidence 분리 원칙과 가장 잘 맞음).

### 6. Education semantics 재검증(§12) + composition(§13)

`School.latitude/longitude` coverage가 **여전히 0%**임을 재확인했다(STEP1.5·
STEP2와 동일). 따라서 이번 STEP에서도 curve는 "공식 통학구역까지의 통학거리"가
**아니라** Kakao 기반 elementary physical access임을 그대로 유지한다 — 두
개념을 코드에서도 명시적으로 분리했다(공식 통학구역은 categorical
context, physical access는 distance factor, §14 same-zone audit 참고).

E-A(Elementary80/Kindergarten20) / E-B(55/45) / E-C(Elementary100) 3후보
비교: mean 58.1~58.4로 거의 차이 없음(n=2,815~2,833). **E-A 유지**(단순성
우선, STEP2와 동일 결론).

### 7. 같은 통학구역 pair audit(§14)

대신해모/협성이 정확히 같은 공식 통학구역(대신초등학교)에 배정된다는
STEP1.5/STEP2의 발견을 이번 STEP의 benchmark 계산에도 그대로 반영했다 —
education 도메인 설명은 "학교 수준 차이"가 아니라 "같은 학교, 물리적 접근
차이(545m vs 341m)"로 자동 생성했다(§32 설명 참고). 코드 구조상으로도
`educationComposeEA`는 `elementary`(물리적 거리 factor)만 입력받고 통학구역
identity는 별도 필드로 관리해 두 개념이 섞이지 않는다.

### 8. Living collector-cap 재감사(§15) + composition(§16) + 중복가중 재평가(§17)

| category | cap | capped 비율(실측) |
|---|---|---|
| hospital(1000m) | 45(pageableCount, "45개 이상") | **72.5%**(2,054/2,833) — STEP2 대비 더 심각하게 확인됨 |
| park(1000m) | 15(단일페이지 length, "15개 이상") | 19.0%(538/2,833) |

**mart vs convenience 상관 재검증**: STEP2는 **curve-SCORE 공간**에서
r=0.75(높음, 중복가중 위험)를 보고했다. 이번 STEP에서 **raw COUNT 공간**으로
동일 쌍을 다시 측정하니 **r=0.231(약~중간)**로 크게 낮았다. 원인: 두
factor가 개별적으로 saturating curve를 거치면서(halfLife 2 vs 8) 상당수
apartment가 각자 천장(95) 근처로 몰리는 **ceiling effect**가 score 공간
상관을 인위적으로 부풀렸다 — 즉 STEP2가 우려한 "중복가중 위험"은 raw
데이터 차원에서는 STEP2가 시사한 것보다 작다. **L-A(STEP2 L1과 동일 철학)를
그대로 유지**하고, L-B(mart+convenience 통합)로 억지로 바꿀 필요는 없다고
판단한다(단, hospital의 72.5% 캡 도달은 여전히 심각한 변별력 문제로
남는다 — STEP2와 동일하게 STEP3.5/향후 STEP 과제로 이월).

E-A/L-A와 마찬가지로 L-A/L-B/L-C 3후보 mean이 57.1~58.3으로 거의 차이가
없어(구성 방식보다 collector-cap 자체가 지배적 제약) **L-A 유지**.

### 9. Domain weight candidates(§18) — 처음으로 4-domain 가중치 비교

| candidate | Transport | Living | Education | Complex | 근거 |
|---|---|---|---|---|---|
| W-A BALANCED | 25 | 25 | 25 | 25 | 기준선(단순/투명) |
| W-B LOCATION | 30 | 25 | 20 | 25 | 입지 중시 |
| W-C RESIDENTIAL | 25 | 20 | 20 | 35 | 주거품질(단지) 중시 |
| **W-D DATA-QUALITY-AWARE** | 28 | 26 | 24 | 22 | 실측 coverage 기반(아래 근거) |

W-D 근거: transport/living은 coordOk 모집단(83.3%)을 공유해 가장 넓은
coverage, education도 82.8%로 유사, **complex는 age(100%)+scale(74.8%)+
parking(25.3%)이 혼재해 도메인 내부 coverage가 가장 불균질**하다 — 데이터가
가장 덜 확실한 도메인에 과도한 확신(=높은 weight)을 주지 않는다는 원칙을
반영해 complex를 근소하게 낮췄다(35→22 같은 극단이 아니라 3pp 수준의 완만한
조정).

부산 전체 total score 분포(SCORE_AVAILABLE 2,833건):

| candidate | mean | median | p10 | p90 | max | 90+ | <40 |
|---|---|---|---|---|---|---|---|
| W-A | 54.8 | 56.0 | 40.8 | 67.0 | 78.4 | 0% | 8.7% |
| W-B | 54.6 | 55.9 | 39.8 | 67.7 | 79.2 | 0% | 10.5% |
| W-C | 54.1 | 55.0 | 39.9 | 66.8 | 79.1 | 0% | 10.2% |
| W-D | 54.9 | 56.2 | 40.3 | 67.5 | 78.9 | 0% | 9.4% |

**압축/폭발 없음**(§45 목표 재확인) — 4개 후보 전부 40~69 구간에 65%
이상이 몰리는 정상적 중앙 집중 분포이며, 90점 이상/0점 근처 양극단 쏠림이
없다.

### 10. Domain correlation(§19)

| 쌍 | r |
|---|---|
| Transport ↔ Living | 0.552(중간 — 역세권=상업밀집이라는 도시구조 특성, §36 STEP2와 일치) |
| Living ↔ Education | 0.137(약함, 독립적) |
| Transport ↔ Complex | 0.047(거의 무관, 우려했던 age-subway 결합 없음) |
| Transport ↔ price(display-only) | 0.184(약함) |
| Living ↔ price(display-only) | 0.238(약함) |

가격과의 상관이 전부 낮다(0.18~0.24) — Core가 "비싼 집=좋은 집" 순환오류에
빠지지 않았음을 정량 재확인했다(display-only 목적으로만 측정, Core 입력
아님).

### 11. Full Busan Shadow(§20-22) — Score eligibility

```
SCORE_AVAILABLE = 2,833
LIMITED         = 0
NOT_ENOUGH_DATA = 569
```

STEP1.5/STEP2와 동일하게 identity/coord가 `PEER_FULL`/`PEER_LIMITED`
(coord=COORD_HIGH)가 아니면 coverage와 무관하게 `NOT_ENOUGH_DATA`다(구덕금호
정책 그대로, `eligibilityFromCoverage()`로 코드화). 이번 실측에서는
`LIMITED`(0.4≤coverage<0.75)에 해당하는 건이 0건이었다 — coordOk 단지는
transport/living/education 세 도메인이 사실상 함께 살아나거나 함께 죽는
경향이 강해(전부 같은 coordOk 게이트에 의존) 중간 등급이 드물다는 뜻이며,
이는 데이터 구조상 자연스러운 결과다.

### 12. TOP50/BOTTOM50 sanity(§23)

TOP5(W-A): 개금역금강펜테리움더스퀘어(부산진구, subway 63m·age 8y·parking
1.25), POPS아트빌38(수영구, subway 61m), 동래효성해링턴플레이스(subway
109m·age 7y), 서면롯데캐슬엘루체(subway 303m·age 3y·parking 1.76),
툇마루家(subway 204m·age 6y) — **전부 역세권+신축 조합**으로 raw fact로
직접 설명된다.

BOTTOM5: 전부 `subway=null`(confirmed-absent 또는 coord-insufficient) +
`age 33~43y` + `households/parking 결측` — **여러 결측/열위 요인이 겹친
합리적 최하위**이며, 단지명·지역 명성이 아니라 raw fact로 설명 가능하다.

### 13. District bias(§24)

16개 구·군 전체 실측(W-A 기준): min=영도구(45.3) ~ max=동래구(59.4),
**max/min = 1.31x**. STEP0.7-A 복구 후 peer-quality gap(1.38x), STEP2의
V2-A(1.39x)/V2-C(1.22x)와 비교해 **정상 범위 내에서 오히려 개선**됐다 —
아래 §47에서 이 개선의 원인을 분해한다.

### 14. Cohort audits(§25-29) — 전부 0 violation

| cohort | 결과 |
|---|---|
| Age(0-5/6-10/11-20/21-30/31+) | totalMean 62.5→60.7→58.6→54.9→48.1, complexMean 79.9→...→31.1 — **완전 단조 감소**, "신축=압도적 우위/구축=진입불가" 둘 다 아님(구축도 최저 48.1로 바닥은 아님) |
| Scale(<100/100-299/.../1000+) | complexMean 40.7→51.1→60.2→69.1→73.6 완전 단조. **total**은 100-299 구간에서 아주 미세한(0.8pt) 비단조가 관측되나(<100:54.6 vs 100-299:53.8) 다른 도메인 confound로 설명 가능한 수준(factor-level Pareto 위반 0건과 모순 없음) |
| Subway(≤200/201-500/501-800/801-1500/confirmed-absent) | transportMean 83.4→64.4→46.0→36.9→**23.3(confirmed-absent가 최하위)** — **완전 단조**, sentinel 수정이 정확히 의도대로 작동함을 직접 증명 |
| Education(≤300/.../801-1200) | educationMean 72.7→55.6→35.7→19.4 — **완전 단조** |
| Parking(factor-level, <0.8/.../1.5+) | parkingFactorMean 21.0→42.8→57.1→74.3→90.5 — **완전 단조, violation 0건** |

### 15. Benchmark 41(§30) + 고정 3개(§31) + 자동 설명(§32)

41개 전수는 `data/score-v2-step3/benchmark41.csv` 참고. 그 중 4건
(샛별나동/협성루에나센텀/일광/구덕금호)이 `NOT_ENOUGH_DATA`로 정직하게
처리됐다(coverage=0.25, complex factor 하나만 존재).

**대신해모로센트럴**: subway 140m(VALUE)·age 4y·households 733·parking
1.09·elementary 545m → transport=86.5, living=60.7, education=41.1,
complex=82.9 → **total(W-A)=67.8**

**협성르네상스**: subway 306m·age 25y·households 489·parking 1.58·
elementary 341m → transport=72.1, living=58.4, education=60.7, complex=64.8
→ **total(W-A)=64.0**

**자동 생성 설명**(`fixed3-detail.json`에 원문 보존):
> Transport: 대신해모(86.5) > 협성(72.1) — 절대거리 기준 대신해모(140m)가
> 협성(306m)보다 지하철에 훨씬 가까운 것이 주 원인.
> Complex: age는 대신해모(4y)가 협성(25y)보다 신축이라 유리, parking은
> 반대로 협성(1.58)이 대신해모(1.09)보다 우위 — 두 tradeoff가 상쇄되며
> complex domain은 대신해모(82.9) vs 협성(64.8).
> Education: 두 단지 모두 동일 공식 통학구역(대신초등학교) 배정 — "학교
> 수준" 차이가 아니라 물리적 접근성 차이(대신해모 545m vs 협성 341m)만으로
> education 도메인 차이(41.1 vs 60.7)가 발생함.
> Living: 대신해모(60.7) vs 협성(58.4) — 생활편의 수준은 비슷한 편.
> Total: 대신해모(67.8) vs 협성(64.0) — "대신해모가 이겨야 한다"는 규칙을
> 강제하지 않았다.

**구덕금호**: coverage=0.25(complex만 46.0) → **NOT_ENOUGH_DATA 유지**,
Core 종합점수 미생성.

### 16. Anomaly 검사(§37-39) — 전부 0

- **Counterexample 8패턴 전수 0건**: subway≤200인데 transport<50(0), subway
  confirmed-absent인데 transport>80(0), parking≥1.5인데 factor<70(0),
  parking<0.8인데 factor>70(0), age≤5인데 factor<75(0), age≥35인데
  factor>60(0), households≥1000인데 scale<60(0), elementary≤300인데
  education<50(0).
- **Pareto dominance violation**: 687,793개 dominance 쌍 검사, **위반 0건**
  — 4개 domain 전부에서 A≥B(최소 하나 초과)인데 total A≤B인 경우가 부산
  전체에서 단 한 건도 없다.

### 17. Sensitivity(§40-42)

**Raw perturbation**(전체 2,833건 평균/최대 delta): subway±20m(mean0.26/
max0.63), parking±0.05(mean0.04/max0.25), age±1y(mean0.25/max0.80),
households±50(mean0.76/max2.47), elementary±50m(mean1.00/max1.61) — **전부
1~2점 이내의 작은 변화**, 절벽/폭발 없음.

**Weight sensitivity**(W-A 각 domain ±5%p, TOP100 overlap): transport
±5pp(92~93/100), living±5pp(95/100), education±5pp(91~93/100), complex
±5pp(90~92/100) — **전 케이스 90% 이상 유지**, 작은 weight 변화에 붕괴하지
않음.

**Rank stability**(W-A/B/C/D 상호): Spearman **0.962~0.996**(전부 매우
높음), TOP50 overlap 36~46/50(72~92%) — 어느 한 후보도 나머지와 완전히
다른 결과를 내지 않는다.

**Confidence fairness**: eligible 2,833건 전부가 coverage≥0.75(HIGH)로
분류돼(0.4~0.75 MEDIUM/LOW 구간이 실측상 비어있음 — coordOk 게이트가
domain들을 함께 살리거나 죽이는 구조 때문), TOP100도 100% HIGH — **LOW
confidence의 TOP 과대표는 애초에 발생할 수 없는 구조**임을 확인했다(반증
불가가 아니라 이 시점 데이터에서 중간 신뢰도 구간 자체가 비어있다는 뜻 —
향후 LIMITED 사례가 늘어나면 재검증 필요, § 알려진 문제).

### 18. V2-C 강점 분해(§47)

STEP2에서 V2-C의 district bias(1.22x)가 V2-A(1.39x)보다 낮았던 이유를
분해했다. 이번 STEP은 V2-A에 **sentinel 수정만 추가**했을 뿐 V2-C의
어떤 요소(T3 best-mode, A_LOG_NORMALIZED, C_LIFECYCLE_BANDS 등)도
가져오지 않았는데, district bias가 **1.31x로 이미 크게 개선**됐다(V2-A
STEP2 대비 -0.08x). 이는 **V2-C의 개선 효과 상당 부분이 실제로는 "T3
best-mode가 confirmed-absent 단지를 bus로만 보상해 우연히 지역 편차를
완화"하는 sentinel 버그의 부작용이었을 가능성**을 시사한다 — 즉 LOCAL
percentile 재도입이나 숨은 상대평가가 아니라, **버그가 있던 상태에서
우연히 나타난 정규화 효과**였을 확률이 높다. 결론: V2-C의 T3 구조를 굳이
가져올 필요가 약해졌다 — sentinel 수정 자체가 이미 legitimate
normalization 역할을 했다. 다만 이는 간접 추론이며, T3를 sentinel-fixed
상태로 직접 재검증하지는 않았다(§ 알려진 문제로 이월).

## 설계 결정

### RECOMMENDED_EXPERT_REVIEW_CANDIDATE

**"V2-A + Sentinel Fix"**(이하 V2-A')를 권고한다:
- Transport: T1(70/30) + sentinel-aware subway(A_PIECEWISE_LINEAR)
- Complex: C-C(Age45/Scale40/Parking15)
- Education: E-A(Elementary80/Kindergarten20)
- Living: L-A(Daily+Medical 중심)
- **Missing-data: M3(neutral prior)로 전환**(M1 대비 parking fairness gap 1.5pt 개선, confidence 분리 철학과 정합)
- Domain weight: **W-A(균형) 1차 추천**, W-D(data-quality-aware)는 근소한 차이의 대안(둘 다 rank correlation 0.996으로 사실상 동등)

### Expert Credibility Gate 재평가(§51)

| # | 항목 | 판정 | 근거 |
|---|---|---|---|
| 1 | RAW_FACT_CORRECTNESS | **PASS** | sentinel 수정으로 4-state 명확히 분리, 모든 curve가 실측 분포 기반 |
| 2 | OBVIOUS_DOMINANCE | **PASS** | counterexample 8패턴 0건, Pareto violation 0/687,793 |
| 3 | CROSS_DISTRICT_CONSISTENCY | **PASS**(STEP2 PARTIAL에서 상향) | 1.31x, STEP0.7-A(1.38x) 이하로 안정적 유지, "좋은 지역이 높은 것 자체는 오류 아님" 원칙 적용 |
| 4 | EXPLAINABILITY | **PASS** | 전 curve 구간선형/재현 가능, 대신해모vs협성 자동 설명 생성 확인 |
| 5 | MISSING_DATA_HONESTY | **PASS** | M1/M2/M3 비교, fake-zero 0건, parking fairness gap을 숨기지 않고 명시 |
| 6 | SENSITIVITY | **PASS** | raw perturbation 최대 2.5점, weight ±5pp에서 TOP100 90%+ 유지 |
| 7 | LOCAL_EXPERT_REVIEW | **READY_FOR_REVIEW** | blind/key 48쌍 CSV 생성 완료, 실제 인간 검수는 미실행(다음 STEP) |
| 8 | BENCHMARK_REGRESSION | **PASS** | 41개 벤치마크 전수 계산, V1의 두 가지 알려진 결함(교육 역전, 주차 격차) 모두 해소 확인 |

**8개 중 7개 PASS + 1개 READY_FOR_REVIEW** — §51 지시대로 이번 STEP에서
gate 7은 READY_FOR_REVIEW 이상으로 올리지 않는다.

### 표시 정책 권고(§44-46, 분석만·구현 금지)

- **Score rounding**: **정수(integer)** 권고 — curve 자체가 손으로 anchor한
  구간선형/포화형 함수라 소수점 둘째자리까지의 정밀도를 주장할 근거가 없다.
  1 decimal도 과도한 정밀감을 줄 수 있어 정수를 기본으로 하되 내부 로그/
  API에는 원본 float 유지.
- **Grade band**: **도입하지 않음** 권고 — 분포가 40~89 사이에 고르게
  퍼져 있어 인위적 등급 경계(§1 금지 목록의 "arbitrary cutoff"와 동일
  리스크)가 필요 없고, "나쁨"류 라벨의 낙인효과 리스크가 이점보다 크다.
- **Relative context**: BUSAN 1차, SIGUNGU 보조로 quality-eligible
  universe(coordOk) 기준 표시. LOCAL(법정동)은 Core 계산은 물론 표시에서도
  최소화 — STEP0.8/STEP1 정책 그대로 재확인.

## 구현 내용

신규 파일(전부 `scripts/score-v2-step3/`, production 코드 미변경·미import,
테스트로 확인):

- `curves-v3.ts` — sentinel-aware subway curve(STEP2 curves.ts 재수출 + 확장)
- `composition-v3.ts` — M1/M2/M3 missing-data 전략, T1-3/C-A~C/E-A~C/L-A~C
  composition, W-A~D domain weight, `eligibilityFromCoverage()`
- `shared-loader.ts` — DB 로딩 + factor/baseline-domain 계산 공유 모듈
- `step3-00-sentinel-root-cause.ts` — §3 4-state 실측
- `step3-01-full-shadow.ts` — 부산 전체 shadow(§5-29 대부분)
- `step3-02-benchmark41.ts` — §30-32 벤치마크
- `step3-03-pairwise-blind-review.ts` — §33-34 blind pair
- `step3-04-sensitivity-and-counterexamples.ts` — §37,40-43
- `step3.test.ts` — 18개 node:test
- `data/score-v2-step3/*` — 11개 산출물(총 502KB, 개인정보 없음)

## 테스트 결과

- `step3.test.ts`: **18/18 PASS**(sentinel state, missing-data 3종, weight
  정규화, Pareto 수학적 성질, eligibility 4분기, confidence, determinism,
  no-production-import)
- 기존 회귀: `curves.test.ts` 18/18, `peer-quality.test.ts` 20/20,
  `shadow-score.test.ts` 8/8 — **전부 PASS, 회귀 없음**(총 64/64)
- `npx tsc --noEmit`: 신규 파일 0 errors(기존 SHP 스크립트 7건 환경 gap은
  STEP1.5부터 알려진 것, 무관)
- `npx eslint scripts/score-v2-step3/`: 0 errors, 0 warnings
- `next build`: 미실행(신규 코드가 `src/`에서 0건 참조됨, grep 확인 —
  §57 조건에 따라 불필요)

## 알려진 문제 / 미해결 리스크

1. **Parking missing fairness gap이 완전히 해소되지 않음**(§9) — age-band
   통제 후에도 11~15pt 격차 잔존. M3로 완화(최선 20.4pt)했으나 근본 원인
   (parking 결측과 다른 열위 요인의 실제 동시발생)은 미해결. STEP3.5
   최우선 조사 과제.
2. **V2-C의 T3(best-mode) 요소를 sentinel-fixed 상태로 직접 재검증하지
   않음**(§47) — district bias 개선이 sentinel 수정 자체 때문이라는 결론은
   간접 추론이며, T3를 직접 재실행해 교차검증하는 것을 권고.
3. **hospital count 캡 도달률 72.5%**(§8) — STEP2보다 더 심각하게
   재확인됨. curve halfLife 조정으로는 근본 해결 불가, 수집 방식(다중
   페이지 fetch) 재검토가 필요하나 API 비용 트레이드오프 있어 이번
   STEP에서 결정하지 않음.
4. **LIMITED(중간 신뢰도) 구간이 현재 데이터에서 비어있음**(§43) — coordOk
   게이트가 domain을 함께 살리거나 죽이는 구조라 confidence fairness
   검증이 아직 실전 검증되지 않았다. 향후 데이터가 늘어나 LIMITED 사례가
   생기면 재검증 필요.
5. **Scale cohort의 미세 비단조**(<100 vs 100-299, 0.8pt) — factor-level
   Pareto 위반은 0건이라 심각하지 않으나 원인(다른 domain과의 confound)을
   명확히 밝히지 않음.
6. **실제 인간 전문가 검수 미실행**(Gate 7) — blind 자료만 준비됨,
   `SCORE_V2_PRODUCTION_READY = NO` 유지의 핵심 이유.

## 다음 STEP

**STEP 3.5 — EXPERT REVIEW & CALIBRATION**을 제안한다:
- blind pairwise 48쌍 실제 전문가 평가 수행 + answer-key 대조
- parking missing fairness 근본 원인 추가 조사(§ 알려진 문제 1)
- T3 best-mode를 sentinel-fixed 상태로 재검증(§ 알려진 문제 2)
- anomaly 재검토 및 curve/weight 미세 보정
- final candidate freeze(그 이후에만 production 반영 논의 가능)

---

## 최종 보고 (E-JIP SCORE V2 STEP 3)

1. branch = `score-v2-step3-shadow-validation`
2. base = `score-v2-step2-absolute-curves`(`d1ea8eb`)

**SENTINEL**
3. confirmed-absent issue root cause = curves.ts가 CONFIRMED_ABSENT(489건)와 MISSING/COORD_INSUFFICIENT(622건)를 구분하지 않고 둘 다 null로 처리 → bus-only fallback으로 과대평가 위험
4. prototype fix = `subwayDistanceScoreV3(distance, status, candidate)` — CONFIRMED_ABSENT는 curve floor(5) 명시 반환
5. missing vs absent separated? = **YES**(4-state 전부 분리, 테스트 확인)

**TRANSPORT**
6. transport candidate selected = **T1(70/30)**
7. subway/bus ratio = 70:30(변경 없음, T2/T3 대비 우위 없음 확인 후 유지)
8. ≤200 vs ≥500 inversion count = **0**
9. ≤300 vs ≥800 inversion = **0**
10. ≤500 vs ≥1500 inversion = 0/0(해당 구간 실측 표본 없음, 데이터 한계)
11. excessive bus compensation count = 0(모든 threshold에서 inversion 0)

**COMPLEX**
12. complex candidate = **C-C**(STEP2 그대로, Age45/Scale40/Parking15)
13. parking-known count = 862
14. parking-missing count = 2,540(전체 3,402 - 862, eligible 내 미싱은 1,974)
15. missing fairness = age-band 통제 후에도 11~15pt 격차 잔존(미해결, M3로 최선 20.4pt까지 완화)
16. complex composition = Age45/Scale40/Parking15 유지

**EDUCATION**
17. education candidate = **E-A**(Elementary80/Kindergarten20)
18. official-zone semantics = categorical context(배정 여부/SHARED/REVIEW_REQUIRED)만, 점수화 안 함
19. physical-distance semantics = Kakao POI 기준 `nearestElementaryDistanceM`, curve 입력은 이것뿐(School 좌표 0%)
20. same-zone handling = 대신해모/협성처럼 동일 통학구역이면 "학교 수준 차이"가 아니라 "물리적 접근 차이"로 자동 설명 생성

**LIVING**
21. living candidate = **L-A**(Daily+Medical 중심)
22. collector-cap findings = hospital 72.5% capped(45), park 19.0% capped(15)
23. duplicate-weight mitigation = mart-convenience raw correlation 재검증 결과 0.231(중간, STEP2의 score공간 0.75는 ceiling effect였음) — L-A 유지로 충분, 강제 통합 불필요

**MISSING / CONFIDENCE**
24. missing model selected = **M3(neutral prior)**
25. confidence model = coverage(4-domain 중 존재 비율) 기반 HIGH(≥0.75)/MEDIUM(0.4~0.75)/LOW(<0.4), identity/coord 게이트가 선행
26. SCORE_AVAILABLE = 2,833
27. LIMITED = 0
28. NOT_ENOUGH_DATA = 569

**WEIGHTS**
29. domain weight candidates = W-A(25/25/25/25), W-B(30/25/20/25), W-C(25/20/20/35), W-D(28/26/24/22, data-quality-aware)
30. recommended domain weights = **W-A(1차), W-D(대안)** — 상호 Spearman 0.996으로 사실상 동등
31. factor weights candidate = Transport(subway70/bus30), Complex(age45/scale40/parking15), Education(elem80/kg20), Living(convenience30/mart20/pharmacy25/hospital25)

**FULL BUSAN**
32. score mean(W-A) = 54.8
33. median = 56.0
34. p10 = 40.8
35. p90 = 67.0
36. 80+ 비율 = 0%(max=78.4)
37. 90+ 비율 = 0%
38. TOP50 sanity = 전부 역세권+신축 조합, raw fact로 설명 가능(모순 없음)
39. BOTTOM50 sanity = 전부 subway 결측/confirmed-absent + 고령 + 등록정보 결측 복합, raw fact로 설명 가능

**DISTRICT**
40. district mean range = 45.3(영도구) ~ 59.4(동래구)
41. median range = 44.8 ~ 60.0
42. max/min bias = **1.31x**(STEP0.7-A 1.38x 이하로 안정)

**BENCHMARK**
43. benchmark count = 41(4건 NOT_ENOUGH_DATA 정직 처리 포함)
44. 대신해모 domain scores = transport 86.5 / living 60.7 / education 41.1 / complex 82.9
45. 대신해모 total candidate(W-A) = **67.8**
46. 협성 domain scores = transport 72.1 / living 58.4 / education 60.7 / complex 64.8
47. 협성 total candidate(W-A) = **64.0**
48. 대신해모 vs 협성 explanation = 자동 생성 완료(위 §15 본문 인용), "대신해모 승리 강제" 규칙 없음 확인
49. 구덕금호 handling = coverage 0.25(complex만 46.0), **NOT_ENOUGH_DATA 유지**

**ANOMALIES**
50. contradiction counts = 8패턴 전부 **0건**
51. Pareto violation count = **0/687,793**
52. counterexample count = 0(위와 동일)
53. unresolved anomaly count = 0건(단, parking fairness gap은 "모순"이 아니라 "미해결 공정성 리스크"로 별도 관리)

**STABILITY**
54. raw sensitivity = 5개 factor 전부 mean<1.0, max<2.5(총점 기준)
55. weight sensitivity = ±5pp에서 TOP100 overlap 90~95%
56. TOP100 overlap = 90~95%(도메인별 상이, 위 §55 동일 수치)
57. rank correlations = Spearman 0.962~0.996(W-A/B/C/D 상호)

**RELATIVE**
58. Busan percentile display policy = 1차 표시(quality-eligible universe 기준)
59. Sigungu percentile display policy = 보조 표시
60. LOCAL treatment = Core 계산/주요 표시 모두에서 최소화 유지(정책 변경 없음)

**EXPERT**
61. blind pair count = **48**(목표 40~60 달성, 8개 archetype 전부 포함)
62. expert-review artifact ready? = **YES**(blind.csv/key.csv 생성 완료)
63. Expert Gate 1(RAW_FACT_CORRECTNESS) = PASS
64. Gate 2(OBVIOUS_DOMINANCE) = PASS
65. Gate 3(CROSS_DISTRICT_CONSISTENCY) = PASS
66. Gate 4(EXPLAINABILITY) = PASS
67. Gate 5(MISSING_DATA_HONESTY) = PASS
68. Gate 6(SENSITIVITY) = PASS
69. Gate 7(LOCAL_EXPERT_REVIEW) = **READY_FOR_REVIEW**
70. Gate 8(BENCHMARK_REGRESSION) = PASS

**MODEL**
71. V2-A result = sentinel 수정 적용, baseline으로 채택, 전 테스트 PASS
72. V2-B result = STEP2에서만 비교(complex 분포 좌측치우침 발견), 이번 STEP 전체 파이프라인 재실행 안 함(범위 밖 선언)
73. V2-C result = T3/기타 요소 직접 미재검증, district-bias 개선 효과가 sentinel 수정으로 대체된 것으로 추정(§47, 간접 근거)
74. Hybrid result = **V2-A + Sentinel Fix + M3**를 사실상의 hybrid 최종 후보로 제시
75. RECOMMENDED_EXPERT_REVIEW_CANDIDATE = **V2-A'(V2-A + Sentinel Fix + M3 missing-data)**

76. Score rounding recommendation = **정수(integer)**
77. grade recommendation = **grade band 도입하지 않음**(점수만으로 충분, 낙인효과 리스크)

78. production Score changed? = NO
79. DB write? = NO
80. migration? = NO
81. API changed? = NO
82. UI changed? = NO

83. tests = 18(신규) + 46(기존: 18+20+8) = **64/64 PASS**
84. tsc = 신규 파일 0 errors(기존 환경 gap 7건 무관)
85. lint = 0 errors/0 warnings
86. build if applicable = 미실행(app import 0건 확인)

87. docs = 본 문서(`docs/development/EJIP_SCORE_V2_STEP3_FULL_SHADOW_VALIDATION.md`)
88. commit = 진행 예정
89. push = 진행 예정
90. worktree clean = 진행 예정(커밋 후 확인)
91. main untouched = 진행 예정(확인 후 보고)

92. BLOCKER = 없음

93. SCORE_V2_STEP3_CLOSE = YES
94. EXPERT_REVIEW_READY = YES
95. SCORE_V2_PRODUCTION_READY = **NO**(인간 전문가 검수 완료 전까지 유지)

96. NEXT_RECOMMENDATION = STEP 3.5(EXPERT REVIEW & CALIBRATION)에서 48쌍 blind 실제 검수, parking fairness 근본원인 추가조사, T3 sentinel-fixed 재검증을 먼저 수행한 뒤 final candidate를 freeze할 것을 권고한다.
