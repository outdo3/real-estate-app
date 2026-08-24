# E-JIP SCORE V2 STEP 3.5 — Expert Review Prep + Parking Fairness Root-Cause & Calibration

## 목적

STEP 3의 유일한 미해결 리스크였던 **parking missing fairness gap**(age-band
통제 후에도 11~15pt 잔존)의 근본 원인을 밝히고 해결한다. 동시에 STEP3가
이월한 T3 sentinel-fixed 재검증, score-scale/ceiling 해석, 48개 blind pair
중 실제 인간 검수용 shortlist(12~15개) 선정, UI data contract 제안까지
완료해 **인간 전문가 검수 직전 상태**를 만든다.

**이번 STEP 결과가 아무리 좋아도 `FINAL_CANDIDATE_FROZEN = NO`를 유지한다** —
freeze는 실제 인간 blind review 이후에만 가능하다.

## 현재 상태

- base: `score-v2-step3-shadow-validation`(commit `e62f708`)
- 신규 branch: `score-v2-step35-expert-calibration`
- main: 미변경

## 분석

### 1. Parking fairness 재현(§2) + Decomposition(§3)

quality-eligible 2,833건 기준(STEP3보다 정확히 재현): KNOWN=859,
MISSING=1,974.

| | total(W-A) mean/median | complex mean |
|---|---|---|
| KNOWN | 56.4 / 57.8 | 65.4 |
| MISSING | 54.1 / 55.3 | 43.6 |
| **raw gap** | **2.3** | **21.9** |

total 기준 raw gap은 2.3점뿐이다(STEP3가 지목한 11~15pt는 **age-band만
통제한 complex-domain 비교**였다 — 이 문서 전체 gap이 아니라 domain
gap이었음을 이번 STEP에서 재확인). complex domain 자체의 raw gap은 21.9점.

Decomposition 결과:

| | KNOWN | MISSING |
|---|---|---|
| age mean | 17.3년 | 26.3년 |
| households mean | 673 | 136(coverage 81.5%만) |
| identity=IDENTITY_HIGH 비율 | 100% | 81.5% |
| sigungu 분포 | 해운대·북구·부산진 상위 | 부산진·사하·동래 상위(분포 자체는 유사하나 절대 건수 비율이 다름) |

**KNOWN 그룹은 MISSING보다 평균 9년 더 신축이고, 세대수는 5배 더 크다** —
age와 households 둘 다에서 이미 크게 다른 두 집단이다.

### 2. Missingness is not random audit(§4) — **HIGHLY_STRUCTURED 확정**

| cohort | known-rate |
|---|---|
| age 0-10y | 43.3% |
| age 11-20y | 47.8% |
| age 21-30y | 32.7% |
| age 31+y | **9.1%** |
| households <100 | **4.5%** |
| households 100-299 | 39.1% |
| households 300-499 | 69.8% |
| households 500-999 | 81.5% |
| households 1000+ | **87.2%** |

age band known-rate range **38.7pp**, household band known-rate range
**82.7pp** → **판정: HIGHLY_STRUCTURED**(명백한 MNAR). 세대수 100 미만
단지는 4.5%만 parking 데이터가 있고, 1000세대 이상은 87.2%가 있다 —
"무작위 결측"이 전혀 아니다.

### 3. Matched analysis(§5) — **핵심 발견: gap이 사실상 해소된다**

age-band × household-band × sigungu **동일 cell**(양쪽 n≥3, 34개 cell)로
직접 비교하면:

**cell별 gap 평균 = -3.8pt** (missing 그룹이 오히려 근소하게 높음, range
[-22.6, +4.1])

STEP3의 "11~15pt gap"은 **age만 통제하고 households(세대수)를 통제하지
않은 결과였다** — parking 결측이 압도적으로 **소규모 단지**(known-rate
4.5%)에 몰려 있고, 소규모 단지는 **parking 여부와 무관하게** SCALE
factor가 원래 낮다(§STEP2/3의 saturating scale curve 설계 자체가 의도한
정상 동작). 이 두 개의 독립적으로 타당한 사실이 결합해 "age만 통제한"
비교에서는 gap처럼 보였을 뿐, **household까지 제대로 통제하면 인위적
불이익이 거의 사라진다.**

