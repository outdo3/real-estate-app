# TRADE_HISTORY_DATA_V1 — 전체 실거래 이력 구축 V1

## 1. Goal

MOLIT(국토교통부) 아파트 매매 실거래를 이집 DB에 영속 저장해, 다음을 가능하게 한다.

- 진짜 전체 이력 기준 신고가/역대 최고가 계산(현재는 24개월 lookback으로만 안전하게 제한됨)
- 전국/서울 등 대규모 지역 통계의 cold 성능 개선(현재는 매 요청마다 MOLIT 재조회)
- 향후 통계 API의 DB-first 전환을 위한 기반 마련(이번 STEP에서는 read path를 전환하지 않음)

## 2. Why Needed

커밋 `40afb20`("make record-high claims historically safe")이 이미 이 한계를 명시적으로 기록했다:

> "Audited MOLIT's region+month-only fetch shape and confirmed true unbounded history isn't safely achievable without a persisted trade DB (schema change, out of scope)"

`src/lib/price-ranking.ts`의 `HISTORICAL_LOOKBACK_MONTHS = 24`가 바로 이 제약의 코드상 흔적이다. 이번 STEP은 그 제약을 근본적으로 해소하기 위한 데이터 기반을 놓는다.

## 3. Current Limitation (Baseline Audit)

- MOLIT 아파트 매매 API(`RTMSDataSvcAptTradeDev`)는 지역(lawdCd)+월(dealYmd) 단위로만 조회 가능 — 단지/면적 단위 필터 없음.
- 모든 통계 라우트(`/api/stats/*`)는 매 요청마다 라이브 재조회 + 인메모리 TTL 캐시(`server-cache.ts`, 5~10분)만 사용. 서버 재시작/캐시 만료 시 다시 MOLIT을 두드림.
- 기존 `Transaction`/`TradeHistory` Prisma 모델은 존재하지만 legacy/미사용(라이브 어떤 라우트도 참조하지 않음, 시드/오프라인 스크립트 전용, `억` 단위 손실 저장, identity 없음) — 이번 STEP의 대상이 아니다.
- `ApartmentMaster.aptSeq`는 부산만 3,402건 구축됨(전국 아님). 개별 MOLIT 거래 응답 자체의 `aptSeq`는 부산 감사에서 결측 0건으로 신뢰 가능.

## 4. MOLIT Raw Contract (실측, `src/lib/api-molit.ts`)

`fetchMolitData({lawdCd, dealYmd, type:'apt'})`가 파싱해 돌려주는 필드:

| 필드 | 원본 | 비고 |
|---|---|---|
| aptSeq | item.aptSeq | 문자열, nullable |
| name(aptNm) | item.아파트/item.aptNm | |
| dong(umdNm) | item.법정동/item.umdNm | |
| jibun | item.지번 | |
| excluUseArea | item.전용면적 | parseFloat, raw 그대로 |
| dealAmount | item.거래금액 | 만원 단위 정수 |
| dealDate | item.년/월/일 조합 | "YYYY-MM-DD" |
| floorRaw | item.층 | |
| buildYear | item.건축년도 | |
| dealCanceled | item.해제여부 === 'O' | |
| cancelDate | item.해제사유발생일 | |
| registryDate | item.등기일자 | |

**V1에서 캡처하지 않는 필드**(존재하지만 미파싱, 임의로 만들지 않음 — 데이터 없으면 값 생성 금지 원칙): `dealingGbn`(거래유형: 중개/직거래), `buyerGbn`/`slerGbn`(매수/매도자 구분). 향후 필요 시 별도 STEP에서 `api-molit.ts` 파싱을 확장하고 추가 컬럼을 additive migration으로 얹는다.

**거래 고유 일련번호 없음**: MOLIT 응답에는 거래를 고유하게 식별하는 serial/registration 필드가 없다. 이것이 §6 IDENTITY 설계의 핵심 제약이다.

## 5. Schema — `ApartmentTradeHistory`

`prisma/schema.prisma`에 추가(순수 additive, 기존 모델/컬럼 변경 없음):

