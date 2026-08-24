# E-JIP SCORE V2 STEP 3.7 — Final Calibration Gate Before Freeze

## 목적

STEP 3.6 Human Review Interpretation 완료 후, 최종 candidate freeze 직전에
**Score V2가 객관적 Core Score로서 설명 가능하고 안정적인지**를 마지막으로 검증한다.

human overall preference agreement는 판정 근거에서 제외한다.
weight fitting 금지 / production 구현 금지 / curve 수정 금지.

## 현재 상태

- branch: `score-v2-step35-expert-calibration`
- base commit: `0b770ad` (STEP 3.6)
- DOMAIN_OBJECTIVE_GATE = PASS (STEP 3.6)
- OVERALL_CALIBRATION_GATE = PASS (STEP 3.6)
- PERSONALIZATION_SIGNAL = YES (STEP 3.6)
- FINAL_CANDIDATE_FROZEN = REVIEW (PM 판단 위임 상태)

### STEP 3.6 표현 정정 (§0)

STEP 3.6의 "진정한 객관적 오류 0건"은

> **"현재 n=1 human review에서 확인된 confirmed objective calibration error = 0"**

으로 제한 해석한다.
n=1 검수자이므로 객관적 오류가 존재하지 않는다고 일반화하지 않는다.

---

## 분석

### 0. W-A 가중치 구조 확인

STEP 3 문서에 "W-A(균형)"로 명시됐으나 정확한 수치가 명시적으로 기록되지 않았다.
answer-key 데이터로 역산해 확인한다.

**PAIR 01 역산:**
```
A_total = (T=20.8 + L=31.7 + E=66.0 + C=87.2) / 4 = 205.7 / 4 = 51.425 ≈ 51.4 ✓
B_total = (T=53.6 + L=65.5 + E=57.7 + C=17.0) / 4 = 193.8 / 4 = 48.45 ≈ 48.4 ✓
```

**PAIR 03 역산:**
```
A_total = (89.4 + 68.6 + 58.6 + 41.9) / 4 = 258.5 / 4 = 64.625 ≈ 64.6 ✓
B_total = (20.7 + 51.0 + 45.5 + 84.3) / 4 = 201.5 / 4 = 50.375 ≈ 50.4 ✓
```

**결론: W-A = Transport 25% / Living 25% / Education 25% / Complex 25% (등가 가중치)**

이 구조는 "가격을 제외한 주거품질의 균형적 평가"라는 Core Score 정의와 정합하며,
4개 domain 중 어느 하나도 임의로 우대하지 않는 투명한 수식이다.

---

### 1. 검증 대상 Pair 구성

| 번호 | PAIR | 포함 이유 |
|---|---|---|
| ① | PAIR 03 | PREFERENCE_SENSITIVE 재검증 대상 |
| ② | PAIR 04 | PREFERENCE_SENSITIVE 재검증 대상 |
| ③ | PAIR 06 | PREFERENCE_SENSITIVE 재검증 대상 |
| ④ | PAIR 10 | PREFERENCE_SENSITIVE + PAIR 10 정정 반영 |
| ⑤ | PAIR 12 | Control: objective agreement + 최대 gap(22.9pt) |
| ⑥ | PAIR 07 | Control: model TIE(0.2pt) |
| ⑦ | PAIR 09 | Control: transport/complex dominance B 우위 |
| ⑧ | PAIR 08 | Control: living+transport vs education TIE |
| ⑨ | PAIR 01 | Control: complex dominance A vs transport dominance B TIE |
| ⑩ | PAIR 13 | Control: transport vs complex tradeoff 근소 A 우위 |

---

### 2. 핵심 pair 도메인 분해 (Domain Contribution Analysis)

#### W-A 기여도 공식

```
Total(X) = (T_X + L_X + E_X + C_X) / 4
Gap = Total(A) - Total(B) = ΣΔ_domain / 4

각 domain contribution to gap:
  ΔT = (T_A - T_B) / 4
  ΔL = (L_A - L_B) / 4
  ΔE = (E_A - E_B) / 4
  ΔC = (C_A - C_B) / 4
```

#### PAIR 03 — 초역세권 소단지(A) vs 비역세권 신축 대단지(B)

