# E-JIP BUILDING LEDGER UNKNOWN SOURCE TRUST AUDIT V1

`basic_spec_source = UNKNOWN`으로 남은 부산 master 724건을 현재 safe pager + 확정된 field policy로 재평가한다.

- 날짜: 2026-09-20 (KST) · 기준 커밋 `f0b02e0`
- **Production INSERT / UPDATE / DELETE 0** — master 0 · 캐시 0 · 좌표 0 · 서울 0 · sale 0 · cancellation 0 · schema 0 · runtime `src/` 0
- 대장 GET 878회(읽기)

## 판정

**PARTIAL** — 724건 중 **676건**을 완전히 평가했다. 나머지 48건은 평가하지 못했고, **조용히 제외하지 않고 명시적으로 남긴다**:

| 미평가 사유 | 건수 |
|---|---|
| **NO_LOT_KEY** — 지번을 파싱할 수 없거나 법정동 코드가 없어 **조회 자체가 불가** | **45** |
| **PARTIAL** — 상류 API 간헐 오류로 완전한 응답을 받지 못함 | **3** |

STOP 규칙("미해결 조회 실패가 남으면 중단")에 따라 PASS로 올리지 않는다.

---

## 1. UNKNOWN baseline

| 항목 | 값 |
|---|---|
| 부산 UNKNOWN master | **724** (예상과 일치) |

필드별 저장값 보유(**빈 문자열은 값으로 세지 않는다**):

| 필드 | 보유 |
|---|---|
| households | **535** |
| roadAddress | **553** (+ 빈 문자열 저장 **47**) |
| mgmBldrgstPk | **600** |
| buildingCount | 386 |
| approvalDate | 11 |
| **parking** | **7** |
| **parkingPerHousehold** | **0** |
| **FAR** | **0** |
| **BCR** | **0** |
| 좌표 | 722 |
| **대장 파생값을 하나라도 보유** | **600** |

> 앞 STEP에서 roadAddress를 600건으로 보고했는데, 그중 **47건은 빈 문자열**이었다. 실제 값은 **553건**이다. 정정한다. (이전에도 같은 종류의 허수가 있었다 — 빈 문자열을 값으로 세는 실수는 이 데이터셋에서 반복된다.)

## 2. Provenance 복원

`mgmBldrgstPk` 자릿수와 필드 조합으로 분류했다(확정이 아니라 분류다):

| 분류 | 건수 | 근거 |
|---|---|---|
| **LEGACY_BUILDING_LEDGER_TITLE** | **583** | PK 9~10자리 = 표제부 계열. FAR/BCR이 전혀 없어 현재 backfill 경로의 산출물이 아니다 |
| LEGACY_BUILDING_LEDGER_RECAP | 17 | PK 20자리 이상 또는 `mainBuildingCount` 보유(총괄표제부에만 있는 필드) |
| UNKNOWN_REMAINS | 124 | 복원 근거 없음 |
| LIVE_HELPER_CACHE_DERIVED / HISTORICAL_IMPORT / MANUAL_OR_OTHER | 0 | 해당 없음 |

**결론: 출처 미기록(provenance 누락)이지, 다른 경로의 데이터가 아니다.** 600건은 표제부 계열 PK를 갖고 있으면서 FAR/BCR이 하나도 없다 — 현재 경로라면 함께 채워졌을 값이다.

## 3~4. 재조회 결과

| 상태 | 건수 |
|---|---|
| COMPLETE | **666** |
| EMPTY(원천에 기록 없음) | **10** |
| NO_LOT_KEY | 45 |
| PARTIAL(상류 간헐 오류) | 3 |

rate limit는 실패가 아니라 대기 신호로 처리했다(백오프 5회까지). 1차 실행에서 6건, 재조회로 3건까지 줄었고, 남은 3건(`26260-3648` 래미안포레스티지1단지 · `26290-2777` 오션파라곤 · `26290-3234` 국제금융센터퀸즈W)은 **같은 요청이 어떤 때는 5·22·12건을 정상 반환하고 어떤 때는 503 / 빈 본문 / `totalCount=0`을 반환**하는 간헐 상태였다. pager는 그 상태를 COMPLETE라고 부르지 않는 것이 맞다. 세 차례 재시도 후 더 반복하지 않고 미평가로 남긴다.

## 5. 페이징 노출

| 레코드 수 | master |
|---|---|
| 1 | 163 |
| 2–5 | **392** |
| 6–10 | 76 |
| 11–20 | 28 |
| 21+ | 7 |

**다건(>1) 503건 · 75.5%** · 최대 35건. 앞선 TITLE census의 다건 비율(6.96%)과 비교하면 **10배 이상 높다** — UNKNOWN 집합이 페이징 결함에 훨씬 크게 노출돼 있었다는 뜻이다.

## 6. 저장값 vs safe 결과

**세대수**

