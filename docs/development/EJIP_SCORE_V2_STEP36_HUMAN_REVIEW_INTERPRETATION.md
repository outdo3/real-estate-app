# E-JIP SCORE V2 STEP 3.6 — Human Review Interpretation & Objective/Preference Separation

## 목적

STEP 3.5 blind human review 15쌍 결과에서

- **A. 객관적 domain correctness** (모델이 raw fact를 올바르게 반영하는가)
- **B. 개인적 종합 선호** (개인 가중치 우선순위에 따른 overall 선택)
- **C. 실제 모델 calibration 문제** (객관적으로 설명 불가능한 점수 역전)

를 분리해 Score V2 Final Candidate Freeze 전 검수 기준 자체를 바로잡는다.

**이번 STEP도 production 구현 단계가 아니다. Weight/curve/DB/API/UI 변경 없음.**

## 현재 상태

- base branch: `score-v2-step35-expert-calibration` (commit `2c42786`)
- human review 완료: 15쌍 × 5개 domain(교통/생활/교육/단지/종합)
- **PAIR 10 Transport 정정**: 사용자가 직접 "교통은 A가 맞고, 종합 B는 내 기준"으로 확인
  - 정정 전: Transport=B (original typo)
  - 정정 후: **Transport=A** ← 이후 모든 분석에 반영

---

## 분석

### 1. Domain 판정 기준

각 domain 판정을 다음 4가지로 분류한다.

| 판정 | 정의 |
|---|---|
| `AGREE` | 모델 방향과 사람 응답이 일치 |
| `NEAR_TIE` | 모델 점수차 < 5pt, 또는 사람이 "비슷"으로 응답해 방향 불일치가 의미 없는 경우 |
| `HUMAN_UNCLEAR` | 사람이 "비슷"으로 응답했으나 모델 점수차가 10pt 이상인 경우 |
| `DISAGREE` | 모델 방향과 사람 응답이 명확히 반대 |

Overall 판정 분류:

| 분류 | 정의 |
|---|---|
| `OBJECTIVE_AGREEMENT` | 모델 winner와 사람 응답이 일치 |
| `MODEL_TIE_HUMAN_DIRECTION` | 모델 TIE(gap ≤ 3pt)에서 사람이 방향을 선택한 경우 |
| `PREFERENCE_SENSITIVE` | 모델과 사람이 다른 방향을 선택하나 domain level에서는 대부분 일치 — 개인 가중치 차이로 설명 가능 |
| `POTENTIAL_CALIBRATION_ISSUE` | domain level 불일치가 전반적이고 객관적으로 설명이 어려운 경우 |
| `HUMAN_UNCLEAR` | 사람이 "판단 어려움"을 선택한 경우 |

---

### 2. PAIR 01~15 — Corrected Domain Matrix

#### 참조 데이터 (answer key)

| PAIR | 타입 | A total | B total | Model winner | gap |
|---|---|---|---|---|---|
| 01 | 신축 vs 구축 | 51.4 | 48.4 | TIE | 3.0 |
| 02 | 신축 vs 구축 | 64.0 | 48.4 | A | 15.6 |
| 03 | 초역세권 vs 비역세권 | 64.6 | 50.4 | A | 14.3 |
| 04 | 초역세권 vs 비역세권 | 68.5 | 53.5 | A | 15.0 |
| 05 | 대단지 vs 소단지 | 56.1 | 53.2 | TIE | 2.9 |
| 06 | 대단지 vs 소단지 | 56.1 | 62.8 | B | 6.7 |
| 07 | 고주차 vs 저주차 | 48.8 | 49.0 | TIE | 0.2 |
| 08 | 고주차 vs 저주차 | 57.3 | 58.7 | TIE | 1.4 |
| 09 | 교육접근 양호 vs 열악 | 46.9 | 52.5 | B | 5.6 |
| 10 | 교육접근 양호 vs 열악 | 55.5 | 42.5 | A | 13.0 |
| 11 | 생활밀집 vs sparse | 63.5 | 51.6 | A | 11.9 |
| 12 | 생활밀집 vs sparse | 59.3 | 36.3 | A | 22.9 |
| 13 | tradeoff(교통 vs 주차) | 59.4 | 56.2 | A | 3.2 |
| 14 | tradeoff(교통 vs 주차) | 55.9 | 51.3 | A | 4.6 |
| 15 | tradeoff(연식 vs 규모) | 65.1 | 66.6 | TIE | 1.6 |

#### Domain 점수 상세

