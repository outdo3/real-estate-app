# E-JIP CANCELLATION CRON VALIDATION AFTER INSERT-PATH FIX V1

`CANCELLATION_INSERT_PATH_FIX_V1`(커밋 `03abea9`, Production 배포 2026-09-19 11:49 KST = `2026-09-19T02:49Z`) 이후 **실제 Production cron 결과**를 검증한다. 28행 repair 승인 전 마지막 게이트.

- 검증 시각: 2026-09-20 10:04~10:32 KST (`2026-09-20T01:04~01:32Z`)
- 기준 커밋: local `53bbbb9` / Production `68d8223`
- 접근: Production DB **READ ONLY**(`SET TRANSACTION READ ONLY` SELECT), MOLIT GET(cron이 건드린 셀만), Vercel CLI(배포 메타·env **이름**만).
- 하지 않은 것: INSERT/UPDATE/DELETE 0, 28행 repair 0, `SALE_CANCEL_RESTORE_ENABLED` 변경 0, schema 0, migration 0, cron 수동 실행 0, git push 0, Seoul sale apply 0.

---

## 0. 판정

**PASS — 신규 false-cancel 0. 28행 repair 승인 조건 충족.**

insert-path fix 배포 후 sale-sync 1회 + sale-recheck 1회가 완료됐고, 그 사이 **새로 적재된 행이 0**이며 과다 취소 의심 상한이 **334에서 한 건도 늘지 않았다**. 확정 false-cancel은 **정확히 기존 28행뿐**이고 전부 배포 이후 변경되지 않았다. 진짜 취소 누락 0.

단, 이번 cron은 insert가 0이라 **수정된 insert 경로가 Production에서 실제로 실행되지는 않았다**(§5). 예방은 증명됐고 양성 실행은 아직이다.

---

## 1. cron 완료 증거

`sync_coverage_cells`(배포 이후 기록):

| run | dataset | 셀 | COMPLETE | 비COMPLETE | fetched | inserted | updated | 월 범위 | 종료(UTC) | KST |
|---|---|---|---|---|---|---|---|---|---|---|
| `sale-2026-09-19T19-59-31-977Z` | SALE | 48 | 48 | **0** | 7,555 | **0** | 1 | 202606~202608 | 2026-09-19T20:00:15Z | **09-20 05:00** |
| `sale-recheck-2026-09-19T23-29-18-271Z` | SALE | 51 | 51 | **0** | 9,856 | **0** | 0 | 202508~202605 | 2026-09-19T23:30:02Z | **09-20 08:30** |
| `rent-2026-09-19T21-57-34-070Z` | RENT | 21 | 21 | 0 | 4,236 | 1 | 0 | 202607~202608 | 2026-09-19T21:57:46Z | 09-20 06:57 |

목표였던 **2026-09-20 04:00 KST대 Busan sale cron이 완료**됐다(실제 기동 19:59Z = 04:59 KST). 뒤이은 08:00 KST대 recheck도 완료. 배포 후 비COMPLETE 셀 0.

**실행 코드가 수정본인지 확인**: 현재 Production 배포 `real-estate-lqcfk53iz` created `2026-09-19 20:52:32 KST` — 커밋 `68d8223`의 시각과 일치하고, `git merge-base --is-ancestor 03abea9 origin/main` = YES. 즉 cron(9/19 19:59Z = 배포 7시간 후)은 **insert-path fix가 포함된 코드**로 돌았다.

## 2. 검증 baseline 대조

| 지표 | repair 전 baseline | 지금 | Δ |
|---|---|---|---|
| 전체 행 | 865,421 | **865,421** | **0** |
| 취소 행 | 16,343 | **16,345** | **+2** (§6, 진짜 취소) |
| 형제 전원 취소 그룹 | 273 | **273** | **0** |
| 과다 취소 의심 상한 | 334 | **334** | **0** |
| 자연키 중복 | 0 | **0** | 0 |
| 확정 false-cancel | 28 | **28** | **0** |

`all_canceled_count`가 변하지 않았으므로 row-level 설명이 필요한 변동은 없다. 취소 행 +2는 전원취소 그룹을 만들지 않은 **단일 행 취소 2건**이다(§6).

## 3. 전체 census

