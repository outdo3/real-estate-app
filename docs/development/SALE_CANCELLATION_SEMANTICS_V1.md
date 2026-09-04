# SALE CANCELLATION SEMANTICS V1 — duplicate source representation audit

- 상태: **PASS — NO PRODUCT FIX REQUIRED** (PM 검수 완료)
- 이 STEP의 Production DB write: **0건** (전 과정 READ ONLY)
- schema / migration / index 변경: **0건**
- sync logic / query logic / UI 변경: **0건**
- 채택 결론: **옵션 E — unresolved state 보존.** 병합·삭제·effective-canceled 처리를 하지 않는다.

## 1. 배경 — 무엇이 문제로 제기됐나

첫 무인 SALE recheck 검증(`SALE_CANCELLATION_COVERAGE_V1` 후속)에서 MOLIT 원천이 취소 거래를
**두 가지 형태**로 내려주는 것이 확인됐다.

| 유형 | 원천 형태 | 현재 처리 |
| --- | --- | --- |
| **TYPE A** | 기존 거래 1행 자체가 `cdealType=O`로 바뀜 | `false→true` UPDATE로 정상 처리 |
| **TYPE B** | 동일 조건 2행: row0 `cdealType` 없음 / row1 `cdealType=O` | `occurrenceIndex` 0/1로 **둘 다 저장** |

제기된 우려: TYPE B에서 `WHERE deal_canceled = false` 필터가 row0을 계속 유효거래로 취급해
**신고가·최고가·거래량·평균가·최근거래 신뢰를 훼손**할 수 있다.

이 감사는 그 우려를 실측으로 검증했고, 결론은 **우려가 성립하지 않는다**이다.

## 2. Source representation types

**DB-side 전수** — 부산 16구, `dealDate ≥ 2020-02-01`, 246,126행 / 취소 16,222행.
그룹 = 자연키에서 `occurrenceIndex`만 제거한 `(group_key, deal_amount, deal_date, floor)`.
`group_key`가 `aptSeq::전용면적::dealType`을 인코딩하므로 name-only fallback은 일절 쓰지 않았다.

| 유형 | groups | rows |
| --- | ---: | ---: |
| — 1행 정상 | 220,141 | 220,141 |
| **A** 1행 canceled | 7,572 | 7,572 |
| **B** uncanceled + canceled | **7,216** | 14,432 |
| **C** canceled + canceled | 203 | 406 |
| **D** uncanceled + uncanceled | 561 | 1,122 |
| **E** 3행 이상 | 686 | 2,453 |

E 세부: 3행 467(그중 `3행 중 2취소` 360), 4행 133, 최대 10행(5취소) 1.

**source-side 표본 분류**(54셀 / 11,285행 — 셀 내부는 전수, 셀 선택은 표본):
A 356 · 1행정상 10,185 · **B 325** · C 7 · D 17 · E 15. DB와 같은 비율이다.

### 독립성 검정 — TYPE B는 우연이 아니다

취소율 6.59%로 2행 그룹의 두 행이 독립 거래라면 기대값은 **B≈982 / C≈35 / D≈6,963**.
실측은 **B 7,216 / C 203 / D 561** — B는 기대치의 **7.3배**, D는 **0.08배**.
2행 그룹은 구조적으로 취소와 결합돼 있다(우연한 자연키 충돌이 아니다).

## 3. TYPE B quantification

| 항목 | 값 |
| --- | ---: |
| pair 수 | **7,216** |
| apartment(aptSeq) 수 | 1,728 |
| month 수 | 80 |
| district 수 | 16 / 16 |
| 최근 24개월(2024-09~) | **2,767** |
| 2020-02 ~ 2024-08 | **4,449** |

연도별 pair: 2020 **2,063** · 2021 934 · 2022 331 · 2023 501 · 2024 996 · 2025 **1,726** · 2026 665.
2020년 집중은 **해제신고 의무화(부동산거래신고법 제3조의2, 2020-02-21 시행)** 시점과 정확히 겹친다.