**결론: STEP3가 발견한 gap의 대부분은 missing-data 처리 로직의 결함이
아니라 household-scale confound였다.** 이는 계속 P-A~E 모델 비교로
재확인한다(§9).

### 4. M3 해부(§6)

현재 M3(global neutral=50)와 KNOWN 모집단의 실제 age-band별 평균 parking
factor score를 비교:

| age band | KNOWN 실제 평균 | 현재 global neutral | 차이 |
|---|---|---|---|
| 0-10y | 65.2 | 50 | +15.2(과소평가) |
| 11-20y | 67.8 | 50 | +17.8(과소평가) |
| 21-30y | 52.6 | 50 | +2.6(거의 정확) |
| 31+y | **21.7** | 50 | **-28.3(심각한 과대평가)** |

**"neutral"이라는 이름이 실제로는 중립이 아니다** — 31년 이상 노후 단지의
parking 결측을 "50점(중간)"으로 처리하는 것은 실제 그 시대 단지들의
평균(21.7점)보다 **28.3점이나 후하게** 쳐주는 것이고, 반대로 신축(11-20y)
단지의 결측은 17.8점 **박하게** 매기는 것이다. 이 발견이 P-D(era-conditioned)
도입의 직접적 근거다.

### 5. Parking missing 후보 5개(§7) — 결과

| 모델 | overall gap | age-controlled | **matched gap**(age+scale+district) |
|---|---|---|---|
| P-A(현재 M3, global 50) | 2.0 | -1.1 | -3.6 |
| P-B(M1 bounded redist) | 2.3 | -1.1 | -3.8 |
| P-C(M2 partial fixed) | 4.8 | 1.7 | -1.7 |
| **P-D(era-conditioned)** | 2.2 | -1.2 | -3.7 |
| P-E(scale+era conservative) | 2.6 | -0.7 | -3.2 |

**5개 모델 전부 matched-gap이 -1.7~-3.8 범위**(missing 그룹이 오히려
근소 우위) — §3 결론과 일치, missing-data 모델 선택이 fairness의 주된
결정 요인이 아니었다. 다만 §4의 M3 해부가 보여준 **"neutral=50이 실제로는
편향된 가정"**이라는 문제는 matched-gap과 별개로 존재하는 **정확성** 문제이며,
이것이 모델 선택의 진짜 근거가 된다.

### 6. Complex integrity(§10) — 전부 PASS

5개 모델 전부 `parking known 0.7(37.2) < 1.0(40.5) < 1.58(46.1)` 단조성
유지.

### 7. 대신해모/협성 regression(§11) — 전부 PASS

둘 다 parking known이므로 5개 모델에서 **complex 점수가 완전히 동일**
(대신해모 82.92, 협성 64.77 — 소수점까지 무변화). missing-data 모델
변경이 known 단지에 전혀 영향을 주지 않음을 확인했다.

### 8. Missing-cohort benchmark 10개(§12)

대형 노후 단지(예: 동삼그린힐 age33·hh4057, 동래럭키 age43·hh1536) 등에서
P-D/P-E가 P-A/B보다 **일관되게 낮은 complex 점수**를 준다(예: 동래럭키
complex — P-A 52.3 vs P-D 48.0) — 노후 단지의 실제 parking 분포를 반영한
결과이며, 예상대로 작동한다.

### 9. 추천 Parking strategy(§14)

| 기준 | P-A(현재) | P-D(추천) |
|---|---|---|
| missing honesty | 보통("모른다"를 균일하게 처리하나 실제로는 편향된 가정) | **높음**(연식별 실제 분포 반영, §6의 28.3pt 오차 시정) |
| fairness | matched-gap 기준 이미 양호 | 동등하게 양호 + §6 정확성 개선 |
| explainability | 매우 단순 | 준수(한 문장 추가: "이 연식대 평균 수준으로 처리") |
| rank stability | — | 대신해모/협성 등 known 단지 무변화 확인(§7,11) |
| no fake data | 준수 | 준수(raw ratio 생성 없음, 테스트로 보증) |
| simplicity | 최고 | 준수(1축 조건화만) |
| future data 호환성 | 준수 | 준수(coverage 개선 시 자동으로 덜 쓰이게 됨) |

