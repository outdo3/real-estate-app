# E-JIP POST-CRON CANCELLATION + JUNG-GU PILOT REVALIDATION V2

2026-09-21 sale-sync / sale-recheck가 **실제로 실행된 뒤** 취소 gate와 중구 pilot 준비도를 재검증한다.
V1은 크론 실행 전이라 §1을 증명할 수 없어 PARTIAL이었다.

- 측정: 2026-09-21 09:30~09:45 KST · 기준 커밋 `9f936e8`
- **Production INSERT / UPDATE / DELETE 0** · 서울 apply 0 · Defect-A repair 0 · env 변경 0 · runtime `src/` 변경 0
- 모든 DB 접근은 `SET TRANSACTION READ ONLY`

## 판정

| 축 | 결과 |
|---|---|
| **A. Cancellation Gate** | **PASS** |
| **B. SALE Insert-Path Positive Proof** | **PROVEN** (일반 insert 경로) · **STILL_UNPROVEN** (이번 수정의 대상인 `planGroupInserts()` 형제 분기) |
| **C. Jung-gu Pilot Readiness** | **READY_FOR_APPROVAL · N = 943** |

A와 B는 별개로 판정했다. B는 다시 **두 갈래로 쪼개야** 정확하다 — 아래 §2.

---

## 0. Safe start

`main` · HEAD `9f936e8` · 기존 modified/untracked user work 전부 보존(reset·stash·clean·stage 0).
측정용 임시 스크립트 6개는 실행 후 삭제했고, 작업 전후 `git status`가 동일하다.
추가된 파일은 `tmp/seoul-pilot-rowset/` 의 **이번 회차 rowset artifact 1개**뿐이다(측정마다 남기기로 한 산출물).

## 1. 2026-09-21 cron completion — **실행 확인됨**

시계가 아니라 **run 기록**으로 확인했다. 현재 시각 2026-09-21 09:30 KST (`2026-09-21T00:30Z`).

| run id | dataset | cells | COMPLETE | fetched | inserted | updated | 시작(KST) | 종료(KST) |
|---|---|---|---|---|---|---|---|---|
| `sale-2026-09-20T19-59-31-982Z` | SALE | 48 | **48** | 7,552 | 0 | 0 | 04:59:31 | **04:59:54** |
| `rent-2026-09-20T21-57-34-149Z` | RENT | 21 | **21** | 4,236 | 0 | 0 | 06:57:34 | 06:57:46 |
| `sale-recheck-2026-09-20T23-29-18-152Z` | SALE | 120 | **120** | 24,715 | 0 | 0 | 08:29:18 | **08:30:00** |

정기 sale-sync와 recheck 모두 **COMPLETE**. 불완전 셀 **0**.
(시작 시각은 `run_id`에 박힌 timestamp, 종료는 `verified_at`.)

### `sync_coverage_cells`는 불변 run log가 아니다

`UNIQUE (dataset, lawd_cd, deal_ymd)` — 셀은 **upsert**된다. 새 run이 같은 셀을 덮으면 그 셀의
`run_id`·`fetched/inserted/updated_count`가 **통째로 교체**된다. 그래서 V1이 기록한
`sale-2026-09-19T19-59-31-977Z`(48셀)와 `rent-2026-09-19T21-57-34-070Z`(21셀)는 지금 목록에서
사라졌고, 2026-09-19 recheck는 51셀 → 40셀로 줄었다. **run이 사라진 게 아니라 셀 소유권이 최신 run으로 넘어간 것**이다.

→ run 단위 `SUM(inserted_count)`는 **과거 insert의 신뢰할 수 있는 기록이 아니다.**

## 2. Insert-path positive proof — **두 갈래로 나눠야 한다**

### 2-1. 셀 지표가 0인 이유 (구조적 맹점)

`src/lib/sync/sale-sync-core.ts:94`