구별 pair: 해운대 26350 **1,036** · 부산진 26230 925 · 북구 26320 646 · 사상 26470 612 ·
동래 26260 610 · 남구 26290 572 · 연제 26500 489 · 사하 26380 409 · 금정 26410 406 ·
기장 26710 381 · 강서 26440 328 · 수영 26530 297 · 영도 26200 222 · 서구 26140 132 ·
동구 26170 117 · 중구 26110 34.

## 4. Field-by-field comparison

TYPE B pair의 두 **source** 행 전 필드 비교(325 pair):

| 필드 | 다른 pair |
| --- | ---: |
| `cdealType` / `cdealDay` | **325 / 325 (100%)** |
| `rgstDate` | 상시(§5) |
| `aptDong` | 111 (전부 "한쪽만 채워짐") |
| `estateAgentSggNm` | 3 |
| `dealingGbn` 1 · `slerGbn` 1 | 각 1 |
| `aptSeq`·`aptNm`·`umdNm`·`jibun`·`bonbun`·`bubun`·`roadNm`·`buildYear`·`excluUseAr`·`dealAmount`·`dealYear/Month/Day`·`floor`·`buyerGbn`·`landLeaseholdGbn` | **0** |

### `aptDong`은 호실 구분자가 아니다

정밀 분해(301 pair): 둘 다 비어있음 137 · 한쪽만 164 · **둘 다 채워짐+동일 0** ·
**둘 다 채워짐+상이 0**. 대조군 TYPE D는 `둘 다 채워짐+동일`이 10건 존재한다.

공공데이터포털 API 공개 안내 원문이 이유를 설명한다:

> 공개내용 중 개인정보보호를 위해 아파트의 층정보만 제공되며, **소유권 이전등기 완료된 건에
> 한하여 동정보가 추가적으로 공개**됩니다.

즉 `aptDong`은 **등기완료 표식**이며 취소 행은 등기가 불가능해 영원히 비어 있다.
"한쪽만 채워짐"은 두 가설 모두가 예측하는 형태라 **판별력이 없다**.

**결론: 취소행/정상행을 구분하는 source-level identifier는 `cdealType`/`cdealDay` 외에 없다.
정정(correction) 표식 필드는 존재하지 않는다.**

## 5. Re-sale vs cancellation — 판별 가능성

### 5.1 2행 생성 메커니즘 — `source alone cannot disambiguate`

감사 초기에 "TYPE B = 신고 정정/재신고"라는 해석을 세웠으나 **공식 자료 검증에서 철회했다.**
부동산 거래신고 등에 관한 법률 시행규칙 제5조상 **정정신청·변경신고는 기존 기록을
수정(in-place)하고 신고필증을 재발급하는 절차**여서 새 행을 만들지 않으며, 가격 오류는
변경신고 대상이지 해제+재신고 대상이 아니다. TYPE B pair는 공개 필드가 전부 동일하므로
정정으로 설명되지 않는다.

**왜 2행이 생기는지에 대한 공식 근거를 찾지 못했다. 추측하지 않는다.**

### 5.2 그러나 "uncanceled 행이 실제 거래인가"는 2023년 이후 확정된다

`rgstDate` 공개는 **2023-01-01 이후 체결 계약부터**다(국토부-대법원 등기정보 연계).
실측이 정확히 일치한다: 2020~2022 **0.0%** / 2023 94.3% / 2024 93.3% / 2025 91.2% / 2026 42.9%.

| 연도 | TYPE B pairs | uncanceled 행 **등기 완료** | canceled 행 등기 완료 | 일반 유효거래 기준선 |
| --- | ---: | ---: | ---: | ---: |
| 2023 | 17 | **17 (100%)** | **0** | 99.2% |
| 2024 | 50 | **50 (100%)** | **0** | 99.6% |
| 2025 | 94 | **93 (98.9%)** | **0** | 99.4% |
| 2026 | 43 | 22 (51.2%) | **0** | 44.5% |
| 2020~2022 | 97 | 판별 불가(원천 미공개) | — | — |