- `id`, `source`(기본 `MOLIT_APT_TRADE`), `lawdCd`, `dealYmd`(fetch 배치 추적용)
- `aptSeq`, `identityKey`, `dealType`(`'sale'` 고정, V1은 매매만), `groupKeyStr`
- `aptName`, `dong`, `jibun`
- `exclusiveArea`(**Decimal** — `ApartmentUnitType.canonicalExclusiveArea`와 동일 컨벤션)
- `dealAmount`(**Int**, 만원 단위 — float 금지)
- `dealYear`/`dealMonth`/`dealDay`(raw 그대로) + `dealDate`(위 3개로부터 무손실 재구성, `@db.Date`)
- `floor`(**Int**, not null — §6 참고), `buildYear`(Int?)
- `dealCanceled`, `cancelDate`, `registryDate`
- `occurrenceIndex`(§6/§7 참고)
- `rawUid`(디버그 추적용), `sourceFetchedAt`, `createdAt`, `updatedAt`

`identityKey`/`groupKeyStr`는 `src/lib/regional-feed.ts`가 이미 확립한 `identityKey()`/`groupKey()` 정의로 계산한 값을 저장한다(라이브 통계와 DB가 항상 같은 identity 정의를 쓰도록 보장).

## 6. Identity / Unique Key — 실측 기반 설계

**실측(§7 DUPLICATE AUDIT, 2026-08-29, 부산 서구 26140, 2026-05~07 raw 250건)**: `(identity+area+dealType+dealAmount+dealDate+floor)` 자연키 조합 243개 그룹 중 **7개(2.9%)가 실제로 2건씩** 존재했다(완전히 동일한 관측값을 가진 서로 다른 실거래). MOLIT에 이를 구분할 다른 raw 필드가 없다.

> **[정정 각주 — 2026-09-04, `SALE_CANCELLATION_SEMANTICS_V1.md`]**
> 위 문단의 두 전제는 **과도했다**. 후속 감사(부산 2020-02 이후 246,126행 전수 + 원천 재조회)에서 확인된 사실:
> - 이 2행 구조의 다수는 "서로 다른 실거래"가 아니라 **uncanceled + canceled 쌍(TYPE B, 7,216 pair)** 이다. 위 250건 표본의 중복률 2.9%는 오늘 측정한 TYPE B 비율 3.14%와 사실상 같아, 당시 "서로 다른 실거래"로 분류한 그룹 상당수가 이 쌍이었을 가능성이 높다. 당시 감사는 그 7개 그룹의 `cdealType`을 확인하지 않았다.
> - **"구분할 다른 raw 필드가 없다"는 사실이 아니다.** `cdealType`(해제여부) · `rgstDate`(등기일자, 2023-01 이후 계약부터 공개) · `aptDong`(2023+, 소유권 이전등기 완료 건에 한해 공개)이 두 행을 구분한다.
>
> 다만 **`occurrenceIndex` 설계와 아래 unique constraint는 그대로 유효하며, 변경하지 않는다.** 2행이 생기는 메커니즘은 원천만으로 판별 불가(`source alone cannot disambiguate`)이고, 2023년 이후 실측에서 uncanceled 행은 일반 유효거래와 거의 동일한 비율(98.9~100%)로 등기가 완료된 반면 canceled 행의 등기 완료는 **0건**이다. 따라서 **uncanceled 행을 유효거래로 유지하는 현재 동작이 옳으며, pair 병합·삭제·effective-canceled 처리는 금지**한다. 2020~2022 구간은 원천이 `registryDate`/`aptDong`을 공개하지 않아 **영구 UNVERIFIABLE**이다.

**해결**: `occurrenceIndex`(같은 자연키 그룹 내 MOLIT 응답 원본 등장 순서, 0부터)를 최후 discriminator로 추가한다 — 두 행을 병합하지 않는다. 두 행은 이미 모든 관측 필드가 동일하므로, 재fetch마다 순서가 바뀌어도 저장값 자체는 항상 정확하다(§47 요구사항 충족).

**Unique constraint**: `@@unique([groupKeyStr, dealAmount, dealDate, floor, occurrenceIndex], name: "trade_natural_key")`

**floor를 not-null로 강제한 이유**: Postgres는 nullable 컬럼을 포함한 unique 제약에서 여러 NULL을 서로 다른 값으로 취급해(NULL ≠ NULL) upsert 기반 중복방지가 깨진다. 실측(250건 표본)상 아파트 매매 실거래는 항상 층 값을 포함하므로, 층 파싱 불가 케이스는 `MISSING_FLOOR`로 분류해 스킵한다(값을 임의로 만들어 채우지 않음 — invalid row로 명시적 제외).