```ts
// §15 — 진행 중인 현재월은 동기화는 하되 절대 검증 완료로 기록하지 않는다.
if (dealYmd <= latestComplete) { coverage.push({ ... }); }
```

**현재월(202609)은 동기화하되 coverage cell을 아예 남기지 않는다.** 실제로 SALE 셀은
202508~202608만 존재하고 **202609 셀은 0개**다. 그런데 신규 거래는 대부분 현재월에 들어온다.

→ `SUM(inserted_count) = 0`은 **"insert가 없었다"가 아니라 "현재월 insert를 셀 수 없다"**는 뜻이다.
V1이 이 지표로 "STILL_UNPROVEN"이라 판정한 것은 **측정 대상을 잘못 고른 것**이었다.

### 2-2. 행 테이블로 본 실제 결과 — **PROVEN**

`apartment_trade_histories.created_at` 기준, 배포 이후 생성된 행 **2건**:

| id | lawd_cd | deal_ymd | 단지 | 금액 | 거래일 | 층 | occIdx | canceled | created_at |
|---|---|---|---|---|---|---|---|---|---|
| 950793 | 26350 | **202609** | 롯데캐슬마린 | 77,500 | 2026-09-05 | 14 | 0 | false | `2026-09-20T19:59:44.724Z` |
| 950794 | 26350 | **202609** | 건영2 | 62,800 | 2026-09-07 | 18 | 0 | false | `2026-09-20T19:59:44.724Z` |

생성 시각이 sale-sync run 구간(19:59:31~19:59:54Z) **안**이다. RENT가 아니라 **SALE** 테이블이다
(RENT는 `apartment_rent_histories`).

→ **배포 이후 Production SALE insert 경로가 실제로 양의 결과를 냈다. PROVEN.**

### 2-3. 그런데 **이번 수정이 고친 분기**는 아직 미검증

`sale-sync-core.ts`의 insert는 두 갈래다:

| 분기 | 대상 | 이번 수정(`CANCELLATION_INSERT_PATH_FIX_V1`) |
|---|---|---|
| **그룹 분기** `planGroupInserts()` | DB에 **형제가 이미 있는** 그룹 | **이것이 수정 대상** |
| 행 분기 `classifyRow()` | 형제 0인 **신규 그룹** | 변경 없음 |

위 2행은 `occurrence_index = 0`의 **신규 그룹**이므로 **행 분기**를 탔다.
그리고 `groups_with_sibling_added_since_deploy` = **빈 배열** — 배포 이후 형제가 늘어난 그룹이 0이다.

→ **`planGroupInserts()` 형제 분기는 여전히 Production에서 한 번도 실행되지 않았다. STILL_UNPROVEN.**
"false-cancel 0"이 그 분기가 옳다는 증거가 되지 못한다는 V1의 경고는 **그대로 유효하다.**

## 3. Cancellation baseline

| 지표 | V1 기준 | 현재 | 차이 |
|---|---|---|---|
| 전체 sale 행 | 865,421 | **865,423** | **+2** |
| 부산(26) | 865,289 | **865,291** | **+2** |
| 서울(11) | 46 | **46** | 0 |
| 대구(27) | (미열거) | 86 | — |
| canceled | 16,345 | **16,345** | 0 |
| active | 849,076 | **849,078** | +2 |
| all-canceled groups | 273 | **273** | 0 |
| suspect upper bound | 334 | **334** | 0 |
| multi-sibling groups | 13,065 | **13,065** | 0 |
| 자연키 중복 | 0 | **0** | 0 |

**+2는 §2-2의 26350 신규 2행으로 전부 설명된다.** 취소 관련 지표는 하나도 움직이지 않았다.

## 4~6. 신규 결함 감사

현재월(202609)은 coverage cell이 없어 자동 parity 신호가 **구조적으로 존재하지 않는다.**
그 사각을 닫기 위해 부산 16개 구 × 202609를 원천 재조회해 DB와 **행 단위 대조**했다(16/16 COMPLETE, 원천 1,111행 / DB 1,114행).