**취소된 계약은 소유권 이전등기가 될 수 없다.** TYPE B의 uncanceled 행은 일반 유효거래와
통계적으로 구분되지 않는 비율로 등기가 완료됐고, **canceled 행이 등기된 사례는 0건**이다.

부수 신호: 취소 지연 분포가 TYPE A(p50 1.15 / p90 **11.66**개월)와
TYPE B(p50 0.69 / p90 **2.40**개월)로 뚜렷이 다르다. 원인은 미상이다.

### 5.3 2020~2022는 영구 UNVERIFIABLE

해당 구간(3,328 pair)은 원천이 `registryDate`·`aptDong`을 **아예 공개하지 않는다**.
재수집·재조회 어느 것으로도 해소되지 않는다. 역대 최고가가 BLOCKED인 것과 같은 원칙으로
**영구 검증 불가**로 확정한다.

## 6. Temporal recheck

TYPE B 28 pair(연도별 최고가 2 + 최저가 2 × 2020~2026, 26개 셀, 13개 구)를 원천에서 재조회:

- **28 / 28 pair가 지금도 원천에 2행 그대로 존재** — 1행으로 합쳐진 사례 0, 사라진 사례 0
- 차이는 `cdealType`/`cdealDay`(+등기 연계 필드)뿐

원천은 이 2행 구조를 **영구 유지**한다(5년 전 데이터도 동일).

## 7. DB representation

| occurrence | canceled | rows |
| --- | --- | ---: |
| 0 | false | **7,006** |
| 1 | **true** | **7,006** |
| 0 | true | 210 |
| 1 | false | 210 |

97.1%에서 취소행이 뒤(occurrence 1)에 온다. pair 내
`aptName`/`dong`/`jibun`/`buildYear`/`aptSeq`/`lawdCd` 불일치는 **0건**.

## 8. Query call graph

`!dealCanceled` 필터를 쓰는 실제 소비 경로(전수 grep) — **모두 TYPE B의 uncanceled 행을 포함한다**:

- 공통 게이트 `src/lib/regional-feed.ts:187`
- 읽기 코어 `src/lib/trade-history-read.ts`
- API `api/transactions:46` · `stats/dashboard:346,415` · `stats/feed:242-249`(신고가/추세) ·
  `stats/gap-invest:145` · `stats/large-complex:100` · `stats/price-rankings:232` ·
  `stats/region-change:108` · `apt/[name]:157` · `school/[id]:203`
- lib `apartment-score/collectors/market.ts:64` · `compare-v2/metrics.ts:29` ·
  `gap-invest-calc.ts:92,183` · `school-trade-price.ts:34`
- UI `map/page.tsx:359` · `TransactionFeedView.tsx:285`(취소 배지)

§5 판정에 따르면 **이 포함은 올바른 동작이다.**

## 9. 영향 — 최악 가정 상한

아래는 "TYPE B uncanceled가 전부 유령이었다면"의 **상한**이며, 증거는 그 반대를 가리킨다.
실제 필요한 보정이 아니라 위험의 크기를 못박기 위한 수치다.

**record-high (rolling 24m)**: 그룹 9,273 · 최고가 하락 215 · 그룹 소멸 103 → **3.43% 영향**
**record-high (2020-02~)**: 그룹 15,186 · 최고가 하락 275 · 그룹 소멸 79 → **2.33%** ·
최근거래 변경 373(**2.46%**)

**거래량/가격**: 유효행 대비 비중 전체 3.14% / 최근 24개월 **4.36%** / 2020-02~2024-08 2.67%.
부산 전체(24m) 평균 43,289→42,778(**−1.18%**), 중앙값 36,000→35,600.
전체기간 평균 37,192→36,915(−0.74%).

대표 3개 구(24m): 해운대 26350 4.75% / 평균 **−1.80%** · 동래 26260 5.47% / −0.83% ·
부산진 26230 3.97% / −0.44%. 최대 비중은 연제 26500 **6.32%**.

## 10. Fix options — 설계 비교(구현하지 않음)

