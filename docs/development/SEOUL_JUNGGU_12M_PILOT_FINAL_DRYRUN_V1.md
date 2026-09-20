# E-JIP SEOUL JUNG-GU 12M PILOT FINAL DRY-RUN V1

서울 매매 backfill 첫 Production pilot(중구 최근 12개월)을 apply 직전 상태로 최종 검증한다.

- 날짜: 2026-09-21 00:30~00:35 (KST) · 기준 커밋 `ffc3178`
- **Production INSERT / UPDATE / DELETE 0** · env 변경 0 · runtime `src/` 변경 0 · 서울 apply 0

## 판정

**PARTIAL** — 파이프라인은 전 항목 통과했으나 **원천 행 수가 944에서 943으로 줄었다.** §3 규칙("pilot count가 바뀌면 실제 apply는 새 승인 필요")에 따라 STOP하고 보고한다.

---

## 1. 검증 시각

| 항목 | 값 |
|---|---|
| 1차 dry-run | 2026-09-21 00:30 KST (`2026-09-20T15:30:54Z`) |
| 재확인(`--refetch`) | 2026-09-21 00:31 KST (`2026-09-20T15:31:58Z`) |
| 기존 baseline 측정 | **2026-09-19 20:39 KST** (`2026-09-19T11:39:46Z`) |

## 2. District / lawd_cd

**중구 = `11140`** — `src/lib/region/registry.ts`에서 읽었다. 추정하지 않았다.

> 이름만으로는 특정할 수 없다: 같은 registry에 **부산 중구 `26110`**이 있고 대구·인천·대전에도 중구가 있다. `11140`은 `fullName: '서울특별시 중구'` 항목에서 가져왔다.

## 3. 원천 행 수 — **변경됨**

| | 2026-09-19 측정 | 현재 | 차이 |
|---|---|---|---|
| 원천 행 | **944** | **943** | **−1** |
| active | 889 | **888** | **−1** |
| canceled | 55 | **55** | 0 |

**취소로 넘어간 것이 아니라 active 1건이 원천에서 사라졌다.** 취소 flip이었다면 active가 줄고 canceled가 늘어 총계는 유지됐을 것이다. 총계가 줄었으므로 원천 철회(Defect B 계열)다.

`--refetch`로 강제 재조회한 2차 실행도 **943 / 888 / 55**로 동일 — 일시적 읽기 오류가 아니다.

### row-level delta를 낼 수 없다 — 그리고 그것이 지적할 점이다

§3은 row-level delta를 요구하지만, **2026-09-19 측정은 집계 수(944)만 저장했고 행 집합을 남기지 않았다**(`tmp/seoul-sale-backfill-plan/batch-plan.json`의 `pilot.rows = 944`). 그래서 어느 행이 사라졌는지 지금은 특정할 수 없다. 추측으로 채우지 않는다.

당시 artifact 자신이 이미 이렇게 적어 두었다: *"행 수는 원천 totalCount 합(취소 포함). 적재 시 새로 수집하므로 **그 시점 원천 값이 기준이 된다**."* 즉 원천이 움직인다는 것은 예상된 성질이고, 944는 고정 계약이 아니라 측정 시점 값이었다.

**권고**: pilot apply 시 삽입 행의 자연키 집합을 artifact로 남긴다(§11). 그러면 다음 delta는 행 단위로 설명할 수 있다.

## 4. Active / Canceled

| 구분 | 값 |
|---|---|
| active | **888** |
| canceled | **55** |

## 5. 페이징 완전성

| 항목 | 값 |
|---|---|
| 셀 | **12 / 12** (202510 ~ 202609) |
| 상태 | **READY 12** · BLOCKED 0 |
| `collected == totalCount` | **12 / 12 COMPLETE** |
| PARTIAL / FAILED / 오류 | **0 / 0 / 0** |
| 페이지 | 셀당 1 · 호출 12 |
| invalid rows | **0** |

월별: 202510 **146** · 202511 34 · 202512 78 · 202601 79 · 202602 65 · 202603 104 · 202604 128 · 202605 131 · 202606 61 · 202607 80 · 202608 32 · 202609 **5** = **943**

## 6~7. Master 매칭

| 판정 | 건수 |
|---|---|
| **EXACT_MASTER** | **943** |
| **MASTER_MISSING** | **0** |
| INVALID_APTSEQ | 0 |
| REVIEW_REQUIRED | 0 |