| 항목 | 결과 | 목표 |
|---|---|---|
| **new_false_cancel_count** | **0** | 0 |
| **new_overcancel_count** | **0** | 0 |
| **new missing genuine cancellation** | **0** | 0 |
| 원천 canceled / DB active (현재월) | **0** | — |
| 원천에 있으나 DB에 없음 | **0** | — |
| all-canceled group 중 배포 이후 touch된 것 | **0** | — |
| 배포 이후 형제가 늘어난 그룹 | **0** | — |
| recheck 202508~202605 | 24,715행 fetch → **updated 0** | — |

`SALE_CANCEL_RESTORE_ENABLED`가 꺼져 있어 restore는 보류되지만 **cancel flip은 보류되지 않는다.**
따라서 recheck의 `updated 0`은 "202508~202605에 놓친 genuine cancellation이 없다"로 읽어야 한다.

취소 flip 경로 자체는 살아 있다 — 2026-09-20 KST run이 2건(`950280`, `949533`, cancelDate `26.09.19`)을 정상 반영했다.
2026-09-21 run은 flip 0건이며, 원천에 새 취소가 없었기 때문이다.

### 현재월 대조에서 나온 10건 — 전부 기존 사안

**DB canceled / 원천 active 7건** — 전부 **2형제 all-canceled 그룹의 `occIdx=0` 짝**이고,
그 형제가 known-28 안에 있다:

| id | 구 | 단지 | 형제 id | 형제의 known-28 소속 |
|---|---|---|---|---|
| 949449 | 26470 | 시청역SKVIEW | 950590 | new7 |
| 949965 | 26380 | 신우림 | 950570 | new7 |
| 950105 | 26290 | 롯데캐슬인피니엘 | 950723 | new7 |
| 950421 | 26290 | 대연롯데캐슬레전드1단지 | 950722 | new7 |
| 950562 | 26380 | 괴정한신더휴 | 950664 | new7 |
| **950102** | 26260 | 사직KCC스위첸2단지 | **950239** | **known21** |
| **950306** | 26380 | 몰운대 | **950451** | **known21** |

known-28은 false-cancel **형제 행**을 센 수이고, 이 대조는 **같은 그룹의 짝 행**을 잡는다.
**같은 7개 그룹을 다른 각도에서 본 것이며 신규 결함이 아니다.**
10건 모두 `created_at`/`updated_at`이 **2026-09-18 이전**으로, 2026-09-21 크론이 만든 것이 하나도 없다.

**DB에 있으나 원천에서 사라진 3건** — 아래 §20에 별건으로 기록한다.

## 7. Known Defect-A 28 — **KNOWN_28_STABLE**

| 항목 | 값 |
|---|---|
| known21 | 21행 · **still_canceled 21 · restored 0** · 최신 update `2026-09-15T20:00:04Z` |
| new7 형제 | 7행 전원 존재·전원 canceled · 그룹당 형제 정확히 2 |
| **합계** | **28 — 증가 0 · 감소 0** |
| 추가 검출 | **0** |
| 이번 repair | **0** (금지 준수) |

2026-09-21 크론은 28행 중 **어느 것도 건드리지 않았다.**

## 8. Jung-gu fresh source (운영 driver와 동일 normalization path)

| 항목 | 값 |
|---|---|
| **원천 행** | **943** |
| active / canceled | **888 / 55** |
| 셀 | **12 / 12 COMPLETE** |
| PARTIAL / FAILED / invalid | **0 / 0 / 0** |
| `collected == totalCount` | 12/12 |
| 원천 내 자연키 중복 | **0** |

월별: 202510 146 · 202511 34 · 202512 78 · 202601 79 · 202602 65 · 202603 104 · 202604 128 · 202605 131 · 202606 61 · 202607 80 · 202608 32 · 202609 5

## 9. 이전 rowset과 행 단위 비교 — **완전 동일**

`rowset-11140-202510-202609-2026-09-20T15-51-55-541Z.json`(943행) 대비 `--compare`:

| 항목 | 값 |
|---|---|
| previous count | 943 |
| **current count** | **943** |
| **removed / added / cancelChanged** | **0 / 0 / 0** |

V1이 남긴 기준선 덕분에 이번엔 **"왜 943인가"를 행 단위로 답할 수 있다 — 한 행도 움직이지 않았다.**
(V1의 944→943은 비교 대상이 없어 여전히 설명 불가이며, 그 공백은 이미 닫혔다.)

## 10~12. Master · 기존 행 · 계획 (운영 driver dry-run)

`[DRY RUN] cells=12 {"READY":12} inserts=943 expectedSkips=0 expectedActualInserts=943 existingUpdates=0 — DB write 없음`

| 항목 | 값 | 목표 |
|---|---|---|
| **EXACT_MASTER** | **943** | == source total |
| MASTER_MISSING · INVALID_APTSEQ · REVIEW_REQUIRED | **0 · 0 · 0** | 0 |
| 중구(`11140`) 기존 DB 행 | **0** | 0 |
| existing matched · **existing updates** | **0 · 0** | 0 |
| same-district · cross-district collision | **0 · 0** | 0 |
| **expectedSkips** | **0** | 0 |
| nonCanonicalInserts | 0 | — |
| **planned inserts** | **943** | — |
| **expected actual inserts** | **943** (= 943 − 0) | — |

aptSeq exact only — 이름/지번 fallback · fuzzy · first-match 미사용.
**두 독립 경로(rowset 스크립트 · 운영 driver)가 같은 943을 냈다.**

## 13. Driver safety gates — 실제 거부 확인

`evaluateApplyGates()`를 실제 호출해 거부 경로를 확인했다(순수 함수, DB 접근 0):

| 시나리오 | 결과 |
|---|---|
| 모든 gate 충족 + `--expect-inserts=943` | ALLOWED |
| **`--expect-inserts` 불일치(942)** | **REFUSED** `EXPECT_INSERTS_MISMATCH_942_NE_943` |
| `--expect-inserts` 미지정 | **REFUSED** `EXPECT_INSERTS_REQUIRED` |
| **existingUpdates>0 + 승인 없음** | **REFUSED** `EXISTING_UPDATES_NEED_APPROVAL_5` |
| **`DEFECT_A_GATE_PASS` 없음** | **REFUSED** `BLOCKED_FOR_APPLY_DEFECT_A_GATE` |
| `ALLOW_PROD_DB_WRITE` 없음 | **REFUSED** `ALLOW_PROD_DB_WRITE_NOT_1` |
| 셀 READY 아님(3) | **REFUSED** `CELLS_NOT_READY_3` |
| **현재 실제 env** | **REFUSED** `ALLOW_PROD_DB_READ_NOT_1, ALLOW_PROD_DB_WRITE_NOT_1, BLOCKED_FOR_APPLY_DEFECT_A_GATE` |

`npx tsx --test scripts/backfill-seoul-sale.test.ts` → **26 pass / 0 fail**.

## 14. Env gate (이름만 · 값 출력 0)

| 변수 | process | `.env` / `.env.local` 선언 |
|---|---|---|
| `DEFECT_A_GATE_PASS` | **NOT SET** | 없음 |
| `SALE_CANCEL_RESTORE_ENABLED` | **NOT SET** | 없음 |
| `ALLOW_PROD_DB_WRITE` | **NOT SET** | 없음 |

**env 변경 0.** 값은 읽지도 출력하지도 않았다.

## 15. No-write assertion

| 항목 | 값 |
|---|---|
| Production INSERT / UPDATE / DELETE | **0 / 0 / 0** |
| driver 보고 `writes` | `{insert: 0, update: 0, delete: 0}` |
| 서울 apply · Defect-A repair · env 변경 · schema 변경 | 0 · 0 · 0 · 0 |
| runtime `src/` 변경 | **0** |
| MOLIT 호출 | 43회 (rowset 12 · driver 12 · 현재월 parity 16 · 원천 확인 3) · driver 시점 잔여 quota 6,527 |

