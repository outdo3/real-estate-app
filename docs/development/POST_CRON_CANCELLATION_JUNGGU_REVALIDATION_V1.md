# E-JIP POST-CRON CANCELLATION + JUNG-GU PILOT REVALIDATION V1

2026-09-21 sale-sync 이후 취소 baseline과 중구 pilot 원천을 재검증한다.

- 날짜: 2026-09-21 00:46~00:52 (KST) · 기준 커밋 `7c3dbc4`
- **Production INSERT / UPDATE / DELETE 0** · 서울 apply 0 · repair 0 · env 변경 0 · runtime `src/` 변경 0

## 판정

**PARTIAL** — **2026-09-21 sale-sync가 아직 실행되지 않았다.** §1 증명이 불가능하므로 §16에 따라 그 항목에서 STOP한다. 크론에 의존하지 않는 나머지(§2 · §4~§14)는 전부 수행했고 모두 통과했다.

---

## 1. Cron completion — **증명 불가 (아직 실행 전)**

| 항목 | 값 |
|---|---|
| 현재 시각 | **2026-09-21 00:52 KST** (`2026-09-20T15:52Z`) |
| sale-sync 스케줄 | `0 19 * * *` UTC = **매일 04:00 KST** |
| sale-recheck 스케줄 | `0 23 * * *` UTC = **매일 08:00 KST** |
| 다음 sale-sync | `2026-09-20T19:00Z` = **2026-09-21 04:00 KST** — 약 **3시간 8분 후** |

배포(`2026-09-19T02:49Z`) 이후 실행된 run 전수:

| run id | dataset | cells | complete | fetched | inserted | updated | ended (UTC) |
|---|---|---|---|---|---|---|---|
| `sale-2026-09-19T19-59-31-977Z` | SALE | 48 | 48 | 7,555 | **0** | **1** | 2026-09-19T20:00:15Z |
| `rent-2026-09-19T21-57-34-070Z` | RENT | 21 | 21 | 4,236 | 1 | 0 | 2026-09-19T21:57:46Z |
| `sale-recheck-2026-09-19T23-29-18-271Z` | SALE | 51 | 51 | 9,856 | **0** | **0** | 2026-09-19T23:30:02Z |

가장 최근 SALE run은 **2026-09-19T20:00Z = 2026-09-20 05:00 KST**로, 이것은 **2026-09-20** 크론이다. 그 이후 SALE run은 없다. 따라서 **2026-09-21 sale-sync는 아직 돌지 않았고, 통과 여부를 증명할 수 없다.**

시계만으로 판단하지 않고 run 기록으로 확인했다.

## 2. Cron inserts / updates (최근 실행 기준)

| 항목 | 값 |
|---|---|
| 2026-09-20 sale-sync | 48/48 COMPLETE · fetched 7,555 · **inserted 0** · updated 1 |
| 2026-09-20 sale-recheck | 51/51 COMPLETE · fetched 9,856 · **inserted 0** · updated 0 |
| 불완전 셀 | **0** |

## 3. 취소 baseline — 전부 유지

| 지표 | 기준 | 현재 |
|---|---|---|
| 전 지역 sale 합계 | 865,421 | **865,421** |
| 부산 sale | 865,289 | **865,289** |
| 서울 sale | 46 | **46** |
| 취소 | 16,345 | **16,345** |
| active | — | 849,076 |
| **all-canceled groups** | 273 | **273** |
| **suspect upper bound** | 334 | **334** |
| multi-sibling groups | — | 13,065 |

## 4~6. 이상 징후 재측정

| 항목 | 결과 |
|---|---|
| **new false-cancel** | **0** |
| **new overcancel** | **0** — `all_canceled_groups_touched_since_deploy` 0 |
| **genuine cancellation missing** | **0** |
| source > DB anomaly | 0 |
| source < DB / Defect B | 배포 이후 `rows_created` 0 · 불완전 셀 0 |
| sibling-growth regression | **0** — `groups_with_sibling_added_since_deploy` 0 |
| natural key 중복 | **0** |
| known false-cancel | **28만** (`audit-cancel-known28-spotcheck` 추가 검출 0) |