| 판정 | 건수 |
|---|---|
| UNCHANGED | **458** |
| SAFE_VALUE_DIFF | **57** |
| NEW_SAFE_VALUE_AVAILABLE(저장값 없음) | 125 |
| REVIEW_REQUIRED | 22 |
| STORED_BUT_NOW_WITHHELD | 1 |
| SOURCE_EMPTY | 3 |

**도로명**

| 판정 | 건수 |
|---|---|
| UNCHANGED | **449** |
| NEW_SAFE_VALUE_AVAILABLE | **94** |
| REVIEW_REQUIRED(도로명 복수) | 123 |
| SAFE_VALUE_DIFF | **0** |

> 집계 중 자체 버그를 하나 잡았다. `decideRoadAddress`는 **이미 일치할 때 `newValue`를 null로** 돌려준다. 그 null을 "safe 값"으로 넘겨 비교하니 일치하는 449건이 전부 `SAFE_VALUE_DIFF`로 잡혔다. 판정 자체를 읽도록 고쳤다 — **저장된 도로명이 원천과 어긋나는 건은 실제로 0건**이다.

## 7. 세대수 신뢰 census

| 분류 | 건수 |
|---|---|
| STORED_CORRECT | **458** |
| **AUTO_CORRECTABLE** | **57** |
| REVIEW_REQUIRED | 22 |
| KEEP_NULL(저장값 없음) | 125 |
| SOURCE_EMPTY | 14 |

**잘림 흔적**: 저장값이 그 지번 **개별 동 한 곳의 세대수와 정확히 일치**하는 경우 **39건**. TITLE census에서 확인된 패턴과 같다(그때는 틀린 80건 전부가 그랬다). 여기서는 틀린 57건 중 39건(68%)이다.

실측 예:

| aptSeq | 단지 | 저장 → 후보 | 레코드 |
|---|---|---|---|
| `26350-165` | 왕자 | 30 → **390** | 13 |
| `26350-153` | 그린파크 | 40 → **200** | 6 |
| `26350-157` | 삼익그린맨션 | 120 → **315** | 3 |
| `26170-10` | 화신1 | 72 → **216** | 5 |
| `26230-78` | 성암 | 40 → **130** | 4 |

## 8. 주차 신뢰 census

원천 패턴: ALL_ZERO **291** · SINGLE 278 · SAME_REPEATED_TOTAL 39 · MIXED 36 · DONG_LEVEL 22.

**저장 parking이 원천과 논리적으로 모순되는 경우: 0건.**

그리고 결정적으로 — **UNKNOWN 724건 중 parking을 저장한 것은 7건뿐**이다. 자동 수정 규칙은 그대로 없고, 고칠 대상도 사실상 없다.

## 9. 파생 주차비율

**projected 갱신 필요 건수: 0.** `parking_per_household`를 저장한 UNKNOWN master가 **한 건도 없다**.

## 10. 사용자 노출 이상치

| 임계 | 현재 |
|---|---|
| 세대당 주차 > 2.0 | **0** |
| > 5.0 | **0** |
| > 10.0 | **0** |

**UNKNOWN 집합에는 세대당 주차 이상치가 없다** — 비율을 만들 parking 자체가 거의 없기 때문이다. TITLE 집합에서 30건이었던 문제가 여기서는 존재하지 않는다.

참고로 세대수를 채운다고 가정하면 1건이 2.0을 넘는다(`26230-1861` 더샵센트럴스타, 후보 1,277세대 / 주차 3,287 = 2.57). 다만 이 건은 저장 세대수가 없는 **KEEP_NULL**이라 이번 보정 범위가 아니다.

## 11. 도로명 신뢰

| 판정 | 건수 |
|---|---|
| 저장값이 원천과 일치 | **449** |
| AUTO 채움 가능(저장 없음/빈 문자열) | **94** |
| 도로명 복수 → REVIEW | 123 |
| 저장값이 원천과 충돌 | **0** |

도로명은 identity key로 쓰지 않는다(지번이 다른데 도로명이 같은 반례가 이미 확인돼 있다).

## 12. 승인일 / FAR / BCR

| 필드 | ALL_SAME | SINGLE | DIVERGENT | ALL_EMPTY |
|---|---|---|---|---|
| 승인일 | 345 | 163 | **158** | 0 |
| FAR | 137 | 163 | 21 | **345** |
| BCR | 142 | 163 | 17 | **344** |

- **FAR / BCR**: 자동 판정 금지(기존 정책 그대로). 게다가 원천이 비어 있는 경우가 345 / 344건으로 가장 많다.
- **승인일**: ALL_SAME + SINGLE = 508건이 원천에서 단일하지만, 저장값이 있는 건 11건뿐이라 **보정이 아니라 신규 채움**이다. 앞선 정책에서 "null 채우기는 보정이 아니라 새 범위"로 정했으므로 자동 대상에 넣지 않는다.

## 13. 사용자 노출 기능

