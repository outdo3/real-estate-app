# RENT_OCCURRENCE_SAFETY_V1 — 2행 데이터 교정 + group INSERT guard

작성일: 2026-09-05
선행 감사: `RENT_OCCURRENCE_STABILITY_V1`(2 cell root cause audit, READ ONLY)

## 목적

apartment RENT daily sync에서 확인된 **late-sibling occurrenceIndex 오염**의
(1) 기존 피해 2행을 원천 진실로 교정하고,
(2) 동일 오염의 재발을 스키마 변경 없이 차단한다(Option E).

근본 해결(Option D, multiset reconciliation)은 **이번 STEP 범위가 아니다.**

## 현재 상태 (STEP 착수 시점)

- branch `main`, HEAD `580254f`
- RENT 125,545행 / 자연키 그룹 117,202 / 다행 그룹 7,668(6.54%)
- 2026-09-05 rent cron: 32셀 중 **30셀만 coverage 기록** (2셀 stall)

## 분석 — 무엇이 실제로 일어났는가

`occurrenceIndex`는 `(lawdCd, dealYmd)` 배치 안에서 **행 내용의 결정적 정렬 순위**로
부여된다(`rent-history-logic.ts`의 `JSON.stringify` 정렬). 순서 불안정은 이것으로 이미
제거돼 있었다. 문제는 다른 곳에 있었다.

원천에 **나중에 형제 행이 추가되고 그 행이 기존 형제보다 앞으로 정렬되면** 기존 행의
순위가 0 → 1로 밀린다. 그런데 DB의 기존 행은 여전히 `occurrenceIndex = 0`을 들고 있다:

```
실행 전 DB (1행)          원천 (2행, 내용정렬 결과)        실행 후 DB (2행)
occ0 "26.10~28.10"   ←→   rank0 "26.09~28.09"  ← 신규     occ0 "26.10~28.10"  (그대로, 오염)
                          rank1 "26.10~28.10"  ← 기존     occ1 "26.10~28.10"  (INSERT된 복제본)
```

1. `source rank0`(신규) ↔ `DB occ0`(기존) → 내용 diff → first-mutation guard가 **UPDATE 차단**
2. `source rank1`(기존 내용) ↔ `DB occ1`(없음) → 매칭 실패 → **INSERT**

즉 **UPDATE만 막고 INSERT는 그대로 실행**되어, 기존 행 내용의 복제본이 생기고 신규 행의
진짜 내용은 저장되지 않았다. 행 수는 맞지만(2=2) 내용 multiset이 틀린 상태가 된다.

### 확정된 피해 범위

부산 RENT 전수(125,545행 / 25개월) 대조 결과:

| 항목 | 값 |
| --- | ---: |
| 다른 날짜에 형제가 추가된 클러스터(트리거 성립) | 11 (8개 셀) |
| 원천 재조회로 정상 확인 | 9 클러스터 (7개 셀, mismatch 0) |
| **실제 오염 확정** | **2 클러스터 / 2행** |

오염 필드는 `contractTerm` 단 하나. 금액·날짜·층·면적·identity·행 수는 전부 무손상이며
자연키 중복 0, aptSeq NULL 0.

오염 가능 구간은 rent overlap(최근 2개 완료월) rolling window에 한정된다 — 그보다 과거
월은 어떤 cron도 재조회하지 않아 신규 오염이 생길 수 없다.

## 설계 결정

| 옵션 | 채택 | 이유 |
| --- | --- | --- |
| A 현행 유지 | ✗ | 재발 |
| B 그룹 내 deterministic sort | ✗ | **이미 적용된 상태** — 이번 결함과 다른 문제를 고친다 |
| C richer stable fingerprint | ✗ | 자연키 변경 + 125,545행 migration. 서술 필드가 나중에 채워지면 **진짜 중복**이 생기는 더 큰 위험 |
| **D multiset reconciliation** | 보류 | 근본 해결이나 매칭 로직 재작성 — 별도 승인 |
| **E group write guard** | **채택** | 스키마/자연키/기존 행 무변경으로 즉시 출혈 차단 |

## 구현

### 1. Production 데이터 교정 (승인된 write, 정확히 2행)

`contractTerm` 단일 필드만. `where`에 현재값을 포함한 낙관적 잠금으로, 값이 바뀌었으면
0행이 되고 아무것도 덮어쓰지 않도록 했다.

| id | 지역 | before | after |
| ---: | --- | --- | --- |
| 122550 | 26170 (e편한세상부산항) | `26.10~28.10` | `26.09~28.09` |
| 35805 | 26260 (명장경동) | `27.09~29.09` | `26.09~28.09` |

INSERT 0 / DELETE 0 / schema 변경 0. 총 행수 125,545 무변화, 자연키 중복 0 유지,
aptSeq NULL 0 유지. `createdAt`/`sourceFetchedAt` 보존, `updatedAt`만 ORM 규약대로 갱신.

### 2. Option E — group INSERT guard

신규 순수 모듈 `scripts/rent-trade-history/rent-group-guard-logic.ts` (zero-import).

**불변식**

```
그룹 G에 review candidate가 하나라도 있으면  →  UPDATE(G) = 0  AND  INSERT(G) = 0
깨끗한 그룹 H                                →  기존 동작 그대로 유지
```

