# E-JIP SEOUL SALE NATURAL-KEY COLLISION PATCH V1

서울 backfill driver가 **자연키 충돌 때문에 정상 apply를 오탐 정지**시키는 문제를 고친다. 계획 단계에서 건너뛸 행 수(`expectedSkips`)를 미리 세고, apply 후 대조를 그 값으로 한다.

- 날짜: 2026-09-20 (KST) · 기준 커밋 `83d63a3`
- **Production INSERT/UPDATE/DELETE 0** · Seoul apply 0 · cancellation repair 0 · master 변경 0 · schema 0 · push 0
- **`src/` 전체 무변경** — 이 패치는 `scripts/`(driver·logic·tests)에만 있다

## 판정

**PASS — 충돌은 서울 1,440,126행 전체에서 2건뿐이고, canonical owner 모호성은 0이다.**

STOP 조건 전부 미해당: 모호한 소유권 없음 · `sale-sync-core` 수정 없음 · 취소 semantics 불변 · schema 불필요 · Production write 0.

---

## 1. Root cause

```
plan.inserts  →  apply  →  createMany(skipDuplicates)  →  report.inserted
                                    ↑
                     자연키가 이미 있으면 조용히 건너뛴다
```

DB unique 자연키는 `(group_key, deal_amount, deal_date, floor, occurrence_index)`로 **lawdCd를 포함하지 않는다**. MOLIT이 같은 거래를 이웃 구 응답에도 실어 보내면 두 셀이 같은 자연키 행을 계획한다. 뒤에 오는 셀의 insert는 `skipDuplicates`가 건너뛰므로

```
report.inserted  <  planned.inserts
```

가 되는데, `applyMatchesPlan()`은 `report.inserted === planned.inserts`를 요구했다 → **데이터는 정상인데 그 셀에서 정지**한다(손상이 아니라 오탐 정지).

## 2. 변경 파일

| 파일 | 변경 |
|---|---|
| `scripts/backfill-seoul-sale-logic.ts` | `naturalKeyOf()` · `canonicalLawdCdOf()` · `computeExpectedSkips()` 추가. `applyMatchesPlan()`이 `expectedSkips`를 받는다(주지 않으면 기존 동작) |
| `scripts/backfill-seoul-sale.ts` | `ReadDb.existingNaturalKeys()` 추가(읽기 전용, unique index 사용). 계획 셀마다 insert 자연키 기록 → 적용 순서대로 skip 계산 → apply 대조에 반영. dry-run 로그·`summary.json`·`natural-key-collisions.json`에 수치 노출 |
| `scripts/backfill-seoul-sale.test.ts` | 요구된 A~E 테스트 + `applyMatchesPlan` 회귀 (19 → **26**) |
| `scripts/audit-seoul-natural-key-collisions.ts` | **신규** 전수 census(READ ONLY, DB write 0, 외부 API 0) |

**건드리지 않은 것**: `src/lib/sync/sale-sync-core.ts` · 취소 count reconciliation · restore gate · 부산 cron. `git status -- src/`·`git diff HEAD -- src/` 모두 비어 있다.

## 3. 충돌 전수 census (서울 1,440,126행)

| 지표 | 값 |
|---|---|
| 원천 행 | 1,440,126 (6,276셀) |
| **distinct 자연키** | **1,440,124** |
| **중복 자연키** | **2** |
| 같은 구 안 중복 | **0** |
| **구를 가로지르는 중복** | **2 키 / 4 occurrence / 적재 시 2행 skip** |
| 영향 aptSeq | **1** (`11590-3369`) |
| **canonical owner 모호** | **0** |

같은 구 안 중복이 0이라는 것이 중요하다 — occurrenceIndex가 같은 조건의 복수 거래를 이미 제대로 분리하고 있다는 뜻이다.

## 4·5. 확정 충돌 2건과 canonical owner

```
id:11590-3369::114.69::sale|106000|2025-03-15|4|0   → 11590:202503 · 11620:202503
id:11590-3369::114.69::sale|105000|2025-08-08|10|0  → 11590:202508 · 11620:202508
```

단지: **관악푸르지오102동**, 법정동 **사당동**, 지번 1152.

