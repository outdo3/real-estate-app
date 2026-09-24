# NATIONAL FIRST BATCH APPLY V1

- 일시: 2026-09-24 23:53 ~ 2026-09-25 01:01 KST (gate 통과 후 쓰기 00:05~01:01) · 1회 실행
- 승인 범위: 경기 8구 41111 · 41113 · 41115 · 41117 · 41131 · 41133 · 41150 · 41210 (41135 분당 제외·REVIEW 유지)
- 결과: **insert 539,443 · update 0 · delete 0** — 원천 ↔ DB PARITY_EXACT
- master seed 0 · cron 변경 0 · 공개 변경 0

## 1. 사전

- 기준 `3aaba51`. backfill/orchestrator 프로세스 0(별도의 멈춘 `npx tsx -e` 레지스트리 비교 셸은 DB·MOLIT·파일 쓰기 없음, 손대지 않음)
- **코드 결함 수정(apply 전)**: `runNationalApply`가 driver에 `quotaRemaining: () => null`을 넘겨 apply 중 예비분 정지(quotaDecision)가 꺼져 있었다 → `liveQuotaRemaining()`으로 교체 + 소스 테스트
- 9구 plan은 `plan-9districts-dryrun.json`으로 보존, `plan --strategy=manual`로 정확히 8구 plan 생성(창 2005-07~2026-09)
- 게이트 사전 점검(쓰기 플래그 없이, 캐시 재계획 MOLIT 0콜): 8구 전 셀 READY, 기존 UPDATE 0, review 0, **재계산 hash = dry-run 기록 hash(8/8 동일)**
- 사전 점검에서 승인 합계 539,143 ≠ 재계획 539,443 → **중단(HOLD)**. 구별 수치는 dry-run과 같고 합계만 산술 오류(300)임을 사용자가 확인, `--expect-inserts=539443`으로 재승인

## 2. apply

`ALLOW_PROD_DB_READ=1 ALLOW_PROD_DB_WRITE=1 DEFECT_A_GATE_PASS=1 orchestrator.ts apply --apply --district=<8구> --expect-inserts=539443 --plan-hash=<8구 hash> --reserve=2000` — `--approve-existing-updates` 없음.

| 구 | lawdCd | 원천 | insert | update | 취소 insert | flip | restore | 오류 | 상태 |
|---|---|---|---|---|---|---|---|---|---|
| 수원 장안구 | 41111 | 68,862 | 68,862 | 0 | 652 | 0 | 0 | 0 | APPLIED |
| 수원 권선구 | 41113 | 79,047 | 79,047 | 0 | 1,327 | 0 | 0 | 0 | APPLIED |
| 수원 팔달구 | 41115 | 38,932 | 38,932 | 0 | 532 | 0 | 0 | 0 | APPLIED |
| 수원 영통구 | 41117 | 111,466 | 111,466 | 0 | 1,434 | 0 | 0 | 0 | APPLIED |
| 성남 수정구 | 41131 | 19,268 | 19,268 | 0 | 305 | 0 | 0 | 0 | APPLIED |
| 성남 중원구 | 41133 | 28,900 | 28,900 | 0 | 387 | 0 | 0 | 0 | APPLIED |
| 의정부시 | 41150 | 115,675 | 115,675 | 0 | 1,555 | 0 | 0 | 0 | APPLIED |
| 광명시 | 41210 | 77,293 | 77,293 | 0 | 1,099 | 0 | 0 | 0 | APPLIED |
| 합계 | 8 | 539,443 | **539,443** | 0 | 7,291 | 0 | 0 | 0 | 2,040/2,040 셀 |

셀 불일치 정지 0(당월 202609 포함 재조회 결과가 계획과 전부 같았다), 자연키 skip 0.

## 3. 사후 검증(읽기 전용)

- **행 수**: 경기 0 → 539,443(구별 계획값과 정확히 일치). 41135 0행
- **원천 ↔ DB**(`audit-first-batch-parity.ts`): 8구 전부 PARITY_EXACT — 달별 행 수·자연키 다중집합·(자연키, 취소, 취소일) 다중집합 일치, 누락 0 · 초과 0 · 원천 밖 달 0 · DB 자연키 중복 0 · aptSeq 앞자리 불일치 0
- **취소**: 원천 7,291 = DB 7,291(= dry-run 9구 8,455 − 분당 1,164). flip 0 · restore 0 · delete 0
- **재계획 0**(`audit-first-batch-replan-zero.ts`, 복사본에서 APPLIED→FETCHED): pending 0 · matched 539,443 · update 0 · review 0 · MOLIT 시도 0 · 권위 checkpoint는 APPLIED 그대로
- **41135**: checkpoint·raw·review 파일 22:56(dry-run) 이후 변경 없음, REVIEW 4, 적용 기록 0
- **부산·서울**: 부산 865,753(취소 16,339) · 서울 260,157(3,676) · 대구 86 — 전/후 동일
- **노출**: sitemap 140(경기 0) · 검색에 41xxx 결과 0 · `stats/dashboard?lawdCd=41135` UNSUPPORTED · `src/`·`vercel.json` 변경 0 · coverage 셀(경기) 0
- **master**: 경기 master 0 · 8구 원천 aptSeq 1,324 전부 missing · 좌표 0

## 4. 기존 기능 영향

`/report/daily/2026-09-25`는 **WITHHELD_BACKFILL**("데이터 정리 작업이 포함되어 집계를 제공하지 않습니다")로 표시된다. 일별 리포트는 그날 새로 생긴 전 지역 행으로
대량 적재를 판정하도록 설계돼 있다(`detectBackfill`). 선례: 09-22(서울 Phase B 54,145행)·09-23(Phase C 204,992행)도 같은 상태. 부산 09-25 신규 거래 집계가 그날만 보류된다.

## 5. quota · 시간

- 게이트 입력: 관측 잔여 6,577(23:02 KST) − apply 계획 2,504 ≥ 예비 2,000
- 자정 KST에 일일 한도 재설정. 관측 잔여: 41113 후 9,744 → 41210 후 8,192
- 41115~41210 구간 사용 1,552 = 해당 6구 dry-run 페이지 1,551 + 1(외부) — apply 호출 = dry-run 페이지
- 41111·41113은 재설정 전후에 걸쳐 정확 분리 불가. 8구 합계 apply 호출은 dry-run 페이지(2,065)와 같다고 **추정**(셀 전부 계획과 일치 = 같은 페이지 수)
- 재시도: 불일치 정지 0, 수집 오류 0

## 6. CRON_EXPANSION_CANDIDATES (출력만, 변경 없음)

41111 · 41113 · 41115 · 41117 · 41131 · 41133 · 41150 · 41210 — 편입 전 master seed·cron 예산(8구 × 14셀/일 ≈ 112콜) 검토 필요.

## 7. 다음

GYEONGGI_MASTER_SEEDING_AUDIT (별도 STEP). 41135는 층 공란 4행 정책 결정 대기.
