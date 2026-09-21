# E-JIP SEOUL JUNG-GU SALE PRODUCTION PILOT APPLY V1

서울 중구(`11140`) 최근 12개월 SALE 실거래 **943건을 Production에 최초 적재**했다.
사용자 명시 승인 하에 수행한 **E-JIP 첫 서울 Production write**다.

- 실행: **2026-09-21 09:59:10~09:59:14 KST** (`2026-09-21T00:59:10Z`) · 기준 커밋 `86c0c88`
- 범위: **서울 중구 단독** · 2025-10 ~ 2026-09 · **INSERT only**
- **INSERT 943 · UPDATE 0 · DELETE 0**
- Defect-A 28 repair 0 · 부산 write 0 · 서울 타 구 write 0 · schema/migration 0 · runtime `src/` 변경 0

## 판정

**PASS** — §17 성공 기준 18개 항목 전부 충족.

---

## 0. Safe start

`main` · HEAD `86c0c88`(로컬 보류 commit) · 기존 modified/untracked user work 전부 보존.
reset·stash·clean·임의 삭제 0.

## 1. Pre-apply fresh dry-run (운영 driver)

apply 직전 같은 driver로 다시 측정했다 — 과거 숫자를 고정하지 않았다.

```
[DRY RUN] cells=12 {"READY":12} inserts=943 expectedSkips=0 expectedActualInserts=943 existingUpdates=0 calls=12 — DB write 없음
```

| 항목 | 값 | 요구 | 판정 |
|---|---|---|---|
| source total | **943** | 943 | PASS |
| active / canceled | **888 / 55** | 888 / 55 | PASS |
| cells | **12 / 12 COMPLETE (READY)** | COMPLETE only | PASS |
| EXACT_MASTER | **943** | 943 | PASS |
| MASTER_MISSING · INVALID_APTSEQ · REVIEW_REQUIRED | **0 · 0 · 0** | 0 | PASS |
| existing DB rows · existingMatched | **0 · 0** | 0 | PASS |
| existingUpdates | **0** | 0 | PASS |
| same-district · cross-district collision | **0 · 0** | 0 | PASS |
| expectedSkips | **0** | 0 | PASS |
| planned inserts · expected actual inserts | **943 · 943** | 943 | PASS |
| nonCanonicalInserts | 0 | — | PASS |

MOLIT collection · normalization · naturalKey · aptSeq matching · collision · expectedSkips 전부 **운영 코드 그대로** 사용했다(로직 복제 없음).

## 2. Rowset compare — **delta 0**

`rowset-11140-202510-202609-2026-09-21T00-58-09-308Z.json` vs 직전 artifact(`...T00-41-26-025Z.json`):

| 항목 | 값 | 요구 |
|---|---|---|
| previous / current count | 943 / **943** | — |
| **removed · added · cancelChanged** | **0 · 0 · 0** | 전부 0 |
| incomplete cell · invalid · 원천 자연키 중복 | **0 · 0 · 0** | 0 |
| `collected == totalCount` | **12/12** | — |

## 3. Cancellation gate — apply 직전 재확인

PRE 스냅샷(`2026-09-21T00:56:45Z`)이 gate evidence가 그대로 유효함을 보였다:

| 지표 | PRE | 직전 검증값 |
|---|---|---|
| known false-cancel 28 | **28 / still_canceled 28 / restored 0** | 동일 |
| all-canceled groups | **273** | 동일 |
| suspect upper bound | **334** | 동일 |
| multi-sibling groups | **13,065** | 동일 |
| 자연키 중복(전역) | **0** | 동일 |

새 false-cancel / overcancel blocker **없음** → 진행.

> **`planGroupInserts()` 형제 분기는 이번 943건이 검증하지 않았다.** 중구는 기존 행이 0이라
> 모든 그룹이 신규였고(`existingMatched 0`, `insertReconcileSkipped 0`), 따라서 **행 분기**만 탔다.
> 이 분기의 Production positive proof는 **여전히 없다.** pilot blocker로 취급하지 않았을 뿐이다.

## 4~6. Production apply

```bash
ALLOW_PROD_DB_READ=1 ALLOW_PROD_DB_WRITE=1 DEFECT_A_GATE_PASS=1 \
npx tsx scripts/backfill-seoul-sale.ts \
  --district=11140 --from=2025-10 --to=2026-09 \
  --apply --expect-inserts=943 \
  --out=tmp/seoul-junggu-pilot-apply
```

- `SALE_CANCEL_RESTORE_ENABLED` **미사용**(NOT SET 유지)
- `--approve-existing-updates` **미사용**(existingUpdates 0이므로 금지)
- 새 write path를 만들지 않고 driver의 기존 transaction/atomicity 계약을 그대로 사용