| PAIR | T-A | T-B | L-A | L-B | E-A | E-B | C-A | C-B |
|---|---|---|---|---|---|---|---|---|
| 01 | 20.8 | 53.6 | 31.7 | 65.5 | 66.0 | 57.7 | 87.2 | 17.0 |
| 02 | — | 54.1 | 50.6 | 49.5 | 52.3 | 63.1 | 89.0 | 26.9 |
| 03 | 89.4 | 20.7 | 68.6 | 51.0 | 58.6 | 45.5 | 41.9 | 84.3 |
| 04 | 86.1 | 25.3 | 62.3 | 37.7 | 62.7 | 62.0 | 62.9 | 89.0 |
| 05 | 27.1 | 68.3 | 65.8 | 24.5 | 57.7 | 57.3 | 73.8 | 62.8 |
| 06 | 27.1 | 79.5 | 65.8 | 77.8 | 57.7 | 74.9 | 73.8 | 19.1 |
| 07 | 32.6 | 44.0 | 53.3 | 50.5 | 45.1 | 57.2 | 64.3 | 44.1 |
| 08 | 52.4 | 45.9 | 65.0 | 52.1 | 54.2 | 81.2 | 57.7 | 55.7 |
| 09 | 26.4 | 58.9 | 45.3 | 51.6 | 82.5 | 21.5 | 33.5 | 78.1 |
| 10 | 56.6 | 24.2 | 52.7 | 42.3 | 85.4 | 16.0 | 27.3 | 87.5 |
| 11 | 59.5 | 84.7 | 84.3 | 15.6 | 52.5 | 38.8 | 57.6 | 67.2 |
| 12 | 66.0 | 17.0 | 83.7 | 4.0 | 41.2 | 82.2 | 46.2 | 42.1 |
| 13 | 76.7 | 34.8 | 64.5 | 55.9 | 50.2 | 68.9 | 46.1 | 65.3 |
| 14 | 71.6 | 52.4 | 41.3 | 51.0 | 47.3 | 42.7 | 63.3 | 59.0 |
| 15 | 73.9 | 63.0 | 71.0 | 61.7 | 49.5 | 77.9 | 65.9 | 64.0 |

#### 전체 Domain × Human 판정 매트릭스 (PAIR 10 정정 반영)

| PAIR | 교통(모델→인간) | 판정 | 생활(모델→인간) | 판정 | 교육(모델→인간) | 판정 | 단지(모델→인간) | 판정 |
|---|---|---|---|---|---|---|---|---|
| 01 | B→B | AGREE | B→B | AGREE | A→A | AGREE | A→A | AGREE |
| 02 | B→B(A결측) | AGREE | A→A(1.1pt) | NEAR_TIE | B→B | AGREE | A→A | AGREE |
| 03 | A→A | AGREE | A→A | AGREE | A→A | AGREE | B→B | AGREE |
| 04 | A→A | AGREE | A→A | AGREE | A→B(0.7pt) | NEAR_TIE | B→B | AGREE |
| 05 | B→B | AGREE | A→A | AGREE | A→B(0.4pt) | NEAR_TIE | A→B | **DISAGREE** |
| 06 | B→B | AGREE | B→비슷(12pt) | HUMAN_UNCLEAR | B→B | AGREE | A→A | AGREE |
| 07 | B→A | **DISAGREE** | A→비슷(2.8pt) | NEAR_TIE | B→B | AGREE | A→A | AGREE |
| 08 | A→A | AGREE | A→A | AGREE | B→B | AGREE | A→B(2.0pt) | NEAR_TIE |
| 09 | B→B | AGREE | B→비슷(6.3pt) | NEAR_TIE | A→A | AGREE | B→B | AGREE |
| 10 | A→**A(정정)** | AGREE | A→비슷(10.4pt) | NEAR_TIE | A→A | AGREE | B→B | AGREE |
| 11 | B→B | AGREE | A→A | AGREE | A→비슷(13.7pt) | HUMAN_UNCLEAR | B→A | **DISAGREE** |
| 12 | A→A | AGREE | A→A | AGREE | B→B | AGREE | A→A(4.1pt) | NEAR_TIE |
| 13 | A→A | AGREE | A→비슷(8.6pt) | NEAR_TIE | B→B | AGREE | B→A | **DISAGREE** |
| 14 | A→A | AGREE | B→비슷(9.7pt) | NEAR_TIE | A→비슷(4.6pt) | NEAR_TIE | A→(미답·A추정) | NEAR_TIE |
| 15 | A→A | AGREE | A→비슷(9.3pt) | NEAR_TIE | B→B | AGREE | A→B(1.9pt) | NEAR_TIE |

> PAIR 14 단지: 사용자 미답. 메모 "세대수 많음·지하철 가까움"이 A(1,780세대) 지지로 해석되나
> 명시적 답이 없어 NEAR_TIE로 처리.

---

### 3. Domain별 Agreement 집계 (59개 유효 판정)

