# E-JIP SEOUL SALE BACKFILL DRIVER V1

서울 아파트 매매 full-history backfill **driver**(코드 + dry-run). Production write 0 · schema 0 · enable 0.
**apply는 BLOCKED_FOR_APPLY** — Defect A 선결 전까지 코드 게이트(`DEFECT_A_GATE_PASS=1`)가 막는다.

- 날짜: 2026-09-19 (KST) · 기준 커밋 `68d8223`
- 선행: `SEOUL_SALE_BACKFILL_PLAN_V1.md`

## 1. 파일

| 파일 | 내용 |
|---|---|
| `scripts/backfill-seoul-sale.ts` (신규) | driver — 수집·정규화·master 분류·계획·checkpoint·산출물·(향후) apply |
| `scripts/backfill-seoul-sale-logic.ts` (신규) | 순수 판정 — 범위, apply 게이트, quota, master 분류(aptSeq만), 셀 상태, 기존 행 drift |
| `scripts/backfill-seoul-sale.test.ts` (신규) | 19개(요구 1~22) |
| `src/lib/sync/sale-sync-core.ts` | ① `syncOneSaleCell`의 쓰기 계획을 순수 함수 `planSaleCellWrites`로 **그대로** 떼어냄(동작 불변) ② 기존 행 조회에 `dealDate` 월 범위 추가(index 사용) |
| `scripts/sale-molit-fetch.ts` | `x-ratelimit-remaining` 관측값 기록(`saleQuotaObserved`, 읽기만 — fetch 동작 불변) |

## 2. 사용법

```
# dry-run(기본, 쓰기 0 — 쓰기 객체도 만들지 않음)
ALLOW_PROD_DB_READ=1 npx tsx scripts/backfill-seoul-sale.ts --district=11140 --from=2025-10 --to=2026-09

# 옵션
--out=<dir>                 산출물·checkpoint 폴더(기본 tmp/seoul-sale-backfill-run)
--reserve-calls=2000        x-ratelimit-remaining이 이 값 이하면 checkpoint 후 정지(Production 몫 보호)
--max-calls=N               이번 실행 MOLIT 호출 상한
--refetch                   checkpoint 무시하고 다시 수집

# 향후 apply(지금은 막힘)
ALLOW_PROD_DB_READ=1 ALLOW_PROD_DB_WRITE=1 DEFECT_A_GATE_PASS=1 \
  npx tsx scripts/backfill-seoul-sale.ts --apply --district=11140 --from=2025-10 --to=2026-09 --expect-inserts=944 [--approve-existing-updates]
```

## 3. 규칙

| 항목 | 구현 |
|---|---|
| 원천 · 범위 | MOLIT `RTMSDataSvcAptTradeDev`, 구+연월 셀. 범위 2005-07(실측 최초 달) ~ 실행 시점 KST 달. 서울 25구만 |
| paging | totalCount까지 전 페이지(`fetchSaleCell`), 수집 = totalCount일 때만 COMPLETE. HTTP·파싱·타임아웃·결과코드·초당 제한 소진은 PARTIAL/ERROR — 빈 목록으로 취급 안 함. 운영과 같은 파서(`createMolitXmlParser`) |
| 부분 셀 | PARTIAL 셀은 계획·적재 0, `paging-errors.json` 기록. 셀 단위 보류(같은 구 다른 COMPLETE 셀은 진행) — 쓰기 판정이 셀 단위(구+연월)이고 자연키 충돌이 셀 간 0(계획 §6)이라 섞이지 않는다 |
| checkpoint | `checkpoints/<구>.json`의 연월별 상태 PENDING → FETCHED → VALIDATED → READY → APPLIED / PARTIAL / BLOCKED. 원천 셀은 `raw/<구>/<연월>.json.gz`에 저장해 재실행 시 재수집 없이 **현재 DB에 대해 다시 계획** |
| master | aptSeq 정확 일치만: EXACT_MASTER / MASTER_MISSING / INVALID_APTSEQ / REVIEW_REQUIRED(조회 구 ≠ aptSeq 구). 이름·지번 추정 없음 |
| MASTER_MISSING | `master-missing.json`으로 분리. 매핑·master 생성 없음(과거 단지 master는 별도 STEP). 거래 행 자체는 aptSeq 그대로 insert 계획에 포함(부산과 동일 — 거래 테이블은 master를 요구하지 않음) |
| 자연키 | `(group_key, 금액, 계약일, 층, occurrenceIndex)` — 같은 조건 복수 거래 보존(날짜·금액·층·면적 dedupe 없음) |
| 취소 · insert | 운영과 **같은 함수**: dry-run은 `planSaleCellWrites`, apply는 `syncOneSaleCell(..., 'apply')`. 원천 > DB는 count 기반 insert, 원천 = DB는 count 기반 reconcile, 원천 < DB는 삭제 없음(Defect B 보류). 원천 순서는 진실로 쓰지 않음 |
| 초기 backfill vs 재동기화 | 같은 판정 안에서 분리: DB 형제 0 → 원천 그대로 insert(초기), DB 형제 있음 → count 기반 reconcile(재동기화). 원천에 없는 행은 만들지 않는다 |
| BLOCKED 셀 | 계획에 review 후보·insert 대조 불가·취소 대조 불가(원천 < DB 등)가 있으면 적재 보류 |
| 기존 행 변경 | 취소 flip·restore·등기일 보충은 `existing-state-drift.json` — apply에 `--approve-existing-updates` 필요 |