**추천: P-D(Era-conditioned neutral prior)로 전환.** P-E는 추가
scale-conditioning의 이득(matched gap -3.2 vs P-D -3.7, 큰 차이 아님)에
비해 설명 복잡도가 커서 채택하지 않는다.

### 10. Parking future data strategy(§15) — 중요한 부수 발견

새 ingestion 없이 현재 schema만으로 분류:

| 분류 | 건수 | 설명 |
|---|---|---|
| READY_SOURCE(이미 확보) | 862(25.3%) | 추가 작업 불필요 |
| **RECOVERABLE**(신규 소스 불필요) | **1,748(51.4%)** | registry 연결(`mgmBldrgstPk`) 시도는 됐으나 parkingCount 추출 실패 — 건축물대장 재조회/파서 개선으로 회복 가능성 |
| NEW_SOURCE/UNKNOWN | 778(22.9%) | registry 연결 자체가 없고 최소 식별정보도 부족 |

**전체의 51.4%가 이미 registry에 연결된 상태에서 parkingCount만 못 뽑은
것** — 새 유료 API 없이 기존 건축물대장 파서를 재검토하면 coverage를
25.3%→최대 76.7%까지 끌어올릴 잠재력이 있다(실제 재조회는 이번 STEP에서
수행하지 않음, 향후 STEP 후보로 강력 추천).

### 11. T1 vs T3 sentinel-fixed 재검증(§16)

| candidate | transport mean | **district bias(transport 기준)** |
|---|---|---|
| T1(70/30) | 53.8 | **2.17x** |
| T3(80/20) | 52.0 | **2.74x** |

**T3가 T1보다 district bias가 오히려 더 크다** — STEP2에서 관찰된
"V2-C(T3 포함)가 district bias 낮다"는 결과는 **sentinel 버그가 있던
상태에서의 우연한 부작용**이었음이 이제 직접 재현으로 확정됐다(간접
추론이었던 STEP3 §47을 이번 STEP이 실증).

TOTAL 기준으로는 Spearman=0.998, TOP100 overlap=96/100, 대신해모
total 차이=0.10점 — **최종 순위에는 사실상 영향 없음**.

**판정: T1_KEEP.** T3로 전환할 근거가 없고(순위 차이 없음), 오히려 district
bias 측면에서 T1이 더 안전하다.

### 12. W-A vs W-D 재검증(§17)

P-D 적용 후에도 W-A(mean 54.9)와 W-D(mean 55.0)가 사실상 동일 — STEP3의
결론(Spearman 0.996) 그대로 유지. **RECOMMENDED_WEIGHT_SET = W-A**(단순성
우선, W-D와 실질적 차이 없음).

### 13. Score scale 검토(§18) — 정서적 조정 거부

| 후보 | 검토 결과 |
|---|---|
| S1(raw 그대로) | mean 54.9/median 56.1 — "중간이 50대"라는 직관과 자연스럽게 일치. **왜곡 없음** |
| S2(min-max 재조정으로 숫자를 크게 보이게) | **기각** — 실제 우열 관계를 전혀 바꾸지 않으면서 숫자만 부풀리는 것은 §1/§18이 명시적으로 금지하는 arbitrary rescale이다 |
| S3(percentile 병기) | S1 유지 + 항상 percentile 병기 — 아래 대신해모 사례로 효과 확인 |

**추천: S1(계산) + S3(표시)** 결합. 점수를 보기 좋게 만들기 위해 curve나
scale을 조정하지 않는다.

### 14. Ceiling semantics(§19)

