# E-JIP SEOUL SALE PHASE A FULL DRY-RUN V1

서울 매매 Phase A(**중구 11140 전체 이력**)를 fresh source로 다시 수집하고,
이미 Production에 있는 최근 12개월 pilot 943건과 행 단위로 reconciliation한다.

- 측정: 2026-09-21 11:10~11:16 KST · 기준 커밋 `fcde23c`
- **READ ONLY** — Production INSERT 0 · UPDATE 0 · DELETE 0 · 서울 apply 0 · env 0 · schema 0 · runtime `src/` 변경 0

## 판정

**PARTIAL**

데이터 측면은 **전부 정확**하다 — 셀 255/255 COMPLETE, 기존 943건 exact, updates 0, collision 0,
expectedSkips 0, 취소 이상 0, 자연키 중복 0. **N = 943 + 16,880 = 17,823** 관계가 정확히 성립한다.

READY_FOR_APPROVAL로 올리지 못하는 이유는 **단 하나** — §15 성공 조건의 `master missing = 0`이
**547건**으로 충족되지 않는다. 그런데 이 547은 **결함이 아니라 프로젝트가 이미 채택한 정책의 결과**다(§4).
그래서 "고쳐야 할 문제"가 아니라 **사용자가 한 번 확인해 줄 판단**으로 남긴다.

**과거 이 적재를 막던 진짜 blocker(지도 오귀속)는 이미 닫혔다** — §4-3.

---

## 0. Safe start

`main` · HEAD `fcde23c` · origin 동기 · 기존 modified/untracked user work 전부 보존. reset·stash·clean 0.

## 1. Scope — 기존 설계 그대로, 임의로 정하지 않았다

`SEOUL_SALE_BACKFILL_PLAN_V1` §2 · §12에 정의된 범위를 사용했다.

| 항목 | 값 | 출처 |
|---|---|---|
| 대상 | 서울 중구 **`11140`** | 계획 §12 "Phase A — 중구 전체 이력" |
| 기간 | **2005-07 ~ 2026-09** | 계획 §2 "backfill 범위: 2005-07 ~ 현재 달" |
| 셀 | **255** | 위 기간 전개 |
| 과거 측정치 | 17,824 | **강제하지 않았다** — 아래 fresh N을 재계산 |

## 2. Source collection — 255/255 COMPLETE

운영 paging collector(`fetchSaleCell`) 사용.

| 항목 | 값 | 요구 |
|---|---|---|
| cells total | **255** | — |
| **COMPLETE** | **255** (`{"READY":255}`) | 전부 |
| **PARTIAL / FAILED** | **0 / 0** | 0 |
| `collected == totalCount` | **255/255** | 전부 |
| paging errors | **0** (`paging-errors.json` `[]`) | 0 |
| **fresh source total** | **17,823** | — |

> 계획 문서의 **17,824 → 17,823 (−1)**. 강제로 맞추지 않았다.
> pilot도 944 → 943으로 1행 줄었으므로, **최근 12개월 창 안에서 1행이 회수된 것과 일관**된다
> (같은 행이라는 증명은 아니다 — 과거 full-history rowset이 없어 행 단위 대조가 불가능하다).

## 3. Normalization — 운영 경로 그대로

`mapMolitItems` → `normalizeMolitItemsToTradeRows` → `naturalKeyOf`. 별도 구현 없음.

| 항목 | 값 |
|---|---|
| normalized rows | **17,823** |
| **active / canceled** | **17,486 / 337** |
| invalid | **0** |
| **자연키 중복(계획 내)** | **0** |
| 계획 내 occurrenceIndex 중복 | **0** |

## 4. Master match — aptSeq exact only (fallback·fuzzy 0)

| 판정 | 건수 |
|---|---|
| **EXACT_MASTER** | **17,276** (96.93%) |
| **MASTER_MISSING** | **547** (38 aptSeq) |
| INVALID_APTSEQ | **0** |
| REVIEW_REQUIRED | **0** |

