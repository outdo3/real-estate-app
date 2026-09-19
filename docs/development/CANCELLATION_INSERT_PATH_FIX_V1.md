# E-JIP CANCELLATION INSERT PATH FIX V1

새 형제 row를 **insert할 때** 취소 상태가 원천 응답 순서로 정해져 false-cancel이 생기던 결함을 닫는다. insert의 취소 상태를 **그룹 개수**로 정한다.

- 날짜: 2026-09-19 (KST)
- 기준 커밋: `35dcb8d`
- 범위: sync ingest insert 경로만. **schema 0 · migration 0 · repair 0 · restore gate 변경 0 · 기존 28행 변경 0 · cron 수동 실행 0.**
- 선행: `CANCELLATION_RATCHET_PREVENTION_FIX_V1`(flip 경로), `CANCELLATION_PREVENTION_CRON_VALIDATION_GATE_V1`(FAIL — 신규 7건 발견)

---

## 1. 확정 false-cancel: 21 → 28

| 구분 | 행 | 근거 |
|---|---|---|
| REPAIR_AUDIT_V1 확정 | 21 | 원천 1/2(또는 2/3) ↔ DB 과다 취소 |
| 예방 수정 배포 후 cron이 새로 만든 것 | 7 | 원천 1/2 ↔ DB 2/2 (게이트 문서 §5) |
| **합계** | **28** | 이번 STEP에서 **그대로 둔다** |

## 2. 원인 — 예방 V1의 한계

예방 V1은 **기존 행의 취소 flip**을 그룹 개수(`reconcileGroupCancellation`)로 바꿨다. 그러나 원천 형제 수가 DB보다 많으면 그 함수는 `SIBLING_COUNT_MISMATCH`로 skip했고, 이어지는 **insert는 여전히 행 단위**였다:

```
원천: 같은 거래 2줄 [정상, 취소]   (재신고 형태)
DB  : 1줄 [취소] occurrenceIndex 0

1) 형제 수 2 ≠ 1 → reconcile skip
2) 원천 행마다 자연키(occurrenceIndex = 응답 순서)로 DB 행을 찾음
   - 원천 index 0(정상) ↔ DB index 0(취소)   → 매칭(취소 판정은 reconcile 담당이라 무시)
   - 원천 index 1(취소) ↔ 없음               → classifyRow = 'insert' → 취소 행 insert
3) DB 2/2 취소 ↔ 원천 1/2   (원천 순서가 [취소, 정상]이었다면 1/2로 맞았다 — 결과가 순서에 달림)
```

**실데이터 확인(§6)**: 형제가 나중에 늘어난 그룹 304개를 수정 전 로직으로 replay하면 정확히 **28그룹**이 과다 취소가 되고, 28개 모두 현재 Production DB 상태와 일치한다. 즉 **기존 21행도 flip 래칫이 아니라 이 insert 경로로 생겼다.** 예방 V1이 21행을 막지 못한 이유이기도 하다.

## 3. 새 insert 의미론 — group-count first

DB에 형제가 이미 있는 그룹(`원천 형제 > DB 형제 > 0`)은 `planGroupInserts()`(`scripts/write-policy-logic.ts`)가 정한다:

```
missingSiblingCount    = sourceSiblingCount − dbSiblingCount
requiredCanceledInsert = max(0, sourceCanceledCount − dbCanceledCount)
requiredCanceledInsert > missingSiblingCount → skip(CANCELED_DEFICIT_EXCEEDS_MISSING), 추측 없음
그 외 → 취소 requiredCanceledInsert행 + 정상 (missing − required)행 insert
```

판단 순서: 그룹 구성 → 원천 형제/취소 수 → DB 형제/취소 수 → 부족분 → 취소 insert 수 → 결정적 배정. **원천 응답 위치는 진실 판정에 쓰지 않는다.**

### 형제 수 정책

| 경우 | 동작 |
|---|---|
| DB 형제 0 (신규 그룹) | 원천 행 그대로 insert — 개수가 자명하게 일치, **기존 동작 그대로** |
| 원천 > DB > 0 | 위 그룹 개수 insert (예전: SIBLING_COUNT_MISMATCH 후 행 단위 insert) |
| 원천 = DB | insert 없음 · 기존 `reconcileGroupCancellation` (변경 없음) |
| 원천 < DB (결함 B, 원천 회수) | insert 없음 · 삭제 없음 · 기존대로 skip |

`원천 = DB`인데 자연키 자리가 어긋난 원천 행도 이제 insert하지 않는다(예전에는 넣어서 DB 형제가 원천보다 많아질 수 있었다).

### 보류(skip) 사유 — `insertReconcileSkipped` metric + `INSERT_RECONCILE_SKIPPED` 로그

