# E-JIP DEFECT-A 28 POST-CRON RECONTAMINATION AUDIT V1

READ ONLY. Production write 0 · UPDATE/restore 0 · cron code 변경 0 · schema 0.
대상: 09-21 복구한 Defect-A 28행 중 2026-09-22 04:59 KST sale-sync 이후 `deal_canceled=true`로 돌아간 2행.

## 판정

**재오염이 아니다 — 원천(MOLIT)에 새로 등록된 진짜 취소를 cron이 올바르게 반영했다.**
요청서의 다섯 분류(SAME_ROOT_CAUSE / UNFIXED_BRANCH / NEW_DEFECT / SOURCE_WITHDRAWAL / UNKNOWN) 중 어느 것도 사실에 맞지 않아
억지로 고르지 않는다. 정확한 분류는 **GENUINE_SOURCE_CANCELLATION(결함 아님)**.

09-21 문서의 "재오염 위험 없음" 결론은 **유지된다.** 직전 보고에서 "그 결론과 어긋난다"고 쓴 것은 원천을 확인하기 전의 잘못된 추정이었다.

## 1. 대상 2행

| id | 셀 | 단지 | aptSeq | 금액 | 거래일 | 층 | 면적 | occIdx | 현재 | cancelDate | updated_at(KST) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 949532 | 26380:202608 | 보해이브빌 | 26380-181 | 28,000 | 2026-08-07 | 11 | 118.19 | 1 | canceled | `26.09.21` | 09-22 04:59:45 |
| 950722 | 26290:202609 | 대연롯데캐슬레전드1단지 | 26290-2625 | 34,000 | 2026-09-11 | 26 | 49.31 | 1 | canceled | `26.09.21` | 09-22 04:59:41 |

나머지 26행은 `updated_at`이 복구 시각(09-21 10:34 KST) 그대로 — 오늘 cron이 건드리지 않았다.

## 2. 원천 ↔ DB (그룹 전체)

| 그룹 | 원천(오늘) | DB(오늘) | 복구 시점(09-21) 원천 → DB |
|---|---|---|---|
| 보해이브빌 | 형제 2 · 취소 2 · 해제일 {`26.09.03`, `26.09.21`} | 형제 2 · 취소 2 · {`26.09.03`, `26.09.21`} | 취소 1 → DB 2를 1로 복구 |
| 대연롯데캐슬레전드1단지 | 형제 2 · 취소 2 · {`26.09.17`, `26.09.21`} | 형제 2 · 취소 2 · {`26.09.17`, `26.09.21`} | 취소 1 → DB 2를 1로 복구 |

- 형제 수·취소 수·해제일 multiset이 원천과 **정확히 일치**. 자연키 중복 0.
- 복구 전 결함 행(949532)의 해제일은 형제의 `26.09.03`을 **복사한** 값이었다 — Defect-A의 특징.
  오늘 값 `26.09.21`은 **원천이 새로 준 별개의 해제일**이다.
- 복구 script는 apply 시점(09-21 10:34 KST)에 원천을 다시 읽었고 28그룹 전부 `srcCanceled == dbCanceled − 1`이었다.
  즉 두 번째 취소는 **그 이후** MOLIT에 게시됐다(해제일 09-21과 일치).
- occurrenceIndex: 원천은 새 취소를 occIdx 0에, DB는 occIdx 1에 둔다. 형제는 구분 불가하므로 **개수로만 판정**한다(09-21 문서 §4 규칙).

## 3. cron write path

`src/lib/sync/sale-sync-core.ts` `planSaleCellWrites` → 기존 형제 그룹 루프(`:405-438`) → `reconcileGroupCancellation`(`scripts/write-policy-logic.ts:193`).

- 형제 수 2 = 2 → SIBLING_COUNT_MISMATCH 아님
- target 2 > current 1 → 부족분 분기(`:206-227`): 비취소 형제 중 occIdx 최소(= 949532 / 950722)를 취소,
  해제일은 원천 multiset {03, 21} − DB 기존 {03} = **`26.09.21`**
- `planGroupInserts`(`:442-445`)도 이 그룹에 대해 호출되지만 형제 수가 같아 `none` — **insert 경로는 관여하지 않았다.**
  (existing-sibling positive branch는 여전히 Production에서 실행된 적 없음 — 이번 건으로 입증되지도 반증되지도 않는다.)

## 4. 재현 (read-only, `tmp/defect-a-28-postcron-audit/repro.ts`)

- 순수 함수 replay(복구 후·cron 전 DB 상태 + 오늘 원천):
  `toCancel [{949532, 26.09.21}]`, `[{950722, 26.09.21}]`, `planGroupInserts → none` — **실제 기록과 동일.**
- 다음 cron 모의(28그룹이 속한 21셀 전부, 원천 재조회 + live DB, 운영과 같은 `planSaleCellWrites`):
  21/21 COMPLETE · **inserts 0 · flips 0 · restores 0 · 28행 접촉 0 · skip 0.**

## 5. 오늘 cron 창 전체 (2026-09-22 04:59 ~ 08:29 KST)

insert 206 · 기존 행 update 25(현재 canceled 8 / active 17 — active 쪽은 대부분 registry_date 보강).
canceled 8건 중 6건은 형제 없는 그룹(occIdx 0)이고, `26.09.21` 해제일이 우리 2건 외에 4건 더 있다(426937, 551490, 940813, 949770)
→ 09-21자 MOLIT 취소가 여러 단지에 걸쳐 들어온 것이다. Defect-A 모양(형제 해제일 복사)은 없다.

## 6. source withdrawal과의 관계

무관. 두 그룹 모두 원천 형제 = DB 형제(2 = 2), 누락 행 없음.
부수 관찰: withdrawal 목록의 `940812`, `950521`이 오늘 registry_date 보강을 받았다 — 코드상 보강은 원천 자연키 일치가 있어야 생기므로
**원천에 다시 나타났을 가능성**이 있다. 이번 범위 밖, 별도 확인 필요(단정하지 않음).

## 7. 수치 해석

- all-canceled groups 245 → 247, suspect upper bound 304 → 306: **이 2그룹이 원천대로 전부 취소가 된 것**이 전부다.
  upper bound는 정의상 진짜 전부-취소 그룹도 포함하는 상한이므로 증가 자체가 결함 신호가 아니다.
- 스냅샷의 `known28.still_canceled`는 행 단위 지표라 원천의 새 취소도 "재오염"처럼 보인다.
  판정은 `audit-defect-a-28-repair-verify.ts`의 그룹 판정(`dbCanceled == srcCanceled`, 28/28 NO_EXCESS)을 따라야 한다.

## 결론 / 다음

- 확정 결함 0 · 의심 0 · 다음 cron 위험 없음 · 코드 수정 불필요.
- 권고: 사후 스냅샷의 `known28.still_canceled`를 그룹-원천 비교로 바꾸거나 옆에 병기한다(tooling, 별도 STEP).
- 권고: `940812`/`950521` 재등장 여부를 원천으로 확인해 withdrawal 목록을 갱신한다(read-only, 2셀).