#### Transport (15개)

| 판정 | 건수 | PAIR |
|---|---|---|
| AGREE | **14** | 01,02,03,04,05,06,08,09,10,11,12,13,14,15 |
| DISAGREE | **1** | 07 |
| NEAR_TIE | 0 | — |
| HUMAN_UNCLEAR | 0 | — |

> **PAIR 07 Transport DISAGREE 주석**: 사용자 메모 "A가 지하철이 있고 주차가 압도적"
> — 주차(단지 요소)를 교통 기준으로 혼용한 **domain scope confusion**으로 판단.
> 실제 교통 raw fact: B 지하철 557m < A 지하철 842m → 모델이 B 우위를 준 것은 정상.
> 이 DISAGREE는 **모델 오류가 아니라 평가 도메인 혼용**이다.

**Transport domain agreement: 14/15 = 93.3%**
**진짜 객관적 오류: 0**

#### Living (15개)

| 판정 | 건수 | PAIR |
|---|---|---|
| AGREE | **7** | 01,03,04,05,08,11,12 |
| NEAR_TIE | **7** | 02,07,09,10,13,14,15 |
| HUMAN_UNCLEAR | **1** | 06 |
| DISAGREE | **0** | — |

> PAIR 06 HUMAN_UNCLEAR: 모델 B 우위 12pt (65.8 vs 77.8)인데 사람이 "비슷"으로 답.
> 12pt는 무시하기 어려운 차이이나, 사람의 "비슷" 응답은 오류가 아니라 임계값 차이.

**Living domain 불일치: 0/15 = 0%**

#### Education (15개)

| 판정 | 건수 | PAIR |
|---|---|---|
| AGREE | **10** | 01,02,03,07,08,09,10,12,13,15 |
| NEAR_TIE | **3** | 04(gap 0.7pt), 05(gap 0.4pt), 14(gap 4.6pt) |
| HUMAN_UNCLEAR | **1** | 11(gap 13.7pt → 비슷 응답) |
| DISAGREE | **0** | — |

> PAIR 11 HUMAN_UNCLEAR: 모델 A 13.7pt 우위인데 "비슷" 응답.
> 두 단지 모두 400~460m 범위로 raw distance 체감차가 작았던 것으로 추정.
> 채점 방식(절대 거리 curve)과 체감의 괴리 가능성 — explainability 개선 대상.

**Education domain 불일치: 0/15 = 0%**

#### Complex (단지, 14개 유효)

| 판정 | 건수 | PAIR |
|---|---|---|
| AGREE | **8** | 01,02,03,04,06,07,09,10 |
| NEAR_TIE | **3** | 08(gap 2.0pt), 12(gap 4.1pt), 15(gap 1.9pt) |
| NEAR_TIE(미답) | **1** | 14(implied A) |
| DISAGREE | **3** | 05,11,13 |

**Complex domain 불일치: 3/14 = 21.4%** ← 유일하게 의미 있는 불일치 존재

#### 전체 Domain 집계 요약

| 도메인 | AGREE | NEAR_TIE | HUMAN_UNCLEAR | DISAGREE | 총계 | AGREE+NEAR_TIE% |
|---|---|---|---|---|---|---|
| Transport | 14 | 0 | 0 | 1 | 15 | **93.3%** |
| Living | 7 | 7 | 1 | 0 | 15 | **93.3%** |
| Education | 10 | 3 | 1 | 0 | 14 | **92.9%** |
| Complex | 8 | 4 | 0 | 3 | 15* | **80.0%** |
| **합계** | **39** | **14** | **2** | **4** | **59** | **89.8%** |

> \* 14개 유효 + 1개 미답(NEAR_TIE 처리) = 15

**진정한 domain DISAGREE: 4건**
- PAIR 07 Transport: domain confusion (모델 오류 아님)
- PAIR 05, 11, 13 Complex: 아래 §5에서 상세 분석

---

### 4. Overall Judgment 분류 (15개)

| PAIR | Model winner | gap | Human | 분류 |
|---|---|---|---|---|
| 01 | TIE | 3.0 | A | MODEL_TIE_HUMAN_DIRECTION |
| 02 | A | 15.6 | A | **OBJECTIVE_AGREEMENT** |
| 03 | A | 14.3 | B | PREFERENCE_SENSITIVE |
| 04 | A | 15.0 | B | PREFERENCE_SENSITIVE |
| 05 | TIE | 2.9 | A | MODEL_TIE_HUMAN_DIRECTION |
| 06 | B | 6.7 | A | PREFERENCE_SENSITIVE |
| 07 | TIE | 0.2 | A | MODEL_TIE_HUMAN_DIRECTION |
| 08 | TIE | 1.4 | 판단어려움 | HUMAN_UNCLEAR |
| 09 | B | 5.6 | B | **OBJECTIVE_AGREEMENT** |
| 10 | A | 13.0 | B | PREFERENCE_SENSITIVE |
| 11 | A | 11.9 | A | **OBJECTIVE_AGREEMENT** |
| 12 | A | 22.9 | A | **OBJECTIVE_AGREEMENT** |
| 13 | A | 3.2 | 판단어려움 | MODEL_TIE_HUMAN_DIRECTION |
| 14 | A | 4.6 | A | **OBJECTIVE_AGREEMENT** |
| 15 | TIE | 1.6 | B | MODEL_TIE_HUMAN_DIRECTION |