### 4-1. 547은 "찾지 못한 것"이 아니라 **채택된 정책의 결과**

`SEOUL_HISTORICAL_MASTER_MISSING_STRATEGY_V1` §9가 **OPTION C(transaction-only)** 를 채택했다:

> 결정 #1 "backfill 전 MASTER 확장 필수인가 — **아니오**" · #2 "필요하다면 몇 개인가 — **0**"
> #4 "transaction-only로 둘 항목 — **2,424 aptSeq / 73,275행 전부**"

근거는 MOLIT의 어떤 exact 증거도 "같은 물리 단지"를 증명하지 못한다는 것이다.
master를 만들면 "이 과거 단지를 어디에 잇는가"라는 판단이 따라오는데 그 판단을 뒷받침할 증거가 없다.

driver도 같은 정책을 그대로 들고 있다 —
`master-missing.json.policy`: *"aptSeq 그대로(매핑·master 생성 없음). 과거 단지 master는 별도 STEP."*

**aptSeq는 보존되고 `identityKey = id:{aptSeq}`도 유지된다. 고아 행이 아니며, 다른 단지로 붙이지도 않는다.**

### 4-2. 38개 aptSeq — 전부 과거에 끝난 소규모 단지

| aptSeq | 행 | 마지막 거래 | 이름 |
|---|---|---|---|
| 11140-21 | 48 | 2024-05-28 | 장충 |
| 11140-23 | 33 | 2023-09-20 | 대림상가 |
| 11140-55 | 31 | 2019-08-31 | 진달래 |
| 11140-34 | 28 | 2022-05-27 | 약수(372-13) |
| 11140-54 | 28 | 2023-03-29 | 중구리버빌 |
| 11140-18 | 27 | 2024-06-08 | 예장동삼익 |
| 11140-1343 | 26 | 2019-12-24 | 정석그라시아 |
| 11140-41 | 25 | 2021-08-24 | 대성드림 |
| 11140-1004 | 21 | 2024-07-17 | 이지-빌 |
| … | … | … | (나머지 29개, 각 20행 이하) |
| **합계** | **547** | **최신 2024-07-17** | 38 aptSeq |

상가·빌라·맨션(대림상가·청계상가·스위스빌라·하니맨션·정동상림원 등)이 대부분이다.

**결정적 사실: 38개 전부 마지막 거래가 2024-07-17 이전이다.**
→ **pilot 창(2025-10~)에 걸치는 aptSeq는 0개**다. pilot 943건이 943/943 exact였던 이유가 이것이다.

### 4-3. 과거의 STOP 조건(지도 오귀속)은 **이미 닫혔다**

전략 문서 §9는 *"지도 2순위 이름 매칭에 상세와 같은 수준의 보호를 넣기 전에는 서울 매매 apply를 하지 않는다"* 는
선결 조건을 걸었다. **그 조건은 충족됐다.**

`src/lib/map-marker-coords.ts:42-70` (`MAP_TIER2_FALLBACK_REMOVAL_V1`, 커밋 `83d63a3`, QA `3b5ce6f` — 둘 다 HEAD의 조상):

```ts
// MAP_TIER2_FALLBACK_REMOVAL_V1 — **dong+name 완전일치만** canonical identity로 인정한다.
const master = index.exact.get(`${dong}|${name}`) ?? null;
// 완전일치에 실패하면 aptSeq/좌표 모두 null이다 — 다른 단지의 좌표를 빌려오지 않고, marker를 만들지 않는다.
```

2순위 `aptNamesMatch` fallback이 **운영에서 제거**됐다. master 없는 거래는 이제 **marker가 만들어지지 않을 뿐**,
다른 단지의 aptSeq·좌표를 물려받지 않는다.

**추가 안전 마진**: 지도 DB 경로는 최근 **12개월**만 읽는다(`fetchApt12MonthsFromDb`, `from.setMonth(-12)`).
547행은 전부 2024-07-17 이전이므로 **오늘 기준 지도 노출은 그 자체로 0행**이다.