**canonical owner = 동작구 11590.** 추측이 아니라 원천 필드로 확인했다 — 두 구의 응답에서 같은 행을 꺼내 비교하면:

| 필드 | 동작구(11590) 응답 | 관악구(11620) 응답 |
|---|---|---|
| `aptSeq` | `11590-3369` | **`11590-3369`** (동일) |
| `umdNm` / `umdCd` | 사당동 / `10700` | **사당동 / `10700`** (동일) |
| `jibun` | 1152 | **1152** (동일) |
| `sggCd` | `11590` | `11620` ← **조회한 구를 되돌려줄 뿐** |

즉 행 자체의 identity 필드(aptSeq·법정동코드·지번)는 양쪽이 완전히 같고, `sggCd`만 질의한 구를 echo한다. 게다가 그 두 셀에서 사당동 행은 **동작구 212건 vs 관악구 2건**이고, 그 2건이 정확히 이 충돌 행이다. 이름에 "관악"이 들어가 있다고 해서 관악구가 아니다.

## 6. expectedSkips 로직

건너뛰는 이유는 둘뿐이고 둘 다 결정적이다:

| 이유 | 뜻 |
|---|---|
| `DB_EXISTS` | 이미 DB에 그 자연키가 있다(다른 구·다른 달·이전 실행이 넣었다) |
| `RUN_EARLIER` | 이번 실행의 **앞선 셀**이 같은 자연키를 넣을 예정이다 |

```
계획 단계: 셀마다 insert 자연키 수집
        → existingNaturalKeys(전체 계획 키)          // 읽기 전용 1회 조회, unique index
        → computeExpectedSkips(셀들, DB에 있는 키)    // 실제 적용 순서 그대로 훑는다
        → expectedActualInserts = plannedInserts − expectedSkips

apply 후: report.inserted === (계획 − 그 셀의 expectedSkips)
```

순서 의존성은 **없애는 대신 정확히 반영**한다. 더해서 canonical이 아닌 구가 자연키를 먼저 차지하면 `nonCanonicalOwnerWarnings`로 알려 운영자가 `--district` 순서를 바꾸게 한다(동작 → 관악). `--expect-inserts` 게이트 의미는 그대로 **계획 insert 수**이고, 바뀐 것은 apply 후 대조뿐이다.

## 7. 서울 적재 규모 재산출 (DB write 0)

```
expectedActualInserts = (sourceRows − existingInDb) − expectedSkips
                      = (1,440,126 − 46) − 2
                      = 1,440,080 − 2
                      = 1,440,078
```

| 항목 | 값 |
|---|---|
| 원천 행 | 1,440,126 |
| 이미 DB에 있는 행(강남 46, 자연키 정확 일치) | 46 |
| **계획 insert** | **1,440,080** |
| **예상 skip** | **2** |
| **예상 실제 insert** | **1,440,078** |

기존 문서의 1,440,078과 같은 값이며, 이제 계산식이 명시돼 있다.

## 8. Phase별 skip

| 단계 | 원천 행 | 계획 insert | expectedSkips | 예상 실제 insert |
|---|---|---|---|---|
| Pilot (중구 최근 12개월) | 944 | 944 | **0** | 944 |
| Phase A (중구 전체) | 17,824 | 17,824 | **0** | 17,824 |
| Phase B (종로 11,582 + 용산 25,673) | 37,255 | 37,255 | **0** | 37,255 |
| **Phase C (나머지 22구)** | 1,385,047 | 1,385,001 (−기존 46) | **2** | **1,384,999** |
| 합계 | 1,440,126 | 1,440,080 | **2** | **1,440,078** |

충돌은 **Phase C에만** 있다(동작구·관악구 모두 Phase C). Pilot·A·B는 영향 0이다.

## 9. 중구 파일럿 재검증

| 항목 | 값 |
|---|---|
| 원천 | **944** (12셀) |
| 충돌 | **0** |
| 기존 행 UPDATE | **0** |
| 계획 insert | **944** |
| **예상 실제 insert** | **944** |

**이번 STEP에서 실행하지 않았다.**

## 10. 강남 기존 46행