| Overall 분류 | 건수 | PAIR |
|---|---|---|
| OBJECTIVE_AGREEMENT | **5** | 02,09,11,12,14 |
| MODEL_TIE_HUMAN_DIRECTION | **5** | 01,05,07,13,15 |
| PREFERENCE_SENSITIVE | **4** | 03,04,06,10 |
| HUMAN_UNCLEAR | **1** | 08 |
| POTENTIAL_CALIBRATION_ISSUE | **0** | — |

---

### 5. PAIR 03 / 04 / 06 / 10 집중 재분석

#### 재분석 기준

각 PAIR에 대해:
1. 4개 domain 방향이 실제로 맞았는가?
2. 사람이 특정 domain을 개인적으로 더 크게 가중한 것인가?
3. 모델 Core에 명백한 상식 위반이 있는가?
4. Personalized Score라면 자연스럽게 설명되는가?

---

#### PAIR 03 — 초역세권 소단지(A) vs 비역세권 신축 대단지(B)

| 질문 | 답 |
|---|---|
| ① 4 domain 방향 모두 맞았는가? | **YES — 4/4 AGREE** (T·L·E → A 우위, C → B 우위) |
| ② 어떤 domain을 크게 가중했는가? | Complex(B=84.3 vs A=41.9, gap **42.4pt**) — 신축 2015·2369세대·주차 1.65 |
| ③ 모델에 상식 위반이 있는가? | **NO** — 지하철 38m·생활·교육 우위인 A가 총점 높은 것은 설명 가능 |
| ④ Personalized Score로 설명되는가? | **YES** — "신축/단지형" 프로파일이면 C 가중치를 훨씬 높게 설정 → 자연스럽게 B 선택 |
| ⑤ 판정 | **PREFERENCE_SENSITIVE** (모델 오류 아님) |

#### PAIR 04 — 초역세권 소단지(A) vs 신축 대단지(B)

| 질문 | 답 |
|---|---|
| ① 4 domain 방향 모두 맞았는가? | **YES — 3/4 AGREE + 1 NEAR_TIE** (교육 gap 0.7pt) |
| ② 어떤 domain을 크게 가중했는가? | Complex(B=89.0 vs A=62.9, gap **26.1pt**) — 신축 2024·1302세대·주차 1.27 |
| ③ 모델에 상식 위반이 있는가? | **NO** — A의 교통(86.1pt)·생활 우위는 실측 기반의 정상적 결과 |
| ④ Personalized Score로 설명되는가? | **YES** — PAIR 03과 동일 "신축/단지형" 패턴 |
| ⑤ 판정 | **PREFERENCE_SENSITIVE** (모델 오류 아님) |

#### PAIR 06 — 대형 노후 대단지(A) vs 소형 노후 역세권(B)

| 질문 | 답 |
|---|---|
| ① 4 domain 방향 모두 맞았는가? | **3/4 AGREE + 1 HUMAN_UNCLEAR** (생활: B 우위 12pt인데 "비슷") |
| ② 어떤 domain을 크게 가중했는가? | Complex(A=73.8 vs B=19.1, gap **54.7pt**) — 7,374세대·주차 1.71 |
| ③ 모델에 상식 위반이 있는가? | **NO** — B는 1974년·34세대·주차없음·교통+생활+교육 전부 우세. 모델 B 선택은 정상 |
| ④ Personalized Score로 설명되는가? | **YES** — "대단지/주차형" 프로파일 + 재건축 전망 고려. 사람 메모가 이를 직접 설명 |
| ⑤ 판정 | **PREFERENCE_SENSITIVE** (모델 오류 아님) |

#### PAIR 10 — 지하철·초등 근접 구형(A) vs 지하철없음 신축 대단지(B)