| 기능 | 노출 필드 | 영향 master |
|---|---|---|
| 단지 상세 · AI 검색 | 세대수 | **57**(틀림) + 125(비어 있음) |
| 점수 peer-context · 통계 large-complex · 학교 상세 | 세대수 | 동일 |
| 상세 주소 표기 | 도로명 | 94(비어 있음), 충돌 0 |
| 세대당 주차 | 세대수 ÷ 주차 | **0** — parking 보유가 7건뿐 |
| 리포트 · 비교 · record-high · sitemap · SEO | 거래 기반 | **영향 없음** |

## 14. 캐시 중첩

| 항목 | 값 |
|---|---|
| UNKNOWN과 겹치는 `apartments` 캐시 행 | **12** |
| 그중 tier1 게이트 충족 | **2** |
| **세대수 AUTO 57건과 겹치는 tier1 행** | **0** |
| 보정 시 가려질 위험 | **0** |

게다가 `HOUSEHOLDS_SOURCE_PRECEDENCE_HARDENING_V1` 배포 이후 세대수는 master가 이긴다.

## 15. 최종 분류

**master 단위 (724)**

| 분류 | 건수 |
|---|---|
| KEEP_CURRENT | **368** |
| REVIEW_REQUIRED | **166** |
| **AUTO_SAFE** | **128** |
| KEEP_NULL | 31 |
| PARTIAL_SAFE | 21 |
| SOURCE_EMPTY | 10 |

REVIEW 166의 구성: 도로명만 100 · **미평가 48** · 세대수만 12 · 둘 다 6.

**필드 단위**

| 필드 | AUTO 후보 |
|---|---|
| **households** | **57** |
| **roadAddress** | **94** (전부 빈 값 채움) |
| approvalDate | 508 — 단 저장값이 없어 **채움**이지 보정이 아님(자동 대상 제외) |
| parking · FAR · BCR · buildingCount | **0** |
| 파생 주차비율 | **0** |

## 16. 우선순위 분리 (실행 금지)

| 단계 | 내용 | 건수 |
|---|---|---|
| **A. 노출 심각 + AUTO** | 세대당 주차 이상치 + AUTO | **0** — 이 집합엔 이상치가 없다 |
| **B. AUTO_SAFE, 노출 낮음** | 세대수 57 · 도로명 94 | master **128** |
| C. PARTIAL_SAFE | 일부 필드만 자동 가능 | 21 |
| D. REVIEW_REQUIRED | 도로명 복수 · 세대수 근거 상충 · 미평가 48 | 166 |

**이번 STEP에서는 한 건도 실행하지 않았다.**

## 17. No-write assertion

| 항목 | 값 |
|---|---|
| Production INSERT / UPDATE / DELETE | **0 / 0 / 0** |
| master · 캐시 · 좌표 보정 | 0 · 0 · 0 |
| 서울 · sale · cancellation · schema | 0 · 0 · 0 · 0 |
| runtime `src/` 변경 | **0** |

모든 DB 접근은 `SET TRANSACTION READ ONLY`.

## 18. 테스트

```
npx tsx --test scripts/ledger-unknown-source-trust.test.mjs   14 pass / 0 fail
npx tsx --test "scripts/**/*.test.mjs" "scripts/**/*.test.ts"  590 pass / 0 fail
npx eslint (신규 3파일)                                        exit 0
npx tsc --noEmit    신규 파일 0 에러
```

## 19. Blockers · 다음 권고

1. **Blocker: 미평가 48건.** 45건은 **지번/법정동 코드가 없어 구조적으로 조회 불가**다 — 대장 조회 이전에 identity를 먼저 보강해야 하고, 이는 별도 STEP이다. 3건은 상류 간헐 오류라 시간을 두고 재조회하면 풀릴 가능성이 높다.
2. **승인 요청 대상(B)**: 세대수 **57** + 도로명 **94** = master 최대 **128**. 정책은 이미 확정된 것을 그대로 쓴다(POLICY B · 단일 도로명). 파생 주차비율 동기화는 **0건**이라 이번엔 따라붙지 않는다.
3. **기대 효과는 TITLE 때와 다르다.** 여기엔 세대당 주차 이상치가 없어서 "41.33대 같은 눈에 띄는 오류"는 없다. 대신 **세대수 57건이 한 동 값으로 축소돼 있고**(39건은 잘림 흔적이 확인됨), 단지 규모·점수·통계에 그대로 쓰인다. 왕자 30→390, 그린파크 40→200처럼 차이가 크다.
4. **provenance를 채울지는 별도 결정**이다. 보정과 함께 `basic_spec_source`를 기록하면 이 집합이 다시 census 밖으로 빠지는 일을 막을 수 있으나, 그것도 schema 값 변경이므로 승인 대상이다.
5. 남은 항목: 한보장산 1건 · 이상치 2건(송도탑스빌 3.02 · 구서쌍용스윗닷홈 2.04) · roadAddress-only REVIEW 19 · 서울 117 좌표 · 28행 false-cancel · 서울 sale apply.