`NO_APT_SEQ`(name+dong fallback 금지) · `IDENTITY_MISMATCH`(형제 단지명/동 불일치) · `CANCELED_DEFICIT_EXCEEDS_MISSING` · `INSUFFICIENT_SOURCE_ROWS`(방어용).

### 결정적 배정

- 원천 행 내용 선택: 같은 상태의 원천 행을 **내용 기반 정렬**(취소여부·해제일·등기일·단지명·동·지번·건축년도, 완전 동률일 때만 rawUid)한 뒤, DB에 이미 있는 값(취소 행은 해제일, 정상 행은 등기일)을 multiset에서 빼고 앞에서부터 쓴다.
- occurrenceIndex: DB가 쓰지 않는 자리를 0부터 오름차순. 취소 행 먼저, 그다음 정상 행. 자연키 중복 불가.
- 원천 순서를 뒤집어도 최종 (자리, 취소여부, 해제일, 등기일)이 같다 — 속성 테스트로 고정.

occurrenceIndex는 **자연키 자리 배정에만** 쓴다(schema·자연키 불변).

### 완전성 가드

변경 없음 — `PARTIAL`/`INVALID`(첫 페이지 실패·페이지 누락·재시도 소진) 셀은 insert/취소 대조 전에 조기 반환한다. 통합 테스트 E9/E10이 fetch 대역으로 두 경우 모두 쓰기 0을 확인한다.

## 4. 코드 변경

| 파일 | 변경 |
|---|---|
| `scripts/write-policy-logic.ts` | `planGroupInserts()` + 타입 추가. 기존 함수(`reconcileGroupCancellation`·`classifyRow` 등) **변경 0** |
| `src/lib/sync/sale-sync-core.ts` | ① reconcile 루프: 원천 형제가 더 많은 그룹은 insert 계획에 넘김 ② insert 전 그룹 계획 수립 ③ 행 단위 루프: 형제가 이미 있는 그룹의 미매칭 행은 건너뜀 ④ metric/log 2개 |
| `src/lib/sync/shared.ts` | `insertCanceled` · `insertReconcileSkipped` (CellReport/SyncSummary, 선택 필드) |

건드리지 않은 것: 원천 fetch · 완전성 판정 · 등기일자 보충 · 자연키/identity · 취소 flip/치유 · restore gate · coverage cell 기록 · recheck(같은 `syncOneSaleCell` 재사용이라 자동 적용).

## 5. 테스트

`scripts/cancel-insert-plan.test.ts` — 순수 정책 19개

| 요구 | 테스트 |
|---|---|
| 원인 재현 | 수정 전 행 단위 insert를 `classifyRow`로 재구성 → 원천 [정상, 취소]에서 2/2(버그), [취소, 정상]에서 1/2(순서 의존) |
| 1·2·3·4 | DB 정상1+원천 정상/취소 → 취소 insert · DB 취소1 → 정상 insert(양 순서) · 전원 정상 · 개수 같음 → none |
| 5·6 | 원천 역순 동일 결과 · 반복 적용 멱등(계획 후 none, reconcile noChange) |
| 7·8·9 | 2행 부족 → 2행, 자리 1·2 · 취소 부족분 정확히 · DB 취소가 이미 충족 → 전부 정상 |
| 10 | 원천 < DB → none, reconcile은 여전히 SIBLING_COUNT_MISMATCH |
| 13·14 | 7개 실제 해제일 × 양 순서 → 1/2 · 기존 21 패턴(개수 같음) 미개입, 과다 취소 DB에 형제가 와도 악화 없음 |
| 15·16·17 | 진짜 취소 insert 보존 · 전원 정상 false-cancel 0 · 전원 취소 정확 개수 |
| 보류 | 부족분 > 넣을 수 · aptSeq 없음 · identity 불일치 |
| 속성 | 원천 ≤4행 전 구성 × DB 부분 구성 × **모든 원천 순서**: insert 시 최종 취소 = max(원천, 삽입 전 DB), 결과가 순서와 무관 |

`src/lib/sync/cancel-insert-path-sync.test.ts` — **실제 `syncOneSaleCell()`** 통합 10개(MOLIT은 fetch XML 대역, DB는 `globalThis.prisma` 메모리 대역, 운영 흐름대로 1차 sync 후 2차 sync)

| # | 확인 |
|---|---|
| E1 | 1차 [취소] → 2차 [정상, 취소] → **DB 1/2**, insertCanceled 0 |
| E2 | 역순 동일 · 반복 sync 멱등(쓰기 0) |
| E3 | 1차 [정상] → 2차 [취소, 정상] → 진짜 취소 insert, 해제일 보존 |
| E4 | 신규 그룹은 기존 동작 |
| E5 | 원천 < DB → 삭제·insert·flip 0, cancelReconcileSkipped 1 |
| E6 | 부족분 > 넣을 수 → 보류, 기존 정상 행 불변, 로그 사유 |
| E7 | dry-run: 쓰기 0, 예상 insert 2 / insertCanceled 1 = 부족분 |
| E8 | restore gate OFF — 과다 취소는 pending 1로만 남고 그대로(2/2) |
| E9·E10 | PARTIAL(2페이지 실패) · INVALID(1페이지 실패) → 쓰기 0 |