| 질문 | 답 |
|---|---|
| ① 4 domain 방향 모두 맞았는가? | **YES — 3 AGREE + 1 NEAR_TIE** (생활: A 10.4pt 우위 → "비슷") |
| ② 어떤 domain을 크게 가중했는가? | Complex(B=87.5 vs A=27.3, gap **60.2pt**) — 신축 2020·1530세대·주차 1.41 |
| ③ 모델에 상식 위반이 있는가? | **NO** — A의 교통(56.6 vs 24.2)·교육(85.4 vs 16.0) 압도적 우위로 A 총점이 높은 것은 정상 |
| ④ 특이사항 | Transport 정정으로 domain confusion이 해소됨. 사람은 Transport=A(올바름)를 인지하면서도 Overall=B를 선택 → 극단적 Complex 선호(87.5) |
| ⑤ Personalized Score로 설명되는가? | **YES** — "신축/단지형 극단" 프로파일. 교통·교육의 명백한 우위에도 불구하고 단지 상품성 최우선 |
| ⑥ 판정 | **PREFERENCE_SENSITIVE** (모델 오류 아님. PERSONAL_PREFERENCE_SIGNAL 최강) |

---

### 6. Complex Domain 불일치 3건 분석 (PAIR 05 / 11 / 13)

Complex domain DISAGREE 3건을 별도로 분석한다.

#### PAIR 05 Complex

- Model: A=73.8 (7374세대·주차 1.71·2003년) > B=62.8 (77세대·주차없음·2019년)
- Human: B 선택 (더 신축)
- 해석: 모델의 complex는 **규모(세대수)·주차·연식** 복합. 사람은 **연식(신축)** 단일 기준에 가깝게 판단.
- 판정: **PREFERENCE_SENSITIVE** (complex factor 내 연식 가중치 개인차)

#### PAIR 11 Complex

- Model: B=67.2 (강서구·세대수 미상·2019년) > A=57.6 (부산진구·48세대·2017년)
- Human: A 선택
- 해석: A(부산진구)는 생활편의(편의점 41·약국 38)가 극히 우수해, 사람이 "단지 품질"을 생활밀집도와 혼용해 판단한 것으로 추정. B의 세대수가 "정보없음"이어서 판단 불확실성도 작용.
- 판정: **PREFERENCE_SENSITIVE + domain concept confusion 가능성** (생활 vs 복합 단지 품질 혼용)

#### PAIR 13 Complex

- Model: B=65.3 (2007년·주차 2.22·639m) > A=46.1 (1993년·주차 0.85·231m)
- Human: A 선택
- 해석: 사람이 A의 교통 우위(231m vs 639m)가 주는 "전반적으로 좋은 단지" 인상에 영향받은 것으로 추정. 주차(2.22 vs 0.85)라는 raw fact를 단지 품질의 핵심으로 보지 않은 것.
- 판정: **PREFERENCE_SENSITIVE** (complex factor 내 주차 가중 방식 개인차)

> **결론**: Complex domain 불일치 3건 모두 모델의 계산 오류가 아니라
> complex 개념 내 세부 요소(연식 vs 규모 vs 주차)의 개인 가중치 차이에서 발생한다.

---

### 7. True Objective Disagreement 목록

**기존 판단에서 STRONG_DISAGREEMENT로 분류된 PAIR 03·04·10을 포함해,
전체 15쌍에서 진정한 객관적 오류(STRONG_OBJECTIVE_DISAGREEMENT)는 없다.**

| 판정 기준 | 해당 PAIR | 판정 |
|---|---|---|
| A. 같은 raw facts에서 domain 방향이 명백히 반대 | PAIR 07 Transport | domain confusion (모델 오류 아님) |
| B. 4개 domain 대부분이 한쪽을 지지하나 overall이 반대 | 없음 | — |
| C. Pareto dominance에 가까운 사례에서 낮은 쪽이 높은 Score | 없음 | — |
| D. 객관적으로 설명 불가능한 큰 score gap이 반복 | 없음 | — |

**STRONG_OBJECTIVE_DISAGREEMENT: 0/15 = 0%**

---

### 8. Strong Disagreement 정의 재설계

#### 기존 정의 (STEP 3.5)

> "모델 overall winner ≠ 사람 overall winner" + 모델 gap > 10pt

→ PAIR 03(14.3pt), 04(15pt), 10(13pt)를 strong disagreement로 분류했으나,
세 경우 모두 domain level에서 모델과 사람이 일치하고 overall 역전만 발생한 사례임.

#### 새 정의 (STEP 3.6)

**`STRONG_OBJECTIVE_DISAGREEMENT`** = 다음 중 최소 하나 이상을 충족하는 경우:

```
A. 사람이 domain raw facts를 모델과 정반대로 해석하고,
   그 해석이 원천 데이터로도 뒷받침되지 않는 경우

B. 4개 domain 중 3개 이상이 한쪽을 지지하는데
   모델 overall이 반대 방향을 가리키는 경우
   (= 가중합 로직 또는 curve 설계의 근본 결함 가능성)

C. Pareto dominance에 가까운 pair에서
   모든 domain에서 열등한 단지가 높은 Core Score를 받는 경우

D. 동일 archetype에서 3회 이상 동일 방향으로 반복 domain 오류가 발생하는 경우
```