### 4-4. 547행이 제품에서 어떻게 보이는가 (전략 문서 §7 기준)

| 기능 | 동작 |
|---|---|
| 지역 리포트 · 통계 · record-high · compare | **정상 집계** — 거래 테이블에서 직접 집계, master는 enrichment |
| 지도 | **marker 없음** (오귀속 아님) |
| 검색 | **노출 안 됨** — `apartmentMaster` 기반이라 구조적으로 숨겨짐 |
| 단지 상세 | 도달 경로 없음 · 직접 URL은 `resolveStrongIdentityAptSeqs`로 보호 |
| sitemap / SEO | 영향 없음(단지를 싣지 않음) · 서울은 `enablement.ts`에서 전 축 닫힘 |

## 5. Existing pilot reconciliation — **943 exact, 변경 0**

DB에서 실제 값을 다시 읽어 확인했다(943 / 888 / 55).

| 항목 | 값 | 요구 |
|---|---|---|
| 현재 중구 DB 행 | **943** (active 888 · canceled 55) | — |
| **existing exact** | **943** (`existing-skipped.json` count 943) | 943 |
| **DB-only rows** | **0** — DB 943행이 전부 원천에 매칭됐다 | 0 |
| **field mismatch** | **0** (`existing-state-drift.json` count 0) | 0 |
| **status mismatch** | **0** | 0 |
| **aptSeq mismatch** | **0** (중구 943행 master exact 943/943, `apt_seq` NULL 0) | 0 |
| existing 행의 거래일 범위 | 2025-10-01 ~ 2026-09-12 | — |

원천 rowset 대조(별도 경로)도 재확인: **source 943 / DB 943 / sourceOnly 0 / dbOnly 0 / fieldMismatch 0.**

**기존 943건은 INSERT도 UPDATE도 되지 않는다.**

## 6. Insert / Update plan (운영 driver dry-run)

```
[DRY RUN] cells=255 {"READY":255} inserts=16880 expectedSkips=0
          expectedActualInserts=16880 existingUpdates=0 calls=255 — DB write 없음
```

| 항목 | 값 | 요구 |
|---|---|---|
| existing rows | **943** | — |
| **planned inserts** | **16,880** | — |
| └ insertExactMaster | 16,333 | — |
| └ insertMasterMissing | **547** | §4 |
| **planned updates** | **0** | **0** |
| review | **0** | 0 |
| nonCanonicalInserts | **0** | — |

`planned updates = 0`이므로 `--approve-existing-updates`는 **불필요하고 금지**다.

계획된 16,880행의 거래일 범위는 **2006-01-02 ~ 2025-09-30** — pilot이 소유한 2025-10 이후와
**겹치지 않는다.** 구간 분할이 깔끔하다.

## 7. Natural-key collision

| 항목 | 값 |
|---|---|
| same-district collision | **0** |
| cross-district collision | **0** |
| **expectedSkips** | **0** |
| nonCanonicalOwnerWarnings | **0** |
| 계획 내 자연키 중복 | **0** |

중구 범위에서는 충돌이 **발생하지 않는다** — 임의 skip이 아니라 실측 0이다.
(`SEOUL_SALE_NATURAL_KEY_COLLISION_PATCH_V1`의 canonical-owner 로직은 그대로 적용되어 있고, 이 구에서는 걸리는 행이 없다.)

## 8. Cancellation safety

원천(full-history)과 계획 기준 실측:

| 항목 | 값 | 요구 |
|---|---|---|
| source canceled | **337** | — |
| 계획에 들어갈 canceled | **282** (= 337 − 기존 55) | 정합 |
| cancelFlips / cancelRestores | **0 / 0** | 0 |
| **cancelReconcileSkipped (sibling count mismatch)** | **0** | 0 |
| 계획 16,880행의 그룹 수 | 16,566 | — |
| multi-sibling groups | 238 | — |
| **all-canceled multi-sibling groups** | **0** | **0** |
| **suspect (Σ siblings−1)** | **0** | **0** |
| 최대 형제 수 | 8 | 아래 설명 |

