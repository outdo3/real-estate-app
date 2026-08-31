# TRADE DB FIRST V1 — STEP F: 전국 Incremental Sync Engine

## 1. 목적

부산에서 검증된 TradeHistory 운영 구조(수집/정규화/취소처리/completeness)를
**전국으로 안전하게 확장할 수 있는 지속적인 incremental sync engine**으로
일반화한다. 전국 20년치를 한 번에 채우는 작업이 **아니다** — engine을
만들고, 그 correctness를 소규모 bounded QA로 증명하는 것이 이번 STEP의
전부다(§4/§37 명시적 범위 제한). 대규모 nationwide backfill은 이번
STEP에서 실행하지 않았고, 별도 승인 없이는 앞으로도 실행하지 않는다.

## 2. 기존 Ingestion 로직 AUDIT

`backfill-trade-history.ts`/`sync-trade-history.ts`/
`resync-cancellation-v2.ts`를 감사한 결과, 전국 확장에 필요한 구성요소가
**이미 대부분 지역 비종속적으로 구현돼 있었다**:

- `fetchOneRegionMonth()`(rate-limited fetcher, 동시 1 + 최소 간격
  350ms + 지수 백오프) — `lawdCd`/`dealYmd` 파라미터만 받는 완전
  범용 함수. 부산 하드코딩 없음.
- `normalizeMolitItemsToTradeRows()`(`trade-history-logic.ts`) —
  `parseCancellationFields`(`cdealType`/`cdealDay`, 이미 수정된 파서)
  포함, lawdCd 파라미터만 받는 범용 함수.
- `classifyAndWrite()`(`resync-cancellation-v2.ts`, STEP
  TRADE_CANCELLATION_RESYNC_V2에서 작성) — `lawdCd`/`dealYmd`/rows/apply만
  받는 완전 범용 오케스트레이션 함수. dealCanceled false→true만 반영하고
  true→false는 절대 되돌리지 않는 가드, 자연키 dedupe, aptName/dong
  불일치 시 CONFLICT 분류까지 이미 지역 무관하게 구현돼 있어 **그대로
  재사용**했다.
- `getSidoList()`/`getSigunguListForSido()`(`src/lib/region-utils.ts`) —
  RegionSelectModal이 이미 쓰는 전국 법정동코드 프록시 기반 동적 조회.
  하드코딩된 지역 목록 없음, 새로 만들지 않았다.

