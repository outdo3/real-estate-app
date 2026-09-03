# SALE CANCELLATION COVERAGE V1 — late cancellation recheck sweep

- 상태: **설계 + 구현 + 검증 완료 / Production 배포**
- 실행일: 2026-09-03 (KST 2026-09-04)
- 선행: `RECORD_HIGH_TRUST_V1/V2/V3`, `DATA_FRESHNESS_AUTOMATION_V1_PHASE2`
- 이 STEP의 Production DB write: **0건** (모든 실측은 READ ONLY dry-run)
- schema / migration / index 변경: **0건**

---

## 1. 목적

RECORD_HIGH_TRUST_V3 §12에서 "apply 이후에도 **계속 쌓이는 유일한 항목**"으로 남긴 문제를
구조적으로 닫는다.

daily sale cron의 overlap은 **3개월**인데 실측 취소 지연의 **p99는 11.8개월**이다. 3개월
이후에 취소되는 거래는 어떤 정기 작업으로도 다시 확인되지 않아 "취소됐지만 DB에는 유효한
거래"로 영구 누적된다. V2/V3의 대규모 보정(10,852건 flip)은 그 시점의 상태를 맞춘 것일 뿐,
방치하면 **다시 어긋난다**.

---

## 2. 현행 구조 감사 (READ ONLY)

### 2.1 cron / 실행 경로

| 항목 | 값 | 근거 |
| --- | --- | --- |
| 등록된 cron | sale-sync `0 19 * * *`(04:00 KST), rent-sync `0 21 * * *`(06:00 KST) | `vercel.json` |
| sale 범위 | `latestComplete-2` ~ **현재월** (오늘 기준 202606~202609, 4개월) | `shared.ts:resolveSaleRange` |
| overlap 상수 | `SALE_DEFAULT_OVERLAP_MONTHS = 3` | `shared.ts:110` |
| cells / run | 16개 구 × 4개월 = **64** | — |
| 실측 소요 | **34.3초 / 64셀 (0.54s/cell)** | `DATA_FRESHNESS_AUTOMATION_V1_PHASE2` §13 |
| maxDuration | 60초, TimeBudget 50초 | `sale-sync/route.ts`, `sale-sync-core.ts:56` |

### 2.2 write 정책 (변경 없음, 그대로 계승)

`write-policy-logic.ts:classifyRow` 5분기 — `insert`(aptSeq 있는 신규만) /
`reviewRequired`(쓰지 않음) / `conflict`(쓰지 않음) / `updateFalseToTrue`(**승인된 유일한
UPDATE**) / `updateTrueToFalseSkipped`(**차단**).

`sale-sync-core.ts:221`의 flip write는 `dealCanceled: true`를 하드코딩하므로 구조적으로
단방향이다. repo 전체에 `apartmentTradeHistory.delete/deleteMany` 부재.

### 2.3 취소 지연 분포 (V1 §6 재사용 — 재측정하지 않음)

검증된 C구간 취소 4,727건의 `cancelDate - dealDate`:

| p50 | p75 | p90 | p95 | **p99** | max |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0.7 | 1.8 | 3.1 | 4.4 | **11.8** | 20.6 (개월) |

3개월 초과 **10.5%** / 6개월 초과 3.0% / 12개월 초과 0.9%.
→ overlap 3개월은 p90까지만 덮는다. **p99를 덮으려면 12개월이 필요하다.**

---

## 3. 구조 비교 — 왜 "overlap 3→12"가 아닌가

| 안 | 셀/run | 예상 소요(0.54s/cell) | 60초 예산 | 판정 |
| --- | ---: | ---: | --- | --- |
| A. 현행 유지(3개월) | 64 | 34.3s | ✅ | 취소의 10.5% 영구 누락 |
| **B. overlap 3→12** | **208** | **~112s** | ❌ **구조적 초과** | 매일 PARTIAL_RUN으로 잘림 |
| C. 3개월 daily + 회전 recheck(같은 cron) | 64+16 | ~43s | ⚠️ 빠듯 | fresh 동기화까지 같이 위태로워짐 |
| **D. 3개월 daily + 별도 cron sweep** | 64 / 별도 ~50-90 | 34.3s / 별도 45s | ✅ | **채택** |

**B 기각**: 16개 구 × 13개월 = 208 cells로 60초 한도를 2배 가까이 넘는다. overlap 상수를
키우면 매일 예산에서 잘리는데, 잘리는 순서상 **최신 3개월 동기화까지 함께 위태로워진다.**
"최신성"은 제품 핵심이라 이걸 recheck와 같은 예산에서 경쟁시키면 안 된다.

**C 기각**: 남은 여유가 15.7초뿐이고 그 34.3s는 dry-run 측정치라 apply는 더 느리다. 게다가
fresh 범위는 달에 따라 4~5개월로 변동한다(현재월 포함). 여유가 사라지는 날 recheck가 아니라
fresh가 잘릴 위험이 남는다.