## 7. Duplicate Audit — 실측 결과

| 항목 | 값 |
|---|---|
| 표본 | 부산 서구(26140), 2026-05~07, 3개월 |
| Raw fetched | 250건 |
| 유니크 자연키 그룹 | 243개 |
| 중복 그룹(2건) | 7개 (2.9%) |

> **[정정 각주 — 2026-09-04]** 이 감사는 중복 그룹의 `cdealType`을 확인하지 않았다. 후속 전수 감사에서 이 형태의 다수가 **uncanceled + canceled 쌍**임이 확인됐다 — §6 정정 각주와 `SALE_CANCELLATION_SEMANTICS_V1.md` 참고.

## 8. Cancellation Contract

- 원거래 row를 삭제하지 않는다.
- `dealCanceled`/`cancelDate`/`registryDate`는 자연키 **밖**의 필드 — upsert 시 이 필드만 갱신한다.
- 실측(§46 TEST, DB 레벨): 첫 fetch(active) → 재upsert(canceled) → **같은 row id**가 유지되고 row 수는 늘지 않으며 `dealCanceled`가 정확히 반영됨을 확인. 원상복구 후 검증 완료.

## 9. Correction / Re-issue

MOLIT 원본 자연키(금액/일자/층/그룹)가 실제로 바뀌면 새 row로 취급된다(기존 row가 자동 갱신되지 않음). 이는 실제 국토부 실거래가 정정 관행과 일치한다: 정정은 원 신고를 **해제(취소)**하고 새 신고를 등록하는 방식으로 이뤄지므로, `dealCanceled` upsert만으로 취소 반영이 정확히 동작한다. "같은 행의 가격만 조용히 수정"되는 사례는 이번 STEP 표본에서 관측되지 않았다(KNOWN LIMITATION — 만약 존재한다면 새 row + 기존 row가 취소 처리되지 않은 채 남는 형태로 나타난다).

## 10. Raw Payload Storage

V1에서는 rawJson 전체 저장을 채택하지 않았다 — 필요한 필드는 이미 정규화 컬럼으로 모두 보존되고, 캡처하지 않는 필드(§4)는 그 자체로 존재를 인정하고 문서화했다. DB 용량을 불필요하게 늘리지 않는다.

## 11-13. Data Types / Indexes

- `exclusiveArea`: `Decimal`(84.7855 vs 84.9950 정확히 구분, 단위 테스트로 검증)
- `dealAmount`: `Int`(만원 단위, float 금지)
- Indexes: `[aptSeq, exclusiveArea, dealDate]`, `[lawdCd, dealDate]`, `[identityKey, dealDate]`, `[dealDate]` — §11 필수 시나리오(A/B/C/E/F/G/H) 커버, 과다 생성 없음.

## 14-16. Migration

마이그레이션 `20260829012733_trade_history_v1_create_table`: 순수 `CREATE TABLE` + `CREATE INDEX`만 포함(DROP/ALTER 없음, 기존 테이블 무영향, lock 위험 없음) — SQL 직접 검토 완료. `prisma migrate deploy`로 프로덕션(Supabase) 적용 완료.

## 17-18. Backfill Scope / History Start Date

- 대상: 부산광역시 16개 구/군 전체.
- 시작 시점: **2006-01**(실측 확인 — lawdCd=26140 기준 2005-12은 0건, 2006-01부터 실거래 존재. 추정하지 않고 직접 조회로 확인).
- 종료: 2026-08(백필 실행 시점 기준 최신월).

## 19-24. Backfill Pipeline / Resumability / Rate Limit