**변이 확인**: HEAD의 수정 전 `sale-sync-core.ts`로 바꿔 돌리면 E1이 `{ total: 2, canceled: 2 }`(Production과 같은 버그), E3이 `{ total: 2, canceled: 0 }`(그 순서에서는 진짜 취소를 놓침)으로 **실패**한다. 원복 후 10/10.

## 6. 실데이터 replay (§9·§10)

`scripts/audit-cancel-insert-path-replay.ts` (READ ONLY, prod-db-guard) — 형제 row의 적재 시각이 5분 넘게 벌어진 그룹(= insert 경로를 실제로 두 번 이상 탄 그룹) **304개 / 58셀**, 삽입 전 DB 상태를 복원해 현재 원천과 대조. 1,118셀 전체는 다시 읽지 않았다(원천 스냅샷은 로컬 scratchpad에 저장).

| 지표 | 수정 전(legacy) | 수정 후 |
|---|---|---|
| 원천과 일치(총 형제·취소 수) | 276 / 304 | **304 / 304** |
| 과다 취소 생성 | **28** | **0** |
| 진짜 취소 누락 | 0 | **0** |
| 취소 insert > 부족분 | — | 0 |
| 보류 | — | 0 |
| 셀 fetch 비COMPLETE | 0 | 0 |

- legacy가 틀린 28그룹 = **확정 28행과 정확히 같은 집합**이고, 28개 모두 legacy 예측이 현재 DB 상태와 일치한다(모델 검증).
- 신규 7그룹: 7/7 모두 새 정책에서 원천 1/2와 일치.
- 형제 수가 같은 그룹(기존 7,929그룹 regression 대상)은 코드상 경로가 바뀌지 않았다 — `reconcileGroupCancellation` 무변경, reconcile 루프 변경은 "원천 > DB" 그룹을 skip 대신 insert 계획으로 넘기는 것 하나뿐(예전에도 그 그룹은 쓰기가 없었다). 그래서 전체 셀 재조회는 하지 않았다.

## 7. Dry-run (Production read-only, 수정된 core)

확정 28행이 있는 21셀에 `syncOneSaleCell(mode='dry-run')`:

| 지표 | 값 |
|---|---|
| status | 21/21 COMPLETE |
| 예상 insert / insertCanceled / 보류 | **0 / 0 / 0** (현재 DB 형제 수가 원천과 이미 같음) |
| 예상 flip | 0 |
| cancelRestorePending | **28** (= 기존 21 + 신규 7) |
| cancelRestored | 0 |
| cancelReconcileSkipped | 0 |
| 실제 쓰기 | 0 — 28행 28/28 취소, 최신 updated_at 불변, 전체 행 865,421 불변 |

## 8. 검증

```
npx tsx --test scripts/cancel-insert-plan.test.ts             pass 19  fail 0
npx tsx --test src/lib/sync/cancel-insert-path-sync.test.ts   pass 10  fail 0
npx tsx --test "src/**/*.test.ts" "src/**/*.test.mjs"         pass 2253 fail 0
npx tsx --test "scripts/*.test.ts" "scripts/*.test.mjs"       pass 154  fail 0   (기존 cancel-reconcile-logic·integration 포함)
npx eslint (변경 6개 파일)                                      exit 0
npx tsc --noEmit                                              src/ 오류 0 · 기존 25건 scripts/ 21 + tmp/ 4 → FAIL_EXISTING_SCRIPT_ERRORS
npm run build                                                 Compiled successfully
```

## 9. 남은 것

- **28행 repair는 하지 않았다.** `SALE_CANCEL_RESTORE_ENABLED`는 여전히 미설정(OFF). 승인되면 다음 cron이 dry-run이 보여준 28행을 그룹 개수 기준으로 되돌린다.
- **결함 B**(원천이 회수한 행이 DB에 남음)는 별도 — 삭제 경로 없음, 이번에도 skip.
- `CANCELED_DEFICIT_EXCEEDS_MISSING`(원천이 새 형제와 함께 기존 정상 행까지 취소로 보고)은 보류된다. 그 그룹은 원천 행이 DB에 들어오지 않은 채 남으므로 `insertReconcileSkipped`로 관측한다. replay 304그룹에서는 0건.
- cron metric이 로그에만 있고 Vercel 로그 보존이 약 1시간이라 cron 결과의 사후 확인은 DB 지표(§7의 게이트/census 스크립트)로 한다.

## 10. Production QA

배포 후 기록.