**D 채택**: Vercel Hobby의 cron 개수 제한은 **100개**이고(제약은 개수가 아니라 "하루 1회"와
±59분 정밀도) — 초기 가정과 달리 **cron 개수는 blocker가 아니다**. 별도 cron이면 recheck가
daily sync의 예산을 한 톨도 잠식하지 않고, 한쪽이 실패해도 다른 쪽에 영향이 없다.

### 3.1 채택 구조

```
fresh  (/api/cron/sale-sync,    04:00 KST) : latestComplete-2 ~ 현재월      (변경 없음)
recheck(/api/cron/sale-recheck, 08:00 KST) : latestComplete-12 ~ latestComplete-3
```

두 범위는 **겹치지도, 사이를 비우지도 않는다**(단위 테스트로 강제). 합쳐서 12개월을 덮어
p99 11.8개월을 포함한다.

cron 간격: 19:00 / 21:00 / 23:00 UTC. Hobby 정밀도 ±59분을 감안해도 각 실행은 최대 60초라
**중첩이 불가능하다**(최소 1시간 간격).

---

## 4. 순회 방식 — day-of-year 회전이 아니라 least-recently-verified

band는 10개월 × 16구 = **160 cells**이고 한 번에 다 돌 수 없다. 어떤 순서로 도느냐가 문제다.

**기각한 안 — day-of-year rotation**: `dayOfYear % 10`으로 월을 고르는 방식. 구/셀 수가
바뀌거나 실행이 하루 걸러 실패하면 특정 셀이 **조용히 굶는다**(starvation). 어떤 셀이 언제
확인됐는지 알 방법도 없다.

**채택 — least-recently-verified-first**: `sync_coverage_cells.verifiedAt`이 이미 셀 단위로
durable하게 저장되고 있다. "가장 오래 확인 안 된 셀부터" 처리하면

- 별도 커서 저장이 **필요 없다**(Vercel에서 파일 커서는 구조적으로 불가 — Phase 2에서 증명)
- 실행이 며칠 밀려도 밀린 셀이 자동으로 맨 앞에 온다 → **자기 교정적**
- 균등 커버리지가 보장된다(starvation 불가)
- **schema 변경이 0이다**

동률은 결정적으로 깬다: 최신 달 우선(취소가 더 들어올 여지가 큰 쪽) → lawdCd 오름차순.

---

## 5. 실측 (READ ONLY)

### 5.1 band 전수 대조 — `scripts/sale-cancellation-coverage/band-scan.ts`

band `202508~202605` 160셀 전부를 원천과 대조했다.

| 항목 | 값 |
| --- | ---: |
| cell status | **COMPLETE 160 / 160** (PARTIAL·INVALID 0) |
| source rows | 32,898 |
| DB matched | 32,894 |
| **late cancellation (DB=false / source=true)** | **2** |
| **reverse (DB=true / source=false)** | **0** |
| source-only (insert 후보) | 4 |
| conflict / reviewRequired | 0 / 0 |
| 이미 취소 상태 | 2,053 |

**핵심**: 이 band는 2026-08-31 `TRADE_CANCELLATION_RESYNC_V2`가 전수 보정한 구간이다.
그럼에도 **단 4일 만에 취소 2건이 새로 발생했다**(둘 다 202604 거래, 지연 **4.7개월** —
daily overlap 3개월 **바깥**, 이 band **안쪽**).

즉 이 STEP이 잡으려는 현상이 실제로 진행 중임이 실측으로 확인됐다. 4일에 2건은 연 환산
약 180건으로, V1 §6이 추정한 "연 ~250건"과 같은 규모다.

`reverse = 0`은 원천이 취소를 되돌리지 않는다는 V3 §8의 관측(누적 약 209,000행)을
32,898행에서 다시 확인한 것이다.

### 5.2 runtime — `scripts/sale-cancellation-coverage/recheck-dryrun.ts`

cron route와 **완전히 같은 core**를 dry-run으로 실행했다.

| 항목 | band-scan(160셀 전수) | recheck sweep dry-run(예산 45초) |
| --- | ---: | ---: |
| 처리 셀 | 160 | **53** |
| 총 소요 | 104.9s | **43.1s** |
| mean / cell | 655ms | **813ms** |
| p90 / p99 / max cell | 1,223 / 2,548 / 2,651ms | — |
| status | — | **SUCCESS** |
| 예상 insert / flip | 4 / 2 | 3 / 2 |
| **coverageRecorded** | — | **0** (dry-run 게이트) |

- **로컬 813ms/cell** 기준 53셀/run → band 한 바퀴 **약 3일**. Vercel 실측치(0.54s/cell)로는
  ~80셀/run → **약 2일**. band 안의 각 달은 10개월간 머무르므로 달마다 **100회 이상** 재확인된다.
