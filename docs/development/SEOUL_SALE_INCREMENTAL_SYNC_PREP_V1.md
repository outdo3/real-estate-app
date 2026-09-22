# E-JIP SEOUL SALE INCREMENTAL SYNC PREP V1

**판정: READY_FOR_CRON_APPROVAL.** `vercel.json` 변경 0 · Production write 0 · schema/env 0 · `cronSync` 변경 0 · 서울 공개 변경 0.

## 구현

- `src/lib/sync/sale-sync-scope.ts` — 서울 동기화 고정 목록 `SEOUL_SALE_SYNC_LAWDCDS = 11110 · 11140 · 11170`(강남 11680 제외: 2026-08 한 달 46행뿐)과
  허용 목록 해석기 `resolveSaleSyncScope`: `scope` 생략 → `undefined`(코어 기본값 `BUSAN_LAWDCD_16` 그대로) · `scope=seoul` → 고정 3구 · 그 밖(빈 문자열 포함) → 거부. enablement를 읽지 않는다.
- `sale-sync`·`sale-recheck` 라우트: 인증 → scope 해석 → 잘못된 scope는 **400**(DB/MOLIT 전) → `lawdCds`를 코어에 전달. 응답에 `scope`, 로그에 `SCOPE …` 한 줄. `lawdCd` 파라미터는 읽지 않는다.
- 쓰기 경로는 그대로 `syncOneSaleCell`(신규 insert · 그룹 단위 취소 reconcile · 형제 수 불일치 skip · registry 보충 · 삭제 없음 · master 생성 없음). 서울 전용 로직 없음.
- `/admin/ops`: `summarizeCoverage('SALE', BUSAN_16)` · `summarizeSaleRunKinds(BUSAN_16)` — 부산 운영 지표를 부산 16구로 고정(`sync-coverage.ts`에 선택적 `lawdCds` 필터). 현재 서울 coverage 셀은 0개라 지금 화면 값은 그대로다.
- 부수 수정: 직전 STEP(`b042f8a`)에서 행동 분석 라우트의 부분 실패 콜백 이름을 `onMetricError(metricKey, e)`로 지어 `log-admin-failure.test.ts` §E(오류 경로 식별)가 실패하고 있었다 — 그 STEP에서 이 테스트 파일을 돌리지 않아 놓쳤다. 대시보드와 같은 `noteMetricFailure(key, e)`로 맞췄다(동작 동일).

## 수동 dry-run (로컬 → Production DB·MOLIT, `mode=dry-run`, 2026-09-22 15:51 KST)

로컬에 `CRON_SECRET`이 없어 라우트 대신 코어를 해석기 결과 그대로 호출했다(라우트 배선은 테스트가 실제 핸들러로 검증).

| | sale-sync scope=seoul | sale-recheck scope=seoul |
|---|---|---|
| 구 | 11110 · 11140 · 11170 (강남 없음) | 동일 |
| 창 | 202606 ~ 202609 (**4개월**, latestComplete 202608) | 202508 ~ 202605 (3~12개월 전 **10개월**) |
| 셀 | **12** (3 × 4) 전부 COMPLETE | **30** (3 × 10, 전부 never-verified) · sweepComplete |
| MOLIT 호출 | 12 (최대 셀 81행 — 2페이지 필요 없음) | 30 (최대 셀 166행) |
| 계획된 쓰기 | insert 0 · flip 0 · restore 0 · registry 0 · skip 0 · blocked 0 · failed 0 | insert 0 · flip 0 · registry 0 · blocked 0 · failed 0 |
| coverage 기록 | 0 (dry-run은 기록하지 않음) | 0 |
| 소요(로컬) | **4.1초** | **10.9초** |

오늘 전체 이력을 새로 받았으므로 쓰기 계획 0이 정상이다. 셀당 약 0.35초 — 부산 매매 run(64셀 22초)과 같은 수준.
Vercel 예산(sale 50초 · recheck 45초, maxDuration 60) 안에서 여유가 크다. 부산 recheck가 이미 45초 중 ~42초를 쓰므로 서울은 **별도 호출**이 전제다.

## 테스트

`npx tsx --test src/lib/sync/sale-sync-scope.test.ts` → 9/9 (A 생략=부산 16 · B 서울=정확히 3구·registry 서울 leaf · C 강남 없음 · D 잘못된 scope 거부 + **실제 라우트 핸들러 400**·인증이 먼저 ·
E lawdCd 파라미터 미사용 · F 두 라우트가 목록을 코어에 전달·같은 syncOneSaleCell · G ops 매매 coverage 부산 필터 · H 서울 enablement 전부 false·cronSync 미참조).
관련 회귀(sync·취소·coverage·ops·행동 분석·관리자 로깅 17개 파일) → **237/237**. `npx tsc --noEmit` src/ 0(전체 26 = 기존 scripts/tmp) · eslint 0 · build exit 0.

## 다음 — 승인 필요 (이번 STEP에서 하지 않음)

`vercel.json`에 서울 전용 호출 두 개(부산 호출과 분리):

```json
{ "path": "/api/cron/sale-sync?mode=apply&scope=seoul", "schedule": "15 19 * * *" },
{ "path": "/api/cron/sale-recheck?mode=apply&scope=seoul", "schedule": "15 23 * * *" }
```

= 매일 04:15 KST 매매 · 08:15 KST recheck. push = 배포이고 다음 날 04:15 KST부터 서울 행에 Production 쓰기가 시작된다.
켜기 전 Vercel 요금제의 cron 개수 한도(현재 3개 → 5개)를 확인한다. 예상 호출: 서울 ≤ 42/일(매매 12 + recheck ≤ 30) → cron 합계 ≈ 270~310/일(한도 10,000의 3% 남짓).