**false-cancel candidate 0 · overcancel candidate 0 · sibling count mismatch 0.**
전원취소 그룹이 하나도 없으므로 이 적재는 `all_canceled_groups 245` · `suspect 304`를 **전혀 늘리지 않는다.**

형제 수 분포: 1형제 16,328 · 2형제 202 · 3형제 19 · 4형제 10 · 5형제 1 · 6형제 1 · **8형제 5**.
큰 그룹은 전부 설명된다 — 8형제 5개는 **오렌지카운티을지로**(오장동, 전용 15.79㎡ 소형) 동일가·동일일(2021-02-02)
분양성 거래이고 취소 0이다. 6형제 1개는 청계리버팰리스B(25.5㎡, 2025-04-07)로 6건 중 5건 취소 —
**전원취소가 아니므로** 결함 패턴이 아니다.

Defect-A repair 28건은 전부 부산이며 **이번 범위 밖 · 변경 0**이다.

## 9. Source-withdrawal isolation

부산 known source-withdrawal 4건(`940812`·`950148`·`950521`·`636871`)은 이번 STEP과 무관하다.
**DELETE 0 · withdrawn policy 구현 0 · schema 변경 0.**

## 10. Expected write plan · 관계 검증

| 기호 | 항목 | 값 |
|---|---|---|
| **N** | fresh source total | **17,823** |
| **E** | existing exact | **943** |
| **I** | planned inserts | **16,880** |
| **U** | planned updates | **0** |
| **S** | expectedSkips | **0** |
| **I − S** | **expected actual inserts** | **16,880** |

**관계 검증: N = E + source-only → 17,823 = 943 + 16,880 ✓ 정확히 성립.**
설명이 필요한 예외 **0건**.

## 11. Driver gates (read-only 확인)

apply 시 필요한 gate는 pilot 때와 동일하다. 이번 STEP에서 `--apply` 0 · `ALLOW_PROD_DB_WRITE` 0 · env 변경 0.

| gate | 상태 |
|---|---|
| `--expect-inserts` | **16,880** (아래 §13) |
| `--approve-existing-updates` | **불필요 · 금지**(existingUpdates 0) |
| 전 셀 READY | **255/255** |
| `DEFECT_A_GATE_PASS` · `ALLOW_PROD_DB_WRITE` · `ALLOW_PROD_DB_READ` | 전부 **NOT SET** (변경 0) |
| `SALE_CANCEL_RESTORE_ENABLED` | **NOT SET** 유지 |

**MOLIT quota 주의**: dry-run 후 `remaining 2,666 · reserve 2,000` — **실사용 가능분 약 666**이다.
apply는 255 call을 더 쓰므로 가능은 하지만 여유가 작고, quota는 **Production 라이브 조회·부산 cron과 공유**한다.
**quota 창이 회복된 뒤 실행하는 편이 안전하다.**

## 12. Production 현재 기준선 (이번 STEP 전후 동일)

| 지표 | 값 |
|---|---|
| 전체 sale 행 | **866,366** (active 849,994 · canceled 16,372) |
| **서울 전체** | **989** (canceled 56) |
| └ 중구 `11140` | **943** (888 / 55) · master exact 943/943 · `apt_seq` NULL 0 |
| └ 강남 `11680` | **46** (45 / 1) |
| **부산(26)** | **865,291** (canceled 16,314) |
| 대구(27) | 86 |
| all-canceled · suspect · multi-sibling | 245 · 304 · 13,110 |
| 자연키 중복(전역 / 중구) | **0 / 0** |
| known 28 | restored **28** 유지 |

## 13. No-write assertion

