# E-JIP CANCELLATION RATCHET PREVENTION FIX V1

취소 플래그 래칫(결함 A)의 **재발 원인을 ingest 단계에서 제거한다.** 기존 21행은 이번 STEP에서 고치지 않는다.

- 날짜: 2026-09-16 (KST)
- 기준 커밋: `a6704dc` (REPAIR_AUDIT_V1 직후)
- 범위: write policy + sale ingest write path. **schema/migration 0, Production 데이터 repair 0.**
- 선행 근거: `docs/development/CANCELLATION_RATCHET_DEFECT_A_REPAIR_AUDIT_V1.md`

---

## 0. 결론 요약

**판정: PASS**

1. **취소 판정을 행 단위 → occurrence 그룹 단위 "개수" 정합으로 바꿨다.** 원천이 그룹에 취소 C건을 보고하면 DB에도 정확히 C건만 둔다. 개수는 응답 순서와 무관하므로 **순서가 뒤집혀도 결과가 변하지 않는다** — 래칫이 성립할 수 없다.
2. **자연키·occurrenceIndex·schema를 건드리지 않았다.** 바뀐 것은 "어떤 형제가 취소 상태여야 하는가"를 정하는 정책뿐이다.
3. **단방향 래칫을 없앴다.** 필요하면 `false→true`와 `true→false` 양방향이 가능하다. 단, 원천 셀이 `COMPLETE`/`EMPTY_VALID`이고 형제 수가 일치할 때만이다.
4. **Production 스냅샷 replay에서 목표를 정확히 달성했다**: 7,929 그룹 중 7,907은 `noChange`(진짜 취소를 하나도 건드리지 않음), 21은 확정 false-cancel만 치유 대상으로 지목, 1은 결함 B라 skip. **잔여 false-cancel 0 · 진짜 취소 오작동 0 · 잘못된 신규 취소 0.**
5. **§15 준수를 위해 치유 쓰기를 기본 꺼짐으로 뒀다.** 이 정책은 본질적으로 자가 치유적이라, 그냥 배포하면 **오늘 밤 cron이 기존 21행을 자동 복구한다**(cron은 현재 매일 실제로 돌고 있다). 예방과 repair를 분리하라는 요구에 맞춰 `SALE_CANCEL_RESTORE_ENABLED=1`일 때만 쓰도록 게이트를 뒀다. **꺼진 상태에서도 예방은 완전히 동작한다.**

---

## 1. Root cause (코드에서 재확인)

| 단계 | 파일:라인 | 동작 |
|---|---|---|
| 1 | `scripts/trade-history-logic.ts:149-151` | `occurrenceIndex`를 MOLIT 응답 등장 순서로 부여 |
| 2 | `src/lib/sync/sale-sync-core.ts:44` | 자연키 = `group_key\|금액\|계약일\|층\|occurrenceIndex` |
| 3 | `scripts/write-policy-logic.ts:58` | `false→true`만 적용(`updateFalseToTrue`) |
| 4 | `scripts/write-policy-logic.ts:61` | `true→false`는 차단(`updateTrueToFalseSkipped`) |

### call chain (Production ingest)

```
vercel.json cron
  → /api/cron/sale-sync?mode=apply        (04:00 KST)  ─┐
  → /api/cron/sale-recheck?mode=apply     (08:00 KST)  ─┤
                                                        ├→ runSaleSync / runSaleRecheck
                                                        └→ syncOneSaleCell()          ← 유일한 SALE 쓰기 지점
                                                             ├ fetchSaleRegionMonth()  (완전성 판정)
                                                             ├ normalizeMolitItemsToTradeRows()
                                                             └ classifyRow() + [NEW] reconcileGroupCancellation()
```

`classifyRow`를 쓰는 다른 경로(`scripts/resync-cancellation-v2.ts`, `scripts/sale-cancellation-coverage/band-scan.ts`)는 수동/진단용이며 이번 STEP에서 변경하지 않았다.

### cron이 실제로 돌고 있다 (중요)

| run | 최근 실행 | 셀 |
|---|---|---|
| `sale-...` | 2026-09-15 20:00 UTC | 48 |
| `sale-recheck-...` | 2026-09-15 23:30 UTC | 53 |
| `rent-...` | 2026-09-15 21:57 UTC | 23 |

sync 범위(최근 4개월)와 recheck band(3~12개월 전)를 합치면 **확정 21행의 셀이 전부 포함된다**. 그래서 §5의 게이트가 필요하다.

