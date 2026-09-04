# TRADE REGISTRY DATA V1.1 — registryDate self-heal write policy

- 상태: **구현 + supervised Production apply 완료**
- 이 STEP의 Production DB write: **440건** (registryDate NULL→value 보충만)
- schema 변경: **0** / migration: **0** / index 변경: **0**
- 범위: SALE만. RENT은 원천에 등기 개념이 없어 해당 없음(RENT_TRADE_HISTORY_V1 PHASE A §7).

## 1. 목적

TRADE_REGISTRY_DATA_V1 감사에서 확정된 결함을 구조적으로 고친다.

원천(MOLIT `RTMSDataSvcAptTradeDev`)은 2023-01-01 이후 체결 계약에 대해 `rgstDate`(등기일자)를
공개한다. 그런데 **등기는 계약 후 수 주~수 개월 뒤에 완료**되는 반면, cron은 계약 직후 INSERT
한 번만 하고 그 행으로 다시 돌아오지 않았다. 결과적으로 등기가 나중에 완료된 행은 `registryDate`가
**영원히 NULL**로 남았다.

감사 실측(부산 16구 × 202301~202609, 720셀 전수, 원천 재조회):

| 계약연도 | 원천 rgstDate | DB rgstDate | STALE |
| --- | ---: | ---: | ---: |
| 2023 | 24,896 (94.8%) | 0 | **24,896** |
| 2024 | 26,935 (92.7%) | 0 | **26,935** |
| 2025 | 32,639 (91.1%) | 15,702 | **16,937** |
| 2026 | 16,741 (72.3%) | 16,085 | **656** |
| 합계 | 101,211 | 31,787 | **69,424** |

월별로 보면 202301~202507은 매월 전량 stale이고, 202508~202602는 0~9건, 202603 이후는
13→43→132→**247**→153→55로 **지금도 계속 벌어지는 중**이었다. 마지막 구간이 이 STEP이
막으려는 현상이다.

## 2. 근본 원인 (코드 경로)

| 경로 | INSERT | 기존 행 UPDATE |
| --- | --- | --- |
| cron `src/lib/sync/sale-sync-core.ts` | `registryDate` 저장 | **취소 flip(false→true) 때만** 기입. 취소 행은 원천 `rgstDate`가 비어 있어 실질 복구 효과 0 |
| CLI `scripts/backfill-trade-history.ts` | 저장 | 비취소 행에도 재기입(`buildCancellationUpdateFields`) |
| CLI `scripts/resync-cancellation-v2.ts` | 저장 | flip 때만 |

결정적 공백: `write-policy-logic.ts`의 `classifyRow()`에 **"registryDate만 보충"이라는 분류가
없었다.** 등기가 새로 완료된 활성 행은 cron에서 `noop`으로 분류되어 아무 것도 기록되지 않았다.

## 3. 설계 — `updateRegistryOnly`

`classifyRow()`에 분류 하나를 추가했다. 판정 우선순위는 **취소가 언제나 앞선다**:

```
1. identity conflict / reviewRequired
2. updateFalseToTrue      (취소 반영)
3. updateTrueToFalseSkipped (취소 역행 차단)
4. updateRegistryOnly     (등기일자 보충)   ← 신규
5. noop
```

기존 kind들의 판정 결과는 바뀌지 않는다. 이전 구현은 "취소상태 동일 → noop"을 먼저 검사했는데,
취소상태가 같을 때만 4/5에 도달하고 다를 때는 2/3으로 갈라지므로 재배치 후에도 **동치**다
(테스트로 고정).

### 조건

```
기존 row 존재 AND aptName/dong 일치(conflict 아님)
AND DB dealCanceled === false AND 원천 dealCanceled === false
AND DB registryDate IS NULL
AND 원천 registryDate 값 있음
```

취소된 거래를 대상에서 뺀 이유: 원천이 취소 건에 등기일자를 주지 않는다(등기 불가).
실측으로도 취소 행 중 `rgstDate`를 가진 건은 **0건**이었다.

### Write contract

`buildRegistryOnlyUpdateFields()`가 반환하는 객체 **그대로만** UPDATE에 쓴다.

