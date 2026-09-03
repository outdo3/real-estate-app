# RECORD HIGH TRUST V2 — CAPPED CELL RECOVERY DRY-RUN

- 상태: **DRY-RUN 완료 (READ ONLY)** — Production INSERT/UPDATE/DELETE **0건**
- 실행일: 2026-09-03
- 스크립트: `scripts/record-high-trust/capped-cell-recovery-dryrun.ts`,
  `scripts/record-high-trust/boundary-and-broader-cap-check.ts` (둘 다 write 호출 없음)
- 무변경 증거: 실행 전후 부산 sale rows **855,424 동일**, 정확히 1000행인 셀 **23개 유지**

---

## 1. 23 CELL EXACT LIST

| # | lawdCd/dealYmd | 구간 | DB rows | source totalCount | pages | 누락 | pagination |
|---:|---|---|---:|---:|---:|---:|---|
| 1 | 26320/200611 | A | 1,000 | 1,606 | 2 | 606 | COMPLETE |
| 2 | 26350/200803 | A | 1,000 | 1,031 | 2 | 31 | COMPLETE |
| 3 | 26350/200908 | A | 1,000 | 1,007 | 2 | 7 | COMPLETE |
| 4 | 26350/201011 | A | 1,000 | 1,029 | 2 | 29 | COMPLETE |
| 5 | 26350/201409 | A | 1,000 | 1,038 | 2 | 38 | COMPLETE |
| 6 | 26350/201503 | A | 1,000 | 1,275 | 2 | 275 | COMPLETE |
| 7 | 26350/201504 | A | 1,000 | 1,096 | 2 | 96 | COMPLETE |
| 8 | 26350/201505 | A | 1,000 | 1,013 | 2 | 13 | COMPLETE |
| 9 | 26350/201506 | A | 1,000 | 1,321 | 2 | 321 | COMPLETE |
| 10 | 26350/201507 | A | 1,000 | 1,269 | 2 | 269 | COMPLETE |
| 11 | 26350/201510 | A | 1,000 | 1,272 | 2 | 272 | COMPLETE |
| 12 | 26350/201911 | A | 1,000 | 1,891 | 2 | 891 | COMPLETE |
| 13 | 26230/202006 | B | 1,000 | 1,093 | 2 | 93 | COMPLETE |
| 14 | 26350/202006 | B | 1,000 | 1,924 | 2 | 924 | COMPLETE |
| 15 | 26350/202007 | B | 1,000 | 1,332 | 2 | 332 | COMPLETE |
| 16 | 26350/202009 | B | 1,000 | 1,154 | 2 | 154 | COMPLETE |
| 17 | 26260/202010 | B | 1,000 | 1,064 | 2 | 64 | COMPLETE |
| 18 | 26230/202010 | B | 1,000 | 1,419 | 2 | 419 | COMPLETE |
| 19 | **26350/202010** | B | 1,000 | **2,442** | **3** | **1,442** | COMPLETE |
| 20 | 26230/202011 | B | 1,000 | 1,633 | 2 | 633 | COMPLETE |
| 21 | 26320/202011 | B | 1,000 | 1,428 | 2 | 428 | COMPLETE |
| 22 | 26350/202011 | B | 1,000 | 1,657 | 2 | 657 | COMPLETE |
| 23 | 26380/202011 | B | 1,000 | 1,452 | 2 | 452 | COMPLETE |
| | **합계** | | **23,000** | **31,446** | 47 | **8,446** | **23/23** |

감사(V1)의 추정치 8,446과 **정확히 일치**한다.

## 2. Pagination completeness (§3)

23/23 셀 모두 COMPLETE. 검증 항목 전부 통과:
- `fetched == totalCount` (23/23)
- 페이지 간 내용 중복 없음 (pageNo 무시 버그 없음)
- 페이지 누락 없음
- 운영 fetcher `fetchSaleRegionMonth()` 교차검증: status=COMPLETE, collectedCount==totalCount (23/23)
- 정규화 탈락(invalid) **0건**