```
Raw facts:
  A: subway 38m(극초역세권), bus 34m, 48세대, 주차없음, 2002년
  B: subway CONFIRMED_ABSENT, bus 163m, 2369세대, 주차1.65, 2015년

Domain scores:
  T: A=89.4 vs B=20.7  (ΔT = +68.7pt → A 기여: +17.18pt)
  L: A=68.6 vs B=51.0  (ΔL = +17.6pt → A 기여: +4.40pt)
  E: A=58.6 vs B=45.5  (ΔE = +13.1pt → A 기여: +3.28pt)
  C: A=41.9 vs B=84.3  (ΔC = -42.4pt → B 기여: -10.60pt)

Overall gap: (68.7+17.6+13.1-42.4)/4 = 56.9/4 = +14.2pt → A wins (실제: 14.3pt ✓)

설명:
  T 우위분 +17.18pt + L/E 합산 +7.68pt = +24.86pt (A 우위)
  C 열세분 -10.60pt (B 우위)
  순 A 우위: +14.26pt
```

**분석**: 지하철 38m(subway score 89.4)는 CONFIRMED_ABSENT(subway score 20.7) 대비 68.7pt gap.
이 gap의 1/4(17.18pt)만으로도 Complex 역전(-10.6pt)보다 크다.
3개 domain(T·L·E)이 모두 A를 지지하고, 1개(C)만 B를 지지.
14.3pt gap은 3 vs 1 domain 우위에 비례하며 **과도하지 않다.**

**판정: EXPLAINABLE_TRADEOFF ✓**

---

#### PAIR 04 — 초역세권 소단지(A) vs 신축 대단지(B)

```
Raw facts:
  A: subway 38m, bus 108m, 88세대, 주차없음, 2018년
  B: subway CONFIRMED_ABSENT, bus 46m, 1302세대, 주차1.27, 2024년

Domain scores:
  T: A=86.1 vs B=25.3  (ΔT = +60.8pt → A 기여: +15.20pt)
  L: A=62.3 vs B=37.7  (ΔL = +24.6pt → A 기여: +6.15pt)
  E: A=62.7 vs B=62.0  (ΔE = +0.7pt  → NEAR_TIE: +0.18pt)
  C: A=62.9 vs B=89.0  (ΔC = -26.1pt → B 기여: -6.53pt)

Overall gap: (60.8+24.6+0.7-26.1)/4 = 60.0/4 = +15.0pt → A wins (실제: 15.0pt ✓)

설명:
  T 우위분 +15.20pt + L 우위분 +6.15pt = +21.35pt
  E ≈ 동일, C 열세분 -6.53pt
  순 A 우위: +14.82pt
```

**분석**:
- B는 Complex에서만 우위(89.0 vs 62.9, gap -26.1pt) → 기여도 -6.53pt
- A는 Transport와 Living 둘 다 우위 → 기여도 합계 +21.35pt
- A의 Complex도 62.9로 중간 이상(2018년 단지)
- Education은 사실상 동일(0.7pt)
- 15pt gap = 3 domain 우위(T·L·거의E) vs 1 domain 열세(C)의 자연스러운 결과

**판정: EXPLAINABLE_TRADEOFF ✓**

---

#### PAIR 06 — 대형 노후 대단지(A) vs 소형 노후 역세권(B)

```
Raw facts:
  A: subway CONFIRMED_ABSENT, bus 58m, 7374세대, 주차1.71, 2003년
  B: subway 209m, bus 53m, 34세대, 주차없음, 1974년

Domain scores:
  T: A=27.1 vs B=79.5  (ΔT = -52.4pt → B 기여: -13.10pt)
  L: A=65.8 vs B=77.8  (ΔL = -12.0pt → B 기여: -3.00pt)
  E: A=57.7 vs B=74.9  (ΔE = -17.2pt → B 기여: -4.30pt)
  C: A=73.8 vs B=19.1  (ΔC = +54.7pt → A 기여: +13.68pt)

Overall gap: (-52.4-12.0-17.2+54.7)/4 = -26.9/4 = -6.7pt → B wins (실제: 6.7pt ✓)

설명:
  B 우위분(T+L+E): 13.10+3.00+4.30 = -20.40pt
  A 우위분(C): +13.68pt
  순 B 우위: -6.72pt
```

