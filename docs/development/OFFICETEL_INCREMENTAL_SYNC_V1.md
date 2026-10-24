# OFFICETEL INCREMENTAL SYNC V1

- 상태: **구현 완료 · Production 미적용** (코드/마이그레이션 파일/테스트/문서만. Production DB write 0, backfill 0, cron 실행 0, env 변경 0, deploy 0)
- branch: `feat/nearby-officetel-api-v1`
- 선행 진단: OFFICETEL LATEST UPDATE INCIDENT V1 / V1.1

---

## 1. 문제와 원인

오피스텔 데이터가 2026-09-04 이후 갱신되지 않았다. V1.1 읽기 전용 조사로 확정한 사실:

| 항목 | 값 (Production, 읽기 전용 조회) |
| --- | --- |
| 매매/전월세 `sourceFetchedAt` 최댓값 | 2026-09-04 17:07 / 17:28 UTC — 행 전부가 단일 값 |
| `created_at` | 314,965행 전부 2026-09-05 (= STEP 3A NDJSON 행 수) |
| 최신 거래일 | 매매 2026-09-02, 전월세 2026-09-03 |
| 202609 / 202610 | DB: 매매 6건 · 전세 25 · 월세 70 / 0건. MOLIT: 해운대+부산진 두 구만 202609 매매 86·전월세 662건 |
| 16개 구 | 전부 동시에 멈춤 |
| MOLIT API | HTTP 200 · resultCode 000 · 필드 변화 없음 · 2026-10-23까지 데이터 존재 |

**원인: OFFICETEL_INCREMENTAL_SYNC_NOT_IMPLEMENTED.** 오피스텔에는 증분 sync도 cron도 한 번도 만들어진 적이 없다.
유일한 유입 경로는 STEP 3B(최초 backfill 전용, 스윕 파일 mtime을 `sourceFetchedAt`에 기록, "cron/스케줄러를 만들지 않는다"고 명시)였다.
부차 원인: 취소·정정을 다시 확인하는 sweep이 없어 적재된 취소 상태가 2026-09-04 스냅샷이다.

### 이전 STEP과의 관계 (섞지 않는다)

| STEP | 역할 | 이 작업과의 관계 |
| --- | --- | --- |
| 3A | 이력 backfill dry-run / 용량 감사 (읽기 전용, MOLIT 7,304회) | 행 형태·자연키·취소 분포의 근거. NDJSON은 main checkout에만 있다(읽기 참조만) |
| 3B | 최초 적재 (NDJSON -> `createMany`) | 정규화 규칙의 기준. **수정하지 않았다.** 증분 sync는 같은 규칙을 따른다 |
| 5B | 좌표 backfill | 무관. 이 작업은 master 좌표를 건드리지 않는다 |
| **증분 V1 (이 문서)** | 3B 이후의 달을 계속 따라잡는 정기 수집 | 신규 |

---

## 2. 설계

### 2.1 셀 상태 저장 방식 결정

**신규 테이블 `officetel_sync_cells` (additive).** 아파트 `sync_coverage_cells`의 `SyncDataset`에 `OFFICETEL_*`를 추가하는 안은 채택하지 않았다.

| 비교 | enum 추가 (`SyncDataset`) | 신규 테이블 (채택) |
| --- | --- | --- |
| 아파트 영향 | `sync_coverage_cells`를 읽는 파일이 15개(리포트·통계·admin ops·rent verified range·recheck core). dataset 필터가 대부분 있어도 누락/exhaustive switch 시 아파트 coverage 판정에 오피스텔 셀이 섞일 위험 | 없음 (아파트 코드가 참조하지 않음) |
| 마이그레이션 | `ALTER TYPE ... ADD VALUE` — Postgres는 값 삭제 불가(롤백 불가) | `CREATE TYPE/TABLE` 3개 enum + 1개 테이블 |
| lock | enum 값 추가는 짧지만 되돌릴 수 없음 | 새 객체만 생성, 기존 테이블 lock 없음 |
| 롤백 | 사실상 불가 | `DROP TABLE officetel_sync_cells; DROP TYPE ...` |
| 필요한 정보 | 실패 사유·unresolved 수·마지막 시도 vs 마지막 검증을 담을 칼럼 없음 | 담을 수 있음 |