**변경 0.** same 40 · cancel drift 2 · registryDate drift 4 = **승인 필요한 UPDATE 6건** 그대로 유지. 이 패치는 자동 승인을 만들지 않는다(`--approve-existing-updates` 게이트 불변).

## 11. sale-sync 격리

| 확인 | 결과 |
|---|---|
| `git status -- src/` | **비어 있음** |
| `git diff HEAD -- src/` | **비어 있음** |
| 취소 count reconciliation · restore gate · 부산 cron | **무변경** |
| 부산 취소/동기화 테스트 | `cancel-insert-path-sync` · `cancel-reconcile-integration` · `cancel-insert-plan` · `cancel-reconcile-logic` · `audit-seoul-sale-backfill-plan` **61 pass / 0 fail** |

## 12·13. 테스트 · lint · build

`scripts/backfill-seoul-sale.test.ts` 19 → **26**:

| 요구 | 테스트 | 결과 |
|---|---|---|
| **A** cross-district 중복 2행 | 동작+관악 함께 실행 → `expectedSkips = 2`, 건너뛰는 쪽은 관악, 이유 `RUN_EARLIER` | pass |
| **B** 충돌 없는 구 | `expectedSkips = 0`, 경고 0 | pass |
| **C** canonical 먼저 적재됨 | 관악만 실행 → `DB_EXISTS`로 2건 skip, 실제 insert 0 | pass |
| **D** 순서 검증 | 관악이 먼저면 `nonCanonicalOwnerWarnings` 1건(claimedBy 11620, canonical 11590), 동작이 먼저면 경고 0 | pass |
| **E** 중구 파일럿 | 944 / skip 0 / 예상 944 | pass |
| — | 자연키·canonical 추출(이름으로 구를 정하지 않음) | pass |
| — | `applyMatchesPlan` — 보정 전 오탐(false) → 보정 후 정상(true), 초과/미달·flip 불일치는 여전히 정지 | pass |
| **F** 부산 sale-sync 불변 | §11 — 61 pass / 0 fail, `src/` 무변경 | pass |

```
npx tsx --test scripts/backfill-seoul-sale.test.ts        pass 26   fail 0
npx tsx --test "scripts/*.test.ts" "scripts/*.test.mjs"   pass 256  fail 0
npx tsx --test "src/**/*.test.ts" "src/**/*.test.mjs"     pass 2342 fail 0  (영향 없음)
npx eslint (변경 4개 파일)                                  exit 0
npx tsc --noEmit                                          src/ 0 · 기존 scripts 21 + tmp 4 = FAIL_EXISTING_SCRIPT_ERRORS (건수 불변)
npm run build                                             exit 0
```

## 14. No-write assertion

| 항목 | 값 |
|---|---|
| Production INSERT / UPDATE / DELETE | **0 / 0 / 0** |
| Seoul apply | **0** |
| cancellation repair | **0** |
| master 생성·변경 | **0** |
| schema / migration | 0 / 0 |
| 외부 API 호출 | **0** (census는 캐시된 원천만 읽는다) |
| push | **0** |

## 15. 남은 것 · 다음

1. **적재 순서 권고**: Phase C에서 **동작구(11590)를 관악구(11620)보다 먼저** 적용한다. 그러면 2행이 canonical 구에 저장되고, 관악 쪽은 `DB_EXISTS`로 정확히 2건 건너뛴다. 순서를 반대로 해도 데이터는 깨지지 않지만 그 2행이 관악구로 저장되고 driver가 경고한다.
2. apply는 여전히 `DEFECT_A_GATE_PASS` 미설정으로 **BLOCKED**이며, false-cancel 28행 repair 결정도 미결이다.
3. 강남 46행의 UPDATE 6건은 apply 시 `--approve-existing-updates` 승인 대상.
4. 관악구 응답에 섞여 나오는 cross-district 행(서울 전체 33행)은 기존 정책대로 **원천 그대로 적재 + 목록 기록**이다. 이번 패치는 그 저장 위치를 바꾸지 않고, 계획 insert 중 canonical 구가 아닌 것을 `nonCanonicalInserts`로 세어 보고만 한다.