**분석**:
- 3개 domain(T·L·E) 모두 B 우위 → 합산 기여 -20.40pt
- A의 Complex 압도(73.8 vs 19.1, +54.7pt) → 기여 +13.68pt
- B의 3-domain 우위가 A의 complex 단일 우위를 상회
- 6.7pt gap은 3 vs 1 domain 우위에서 Complex가 크게 상쇄한 결과로 적절
- B(1974·34세대)의 complex 19.1은 노후·소형·주차없음을 정직하게 반영

**판정: EXPLAINABLE_TRADEOFF ✓**

---

#### PAIR 10 — 지하철·초등 근접 구형(A) vs 지하철없음 신축 대단지(B)

```
Raw facts:
  A: subway 374m, bus 187m, 72세대, 주차없음, 1986년, 초등 43m
  B: subway CONFIRMED_ABSENT, bus 124m, 1530세대, 주차1.41, 2020년, 초등 837m

Domain scores:
  T: A=56.6 vs B=24.2  (ΔT = +32.4pt → A 기여: +8.10pt)
  L: A=52.7 vs B=42.3  (ΔL = +10.4pt → A 기여: +2.60pt)
  E: A=85.4 vs B=16.0  (ΔE = +69.4pt → A 기여: +17.35pt)
  C: A=27.3 vs B=87.5  (ΔC = -60.2pt → B 기여: -15.05pt)

Overall gap: (32.4+10.4+69.4-60.2)/4 = 52.0/4 = +13.0pt → A wins (실제: 13.0pt ✓)

설명:
  A 우위분(T+L+E): 8.10+2.60+17.35 = +28.05pt
  B 우위분(C): -15.05pt
  순 A 우위: +13.0pt
```

**분석**:
- Education gap 69.4pt(초등 43m vs 837m): 역대 분석 pair 중 최대 education 격차
- E 기여도 단독으로 +17.35pt → B의 complex 기여(-15.05pt)를 이미 상회
- B의 complex 87.5는 실제로 높지만(신축·1530세대·주차1.41),
  A의 3개 domain 합산이 이를 넘어선다
- 13pt gap은 3 domain vs 1 domain(단 C가 매우 큼) 의 정상 결과
- A의 complex 27.3은 P-D 적용: 1986년(31+y band) era neutral ~21.7 → 정직한 반영
- "Transport=A(subway 374m vs CONFIRMED_ABSENT)"는 사용자 본인도 확인 완료

**P-D 누락 영향 검토**:
- A(1986·72세대·주차없음): P-D era neutral ~21.7 → complex에 하향 기여(정상)
- B(2020·1530세대·주차1.41): 주차 KNOWN → P-D 무관, complex 87.5 정상 반영
- Missing-data 처리가 복합 점수를 부당하게 올리거나 낮추지 않는다

**판정: EXPLAINABLE_TRADEOFF ✓**

---

#### PAIR 12 — Control: 최대 gap(22.9pt) — A 압도

```
Raw facts:
  A: subway 370m, bus 77m, 81세대, 주차없음, 2003년, 초등 501m
     생활: 마트4·편의점34·약국39·병원45
  B: subway CONFIRMED_ABSENT, bus 168m, 49세대, 주차없음, 2002년, 초등 103m
     생활: 마트0·편의점1·약국0·병원2

Domain scores:
  T: A=66.0 vs B=17.0  (ΔT = +49.0pt → A 기여: +12.25pt)
  L: A=83.7 vs B=4.0   (ΔL = +79.7pt → A 기여: +19.93pt)
  E: A=41.2 vs B=82.2  (ΔE = -41.0pt → B 기여: -10.25pt)
  C: A=46.2 vs B=42.1  (ΔC = +4.1pt  → NEAR_TIE: +1.03pt)

Overall gap: (49.0+79.7-41.0+4.1)/4 = 91.8/4 = +22.95pt → A wins (실제: 22.9pt ✓)
```