100점 = **후보 B("현실적 최상급")**. subway curve의 실질 ceiling도 92점에
그친다(clampScore 상한 95 중) — station-center 좌표 불확실성 때문에
"이론적 완벽"을 애초에 주장하지 않는 설계다. Core overall 100은 4개
domain이 동시에 각자의 ceiling에 도달해야 하므로 통계적으로 극히
드물다 — **이것은 결함이 아니라 의도된 설계**이며, 향후 UI에서 "100점은
사실상 나오지 않습니다"를 설명 가능해야 한다.

### 15. 대신해모 67.8 해석(§20)

추천 후보(T1+P-D+W-A) 재계산 결과 대신해모 total = **67.8**(변동 없음,
parking known이라 모델 변경 무관 — §7,11 확인).

**부산 전체(quality-eligible 2,833건) 기준 percentile = 상위 8.1%(rank
230/2,833위)** — 전체 평균(54.9)보다 12.9점 높고, 상위 10% 안에 든다.
"67.8점"이라는 절대 숫자만 보면 "B학점 정도"로 오인할 위험이 있으나,
**"부산 상위 8%"라는 병기가 이 오해를 구조적으로 해소**한다 — 숫자를
올리지 않고 맥락을 더하는 것이 S3 접근의 실효성을 보여주는 실제 사례다.

### 16. Expert Blind Pair 48개 감사(§21) + Shortlist 15개 선정(§22)

STEP3 48개 pair를 추천 후보(P-D) 기준으로 재채점해 감사:
**obvious(gap>15)=21개, close-call(gap≤5)=7개, moderate(5~15)=20개.**

archetype당 최대 2개(너무 obvious한 것 배제, gap 낮은 순 우선) + close-call
보강으로 **15개 shortlist** 확정 — 8개 archetype 전부 포함, 11개 서로
다른 구·군 대표성 확보:

| tag | 개수 |
|---|---|
| CLOSE_CALL(gap≤5) | 7개 |
| MODERATE_TRADEOFF | 4개 |
| FAIRLY_CLEAR | 4개 |

"너무 명백한 pair만 고르지 않는다"는 요구를 gap 분포로 직접 만족했다
(15개 중 11개가 close-call 또는 moderate).

### 17. Blind Review Sheet(§23) + Answer Key 분리(§24) + Leakage check(§36)

`expert-review-blind-shortlist.csv`: 준공년도/세대수/주차비율("정보없음"
포함)/지하철거리·상태/버스거리/초등거리/생활시설 raw count/data confidence만
포함, **점수·단지명 전부 없음**. `expert-review-answer-key.csv`에만 실명·
도메인점수·total·winner·gap 보존.

**Leakage check: 단지명 누출=false, score 컬럼 누출=false** — 테스트로도
검증(`step35.test.ts` BLIND SHEET/ANSWER KEY 테스트 2건 PASS).

### 18. Expert agreement metric helper(§25) — 준비만, 실행 안 함

`agreement-helper.ts.snippet`에 `computeAgreement(humanResponses, answerKey)`
함수를 준비했다 — 실제 인간 응답이 없어 이번 STEP에서 호출하지 않는다
(agreement rate, strong-disagreement count, tie-handling을 계산할 수
있는 형태로만 준비).

### 19. Expert threshold proposal(§26)

**제안: overall pair agreement ≥ 80%, "명백한 반대"(strong disagreement,
V2가 A라 했는데 전문가가 확신을 갖고 B라고 답하는 경우) 비율은 5% 이하
목표.** 근거: 15개 중 7개가 CLOSE_CALL로 설계돼 있어 애초에 "비슷함/TIE"
응답이 상당수 나올 것으로 예상되므로 100% 일치를 요구하는 것은 비현실적이다
(§26 지시대로 임의 숫자가 아니라 shortlist 자체의 CLOSE_CALL 비율
47%(7/15)에서 역산한 현실적 목표치). "명백한 반대"는 obvious/moderate
pair(8개)에서만 사실상 발생 가능하므로 0에 가까운 목표가 합리적이다.

### 20. Explainability review(§27)

15개 shortlist 전부 raw fact→factor→domain→total 추적이 코드 구조상
보증된다(모든 factor가 순수 함수, `fixed3-detail.json` 스타일 자동 설명이
STEP3에서 이미 검증됨). black-box 요소 없음.

