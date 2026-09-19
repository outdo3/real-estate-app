# E-JIP CANCELLATION PREVENTION CRON VALIDATION GATE V1

`CANCELLATION_RATCHET_PREVENTION_FIX_V1`(커밋 `e51b31c`, Production 배포 2026-09-16 03:35 UTC) 이후 **실제 Production cron 결과**를 검증한다. repair 승인 전 마지막 게이트.

- 검증 시각: 2026-09-19 02:14~02:50 UTC (11:14~11:50 KST)
- 기준 커밋: `63aed0c`
- 접근: Production DB **READ ONLY**(SELECT, `SET TRANSACTION READ ONLY`), MOLIT GET(cron이 건드린 셀만), Vercel CLI(로그·env **이름**만).
- 하지 않은 것: `SALE_CANCEL_RESTORE_ENABLED` 변경 0, 21건 repair 0, repair 스크립트 실행 0, INSERT/UPDATE/DELETE 0, schema 0, cron 수동 실행 0.

---

## 0. 판정

**FAIL — repair 승인 조건 미충족.**

예방 배포 이후 cron이 **새 false-cancel 7건을 만들었다**(원천 `1 취소 / 2` ↔ DB `2 취소 / 2`). 과다 취소 의심 상한이 327 → **334(+7)**로 늘었고, 증가분 7이 이 7개 그룹과 정확히 일치한다. 예방 수정이 막은 것은 **기존 행의 취소 flip 경로**이고, **형제가 새로 늘어나는 insert 경로**는 여전히 순서(occurrenceIndex)에 의존한다(§5).

그 밖의 항목은 전부 정상이다: 게이트 OFF · cancelRestored 0 · 기존 21행 불변 · 진짜 취소 누락 0 · cron 셀 전부 COMPLETE · error_logs 0.

---

## 1. cron 실행 (배포 이후)

`sync_coverage_cells`(셀별 마지막 기록 실행만 남음):

| run | 셀 | 월 범위 | fetched | inserted | updated |
|---|---|---|---|---|---|
| `sale-recheck-2026-09-16T23-29` | 58 | 202508~202605 | 11,719 | 2 | 0 |
| `sale-recheck-2026-09-17T23-29` | 49 | 202508~202511 | 10,714 | 1 | 0 |
| `sale-2026-09-18T19-59` (sale-sync) | 48 | 202606~202608 | 7,557 | 17 | 6 |
| `sale-recheck-2026-09-18T23-29` | 38 | 202603~202605 | 7,733 | 3 | 1 |

- 배포 후 SALE 셀 193개 전부 `COMPLETE`, 비COMPLETE 0. rent-sync도 9/16·9/18에 기록.
- 9/16·9/17 sale-sync 실행은 같은 셀을 9/18 실행이 덮어써 run_id가 남지 않지만, 그 실행이 넣은 행의 `created_at`(9/16 20:00Z, 9/17 19:59Z)로 실행이 확인된다.
- 배포 후 새로 적재된 행 301(그중 취소 상태 19). 배포 전 행 중 배포 후 갱신됐고 현재 취소 상태인 행 16(취소 flip인지 등기일자 보충인지는 컬럼 이력이 없어 구분 불가).

## 2. 복구 게이트

Production env 이름 목록(`vercel env ls production`, 값은 읽지 않음)에 `SALE_CANCEL_RESTORE_ENABLED`가 **없다** → 코드상 `=== '1'`이 아니므로 **OFF**.

## 3. cancelRestorePending / cancelRestored / cancelReconcileSkipped

이 metric은 DB에 저장되지 않고 cron 로그에만 남는다. **Vercel 런타임 로그 보존 기간이 약 1시간**이라(그보다 오래된 구간 조회는 HTTP 400/0건) 실제 cron 실행의 로그 줄은 회수할 수 없었다. 대신:

- **운영 sync core를 `dry-run`으로 같은 셀에 다시 돌렸다**(쓰기 없음 — 코드상 쓰기·coverage 기록은 `mode === 'apply'`에서만). 21행 셀 + 새 7건 셀 21개:
  - `cancelRestorePending` **셀마다 >0, 합계 28 = 기존 21 + 신규 7** (예: 26350:202608 = 4, 26380:202609 = 3)
  - `cancelRestored` **0**, 예상 insert 0, 예상 flip 0, `cancelReconcileSkipped` **0**