파일 로그만 쓰는 안은 Vercel 함수 파일시스템이 durable하지 않아(아파트 Phase 2 감사에서 실측) 채택하지 않았다.

마이그레이션: `prisma/migrations/20261024100000_officetel_sync_cells/migration.sql` (`prisma migrate diff`로 생성, 새 enum 3개 + 새 테이블 1개만 포함).
**어떤 DB에도 적용하지 않았다.**

### 2.2 데이터셋 · 셀

- 데이터셋: `OFFICETEL_SALE`(RTMSDataSvcOffiTrade) · `OFFICETEL_RENT`(RTMSDataSvcOffiRent). 매매와 전월세는 원천 API·테이블·취소 의미가 달라 별도 라우트로 돈다.
- 셀 = 데이터셋 × 구(lawdCd) × 계약월(YYYYMM). 대상은 부산 16개 구.
- 평시 증분 대상 월: 현재월 + 직전월(KST 달력월). 매매 32셀 · 전월세 32셀. `lookback`은 1–3으로 조절 가능.
- 셀 상태: `COMPLETE` / `PARTIAL` / `INVALID` + 실패 사유 `API_ERROR` / `TIMEOUT` / `QUOTA` / `PARSE_ERROR` / `DB_ERROR` / `PARTIAL_PAGINATION`.
  - **정상 0건 = COMPLETE + `source_total_count=0`**. 실패는 `source_total_count`가 null이거나 PARTIAL이다. 둘은 절대 같은 값이 되지 않는다.
  - 마지막 시도(`status`, `attempted_at`)와 마지막 검증 성공(`verified_at`)을 분리 저장한다. 실패한 시도가 이전 검증 시각을 지우지 않는다.

### 2.3 코드 구조 (`src/lib/officetel/sync/`)

| 파일 | 역할 |
| --- | --- |
| `molit-fetch.ts` | 셀 단위 fetch: 페이지네이션 · totalCount · resultCode · 타임아웃 · 깨진 응답 · rate/quota 분류. 정상 0건과 실패 분리 |
| `normalize.ts` | 원천 행 -> 적재 행. `identity.ts` · `natural-key.ts`를 호출(복제 없음). STEP 3B 규칙과 동일 |
| `cell-sync.ts` | 한 셀: fetch -> 정규화 -> 기존 행과 자연키 대조 -> insert / 매매 취소 반영 -> 셀 상태 기록 |
| `run.ts` | 한 실행의 셀 순회: 시간 예산 · quota 예약분 · least-recently-verified-first · 상태 기록 실패 시 정지 |
| `db.ts` | Prisma 구현(클라이언트를 인자로 받음) |
| `months.ts` | KST 달력월 · 증분 월 · 재확인 band · 부산 16구 |
| `cron-handler.ts` | 라우트 3개 공용: 인증 · 파라미터 검증 · 기본 dry-run · 응답 |
| `catchup-guard.ts` | catch-up CLI 인자 검증과 apply 가드 |

**아파트 sync 프레임워크에서 재사용한 것(복사 아님)**: `TimeBudget` · `RunStopReason` · `SyncRunStatus` · `httpStatusForRun` · `orderRecheckCellsByStaleness`(shared.ts), `planRequestAttempt` · `hasRoomForCell`(run-deadline.ts), `molitQuotaDecision`(molit-quota-guard.ts), `isAuthorizedCronRequest`(cron-auth.ts).
**재사용하지 않은 것과 이유**: `sale-sync-core` 등 아파트 core는 `aptSeq` identity · `Apartment*` 테이블 · `SyncDataset` enum에 묶여 있고, 오피스텔은 `canonicalKey` identity와 별도 테이블을 쓴다. 셀 단위 로직만 따로 두었다.
**`api-molit.ts`의 `fetchMolitData`를 쓰지 않은 이유**: 화면용 가공 결과라 `cdealType` · `slerGbn` · `useRRRight` 등 적재 필드가 없고 오피스텔 전월세 endpoint도 없다. STEP 3A가 검증한 원본 행 형태(파서 `parseTagValue:false`, `numOfRows=1000`)를 그대로 쓴다.

### 2.4 쓰기 원칙