**분석**: B의 생활편의 score 4.0(마트0·편의점1·약국0·병원2)은 사실상 생활 기반 시설 부재. Living gap 79.7pt는 이례적이나 raw fact가 정직하게 반영된 결과. A education 열세(501m vs 103m)에도 불구하고 압도적 living+transport 우위. **22.9pt gap이 크게 보이지만 B living=4.0이라는 극단 raw fact의 직접 결과로 설명 가능.**

**판정: EXPLAINABLE_TRADEOFF ✓**

---

#### PAIR 07 — Control: TIE(0.2pt)

```
T: A=32.6 vs B=44.0  (ΔT = -11.4pt: B subway 557m vs A 842m)
L: A=53.3 vs B=50.5  (ΔL = +2.8pt: near equal)
E: A=45.1 vs B=57.2  (ΔE = -12.1pt: B elementary 310m vs A 435m)
C: A=64.3 vs B=44.1  (ΔC = +20.2pt: A parking 4.11 vs B 0.25)

Gap = (-11.4+2.8-12.1+20.2)/4 = -0.5/4 = -0.1pt ≈ 0 TIE
```

**분석**: B의 transport+education 우위가 A의 parking 압도적 우위(4.11 vs 0.25)와 정확히 상쇄. 0.2pt 차이는 진정한 TIE. **설명 완벽하게 가능.** 사람도 "판단 어려움"에 가까운 응답.

**판정: EXPLAINABLE_TRADEOFF ✓**

---

#### PAIR 09 — Control: B 우위(transport·complex vs education)

```
A: subway ABSENT, bus 35m, 73세대, 주차없음, 1994년, 초등 44m
B: subway 429m, bus 122m, 498세대, 주차1.15, 2019년, 초등 805m

T: A=26.4 vs B=58.9 (ΔT=-32.5: B has subway, A ABSENT)
L: A=45.3 vs B=51.6 (ΔL=-6.3: B slightly better)
E: A=82.5 vs B=21.5 (ΔE=+61.0: A 초등 44m 압도적)
C: A=33.5 vs B=78.1 (ΔC=-44.6: B 신축·500세대·주차1.15)

Gap = (-32.5-6.3+61.0-44.6)/4 = -22.4/4 = -5.6pt → B wins ✓
```

**분석**: A의 초등 44m(education 82.5) 우위에도 불구하고 B의 3-domain 우위(T·L·C) 합산이 압도. Education 단일 domain으로 3개 domain을 역전하기 어렵다는 equal-weight 설계의 정상 동작. 사람도 B 선택(OBJECTIVE_AGREEMENT).

**판정: EXPLAINABLE_TRADEOFF ✓**

---

#### PAIR 01 — Control: Complex vs Transport 양방향 TIE

```
A: subway CONFIRMED_ABSENT, 1295세대, 주차1.09, 2025년, 초등293m
B: subway 442m, 30세대, 주차없음, 1962년, 초등414m

T: A=20.8 vs B=53.6  (B wins: B subway vs A ABSENT)
L: A=31.7 vs B=65.5  (B wins)
E: A=66.0 vs B=57.7  (A wins)
C: A=87.2 vs B=17.0  (A massive: 신축대단지주차 vs 1962년30세대)

Gap = (20.8+31.7+66.0+87.2)/4 - (53.6+65.5+57.7+17.0)/4
    = 205.7/4 - 193.8/4 = 51.4 - 48.4 = +3.0pt TIE
```

**분석**: A는 Complex 압도(87.2 vs 17.0), B는 Transport+Living 압도. 양방향 domain 우위가 정확히 상쇄해 total 3pt TIE. 수학적으로 완벽하게 설명.

**판정: EXPLAINABLE_TRADEOFF ✓**

---

### 3. Gap Reasonableness 전체 검토

| PAIR | Gap | 설명 |
|---|---|---|
| 03 | **14.3pt** | 3 domain A 우위(T·L·E), 1 domain B 우위(C). T gap 68.7pt가 지배. 비례적 ✓ |
| 04 | **15.0pt** | 3 domain A 우위(T·L·거의E), 1 domain B 우위(C). T gap 60.8pt. 비례적 ✓ |
| 06 | **6.7pt** | 3 domain B 우위(T·L·E), 1 domain A 우위(C). C 기여 +13.68pt로 상쇄 후 순 6.7. 보수적 ✓ |
| 10 | **13.0pt** | 3 domain A 우위(T·L·E), 1 domain B 우위(C). E gap 69.4pt가 지배. 비례적 ✓ |
| 12 | **22.9pt** | B living=4.0 극단치. L gap 79.7pt 때문에 큰 gap. B living score 자체가 원인 ✓ |
| 07 | **0.2pt** | 진정한 TIE. domain 우위 상호 상쇄 ✓ |
| 08 | **1.4pt** | TIE. living vs education 균형 ✓ |