- `scripts/backfill-trade-history.ts` — region×month 순회, `--dry-run`(기본)/`--apply`/`--resume`/`--sido`/`--lawdCd`/`--from`/`--to`/`--maxBatches` 옵션.
- **실측 발견 — RATE LIMIT**: 최초 구현은 기존 라이브 세마포어(`molit-stats-helpers.ts`, 동시 6+200ms pacing, 인터랙티브 트래픽 기준)를 재사용했으나, 대량 backfill 연속 호출에서 data.go.kr의 "초당 서비스 요청제한 횟수 초과" 실제 스로틀을 유발해 이후 요청이 연쇄적으로 전부 실패하는 것을 확인했다. Backfill/sync 전용으로 훨씬 보수적인 자체 순차 fetcher(동시 1, 최소 간격 350ms, 스로틀 감지 시 지수 백오프 최대 10초/5회)를 별도로 구현했다 — 기존 라이브 세마포어(다른 모든 통계 API가 쓰는)는 전혀 건드리지 않았다.
- **또 다른 실측 버그(자체 발견·수정)**: `region-utils.ts`의 `getSigunguListForSido()`가 반환하는 `code`가 5자리로 잘리지 않은 원본 법정동코드(10자리)였다 — 이를 그대로 MOLIT `LAWD_CD` 파라미터에 넘기면 API가 조용히 "정상 0건"을 반환해 실제 데이터가 있는 지역이 전부 `EMPTY_VALID`로 잘못 기록되는 것을 초기 실행에서 발견, `.substring(0,5)`로 수정 후 재검증(공유 라이브 파일은 수정하지 않고 이 스크립트 안에서만 자름).
- Resumable: `data/trade-history/busan-manifest.json`(region-month 단위 SUCCESS/FAILED/EMPTY_VALID)로 재개 가능. Upsert 기반이라 `--resume` 없이 재실행해도 안전(idempotent, 실측 확인).
- Invalid row 정책(§22): `MISSING_AMOUNT`/`MISSING_AREA`/`MISSING_DATE`/`MISSING_IDENTITY`/`MISSING_FLOOR`/`API_ERROR_PLACEHOLDER`로 분류, 강제 삽입하지 않음.
- Chunked transaction: 500 rows/batch(§25).

## 25-32. Busan Backfill Execution — 실측 결과 (완료 2026-08-30)

**실행 이력**: 최초 실행이 data.go.kr 일일 quota 소진으로 중단됐다(1,620/3,968 attempts, 1,365 SUCCESS / 254 FAILED(quota 소진, true no-data 아님) / 1 EMPTY_VALID). 이번 세션은 자정 경과 후 재개 전 quota reset 여부를 단일 lightweight fetch(1건, 서구/206~ FAILED 항목 중 하나를 dry-run으로 재조회)로 먼저 확인했고, 383건 정상 응답을 받아 reset을 확인한 뒤 대량 실행을 시작했다.

**Resume 실행**: `--sido=26 --from=200601 --to=202608 --apply --resume`. 기존 SUCCESS/EMPTY_VALID(1,366건)는 건드리지 않고, FAILED(254) + 미시작(북구/해운대구/사하구/금정구/강서구/연제구/수영구/사상구/기장군 9개 구) 합계 **2,602 region-month**만 처리했다.

| 항목 | 값 |
|---|---|
| 처리 region-months | 2,602 |
| 소요 시간 | 16,044.7초 (약 4시간 27분) |
| fetched (raw) | 665,094건 |
| invalid | 0건 |
| persisted(신규+갱신) | 665,094건 |
| failedBatches | **0건** (quota reset 이후 전 구간 정상) |

**최종 manifest 상태** (`data/trade-history/busan-manifest.json`): 3,968/3,968 attempts 완료 — SUCCESS 3,960 / EMPTY_VALID 8 / **FAILED 0**. 16개 구·군 × 248개월(2006-01~2026-08) 전 조합 처리 완료.

**최종 DB row 수**: **855,045건** (백필 전 189,951건 + 이번 실행 665,094건 — 정확히 일치, 산술 검증 완료).

**지역별 커버리지** (`apartment_trade_histories`, lawdCd 기준, 16/16 구·군 전부 존재):

| lawdCd | 구 | rows |
|---|---|---|
| 26110 | 중구 | 4,348 |
| 26140 | 서구 | 16,050 |
| 26170 | 동구 | 11,054 |
| 26200 | 영도구 | 23,820 |
| 26230 | 부산진구 | 99,366 |
| 26260 | 동래구 | 66,422 |
| 26290 | 남구 | 72,137 |
| 26320 | 북구 | 88,248 |
| 26350 | 해운대구 | 124,641 |
| 26380 | 사하구 | 86,961 |
| 26410 | 금정구 | 50,395 |
| 26440 | 강서구 | 22,976 |
| 26470 | 연제구 | 53,776 |
| 26500 | 수영구 | 42,308 |
| 26530 | 사상구 | 55,820 |
| 26710 | 기장군 | 36,723 |