- 삭제하지 않는다 (`delete`/`deleteMany`/raw SQL 쓰기 없음 — 테스트가 소스를 검사한다).
- insert는 자연키 기준 `createMany({ skipDuplicates: true })` — 멱등. 이미 있는 행은 건드리지 않는다.
- 갱신은 **매매 취소 반영 하나뿐**: `dealCanceled=true` · `cancelDate` · `sourceFetchedAt`. `where dealCanceled=false` 조건으로 한 번만 반영된다.
  - 원천의 취소 행 수 > (DB 취소 행 수 + 이번에 insert하는 취소 행 수)일 때만 그 차이만큼 기존 비취소 행을 갱신한다(occurrenceIndex 낮은 순).
  - TYPE B(정상 + 취소 사본)는 새 occurrence insert로 들어온다.
  - 원천이 취소를 **더 적게** 말해도 되돌리지 않는다(`cancelRestorePending`으로 보고만). 오피스텔은 등기일자가 없어 아파트처럼 검증할 수 없다(취소 신뢰도 LIMITED).
  - 원천에서 사라진 행도 지우지 않는다(`dbOnlyRows`로 보고만).
- 전월세는 원천에 취소 필드가 없으므로 insert만 한다. 같은 sweep을 억지로 만들지 않았다.
- 부분 실패 셀(페이지 누락 · 한도 · 시간 초과)은 **아무것도 쓰지 않는다**. 일부 페이지로는 취소 대조가 틀린다.
- 깨진 행 하나가 그 구·월 전체를 막지 않도록, 깨진 행만 제외하고(`invalidRowCount`) 나머지를 적재한다. 그 셀은 COMPLETE가 아니라 PARTIAL(PARSE_ERROR)이다. 셀 월과 행 월이 어긋나면 INVALID(아무것도 쓰지 않음, STEP 3B와 동일).

### 2.5 `sourceFetchedAt`

실제 외부 API 수집 시각(셀 수집 직후의 `clock()`)을 기록한다. STEP 3B의 스윕 파일 mtime 방식은 쓰지 않는다.
`/api/officetel/nearby`의 freshness는 `sourceFetchedAt` 최댓값을 그대로 쓰므로 **nearby 코드는 수정하지 않았다**.

한계(알려진 문제): 이미 있는 행은 `sourceFetchedAt`을 갱신하지 않는다. 그래서 신규 거래가 한 건도 없는 날이 45일 이상 이어지면 sync가 정상이어도 STALE로 보인다. 부산 오피스텔은 하루 수십~수백 건이 들어와 사실상 발생하지 않지만, 필요하면 후속으로 nearby freshness를 `officetel_sync_cells.verified_at`(COMPLETE 셀의 마지막 검증 시각)과 결합할 수 있다. 이번 변경은 읽기 경로를 새 테이블에 의존시키지 않기 위해(마이그레이션 적용 전에도 nearby가 동작해야 하므로) 보류했다.

### 2.6 unresolved master

master에 연결하지 못한 행(주소 그룹 master 없음 / 다수)도 버리지 않는다. `officetel_master_id = NULL`로 적재하고(STEP 3B와 동일) 셀 기록의 `unresolved_count`로 센다(이번에 신규 적재된 행 기준). 개별 거래 원문은 로그에 남기지 않는다(구·월·건수만).

---

## 3. Cron

### 3.1 라우트 (구현됨)

| 라우트 | 데이터셋 | 대상 |
| --- | --- | --- |
| `/api/cron/officetel-sale-sync` | OFFICETEL_SALE | 부산 16구 × (현재월, 직전월) = 32셀 |
| `/api/cron/officetel-rent-sync` | OFFICETEL_RENT | 32셀 |
| `/api/cron/officetel-sale-recheck` | OFFICETEL_SALE | 부산 16구 × (현재월-2 … 현재월-12) = 176셀을 least-recently-verified-first로 예산 안에서 |

- 인증: `Authorization: Bearer $CRON_SECRET` (아파트 cron과 같은 `isAuthorizedCronRequest`, secret 미설정이면 무조건 거부).
- 기본 `dry-run`. 쓰려면 `?mode=apply` 명시. `lawdCd`(허용 16구 목록 밖이면 400) · `lookback`(1–3) · `minBack`/`maxBack`(재확인 band) 파라미터.
- `maxDuration = 60`. 작업 예산 50s(재확인 45s), 요청 단위 deadline 전파.
- 성공이 아니면 200으로 감추지 않는다(207/500).