- 실제 cron이 기록한 `cancelRestored`: 21행이 여전히 취소(`updated_at` 2026-09-15)이고 배포 후 취소→정상으로 바뀐 행이 0이므로 **0**.
- 실제 cron 당시의 `cancelReconcileSkipped`: 신규 7건이 만들어진 실행에서 해당 그룹은 `SIBLING_COUNT_MISMATCH`로 skip됐어야 한다(§5). 로그로는 확인 불가.

## 4. 기존 21행

| 지표 | 배포 직후(9/16) | 지금 |
|---|---|---|
| 21행 취소 상태 | 21/21 | **21/21** |
| 복구된 행 | 0 | **0** |
| `registry_date` 보유 | 0 | 0 |
| 최근 변경 | — | `updated_at` 2026-09-15 20:00Z (배포 전) |

원천 대조: 21행이 속한 그룹 전부 여전히 원천 `1/2`(또는 `2/3`) ↔ DB 과다 취소 — 확정 false-cancel 그대로.

## 5. 신규 false-cancel 7건 — 원천 대조로 확정

| 셀 | 단지 | 금액 | 계약일 | 층 | 원천 | DB | 새 행 생성 |
|---|---|---|---|---|---|---|---|
| 26260:202605 | 동래SKVIEW | 58,800 | 05-01 | 3 | 1/2 | 2/2 | 9/16 23:29Z recheck |
| 26380:202609 | 신우림 | 13,800 | 09-08 | 4 | 1/2 | 2/2 | 9/16 20:00Z sync |
| 26470:202609 | 시청역SKVIEW | 49,500 | 09-02 | 20 | 1/2 | 2/2 | 9/16 20:00Z sync |
| 26380:202609 | 괴정한신더휴 | 37,400 | 09-16 | 6 | 1/2 | 2/2 | 9/17 19:59Z sync |
| 26290:202609 | 대연롯데캐슬레전드1단지 | 34,000 | 09-11 | 26 | 1/2 | 2/2 | 9/18 19:59Z sync |
| 26290:202609 | 롯데캐슬인피니엘 | 57,000 | 09-10 | 24 | 1/2 | 2/2 | 9/18 19:59Z sync |
| 26350:202608 | 롯데4 | 32,000 | 08-23 | 3 | 1/2 | 2/2 | 9/18 19:59Z sync |

모든 그룹이 같은 모양이다: **기존 취소 행 1개 + 배포 후 cron이 새로 넣은 동일 자연키 행 1개가 둘 다 취소.** 원천은 같은 거래를 두 줄(취소 1 + 정상 1, 재신고 형태)로 준다. 과다 취소 상한 +7과 정확히 일치한다.

메커니즘(`sale-sync-core.ts` 코드 확인):

1. 원천 형제 2 ↔ DB 형제 1 → `reconcileGroupCancellation`이 `SIBLING_COUNT_MISMATCH`로 skip(추측 금지 규칙).
2. 이어서 insert 경로가 `occurrenceIndex`(원천 응답 순서) 기준 자연키로 행을 대응시킨다. 원천 순서가 `[정상, 취소]`면 기존 취소 행이 index 0(정상 자리)에 매칭되고, index 1의 **취소 행이 새로 insert**된다.
3. 결과: DB 2/2 취소. 다음 실행부터는 형제 수가 맞아 `cancelRestorePending`으로 잡히지만, 게이트가 OFF라 그대로 남는다.

즉 결함 A(순서 의존 취소)가 **flip 경로에서는 제거됐지만 insert 경로에는 남아 있다.** 발생 빈도: 배포 후 3일간 7건(하루 약 2건). 기존 21행의 id도 대부분 9월에 새로 적재된 행이라 같은 경로로 생겼을 가능성이 높다(확인은 별도 STEP).

## 6. 과다 취소 상한 추세

| 지표 | 배포 전 | 배포 직후 | 지금 |
|---|---|---|---|
| 전체 행 | 865,120 | 865,120 | 865,421 |
| 취소 행 | 16,308 | 16,308 | 16,343 |
| 형제 전원 취소 그룹 | 266 | 266 | **273 (+7)** |
| 과다 취소 의심 상한 | 327 | 327 | **334 (+7)** |
| 자연키 중복 | 0 | 0 | 0 |

