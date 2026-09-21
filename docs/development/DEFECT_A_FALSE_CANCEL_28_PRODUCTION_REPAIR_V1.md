# E-JIP DEFECT-A FALSE-CANCEL 28 PRODUCTION REPAIR V1

결함 A(취소 플래그 래칫)가 만든 **known false-cancel 28행**을 Production에서 복구했다.
사용자 명시 승인 하에 수행한 **UPDATE 전용** 작업이다.

- 실행: **2026-09-21 10:34:01 KST** (`2026-09-21T01:34:01Z`) · 기준 커밋 `c023963`
- **UPDATE 28 · INSERT 0 · DELETE 0** · 단일 트랜잭션
- schema/migration 0 · 서울 추가 backfill 0 · 중구 943건 수정 0 · 부산 withdrawn 3건 0 · runtime `src/` 변경 0
- 롤백 자료: `tmp/defect-a-28-repair/snapshot-pre-repair.json` (복구 전 28행 원본)

## 판정

**PASS** — §18 성공 기준 17개 항목 전부 충족. **다음 cron 재오염 위험 = NONE**(코드 근거는 §14).

---

## 0. Safe start

`main` · HEAD `c023963` · origin 동기 · 기존 modified/untracked user work 전부 보존.
reset·stash·clean·임의 삭제 0.

## 1. Known 28 reload — 추정하지 않았다

`CANCELLATION_RATCHET_DEFECT_A_REPAIR_AUDIT_V1`이 확정한 **21행** +
`CANCELLATION_PREVENTION_CRON_VALIDATION_GATE_V1` §5가 확정한 **신규 7그룹의 형제 7행** = **28**.

repair script는 설계상 **id 목록을 신뢰하지 않는다.** apply 시점에 원천을 다시 읽어
그룹 단위로 재판정한다. 그 재판정이 **독립적으로 같은 28개 id**를 냈다:

```
groupsExamined 7,987 · cellsFetched 1,132
skipped { NO_EXCESS: 7,958, SIBLING_COUNT_MISMATCH: 1 }
targetRowCount 28 == expect 28
```

| 항목 | 값 |
|---|---|
| 대상 행 수 | **28** |
| 현재 canceled | **28 / 28** |
| cancelDate 보유 | **28 / 28** |
| registryDate 보유 | **0** (취소 거래는 등기가 없다는 전제 유지) |
| aptSeq 보유 | **28 / 28** |
| 속한 그룹 수 | **28** (그룹당 정확히 1행) |

> `SIBLING_COUNT_MISMATCH 1`은 **28의 그룹이 아니다.** 그 그룹은 skip되어 target을 0개 냈고,
> 28개 id가 전부 나온 것이 그 증거다. 원천과 DB의 형제 수가 다른 별건이며 이번 범위 밖이다(§16).

## 2. Source revalidation — 운영 normalization path 그대로

`fetchSaleRegionMonth` → `normalizeMolitItemsToTradeRows` (운영 sync와 동일 모듈).

| 항목 | 값 |
|---|---|
| 재조회 셀 | **21 / 21** |
| COMPLETE가 아닌 셀 | **0** |
| 원천에 없는 그룹 | **0** |
| 형제 수 불일치 그룹 | **0** |
| aptSeq 불일치 | **0** |

**28개 그룹 전부에서 `srcSiblings == dbSiblings`** 이고 **`srcCanceled == dbCanceled − 1`** 이었다.
즉 각 그룹은 정확히 **1건씩 과다 취소** 상태였다.

### occurrenceIndex에 대한 정확한 서술

§2가 요구한 "source canceled = false"는 **그룹 단위로 판정해야** 정확하다.
원천의 취소 플래그가 **어느 형제 행에 붙는지는 의미가 없다** — 형제는 금액·거래일·층이 모두 같아
서로 구분되지 않고, occurrenceIndex는 원천 응답 순서로 붙는 인공 식별자다.
`write-policy-logic.ts:215`의 표현 그대로 *"형제는 서로 구분되지 않으므로 이 이상 정확히 배정할 방법이 원천에 없다."*