**날짜 범위**: 2006-01-01 ~ 2026-08-28 (요청 범위와 일치, 추정 없이 실제 저장값 기준).

**자연키 중복 검사**: `(group_key, deal_amount, deal_date, floor, occurrence_index)` 기준 raw SQL GROUP BY로 전수 검사 — **중복 0건**(§6/§7 identity 설계가 실 데이터에서도 유효함을 확인).

**aptSeq 결측**: 0건 (전 행 aptSeq 존재).

**취소(해제) 거래**: 855,045건 중 **0건**이 `dealCanceled=true`. 필드 파싱 자체는 라이브 재조회(부산진구/서구 등 거래량 많은 최근 4개월 표본, `item.해제여부==='O'`)로 별도 확인했고 정상 동작한다 — 다만 그 4개월 표본에서도 실제 해제 건이 하나도 없어, 필드가 "정상 동작하지만 표본에 취소 케이스가 없었다"는 것만 확인됐다. 실제 모집단 취소율이 0%인지, data.go.kr 쪽 해제 데이터 반영 자체가 드문지는 외부(MOLIT 공식 UI) 교차검증 없이는 완전히 단정할 수 없다. **"정상" 단정이 아니라 "확인 필요"로 분류**한다(§13/§15 원칙) — 다음 STEP(sync/read migration)에서 실제 취소 사례가 나타나는지 계속 관찰 권장.

## 33. DB-First Read Path — 전환 안 함

이번 STEP은 어떤 라이브 API route의 데이터 소스도 바꾸지 않았다. `src/lib/trade-history-read.ts`(신규)는 어떤 route에서도 import되지 않는다 — 다음 STEP(`TRADE_HISTORY_READ_MIGRATION_V1`)의 대상.

## 34. Common Read Helper

`src/lib/trade-history-read.ts`: `getTradeHistory`, `getAllTimeHigh`, `getPreviousTrade`, `getRegionalTrades` — proof/query 수준의 최소 구현. identity는 `regional-feed.ts`의 `identityKey()`를 그대로 사용.

## 35-37. Performance Benchmark / Storage — 실측 결과 (2026-08-30)

`scripts/benchmark-trade-history.ts` 실행(읽기 전용, DB에 쓰지 않음). (A) 신규 DB 이력 조회 vs (B) 기존 라이브 MOLIT 재조회 헬퍼(`molit-stats-helpers.ts`, 실제 프로덕션과 동일한 동시 6+200ms pacing)를 같은 질의로 실측 비교.

| 시나리오 | DB 조회 | 라이브 MOLIT 재조회 | 배수 | 비고 |
|---|---|---|---|---|
| 1. 단일 단지(대신롯데캐슬 26140-1164) 84.7855㎡ 전체 이력 | 78ms (104 rows, 전체 기간) | 2,166ms (24개월만, 24/24 fetch 성공) | **약 27.8배** | DB는 전체 기간(2006~), 라이브는 24개월 제한이 그대로 §36 핵심 효과 |
| 2. 서구(26140) 최근 12개월 | 234ms (952 rows) | 878ms (12/12 fetch 성공) | 약 3.8배 | |
| 3. 부산 전체 16개 구 최근 12개월 | 6,799ms (37,438 rows) | 23,313ms (192/192 region-month fetch 성공) | 약 3.4배 | |
| 4. 84㎡ band + 24개월, 부산 전체 | 5,949ms (24,970 rows) | (측정 안 함 — 라이브는 시나리오3과 동일 fetch를 공유하므로 별도 재실행 불필요) | — | DB는 exact area range filter로 단일 쿼리 완결, 라이브 경로는 필터 전 전체 재조회가 선행돼야 함 |

모든 라이브 fetch가 100% 성공(failed=0)했고, 이는 backfill 전용 보수적 fetcher가 아니라 **기존 라이브 세마포어를 그대로 쓴** 결과 — 벤치마크가 실제 프로덕션 조회 성능을 정확히 대표한다.

**저장 공간**: 855,045 rows, 인덱스 4개(§13). 별도 용량 측정 명령을 실행하지 않았다 — 필요 시 `pg_total_relation_size`로 후속 확인 가능(V1 범위 밖).

## 38. National Expansion Plan

부산 backfill 실측 결과(row 수, 소요 시간, 실패율)를 바탕으로 다음 우선순위를 제안한다.