## 3. occurrenceIndex 안정성 (§4) — 핵심 결과

### 3.1 집계 결과

| 분류 | 건수 |
|---|---:|
| **A** exact natural-key match | **23,000** (= DB 전량) |
| **B** 자연키 다름 + 물리적 동일거래 의심 | **0** |
| **C** genuinely new missing transaction | **8,446** |
| **D** ambiguous / conflict | **0** |

DB 23,000행이 **한 행도 빠짐없이** source의 자연키와 일치했다. bucket 분석에서도
occurrenceIndex 불연속/중복 0건, `nDb > nSrc`인 bucket 0건.

### 3.2 position 단위 경계 검증 (§5)

집계만으로는 "우연히 수가 맞은 것"과 구분되지 않으므로, source 응답을 **등장 순서대로**
훑으며 각 position이 DB에 있는지 직접 표시했다.

| 셀 | srcRows | dbRows | 첫 unmatched position | 마지막 matched position | 경계 표본 |
|---|---:|---:|---:|---:|---|
| 26350/202010 (worst, 3 pages) | 2,442 | 1,000 | **1000** | **999** | 997:DB 998:DB 999:DB 1000:-- 1001:-- 1002:-- |
| 26320/200611 (A구간 최대) | 1,606 | 1,000 | **1000** | **999** | 동일 |
| 26350/200908 (누락 최소 7건) | 1,007 | 1,000 | **1000** | **999** | 동일 |

**해석:** DB는 source 응답의 position 0~999와 **순서까지 정확히 동일**하고, 신규 후보는
전부 position 1000 이상이다. 즉 **MOLIT의 응답 순서는 수년(2006년 데이터 포함)에 걸쳐
안정적이며, occurrenceIndex는 재현 가능하다.** 이것이 이번 DRY-RUN이 확인해야 했던 최대 위험이었고,
"unique index가 알아서 막아줄 것"이라는 가정에 의존하지 않고 **실측으로** 해소했다.

## 4. Duplicate detection (§5)

가상 INSERT 후 동일 거래 중복이 생기는지 두 층위로 검사:
1. 자연키 충돌: 신규 후보 8,446건 중 기존 자연키와 충돌 **0건**
2. 물리적 서명 `(aptSeq, dealDate, dealAmount, floor, exclusiveArea)` 기준 중복 **0건**
   — 자연키가 달라도 현실의 같은 거래인 경우를 잡기 위한 별도 검사

`groupKeyStr`가 `id:{aptSeq}::{area}::sale`이고 신규 후보 전량이 aptSeq를 가지므로,
name/dong 표기 변화로 groupKey가 갈라질 수 있는 경로(aptSeq NULL 케이스)는 발생하지 않았다.

## 5. Identity (§6)

| 항목 | 결과 |
|---|---|
| aptSeq NOT NULL | **8,446 / 8,446 (100%)** |
| lawdCd 일치 | 전량 일치 (요청 셀 단위 fetch) |
| name-only fallback | **0건** |
| 다른 단지 fallback | **0건** |
| aptSeq 미매칭으로 BLOCKED | **0건** |

## 6. Cancellation semantics (§7)

| 구간 | 신규 후보 | source에서 canceled=true | 비고 |
|---|---:|---:|---|
| A (2006-01~2020-01) | 2,848 | **0** | 원천에 취소 데이터 자체가 없음 |
| B (2020-02~2024-08) | 5,598 | **629** | 원천 상태 그대로 보존 |
| 합계 | 8,446 | 629 | |

- **A구간 신규 2,848건은 `dealCanceled=false`로 들어가지만 이는 "취소 아님"이 아니라
  "알 수 없음"이다.** 기존 A구간 614,994행과 동일한 한계이며, 이번 작업이 이 한계를
  악화시키지도 개선하지도 않는다. A구간을 근거로 한 취소 관련 주장은 계속 금지.