DB 전역(`scripts/audit-cancel-cron-validation-v1.ts`, READ ONLY):

| 지표 | 값 |
|---|---|
| 배포 이후 **새로 적재된 행**(`created_at` > 배포) | **0** |
| 배포 이후 원천 재적재된 행(`source_fetched_at` > 배포) | 2 |
| 배포 이후 형제가 늘어난 그룹 | **0** |
| 배포 이후 생성/변경된 전원취소 그룹 | **0** |
| 기존 21행 | 21/21 취소, 최신 변경 `2026-09-15T20:00:04Z`(배포 전, 불변) |
| 신규 7행 | 7/7 취소, 최신 변경 9/16~9/18(배포 전, 불변) |
| `error_logs` 배포 이후 | **0** |

원천 대조(`scripts/audit-cancel-prevention-cron-census.ts`, 배포 후 cron 셀 99 + 현재월 16 = **115셀, 115/115 재조회 성공, fetch 이상 0**):

| 분류 | 그룹 | 판정 |
|---|---|---|
| OVER_CANCEL (DB 취소 > 원천) | **26** | 전부 기존 28행 — 신규 0 |
| UNDER_CANCEL (진짜 취소 누락) | **0** | 회귀 없음 |
| SRC_MORE_SIBLINGS (원천 > DB, insert 대기) | **0** | 적재 누락 없음 |
| DB_MORE_SIBLINGS (원천 < DB, 결함 B) | 8 | §7 — 기존과 동일 집합, 불변 |

## 4. 확정 28행 exact match

census 범위(115셀)에 26행이 들어왔고 전부 OVER_CANCEL로 재확인됐다(`src 1/2 ↔ db 2/2`, 2건은 `2/3 ↔ 3/3`). **26개 모두 `changedSinceDeploy = false`.**

범위 밖 2행은 개별 원천 대조(`scripts/audit-cancel-known28-spotcheck.ts`):

| id | 셀 | 단지 | 원천 | DB | 최신 변경 |
|---|---|---|---|---|---|
| 949575 | 26260:202604 | 반도보라스카이뷰 | 1/2 | 2/2 | 2026-09-06 (배포 전) |
| 950382 | 26290:202510 | 엘지메트로시티4-2(230~238) | 1/2 | 2/2 | 2026-09-14 (배포 전) |

**26 + 2 = 28. 추가된 row/group = 0.** 28행 repair는 하지 않았다.

## 5. insert-path 회귀 검사 (sibling-growth)

과거 결함 패턴은 `원천 형제 2 / DB 형제 1`에서 insert가 취소 형제를 잘못 넣어 DB가 `2/2`가 되는 것이었다.

| 확인 | 결과 |
|---|---|
| 배포 이후 형제가 늘어난 그룹 | **0** (DB 전역) |
| 배포 이후 새로 적재된 행 | **0** (DB 전역) |
| 신규 overcancel 그룹 | **0** |
| 신규 sibling-growth false cancel | **0** |
| coverage `inserted` 합계(SALE, 배포 후) | **0** |

**해석의 한계**: cron 2회가 insert를 한 건도 만들지 않았으므로, 수정된 `planGroupInserts()` 경로는 Production에서 **아직 양성 실행된 적이 없다**. 이번 결과는 "새 false-cancel이 생기지 않았다"를 증명하지만 "새 경로가 올바르게 insert한다"를 Production 실행으로 증명하지는 않는다(후자는 테스트·replay로만 확인됨 — `CANCELLATION_INSERT_PATH_FIX_V1` §5·§6). 다음 cron에서 insert가 발생하면 §3 census를 한 번 더 돌려 확인할 것을 권고한다.

## 6. 진짜 취소 회귀 검사

- UNDER_CANCEL **0** (115셀). 원천이 취소로 보고한 거래가 DB에서 active로 남은 건 없다.
- 배포 이후 취소로 바뀐 행 **2건** — 둘 다 원천이 새로 보고한 진짜 취소다:

| id | 셀 | 단지 | 금액 | 계약일 | 층 | cancelDate | 반영 |
|---|---|---|---|---|---|---|---|
| 950280 | 26350:202608 | 동부올림픽타운 | 100,000 | 2026-08-25 | 17 | `26.09.19` | 9/19 19:59Z sale-sync |
| 949533 | 26380:202609 | 유림예다움 | 19,000 | 2026-09-04 | 10 | `26.09.19` | 9/20 20:00Z sale-sync(현재월) |

