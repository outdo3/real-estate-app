# TRADE CANCELLATION RESYNC V1 — 취소거래 보정 재동기화

## 1. Approval Scope

사용자가 명시적으로 승인한 범위:

- 부산 16개 구·군 전체
- 현재월 + 직전 12개월(총 13개월)
- 약 208 region-month
- 기존 자연키 기반 upsert(`trade_natural_key`)
- `dealCanceled`/`cancelDate`/`registryDate` 등 기존 컬럼 갱신
- 필요한 정상 field refresh(`aptName`/`jibun`/`buildYear`)

금지(이번 STEP에서 수행하지 않음): schema 변경, migration 생성, 13개월을
넘어선 전체 재백필, delete/truncate, unrelated production write, 다른
사도(sido) 재동기화.

## 2. Why Resync

`TRADE_CANCELLATION_AUDIT_V1`(2026-08-30)에서 `src/lib/api-molit.ts`의
parser bug를 확정했다 — 문서상 가정이던 한글 필드명(`해제여부`/
`해제사유발생일`)만 확인했는데 실제 MOLIT 응답은 영문 필드명
(`cdealType`/`cdealDay`)만 내려줘 `dealCanceled`가 항상 `false`로
저장됐다. parser fix는 커밋 `30e11a7`로 이미 반영됐다. 기존 부산
855,045 rows는 이 버그 기간에 backfill되어 취소 상태를 신뢰할 수
없었다. 이번 STEP은 최근 13개월을 재조회해 수정된 parser로 취소
상태를 실제 DB에 보정한다.

## 3. Date Range

실행 시점(2026-08-30) 기준 현재월 + 직전 12개월:

- from = `202508`
- to = `202608`
- 총 13개월

`scripts/sync-trade-history.ts`의 `recentMonths(13)`가 자동 계산(하드코딩
없음).

## 4. Region Scope

부산 16개 구·군 전체(`--lawdCd` 명시 전달, `getSigunguListForSido()`
자동 조회 대신 승인된 고정 목록 사용):

26110, 26140, 26170, 26200, 26230, 26260, 26290, 26320, 26350, 26380,
26410, 26440, 26470, 26500, 26530, 26710

16 regions × 13 months = 208 region-month.

## 5. Before Snapshot

측정 시각: 2026-08-30, resync 실행 직전.

| 지표 | 값 |
|---|---|
| `apartment_trade_histories` total rows | 855,045 |
| 부산 최근 13개월(`lawd_cd` in 16구·군, `deal_date` in [202508-01, 202608-31]) rows | 39,792 |
| `dealCanceled=true` rows(최근 13개월, 부산) | 0 |
| `dealCanceled=false` rows(최근 13개월, 부산) | 39,792 |
| `dealCanceled=true` rows(전체 855,045건 기준) | 0 |
| natural key(`group_key`+`deal_amount`+`deal_date`+`floor`+`occurrence_index`) 중복 그룹 | 0 |
| distinct region-month(최근 13개월, 부산) | 208 |
| 취소 샘플 3건(AUDIT V1 §7) DB 상태 | 3건 모두 원본(occurrenceIndex=0)+취소사본(occurrenceIndex=1) 쌍으로 이미 존재, 두 row 전부 `dealCanceled=false`(취소 마킹 미반영 상태 재확인) |

## 6. Live Probe

대량 실행 전 단일 region-month(`lawdCd=26350` 해운대구, `dealYmd=202607`
— AUDIT V1에서 취소 786건 중 다수를 확보한 known 취소 포함 월)로
parser 정상 동작 확인.

- `fetchMolitData()` 반환 326 raw items 중 `parseCancellationFields()`
  적용 결과 `dealCanceled=true` 9건.
- AUDIT V1 대표 샘플과 정확히 일치 확인: 센텀KCC스위첸(aptSeq
  `26350-2580`, 84.61㎡, 65,000만, 13층, 2026-07-13 거래) → 파싱 결과
  `dealCanceled=true`, `cancelDate="26.08.04"` — AUDIT V1 §7 표와 완전
  일치.

Probe 성공 → 대량 실행 진행.

## 7. Script Used

`scripts/sync-trade-history.ts`(기존 스크립트 재사용, 신규 스크립트
작성 없음). 내부적으로 `scripts/backfill-trade-history.ts`의
`runTradeHistoryJob()`을 그대로 호출하며(로직 중복 없음), 차이는
resume을 항상 `false`로 강제해 최근 구간을 매번 재확인하는 것뿐이다.

실행 커맨드:

```
npx ts-node --transpile-only \
  --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
  scripts/sync-trade-history.ts --apply --months=13 \
  --lawdCd=26110,26140,26170,26200,26230,26260,26290,26320,26350,26380,26410,26440,26470,26500,26530,26710
```