## 4. Apply 게이트 (전부 필요)

`--apply` · `ALLOW_PROD_DB_READ=1` · `ALLOW_PROD_DB_WRITE=1` · **`DEFECT_A_GATE_PASS=1`** · `--district` · `--from` · `--to`(서울 전체 one-shot 불가) · 범위 전 셀 READY · `--expect-inserts` = dry-run 계획 insert 수 · (기존 행 변경이 있으면) `--approve-existing-updates`. 하나라도 빠지면 사유를 `summary.json`에 남기고 쓰기 없이 종료. 통과 시 셀마다 운영 `syncOneSaleCell` apply를 부르고, 결과(insert·flip 수)가 dry-run 계획과 다르면 그 셀을 BLOCKED로 두고 정지(이미 끝난 셀은 유지, rollback 없음). BACKFILL prod 가드도 다시 확인한다.

Defect A 해제 조건: ① 2026-09-20 부산 cron 검증 PASS ② false-cancel 28행 repair 결정 ③ insert-path fix 안정 — 확인 전에는 `DEFECT_A_GATE_PASS`를 설정하지 않는다.

## 5. Quota · 초당 제한

- 수집마다 `x-ratelimit-remaining` 관측, `--reserve-calls` 이하 또는 `--max-calls` 도달 시 checkpoint 후 정지(`quota-status.json`).
- 초당 제한: 동시 1 · 350ms 간격 · 429/초당 제한은 최대 4회 재시도(1·2·4·8초), 타임아웃·5xx 최대 2회 — 소진되면 셀 PARTIAL(무한 재시도 없음).
- apply 경로(`syncOneSaleCell` → `fetchSaleRegionMonth`)도 헤더를 `saleQuotaObserved`에 기록해 같은 예약 정지를 적용한다.

## 6. 기존 행 조회 성능(schema 변경 없음)

`syncOneSaleCell`의 기존 행 조회 `where { lawdCd, dealYmd }`는 `(lawd_cd, deal_ymd)` index가 없어 그 구의 전체 이력을 index scan 후 필터했다. `dealDate` 월 범위를 추가해 `(lawd_cd, deal_date)` index 범위로만 읽는다. **deal_ymd = deal_date의 연월**이 전 행(865,421)에서 성립(불일치 0 실측)하므로 결과 동일.

| 셀 | 이전 | 이후 |
|---|---|---|
| 부산진구 2025-09 (371행) | 실행 2,605ms · 필터 제거 100,360행 | **0.49ms** · 제거 0 |
| 해운대구 2025-09 (491행) | 3,164ms · 제거 130,142행 | **1.21ms** · 제거 0 |
| 강남구 2026-08 (46행) | 0.20ms | 0.08ms |

Prisma 왕복(warm): 56~103ms → 21~49ms. 서울 대형 구(전체 이력 ~15만 행)도 적재 뒤 같은 효과.

## 7. Dry-run 결과 (Production READ ONLY)

| 범위 | 셀 | 원천 | 활성/취소 | master | 계획 insert | 기존 일치 | 기존 행 변경 | 호출 | 시간 |
|---|---|---|---|---|---|---|---|---|---|
| **중구 2025-10~2026-09** | 12 READY | **944** | 889 / 55 | EXACT 944 | **944** | 0 | 0 | 12 | 4.1s |
| 강남구 2025-10~2026-09 | 12 READY | 2,744 | 2,585 / 159 | EXACT 2,744 | 2,698 | 46 | 6 | 12 | 4.1s |
| 노원구 2006-11 | 1 READY(4쪽) | 3,141 | 3,141 / 0 | EXACT 3,085 · MISSING 56(12 aptSeq) | 3,141 | 0 | 0 | 4 | 1.8s |