## 7. cron이 건드린 셀 전체 census (진짜 취소 회귀 · 불일치)

`scripts/audit-cancel-prevention-cron-census.ts` — 배포 후 cron이 검증한 SALE 193셀 + 현재월 16셀 = **209셀, 전부 COMPLETE로 재조회**(1,118셀 전체는 다시 읽지 않았다).

| 분류 | 그룹 | 내용 |
|---|---|---|
| OVER_CANCEL (DB 취소 > 원천) | **27** | 기존 21행의 20그룹(21번째 26410:202602는 9/15 검증 셀이라 범위 밖, 개별 대조로 동일 확인) + **신규 7** |
| UNDER_CANCEL (원천 취소가 DB에 없음) | **0** | 진짜 취소 누락 없음 |
| 형제 수 원천 > DB | 0 | insert 대기 없음 |
| 형제 수 DB > 원천 (결함 B 계열) | 8 | 원천이 회수한 행이 DB에 남음. 7개는 정상 행만, 1개(26380:202601 일동지에닌, 원천 0/1 ↔ DB 1/2)는 취소 행 포함. **8개 모두 배포 전부터 있던 행, 배포 후 변경 0** |

## 8. 로그 · 오류

| 확인 | 결과 |
|---|---|
| `error_logs` 배포 후 | **0** (최신 2026-09-11) |
| Vercel 5xx (보존된 최근 1시간) | 0 |
| cron 셀 비COMPLETE / MOLIT PARTIAL·INVALID | 0 |
| census 재조회 209셀 fetch 이상 | 0 |
| `/` · `/stats` · `/map` · `/api/transactions` | 200 |
| `/api/cron/sale-sync` 무인증 | 401 (실행되지 않음) |
| cron 당시 timeout·reconciliation 오류 로그 | **확인 불가**(로그 보존 1시간) — 셀 상태·error_logs로 간접 확인 |

## 9. repair 준비 상태

| 조건 | 결과 |
|---|---|
| sync/recheck 실제 cron 완료 | 충족 |
| restore gate OFF | 충족 |
| cancelRestored 0 | 충족 |
| 기존 21행 불변 | 충족 |
| **신규 false cancel 0** | **미충족 — 7** |
| **상한 증가 없음** | **미충족 — 327→334** |
| 진짜 취소 회귀 0 | 충족 |
| Production 정상 | 충족 |

**repair하지 않고 멈춘다.** 지금 21건만 고쳐도 같은 경로로 하루 약 2건씩 다시 생긴다.

## 10. 다음 권고

1. **insert 경로 수정(승인 필요, 코드 변경)**: 그룹 형제 수가 늘 때 새 행의 취소 상태를 원천 순서가 아니라 **그룹 개수**로 정한다 — `넣을 취소 수 = 원천 취소 수 − DB 취소 수`(0 이상으로 제한), 나머지는 정상으로 insert. `reconcileGroupCancellation`과 같은 규칙을 insert에도 적용하는 것이다. 기존 replay/dry-run 하네스와 이 census로 검증 가능하다.
2. 수정 배포 후 cron 1~2회 뒤 이 게이트를 다시 돌린다(`audit-cancel-prevention-cron-gate.ts` + `audit-cancel-prevention-cron-census.ts`). 조건: 상한 증가 0, 신규 OVER_CANCEL 0.
3. 그 뒤 repair 승인 대상은 **21 + 7 = 28행**이다. `SALE_CANCEL_RESTORE_ENABLED=1`이면 다음 cron이 dry-run이 보여준 28행을 그룹 개수 기준으로 되돌린다(pending 28, 예상 flip/insert 0).
4. 운영 관측: 이 metric이 로그에만 있고 로그 보존이 1시간이라 사후 검증이 불가능했다. cron 요약(`cancelRestorePending`/`cancelReconcileSkipped`)을 영속화하는 방안은 schema 변경이라 별도 승인 대상이다.
5. 결함 B(원천 회수 행 8그룹)는 별도 STEP.