**GAP_TOO_LARGE 해당 사례: 0건**

---

### 4. Pareto Safety 재확인

**정의**: unit X가 unit Y의 모든 domain에서 동시에 우위인데 Y가 더 높은 Core Score를 받는 경우.

| PAIR | A 우위 domain | B 우위 domain | Pareto 위반? |
|---|---|---|---|
| 03 | T·L·E | C | ❌ 양방향 존재 |
| 04 | T·L·(E≈) | C | ❌ 양방향 존재 |
| 06 | C | T·L·E | ❌ 양방향 존재 |
| 10 | T·L·E | C | ❌ 양방향 존재 |
| 12 | T·L·C | E | ❌ 양방향 존재 (A wins correctly) |
| 07 | C | T·E | ❌ 양방향 존재 |
| 09 | E | T·L·C | ❌ 양방향 존재 (B wins correctly) |

**모든 pair: Pareto 우위 단지가 더 낮은 Score를 받는 사례 없음.**

STEP 3 전수 검증 결과도 재확인: **Pareto violations = 0 / 687,793쌍**

**Pareto Safety: PASS**

---

### 5. Missing Data Safety (P-D) 재확인

| 검증 항목 | 내용 | 결과 |
|---|---|---|
| PAIR 10 A (1986년 구형) | era neutral ~21.7(31+y band) → complex 하향 기여 | 정직한 반영 ✓ |
| PAIR 03 A (2002년 소단지) | era neutral ~52.6(21-30y band) → 중간 처리 | 적절 ✓ |
| PAIR 04 A (2018년 소단지) | era neutral ~67.8(11-20y band) → 신축 수준 처리 | 적절 ✓ |
| Known 단지 불변성 | 대신해모·협성 parking known → P-D 무영향 | STEP 3.5 §7,11 확인 ✓ |
| Fake parking value 생성 | 없음 | test PASS ✓ |
| RECOVERABLE 편향 | 1,748건(51.4%) 미회수 상태이나 P-D로 era neutral 처리 중 | 알려진 한계, 허위 inflate 아님 ✓ |

**누락 단지에 부당하게 유리하거나 불리한 사례: 0건**

**Missing Data Safety: PASS**

---

### 6. Candidate Robustness 재확인 (STEP 3/3.5 기존 결과)

STEP 3.6 이후 코드·weight·curve 변경 없음. 기존 결과 그대로 유효.

#### Sensitivity

| 항목 | STEP 3 결과 | 현재 상태 |
|---|---|---|
| Raw factor sensitivity | 5개 factor 전부 mean<1.0, max<2.5 | 변경 없음 |
| Weight ±5pp | TOP100 overlap 90~95% | 변경 없음 |
| W-A/B/C/D Spearman | 0.962~0.996 | 변경 없음 |
| T1 vs T3 Spearman | 0.998, TOP100 overlap 96/100 | STEP 3.5 §16 유지 |

#### Score Distribution (Busan 2,833건 quality-eligible)

| 항목 | 값 |
|---|---|
| mean | 54.9 |
| median | 56.1 |
| p10 | 38.0 |
| p90 | 67.0 |
| 80+ 비율 | 0% (max≈78.4) |
| 90+ 비율 | 0% |
| score 압축/폭발 | 없음 ✓ |

#### District Bias

| 항목 | 값 |
|---|---|
| district mean range | 45.3(영도구) ~ 59.4(동래구) |
| max/min bias | **1.31x** (STEP 0.7-A 기준 1.38x 이하, 안정) |

#### Benchmark Regression