- 최악 셀 2,651ms > 예산 여유값 2,500ms이지만, 45초 예산 + 최악 2.65초 = 47.7초로
  **maxDuration 60초 안에 안전하게 들어간다**(daily sync가 50초 예산인 것과 달리 45초로
  잡은 이유).

---

## 6. 구현

### 6.1 판정 로직을 복제하지 않았다

sweep은 cell 단위 처리를 `sale-sync-core.ts`의 `syncOneSaleCell`을 **그대로 호출**한다
(export만 추가, 본문 무변경). 따라서 fetch / pagination completeness / identity /
occurrenceIndex / write-policy가 daily 경로와 **100% 동일**하다. Phase 2 §4의
"CLI와 Cron이 서로 다른 판정 로직을 갖지 않게 한다" 원칙을 세 번째 경로에도 적용했다.

| 게이트 | 보장 방식 |
| --- | --- |
| false→true만 허용 | `classifyRow` + `dealCanceled: true` 하드코딩 |
| true→false 금지 | `updateTrueToFalseSkipped` 분기 — 쓰지 않음 |
| identity gate | aptSeq 없는 신규 row는 `reviewRequired`로 INSERT 안 함 |
| completeness gate | `PARTIAL`/`INVALID` 셀은 쓰지 않고 다음 실행 재시도 |
| conflict | aptName/dong 불일치 시 손대지 않음 |
| dry-run | `recordCoverageCells`가 독립적으로 재차 차단 |
| cron 인증 | `CRON_SECRET` 미설정이면 무조건 401 (fail-closed) |
| mode 기본값 | `dry-run` — apply는 `?mode=apply` 명시 필요 |

### 6.2 status 의미

이 sweep은 **설계상** 예산에 맞춰 band의 일부만 돌고 다음 실행이 이어받는다. 따라서
"band를 다 못 돌았다"를 `PARTIAL_RUN`으로 보고하지 **않는다** — 그러면 매일 207이 떠서
진짜 문제를 가린다. 대신 `sweepComplete` / `cellsProcessed` / `bandCells` /
`oldestVerifiedAt`로 사실을 그대로 노출한다. 단 셀을 **하나도** 처리하지 못하면
`PARTIAL_RUN`(207)이고, `PARTIAL`/`INVALID` 셀이 있으면 `PARTIAL`(207)이다.

### 6.3 coverage 의미 왜곡 방지

- SALE coverage cell은 `/admin/ops`에서 **개수/상태/검증시각**으로만 쓰인다. RENT와 달리
  verified-range를 파생하지 않는다(`computeVerifiedRangeFromCoverage`는 RENT 전용). 따라서
  band 셀이 coverage에 추가돼도 사용자 노출 라벨이 넓어지지 않는다 — 실제로 원천 대조된
  셀이 늘어난 것이므로 **정직한 증가**다.
- **발견해서 고친 왜곡**: `summarizeCoverage().latestRunId`는 "가장 최근에 coverage를 기록한
  실행" 하나만 준다. sweep이 도입되면 `/admin/ops`의 "sale 마지막 실행"이 조용히 sweep
  실행으로 바뀌어 **daily sync가 멈춰도 정상처럼 보이게 된다.** `summarizeSaleRunKinds()`로
  runId 접두사(`sale-` vs `sale-recheck-`)를 분리해 두 실행을 각각 표시하도록 고쳤다.
  (ADMIN_OPS_V1.2에서 배운 "다른 것을 같은 칸에 넣기" 실수를 반복하지 않는다.)

### 6.4 legacy backfill true→false FAIL-SAFE (V3 §12-3 / P1 해소)

V1 §3이 지목한 repo의 **유일한 역전 경로**를 닫았다.

`backfill-trade-history.ts:upsertRows()`는 upsert `update` 절에
`dealCanceled: row.dealCanceled`를 **무조건** 써서, 원천이 취소를 되돌리면 이미 보정된
`true`를 `false`로 덮을 수 있었다. `sync-trade-history.ts`도 `runTradeHistoryJob()`을 통해
이 경로를 공유하므로 **한 곳을 고치면 둘 다 닫힌다**.

Prisma upsert의 `update` 절은 조건부 갱신을 표현할 수 없다. 그래서 "덮어쓸지"를
**필드 존재 여부**로 표현했다 — 원천이 비취소면 cancellation 필드를 update 절에서 아예
제외한다(`scripts/cancellation-write-guard.ts`). 기존 값이 보존되므로 true→false가
**구조적으로 불가능**해진다. 반환 타입도 `dealCanceled?: true`만 허용해 `false`를 쓰는 것이
타입 수준에서도 불가능하다. false→false는 변화가 없어 손실이 없고, false→true는 그대로 적용된다.