- B구간은 원천이 취소 필드를 제공하므로 신규 629건은 **삽입 시점부터 정확한 취소 상태**를
  갖는다. 이 셀들이 과거에 취소 resync 대상이 아니었다는 점을 감안하면, 지금 넣는 편이
  나중에 넣는 것보다 정확하다.
- 이번 DRY-RUN에서 **기존 row의 cancellation mutation은 일절 하지 않았고**, apply 계획에도 없다.

## 7. Broader hidden-cap check (§9)

부산 sale 셀 총 **3,973개**. 이 중 DB count가 정확히 1000인 23개를 제외한 3,950개에서
**표본 200개**(DB count 상위 120 + 무작위 80)를 뽑아 source `totalCount`만 조회(경량).

| 항목 | 결과 |
|---|---|
| 검사한 셀 | 200 |
| `source > DB`인 셀 | **0개 (0.0%)** |
| 표본 내 누락 합계 | **0행** |
| DB 900~999인 "숨은 cap 의심" 셀 | **0개** |

**해석:** 1000 미만에서 조용히 끊긴 셀의 증거는 표본에서 발견되지 않았다. 늦은 신고
(late report)로 인한 소규모 누락조차 0이었다는 점은 일상 sync가 잘 돌고 있다는 방증이다.

**단, 이것은 5.0% 표본이며 전수 증명이 아니다.** 전수 확인은 3,973회 API 호출(약 20분)이
필요하므로 이번 STEP에서 실행하지 않았다. 별도 STEP으로 제안한다(§10).

## 8. 성능 실측 (§10)

| 항목 | 값 |
|---|---|
| DRY-RUN runtime | **110.3초** (23셀, 페이지 분리 fetch + 운영 fetcher 교차검증 이중 수행) |
| API calls | **94** (자체 47 + 운영 fetcher 47) |
| fetched rows | 31,446 × 2 (이중 fetch) |
| DB reads | 23,000행 (좁은 select 11컬럼) |
| broader check runtime | 54.0초 / API 200회 |
| 예상 write volume (apply 시) | INSERT 8,446 / UPDATE 0 / DELETE 0 |

apply 실제 실행은 이중 fetch가 불필요하므로 **47회 호출, 약 60초 + INSERT 시간**으로 추정.
Production Lambda 미사용 — controlled local CLI 기준.

## 9. 실제 제품 영향 (정직한 평가)

**이 복구는 현재 라이브 화면을 하나도 바꾸지 않는다.**

누락 8,446건은 전부 2006-11 ~ 2020-11 구간이고, 라이브 read path는 모두 12~24개월로
제한돼 있다(`candidateFromDate()` = 24개월, `/api/transactions` = 12개월).
무제한 조회 함수 `getTradeHistory()`/`getAllTimeHigh()`는 **`src/`에 호출부가 0건**이다.

따라서 이 작업의 가치는 "지금 보이는 버그 수정"이 아니라:
1. **데이터 진실성** — DB가 원천과 일치해야 한다는 원칙 자체
2. **장기 이력 기능의 전제조건** — 2020-02 이후 구간 주장을 하려면 먼저 완전해야 한다
3. **B구간 629건의 취소 상태**를 지금 정확히 확보

그리고 같은 이유로 **회귀 위험도 매우 낮다** — 라이브 기능이 읽지 않는 구간이다.

## 10. 다음 단계 제안

1. **RECORD HIGH TRUST V2 APPLY** (승인 필요) — 23셀 INSERT 8,446건.
   dry-run이 clean이므로 `createMany({skipDuplicates:true})`로 안전.
   apply 후 즉시 재검증(각 셀 count == totalCount) 권장.
2. **FULL CAP SWEEP** (별도 STEP) — 부산 3,973셀 전수 `totalCount` 대조(약 20분, read only).
   표본 200개가 깨끗했으므로 우선순위는 낮으나, "전수 확인함"이라는 근거를 남길 가치는 있다.
3. V1에서 제안한 **옵션 C (취소 lag 커버리지 3→12개월)** — 유일하게 진행 중인 신뢰 저하.