그래서 판정 기준은 **그룹의 취소 개수**다: 원천 N−1 / DB N → 1건 복구.
복구 대상 선택은 `occurrenceIndex 내림차순`이며, 이는 **cron의 복구 규칙과 같은 식**이다(§14).

실제로 원천은 202609 그룹들에서 occIdx 0을 active, occIdx 1을 canceled로 싣는다. 복구 후 DB는
occIdx 0이 canceled, occIdx 1이 active가 되어 **플래그가 붙은 형제가 원천과 반대**다.
**그룹 단위 개수는 정확히 일치**하며, 두 행은 취소 여부 외 모든 업무 필드가 동일하므로
사용자에게 보이는 값·집계는 어느 쪽이든 같다. 숨기지 않고 기록해 둔다.

## 3. Sibling group validation — ambiguity 0

| 그룹 형태 | 그룹 수 | DB 취소 | 원천 취소 | 복구 |
|---|---|---|---|---|
| 형제 2 · 전원취소 | **26** | 2 | **1** | 1 |
| 형제 3 · 전원취소 | **2** | 3 | **2** | 1 |
| **합계** | **28** | — | — | **28** |

`ambiguousGroups 0 · sourceUnavailableGroups 0 · registryPresentGroups 0`
각 그룹에서 "어떤 형제가 active여야 하고 몇 개가 canceled여야 하는지"가 원천 개수로 확정된다.

## 4. Pre-repair baseline (`2026-09-21T01:13:52Z`)

| 지표 | 값 |
|---|---|
| 전체 sale 행 | **866,366** |
| active / canceled | 849,966 / **16,400** |
| 부산(26) / 서울(11) / 대구(27) | 865,291 / 989 / 86 |
| 서울 중구 `11140` | 943 (888 / 55) |
| 서울 강남 `11680` | 46 (45 / 1) |
| all-canceled groups | **273** |
| suspect upper bound | **334** |
| multi-sibling groups | **13,110** |
| 자연키 중복 | **0** |

## 5. Write plan (dry-run) — planned updates 28

모든 행이 동일한 변경을 받는다: **`deal_canceled: true → false`**, **`cancel_date: <값> → NULL`**.
그 외 업무 필드 변경 **0**. `updated_at`만 ORM 계약상 자동 갱신된다(아래에 명시 보고).

| id | 셀 | 단지 | occIdx | before canceled | before cancelDate |
|---|---|---|---|---|---|
| 950194 | 26140:202607 | 대신해모로센트럴아파트 | 1 | true | `26.09.11` |
| 950082 | 26230:202607 | 현대2차 | 1 | true | `26.09.09` |
| 950395 | 26230:202608 | 현대2차 | 1 | true | `26.09.11` |
| 950396 | 26230:202608 | 래미안어반파크1단지 | 1 | true | `26.09.14` |
| 949575 | 26260:202604 | 반도보라스카이뷰 | 1 | true | `26.09.01` |
| 950598 | 26260:202605 | 동래SKVIEW | 1 | true | `26.09.11` |
| 949929 | 26260:202606 | 사직롯데캐슬더클래식 | 1 | true | `26.09.08` |
| 949624 | 26260:202607 | 래미안포레스티지2단지 | 1 | true | `26.09.04` |
| 950382 | 26290:202510 | 엘지메트로시티4-2(230~238) | 1 | true | `25.12.05` |
| 949910 | 26290:202605 | 더블유 | 1 | true | `26.08.21` |
| 950736 | 26350:202608 | 롯데4 | 1 | true | `26.09.17` |
| 949692 | 26350:202608 | 대우마리나2 | 1 | true | `26.09.05` |
| 940779 | 26350:202608 | 센텀센시빌 | 1 | true | `26.08.28` |
| 950183 | 26410:202602 | 구서역두산위브포세이돈 | **2** | true | `26.09.07` |
| 940906 | 26530:202608 | 쌍용스윗닷홈 | 1 | true | `26.08.24` |
| 950026 | 26320:202608 | 화명2차동원로얄듀크비스타 | 1 | true | `26.09.09` |
| 949532 | 26380:202608 | 보해이브빌 | 1 | true | `26.09.03` |
| 949727 | 26440:202608 | 명지대방노블랜드오션뷰1차 | **2** | true | `26.09.03` |
| 949991 | 26710:202608 | 가화만사성정관타운 | 1 | true | `26.09.08` |
| 949472 | 26110:202608 | 보수3차봄여름가을겨울 | 1 | true | `26.09.02` |
| 949523 | 26350:202608 | 더샵센텀파크1차 | 1 | true | `26.09.03` |
| 950590 | 26470:202609 | 시청역SKVIEW | 1 | true | `26.09.14` |
| 950570 | 26380:202609 | 신우림 | 1 | true | `26.09.15` |
| 950239 | 26260:202609 | 사직KCC스위첸2단지 | 1 | true | `26.09.11` |
| 950723 | 26290:202609 | 롯데캐슬인피니엘 | 1 | true | `26.09.17` |
| 950451 | 26380:202609 | 몰운대 | 1 | true | `26.09.14` |
| 950722 | 26290:202609 | 대연롯데캐슬레전드1단지 | 1 | true | `26.09.17` |
| 950664 | 26380:202609 | 괴정한신더휴 | 1 | true | `26.09.16` |