### 3.2 스케줄 계획 (**vercel.json에는 아직 넣지 않았다**)

| 라우트 | UTC schedule | KST |
| --- | --- | --- |
| officetel-sale-sync | `0 1 * * *` | 매일 10:00 |
| officetel-rent-sync | `15 1 * * *` | 매일 10:15 |
| officetel-sale-recheck | `30 1 * * 0` | 일요일 10:30 |

- 기존 아파트 cron은 UTC 19:00–20:00 · 21:00 · 23:00–00:00에 몰려 있다. 위 시각은 겹치지 않는다(테스트로 강제). Hobby는 ±59분 window이므로 간격은 "겹침 최소화"이지 순서 보장이 아니다.
- **Vercel 한도 검증**: 현재 cron 11개 + 3개 = 14개. Hobby 개수 제한은 100개이고 실제 제약은 "하루 1회 + ±59분"(`CHANGELOG.md` Phase 2 기록)이다. 세 항목 모두 일 1회 이하이므로 한도 안이다. 통합 dispatcher는 필요 없다.
- 등록하지 않은 이유: 마이그레이션 적용 + catch-up 전에 cron이 먼저 돌면 셀 상태 테이블이 없어 apply가 시작 전에 중단된다. 활성화는 §6의 마지막 단계다.

### 3.3 API 호출량 / 시간

| 실행 | 셀 | MOLIT 요청(대략) | 소요(추정 0.8–1.5s/셀) |
| --- | --- | --- | --- |
| 매매 증분 | 32 | ≈ 35 (구·월당 1페이지) | 26–48s |
| 전월세 증분 | 32 | ≈ 35 | 26–48s |
| 매매 재확인(한 번) | 예산 안에서 ≈ 30–55 | ≈ 30–55 | 45s 예산 |
| catch-up (202609~202610) | 64 | ≈ 70 | CLI, 시간 한도 없음 |

- 하루 증분 총 ≈ 70요청. 아파트 cron의 일일 사용량 대비 작고, `molit-quota-guard`의 예약분(2,000) 가드를 그대로 쓴다.
- **주의**: 느린 밤에는 32셀이 50s 예산을 넘을 수 있다. 그 경우 `PARTIAL_RUN`으로 멈추고 남은 셀은 **다음 실행에서 가장 먼저** 처리된다(staleness 정렬). 반복되면 `lawdCd`로 라우트를 둘로 나누거나 증분 대상을 줄인다.

### 3.4 재확인(recheck) 정책

- 범위: 현재월-2 ~ 현재월-12. 증분이 덮는 달 바로 바깥이라 겹침도 틈도 없다(테스트 강제). 아파트 SALE_CANCELLATION_COVERAGE_V1의 실측(취소 지연 p90 3.1개월 · p99 11.8개월)과 같은 기준이다.
- 176셀을 한 번에 읽으면 60s를 넘으므로 least-recently-verified-first + 독립 예산으로 회전한다. 주 1회 ≈ 30–55셀 → 전체 한 바퀴 3–6주. 취소의 대부분(p50 0.7개월)은 매일 도는 증분이 덮는다. 더 빠른 회전이 필요하면 주 2회로 올리거나 `maxBack`을 줄인다(승인 후 조정).
- 전월세는 취소 필드가 없어 recheck 대상이 아니다.

---

## 4. 1회성 catch-up

`scripts/officetel/incremental-catchup.ts` — 202609 ~ 현재월을 같은 sync core로 따라잡는다. **작성만 했고 실행하지 않았다.**

- 기본 **dry-run**: MOLIT를 GET으로 읽고 DB를 읽기만 한다(쓰기 0, 셀 상태 기록도 없음). 마이그레이션 전에도 돈다.
- `--apply`는 단독으로 동작하지 않는다: `--confirm=WRITE_PRODUCTION_OFFICETEL_HISTORY` **그리고** 범위 명시(`--lawd=26350[,..]` 또는 `--all-districts`)가 모두 있어야 한다. 마이그레이션이 없으면 쓰기 전에 중단한다.
- 범위 제한: 현재월 이후 금지 · 최대 12개월 · 24개월 이내.
- 기본 범위 202609–202610 × 16구 × 매매+전월세 = 64셀 + 페이지네이션. 예상 신규 행: 매매 수백, 전월세 수천 건(해운대·부산진 두 구만 202609+202610에 매매 128 · 전월세 1,048건이 MOLIT에 있음을 읽기 전용으로 확인).