| 항목 | 값 |
|---|---|
| Production INSERT / UPDATE / DELETE | **0 / 0 / 0** |
| driver 보고 `writes` | `{insert: 0, update: 0, delete: 0}` |
| Defect-A repair 이후 생성된 행 · 갱신된 행 | **0 · 0** |
| 서울 Phase A apply · env · schema · runtime 동작 | **0 · 0 · 0 · 0** |
| MOLIT 호출 | 255 (중구 255셀 1회씩) |

## 14. Blockers

1. **`MASTER_MISSING 547` (38 aptSeq)** — §15의 `master missing = 0`을 충족하지 않는다.
   다만 이것은 **OPTION C 정책의 정상 결과**이고, 데이터 위조·fallback·fuzzy 매칭은 **전혀 없다**.
   **필요한 것은 수리가 아니라 "이 정책대로 적재해도 되는가"에 대한 사용자 확인 한 번이다.**
   과거 이 적재를 막던 지도 오귀속 경로는 **이미 닫혔고**(§4-3), 547행은 지도 창(12개월) 밖이라
   **오늘 기준 오귀속 노출은 0행**이다.
2. **MOLIT quota 여유 666** — 기능적 blocker는 아니지만 apply 타이밍 고려 필요(§11).

그 외 §15 성공 조건은 **전부 충족**한다.

## 15. Production apply 파라미터 (실행하지 않음)

```bash
ALLOW_PROD_DB_READ=1 ALLOW_PROD_DB_WRITE=1 DEFECT_A_GATE_PASS=1 \
npx tsx scripts/backfill-seoul-sale.ts \
  --district=11140 --from=2005-07 --to=2026-09 \
  --apply --expect-inserts=16880 \
  --out=tmp/seoul-junggu-phaseA-apply
```

- `--approve-existing-updates` **금지**(existingUpdates 0)
- `SALE_CANCEL_RESTORE_ENABLED` **사용 금지**
- **N은 측정 시점 값이다.** pilot 때처럼 apply 직전 dry-run을 다시 돌려 그 값을 `--expect-inserts`에
  넣는다. driver가 불일치를 스스로 거부한다.

## 16. 다음 권고

1. **`MASTER_MISSING 547`을 OPTION C대로 적재할지 한 번 확인받는다.** 이것이 유일한 미결이다.
   대안은 세 가지지만 실질적으로 하나다 — (a) OPTION C대로 적재(**권장**, 전략 문서 결정 그대로),
   (b) 547행 제외 적재(이력에 구멍이 생기고 통계가 틀어진다 — **비권장**),
   (c) 과거 단지 master 생성(전략 문서가 증거 부족으로 **명시 기각**).
2. **quota 창 회복 후 apply한다.** 직전 dry-run으로 `--expect-inserts`를 재확정한다.
3. **apply 후 검증은 pilot과 같은 도구로 그대로 된다** — `scripts/audit-junggu-pilot-apply-verify.ts`가
   전/후 스냅샷과 원천↔DB 전수 parity를 낸다. 중구 기대값은 **943 + 16,880 = 17,823행**.
4. **서울 노출은 계속 닫아 둔다.** Phase A는 데이터 적재일 뿐이다. `enablement.ts`의 `'11'`은
   25개 구 적재가 끝난 뒤 `stats`와 `cronSync`를 **함께** 연다.
5. **Phase B(종로·용산)는 이번 범위 밖**이다. Phase A 사후 감사 통과 후 별도 승인으로 진행한다.

## 산출물

| 파일 | 내용 |
|---|---|
| `tmp/…/junggu-phaseA-dryrun/summary.json` | dry-run 최종 보고 |
| `…/ready-inserts.json` | 계획된 16,880행 전체 |
| `…/existing-skipped.json` | 기존 943행(변경 없음) |
| `…/master-missing.json` | 38 aptSeq / 547행 목록 |
| `…/existing-state-drift.json` · `natural-key-collisions.json` · `review-required.json` · `paging-errors.json` | 전부 0 |