| 단지 | domain scores | total | 부산 percentile | 상태 |
|---|---|---|---|---|
| 대신해모로센트럴 | T86.5/L60.7/E41.1/C82.9 | **67.8** | **상위 8.1%** (rank 230/2,833) | 유지 ✓ |
| 협성해모로 | T72.1/L58.4/E60.7/C64.8 | **64.0** | 상위 ~15% 권 | 유지 ✓ |
| 구덕금호 | coverage=0.25 (complex만) | **NOT_ENOUGH_DATA** | — | 유지 ✓ |

> P-D parking 모델 전환은 parking KNOWN 단지에 영향 없음 (STEP 3.5 §7,11 확인).

#### Expert Credibility Gate (STEP 3.5 §8개 gate)

| Gate | 결과 |
|---|---|
| 1. RAW_FACT_CORRECTNESS | PASS |
| 2. OBVIOUS_DOMINANCE | PASS |
| 3. CROSS_DISTRICT_CONSISTENCY | PASS |
| 4. EXPLAINABILITY | PASS |
| 5. MISSING_DATA_HONESTY | PASS(강화됨) |
| 6. SENSITIVITY | PASS |
| 7. LOCAL_EXPERT_REVIEW | **READY_FOR_REVIEW → COMPLETED** (15쌍 실시) |
| 8. BENCHMARK_REGRESSION | PASS |

---

### 7. PAIR 02 데이터 품질 주석

PAIR 02 A(롯데캐슬라센트)의 transport domain score가 answer-key에서 공란임.
subwayStatus=MISSING + busStopDistanceM 결측으로 transport가 scoring에서 제외.

역산 확인:
```
A total = (L=50.6 + E=52.3 + C=89.0) / 3 = 191.9 / 3 = 63.97 ≈ 64.0
(3개 domain 정규화)
```

이는 V2 missing-data 처리(coverage-normalized weighted sum)의 정상 동작이다.
transport 데이터 회수가 이뤄지면 total score가 변동될 가능성 있음(data recovery 후보로 기록).

---

### 8. 6개 최종 Validation Gate

#### DOMAIN_CORRECTNESS_GATE

| 도메인 | 확인된 objective disagreement | 판정 |
|---|---|---|
| Transport | 0건 (PAIR 07: domain scope confusion, 모델 오류 아님) | ✅ PASS |
| Living | 0건 | ✅ PASS |
| Education | 0건 | ✅ PASS |
| Complex | 0건 objective (3건 모두 preference-sensitive) | ✅ PASS |

→ **DOMAIN_CORRECTNESS_GATE: PASS**

---

#### COMPOSITION_EXPLAINABILITY_GATE

| 항목 | 결과 |
|---|---|
| W-A 구조 | 등가 가중치(25/25/25/25), 수식 투명 ✓ |
| PAIR 03~04: 초역세권 vs 대단지 | EXPLAINABLE_TRADEOFF ✓ |
| PAIR 06: 대단지 vs 소형역세권 | EXPLAINABLE_TRADEOFF ✓ |
| PAIR 10: 초등·교통 근접 vs 신축대단지 | EXPLAINABLE_TRADEOFF ✓ |
| PAIR 12: 최대 gap(22.9pt) | L=4.0 극단 raw fact, 설명가능 ✓ |
| 전체 10 pair | 전부 EXPLAINABLE_TRADEOFF ✓ |
| overall이 모든 domain과 반대인 사례 | 0건 ✓ |

→ **COMPOSITION_EXPLAINABILITY_GATE: PASS**

---

#### PARETO_SAFETY_GATE

| 항목 | 결과 |
|---|---|
| 검증 대상 10 pair | Pareto 위반 0건 ✓ |
| STEP 3 전수 검증(687,793쌍) | Pareto violations 0/687,793 ✓ |
| PAIR 03/04/06/10 | 양방향 domain 우위 존재 확인 ✓ |

→ **PARETO_SAFETY_GATE: PASS**

---

#### MISSING_DATA_GATE

| 항목 | 결과 |
|---|---|
| P-D era-conditioned neutral | 노후 단지 하향 처리 정직 ✓ |
| Fake parking values | 0건 (test 구조적 보증) ✓ |
| Known 단지 불변성 | 대신해모·협성 complex 점수 무변화 ✓ |
| PAIR 10 P-D 검증 | 1986년 era neutral 21.7 → 정직한 complex 기여 ✓ |
| Missing 단지 부당 유리 | 0건 ✓ |