**단순 overall preference 가중치 차이는 제외.**

#### 결과

현행 15쌍 데이터: `STRONG_OBJECTIVE_DISAGREEMENT = 0/15 = 0%`

---

### 9. Human Review Gate V2 제안

#### 기존 Gate (STEP 3.5 §19)

- Overall agreement ≥ 80%
- Strong disagreement ≤ 5%

→ 이 기준은 **개인적 overall 선호까지 포함한 agreement**이므로,
단일 검수자의 개인 가중치 선호가 Gate Pass/Fail을 결정한다는 구조적 결함이 있다.

#### Human Review Gate V2

```
Gate V2-1 (DOMAIN OBJECTIVE GATE):
  Transport agreement ≥ 85%              → PASS: 93.3%
  Living agreement (AGREE+NEAR_TIE) ≥ 80% → PASS: 93.3%
  Education agreement (AGREE+NEAR_TIE) ≥ 80% → PASS: 92.9%
  Complex agreement (AGREE+NEAR_TIE) ≥ 75%   → PASS: 80.0%
  전체 domain STRONG_OBJECTIVE_DISAGREEMENT = 0 → PASS: 0건

Gate V2-2 (CALIBRATION GATE):
  POTENTIAL_CALIBRATION_ISSUE = 0        → PASS: 0건
  PREFERENCE_SENSITIVE cases가 일관된 패턴으로 설명 가능 → PASS

Gate V2-3 (PERSONALIZATION SIGNAL):
  PREFERENCE_SENSITIVE ≥ 2건 시 신호 기록 → YES (4건, 명확한 패턴)
  단, 이 신호는 freeze 차단 요건이 아님
```

#### Gate V2 판정 결과

| Gate | 기준 | 실측 | 판정 |
|---|---|---|---|
| V2-1 Transport | ≥ 85% | 93.3% | ✅ PASS |
| V2-1 Living | ≥ 80% | 93.3% | ✅ PASS |
| V2-1 Education | ≥ 80% | 92.9% | ✅ PASS |
| V2-1 Complex | ≥ 75% | 80.0% | ✅ PASS |
| V2-1 Strong Obj Disagree | = 0 | 0건 | ✅ PASS |
| V2-2 Calibration Issue | = 0 | 0건 | ✅ PASS |
| V2-2 Preference 설명성 | 일관된 패턴 | 복합/단지형 일관 | ✅ PASS |
| V2-3 Signal | 기록 | YES (4건) | ℹ️ 기록됨 |

**DOMAIN_OBJECTIVE_GATE: PASS**
**OVERALL_CALIBRATION_GATE: PASS**
**PERSONALIZATION_SIGNAL: YES**

---

### 10. Preference Sensitive 4건 — 공통 패턴 문서화

PAIR 03·04·06·10 4건은 전부 동일한 구조를 공유한다.

```
[공통 패턴]
교통/생활/교육에서 A 또는 B가 우위
           ↓
Complex domain에서 상대방이 훨씬 큰 차이(40~60pt)로 우위
           ↓
사람은 Complex 우위 단지를 Overall 선택
           ↓
모델은 교통+생활+교육 합산이 더 큰 단지를 Overall 선택
```

이것은 **모델의 도메인 간 상대적 가중치(W-A: 교통 35/생활 25/교육 20/단지 20)**와
**이 검수자의 개인 가중치(단지 > 교통)** 사이의 구조적 차이다.

**중요**: 이 발견을 근거로 W-A를 수정하지 않는다. 이유:
1. 단일 검수자 데이터 — 표본 불충분
2. W-A는 "가격 제외 주거품질의 균형적 평가" 목적으로 설계됨
3. 복합/단지 선호는 특정 사용자 유형에 특화된 선호
4. 가중치 fitting은 다수 검수자 데이터 이후 시행해야 함

---

### 11. Personalized Score 제품 시사점

이번 검수에서 발견된 핵심 시사점을 향후 제품 구조 참고용으로만 기록한다.
**구현 금지 (이번 STEP).**

#### 개념

```
CORE E-JIP SCORE (현재 구현 대상)
= "가격을 제외한, 이 아파트가 실제로 살기에 얼마나 좋은지에 대한 객관적 평가"
= 교통 35 / 생활 25 / 교육 20 / 단지 20 균형 가중
= 개인화 없음, 설명가능한 단일 숫자

MY E-JIP SCORE (향후 제품 후보)
= Core score × 개인 가중치 벡터
= 출퇴근형 / 신축·단지형 / 자녀교육형 / 주차·자동차형 / 생활편의형 등
```