---

## 5. 실패 상태 처리 요약

| 상황 | 셀 상태 | 쓰기 | 다음 실행 |
| --- | --- | --- | --- |
| 정상 응답, 0건 | COMPLETE (total=0) | 없음 | 정상 |
| 정상 응답, N건 | COMPLETE | insert + 취소 반영 | 정상 |
| HTTP 5xx / resultCode 오류 | PARTIAL (API_ERROR), total=null | 없음 | 재시도 |
| 응답 깨짐 / totalCount 없음 | PARTIAL (PARSE_ERROR) | 없음 | 재시도 |
| 타임아웃 | PARTIAL (TIMEOUT) | 없음 | 재시도 |
| 일일 한도 초과 | PARTIAL (QUOTA) | 없음 | 내일 |
| 일부 페이지 실패 | PARTIAL (PARTIAL_PAGINATION) | 없음 | 재시도 |
| 일부 행 파싱 불가 | PARTIAL (PARSE_ERROR), invalid_row_count | 유효 행만 insert | 매번 표시 |
| 셀 월 불일치 | INVALID (PARSE_ERROR) | 없음 | 재시도 |
| DB 오류 | PARTIAL (DB_ERROR) | 일부 가능(멱등) | 이어서 맞춤 |
| 실행 시간/예약분 도달 | **기록하지 않음**(원천 판정 아님) | 없음 | 가장 먼저 |
| 셀 상태 기록 실패 | 실행 정지 (FAILED) | 이미 커밋된 데이터는 멱등 | 재실행 |

---

## 6. Production 적용 순서 (승인 필요, 아직 하나도 하지 않았다)

0. 이 branch 검토 / main 반영 승인 (main push는 Vercel Production 배포를 유발할 수 있다)
1. **마이그레이션 적용** `20261024100000_officetel_sync_cells` (additive, 새 테이블/enum만) — 별도 승인
2. 코드 배포 (라우트는 vercel.json 미등록이라 호출되지 않음)
3. **전체 dry-run**: `npx tsx scripts/officetel/incremental-catchup.ts` — 쓰기 0, 계획 수치 확인
4. **대표 1개 구 apply**: `--apply --confirm=WRITE_PRODUCTION_OFFICETEL_HISTORY --lawd=26350`
5. **읽기 전용 검증**: 행 수 증가분이 dry-run 계획과 일치 · 최신 거래일 · `source_fetched_at` · `unresolved_count` · 자연키 중복 0 · 기존 314,965행 불변
6. **16구 apply**: `--all-districts`
7. 최신성 확인: `GET /api/officetel/nearby`의 freshness가 CURRENT
8. **cron 활성화**: `OFFICETEL_CRON_PLAN` 3개 항목을 `vercel.json`에 추가하고 배포 → 첫 자연 실행의 `officetel_sync_cells`와 로그 확인

## 7. 롤백

- 코드/cron: 해당 커밋 revert(히스토리 보존) 또는 vercel.json 항목 제거. cron을 끄면 sync가 멈출 뿐 기존 데이터는 그대로다.
- 마이그레이션: `DROP TABLE officetel_sync_cells; DROP TYPE "OfficetelSyncFailureReason", "OfficetelSyncCellStatus", "OfficetelSyncDataset";` (다른 테이블에 의존하지 않음. 아파트 테이블 영향 없음)
- 적재된 행: sync가 넣은 행은 `source_fetched_at > 2026-09-05`이고 `created_at`이 첫 apply 이후다. 되돌려야 하면 그 구간을 지정한 **별도 승인된** 삭제로만 한다(이 작업의 코드는 삭제하지 않는다). 취소 갱신은 `source_fetched_at`이 실행 시각인 `deal_canceled=true` 행으로 식별된다.

## 8. 검증 결과 (실제 실행)