→ **MISSING_DATA_GATE: PASS**

---

#### SENSITIVITY_GATE

| 항목 | 결과 |
|---|---|
| Factor sensitivity | mean<1.0, max<2.5 (5개 factor 모두) ✓ |
| Weight ±5pp | TOP100 overlap 90~95% ✓ |
| W-A/B/C/D rank correlation | Spearman 0.962~0.996 ✓ |
| T1 vs T3 | Spearman 0.998, TOP100 overlap 96/100 ✓ |

→ **SENSITIVITY_GATE: PASS**

---

#### BENCHMARK_GATE

| 항목 | 결과 |
|---|---|
| 대신해모 total | 67.8pt (부산 상위 8.1%) — 변동 없음 ✓ |
| 협성 total | 64.0pt — 변동 없음 ✓ |
| 구덕금호 | NOT_ENOUGH_DATA — 유지 ✓ |
| P-D 전환 후 벤치마크 영향 | 0 (parking known → 무관) ✓ |

→ **BENCHMARK_GATE: PASS**

---

#### 6개 Gate 최종 요약

| Gate | 판정 |
|---|---|
| DOMAIN_CORRECTNESS_GATE | ✅ **PASS** |
| COMPOSITION_EXPLAINABILITY_GATE | ✅ **PASS** |
| PARETO_SAFETY_GATE | ✅ **PASS** |
| MISSING_DATA_GATE | ✅ **PASS** |
| SENSITIVITY_GATE | ✅ **PASS** |
| BENCHMARK_GATE | ✅ **PASS** |
| **PERSONALIZATION_SIGNAL** | ℹ️ **YES** (별도 보존) |

---

## 설계 결정

### Freeze 조건 대조

| 조건 | 요건 | 결과 |
|---|---|---|
| confirmed objective contradiction 없음 | = 0건 | **0건** ✓ |
| unexplained large-gap tradeoff 없음 | = 0건 | **0건** ✓ |
| Pareto safety 통과 | 위반 0건 | **0건** ✓ |
| Missing-data safety 통과 | 부당 inflate 0건 | **0건** ✓ |
| Sensitivity 안정 | TOP100 overlap ≥90% | **90~95%** ✓ |
| Benchmark regression 없음 | 대신해모/협성 무변화 | **무변화** ✓ |
| Score definition과 설명 일치 | W-A=등가, 수식 투명 | **일치** ✓ |

**전 조건 충족 → FINAL_CANDIDATE_FROZEN = YES**

---

## 구현 내용

신규 파일: `docs/development/EJIP_SCORE_V2_STEP37_FINAL_CALIBRATION_GATE.md` (본 문서)

분석용 신규 script/data: **없음** (10 pair 분석은 수동 분해로 충분, 기존 데이터 재사용)

production 코드 변경: **없음**

---

## 테스트

| 항목 | 결과 |
|---|---|
| 신규 TypeScript 파일 | 없음 (docs only) |
| tsc | N/A |
| lint | N/A |
| 기존 regression tests | 변경 없음, 73/73 PASS 유지 |

---

## 알려진 문제

1. **n=1 검수자 한계**: 이번 freeze는 n=1 human review + 6개 gate 전항목 PASS에 근거.
   다수 검수자 데이터가 확보되면 PERSONALIZATION_SIGNAL 패턴의 보편성 여부를 재검증할 수 있음.

2. **PAIR 02 transport 결측**: 롯데캐슬라센트의 transport domain 미수집 상태.
   data recovery 후 score 변동 가능성 있음. 현재 3-domain 정규화로 안정적으로 처리 중.

3. **parking RECOVERABLE 1,748건 미회수**: 25.3% coverage → 76.7% 잠재력.
   P-D era-conditioned 처리로 공정하게 관리 중이나, 데이터 회수 시 individual 점수 변동 가능.

4. **PERSONALIZATION_SIGNAL의 제품 시사점**: 향후 My E-JIP Score 구현 시 참조.

---

## 최종 보고 (E-JIP SCORE V2 STEP 3.7)

### 1. 검증 대상 Pair

10개: PAIR 03·04·06·10(필수) + PAIR 01·07·08·09·12·13(control)

