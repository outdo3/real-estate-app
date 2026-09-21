# E-JIP SIBLING_COUNT_MISMATCH SINGLE-GROUP AUDIT V1

Defect-A 28 repair 검증 중 `SIBLING_COUNT_MISMATCH`로 제외된 **1그룹의 정체**를 특정한다.

- 측정: 2026-09-21 10:46~11:00 KST · 기준 커밋 `ed507d3`
- **READ ONLY** — Production INSERT 0 · UPDATE 0 · DELETE 0 · env 0 · schema 0 · runtime `src/` 변경 0

## 판정

**RESOLVED** — 분류 **`SOURCE_WITHDRAWAL`**.
MOLIT이 **취소 행 1건을 응답에서 회수**했고, DB는 그 행을 그대로 들고 있다.

지금 당장의 데이터 오류는 아니지만 **latent risk가 하나 있다**(§12).

---

## 0. Safe start

`main` · HEAD `ed507d3` · origin 동기 · 기존 modified/untracked user work 전부 보존. reset·stash·clean 0.

## 1. Target identity — 추정하지 않고 재스캔으로 특정

repair script는 건수만 찍고 identity를 남기지 않았다. 그래서 **같은 후보 집합·같은 판정 기준**으로
다시 훑어 skip된 그룹을 펼쳤다(`scripts/audit-sibling-count-mismatch-locate.ts`).

```
groupsExamined 7,987 · cellsFetched 1,132
counts { NO_EXCESS: 7,986, SIBLING_COUNT_MISMATCH: 1 }
targetRowsNow 0 · cellsNotOk []
```

> repair 당시는 `NO_EXCESS 7,958 + SIBLING_COUNT_MISMATCH 1 + 대상 28 = 7,987`이었다.
> 지금은 복구된 28그룹이 NO_EXCESS로 넘어와 **7,986 + 1 = 7,987**이고 `targetRowsNow 0`이다 —
> repair가 완결됐고 멱등이라는 재확인이기도 하다. **mismatch 그룹은 그때나 지금이나 정확히 1개다.**

| 항목 | 값 |
|---|---|
| lawdCd | **26380** (부산 사하구) |
| dealYmd / source cell | **202601** (`26380:202601`) |
| naturalKey(group) | `id:26380-303::81.46::sale\|34000\|2026-01-10\|17` |
| aptSeq | **26380-303** |
| 단지 / 법정동 | **일동지에닌** / 괴정동 |
| 전용면적 | 81.46㎡ |
| 거래일 | **2026-01-10** |
| 금액 | **34,000만원** |
| 층 | **17** |
| **DB sibling count** | **2** |
| **source sibling count** | **1** |

## 2. Fresh source reload — 운영 normalization path

`fetchSaleRegionMonth` → `normalizeMolitItemsToTradeRows` (운영 sync와 동일 모듈).

| 항목 | 값 |
|---|---|
| fetch 상태 | **COMPLETE** |
| totalCount / collected | **273 / 273** |
| normalized rows / invalid | 273 / **0** |
| `26380-303`의 202601 행 | **1건** |

원천 1행:

| amt | date | floor | occIdx | canceled | cancelDate | area | registryDate |
|---|---|---|---|---|---|---|---|
| 34,000 | 2026-01-10 | 17 | 0 | **false** | null | 81.46 | **26.04.02** |

MOLIT 원본 item(그대로):

```json
{"name":"일동지에닌","dealAmount":34000,"info":"81.46m² • 17층 • 2026-01-10","dong":"괴정동",
 "buildYear":"2004","jibun":"571-8","registryDate":"26.04.02","dealCanceled":false,"cancelDate":"",
 "aptSeq":"26380-303","excluUseArea":81.46,"dealDate":"2026-01-10","floorRaw":17}
```

**중요 — 원천이 취소를 못 싣는 상황이 아니다.** 같은 셀에 **취소 행이 15건** 들어 있다.
즉 이 셀에서 취소는 정상적으로 보고되고 있고, 이 그룹의 취소 행만 **없다**.

## 3. DB group snapshot

| id | occIdx | canceled | cancelDate | registryDate | aptSeq | created_at | updated_at |
|---|---|---|---|---|---|---|---|
| **636773** | 0 | **false** | null | **26.04.02** | 26380-303 | 2026-08-29 18:59:38.062 | 2026-08-30 12:30:48.090 |
| **636871** | 1 | **true** | **26.02.26** | null | 26380-303 | 2026-08-29 18:59:38.062 | 2026-08-30 12:30:48.090 |

두 행 모두 **같은 배치**에서 생성됐고(동일 `created_at`), 2026-08-30 이후 **한 번도 갱신되지 않았다.**

## 4. Source ↔ DB compare