| 항목 | 명령 | 결과 |
| --- | --- | --- |
| 증분 sync 테스트 | `npx tsx --test src/lib/officetel/sync/sync.test.ts` | 30/30 pass |
| 기존 오피스텔 테스트 | `npx tsx --test src/lib/officetel/*.test.*` (nearby-contract 포함) | 112/112 pass |
| 아파트 sync 테스트 (회귀) | `npx tsx --test src/lib/sync/*.test.ts` | 88/88 pass |
| Prisma validate | `prisma validate` (더미 DATABASE_URL) | valid |
| Prisma migrate diff | `prisma migrate diff --script` | 새 enum 3 + 새 테이블 1만 생성 |
| TypeScript | `npx tsc --noEmit` | 24 errors — **전부 기존 `scripts/**` 오류**(decimal.js 미설치 등). `src/**`와 신규 `scripts/officetel/incremental-catchup.ts`는 0 (`FAIL_EXISTING_SCRIPT_ERRORS`) |
| lint | `eslint src/lib/officetel/sync src/app/api/cron/officetel-* scripts/officetel/incremental-catchup.ts` | exit 0 |
| build | `npm run build` | exit 0 (라우트 3개 빌드 확인) |

실제 DB 쓰기 경로(`db.ts`)는 타입체크와 소스 검사만 했고 **DB에 대해 실행하지 않았다**(메모리 대역으로 core를 검증). 이 점은 §6의 대표 1개 구 apply가 첫 실증이다.

## 9. 알려진 문제 / 후속 권고 (이번 범위 밖)

- 신규 거래가 장기간 없을 때의 freshness: §2.5 참조.
- 전월세 정정(같은 계약의 금액 수정)은 새 자연키 행으로 보이므로 이전 행이 남는다. 원천이 정정 필드를 주지 않아 구분할 수 없다.
- 12개월 초과 지연 취소(3A가 93건 식별)는 recheck band 밖이다. 필요하면 `maxBack`을 늘려 일회성으로 훑는다.
- 서울/경기 오피스텔은 이 작업의 범위가 아니다(master가 부산 5,056건뿐).
- 셀 상태 대시보드(admin ops 연동)는 만들지 않았다. SQL로 조회한다.

### 운영 조회 예시 (읽기 전용)

```sql
-- 최근 실행의 셀 상태 요약
SELECT dataset, status, failure_reason, count(*) FROM officetel_sync_cells
WHERE attempted_at > now() - interval '2 days' GROUP BY 1,2,3 ORDER BY 1,2,3;
-- 오래 검증되지 않은 셀
SELECT dataset, lawd_cd, deal_ymd, verified_at FROM officetel_sync_cells ORDER BY verified_at NULLS FIRST LIMIT 20;
```

## 첫 Production apply 결과 — 수영구 26500 (2026-10-24)

- 대상: 수영구 26500, 202609~202610, 매매+전월세. 승인 범위 밖 구/기간/cron/배포는 실행하지 않았다.
- 사전: migration `20261024100000_officetel_sync_cells` 적용 완료(25개, 미완료 0), 기준 건수 master 5,056 / 매매 88,674 / 전월세 226,291 / sync cell 0.
- 실행: `incremental-catchup.ts --apply --confirm=<token> --lawd=26500 --from=202609 --to=202610` 1회. exit 0, 두 run 모두 SUCCESS.

| 구분 | API | insert | 중복 | 미연결 master | invalid |
| --- | --- | --- | --- | --- | --- |
| 매매 | 29 (202609=23, 202610=6) | 29 | 0 | 1 | 0 |
| 전월세 | 232 (202609=145, 202610=87) | 226 (전세 39, 월세 187) | 6 (기존) | 4 | 0 |

- 취소: 취소 상태로 신규 insert 1건(cancel_date 있음). 기존 row 취소 update 0, restore pending 0.
- sync cell 4개 모두 COMPLETE, failure_reason 없음.
- 실제 증가량은 dry-run 예상(매매 29 / 전월세 226)과 정확히 일치.
- 신규 row의 source_fetched_at은 이번 수집 시각(2026-10-24)이다. 기존 6행은 수정되지 않았다(updated_at=created_at).
- 수영구 최신 거래일: 매매 2026-08-31 -> 2026-10-20, 전월세 2026-09-03 -> 2026-10-23.
- natural key 중복 0. master 잘못 연결 0(연결된 행은 sgg/umd 모두 일치).
- 범위 밖: 다른 15개 구 건수 변화 0, master 변화 0, 통계 카운터상 쓰기는 거래 2테이블과 sync cell 테이블뿐.
- 다음: 부산 16구 apply 승인 요청. cron 등록(`vercel.json`)은 그 이후.