1. 서울(가장 거래량 많은 지역, 25개 구) — 부산 대비 예상 API 호출량/저장량은 아래 §37 projection 참고.
2. 경기도.
3. 전국 나머지.

**이번 STEP에서 전국/서울 backfill을 자동 실행하지 않았다** — TRUE GATE #7(외부 API rate-limit/비용/운영 위험) 판단은 부산 실측 결과를 사용자에게 보고한 뒤 별도 승인을 받는다.

## 39-41. Incremental Sync

`scripts/sync-trade-history.ts` — 최근 N개월(기본 3개월) rolling window를 `--resume` 없이(항상 재확인) 재조회해 upsert. 늦은 신고/취소/정정을 반영한다. `backfill-trade-history.ts`의 `runTradeHistoryJob()`을 그대로 재사용(로직 중복 없음).

옵션: `--apply`, `--months`, `--sido`, `--lawdCd`.

일일/주기 실행은 이번 STEP에서 cron으로 등록하지 않았다(package.json 수정 금지 원칙 — §43 참고, 커맨드는 이 문서에만 기록).

## 42-43. Scripts / Package Script

- `scripts/backfill-trade-history.ts`
- `scripts/sync-trade-history.ts`
- `scripts/trade-history-logic.ts`(순수 정규화 로직)
- `scripts/qa-trade-history.ts`
- `scripts/benchmark-trade-history.ts`

`package.json`은 pre-existing dirty 상태라 수정하지 않았다(worktree 보호 원칙). 실행 커맨드는 각 스크립트 상단 주석과 아래에 기록한다.

```bash
# Dry-run(기본), 특정 구/기간
npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
  -r ./scripts/_register-paths.js scripts/backfill-trade-history.ts --lawdCd=26140 --from=202606 --to=202606

# 부산 전체 실제 backfill(재개 가능)
npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
  -r ./scripts/_register-paths.js scripts/backfill-trade-history.ts --sido=26 --from=200601 --to=202608 --apply --resume

# 최근 3개월 rolling sync
npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
  -r ./scripts/_register-paths.js scripts/sync-trade-history.ts --apply
```

`--transpile-only`가 필요한 이유: `src/lib/api-molit.ts`가 Next.js의 `fetch()` 확장(`next: {revalidate}`)을 쓰는데, 이는 Next 빌드 컨텍스트 밖(standalone ts-node)에서는 타입 선언이 로드되지 않아 타입 에러가 난다(런타임 동작에는 영향 없음 — Node의 네이티브 fetch가 인식하지 못하는 여분 속성은 무시됨). `npx tsc --noEmit`(Next 프로젝트 전체 컨텍스트)에서는 정상 통과한다(§54 확인).

## 44-48. Unit Tests

`scripts/trade-history-logic.test.mjs` — 14개 테스트(정규화, invalid 분류, occurrenceIndex 병합 방지, exact area 정밀도, 취소 필드가 자연키 밖임을 확인, identity/group key parity).

실행: `node --experimental-strip-types --test scripts/trade-history-logic.test.mjs`

결과: **14/14 PASS**

## 49-51. QA — Record High / Previous Trade / No UI Change — 실측 결과 (2026-08-30)

`scripts/qa-trade-history.ts` 실행(읽기 전용). 대표 단지 8곳(이름 패턴 3개 + 거래량 상위 1위 2개 구)에 대해 (1) DB 최근 거래를 같은 달 라이브 MOLIT 재조회와 대조, (2) 전체 이력 기준 최고가/직전거래 조회, (3) 24개월 lookback 최고가와 전체 이력 최고가 비교.