aptSeq exact only. 이름 fallback · dong+jibun fallback · fuzzy · first-match **전부 사용하지 않았다**.

## 8~9. 기존 DB 행

| 항목 | 값 |
|---|---|
| 중구(`11140`) 기존 행 | **0** |
| existing matched | **0** |
| **existing updates** | **0** |
| cancel drift · registryDate drift · 기타 drift | **0 / 0 / 0** |

`--approve-existing-updates`는 **불필요**하다. 강남 6건 UPDATE 승인과는 무관한 건이며 섞이지 않는다.

## 10~13. 충돌 / 계획

| 항목 | 값 |
|---|---|
| cross-district collision | **0** |
| same-district collision | **0** |
| **expectedSkips** | **0** |
| nonCanonicalInserts | 0 |
| **planned inserts** | **943** |
| **expected actual inserts** | **943** |

## 14. 취소 semantics

| 항목 | 값 |
|---|---|
| sourceRows / sourceCanceled | 943 / 55 |
| insertCanceled | **55** |
| cancelFlips · cancelRestores | **0 · 0** |
| cancelReconcileSkipped | **0** |
| sameConditionGroups / rows | 45 / 92 |

count 기반 sibling reconciliation만 사용했고 원천 순서에 의존한 판단은 없다. 이번 STEP에서 restore/repair **0**.

## 15. Driver gate 감사

`evaluateApplyGates`가 요구하는 조건(하나라도 빠지면 거부):

| gate | 현재 |
|---|---|
| `--apply` | 미지정(dry-run) |
| `ALLOW_PROD_DB_READ=1` | 실행 시 부여 |
| `ALLOW_PROD_DB_WRITE=1` | **미설정** |
| `DEFECT_A_GATE_PASS=1` | **미설정 → BLOCKED_FOR_APPLY** |
| `--district` · `--from` · `--to` | 지정됨 |
| `--expect-inserts` = plannedInserts | 필수 · 불일치 시 거부 |
| 전 셀 READY | **12/12 READY** |
| `--approve-existing-updates` | **불필요**(existingUpdates 0) |

## 16. Production env gate 상태

| 변수 | 상태 |
|---|---|
| `DEFECT_A_GATE_PASS` | **NOT SET** |
| `ALLOW_PROD_DB_WRITE` | **NOT SET** |
| `SALE_CANCEL_RESTORE_ENABLED` | **NOT SET** |

`.env` · `.env.local` 어디에도 없다(이름만 확인, 값 출력 0). **이번 STEP에서 env를 바꾸지 않았다.**

## 17. Apply 명령 preview (실행 안 함)

**현재 수치 기준이며, apply 직전에 dry-run을 다시 돌려 `--expect-inserts`를 그 시점 값으로 맞춰야 한다.**

```bash
ALLOW_PROD_DB_READ=1 ALLOW_PROD_DB_WRITE=1 DEFECT_A_GATE_PASS=1 \
npx tsx scripts/backfill-seoul-sale.ts \
  --district=11140 \
  --from=2025-10 --to=2026-09 \
  --apply \
  --expect-inserts=943 \
  --out=tmp/seoul-junggu-pilot-apply
```

- `--approve-existing-updates`는 **넣지 않는다**(existingUpdates 0이며, 붙이면 의도치 않은 기존 행 변경을 허용하게 된다).
- `--expect-inserts`가 그 시점 plannedInserts와 다르면 driver가 스스로 거부한다.
- secret 값은 명령에 등장하지 않는다.

## 18. Rollback / 복구 계획 (실행 안 함)

이 pilot은 **create-only**(insert 943 · update 0 · delete 0)이므로 되돌림은 "삽입한 행만 삭제"로 충분하다. apply 시 남길 것:

| 항목 | 용도 |
|---|---|
| 삽입 행 **id 목록** | 정확한 되돌림 대상 |
| 삽입 행 **자연키 집합** | id가 없어도 특정 가능 · **다음 원천 delta를 행 단위로 설명**(§3) |
| run/batch id · district · from/to · inserted count | 범위 재현 |
| dry-run 계획 artifact 사본 | 계획 대비 실제 대조 |