`plannedUpdates 28 · plannedInserts 0 · plannedDeletes 0`

## 7. Production repair

```bash
ALLOW_PROD_DB_READ=1 ALLOW_PROD_DB_WRITE=1 APPROVE_CANCEL_RATCHET_REPAIR=1 \
npx tsx scripts/repair-cancel-ratchet-defect-a.ts \
  --apply --expect=28 --batch=28 \
  --snapshot=tmp/defect-a-28-repair/snapshot-pre-repair.json
```

- 승인 protocol에 따라 `.PROPOSAL.` 파일명을 해제했다(파일 헤더의 자체 규약).
- `--batch=28`로 **28건 전체가 단일 트랜잭션**에 들어갔다. 트랜잭션 내 affected row가 28이 아니면 롤백하도록 되어 있다.
- UPDATE 조건은 `id IN (...) AND deal_canceled = true AND registry_date IS NULL` — **멱등**이고 broad UPDATE가 아니다.
- 스냅샷을 먼저 남기지 않으면 apply가 시작되지 않는다(실제로 먼저 저장됨).
- `SALE_CANCEL_RESTORE_ENABLED` **미사용** — 이번 작업은 generic restore 활성화가 아니라 targeted repair다.

결과: `batch 1: 28행 복구 (누적 28/28)` · `완료: 28행 복구.`

## 8. Post-repair verification (`2026-09-21T01:34:37Z`)

| 항목 | 결과 | 요구 |
|---|---|---|
| 대상 행 | **28** | 28 |
| **canceled = false** | **28 / 28** | 28 |
| **cancelDate = NULL** | **28 / 28** | 28 |
| registryDate 변경 | **0** | 0 |
| aptSeq 변경 | **0** (28/28 유지) | 0 |
| 원천 재조회 셀 | 21 / 21 COMPLETE | — |
| **그룹별 `dbCanceled == srcCanceled`** | **28 / 28** | 전부 일치 |
| 원천에만 있는 그룹 · DB에만 있는 그룹 | **0 · 0** | 0 |
| **재실행 시 planned updates** | **0** (전 그룹 `NO_EXCESS`) | 멱등 |

## 9. Sibling safety

| 항목 | 결과 |
|---|---|
| 정상 canceled sibling 유지 | **유지** — 각 그룹이 원천이 말한 수(1 또는 2)만큼 canceled 유지 |
| genuine cancellation 손실 | **0** |
| all-canceled 사고 그룹 생성 | **0** |
| overcancel | **0** |
| undercancel | **0** |
| new false-cancel | **0** |

복구 후 그룹 예시 — 원천과 개수가 정확히 일치한다:

```
26140:202607 대신해모로센트럴아파트  dbSib=2 dbCan=1  srcSib=2 srcCan=1  NO_EXCESS
  id 6031   occIdx 0  canceled=true   cancelDate 26.09.11   ← 원천이 말한 취소 1건 유지
  id 950194 occIdx 1  canceled=false  cancelDate null       ← 복구됨
```

## 10. Global post-repair delta