(`--transpile-only`: 이 저장소의 `src/lib/api-molit.ts`가 Next.js
fetch 확장 옵션(`next: { revalidate }`)을 사용하는데, standalone
ts-node 타입체크 컨텍스트에서는 Next의 전역 타입 증강이 적용되지 않아
사전 존재하는 컴파일 타임 타입 오류가 발생한다 — 런타임 동작과 무관한
환경 문제이며 이번 STEP에서 발생시킨 코드 변경이 아니다. `npx tsc
--noEmit`은 프로젝트 tsconfig 컨텍스트에서 정상 통과함, §17 참고).

## 8. Actual Calls

- Region-month batch: 208/208 처리, 0 FAILED.
- 순차 실행(동시 1), 요청 간 최소 350ms 간격 + 스로틀 감지 시 지수
  백오프(기존 `fetchOneRegionMonth()` 로직 그대로, 신규 코드 없음).
- 429/quota 관련 응답 없음, 병렬 과다 호출 없음, 동일 month 중복 호출
  없음.
- 총 소요시간 747.3초(약 12.5분).

## 9. Upsert Behavior

기존 `upsertRows()`(natural key `trade_natural_key` 기준) 그대로 재사용.
update 경로는 `dealCanceled`/`cancelDate`/`registryDate`/`aptName`/
`jibun`/`buildYear`/`sourceFetchedAt`만 갱신하고 자연키 자체(금액/일자/
층/그룹)는 절대 변경하지 않는다 — 코드 수정 없음, §7 스크립트 재사용
원칙 그대로.

## 10. Cancellation Update

이번 실행에서 `dealCanceled=true`로 파싱된 row 2,277건(전체 fetch
39,791건 중). 자연키가 이미 존재하는 row는 update 경로로
`dealCanceled`/`cancelDate`가 갱신되고, 새로 발견된 row(예: 이전
backfill 이후 새로 등록된 거래)는 insert 경로로 생성된다.

## 11. After Snapshot

측정 시각: 2026-08-30, resync 완료 직후.

| 지표 | Before | After | 비고 |
|---|---|---|---|
| total rows | 855,045 | 855,047 | +2(신규 등록 거래, 폭증 없음) |
| 부산 최근 13개월 rows | 39,792 | 39,794 | +2 |
| `dealCanceled=true`(최근 13개월, 부산) | 0 | 2,277 | |
| `dealCanceled=false`(최근 13개월, 부산) | 39,792 | 37,517 | 37,517+2,277=39,794 정합 |
| `dealCanceled=true`(전체) | 0 | 2,277 | |
| natural key 중복 그룹 | 0 | 0 | 변화 없음 |
| distinct region-month(최근 13개월, 부산) | 208 | 208 | 전체 커버리지 유지 |

## 12. Real Sample Verification

AUDIT V1 §7의 대표 취소 샘플 3건 전부 DB에서 재확인:

| 단지 | 자연키(occurrenceIndex=0, 원본) | 자연키(occurrenceIndex=1, 취소사본) |
|---|---|---|
| 센텀KCC스위첸(26350-2580, 84.61㎡, 65,000만, 13층, 2026-07-13) | `dealCanceled=false`(유지) | `dealCanceled=true`, `cancelDate="26.08.04"`(AUDIT V1과 일치) |
| 삼정코아(26350-190, 59.9389㎡, 28,500만, 3층, 2026-07-31) | `dealCanceled=false`(유지) | `dealCanceled=true`, `cancelDate="26.08.20"`(AUDIT V1과 일치) |
| 동신(26350-119, 101.73㎡, 61,000만, 16층, 2026-07-23) | `dealCanceled=false`(유지) | `dealCanceled=true`, `cancelDate="26.08.04"`(AUDIT V1과 일치) |

3/3 PASS. 원본(active) row는 전부 `dealCanceled=false`로 유지됨(§10
CANCELLATION WRITE CONTRACT 충족).

## 13. Duplicate Check

resync 전후 natural key(`trade_natural_key`) 중복 그룹 0건 → 0건.
resync가 기존 dedup 계약을 훼손하지 않았음을 확인.

## 14. Row-count Sanity

전체 rows +2, 최근 13개월 부산 rows +2 — 208 region-month 재조회에도
불구하고 비정상 폭증 없음(자연키 upsert가 정상적으로 기존 row를
update만 하고 재삽입하지 않았음을 증명).

## 15. Valid Trade Read Proof

`src/lib/trade-history-read.ts`의 `getTradeHistory()`로 센텀KCC스위첸
샘플(identity=`26350-2580`, exclusiveArea=84.61) 조회:

- Raw(필터 없음) 조회: 원본(id=551191, `dealCanceled=false`) + 취소사본
  (id=551195, `dealCanceled=true`, `cancelDate="26.08.04"`) 2건 모두
  확인됨(raw read에서는 취소 row도 존재/조회 가능).
