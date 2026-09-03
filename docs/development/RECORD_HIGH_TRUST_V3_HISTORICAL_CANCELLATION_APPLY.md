# RECORD HIGH TRUST V3 — HISTORICAL CANCELLATION RESYNC APPLY

- 상태: **APPLY 완료 / 전 항목 검증 통과**
- 실행일: 2026-09-03
- 승인 범위: 부산 16개 구 × 2020-02~2024-08 (880 cells), UPDATE 최대 10,852행
- 실제 결과: **UPDATE 10,852 / INSERT 0 / DELETE 0**
- 실행 환경: controlled local CLI (Vercel Lambda 미사용)
- 스크립트: `scripts/record-high-trust/historical-cancellation-apply.ts`

---

## 1. HARD WRITE GATE

**INSERT는 코드 구조로 불가능하다** — apply 스크립트에 `create` / `createMany` / `upsert` /
`delete` 호출이 **존재하지 않는다**. 유일한 write는 `prisma.apartmentTradeHistory.update`이고
`data` 절에 `dealCanceled / cancelDate / registryDate / sourceFetchedAt` 외에는 아무것도 없다.
따라서 aptSeq·dealAmount·dealDate·exclusiveArea·floor·identity는 변경될 수 없다.

legacy `upsertRows()`(backfill-trade-history.ts)는 사용하지 않았다(§8 준수).

write 직전 880셀 전수를 다시 조회해 게이트를 통과해야만 write가 시작된다:

| 게이트 | 기대 | 실측 | |
| --- | ---: | ---: | --- |
| COMPLETE cells | 880 | **880** | PASS |
| blocked cells | 0 | **0** | PASS |
| false→true candidates | 10,852 | **10,852** | PASS |
| **INSERT candidates** | **0** | **0** | PASS |
| reverse true→false | 0 | **0** | PASS |
| other mutation | 0 | **0** | PASS |
| cancelDate 누락 | 0 | **0** | PASS |
| DB-only | 알려진 1건 | **알려진 1건** | PASS |

`APPROVED_MAX_UPDATES = 10852` 상한과 `APPROVED_MAX_INSERTS = 0`을 코드에 하드코딩했고,
예상치에서 ±20을 넘게 벗어나도 STOP하도록 했다.

## 2. PRE-APPLY REVALIDATION

| 항목 | 값 |
| --- | ---: |
| COMPLETE cells | 880 / 880 |
| source rows fetched | 177,980 |
| DB rows matched | 177,980 |
| false→true candidates | 10,852 |
| already canceled | 629 |
| unchanged valid | 166,499 |
| reverse / INSERT / mutation | 0 / 0 / 0 |
| affected cells | 836 |

DRY-RUN과 완전히 동일한 수치가 재현됐다.