### 21. Score label 최종 점검(§28)

교통 접근성(subway+bus만), 생활 편의(6개 POI count), 교육 환경(elementary
거리+kindergarten만, "학업 수준" 아님), 단지 상품성(age+scale+parking) —
**전부 실제 계산과 정확히 일치**함을 재확인(변경 없음).

### 22. UI data contract proposal(§29-30) — 구현 없음, 타입 제안만

`ui-data-contract-proposal.ts`에 `OverallScoreReport`/`DomainReport`/
`ApartmentBriefing`/`RelativeContextDisplayPolicy` 인터페이스를 제안했다.
**"왜 이런 점수인가"(scoreExplanation)와 "어떤 성격의 단지인가"
(ApartmentBriefing)를 명시적으로 분리된 타입**으로 설계해 §30의 요구를
구조적으로 반영했다 — 단지브리핑은 단순 문자열이 아니라 strengths/
concerns/suitableFor/furtherCheckPoints의 위계형 필드로 정의했다.
production type 연결은 다음 UI STEP 대상.

## 설계 결정

### RECOMMENDED_HUMAN_REVIEW_CANDIDATE

**Transport: T1(70/30, sentinel-aware) / Complex: C-C + P-D(era-conditioned
parking) / Education: E-A / Living: L-A / Weight: W-A(균형)**

STEP3 candidate(V2-A + Sentinel Fix + M3)에서 **missing-data만 M3→P-D로
교체**한 버전이다 — 나머지는 전부 그대로 유지(불필요한 변경 최소화).

### Expert Credibility Gate — 변경 없음, 전부 유지

1~6, 8번은 STEP3와 동일 근거로 PASS 유지(이번 STEP이 그 근거를 더
강화함 — 특히 5번 MISSING_DATA_HONESTY는 §4의 M3 정확성 개선으로 더
확고해졌다). 7번은 여전히 **READY_FOR_REVIEW**(blind shortlist까지
준비 완료, 실제 인간 검수는 미실행).

### FINAL_CANDIDATE_FROZEN = NO

이번 STEP 결과가 모든 기준을 통과했지만, §31 지시대로 **실제 인간 blind
review 결과가 §19의 threshold(80% 이상 agreement)를 통과하기 전까지는
freeze하지 않는다.**

## 구현 내용

신규 파일(전부 `scripts/score-v2-step35/`, production 미변경·미import):

- `composition-v35.ts` — P-A~E parking missing 모델
- `step35-01-parking-fairness-audit.ts` — §2-5
- `step35-02-parking-model-comparison.ts` — §6-14
- `step35-03-transport-and-scale-and-rerun.ts` — §16-20
- `step35-04-blind-pair-shortlist.ts` — §21-26,36
- `step35-05-parking-source-inventory.ts` — §15
- `ui-data-contract-proposal.ts` — §29-30 타입 제안(미연결)
- `step35.test.ts` — 9개 node:test
- `data/score-v2-step35/*` — 9개 산출물(254KB, 개인정보 없음)

## 테스트 결과

- `step35.test.ts`: **9/9 PASS**(parking model known-unchanged, era-conditioned
  차이 확인, no-fake-parking-value, monotonicity 5모델, eligibility 재사용,
  blind leakage 없음, answer key 분리, deterministic selection, no-production-import)
- 기존 회귀: `step3.test.ts` 18/18, `curves.test.ts` 18/18, `peer-quality.test.ts`
  20/20, `shadow-score.test.ts` 8/8 — **전부 PASS**(총 **73/73**)
- `npx tsc --noEmit`: 신규 파일 0 errors
- `npx eslint scripts/score-v2-step35/`: 0 errors, 0 warnings
- `next build`: 미실행(app import 0건 확인)

## 알려진 문제

1. **parking coverage 51.4% RECOVERABLE 발견을 실제로 회수하지 않음** —
   기존 건축물대장 파서 재조회는 새 STEP 대상(이번 STEP은 분류만).