둘 다 `occurrence_index 0`의 단일 형제 그룹이라 전원취소 그룹을 만들지 않았다 — 상한 334 불변과 정합적이다. 취소 행 16,343 → 16,345(+2)가 이 2건으로 정확히 설명된다.

## 7. 결함 B 분리

원천에서 사라졌지만 DB에 남은 그룹 — **8개**. `CANCELLATION_PREVENTION_CRON_VALIDATION_GATE_V1` §7의 8개와 **동일 집합**이고 전부 `changedSinceDeploy = false`.

| 셀 | 단지 | 원천 | DB |
|---|---|---|---|
| 26140:202608 | e편한세상송도더퍼스트비치 | 0/0 | 0/1 |
| 26380:202601 | 일동지에닌 | 0/1 | **1/2** (취소 행 포함) |
| 26380:202608 | IDS아델하임 | 0/0 | 0/1 |
| 26380:202609 | 아람센트럴시티 | 0/0 | 0/1 |
| 26410:202606 | 태성캐슬 | 0/0 | 0/1 |
| 26470:202607 | 월드파크4 | 0/0 | 0/1 |
| 26470:202609 | 성일이안시티 | 0/0 | 0/1 |
| 26500:202607 | W-PARKⅡ | 0/0 | 0/1 |

**결함 A 결과와 섞지 않는다. 삭제 0.** 별도 STEP 대상.

## 8. 원천 순서 독립성

Production에 insert가 0이라 실행 기반 관측은 불가. 정책·통합 테스트로 확인(local `53bbbb9` = 서울 backfill 리팩터 포함본):

```
npx tsx --test scripts/cancel-insert-plan.test.ts              pass 19  fail 0
npx tsx --test src/lib/sync/cancel-insert-path-sync.test.ts    pass 10  fail 0
npx tsx --test src/lib/sync/cancel-reconcile-integration.test.ts
             scripts/cancel-reconcile-logic.test.ts
             scripts/backfill-seoul-sale.test.ts
             scripts/audit-seoul-sale-backfill-plan.test.ts     pass 51  fail 0
```

속성 테스트(원천 ≤4행 전 구성 × DB 부분 구성 × **모든 원천 순서**)와 E2(역순 동일 결과) 포함. **새 source-order dependent anomaly = 0.**

## 9. PASS 조건 대조

| 조건 | 결과 |
|---|---|
| cron completed | **충족** — sale-sync 48셀 + recheck 51셀, 비COMPLETE 0 |
| 상한이 baseline에서 증가하지 않음 | **충족** — 334 → 334 |
| new overcancel = 0 | **충족** |
| existing false-cancel = known 28 only | **충족** — 26 census + 2 spot-check |
| genuine cancellation missing = 0 | **충족** — UNDER_CANCEL 0 |
| source>DB insert anomaly = 0 | **충족** |
| source-order dependent result = 0 | **충족**(테스트 기반) |
| 신규 sibling-growth false cancel = 0 | **충족** — 형제 증가 그룹 0 |

## 10. No-write assertion

검증 시작 시점과 종료 시점에 같은 게이트를 돌려 동일한 값을 확인했다.

| 항목 | 값 |
|---|---|
| Production INSERT / UPDATE / DELETE | **0 / 0 / 0** |
| 28행 repair | **0** |
| `SALE_CANCEL_RESTORE_ENABLED` 변경 | **0** (Production env 이름 목록에 여전히 **없음** = OFF) |
| schema / migration | 0 / 0 |
| cron 수동 실행 | 0 |
| git push / Seoul sale apply / GOODLIFE | 0 / 0 / 0 |
| 검증 전후 전체 행·취소 행·상한·21행 | 865,421 / 16,345 / 334 / 21-21 — 전부 동일 |

## 11. local commit push 판정

**PUSH_SAFE (단서 1건 — §12).**

검증 자체는 PASS이므로 push를 막는 조건은 없다. 다만 이번 STEP에서 **task 체크리스트가 예상하지 못한 사실**을 하나 발견했다:

미push 커밋 `105c9ab`가 **`src/lib/sync/sale-sync-core.ts`를 수정한다**(+184 / −120). 이번에 검증한 바로 그 취소 경로다.

| 변경 | 성격 | 확인 |
|---|---|---|
| 쓰기 계획을 순수 함수 `planSaleCellWrites()`로 추출 | 로직 이동(문장 단위 동일) | 위 80개 테스트가 이 리팩터 포함본에서 전부 통과 |
| `existing` 조회에 `dealDate: monthDateRange(dealYmd)` 추가 | **동작 변경 가능성 있는 유일한 지점** | 아래 |

`deal_ymd`가 `deal_date`의 연월과 항상 같아야 결과가 동일하다. Production 실측(READ ONLY):

- `to_char(deal_date,'YYYYMM') <> deal_ymd` 인 행 **0 / 865,421**
- `deal_date IS NULL` 인 행 **0**
- `apartment_trade_histories_lawd_cd_deal_date_idx` **존재** — 의도한 index 사용 가능

즉 오늘 기준으로 두 조회의 결과 집합은 동일하다. 위험은 낮지만 **이 변경은 Production cron을 한 번도 타지 않았다**. push하면 다음 cron부터 이 코드가 취소 판정에 쓰인다.

권고: push 자체는 안전하다고 본다. 다만 **28행 repair는 push 후 cron 1회를 더 검증한 다음**에 하는 편이 안전하다(§13).

## 12. 28행 repair 준비 상태

| 조건 | 결과 |
|---|---|
| 실제 cron 완료 | 충족 |
| restore gate OFF | 충족 (env 이름 없음) |
| `cancelRestored` 0 | 충족 (취소→정상 전환 행 0) |
| 28행 불변·형제 수 = 원천 | 충족 (전부 `src 1/2 ↔ db 2/2` 또는 `2/3 ↔ 3/3`) |
| 신규 false cancel 0 | **충족** |
| 상한 증가 없음 | **충족** |
| 진짜 취소 회귀 0 | 충족 |

`CANCELLATION_INSERT_PATH_FIX_V1` §7 dry-run이 보여준 대로, `SALE_CANCEL_RESTORE_ENABLED=1`이면 다음 cron이 `cancelRestorePending` 28을 그룹 개수 기준으로 되돌린다(예상 insert/flip 0). **이번 STEP에서는 repair하지 않았다 — Production UPDATE는 별도 사용자 승인 대상.**

## 13. 다음 권고

1. **28행 repair 승인 요청** — 검증 조건을 전부 충족했다. 실행은 env `SALE_CANCEL_RESTORE_ENABLED=1` 설정 후 cron 1회이며, 이는 Production UPDATE이므로 명시적 승인이 필요하다.
2. **push 후 cron 1회 재검증** — `105c9ab`의 sync-core 변경이 Production cron을 탄 적이 없다. push한다면 다음 sale-sync 후 이 게이트(`audit-cancel-cron-validation-v1.ts` + `audit-cancel-prevention-cron-census.ts`)를 한 번 더 돌린 뒤 repair하는 순서를 권고한다.
3. **insert 양성 실행 확인** — insert가 실제로 발생한 cron 이후 census를 돌려 `planGroupInserts()` 경로를 Production 실행으로 확인한다(이번엔 insert 0이라 미확인).
4. **결함 B 8그룹** — 별도 STEP. 삭제 경로가 없어 이번에도 손대지 않았다.
5. cron metric(`cancelRestorePending`/`insertReconcileSkipped`) 영속화는 여전히 schema 변경이라 별도 승인 대상. Vercel 로그 보존 약 1시간이라 사후 확인이 DB 지표에만 의존한다.

## 14. 이번 STEP이 추가한 스크립트 (READ ONLY)

| 파일 | 역할 |
|---|---|
| `scripts/audit-cancel-cron-validation-v1.ts` | 배포 후 cron 실행·쓰기·상한·전원취소 그룹·형제 증가 DB 전역 census |
| `scripts/audit-cancel-known28-spotcheck.ts` | census 범위 밖 확정 행의 개별 원천 대조 |

둘 다 `_prod-db-guard`(DIAGNOSTIC, `ALLOW_PROD_DB_READ=1`) 아래에서만 돌고 쓰기 구문이 없다.