| 지표 | PRE | POST | 차이 | 판정 |
|---|---|---|---|---|
| **전체 sale 행** | 866,366 | **866,366** | **0** | INSERT/DELETE 0 확인 |
| **canceled** | 16,400 | **16,372** | **−28** | 기대치 |
| **active** | 849,966 | **849,994** | **+28** | 기대치 |
| 구 수 | 19 | 19 | 0 | — |
| 자연키 중복 | 0 | **0** | 0 | — |
| **multi-sibling groups** | 13,110 | **13,110** | **0** | 형제 수는 변하지 않음 |
| **all-canceled groups** | 273 | **245** | **−28** | 아래 설명 |
| **suspect upper bound** | 334 | **304** | **−30** | 아래 설명 |

**all-canceled −28**: 복구 대상 28개 그룹은 전부 "형제 전원이 취소된" 그룹이었다.
그룹마다 1건을 되돌렸으므로 28개 그룹이 동시에 전원취소 상태를 벗어난다.

**suspect −30**: suspect는 전원취소 그룹의 `SUM(siblings − 1)`이다.
빠진 28개 그룹의 기여분 = 형제2 그룹 26개 × 1 + 형제3 그룹 2개 × 2 = 26 + 4 = **30**.
숫자가 정확히 맞는다.

**부산(26) canceled** 16,342 → **16,314 (−28)** — 28행이 전부 부산이므로 기대대로다.

## 11. Seoul isolation

| 항목 | PRE | POST | 차이 |
|---|---|---|---|
| 서울 전체 | 989 (canceled 56) | **989 (canceled 56)** | **0** |
| 중구 `11140` | 943 / 888 / 55 | **943 / 888 / 55** | **0** |
| 강남 `11680` | 46 / 45 / 1 | **46 / 45 / 1** | **0** |
| 중구 원천↔DB parity | — | **943/943 · sourceOnly 0 · dbOnly 0 · mismatch 0** | 유지 |
| 서울 추가 backfill | — | **0** | — |

PRE_REPAIR 이후 **생성된 행 0**, **갱신된 행 28** — 그 28은 전부 부산이고
집합이 known-28과 **정확히 일치**한다(초과 0 · 누락 0). 서울 행은 하나도 갱신되지 않았다.

갱신된 28행의 구별 분포: 26110·26140·26320·26410·26440·26470·26530·26710 각 1 ·
26230 3 · 26260 5 · 26290 4 · 26350 4 · 26380 4 = **28**.

## 12. Busan source-withdrawn 3 — 건드리지 않았다

| id | 구 | 단지 | canceled | created_at | updated_at |
|---|---|---|---|---|---|
| 940812 | 26380 | 아람센트럴시티 | false | 2026-09-03T03:43:20Z | **2026-09-03T03:43:20Z** |
| 950148 | 26470 | 성일이안시티 | false | 2026-09-11T20:00:04Z | **2026-09-11T20:00:04Z** |
| 950521 | 26290 | 대연동동일스위트 | false | 2026-09-16T19:59:47Z | **2026-09-16T19:59:47Z** |

`updated_at == created_at` — 생성 이후 한 번도 갱신되지 않았다. UPDATE 0 · DELETE 0.

## 13. Env

전부 **인라인 process-scoped**(`VAR=1 command`)로만 부여했고 영구 설정에 남기지 않았다.
값은 읽지도 출력하지도 않았다.

| 변수 | shell process | `.env` / `.env.local` |
|---|---|---|
| `APPROVE_CANCEL_RATCHET_REPAIR` | **NOT SET** | 없음 |
| `ALLOW_PROD_DB_WRITE` | **NOT SET** | 없음 |
| `ALLOW_PROD_DB_READ` | **NOT SET** | 없음 |
| `DEFECT_A_GATE_PASS` | **NOT SET** | 없음 |
| `SALE_CANCEL_RESTORE_ENABLED` | **NOT SET** | 없음 |

Vercel Production env는 조회·변경 모두 하지 않았다.

## 14. Cron 재오염 위험 — **NONE** (코드 근거)

sync runtime code는 변경하지 않았다. 다음 cron이 28행을 되돌릴 수 있는 경로는 둘뿐이고, 둘 다 **무동작**이다.

**(a) 취소 reconcile** — `scripts/write-policy-logic.ts:202-204`