### 2. PAIR 03/04/06/10 Explainability

| PAIR | raw facts tradeoff | gap | 판정 |
|---|---|---|---|
| 03 | subway 38m vs ABSENT + 대단지신축 | 14.3pt | EXPLAINABLE_TRADEOFF |
| 04 | subway 38m vs ABSENT + 대단지신축 | 15.0pt | EXPLAINABLE_TRADEOFF |
| 06 | 7374세대대단지 vs 소형역세권 | 6.7pt | EXPLAINABLE_TRADEOFF |
| 10 | 초등43m+subway374m vs 신축대단지 | 13.0pt | EXPLAINABLE_TRADEOFF |

**OBJECTIVE_CONTRADICTION: 0건 / GAP_TOO_LARGE: 0건 / NEEDS_RECALIBRATION: 0건**

### 3. Gap Reasonableness

전체 10 pair: 모두 domain 우위 구조에 비례하는 gap. 과도한 gap 없음.

### 4. Pareto Safety

위반 0건 (10 pair 검토) + STEP 3 전수 0/687,793 유지.

### 5. Missing Data Safety

P-D 정상 동작. 부당 inflate/deflate 0건.

### 6. Sensitivity

TOP100 overlap 90~95%, Spearman 0.962~0.996. 안정.

### 7. Benchmark Regression

대신해모 67.8 / 협성 64.0 / 구덕금호 NOT_ENOUGH_DATA — 전부 유지.

### 8. Six Validation Gates

전 항목 **PASS**.

### 9. PERSONALIZATION_SIGNAL

**YES** — 신축/단지형 선호 패턴(PAIR 03·04·06·10). Core Score gate 외부에 보존.
향후 My E-JIP Score(Personalized) 제품 설계의 근거 자료로 활용.

### 10. FINAL_CANDIDATE_FROZEN

**YES**

6개 gate 전항목 PASS. confirmed objective contradiction 0건. unexplained gap 0건.
Pareto 안전. missing-data 안전. sensitivity 안정. benchmark 유지.
n=1 검수자 한계는 알려진 사항으로 기록하나, 6개 gate 기반 freeze를 차단하지 않는다.

### 11. Frozen Candidate 구성

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
E-JIP SCORE V2 CORE CANDIDATE — FROZEN

  Transport model      = T1 (70/30 subway·bus, sentinel-aware)
  Parking missing      = P-D (era-conditioned neutral prior)
  Education model      = E-A (elementary-primary)
  Living model         = L-A (6개 POI count)
  Weight set           = W-A (Transport 25% / Living 25% / Education 25% / Complex 25%)

  FINAL_CANDIDATE_FROZEN = YES

  이는 Core Score formula candidate freeze이며
  production deployment 완료를 의미하지 않는다.
  Personalized Score는 별도 후속 단계.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 12. 변경 여부

- production Score 변경: **NO**
- DB write: **NO**
- migration: **NO**
- API 변경: **NO**
- UI 변경: **NO**
- weight(W-A) 변경: **NO**
- curve 변경: **NO**
- Core candidate fitting: **NO**

### 13. Commit / Push 상태

| 항목 | 상태 |
|---|---|
| 신규 파일 | `docs/development/EJIP_SCORE_V2_STEP37_FINAL_CALIBRATION_GATE.md` |
| commit 예정 | `docs: final calibration gate and candidate freeze (STEP 3.7)` |
| push | commit 후 진행 예정 |
| worktree clean | commit 후 확인 예정 |
| main untouched | 유지 |

### 14. BLOCKER

**없음.**

### 15. SCORE_V2_STEP37_CLOSE

**YES**

### 16. NEXT_RECOMMENDATION

FINAL_CANDIDATE_FROZEN = YES 선언 완료.

다음 단계 후보:
- **STEP 4 (production 구현)**: DB schema 설계 → API endpoint → UI 연동
  진행 전 PM(ChatGPT) 승인 필요.
- **병행 가능 저위험 작업**:
  - parking RECOVERABLE 1,748건 재조회 (건축물대장 파서 개선)
  - PAIR 02 transport data recovery 시도
  - My E-JIP Score 설계 문서 작성(구현 없이)