| 항목 | source | DB | 판정 |
|---|---|---|---|
| sibling count | **1** | **2** | **불일치** |
| canceled count | **0** | **1** | 불일치 |
| source-only siblings | — | — | **0** |
| **DB-only siblings** | — | **1 (`636871`)** | **회수된 행** |
| 매칭된 행의 status mismatch | active | active | **0** |
| 매칭된 행의 registryDate | 26.04.02 | 26.04.02 | **일치** |
| **aptSeq mismatch** | 26380-303 | 26380-303 | **0** |
| 금액·거래일·층·면적 | 34000 / 2026-01-10 / 17 / 81.46 | 동일 | **0** |

**DB가 원천의 상위집합**이다. 매칭되는 행은 모든 필드가 정확히 일치하고, DB에만 있는 행이 1건이다.

## 5. History evidence

| 근거 | 내용 |
|---|---|
| 최초 생성 | **2026-08-29 18:59:38.062** — 두 행 동시(historical backfill 배치) |
| 최근 갱신 | **2026-08-30 12:30:48.090** — 이후 변경 없음 |
| 생성 시점의 원천 | 2행(active 1 + canceled 1). 그렇지 않았다면 취소 행이 만들어질 수 없다 |
| registryDate 기록 시점 | 2026-08-30 갱신분에 `26.04.02`가 이미 들어 있다 → 그때 원천이 **active(등기 포함) + canceled** 2행을 싣고 있었다 |
| 담당 cell 최신 검증 | `sale-recheck-2026-09-19T23-29-18-271Z` · fetched **273** · inserted 0 · updated 0 |
| 현재 원천 | **1행**(active) |
| **회수 시점** | **2026-08-30 ~ 2026-09-21 사이** — 그 이상 좁힐 근거가 없다(부산 원천 rowset 기준선 부재) |

recheck가 이 셀을 읽고도 아무 것도 쓰지 않은 것은 정상이다 —
`reconcileGroupCancellation`이 형제 수 불일치를 만나면 **추측하지 않고 skip**하기 때문이다
(`write-policy-logic.ts:197-200`: *"형제 수가 다르면 어떤 행이 어떤 행에 대응하는지 알 수 없다. 추측하지 않는다."*).

### 재버킷팅(re-bucketing) 배제

취소일이 `26.02.26`이므로 "취소 행이 202602 셀로 옮겨간 것 아닌가"를 확인했다. **아니다.**

| 셀 | 상태 | `26380-303` 행 |
|---|---|---|
| 26380:202512 | COMPLETE (281) | **0** |
| 26380:202601 | COMPLETE (273) | 1 (active, 위 그 행) |
| 26380:202602 | COMPLETE (230) | **0** |
| 26380:202603 | COMPLETE (293) | 1 — **별개 거래**(28,300 / 69.3㎡ / 4층, DB `637397`로 이미 보유) |
| 26380:202604 | COMPLETE (264) | **0** |

인접 어느 셀에도 해당 취소 행이 없다. **이동이 아니라 소멸이다.**

## 6. Classification — **`SOURCE_WITHDRAWAL`**

| 후보 | 판정 | 근거 |
|---|---|---|
| **SOURCE_WITHDRAWAL** | ✅ **확정** | DB ⊃ source. 원천에서 취소 행 1건이 사라졌고 인접 셀로 이동하지도 않았다 |
| MISSING_INSERT | ✗ | DB가 원천보다 **많다**. 누락은 반대 방향이다 |
| CANCELLATION_MISMATCH | ✗ | 매칭된 행의 취소 플래그는 원천과 **일치**한다. 플래그 문제가 아니라 행 존재 문제다 |
| IDENTITY_MISMATCH | ✗ | aptSeq·면적·금액·거래일·층 전부 정확히 일치 |
| HISTORICAL_SOURCE_DRIFT | △ | 상위 개념으로는 맞으나, **특정 1행의 회수**라고 말하는 편이 정확하다 |
| UNRESOLVED | ✗ | — |

부산 source-withdrawn 3건(`940812`·`950148`·`950521`)과 **같은 현상**이며,
다만 그때는 회수된 것이 **active 행**이었고 이번에는 **canceled 행**이다.
→ 알려진 회수 사례는 이제 **4건**이다(active 3 + canceled 1).

## 7. Production impact

**사용자에게 보이는 가격 데이터는 정확하다.**

| 항목 | 상태 |
|---|---|
| 이 단지의 해당 거래 | **active 1건(34,000 / 2026-01-10 / 17층, 등기 26.04.02)** — 원천과 일치 |
| 취소 행 `636871` | 취소로 표시되어 **active 집계·시세에서 제외**된다 |
| all-canceled group 여부 | **아니다**(2형제 중 1건만 취소) → `all_canceled_groups 245`에 **미포함** |
| `suspect_upper_bound 304` 기여 | **0** |
| Defect-A(과다취소) 여부 | **아니다** — repair가 건드리지 않은 것이 옳다 |