**전국 확장을 위해 새로 작성한 부분은 오케스트레이션 레이어뿐이다**:
지역 enumeration 조합, 지역별 "마지막 완료 달" 계산(incremental month
selection), 전용 completeness manifest. `scripts/
incremental-sync-nationwide.ts`(오케스트레이션) +
`scripts/incremental-sync-logic.ts`(순수 함수, `trade-history-logic.ts`와
동일 원칙으로 의존성 없이 분리 — Node 네이티브 테스트 러너
`--experimental-strip-types`가 scripts/*.ts 간 확장자 없는 상호 import를
해석하지 못하는 도구 제약 때문).

현재 scheduling 인프라 감사: `vercel.json` 없음, cron 관련 npm script
없음 — **자동 스케줄러가 전혀 존재하지 않는다**(§29). 이번 STEP은 아무
cron도 켜지 않았다 — engine만 완성했다.

## 3. 전국 지역 모델

```
sido: 16개(getSidoList() 실측)
서울특별시(11), 부산광역시(26), 대구광역시(27), 인천광역시(28),
광주광역시(29), 대전광역시(30), 울산광역시(31), 경기도(41),
충청북도(43), 충청남도(44), 전라북도(45), 전라남도(46), 경상북도(47),
경상남도(48), 제주특별자치도(50), 강원특별자치도(51)

sigungu: 261개(getSigunguListForSido() 전체 합산 실측)
```

**invalid/누락 지역**: 세종특별자치시가 목록에 없다(REGCODE_PROXY 응답
자체에 존재하지 않음 — 이번 STEP에서 새로 발견한, 기존 데이터 소스의
한계다). 세종은 자치구 없이 단일 행정구역이라 `regcode_pattern=*00000000`
매칭 방식과 안 맞을 가능성이 있다 — 근본 원인 조사는 이번 STEP 범위
밖이며, 전국 확장 시 알려진 gap으로 문서화한다. 나머지 16개 sido는
전부 정상 조회됐다.

## 4. Incremental 설계

### 4-1. Month 계산(`computeMonthsForRegion`, 순수 함수)

```
지역에 완료 기록(COMPLETE/EMPTY_VALID) 있음
  → 가장 최근 완료 달에서 overlapMonths만큼 물러난 지점부터 현재월까지
지역에 완료 기록 전혀 없음(첫 실행)
  → 최근 overlapMonths개월만(딥 백필 아님)
FAILED은 완료로 인정하지 않음(완료 지점을 앞당기지 않음)
```

### 4-2. Overlap window = 3개월(기존 값 재사용 + 실측 검증)

`sync-trade-history.ts`의 기존 `DEFAULT_ROLLING_MONTHS = 3`(실거래 신고
지연 30~60일 + 취소 반영 지연 근거, 기존 주석)을 그대로 재사용했다.
추가로 이번 STEP에서 부산 4,709건 취소 샘플(dealDate 대비 cancelDate
lag)을 실측 감사해 뒷받침했다:

```
lag(개월) 분포: p50=1 p75=2 p90=3 p95=4 p99=12 max=21
lag<=3개월 커버율: 92.1%(4,337/4,709)
lag<=6개월 커버율: 97.4%(4,587/4,709)
```

3개월 overlap은 취소 반영의 92.1%를 매 실행마다 흡수한다. 나머지 긴
꼬리(7.9%, 최대 21개월)는 상시 incremental engine이 아니라
`TRADE_CANCELLATION_RESYNC_V1/V2` 같은 별도 주기적 광범위 재검증의
몫으로 명시적으로 남긴다(§16 한계).

### 4-3. Retry / Bounded Concurrency / Batch

- Retry: `fetchOneRegionMonth()` 내부에 이미 있는 최대 5회 지수 백오프를
  그대로 재사용(새 outer retry loop 없음). 최종 FAILED가 남으면 전체
  completeness를 SAFE로 판정하지 않는다(§14).
- Concurrency: 지역×월 순차 for-loop(동시성=1). `fetchOneRegionMonth`
  자체가 이미 동시 1 + 최소 간격 350ms를 강제하므로(backfill-trade-
  history.ts §RATE LIMIT 실측 근거) 새 concurrency pool을 만들지 않았다
  — Supabase 15-connection 제한을 자연스럽게 존중한다(§21).
- Batch: `classifyAndWrite()`의 기존 `CHUNK_SIZE=500` 트랜잭션 배치를
  그대로 상속(§22 row-by-row 금지 충족).

### 4-4. Completeness Manifest

`data/trade-history/nationwide-sync-manifest.json`(신규, `busan-
manifest.json`과 완전히 분리 — 기존 부산 backfill 상태를 건드리지
않음). key=`${lawdCd}:${dealYmd}`, status ∈
{COMPLETE, EMPTY_VALID, FAILED, INVALID}.

## 5. Dry-run(bounded QA scope)

부산 서구(26140, 기존 서구가 이 프로젝트 전체에서 표준 QA 지역) + 서울
강남구(11680) + 대구 중구(27110), `--overlapMonths=1`(최근 1개월만):

```
regions=3 cells=3 COMPLETE=3 EMPTY_VALID=0 FAILED=0 INVALID=0
insert=132 flipFalseToTrue=0 skippedTrueToFalse=0 conflicts=0
elapsedSec=1.4
```

Sanity gate 통과 — 대량 insert/flip/conflict 없음, 지역당 fetched
건수(46~86)가 정상 범위. 진행.

## 6. 제한적 Production QA Write

Dry-run과 동일 scope로 실제 반영:

```
regions=3 cells=3 COMPLETE=3 EMPTY_VALID=0 FAILED=0 INVALID=0
insert=132 flipFalseToTrue=0 skippedTrueToFalse=0 conflicts=0
elapsedSec=3.4
```

Dry-run과 완전 일치. Post-write DB 직접 확인:

```
서울 강남구(11680): 46 rows(신규 — 이 STEP 이전 전국에서 유일하게
  부산만 있던 TradeHistory DB에 최초로 비-부산 데이터 적재)
대구 중구(27110): 86 rows(신규)
부산 서구(26140): 16,050 rows(변화 없음 — 이미 최신 상태, insert=0)
```

## 7. Idempotency

동일 scope 재-dry-run:

```
insert=0 flipFalseToTrue=0 conflicts=0
```

완전 멱등.

## 8. 부산 Regression

기존 `sync-trade-history.ts --months=1 --lawdCd=26140`(dry-run) 재실행 —
정상 동작(`fetched=49 invalid=0 failedBatches=0`), 이번 STEP이 별도
manifest 파일(`nationwide-sync-manifest.json`)을 쓰므로 기존
`busan-manifest.json` 기반 부산 운영 경로와 전혀 간섭하지 않는다.

## 9. 24M Cancellation SAFE 회귀 없음

`TRADE_CANCELLATION_RESYNC_V2` 직후 상태와 이번 STEP 이후 상태를 직접
대조:

```
                  V2 이후    STEP F 이후
older11mo canceled  2,432      2,432(불변)
recent13mo canceled 2,277      2,277(불변)
aptSeq missing      0          0
natural-key dup     0          0
```

완전히 불변 — **24M CANCELLATION COMPLETENESS = SAFE 유지**(이 STEP의
bounded QA write는 서구 현재월 1개 cell만 건드렸고 flipFalseToTrue=0
이었으므로 애초에 영향을 줄 수 없는 범위였다).

## 10. Capacity Estimate(실측 기반 선형 추정)

Postgres 실측(`pg_total_relation_size`, 855,047 rows 기준):

```
bytes/row(table+index) = 528.1
bytes/row(table만) = 267.2
bytes/row(index만) = 260.8
```

부산 16개 시군구 기준 밀도를 전국 261개 시군구로 선형 확장(실제
지역별 편차 — 서울/경기 등 수도권은 이보다 높고, 인구 적은 군 단위는
낮을 가능성 — 존재, 정밀 예측이 아닌 계획용 자릿수 추정):

```
전체 이력(~20년, 부산 855,047 rows/16구 = 53,440/구):
  전국 추정 = 261 × 53,440 ≈ 13,947,840 rows ≈ 7.4GB

최근 24개월(부산 67,809 rows/16구 = 4,238/구):
  전국 추정 = 261 × 4,238 ≈ 1,106,118 rows ≈ 584MB

연간 증가(24개월의 절반 근사):
  ≈ 553,000 rows/year ≈ 292MB/year(table+index)
```

기존 Supabase 무료/저용량 tier로도 24개월 규모(≈584MB)는 충분히
수용 가능한 범위다. 전체 이력(~7.4GB) 확장 시에는 capacity planning이
필요하다는 신호로 활용한다.

## 11. Scheduler

**기존 자동 스케줄러 없음**(§2). 이번 STEP은 Production cron을 켜지
않았다 — engine만 완성했다(§37 명시적 지시). 권장 cadence(실제 활성화는
별도 운영 판단):

```
전국 incremental sync: 일 1회(overlapMonths=3, 부산 기존 rolling
  sync-trade-history.ts와 같은 원리) — MOLIT 신고 지연 패턴(§4-2)상
  더 잦은 실행은 이득이 크지 않고, 하루 1회면 신규 거래/취소 반영
  모두 충분히 여유 있게 커버된다.
```

## 12. ADMIN OPS V1 Metrics(정의만, UI 없음)

향후 관리자 페이지가 보여줘야 할 최소 지표(이번 STEP은 정의만, 구현
없음 — §28):

```
region: { sido, sigungu, lawdCd }
latestCompleteMonth: manifest에서 COMPLETE/EMPTY_VALID 중 최신 월
failedCells: FAILED 상태로 남은 region-month 목록
invalidCells: INVALID(자연키 충돌) 상태로 남은 region-month 목록
rowCount: 지역별 apartment_trade_histories 총 row 수
cancellationsUpdated: 최근 실행에서 flipFalseToTrue 합계
lastSyncAt: manifest entry의 최신 `at` 타임스탬프
nextScheduledSync: 스케줄러 활성화 시 다음 실행 예정 시각(§11, 현재는
  스케줄러 자체가 없어 해당 없음)
duration: 최근 실행 소요 시간(로그의 elapsedSec)
```

`nationwide-sync-manifest.json`의 키(`lawdCd:dealYmd`)와 `NationwideCellEntry`
필드만으로 위 지표 전부를 계산 가능 — 별도 신규 schema 없이 기존
manifest 구조에서 파생 가능함을 확인했다(§19 요구사항 충족).

## 13. 사용자 API 변경 없음

이번 STEP은 ingestion infrastructure 작업이다. `price-rankings/
route.ts`, `region-change/route.ts`, `dashboard.ts`, `yearly.ts` 등
사용자 화면 API는 **단 한 줄도 수정하지 않았다**(§23 명시 요구사항).
`npm run build` 결과 모든 기존 라우트가 변경 없이 그대로 빌드됨을
확인했다.

## 14. Test / Build

- `node --experimental-strip-types --test scripts/incremental-sync-
  logic.test.mjs`: 신규 8개 테스트(첫 실행/overlap/완료지점 계산/
  EMPTY_VALID 인정/FAILED 불인정/지역 간 비간섭/최신 완료달 선택/
  최소 overlap 보장) 전부 pass.
- 기존 `scripts/trade-history-logic.test.mjs`(15개) 포함 scripts 레벨
  전체 23개 pass.
- `npx tsx --test`(src/lib 전체, 211개): 전부 pass(무변경 확인).
- `npx tsc --noEmit`: 20건(기존 `scripts/` 무관 오류, 신규 0건).
- `npx eslint`: clean.
- `npm run build`: PASS(사용자 API 무변경 재확인).

## 15. Database

- READ: 예
- INSERT: 132건(신규 지역 최초 진입분, 서울/대구)
- UPDATE: 0건(이번 QA 범위에서 flip 대상 없음)
- DELETE: 0건
- schema/migration: 변경 없음

## 16. Known Limitations / 다음 STEP

- 전국 대규모 backfill은 여전히 수행하지 않았다 — engine만 완성(§4).
- 세종특별자치시가 현재 region source(REGCODE_PROXY)에서 조회되지
  않는다(§3) — 근본 원인 조사는 범위 밖.
- Capacity 추정은 부산 밀도 기반 선형 추정이라 수도권 등 실제 편차가
  있을 수 있다 — 정밀 예측이 아닌 계획용 자릿수.
- 스케줄러는 여전히 비활성 상태(의도적, §37) — 실제 자동화는 별도
  운영 승인 필요.
- rising/region-change/area84의 전국 DB-FIRST 전환은 이번 STEP
  범위 밖(§26 — nationwide coverage가 충분히 구축되기 전까지 사용자
  경로를 자동으로 DB-FIRST로 전환하지 않는다).