셀별 결과 — 12/12 COMPLETE, blocked 0, flips 0, review 0:

| 셀 | fetched | inserted | insertCanceled |
|---|---|---|---|
| 202510 | 146 | 146 | 5 |
| 202511 | 34 | 34 | 2 |
| 202512 | 78 | 78 | 5 |
| 202601 | 79 | 79 | 2 |
| 202602 | 65 | 65 | 3 |
| 202603 | 104 | 104 | 9 |
| 202604 | 128 | 128 | 8 |
| 202605 | 131 | 131 | 9 |
| 202606 | 61 | 61 | 3 |
| 202607 | 80 | 80 | 7 |
| 202608 | 32 | 32 | 2 |
| 202609 | 5 | 5 | 0 |
| **합계** | **943** | **943** | **55** |

`cancelRestored 0 · cancelRestorePending 0 · cancelReconcileSkipped 0 · insertReconcileSkipped 0 · registry 0 · registryAmbiguous 0`

driver 최종 보고: `"mode":"APPLIED"` · **`writes {insert: 943, update: 0, delete: 0}`** · `stoppedBy: null` · calls 12 · quotaRemaining 6,456

## 7. Post-apply verification (`2026-09-21T01:00:00Z`)

| # | 항목 | 결과 | 요구 |
|---|---|---|---|
| A | **actual inserts** | **943** | 943 |
| B | **중구 DB rows** | **943** | 943 |
| C | **active** | **888** | 888 |
| D | **canceled** | **55** | 55 |
| E | **master aptSeq exact** | **943 / 943** · missing 0 · `apt_seq` NULL **0** | 943 |
| F | **자연키 중복** | 전역 **0** · 중구 **0** | 0 |
| G | same-district collision | **0** | 0 |
| H | cross-district collision | **0** | 0 |
| I | **unexpected updates** | **0** — PRE 이후 갱신된 기존 행 **없음** | 0 |
| J | **deletes** | **0** | 0 |
| K | **known 28** | **28 / still_canceled 28 / restored 0** · `newest_update` **2026-09-18T19:59:54Z 그대로** | unchanged |
| L | **new false-cancel** | **0** | 0 |
| M | **overcancel** | **0** | 0 |

중구 행 생성 시각: `00:59:11.014Z ~ 00:59:14.891Z` (3.9초).

## 8. 원천 ↔ DB 전수 parity

`scripts/audit-junggu-pilot-apply-verify.ts`가 자연키 기준으로 **943행 전수** 비교(표본 아님).
비교 필드: 금액 · 거래일 · 층 · occurrenceIndex · 취소상태 · cancelDate · aptSeq.

| 항목 | 값 | 요구 |
|---|---|---|
| source rows / DB rows | 943 / **943** | — |
| **source only** | **0** | 0 |
| **DB only** | **0** | 0 |
| **field mismatches** | **0** | 0 |

## 9. Global delta

| 지표 | PRE | POST | 차이 |
|---|---|---|---|
| 전체 SALE 행 | 865,423 | **866,366** | **+943** |
| active | 849,078 | **849,966** | +888 |
| canceled | 16,345 | **16,400** | +55 |
| 구 수 | 18 | **19** | +1 (`11140` 신규) |
| **서울(11)** | 46 | **989** | **+943** |
| └ `11140` 중구 | 0 | **943** | **+943** |
| └ `11680` 강남구 | 46 | **46** | **0** |
| **부산(26)** | 865,291 | **865,291** | **0** |
| 대구(27) | 86 | **86** | **0** |

PRE 이후 생성된 행은 **`11140` 943건이 전부**이고, 갱신된 기존 행은 **0**이다
(`created_at` / `updated_at` 기준 구별 집계). 동시 cron write는 없었다.

### `multi_sibling_groups` 13,065 → 13,110 (+45) — 정상

중구 원천이 같은 자연키 그룹에 복수 거래를 갖기 때문이다. 중구 단독 집계:

| 항목 | 값 |
|---|---|
| 그룹 총수 | 896 (행 943) |
| 형제 1 / 2 / 3 | 851 / 43 / 2 |
| **all-canceled 그룹** | **0** |
| **suspect** | **0** |
| 최대 형제 수 | 3 |

**신규 45개 그룹 중 전원취소 그룹은 하나도 없다.** 그래서 `all_canceled_groups` 273,
`suspect_upper_bound` 334가 **그대로**다 — false-cancel 패턴이 유입되지 않았다는 뜻이다.

## 10. Runtime regression

runtime code 변경 0 · 배포 0. Production HTTP 확인:

| 경로 | 상태 |
|---|---|
| `/` | **200** |
| `/map` | **200** |
| `/stats` | **200** |
| `/school` | **200** |
| `/report/city/busan` | **200** |