```ts
data = { registryDate: source.registryDate }
```

- `dealCanceled` / `cancelDate` / 자연키(`dealAmount`·`dealDate`·`floor`·`exclusiveArea`·
  `aptSeq`·`groupKeyStr`·`occurrenceIndex`) / `aptName` / `dong` / `lawdCd` 전부 **미포함**
- `sourceFetchedAt` 같은 운영 메타필드도 넣지 않는다(기존 정책상 불필요)
- NULL→value만. value→value(덮어쓰기)와 value→NULL(지우기)은 분류 층과 write contract 층에서
  **각각 독립적으로** 차단한다(`recordCoverageCells`가 dry-run을 두 번 막는 것과 같은 패턴)

### Occurrence safety

`occurrenceIndex`는 원천 응답 등장 순서로 부여되므로, 같은 자연키 그룹에 형제 row가 여러 개면
순서가 흔들렸을 때 형제의 등기일자를 서로 바꿔 쓸 수 있다(V1 실측: 2023+ 부산 행의 **8.9%**가
다행 그룹).

그래서 **형제 전원의 `registryDate`가 완전히 동일할 때만** 보충한다. 이 조건에서는 어느 형제에
써도 값이 같으므로 순서가 뒤바뀌어도 오매칭이 성립할 수 없다. 하나라도 다르면
(예: 한쪽만 등기 완료) 보충하지 않고 `registryAmbiguousSkipped`로 집계한다 — 잘못된 값을 쓰느니
NULL로 남기는 쪽이 안전하다.

## 4. Metric 분리

`registryUpdated` / `registryAmbiguousSkipped`를 `CellReport`·`SyncSummary`에 추가했다.
**취소 flip(`updated`)과 절대 합치지 않는다** — 서로 다른 사건이고, 섞으면 ADMIN_OPS_V1.2에서
겪은 "다른 것을 같은 칸에 넣기" 실수를 반복하게 된다.

`sync_coverage_cells`에는 기록하지 않는다(schema 변경 금지). coverage completeness 판정은
전혀 건드리지 않았다 — **registryDate가 없다고 PARTIAL이 되지 않는다.** 등기 전 거래는 NULL이
정상이기 때문이다.

## 5. Cron 통합

daily sale-sync(0~3개월)와 recheck sweep(4~12개월)이 **같은 `syncOneSaleCell`을 재사용**하므로
새 정책이 두 경로에 자동 적용된다. **별도 API 호출 0, 별도 cron 0, vercel.json 변경 0.**

두 경로가 합쳐 0~12개월을 매일 훑고 등기는 보통 계약 후 2~3개월에 완료되므로, 향후 데이터는
**추가 비용 없이 자기치유**된다.

## 6. DRY-RUN (READ ONLY)

`scripts/trade-registry-data/registry-selfheal-dryrun.ts` — cron과 같은 core를 mode='dry-run'으로 실행.

| 범위 | registry 후보 | ambiguous skip | flips | inserts | blocked | conflict/review |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| daily (202606~202609) | 440 | 15 | 0 | 0 | 0 | 0 |
| recheck sweep | 7 | 0 | 0 | 1 | 0 | 0 |
| **합계** | **447** | **15** | 0 | 1 | 0 | 0 |

coverage cell 110개 불변, `coverageRecorded` daily 0 / sweep 0, 후보 모집단 75,202 불변.

**감사 예측과 정확히 일치**: 감사가 202606~202608에서 stale로 지목한 건수는 247+153+55 = **455**,
dry-run의 daily 결과는 보충 440 + 모호 skip 15 = **455**. 자기치유가 감사가 찾은 바로 그 행들을
잡고, 그중 순서 모호한 15건만 건너뛴다는 뜻이다.

## 7. Supervised APPLY (Production)

`scripts/trade-registry-data/registry-selfheal-apply.ts` — cron이 부르는 `syncOneSaleCell`을
그대로 apply 모드로 실행. daily와 동일한 정상 scope(202606~202609 × 16구 = 64셀)만.
**coverage는 기록하지 않는다** — 이 실행은 검증범위를 전진시키는 실행이 아니고, `/admin/ops`의
"daily 마지막 실행" runId를 사람 손 실행으로 덮어써 무인 cron 모니터링을 흐리지 않기 위함이다.