- `getTradeHistory()`(valid trade read, `dealCanceled: false` 필터 내장)
  결과 17건 중 취소사본(id=551195)은 **제외**, 원본(65,000만/
  2026-07-13)은 **포함**됨을 확인.
- `getAllTimeHigh()`도 정상 동작(68,000만/2024-07-26 반환, 별도 정상
  거래 — 이 샘플의 취소가 잘못 최고가로 집계되지 않음을 간접 확인).

PASS — raw read에는 존재, valid trade read에서는 정확히 제외됨을
실제 DB로 증명.

## 16. Record-High Limitation

이번 13개월 보정만으로 2006~2026 전체 cancellation correctness가
증명되는 것은 아니다. 이번 STEP 완료 후에도 "역대 신고가" 자동 전환은
하지 않는다(`HISTORICAL_LOOKBACK_MONTHS` 등 관련 안전장치 미변경).
이번 STEP의 의미는 최근 13개월 cancellation correctness 확보 + 향후
incremental sync 기반 확보이며, 과거 전체 기간(13개월 초과)의 취소
completeness는 별도 정책/검증이 필요할 수 있다.

## 17. Future Incremental Sync Policy

AUDIT V1 §15에서 제안한 정책을 운영 기본안으로 재확인:

- 매일(또는 주기적) current month + prior 3 months 재조회로 late
  registration/취소 반영(`scripts/sync-trade-history.ts --months=4`
  수준, 기존 스크립트 그대로 재사용 가능).
- 동일 job 중복 실행 방지 LOCK 필요(이번 STEP 시작 전 수행한
  `Get-CimInstance Win32_Process` 중복 프로세스 체크와 같은 원리를
  cron/scheduler 레벨에서 상시화).
- user request 트래픽(라이브 세마포어, 동시 6)과 MOLIT 대량 호출
  트래픽(backfill/sync 전용 순차 fetcher, 동시 1)을 분리 유지.
- DB-first read path(`trade-history-read.ts`)를 아직 어떤 live route도
  import하지 않음 — 다음 STEP(`TRADE_HISTORY_READ_MIGRATION_V1`)에서
  전환 시 quota budget 재검토 필요.

cron/system scheduler 구현 자체는 이번 STEP 범위 밖(설계만 문서화).

## 18. QA

- `scripts/qa-trade-history.ts` 실행: 대표 단지 8건 발견, 전부 DB
  최근 3건이 라이브 MOLIT 응답과 매칭(`OK`), 에러 없음.
- `npx tsx --test scripts/trade-history-logic.test.mjs`: 15/15 pass.
- `npx tsx --test src/lib/api-molit.test.mjs`: 6/6 pass.
- 총 21/21 pass(AUDIT V1과 동일 테스트 스위트, 회귀 없음 확인).

## 19. Known Limitations

- `cdealDay` 포맷(`YY.MM.DD`)은 파싱 없이 원본 그대로 저장 — 향후
  포맷이 바뀌어도 저장값에는 영향 없으나 소비 코드가 있다면 가정하지
  말 것(AUDIT V1과 동일 한계).
- 13개월 초과 과거 데이터의 취소 completeness는 이번 STEP으로
  증명되지 않음(§16).
- 같은 자연키의 취소 전/후 중복 row 존재 비율이 지역/월마다 편차가
  크다는 AUDIT V1 관측은 이번 재동기화에서도 동일하게 유지됨(설계상
  의도된 처리, 문제 아님).
- `data/trade-history/busan-manifest.json`은 `--resume` 없이 실행했으므로
  이번 208개 region-month 항목이 최신 상태(`SUCCESS`, `canceled` 필드
  갱신)로 덮어써졌다 — 과거 전체 20년 백필 이력 자체는 유지됨(같은
  파일의 다른 region-month 항목은 이번 실행 대상이 아니므로 무변경).

## 20. Next Step

`RESYNC_FIX_REQUIRED` 사유 없음(모든 성공 기준 충족, §21 참고).

추천 다음 STEP:

1. `MERGE_PARALLEL_BRANCHES`(다른 병렬 작업 브랜치가 있다면 병합) 또는
2. `TRADE_HISTORY_READ_MIGRATION_V1`(기존 라이브 통계 API가
   `trade-history-read.ts`의 valid-trade 헬퍼로 전환 — §17 DB-first
   read path 전환의 사전 조건이 이번 STEP으로 충족됨) 착수 검토, 또는
3. §17 incremental sync 정책의 cron/scheduler 구현(별도 승인 필요).

이번 STEP 자체에서 추가 코드 변경 없이 데이터 resync + 문서화만
수행했으므로, 실제 next step 선택은 ChatGPT PM 검수 이후 결정.