**서울 노출은 그대로 닫혀 있다.** `src/lib/region/enablement.ts`의 `ENABLEMENT_BY_SIDO`에
`'11'`이 **없으므로** app · report · stats · sitemap · seoIndex · cronSync **여섯 축 전부 false**다.
cron도 `BUSAN_LAWDCD_16` 기본값 그대로라 서울을 수집하지 않는다. **이 파일을 건드리지 않았다.**

데이터가 들어갔다고 노출을 임의로 열지 않았다.

## 11. Defect-A / withdrawal isolation

이번 STEP에서 **전혀 건드리지 않았다**:

| 항목 | 상태 |
|---|---|
| known false-cancel 28 | **그대로** (`newest_update` 2026-09-18 불변) |
| 부산 source-withdrawn 3건 | **그대로** |
| 기존 Defect B 그룹 | **그대로** |
| `SALE_CANCEL_RESTORE` | **미활성** (`cancelRestored 0`) |

## 12. Env cleanup

gate는 전부 **process-scoped 인라인 prefix**로만 부여했다(`VAR=1 command` 형태).
작업 후 재확인 — 값은 읽지도 출력하지도 않았다:

| 변수 | shell process | `.env` / `.env.local` 선언 |
|---|---|---|
| `DEFECT_A_GATE_PASS` | **NOT SET** | 없음 |
| `ALLOW_PROD_DB_WRITE` | **NOT SET** | 없음 |
| `ALLOW_PROD_DB_READ` | **NOT SET** | 없음 |
| `SALE_CANCEL_RESTORE_ENABLED` | **NOT SET** | 없음 |

영구 설정으로 남지 않았고, Vercel Production env는 **조회·변경 모두 하지 않았다.**

## 14. Test / build

runtime source 변경이 없어 전체 재빌드는 하지 않았다(AGENTS.md — 불필요한 heavy build 반복 금지).

- `npx tsc --noEmit` → **`FAIL_EXISTING_SCRIPT_ERRORS`** · 25건 전부 **이번 변경과 무관한 기존 오류**
  (`scripts/education/*`, `scripts/fetch-api-info.ts`, `scripts/indexnow/*`, `scripts/list-zips.ts`, `scripts/test-api.ts`, `tmp/*`)
- **`src/` 오류 0** · **이번에 추가한 `scripts/audit-junggu-pilot-apply-verify.ts` 오류 0**

앱 코드는 한 줄도 수정하지 않았다.

## 16. 남은 blocker

**중구 pilot 자체의 blocker는 없다.** 다음 Production write를 막는 미결 사항만 남는다:

1. **`planGroupInserts()` 형제 분기 미검증** — 이번 943건은 전원 신규 그룹이라 이 분기를 타지 않았다.
   서울 추가 구를 적재해도 같은 이유로 검증되지 않는다. 부산 크론에서 형제가 늘어나는 순간을 잡아야 한다.
2. **known false-cancel 28** — 미수리(별도 승인 STEP).
3. **부산 source-withdrawn 3건** — 정책 미결(별도 승인 STEP).

## 17. 다음 권고

1. **중구 943건을 PM 검수한다.** 서울은 여전히 전 축이 닫혀 있어 사용자 노출은 0이다 — 데이터만 먼저 들어간 상태이므로, 노출 없이 내부 검증할 시간이 있다.
2. **서울 추가 구(Jongno/Yongsan 등) apply는 이번 STEP 범위가 아니다.** PM 검수 통과 후 별도 승인으로 진행한다.
3. **`planGroupInserts()` 검증은 부산 크론 직후 현재월 대조를 반복**하는 것이 여전히 가장 싸다.
4. 중구 pilot · Defect-A 28 repair · withdrawn 3건은 **계속 별개 STEP**으로 유지한다.
5. 서울 노출(`enablement.ts`의 `'11'`)은 **데이터 적재가 25개 구로 끝난 뒤** app/stats/seoIndex를 함께 여는 것이 맞다. 지금 stats만 열면 게이트 뒤에서 live 경로로 떨어진다(파일 주석의 경고).

## 산출물

| 파일 | 내용 |
|---|---|
| `tmp/seoul-junggu-pilot-apply/applied-*.json` | apply 최종 보고(`writes {943,0,0}`) |
| `tmp/seoul-junggu-pilot-apply/district-month-status.json` | 셀별 상태 |
| `tmp/seoul-pilot-rowset/rowset-11140-...T00-58-09-308Z.json` | apply 근거가 된 943행 원천 스냅샷 |
| `scripts/audit-junggu-pilot-apply-verify.ts` | 전/후 스냅샷 + 원천↔DB 전수 parity (읽기 전용) |