| 항목 | 값 |
| --- | ---: |
| registryUpdated | **440** |
| registryAmbiguousSkipped | 15 |
| cancellation flips | **0** |
| inserts | **0** |
| blocked / review | 0 / 0 |
| 처리 셀 | 64 |
| 중단 여부 | 없음(STOP 임계 1,000 미달) |

전후 실측:

| 지표 | before | after | delta |
| --- | ---: | ---: | ---: |
| 부산 2023+ 활성 row 중 registryDate NULL | 75,202 | 74,762 | **−440** |
| 부산 2023+ registryDate 있음 | 31,787 | 32,227 | **+440** |
| 취소 행 중 registryDate 있음 | 0 | **0** | 0 |

`withValue` 증가분이 보고된 update 수와 **정확히 일치**(440 = 440)한다는 것은 기존 값을 덮어쓴
건이 **0건**임을 산술적으로 증명한다(덮어썼다면 증가분이 update 수보다 적었을 것이다).

## 8. POST-APPLY 검증

최근 30분 내 기록된 행 440건 전수:

- 440건 전부 `registry_date` 값 보유
- 취소 행 **0건**, `cancel_date` 보유 **0건** → 취소 필드를 쓴 적 없음
- `created_at` 2026-08-29~2026-09-03 → 전부 **기존 행**(신규 INSERT 없음)
- `deal_ymd` 202606~202608 → scope 이탈 없음

전역 무결성:

| 항목 | 값 |
| --- | ---: |
| 전체 row | 864,100 (**apply 전과 동일** — insert/delete 0) |
| `aptSeq` NULL | 0 |
| 취소=false인데 cancel_date 존재 | 0 |
| 적용 월(202606~202609) 자연키 중복 | 0 |

월별 registryDate coverage: 202606 1,490→**1,728**(+238) / 202607 617→**765**(+148) /
202608 133→**187**(+54).

## 9. 검증 명령과 실제 결과

| 항목 | 명령 | 결과 |
| --- | --- | --- |
| 정책 단위테스트 | `node --experimental-strip-types --test scripts/write-policy-logic.test.mjs` | **20/20 PASS** (§9 A~H 전 케이스 포함) |
| 관련 sync 테스트 | `... --test src/lib/sync/shared.test.mjs scripts/cancellation-write-guard.test.mjs src/lib/cron-schedule.test.mjs` | **34/34 PASS** |
| typecheck | `npx tsc --noEmit` | `FAIL_EXISTING_SCRIPT_ERRORS` — **24건 전부 기존 스크립트/`tmp/`**, 이번 변경 파일에는 **0건**(변경 전 baseline과 동일) |
| lint | `npm run lint` | **PASS (exit 0)** |
| build | `npm run build` | **PASS (exit 0)** |

작업 중 발견해 고친 자체 회귀 3건: `rent-sync-core.ts`(공유 타입 필드 누락),
`band-scan.ts`(select 누락), `resync-cancellation-v2.ts`(로컬 union 중복 정의 — 유니온을
`RowClassificationKind` import로 바꿔 재발 차단).

## 10. 남은 범위 / 하지 않은 것

- **2023-01~2025-07 backlog 약 68,400행은 그대로 남아 있다.** recheck band가 12개월까지만
  닿으므로 자기치유로는 도달하지 않는다. 이 STEP은 **historical bulk backfill을 하지 않는다**
  (§10 금지사항). 실제 소비처가 생길 때 별도 승인으로 판단한다.
- **계약 2023-01 이전 749,659행은 영구 복구 불가** — 원천이 등기일자를 공개하지 않는다.
- `aptDong`은 여전히 저장하지 않는다(schema 변경 금지 범위).
- `registryDate`는 현재 제품 소비처가 **0건**이다(`/api/apt/[name]`은 live MOLIT 응답에서
  직접 읽고, UI는 렌더링하지 않는다). 이 STEP은 사용자 노출을 바꾸지 않는다.