- 중구 944 = 계획 단계 측정값과 같음.
- 노원 2006-11: totalCount 3,141 = 수집 3,141(4쪽), 같은 조건 복수 거래 23그룹·51행 보존.
- 재실행(중구, 같은 폴더): MOLIT 0회, 요약 동일(멱등).

### 기존 46행(강남 2026-08)

46/46 자연키 일치 → insert 0(SKIP). 기존 행 변경 6건(`gangnam-12m/existing-state-drift.json`), 전부 apply 시 `--approve-existing-updates` 필요:

| id | 종류 | 계약일 | 금액(만원) | 층 | 변경 |
|---|---|---|---|---|---|
| 940441 | CANCEL_FLIP | 2026-08-14 | 186,000 | 8 | dealCanceled false → true (해제 26.09.12) |
| 940456 | CANCEL_FLIP | 2026-08-07 | 250,000 | 3 | dealCanceled false → true (해제 26.09.08) |
| 940421 | REGISTRY_SUPPLEMENT | 2026-08-24 | 98,500 | 1 | registryDate NULL → 26.09.09 |
| 940422 | REGISTRY_SUPPLEMENT | 2026-08-20 | 685,000 | 9 | registryDate NULL → 26.09.08 |
| 940439 | REGISTRY_SUPPLEMENT | 2026-08-04 | 132,000 | 2 | registryDate NULL → 26.09.02 |
| 940453 | REGISTRY_SUPPLEMENT | 2026-08-07 | 212,000 | 8 | registryDate NULL → 26.08.27 |

계획 단계의 "취소 drift 2건"에 더해, 적재 뒤 원천에 등기일이 생긴 4건이 새로 나왔다(등기일 보충은 운영 규칙상 형제 전원 동일할 때만 — 모두 형제 1건).

## 8. 산출물

`tmp/seoul-sale-backfill-run/<run>/`: summary · district-month-status · ready-inserts · existing-skipped · existing-state-drift · master-missing · review-required · cancellation-summary · paging-errors · quota-status (+ checkpoints/ · raw/). 실행 폴더: `jung-12m/` · `gangnam-12m/` · `nowon-200611/` · `lookup-perf.json`.

## 9. 테스트

`scripts/backfill-seoul-sale.test.ts` 19개로 요구 1~22: 다중 페이지 · COMPLETE=수집·totalCount · 오류≠빈 결과 · aptSeq 정확 매핑 · MASTER_MISSING 분리 · 같은 조건 복수 거래 보존 · occurrenceIndex 결정성 · 원천 순서 무관 · 원천>DB · 원천=DB · 원천<DB 삭제 없음 · 기존 일치 SKIP · 기존 취소 drift · 월 범위 조회 · checkpoint 재개 · quota 예약 정지 · 429 제한 재시도 · dry-run 쓰기 0 · Defect A 게이트 · 범위 필수 · 파일럿 형태 · 멱등 재실행/계획 불일치 정지.
운영 sync 통합 테스트(`cancel-insert-path-sync`, `cancel-reconcile-integration`)는 refactor 후 그대로 통과.

```
npx tsx --test "scripts/*.test.ts" "scripts/*.test.mjs"   pass 236  fail 0
npx tsx --test "src/**/*.test.ts" "src/**/*.test.mjs"     pass 2321 fail 0
npx eslint (변경 5파일)                                     exit 0
npx tsc --noEmit                                          변경 파일 0 · src 0 · 기존 25건 → FAIL_EXISTING_SCRIPT_ERRORS
npm run build                                             exit 0
```

## 10. No-write

Production INSERT 0 · UPDATE 0 · DELETE 0 · schema 0 · migration 0 · 서울 stats/cronSync/SEO enable 0 · 부산 변경 0(fingerprint `98dd4a45…`, 서울 매매 46 · 부산 매매 865,289 그대로). MOLIT 매매 GET 28회.

## 11. 배포 보류

이 변경은 운영 cron 코드(`sale-sync-core.ts`)를 포함한다. 동작은 같지만(테스트·불변식 확인), **2026-09-20 04:00 KST cron이 Defect A insert-path fix(`03abea9`)의 검증 실행**이므로, 검증 대상 코드를 그 직전에 바꾸지 않도록 **커밋만 하고 push(=Vercel 배포)는 검증 뒤로 보류**했다.

## 12. 다음

1. 2026-09-20 cron 검증 → PASS면 이 커밋 push(배포) · 28행 repair 결정.
2. 남은 7개 구 규모 실측(다음 quota 창, 계획 도구) — driver dry-run으로 대체 가능.
3. Defect A 해제 후 중구 파일럿 apply 승인: `--expect-inserts=944`, 기존 행 변경 0.