| | A. query-time pairing exclusion | B. ingestion-time pair linkage | C. canonical event model | D. pair의 uncanceled도 effective-canceled | **E. unresolved 보존(채택)** |
| --- | --- | --- | --- | --- | --- |
| false positive 위험 | 높음(TYPE D 561건 오탈락) | 중 | 낮음 | **매우 높음** | 없음 |
| **실거래 손실 위험** | 높음 | 중 | 낮음 | **최대 — 등기완료 실거래 ~7,216건 삭제** | **없음** |
| identity 안전성 | 유지 | 유지 | 재설계 필요 | 유지 | 유지 |
| migration | 없음 | 컬럼 추가(승인) | 대규모(승인) | 대규모 | 없음 |
| 과거 보정 비용 | 없음 | 중 | 매우 큼 | 매우 큼 | 없음 |
| query 복잡도 | **크게 증가**(전 집계 경로) | 낮음 | 중 | 낮음 | 없음 |
| record-high 정확도 | **악화** | 개선 없음(이미 정확) | 동일 | **심각히 악화** | 현행 유지 |

**A·B·C·D 모두 현재 정확한 데이터를 훼손한다. E를 채택한다.**

## 11. Trust verdict

| 기능 | 판정 | 근거 |
| --- | --- | --- |
| rolling 24m record-high | **READY** | 이 창은 등기 공개 구간과 완전히 겹침. TYPE B uncanceled 등기율 98.9~100% = 일반 유효거래와 동일 |
| 2020-02 이후 long-term record-high | **LIMITED (영구)** | 2022년 이전은 공식적으로 등기·동 미공개 → 추가 조사로도 해소 불가. 상한 영향 2.33% |
| transaction list | **READY** | 취소 건은 배지와 함께 노출, TYPE B 행은 실거래 |
| 거래량 / statistics | **READY**(24m) / **LIMITED**(2022 이전 포함 구간) | 상한 영향 거래량 3.14~4.36%, 평균 −0.74~−1.18% |
| SALE cancellation coverage | **FINAL PASS 유지** | recheck sweep이 원천을 1:1 미러링. 법 제3조의2 30일 해제신고 의무가 3~12개월 band 설계를 뒷받침 |

`DATA_FRESHNESS_AUTOMATION_V1` / `SALE_CANCELLATION_COVERAGE_V1`의 기존 FINAL PASS 판정은
**수정하지 않는다**.

## 12. 결정 사항 (구속력 있음)

- **TYPE B pair의 병합·삭제·`dealCanceled` 변경을 금지한다.** 등기로 성립이 확인된
  실거래를 지우게 된다.
- Production 보정 **불필요**. schema 변경 **불필요**.
- 2020~2022 구간은 **영구 UNVERIFIABLE**로 표기하고 추가 조사 STEP을 만들지 않는다.

## 13. 남은 미해결 항목

- **2행 생성 메커니즘은 공식 문서로 확인되지 않았다.** 국토부
  「아파트 매매 실거래가 자료 기술문서(.hwp)」는 포털 다운로드 방식이라 이번 감사에서
  열지 못했다 → **외부 공식 문서 확인 필요**. 담당 부서(부동산소비자보호기획단)에
  "해제 신고 건이 원 신고 건과 별도 행으로 공개되는가"를 질의하면 확정할 수 있다.
- `aptDong`은 여전히 저장하지 않는다(additive schema 변경 범위 — 별도 승인 대상).

## 14. 측정 범위 고지

- DB-side: 부산 2020-02 이후 **246,126행 전수**
- source-side: **69셀 / 11,692행 표본**(셀 내부는 전수, 셀 선택은 표본) + 28 pair 시계열 재조회
- 관련 문서: `SALE_CANCELLATION_COVERAGE_V1.md`, `RECORD_HIGH_TRUST_V1_CANCELLATION_AUDIT.md`,
  `TRADE_HISTORY_DATA_V1.md` §6/§7(아래 정정 각주 참고),
  `TRADE_REGISTRY_DATA_V1_1_SELFHEAL.md`