## 16. Apply 명령 (실행하지 않음 — 승인 대기)

```bash
ALLOW_PROD_DB_READ=1 ALLOW_PROD_DB_WRITE=1 DEFECT_A_GATE_PASS=1 \
npx tsx scripts/backfill-seoul-sale.ts \
  --district=11140 --from=2025-10 --to=2026-09 \
  --apply --expect-inserts=943 \
  --out=tmp/seoul-junggu-pilot-apply
```

`--approve-existing-updates`는 **불필요하고 금지**다(existingUpdates 0).
**N=943은 측정 시점 값이다.** 원천이 이틀간 완전히 고정이었으므로 신뢰도는 V1보다 높지만,
apply 직전 dry-run을 한 번 더 돌려 그 값을 `--expect-inserts`에 넣는 절차는 유지한다(driver가 불일치를 스스로 거부한다).

## 20. Blockers / 관찰

**중구 pilot을 막는 blocker는 없다.**

다만 이번 대조에서 **범위 밖 사안 1건**을 관찰했다 — 수정하지 않았다.

### MOLIT 원천이 조용히 회수한 행 3건 (부산 202609)

| id | 구 | 단지 | 금액 | 거래일 | DB 상태 | 원천 현재 |
|---|---|---|---|---|---|---|
| 940812 | 26380 | 아람센트럴시티 | 17,000 | 2026-09-01 | **active** | 이 거래 없음(해당 단지는 24,200 / 09-12 / 3층 건만 보고) |
| 950148 | 26470 | 성일이안시티 | 25,000 | 2026-09-11 | **active** | 해당 단지 이달 거래 **0건** |
| 950521 | 26290 | 대연동동일스위트 | 8,000 | 2026-09-09 | **active** | 해당 단지 이달 거래 **0건** |

- **취소가 아니다.** MOLIT은 취소를 `cancelDate` 플래그로 표현하는데, 이 3건은 플래그 없이 **응답에서 사라졌다.**
- **이번 크론이 만든 문제가 아니다.** 3행 모두 2026-09-03 / 09-11 / 09-16 생성 후 한 번도 갱신되지 않았다.
- 시스템에 delete 경로가 없어 **원천이 더 이상 보고하지 않는 거래가 active로 남는다.**
- 발생 시점은 **특정 불가** — 부산 원천 rowset 기준선이 없어 언제 사라졌는지 말할 수 없다.

정책 판단(회수를 어떻게 다룰 것인가)이 필요한 사안이라 **보고만 하고 건드리지 않았다.**

## 21. 다음 권고

1. **중구 pilot apply를 승인받는다.** 게이트·원천·master·충돌이 전부 목표치이고, 원천이 이틀간 행 단위로 완전히 고정이었다. apply 직전 dry-run으로 N을 재확정한다.
2. **`planGroupInserts()` 형제 분기는 계속 미검증으로 둔다.** 현재월 대조(0/0/0)를 **매일 또는 크론 직후** 돌려, 형제가 늘어난 그룹이 처음 생기는 순간을 포착하는 것이 가장 싼 검증이다. 중구 apply는 신규 그룹 943건이라 이 분기를 타지 않으므로 **이 검증을 대신하지 못한다.**
3. **현재월 맹점을 지표로 인정한다.** `SUM(inserted_count)`는 설계상 현재월을 볼 수 없다. 크론 건전성은 `apartment_trade_histories.created_at`을 run 구간과 대조해 판단해야 한다.
4. **부산 원천 rowset 기준선을 남긴다.** 중구에 만든 것과 같은 방식이면 §20의 "언제 사라졌는지 모른다"가 다음부터는 답이 된다.
5. 중구 pilot과 Defect-A 28 repair는 계속 **별개 STEP·별개 트랜잭션**으로 유지한다.