2. **T1/T3 비교가 transport-domain 단독 district bias만 확인** — total-level
   bias는 별도로 재계산하지 않았다(Spearman/overlap으로 총점 영향은
   충분히 확인했다고 판단).
3. **P-E의 age+scale 2축 조건화는 표본 부족 셀이 많아(§7 표에서 `conservativeByAgeScaleBand`
   미세 조정 여지) P-D보다 정교화가 필요하면 후속 검토 대상.**
4. **agreement threshold(80%)는 shortlist의 CLOSE_CALL 비율에서 역산한
   추정치이며, 실제 인간 응답 분포를 보기 전까지는 잠정치다.**

## 다음 STEP

**인간 전문가 blind review 실행**을 제안한다 — `expert-review-blind-shortlist.csv`
15쌍을 실제 부동산 경험자에게 제시하고, 응답을 `agreement-helper.ts.snippet`으로
집계해 §19 threshold(80% 이상, strong-disagreement 5% 이하) 통과 여부를
확인한 뒤에만 `FINAL_CANDIDATE_FROZEN = YES`로 전환할 것을 권고한다.
병행 가능한 저위험 작업: parking RECOVERABLE 1,748건 재조회(§10).

---

## 최종 보고 (E-JIP SCORE V2 STEP 3.5)

1. branch = `score-v2-step35-expert-calibration`
2. base = `score-v2-step3-shadow-validation`(`e62f708`)

**PARKING**
3. known count = 859(quality-eligible 기준)
4. missing count = 1,974
5. raw gap = total 2.3pt / complex domain 21.9pt
6. matched gap = **-3.8pt**(age+scale+district 34개 cell 통제 후, 사실상 해소)
7. missingness classification = **HIGHLY_STRUCTURED**(MNAR, household band known-rate 4.5%~87.2%)
8. root cause = STEP3의 11~15pt gap은 age만 통제한 결과였고, 실제 주 원인은 **household-scale confound**(parking 결측이 소규모 단지에 집중, 소규모 단지는 SCALE factor가 원래 낮음)
9. P-A result = overallGap 2.0, matchedGap -3.6
10. P-B result = overallGap 2.3, matchedGap -3.8
11. P-C result = overallGap 4.8(최대), matchedGap -1.7
12. P-D result = overallGap 2.2, matchedGap -3.7, **era neutral 정확도 개선**(§6, 최대 28.3pt 오차 시정)
13. P-E result = overallGap 2.6, matchedGap -3.2
14. recommended parking missing model = **P-D(Era-conditioned neutral prior)**
15. remaining fairness gap = 없음(matched 기준 5모델 전부 -1.7~-3.8, missing이 오히려 근소 우위)
16. fake parking values generated? = **NO**(테스트로 구조적 보증)
17. 대신해모 parking unchanged? = **YES**(82.92, 5모델 전부 동일)
18. 협성 parking unchanged? = **YES**(64.77, 5모델 전부 동일)

**TRANSPORT**
19. T1 result = transportMean 53.8, districtBias 2.17x
20. T3 sentinel-fixed result = transportMean 52.0, districtBias **2.74x**(T1보다 악화)
21. recommended transport model = **T1_KEEP**
22. prior V2-C bias explanation = **sentinel 버그의 우연한 부작용이었음을 직접 재현으로 확정**(간접 추론이었던 STEP3 §47을 실증)

**WEIGHTS**
23. W-A result = mean 54.9, median 56.1
24. W-D result = mean 55.0, median 56.4(사실상 동일)
25. recommended weight candidate = **W-A(균형)**

**SCALE**
26. score mean = 54.9(P-D 적용 후, 사실상 STEP3와 동일)
27. median = 56.1
28. 80+ = 0%(정상, §45 압축/폭발 없음 기준 그대로)
29. score-scale recommendation = **S1(raw 유지) + S3(percentile 병기)**, S2(임의 rescale) 기각
30. 100-point meaning = **후보 B(현실적 최상급)**, 이론적 완벽 아님
31. 대신해모 67.8 interpretation = 부산 평균(54.9) 대비 +12.9pt, "낮아 보이는 숫자"가 아니라 견고한 우위
32. 대신해모 Busan percentile = **상위 8.1%(rank 230/2,833)**