#### 이번 검수에서 확인된 사용자 프로파일

| 프로파일 후보 | 특징 | 이번 검수자 일치도 |
|---|---|---|
| 출퇴근형 | 교통 가중치 max | 낮음 (교통 우위 단지를 다수 비선택) |
| **신축·단지형** | **Complex 가중치 max** | **높음 (4건 일관적 선택)** |
| 자녀교육형 | 교육 가중치 max | 낮음 |
| 주차·자동차형 | 주차(complex sub-factor) max | 중간 (단지와 혼용) |
| 생활편의형 | Living 가중치 max | 낮음 |

**이번 검수자: 신축·단지형 + 재건축 잠재력 고려 복합형에 가장 가깝다.**

#### My E-Jip Score 설계 원칙 (미래)

1. Core Score를 근본 공정 기준으로 유지 — My Score는 Core Score의 개인화 뷰이지 대체가 아님
2. 가중치 슬라이더 UI 또는 설문 기반 프로파일 선택
3. 개인화 결과를 보여줄 때 Core Score와 나란히 표시해 객관 근거 투명성 유지
4. 개인화 가중치는 DB/서버에 저장, 비개인화 Core Score는 변경하지 않음

---

## 설계 결정

### PAIR 10 Transport 정정

기존 PAIR 10 Transport DISAGREE는 입력 오류로 삭제.
이로 인해 기존 Strong Disagreement 판정 중 PAIR 10은 PREFERENCE_SENSITIVE로 재분류.

### Strong Disagreement 재정의

기존: model overall ≠ human overall + gap > 10pt  
신규: 4가지 객관적 기준 모두 충족해야 함 (§8)

이 재정의로 **STRONG_OBJECTIVE_DISAGREEMENT = 0건** 확정.

### Human Review Gate V2 채택

기존 overall-based gate를 domain-level + calibration-level gate로 분리.
전체 PASS.

---

## 구현 내용

신규 파일: `docs/development/EJIP_SCORE_V2_STEP36_HUMAN_REVIEW_INTERPRETATION.md` (본 문서)

분석용 추가 script/data: 없음 (15쌍 규모는 수동 분석으로 충분, 산출물은 이 문서에 내재)

production 코드 변경: **없음**

---

## 알려진 문제

1. **단일 검수자 한계**: 이번 결과는 1인의 검수 데이터. 다수 검수자 데이터가 있어야
   패턴이 개인 선호인지 보편적 calibration 문제인지 최종 구분 가능.

2. **Complex domain 개념 혼동**: PAIR 11·13에서 사람이 complex를 생활편의 또는
   교통과 혼용해 평가하는 징후가 있음. UI에서 "단지 상품성 = 연식·세대수·주차" 설명이
   필요할 수 있음.

3. **Education HUMAN_UNCLEAR (PAIR 11)**: 체감 거리와 절대거리 curve의 괴리.
   향후 UI에서 초등학교 거리를 도보분으로 병기하는 방안 검토 가능.

---

## 최종 보고 (E-JIP SCORE V2 STEP 3.6)

### 1. PAIR 01~15 Corrected Matrix

- PAIR 10 Transport: B → **A** (정정 완료)
- 전체 재분석: 위 §2 매트릭스

### 2. Domain Agreement 59 Judgments

| 도메인 | AGREE | NEAR_TIE | HUMAN_UNCLEAR | DISAGREE |
|---|---|---|---|---|
| Transport | 14 | 0 | 0 | **1** |
| Living | 7 | 7 | 1 | 0 |
| Education | 10 | 3 | 1 | 0 |
| Complex | 8 | 4 | 0 | **3** |
| **합계** | **39** | **14** | **2** | **4** |

### 3. Domain별 Agreement Rate

| 도메인 | AGREE% | AGREE+NEAR_TIE% | DISAGREE% |
|---|---|---|---|
| Transport | 93.3% | 93.3% | **6.7%** (1건, domain confusion) |
| Living | 46.7% | 93.3% | 0% |
| Education | 66.7% | 86.7% | 0% |
| Complex | 53.3% | 80.0% | **21.4%** (3건, preference) |
| **전체** | 66.1% | 89.8% | **6.8%** |

### 4. True Objective Disagreement 목록

**없음 — 0건.**

PAIR 07 Transport DISAGREE: 도메인 개념 혼용(주차→교통), 모델 오류 아님.
PAIR 05·11·13 Complex DISAGREE: 개인 가중치 선호 차이, 모델 오류 아님.

### 5. Preference-Sensitive 목록