## 7. Insert-path positive execution — **여전히 미검증**

배포 이후 SALE 크론 두 번(정기 + recheck)이 모두 **inserted 0**이다. 배포 이후 생성된 행도 **0**이다.

즉 고쳐진 `planGroupInserts()` insert 경로는 **아직 production에서 긍정적으로 실행된 적이 없다.** 취소 gate가 통과한 것과는 **별개 사실**이며 혼동하면 안 된다 — "false-cancel 0"은 insert가 없었기 때문일 수도 있다.

RENT는 같은 기간 1행을 insert했으나 데이터셋이 다르므로 SALE insert 경로의 증거가 되지 않는다.

## 8~9. 중구 원천 fresh fetch

`--refetch`로 캐시 없이 재조회. **두 경로(신규 rowset 스크립트 · 운영 driver)가 독립적으로 같은 값**을 냈다.

| 항목 | 값 |
|---|---|
| **원천 행** | **943** |
| **active** | **888** |
| **canceled** | **55** |
| 셀 | **12 / 12 COMPLETE** |
| `collected == totalCount` | 12/12 |
| PARTIAL / FAILED / invalid | **0 / 0 / 0** |
| 원천 내 자연키 중복 | **0** |

월별: 202510 **146** · 202511 34 · 202512 78 · 202601 79 · 202602 65 · 202603 104 · 202604 128 · 202605 131 · 202606 61 · 202607 80 · 202608 32 · 202609 **5**

관측 이력: 2026-09-19 **944** → 2026-09-21 00:31 **943** → 2026-09-21 00:52 **943**(안정).

## 10. 원천 rowset artifact — **생성 완료**

앞 STEP에서 "집계 수만 저장해 row-level delta를 낼 수 없다"고 보고한 결함을 닫았다.

`tmp/seoul-pilot-rowset/rowset-11140-202510-202609-*.json` — **943행 전체**를 다음 항목과 함께 저장:

`naturalKey` · `aptSeq` · `aptName` · `dong` · `dealDate` · `dealAmount` · `floor` · `occurrenceIndex` · `canceled` · `cancelDate` · `cell(월)`

스크립트에 `--compare=<이전 artifact>`를 주면 **removed / added / cancelChanged를 행 단위로** 출력한다. 자연키·정규화는 운영 driver와 **같은 모듈**(`mapMolitItems` → `normalizeMolitItemsToTradeRows` → `naturalKeyOf`)을 그대로 호출해 계약을 복제하지 않았다.

> 944 → 943 delta 자체는 지금도 설명할 수 없다. 비교 대상이 될 2026-09-19 행 집합이 존재하지 않기 때문이다. **이번 artifact가 다음 delta의 기준이 된다.**

## 11. Master exact

| 판정 | 건수 |
|---|---|
| **EXACT_MASTER** | **943** |
| **MASTER_MISSING** | **0** |
| INVALID_APTSEQ · REVIEW_REQUIRED | 0 · 0 |

aptSeq exact only — 이름/지번 fallback · fuzzy · first-match 미사용.

## 12~13. 현재 DB 상태

| 항목 | 값 |
|---|---|
| 중구(`11140`) 기존 행 | **0** |
| existing matched | **0** |
| **existing updates** | **0** |
| cancel drift · registryDate drift · 기타 | **0 / 0 / 0** |

## 14~15. 충돌 / expectedSkips

| 항목 | 값 |
|---|---|
| same-district collision | **0** |
| cross-district collision | **0** |
| **expectedSkips** | **0** |
| nonCanonicalInserts | 0 |

## 16~17. 최종 pilot 계획

| 항목 | 값 |
|---|---|
| fresh source rows | **N = 943** |
| **planned inserts** | **943** |
| expectedSkips | **0** |
| **expected actual inserts** | **943** |
| updates | **0** |