- 그룹 identity는 **occurrenceIndex 이전**의 자연 그룹
  (`groupKeyStr|deposit|monthlyRent|dealDate|floor`) — `rent-history-logic.ts`가
  occurrenceIndex를 매길 때 쓰는 그룹 정의와 문자 그대로 같다.
- **셀 전체를 막지 않는다.** 같은 셀의 무관한 그룹은 정상 진행한다.
- RENT는 애초에 기존 행 UPDATE 경로가 없으므로 `UPDATE(G)=0`은 구조적으로 이미 참이고,
  이번에 추가로 막는 것은 INSERT뿐이다.
- `COMPARE_FIELDS` 정의를 이 모듈로 단일화했다(값/순서 무변경).

`src/lib/sync/rent-sync-core.ts`는 판정을 복제하지 않고 `planRentCellWrites()`를 호출해
계획을 실행만 한다.

### 3. coverage semantics — 변경 없음

기존 §14 동작(`reviewCandidates > 0`인 셀은 coverage를 **기록하지 않음**)을 그대로 둔다.
가드가 걸린 그룹은 정의상 review candidate가 있으므로 coverage는 이미 전진하지 않는다.
성공으로 위장하지 않으며, durable run status 재설계는 이번 STEP에서 하지 않는다.

### 4. 관측

- `CellReport.guardedInsertsSkipped` / `SyncSummary.guardedInsertsSkipped` 추가(optional).
  `blocked`(aptSeq 없어 정규화에서 걸러진 행)와 **절대 합치지 않는다** — 서로 다른 사건이다.
  SALE 경로에는 이 가드가 없어 항상 `undefined`("해당 없음"이지 0건이 아니다).
- `GROUP_GUARD` / `GROUP_GUARD_DETAIL` 로그로 보류된 그룹 key를 남긴다.

## 테스트 결과

`scripts/rent-trade-history/rent-group-guard-logic.test.mjs` 신규 11 케이스, 전부 PASS.
실제 `normalizeMolitRentItemsToRentRows`를 그대로 써서 occurrenceIndex 부여까지 함께 검증한다
(가짜 fixture로 슬롯을 손으로 매기면 이번 버그를 재현할 수 없다).

- CASE 1 깨끗한 단일 행 그룹 — 기존 동작 유지 (unchanged / 신규 INSERT 허용)
- CASE 2 새 형제가 **앞으로** 정렬 → review 발생 + 그 그룹 INSERT 전면 보류
- CASE 3 새 형제가 **뒤로** 정렬 → 기존 행 무변경, 정상 INSERT (안전 경로 명시 확인)
- CASE 4 가드 그룹 + 깨끗한 그룹 공존 → 가드 그룹 0건, 깨끗한 그룹 INSERT 성공
- CASE 5 내용 동일 형제 → 병합하지 않고 2건 유지, 재실행 멱등
- 부가: floor NULL 제외, 그룹 key/자연키 구분, 실측 26260 사례 재현

전체 검증:

- `node --experimental-strip-types --test`(.test.mjs 전체): **473개 중 470 PASS / 3 FAIL**
  — 3건 전부 기존 `ERR_MODULE_NOT_FOUND`(확장자 없는 상대 import). 신규 실패 0.
- `npx tsc --noEmit`: 변경 파일 4개(`rent-sync-core.ts`, `shared.ts`,
  `rent-group-guard-logic.ts`, 테스트) 오류 **0건**. 나머지는 기존 script 오류
  (`FAIL_EXISTING_SCRIPT_ERRORS`).
- `npm run build`: PASS

### 실셀 dry-run 재현 (READ ONLY, 데이터 교정 후)

| cell | source | DB | unchanged | review | inserts | guarded |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 26170:202608 | 76/76 COMPLETE | 76 | 76 | **0** | 0 | 0 |
| 26260:202607 | 280/280 COMPLETE | 280 | 280 | **0** | 0 | 0 |

두 셀 모두 완전 정합 — stall이 해소됐고 다음 무인 실행에서 coverage가 32/32로 전진한다.

## 알려진 문제 / 남은 위험

- Option E는 **출혈 차단**이지 근본 해결이 아니다. 앞으로 같은 상황이 오면 그 그룹은
  보류되고 해당 셀의 coverage가 전진하지 않는다(조용한 오염보다 낫지만 사람 개입 필요).
- `needsReview` payload와 run status가 durable 저장되지 않아 사후 재구성이 어렵다.
- `/admin/ops`의 `computeOverallHealth`는 "coverage가 오래 전진하지 않는 셀"을 입력으로
  받지 않아 stall이 WARNING으로 올라오지 않는다.
- SALE은 이 결함에 해당하지 않는다 — 도착 순서 기반 index이고 비교 집합이
  `aptName/dong/dealCanceled/registryDate`로 훨씬 좁다(서술 필드 비교 없음).

## 다음 STEP

- **Option D**(group multiset reconciliation) 설계 승인 → 별도 STEP.
  occurrenceIndex는 저장용 일련번호로만 남기며 schema migration은 예상되지 않는다.
- stall 관측 보완(`computeOverallHealth` 입력 추가, run status durable 저장).
- OFFICETEL STEP 3B는 별도 승인 사항 — 이 STEP이 자동으로 착수하지 않는다.