되돌림은 `apartment_trade_histories`에서 **그 id 집합만** 삭제하며, 범위 조건(`lawd_cd='11140'` + 월 범위)만으로 일괄 삭제하지 않는다 — 기존 46행과 섞이지 않게 하기 위함이다(중구 현재 0행이지만 원칙을 고정한다).

## 19. Apply 후 검증 계획 (고정)

| 확인 | 기대 |
|---|---|
| source | apply 시점 재측정 값 |
| inserted | = plannedInserts |
| expectedSkips | 0 |
| updates | **0** |
| 서울 DB 행 | 46 → **46 + inserted** (현 수치면 989) |
| coverage cells | pilot 범위 12셀만 COMPLETE |
| natural-key duplicates | **0** |
| master exact | inserted / inserted |
| 부산 | **완전 불변**(master 3,438 · sale 865,289) |
| 서울 stats · cron · SEO/sitemap | **여전히 disabled** |
| 취소 baseline | 16,345 · all-canceled 273 · upper bound 334 불변 |

> §12의 "46 → 990"은 944 기준이었다. 현재 943 기준이면 **989**다. apply 시점 실측으로 다시 계산해야 한다.

## 20. 부산 / 취소 격리

dry-run 전후 재측정 — **전부 불변**:

| 항목 | 값 |
|---|---|
| 서울 master | **6,843** |
| 부산 master | **3,438** |
| 서울 sale | **46** |
| 중구(`11140`) sale | **0** |
| 부산 sale | **865,289** |
| 전체 sale | **865,421** |
| 취소 | **16,345** |

> §1의 "Busan sale rows = 865,421"은 실제로는 **전 지역 합계**다. 부산만은 **865,289**이고, 나머지는 서울 46 + 기타 86이다. 정정해 둔다.

취소 지표(28 / 334 / 273)는 이번 STEP에서 쓰기가 전혀 없었고 `apartment_trade_histories`를 읽기만 했으므로 변할 수 없다. 직전 STEP에서 `audit-cancel-cron-validation-v1.ts`로 **273 / 334 / 생성 행 0 / natural key 중복 0**을 실측 확인했다.

## 21. 테스트

```
npx tsx --test "scripts/**/*.test.mjs" "scripts/**/*.test.ts"   590 pass / 0 fail
npx tsx --test "src/lib/sync/**/*.test.*"                        38 pass / 0 fail
```

Seoul backfill driver · collision · paging · cancellation planning 테스트 포함. **runtime 코드 변경 0**이므로 eslint 대상 변경 파일 없음.

## 22. No-write assertion

| 항목 | 값 |
|---|---|
| Production INSERT / UPDATE / DELETE | **0 / 0 / 0** |
| driver 보고 `writes` | `{insert: 0, update: 0, delete: 0}` |
| env 변경 · 서울 apply · cron/stats 활성화 | 0 · 0 · 0 |
| cancellation repair | 0 |
| runtime `src/` 변경 | **0** |

MOLIT 호출 24회(12셀 × 2회 실행), 잔여 quota 9,928 — 예약분 2,000 대비 여유.

## 23. 커밋

docs 전용. **push 하지 않는다**(§15).

## 24. Blockers

**원천 행 수가 944 → 943으로 바뀌었다.** 파이프라인 결함이 아니라 원천이 움직인 것이며, §3·§18에 따라 apply는 **새 승인**이 필요하다.

## 25. 다음 권고

1. **재승인 대상은 `--expect-inserts=943`이 아니라 "apply 직전 재측정값"이어야 한다.** 원천이 이틀 사이 1행 움직였으므로, 2026-09-21 sale-sync 이후 다시 dry-run하면 또 달라질 수 있다. 승인은 숫자 고정이 아니라 **"dry-run 재실행 후 그 값으로 apply"** 형태가 안전하다.
2. **삽입 행의 자연키 집합을 반드시 남긴다.** 이번에 row-level delta를 낼 수 없었던 이유가 그것이다.
3. 그 외 모든 PASS 조건은 충족했다 — 페이징 완전 · master exact 943/943 · missing 0 · 기존 행 0 · update 0 · 충돌 0 · expectedSkips 0 · 취소 semantics 일관 · gate 무결 · DB write 0.
4. apply는 **2026-09-21 sale-sync + recheck validation PASS 이후**에만 진행한다(이번 STEP 범위 밖).