```ts
const targetCanceled = sourceRows.filter((r) => r.dealCanceled).length;
const currentCanceled = existingRows.filter((r) => r.dealCanceled).length;
if (targetCanceled === currentCanceled) return { kind: 'noChange' };
```

복구 후 28개 그룹 전부 `dbCanceled == srcCanceled`(§8 실측)이므로 **`noChange`**.
그리고 이 함수의 과다취소 복구 선택(`:232-234`)은
`b.occurrenceIndex - a.occurrenceIndex || b.id - a.id` 로, **repair script가 고른 규칙과 같은 식**이다.
cron과 repair가 "어느 형제가 active여야 하는가"에 대해 **같은 답**을 낸다 — 서로 밀어내지 않는다.

**(b) insert 경로** — `scripts/write-policy-logic.ts:344-345`

```ts
const missing = sourceRows.length - existingRows.length;
if (missing <= 0) return { kind: 'none' };
```

28개 그룹 전부 `srcSiblings == dbSiblings`(§2 실측)이므로 `missing = 0` → **`none`**.
새 형제가 취소 상태로 들어올 여지가 없다.

**(c)** 재실행 멱등성도 실측했다 — 복구 후 dry-run이 `planned updates 0`을 냈다(§8).

이후 원천이 이 그룹에 **진짜 취소를 새로 추가**하면 cron이 1건을 취소로 바꾸는데,
그것은 재오염이 아니라 **정상 동작**이다.

## 15. Runtime

runtime `src/` 변경 0 · 배포 0. Production HTTP:

| 경로 | 상태 |
|---|---|
| `/` · `/map` · `/stats` · `/school` · `/report/city/busan` | **전부 200** |

서울 노출은 그대로 닫혀 있다(`enablement.ts`에 `'11'` 없음 — 이번에도 건드리지 않았다).

## 16. 남은 blocker

1. **`SIBLING_COUNT_MISMATCH` 1그룹** — 원천과 DB의 형제 수가 다른 그룹이 1개 있다.
   repair에서 올바르게 제외됐고 28과 무관하지만, **정체는 아직 확인하지 않았다.**
   Defect B(누락 insert)일 수도, 원천 회수일 수도 있다. 별도 감사 대상.
2. **`planGroupInserts()` 형제 분기 Production 미검증** — 이번 repair는 UPDATE라 이 분기와 무관하다.
3. **부산 source-withdrawn 3건** — 정책 미결(별도 승인 STEP).

## 17. 다음 권고

1. **다음 cron(2026-09-22 04:00 KST) 직후 28행을 재확인한다.** §14의 근거상 `noChange`여야 한다.
   `ALLOW_PROD_DB_READ=1 npx tsx scripts/audit-defect-a-28-repair-verify.ts --label=POST_CRON` 한 번이면
   28행 상태와 그룹 parity가 함께 나온다. 되돌아갔다면 §14의 전제가 깨진 것이므로 즉시 보고 대상이다.
2. **`SIBLING_COUNT_MISMATCH` 1그룹의 정체를 밝힌다.** 이번 스캔에서 이미 존재가 확인됐으니
   그 그룹만 특정해 원천과 대조하면 된다(전수 재스캔 불필요).
3. **suspect upper bound 304의 의미를 갱신한다.** 273→245로 줄어든 all-canceled 그룹 중
   남은 245가 전부 결함인지, 진짜 전원취소 거래인지는 아직 구분되지 않았다 — 상한일 뿐이다.
4. 서울 Phase A · withdrawn 3건 · `SALE_CANCEL_RESTORE` 활성화는 **계속 별개 STEP**으로 유지한다.

## 산출물

| 파일 | 내용 |
|---|---|
| `tmp/defect-a-28-repair/snapshot-pre-repair.json` | **롤백 자료** — 복구 전 28행 원본(canceled·cancelDate·updated_at 포함) |
| `scripts/repair-cancel-ratchet-defect-a.ts` | `.PROPOSAL.` 해제, 실행 기록 헤더 반영 |
| `scripts/audit-defect-a-28-repair-verify.ts` | 전/후 28행 + sibling group + 원천 대조 (읽기 전용) |