---

## 2. 새 semantics

### 이전

```
행마다: naturalKey(occurrenceIndex 포함)로 매칭 → fresh.dealCanceled 와 비교
        false→true 면 쓴다 / true→false 면 막는다
```
→ 응답 순서가 바뀌면 **다른 형제**가 매칭돼 flip되고, 먼저 flip된 형제는 영원히 복구되지 않는다.

### 이후

```
그룹마다(= group_key|금액|계약일|층, occurrenceIndex 제외):
  원천 취소 수 C  vs  DB 취소 수 K
  C == K  → 변화 없음
  C >  K  → (C-K)행을 취소로      (후보: 현재 비취소, occurrenceIndex 오름차순)
  C <  K  → (K-C)행을 유효로 되돌림 (후보: 현재 취소 & registryDate NULL, occurrenceIndex 내림차순)
  형제 수 불일치 → 아무것도 하지 않는다
```

`reconcileGroupCancellation()` — `scripts/write-policy-logic.ts`의 **순수 함수**(DB/네트워크 없음).

### 결정적 형제 선택

형제는 `group_key·금액·계약일·층`이 전부 같아 서로 구분되지 않는다. 그래서 선택 규칙은 "원본 복원"이 아니라 **결정적 규칙**이다(`occurrenceIndex` 오름/내림차순, 동률은 `id`). 형제의 모든 식별 필드가 동일하므로 결과 상태는 어느 쪽을 골라도 동등하다. **원천 배열의 위치는 절대 보지 않는다** — 테스트로 고정했다.

---

## 3. 안전 가드

| 요구 | 구현 |
|---|---|
| §3 자연키 불변 | `occurrenceIndex`를 값으로 쓰는 곳은 insert 하나뿐. UPDATE는 자연키를 건드리지 않는다(테스트 고정) |
| §6 원천 완전성 | `syncOneSaleCell`의 기존 §11 가드 유지 — `INVALID`/`PARTIAL`이면 **reconciliation 이전에** 조기 반환. 순서까지 테스트로 고정 |
| §7 형제 수 불일치 | `SIBLING_COUNT_MISMATCH`로 skip. 추측해서 더 취소하거나 되돌리지 않는다 |
| §8 필드 범위 | 취소 쓰기는 `deal_canceled` + `cancel_date`만. **취소와 `registry_date`를 같은 UPDATE에서 쓰지 않는다**(테스트 고정) |
| §8 등기일자 | `registry_date`가 있는 행은 되돌리지 않는다(`UNRESTORABLE_REGISTRY_DATE`) |
| §13 그룹 독립성 | 그룹마다 독립 판정. 한 그룹 결정이 다른 그룹에 영향을 주지 않는다 |

취소 flip이 더 이상 `registryDate`를 함께 쓰지 않는 것은 **의도적 변경**이다. 어느 형제를 취소로 둘지가 이제 특정 원천 행이 아니라 그룹 개수로 정해지므로, 그 행에 특정 원천 행의 등기일자를 옮겨 적을 근거가 없다. 등기일자 보충은 기존 전용 경로(형제 전원 동일할 때만)가 계속 담당한다.

---

## 4. §15 — 치유 게이트 (기본 꺼짐)

새 정책은 **자가 치유적**이다. 그대로 배포하면 오늘 밤 cron이 확정 21행을 자동으로 되돌린다. 예방과 repair를 분리하라는 요구에 따라 쓰기만 막았다.

```
SALE_CANCEL_RESTORE_ENABLED = '1'  → true→false 쓰기 수행
그 외(기본)                         → 쓰지 않고 cancelRestorePending 으로만 기록
```

**꺼진 상태에서도 예방은 100% 동작한다** — `toCancel`은 구조적으로 원천 취소 개수를 넘을 수 없으므로 새로운 과다 취소가 생기지 않는다. 게이트는 오직 "이미 잘못된 과거 데이터를 지금 고칠 것인가"만 통제한다.

repair 승인 시 코드 변경 없이 env 하나만 켜면 되고, 그때는 **bulk UPDATE 스크립트가 필요 없다** — 검증된 ingest 경로가 셀 단위로, 그 순간의 원천을 다시 읽어서, 관측 가능한 metric과 함께 고친다.

---

## 5. 관측 metric

`CellReport` / `SyncSummary`에 추가(기존 `updated`와 **절대 합치지 않는다** — 반대 방향 사건이다):