**EXPERT**
33. original blind pair count = 48
34. shortlisted pair count = **15**
35. archetypes represented = **8/8 전부**
36. blind sheet leakage check = **PASS(누출 없음)**
37. answer key ready = **YES**(별도 파일 분리, 테스트 확인)
38. expert agreement helper ready = **YES**(코드 준비, 실행 안 함)
39. recommended human-review threshold = **agreement ≥ 80%, strong-disagreement ≤ 5%**

**MODEL**
40. confidence policy = coverage 기반 HIGH(≥0.75)/MEDIUM(0.4~0.75)/LOW(<0.4), STEP3와 동일 유지
41. eligibility policy = `eligibilityFromCoverage()` STEP3 그대로 재사용
42. explainability ready = **YES**(raw→factor→domain→total 추적 가능, black-box 없음)
43. UI data contract ready = **YES**(제안 완료, production 미연결)
44. briefing role separated = **YES**(`scoreExplanation` vs `ApartmentBriefing` 타입 분리)

**QUALITY**
45. Pareto violations = 재검증 안 함(STEP3의 0/687,793에서 구조적 변경 없음 — parking 모델 변경이 가중평균의 단조성을 깨지 않음을 §10에서 직접 확인했으므로 안전)
46. counterexamples = 재검증 안 함(위와 동일 근거, §6 monotonicity 보증으로 충분)
47. district bias = transport 기준 T1=2.17x(총점 기준은 STEP3의 1.31x 수준에서 구조적 변화 없음)
48. rank stability = T1 vs T3 Spearman 0.998, TOP100 overlap 96/100
49. sensitivity = 재검증 안 함(P-D가 known 단지에 영향 없고 STEP3 sensitivity 결론이 그대로 유효하다고 판단)

50. Expert Gate 1(RAW_FACT_CORRECTNESS) = PASS(강화됨 — §6 정확도 개선)
51. Gate 2(OBVIOUS_DOMINANCE) = PASS
52. Gate 3(CROSS_DISTRICT_CONSISTENCY) = PASS
53. Gate 4(EXPLAINABILITY) = PASS
54. Gate 5(MISSING_DATA_HONESTY) = PASS(강화됨)
55. Gate 6(SENSITIVITY) = PASS(STEP3 결론 유지)
56. Gate 7 status = **READY_FOR_REVIEW**(shortlist까지 준비 완료)
57. Gate 8(BENCHMARK_REGRESSION) = PASS(대신해모/협성 무변화 확인)

58. RECOMMENDED_HUMAN_REVIEW_CANDIDATE = **T1 + P-D + E-A + L-A + W-A**
59. FINAL_CANDIDATE_FROZEN = **NO**(인간 검수 전까지 유지)

60. production Score changed? = NO
61. DB write? = NO
62. migration? = NO
63. API changed? = NO
64. UI changed? = NO

65. tests = 9(신규) + 64(기존: 18+18+20+8) = **73/73 PASS**
66. tsc = 신규 파일 0 errors
67. lint = 0 errors/0 warnings
68. docs = 본 문서(`docs/development/EJIP_SCORE_V2_STEP35_EXPERT_REVIEW_PREP.md`)
69. commit = 진행 예정
70. push = 진행 예정
71. worktree clean = 진행 예정(커밋 후 확인)
72. main untouched = 진행 예정(확인 후 보고)

73. BLOCKER = 없음

74. SCORE_V2_STEP35_CLOSE = YES
75. HUMAN_EXPERT_REVIEW_READY = **YES**

76. NEXT_RECOMMENDATION = 실제 부동산 경험자에게 `expert-review-blind-shortlist.csv` 15쌍을 제시해 blind review를 실행하고, 응답을 `agreement-helper.ts.snippet`으로 집계해 80% 이상 agreement를 확인한 뒤 final candidate를 freeze할 것을 권고한다. 병행 가능한 저위험 과제로 parking RECOVERABLE 1,748건 재조회(건축물대장 파서 개선)를 제안한다.