### 다만 latent risk 1건

이 그룹은 **취소 reconcile이 영구적으로 skip된다.**

- `reconcileGroupCancellation` → `SIBLING_COUNT_MISMATCH` → skip (`:197-200`)
- `planGroupInserts` → `missing = 1 − 2 = −1 ≤ 0` → `none` (`:344-345`)

즉 앞으로 이 자연키에 **진짜 취소가 새로 발생해도 cron이 반영하지 못한다.**
데이터가 지금 틀린 것은 아니지만, 이 한 그룹은 **취소 동기화가 죽어 있는 상태**다.

## 8. 수리 필요 여부

**지금 당장은 필요하지 않다. 그러나 정책 결정이 필요하다 — 이번 STEP 범위 밖이므로 쓰지 않았다.**

원천과 일치시키려면 **DELETE 1행**이 필요한데, 시스템에는 delete 경로가 없고
"원천이 회수한 행을 어떻게 다룰 것인가"는 부산 3건과 **동일한 미결 정책**이다.
두 건을 따로 판단하면 규칙이 두 벌이 된다 — **하나의 정책으로 묶어 결정**하는 편이 맞다.

### 승인 시 정확한 write scope

```
DELETE  1행
  id 636871  (26380 / 202601 / 일동지에닌 26380-303 / 34,000 / 2026-01-10 / 17층 /
              occIdx 1 / canceled / cancelDate 26.02.26 / registryDate NULL)
UPDATE  0
INSERT  0
```

- 삭제 후 그룹은 형제 1건이 되어 원천과 일치하고, **취소 reconcile이 되살아난다.**
- `occIdx 0`이 남으므로 인덱스 연속성 문제 없음.
- 대안(스키마 변경 필요 → 별도 승인): 물리 삭제 대신 `withdrawn` 상태 컬럼을 두어 provenance를 보존.
  AGENTS.md의 데이터 진실성 원칙("실패한 조회를 없는 데이터로 위장하지 않는다")에는 이쪽이 더 맞다.

## 9. No-write assertion

| 항목 | 값 |
|---|---|
| Production INSERT / UPDATE / DELETE | **0 / 0 / 0** |
| repair 이후 생성된 행 · 갱신된 행 | **0 · 0** |
| 전체 행 / active / canceled | 866,366 / 849,994 / 16,372 — **repair 직후와 동일** |
| all-canceled · suspect · multi-sibling | 245 · 304 · 13,110 — **동일** |
| known 28 | restored **28** 유지, `newest_update` 2026-09-21T01:34:01Z 불변 |
| env · schema · runtime `src/` | 변경 **0** |
| MOLIT 호출 | 1,132(전수 locate) + 1(셀 재조회) + 5(인접 셀 확인) |

## 10. 다음 권고

1. **원천 회수(source withdrawal) 정책을 한 번에 결정한다.** 지금 알려진 것은 4건
   (active 3: `940812`·`950148`·`950521`, canceled 1: `636871`). 선택지는
   (a) 물리 삭제, (b) `withdrawn` 상태 보존, (c) 방치. **(b)를 권한다** — 데이터 진실성 원칙에 맞고,
   "언제 사라졌는지"를 남길 수 있으며, 취소 reconcile 재개는 (a)와 (b) 모두에서 가능하다
   (skip 조건을 "회수된 행 제외 후 형제 수 비교"로 바꾸면 된다 — 이건 runtime 변경이라 별도 승인).
2. **부산 원천 rowset 기준선을 만든다.** 중구에 쓴 `audit-seoul-pilot-source-rowset.ts`와 같은 방식이면
   이번처럼 "2026-08-30~09-21 사이"로만 말하고 끝나는 일이 없어진다. 회수 빈도도 측정 가능해진다.
3. **`SIBLING_COUNT_MISMATCH`를 상시 지표로 올린다.** 지금은 1건이라 눈에 띄었지만, 이 값이 늘면
   그만큼 취소 동기화가 죽은 그룹이 늘어난다는 뜻이다. 이번 locate 스크립트가 그대로 그 지표다.
4. 이 그룹은 **Defect-A와 무관**하다. repair 결과 보고에 섞지 않는다.

## 산출물

| 파일 | 내용 |
|---|---|
| `scripts/audit-sibling-count-mismatch-locate.ts` | 후보 전수 스캔 + skip 그룹 identity 출력 (읽기 전용) |
| `tmp/sibling-count-mismatch/locate-*.json` | 이번 스캔 결과(그룹 상세 포함) |