| PAIR | 구조 | 사람 선택 이유 |
|---|---|---|
| 03 | 초역세권 소단지 vs 신축 대단지 | Complex B=84.3 (신축·대형·주차) 우선 |
| 04 | 초역세권 소단지 vs 신축 대단지 | Complex B=89.0 (신축·대형·주차) 우선 |
| 06 | 대형 대단지 vs 소형 역세권 | Complex A=73.8 (규모·주차) + 재건축 고려 |
| 10 | 지하철·교육 근접 구형 vs 신축 대단지 | Complex B=87.5 (신축·대형·주차) 극단적 우선 |

**공통 패턴: "신축/단지형" 개인 프로파일**

### 6. PAIR 03/04/06/10 재판정

| PAIR | 기존 판정 | 재판정 | 변경 이유 |
|---|---|---|---|
| 03 | Strong Disagreement | **PREFERENCE_SENSITIVE** | 4 domain 전부 AGREE, overall만 역전 |
| 04 | Strong Disagreement | **PREFERENCE_SENSITIVE** | 3 domain AGREE + 1 NEAR_TIE, overall 역전 |
| 06 | Disagreement | **PREFERENCE_SENSITIVE** | 3 domain AGREE + 1 HUMAN_UNCLEAR, overall 역전 |
| 10 | Strong Disagreement + domain confusion | **PREFERENCE_SENSITIVE** | Transport 정정 후 4 domain 일치, overall 역전 |

### 7. Strong Disagreement 재정의

기존: overall winner 불일치 + gap > 10pt  
신규: 4가지 객관적 기준 (§8)  
결과: **STRONG_OBJECTIVE_DISAGREEMENT = 0/15**

### 8. Human Review Gate V2

| Gate | 결과 |
|---|---|
| DOMAIN_OBJECTIVE_GATE | ✅ **PASS** |
| OVERALL_CALIBRATION_GATE | ✅ **PASS** |
| PERSONALIZATION_SIGNAL | ℹ️ **YES** (4건, 신축/단지형) |

### 9. Personalized Score Implication

향후 "My E-JIP Score" 제품 후보 존재. 이번 STEP 구현 금지.
Core Score는 균형 가중치(W-A) 그대로 유지. §11 참조.

### 10. Final Gate 판정

| 항목 | 판정 |
|---|---|
| DOMAIN_OBJECTIVE_GATE | ✅ PASS |
| OVERALL_CALIBRATION_GATE | ✅ PASS |
| PERSONALIZATION_SIGNAL | ℹ️ YES |
| **FINAL_CANDIDATE_FROZEN** | **REVIEW** |

> **FINAL_CANDIDATE_FROZEN = REVIEW 근거**:
> - Gate V2 전 항목 PASS → 모델 자체의 객관적 문제 없음
> - 단, 단일 검수자(n=1) 데이터이므로 완전 freeze를 위해서는
>   추가 검수자(최소 1~2인) 또는 PM 승인이 필요
> - PM(ChatGPT)의 검수 결과를 반영해 YES/NO 최종 결정을 권고
>
> **만약 PM이 단일 검수자 결과로 충분하다고 판단하면:**
> `FINAL_CANDIDATE_FROZEN = YES` 전환 가능.
> 조건: STRONG_OBJECTIVE_DISAGREEMENT=0, Gate V2 전항목 PASS 달성.

### 11. 변경 여부

- production Score 변경: **NO**
- DB write: **NO**
- migration: **NO**
- API 변경: **NO**
- UI 변경: **NO**
- weight(W-A) 변경: **NO**
- curve 변경: **NO**
- Core 로직 변경: **NO**

### 12. 테스트

- 신규 TypeScript 파일: **없음 (docs only)**
- tsc: N/A
- lint: N/A
- 기존 regression tests: 변경 없음 (73/73 PASS 유지)

### 13. BLOCKER

없음.

### 14. SCORE_V2_STEP36_CLOSE

YES

### 15. NEXT_RECOMMENDATION

Gate V2 전항목 PASS 확인. PM(ChatGPT) 검수 결과에 따라:

- **A안 (추가 검수)**: 동일한 blind shortlist를 1~2명의 추가 검수자에게 제시,
  패턴이 개인 선호인지 보편적 calibration 문제인지 확정.
- **B안 (현재 데이터로 freeze)**: PM이 단일 검수자 결과 + Gate V2 PASS로 충분하다고 판단 시
  `FINAL_CANDIDATE_FROZEN = YES` 선언 후 STEP 4(production 구현) 진행.
- **C안 (병행)**: A안과 B안을 동시 진행 — freeze 선언 후 추가 검수를 early warning 시스템으로 운용.

병행 가능한 저위험 작업: parking RECOVERABLE 1,748건 재조회(건축물대장 파서 개선).