과거 수치(944)를 억지로 맞추지 않았다. **N은 측정 시점 값이며 apply 직전에 다시 확정해야 한다.**

## 18. Driver gate 상태

| gate | 상태 |
|---|---|
| `--apply` | 미지정 |
| `ALLOW_PROD_DB_READ=1` · `ALLOW_PROD_DB_WRITE=1` | READ만 실행 시 부여 · WRITE 미설정 |
| `DEFECT_A_GATE_PASS=1` | **미설정 → BLOCKED_FOR_APPLY** |
| `--district` · `--from` · `--to` | 필수 |
| `--expect-inserts` = plannedInserts | 불일치 시 driver가 거부 |
| 전 셀 READY | **12/12** |
| `--approve-existing-updates` | **불필요 · 금지**(existingUpdates 0) |

Apply 명령(실행 안 함):

```bash
ALLOW_PROD_DB_READ=1 ALLOW_PROD_DB_WRITE=1 DEFECT_A_GATE_PASS=1 \
npx tsx scripts/backfill-seoul-sale.ts \
  --district=11140 \
  --from=2025-10 --to=2026-09 \
  --apply \
  --expect-inserts=943 \
  --out=tmp/seoul-junggu-pilot-apply
```

## 19. Env gate 상태 (이름만, 값 출력 0)

| 변수 | process | `.env` / `.env.local` |
|---|---|---|
| `DEFECT_A_GATE_PASS` | **NOT SET** | 없음 |
| `SALE_CANCEL_RESTORE_ENABLED` | **NOT SET** | 없음 |
| `ALLOW_PROD_DB_WRITE` | **NOT SET** | 없음 |

**env 변경 0.**

## 20. known 28 readiness

| 항목 | 상태 |
|---|---|
| known false-cancel | **28** (변동 없음) |
| 추가 검출 | **0** |
| repair 전제 조건 | `SALE_CANCEL_RESTORE_ENABLED=1` (**미설정**) + 명시 승인 |
| 이번 STEP repair | **0** |

중구 pilot과 false-cancel repair는 **별개 STEP·별개 트랜잭션**으로 유지했다. 섞지 않았다.

## 21. No-write assertion

| 항목 | 값 |
|---|---|
| Production INSERT / UPDATE / DELETE | **0 / 0 / 0** |
| driver 보고 `writes` | `{insert: 0, update: 0, delete: 0}` |
| 서울 apply · repair · env 변경 | 0 · 0 · 0 |
| runtime `src/` 변경 | **0** |
| MOLIT 호출 | 36회(12셀 × 3회 실행) · 잔여 quota 9,892 |

모든 DB 접근은 `SET TRANSACTION READ ONLY`.

## 22. Blockers

**2026-09-21 sale-sync가 아직 실행되지 않았다(약 3시간 후).** §1·§3의 크론 통과 증명과 insert-path 긍정 검증은 그 이후에만 가능하다.

## 23. 다음 권고

1. **04:00 KST 이후 재실행.** 확인할 것은 두 가지뿐이다 — (a) `sale-2026-09-20T19-*` run이 COMPLETE인가, (b) **inserted > 0인가.** inserted가 또 0이면 취소 gate가 통과해도 insert 경로는 여전히 미검증으로 남는다(그 둘을 하나로 묶어 보고하지 말 것).
2. **중구 apply는 절차로 승인받는 편이 안전하다.** 원천이 이틀 새 1행 움직였다. 숫자를 고정하기보다 "apply 직전 dry-run을 돌려 그 값을 `--expect-inserts`에 넣는다"가 맞고, driver가 불일치를 스스로 거부하므로 안전장치는 유지된다.
3. **rowset artifact를 매 측정마다 남긴다.** 이번에 기준선이 생겼으므로, 다음 측정부터는 `--compare`로 **어느 행이 사라졌는지**까지 답할 수 있다.
4. 중구 pilot과 false-cancel 28 repair는 계속 분리한다.