**DB-only 1건** (`26350/202104 현대아쿠아팰리스동백섬 137.32㎡ 75,000 2021-04-02 7층)`은
UPDATE 대상에서 제외하고 **그대로 보존**했다. DELETE 하지 않았다.

## 3. APPLY

`prisma.$transaction` 500행 청크로 10,852건 UPDATE. `TOTAL UPDATED: 10,852`.

## 4. POST-APPLY VERIFICATION

| 항목 | 기대 | 실측 |
| --- | ---: | ---: |
| actual UPDATE | 10,852 | **10,852** |
| INSERT | 0 | **0** |
| DELETE | 0 | **0** |
| B구간 total rows | 177,981 (불변) | **177,981** |
| B구간 canceled | 11,481 | **11,481** |
| canceled without cancelDate | 0 | **0** |

identity/필드 불변 검증 (B구간 177,981행 전수):
`aptSeq NULL 0`, `name-only fallback 0`, `bad dealAmount 0`, `exclusiveArea NULL 0`, `floor NULL 0`.

## 5. SOURCE ↔ DB RECHECK (apply 후 880셀 전수 재조회)

| 항목 | 목표 | 실측 |
| --- | ---: | ---: |
| DB=false / source=true | 0 | **0** |
| DB=true / source=true | 11,481 | **11,481** |
| DB=true / source=false | 0 | **0** |
| source-only | 0 | **0** |
| DB-only | 기존 1건 | **1** |
| other field mismatch | 0 | **0** |
| COMPLETE cells | 880 | **880** |

## 6. 멱등성

재검증 결과 **would UPDATE = 0 / would INSERT = 0 / would DELETE = 0**
(`false→true candidates: 0`, `affected cells: 0`). 두 번째 write run은 불필요하므로 실행하지 않았다.

## 7. RECORD-HIGH 영향

### 7.1 현재 rolling 24개월 — **semantic diff = 0**

구조적으로: 이번에 취소로 바뀐 행 중 `deal_date >= 오늘 − 24개월`인 행 **0건**.

실측으로: Production `/api/stats/price-rankings?mode=record-high&lawdCd=26350&period=30d`를
V2 apply 직후 캡처값과 비교했다.

| 항목 | V2 직후 | V3 apply 후 |
| --- | --- | --- |
| rows | 19 | **19** |
| priorHighDate 범위 | 2024-10-02 ~ 2026-08-04 | **2024-10-02 ~ 2026-08-04** |
| 첫 행 current / prior / priorHighDate | 24,000 / 23,950 / 2026-03-25 | **24,000 / 23,950 / 2026-03-25** |
| 2024-09-03 이전 참조 | 0 | **0** |

**완전 동일 — 회귀 없음.**

### 7.2 장기(2020-02~) 최고가 보정 — 실제 효과

이번 flip이 닿은 group(단지 identity + 정확한 전용면적) **4,479개**에 대해,
flip 전후의 "취소되지 않은 거래 기준 최고가"를 비교했다.

| 항목 | 값 |
| --- | ---: |
| flip이 닿은 group | 4,479 |
| **유효최고가가 실제로 낮아진 group** | **194** |
| 2020-02 이후 유효거래가 아예 남지 않은 group | 43 |
| 평균 하락폭 | 5,386만원 |
| **최대 하락폭** | **277,552만원 (27.8억)** |

보정폭 상위:

| 단지 | 기존 최고가 | 보정 후 | 하락 |
| --- | ---: | ---: | ---: |
| 해운대 I PARK | 700,000 | **422,448** | -277,552 |
| 대동맨션 | 51,100 | 17,000 | -34,100 |
| 대동맨션 | 51,270 | 17,200 | -34,070 |
| 해운대 I PARK | 239,000 | 207,500 | -31,500 |
| 동래래미안아이파크 | 54,500 | 24,500 | -30,000 |
| 명륜동힐스테이트 | 123,500 | 100,000 | -23,500 |

**DRY-RUN의 "946건"과 이 "194 group"의 관계(정정):** DRY-RUN 지표는 후보가 자기 그룹의
당시 유효최고가와 **같거나 그 이상**(`>=`)인 건수였다. 동일 금액의 다른 유효거래가 있으면
취소 처리해도 표시 최고가는 그대로다. 실제로 **최고가가 내려간 것은 194개 group**이며,
946은 "왜곡 후보"의 상한이었다. apply 후 재검증에서 `장기 최고가 왜곡 후보 = 0`으로
전부 해소됐다.

## 8. LEGACY SCRIPT SAFETY

이번 APPLY에서 `backfill-trade-history.ts` / `sync-trade-history.ts`의 legacy `upsertRows()`를
**사용하지 않았다**. 전용 UPDATE-only 스크립트를 새로 썼다.

두 스크립트의 true→false overwrite 가능성은 **여전히 남아 있으며 다음 STEP P1으로 유지**한다.
이번 단계에서 리팩터링하지 않았다. 다만 노출도는 커졌다 — apply 전 B구간 취소는 629건이었으나
지금은 **11,481건**이므로, 만약 원천이 어떤 거래를 un-cancel하면 되돌려질 수 있는 행이 18배로 늘었다.
(단, V2+V3 누적 약 209,000행 비교에서 원천 un-cancel은 **0건** 관측.)

## 9. PRODUCTION DB SIZE

| | before | after | delta |
| --- | --- | --- | ---: |
| table rows | 864,002 | **864,002** | **0** (UPDATE only) |
| table total | 468 MB | 472 MB | +3.9 MB |
| DB total | 553 MB | 557 MB | +3.9 MB |

**+3.9MB는 신규 데이터가 아니라 Postgres MVCC dead tuple이다** — `pg_stat_user_tables`에서
`n_live_tup 864,002 / n_dead_tup 51,948`. UPDATE는 새 row 버전을 만들고 구버전을 dead tuple로
남기며, autovacuum이 회수한다(마지막 autovacuum 2026-08-29). row 수 증가는 0이므로
**unexpected growth 아님**. 용량 때문에 데이터 삭제나 인덱스 변경은 하지 않았다.

## 10. LIVE REGRESSION

`https://real-estate-app-phi-taupe.vercel.app` (icn1) — 전부 HTTP 200:
`/`, `/map`, `/ai-search`, `/stats`, `/stats/record-high`, `/stats/compare`,
`/api/transactions`, `/api/stats/dashboard`, `/api/stats/price-rankings`(area84·decline),
`/api/search`.

Production 에러 **0건**.

## 11. TRUST STATE (갱신)

| 판정 | 대상 | 변화 |
| --- | --- | --- |
| **READY** | current rolling 24-month 최고가 | 유지 (semantic diff 0) |
| **READY (신규)** | **2020-02 ~ 2024-08 cancellation completeness** | LIMITED → **READY**. 880셀 전수 원천 일치, stale 0 |
| **BLOCKED** | 2006~현재 절대적 "역대 최고가 100% 취소검증" | 유지 — 2020-02 이전은 원천에 데이터 부재 |

**"2020-02 이후" 장기 최고가 기능은 이제 데이터 근거를 갖췄다.** 단 여전히 "역대"가 아니라
"2020년 이후"로 범위를 명시해야 한다.

## 12. 남은 gap

1. **A구간(2006-01~2020-01) 취소 영구 불가** — 원천에 데이터 자체가 없음. 이 구간을 포함한
   "역대" 주장은 계속 금지.
2. **진행형 lag 누락** — cron overlap 3개월 대비 취소의 10.5%가 3개월 이후 발생(V1 §6).
   연 ~250건 누적. **apply 이후에도 계속 쌓이는 유일한 항목.**
3. **legacy backfill 역전 위험** — P1 유지, 노출도는 18배 증가(§8).
4. **원천 소멸 거래 1건** — `26350/202104`, 보존 중, 사유 미확인.
5. **전수 cap sweep 미실행** — 부산 3,973셀 totalCount 대조(표본 200셀은 clean).
6. **부산 외 지역** — 이번 범위 밖.

## 13. 다음 단계 제안

1. **옵션 C — cron overlap 3→12개월** (승인 필요). 유일하게 진행 중인 신뢰 저하이며,
   방치하면 이번에 맞춘 상태가 다시 어긋난다. 우선순위 최상.
2. **legacy backfill fail-safe** (P1) — `upsertRows` 다운그레이드 차단 + BACKFILL 가드 적용.
3. **장기 최고가 기능 설계** — 이제 2020-02~ 구간 데이터가 신뢰 가능하므로 가능. 단
   "역대"가 아닌 "2020년 이후" 라벨 필수.
4. **FULL CAP SWEEP** (read only).