`cancelDate`도 함께 제외한다 — 안 그러면 `canceled=true`인데 `cancelDate=null`인 상태가
생겨 V3가 검증한 불변식(`canceled without cancelDate = 0`)이 깨진다.

**노출도 근거**: V2+V3 apply로 B구간 취소가 629건 → 11,481건이 됐으므로 역전 시 되돌아갈 수
있는 행이 **18배**로 늘어 있었다.

---

## 7. 변경 파일

| 파일 | 변경 |
| --- | --- |
| `src/lib/sync/shared.ts` | band 상수 2개 + `resolveSaleRecheckBand` + `orderRecheckCellsByStaleness`(순수) |
| `src/lib/sync/sale-recheck-core.ts` | **신규** — sweep orchestration |
| `src/lib/sync/sale-sync-core.ts` | `syncOneSaleCell` export만 추가(본문 무변경) |
| `src/app/api/cron/sale-recheck/route.ts` | **신규** — cron route |
| `vercel.json` | cron 1개 추가 (`0 23 * * *`) |
| `src/lib/sync-coverage.ts` | `summarizeSaleRunKinds()` 추가 |
| `src/app/api/admin/ops/route.ts` | sale `lastRun`을 daily 전용으로 정정 + `recheckSweep` 노출 |
| `src/app/admin/ops/page.tsx` | sweep 상태 2행 표시 |
| `scripts/cancellation-write-guard.ts` | **신규** — 순수 fail-safe |
| `scripts/backfill-trade-history.ts` | upsert `update` 절에 fail-safe 적용 |
| `scripts/sale-cancellation-coverage/*.ts` | **신규** — 실측 스크립트 2종(READ ONLY) |
| `src/lib/sync/shared.test.mjs` | band/정렬 테스트 11개 추가 |
| `scripts/cancellation-write-guard.test.mjs` | **신규** — fail-safe 테스트 6개 |

---

## 8. 테스트 결과 (실제 실행한 것만)

| 검증 | 명령 | 결과 |
| --- | --- | --- |
| band/정렬 단위 테스트 | `node --test --experimental-strip-types src/lib/sync/shared.test.mjs` | **20/20 PASS** (신규 11 포함) |
| fail-safe 단위 테스트 | `node --test --experimental-strip-types scripts/cancellation-write-guard.test.mjs` | **6/6 PASS** |
| 타입체크 | `npx tsc --noEmit` | **24 errors — 전부 기존 무관 스크립트**(`FAIL_EXISTING_SCRIPT_ERRORS`). 변경 파일 오류 **0** |
| lint | `npm run lint` | **PASS (exit 0, 출력 없음)** |
| build | `npm run build` | **PASS** — `/api/cron/sale-recheck` 라우트 생성 확인 |
| band 전수 대조 | band-scan.ts | 160/160 COMPLETE, reverse 0 |
| sweep dry-run | recheck-dryrun.ts | SUCCESS, 53셀/43.1s, coverageRecorded **0** |

**전체 test suite 주의**: repo 루트에서 `node --test`를 돌리면 473개 중 62개가 실패하는데,
전부 **확장자 없는 상대 import**로 인한 `ERR_MODULE_NOT_FOUND`다(예:
`src/lib/analytics/events.test.ts` → `./events`). 이 Node 버전의 ESM resolver가 해석하지
못하는 **기존 저장소 관례 문제**이며 이번 변경과 무관하다. 이번에 건드린 테스트 파일은
**하나도 실패 목록에 없다**(교차 확인 완료).

---

## 9. 알려진 한계

1. **12개월 초과 취소 0.9%는 여전히 미커버.** band는 p99(11.8개월)를 덮지만 max 20.6개월은
   덮지 않는다. band를 늘리면 셀 수가 비례해 늘어 한 바퀴 주기가 길어지는 trade-off다.
   현재 주기(~2-3일)에 여유가 크므로 필요하면 `SALE_RECHECK_MAX_MONTHS_BACK`만 올리면 된다.
2. **부산 16개 구 한정.** 전국은 이번 범위 밖(daily sync도 동일).
3. **A구간(2006-01~2020-01)은 영구 불가.** 원천에 취소 데이터 자체가 없다(V1 §4).
   "역대" 표현 금지는 그대로 유지된다.
4. **band-scan의 4건 source-only insert 후보**는 이번 실측 시점 값이며, sweep이 실제로
   INSERT할 때는 승인된 aptSeq 게이트를 통과한 건만 들어간다.

---

## 10. 다음 STEP 제안

1. 첫 Production sweep 실행 결과 확인(`/admin/ops` sweep 행, Vercel 로그).
2. FULL CAP SWEEP (read only) — 부산 3,973셀 totalCount 대조. V3 §12-5로 이월된 항목.
3. 전국 확대 시 district chunk 파라미터 재설계.