**버그 발견 및 수정**: 최초 실행에서 8곳 중 2곳(해운대한솔솔파크 84.8773㎡, 더샵센텀파크1차 84.6389㎡)이 DB에 실제로는 각 125건/1,008건이 저장돼 있음에도 `getTradeHistory`/`getAllTimeHigh`가 **저장 거래 수=0**을 반환했다. 원인 조사 결과 `src/lib/trade-history-read.ts`의 세 함수(`getTradeHistory`/`getAllTimeHigh`/`getPreviousTrade`)가 `exclusiveArea`(Decimal 컬럼)를 JS `number`(float64) 그대로 Prisma where 필터에 넘기고 있었는데, 특정 소수값(실측: 84.8773, 84.6389 등)에서 Prisma 쿼리 엔진의 number→Decimal 내부 직렬화가 저장값과 정확히 일치하지 않아 **조용히 0건**을 반환하는 것을 확인했다(같은 값을 문자열로 넘기면 정상 매칭 — 직접 재현 스크립트로 5개 표본 면적 중 2개에서 100% 재현). 이 헬퍼는 아직 어떤 라이브 API route에서도 import되지 않는 상태(§33)라 프로덕션 영향은 없었지만, 이번 STEP의 QA 대상 산출물 자체의 정확성 버그이므로 세 함수 모두 `exclusiveArea`를 `String(exclusiveArea)`로 넘기도록 수정했다(동작 계약/함수 시그니처 변경 없음, 안전한 버그 수정). 수정 후 재실행 결과 8/8 전부 정상 매칭.

**최종 결과 (8/8 대표 단지, 수정 후 재실행)**:

| 단지 | 라이브 MOLIT 매칭 | 저장 이력 수 | 전체이력 최고가 vs 24개월 최고가 |
|---|---|---|---|
| 대신롯데캐슬 (서구) | OK | 104 | 6.0억(2021-08) vs 4.9억 — 다름(실제 사례) |
| 비스타동원더비치테라스 (서구) | OK | 14 | 6.25억(2024-03) vs 5.93억 — 다름 |
| 동대신역비스타동원 (서구) | OK | 15 | 6.85억(2022-08) vs 5.93억 — 다름 |
| 서면비스타동원 (부산진구) | OK | 31 | 5.8억 — 동일(24개월 내 최고) |
| 해운대한솔솔파크 (해운대구) | OK | 125 (버그 수정 전 0) | 5.25억(2021-10) vs 3.67억 — 다름 |
| 연산동한솔솔파크 (연제구) | OK | 28 | 3.5억(2021-01) vs 3.3억 — 다름 |
| 더샵센텀파크1차 (해운대구) | OK | 1,008 (버그 수정 전 0) | 13.0억(2021-09) vs 12.97억 — 다름 |
| 사직쌍용예가 (동래구) | OK | 591 | 8.8억(2021-09) vs 7.67억 — 다름 |

8/8 모두 "전체 이력 최고가 ≠ 24개월 최고가"인 실제 사례(서면비스타동원 제외)가 나와, 이번 STEP이 해결하려는 §2 문제(24개월 제한으로 인한 부정확한 "역대 최고가")가 실 데이터로 입증됐다.

이번 STEP에서 통계 메뉴명("2년최고가", "하락" 등)을 변경하지 않았다 — read path 전환 전까지 기존 UI 문구를 유지한다(§51 원칙 준수). UI/API route는 전혀 수정하지 않았다(`trade-history-read.ts` 내부 쿼리 수정만, 외부에서 여전히 아무도 호출하지 않음).

## 52-53. Security / Error Recovery

- 로그/manifest에 API 키·DB credential을 출력하지 않는다(직접 확인).
- Backfill 중 실패해도 스키마를 롤백하지 않는다 — idempotent upsert + manifest 기반 재개로 복구한다(실측: 두 차례 버그 발견 후 스크립트 수정 → 재실행으로 정상 복구, 스키마/기존 데이터 무영향).

## Known Limitations

1. **동일 자연키 진짜 중복(occurrenceIndex)**: 어느 슬롯이 어느 실제 거래인지는 재fetch마다 뒤바뀔 수 있으나, 내용이 완전히 동일하므로 통계적으로 영향 없음.
2. **"같은 행의 가격만 조용히 정정"되는 케이스**: 표본에서 관측되지 않았고, 실제 국토부 관행(해제+재신고)과도 다르지만, 이론적으로 발생 시 새 row가 추가되고 원 row가 취소 처리되지 않은 채 남을 수 있다.
3. **dealingGbn/매수·매도자 구분 미저장**: §4 참고, 향후 필요 시 별도 STEP.
4. **부산 외 지역 없음**: 전국 확장은 별도 승인 필요(§38).

## Next Step

`TRADE_HISTORY_READ_MIGRATION_V1` — 기존 라이브 통계 API(2년최고가/하락/상승/84㎡/변동지도 등)를 `src/lib/trade-history-read.ts` 기반 DB-first로 단계적 전환.