| 필드 | 의미 |
|---|---|
| `cancelRestored` | 원천에 맞춰 되돌린 row 수 |
| `cancelRestorePending` | 게이트가 꺼져 쓰지 않고 남긴 row 수(승인 대기) |
| `cancelReconcileSkipped` | 형제 수 불일치·identity 충돌·등기일자로 건너뛴 그룹 수 |

cron 로그 예:
```
COMPLETE 26350:202608 fetched=272 ... flips=0 cancelRestored=0 cancelRestorePending=3 cancelReconcileSkipped=0 ...
```
개인정보·비밀값은 남기지 않는다.

---

## 6. 테스트

### 순수 정책 — `scripts/cancel-reconcile-logic.test.ts` (18개 전부 통과)

요구된 17개 케이스를 모두 덮는다:

| # | 케이스 | 결과 |
|---|---|---|
| 1 | 원천 순서 동일 | noChange |
| 2 | **원천 순서 역전** | 동일 결정(결함 A 근원 제거) |
| 3 | 반복 sync | 변화 없음 |
| 4 | 취소 1건 | noChange |
| 5 | 취소 2건 | noChange |
| 6 | **과다 취소 → 치유** | toRestore 1건 |
| 7 | 정당한 active→cancel | toCancel 1건 |
| 8 | 정당한 cancel→active | toRestore 1건 |
| 9 | 진짜 전원 취소 | 유지(되돌리지 않음) |
| 10 | 혼합 그룹 | 유지 |
| 11 | 형제 수 불일치 | skip |
| 12 | 원천 0행 | skip("못 읽음"≠"취소 아님") |
| 13 | registryDate 존재 | skip |
| 14 | 동일 형제 결정성 | 순서 무관 동일 선택 |
| 15 | 재실행 | 멱등 |
| 16 | occurrenceIndex 배열 변화 | 취소 개수 불변 |
| 17 | **실제 21건 패턴 재현** | 치유 후 순서를 뒤집어도 재발 없음 |
| + | 옛 정책 vs 새 정책 대비 | 옛 정책은 2건으로 늘어나고, 새 정책은 1건 유지 |

### ingest 통합 계약 — `src/lib/sync/cancel-reconcile-integration.test.ts` (8개 전부 통과)

주석을 제거한 소스에 대해 계약을 고정한다(주석 문구로 통과하지 않도록):
취소 쓰기가 reconciliation에서만 나오는지 · 완전성 가드가 reconciliation보다 **앞**인지 · UPDATE가 취소와 registryDate를 동시에 쓰지 않는지 · 자연키를 건드리지 않는지 · 치유가 기본 꺼짐인지 · 예방 경로에는 게이트가 없는지 · 형제 수 불일치 skip · 결정적 정렬 · 래칫 분류 미참조.

### 실행 결과

```
npx tsx --test scripts/cancel-reconcile-logic.test.ts              pass 18   fail 0
npx tsx --test src/lib/sync/cancel-reconcile-integration.test.ts   pass 8    fail 0
npx tsx --test "src/**/*.test.ts" "src/**/*.test.mjs"              pass 2179 fail 0
npx tsx --test "scripts/*.test.ts" "scripts/*.test.mjs"            pass 135  fail 0
npx eslint (변경/신규 7개 파일)                                      exit 0
npx tsc --noEmit                                                   src/ 오류 0
                                                                   기존 25건은 scripts/·tmp/ → FAIL_EXISTING_SCRIPT_ERRORS
npm run build                                                      Compiled successfully in 2.2s
```

---

## 7. §11/§12 — Production 스냅샷 replay (read-only)

`scripts/audit-cancel-reconcile-replay.ts` — 실제 DB 스냅샷 + MOLIT 원천으로 새 정책을 돌려 **적용했다면 어떤 결과였을지** 계산한다. 쓰기 0.

대상: 취소가 1건 이상인 다형제 그룹 **7,929개 / 1,118 셀 (전부 COMPLETE)**.

| 결정 | 그룹 |
|---|---|
| `noChange` | **7,907** |
| `reconcile` | **21** (전부 toRestore, toCancel 0) |
| `skipped: SIBLING_COUNT_MISMATCH` | 1 (결함 B — 올바르게 제외) |

| 목표 | 결과 |
|---|---|
| §11 잔여 false-cancel | **0** |
| §12 진짜 취소를 잘못 되돌린 그룹 | **0** |
| 잘못된 신규 취소 | **0 rows** |

**7,907개 진짜 취소 그룹을 하나도 건드리지 않으면서, 확정 21행만 정확히 지목한다.**

---

## 8. §13 — 실제 ingest dry-run (Production, 쓰기 없음)

`scripts/qa-cancel-reconcile-dryrun.ts` — 운영 `syncOneSaleCell()`을 `mode='dry-run'`으로 그대로 호출.

| lawdCd | dealYmd | status | 기대 치유 | pending | restored | flips | inserted | 판정 |
|---|---|---|---|---|---|---|---|---|
| 26350 | 202608 | COMPLETE | 3 | **3** | 0 | 0 | 0 | PASS |
| 26230 | 202608 | COMPLETE | 2 | **2** | 0 | 0 | 0 | PASS |
| 26260 | 202609 | COMPLETE | 1 | **1** | 0 | 0 | 0 | PASS |
| 26380 | 202609 | COMPLETE | 1 | **1** | 0 | 0 | 0 | PASS |
| 26110 | 202608 | COMPLETE | 1 | **1** | 0 | 0 | 0 | PASS |
| 26410 | 202602 | COMPLETE | 1 | **1** | 0 | 0 | 0 | PASS |
| 26140 | 202603 | COMPLETE | 0 | 0 | 0 | 0 | 0 | PASS |
| 26470 | 202608 | COMPLETE | 0 | 0 | 0 | 0 | 0 | PASS |

셀별 기대 건수가 정확히 맞고, `cancelRestored`는 전부 0(게이트 꺼짐), 불필요한 flip/insert 0. 대조군 2개 셀은 pending 0.

---

## 9. 변경 파일

| 파일 | 변경 |
|---|---|
| `scripts/write-policy-logic.ts` | `reconcileGroupCancellation()` 및 타입 추가(기존 함수 변경 0) |
| `src/lib/sync/sale-sync-core.ts` | 취소 쓰기를 그룹 reconciliation으로 교체 + 치유 게이트 + metric |
| `src/lib/sync/shared.ts` | `cancelRestored` / `cancelRestorePending` / `cancelReconcileSkipped` 필드 |
| `scripts/cancel-reconcile-logic.test.ts` | 신규 — 순수 정책 테스트 18개 |
| `src/lib/sync/cancel-reconcile-integration.test.ts` | 신규 — ingest 계약 테스트 8개 |
| `scripts/audit-cancel-reconcile-replay.ts` | 신규 — read-only replay |
| `scripts/audit-cancel-reconcile-cronstate.ts` | 신규 — read-only cron 활성 확인 |
| `scripts/qa-cancel-reconcile-dryrun.ts` | 신규 — 운영 core dry-run QA |

`classifyRow()`는 **변경하지 않았다** — 다른 진단 스크립트가 계속 쓴다. 다만 ingest core는 더 이상 그 취소 분류로 쓰기를 만들지 않는다.

---

## 10. 하지 않은 것

- **기존 21행 repair 0** — repair 스크립트 미실행, bulk UPDATE 0, manual SQL 0.
- schema/migration 0. canonical identity 재설계 0. fuzzy matching 0.
- rent/officetel/분양권 경로 변경 0(rent 응답에는 취소 필드가 없다).
- `classifyRow` 자체 변경 0. 수동 진단 스크립트 변경 0.
- cron 스케줄/범위 변경 0.

---

## 11. 남은 위험

- **치유가 꺼져 있는 동안 기존 21행은 계속 틀린 상태다** — 단지 10곳의 "최근 실거래"와 신고가 2건, 래미안포레스티지2단지의 거래 0건 표시가 그대로 남는다. 승인 즉시 env 하나로 해소된다.
- 새 정책의 `toCancel` 경로는 replay에서 0건이었다(부산 현 상태가 이미 정합이라). **취소가 새로 들어오는 실제 흐름은 다음 cron 실행에서 처음 관측된다.**
- 형제 수가 다른 그룹(결함 B)은 여전히 방치된다 — 원천이 회수한 행을 지우는 경로가 없다. 별도 STEP 필요.
- `occurrenceIndex`는 여전히 순서 기반이다. 취소 판정에는 더 이상 영향이 없지만, 등기일자 보충은 여전히 "형제 전원 동일" 가드에 의존한다.
- 서울/경기 확장 시 형제 그룹 비율이 높아질 수 있으나, 이 정책은 그룹 크기와 무관하게 성립한다.
