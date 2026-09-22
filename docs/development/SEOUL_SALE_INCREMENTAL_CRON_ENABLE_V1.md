# E-JIP SEOUL SALE INCREMENTAL CRON ENABLE V1

사용자 승인("승인")에 따라 서울 3구(종로 11110 · 중구 11140 · 용산 11170) 매매 증분 동기화 cron을 등록했다.
schema 0 · migration 0 · env 0 · `enablement.cronSync` 0 · 서울 공개(app/stats/SEO/sitemap/report/search) 0 · 강남 11680 제외.

## 전제 확인 (모두 충족 — `fa693e2`)

고정 목록 `SEOUL_SALE_SYNC_LAWDCDS = 11110·11140·11170` · sale-sync/sale-recheck `scope=seoul` · 잘못된 scope 400 · `/admin/ops` 매매 coverage 부산 16구 필터 · `enablement.ts` 09-19 이후 변경 없음(`'11'` 주석뿐).

## vercel.json — 기존 3개 그대로 + 서울 2개

| # | path | UTC | KST |
|---|---|---|---|
| 1 | `/api/cron/sale-sync?mode=apply` | `0 19 * * *` | 04:00 (부산, 변경 없음) |
| 2 | `/api/cron/rent-sync?mode=apply` | `0 21 * * *` | 06:00 (부산, 변경 없음) |
| 3 | `/api/cron/sale-recheck?mode=apply` | `0 23 * * *` | 08:00 (부산, 변경 없음) |
| 4 | `/api/cron/sale-sync?mode=apply&scope=seoul` | `15 19 * * *` | **04:15** (서울) |
| 5 | `/api/cron/sale-recheck?mode=apply&scope=seoul` | `15 23 * * *` | **08:15** (서울) |

서울 항목은 **뒤에** 둔다 — `/admin/ops`의 스케줄 표시(`findCronForRoute`)는 경로별 첫 항목을 고르므로 부산 표시가 그대로 유지된다(테스트로 고정).
서울은 부산과 **별도 호출**이다(부산 recheck가 45초 예산 중 ~42초 사용).

## 첫 실행 예상

- **04:15 KST 매매**: 3구 × 4개월(latestComplete−2 ~ 현재월) = 12셀 ≈ **12 MOLIT 호출**. 오늘 전체 이력을 새로 받았으므로 쓰기는 0 또는 소량(늦은 신고 insert · 해제 flip · 등기일 보충).
  완료월(현재월 제외) 9셀이 처음으로 `sync_coverage_cells`에 기록된다.
- **08:15 KST recheck**: 3구 × 10개월(3~12개월 전) = 최대 **30 호출** — 서울 coverage가 아직 없어 전부 never-verified로 먼저 처리된다. 로컬 dry-run 10.9초(예산 45초).
- 예상 호출: 서울 ≤ 42/일 → cron 합계 ≈ 270~310/일(한도 10,000의 약 3%).

## 첫 실행 확인 계획 (READ ONLY, 다음 날 08:30 KST 이후)

| 확인 | 방법 | 기대 |
|---|---|---|
| 호출 성공 | Vercel 로그 `[cron/sale-sync] SCOPE seoul lawdCds=11110,11140,11170` · `DONE sale status=…` / recheck 동일 | HTTP 200 · status SUCCESS · failed 0 · blocked 0 |
| 구 범위 | `sync_coverage_cells`에서 run_id가 `sale-2026-09-2…T19-15…` / `sale-recheck-…T23-15…`인 셀의 lawd_cd | 정확히 11110·11140·11170, 강남·기타 구 0 |
| 셀 수 | 같은 run_id의 셀 수 | 매매 9(완료월 3 × 3구) · recheck ≤ 30 |
| 쓰기 | `apartment_trade_histories`에서 lawd_cd 11110/11140/11170 · `created_at`/`updated_at`이 run 창 안 | insert·flip·등기일 보충 — 각 행을 원천과 대조 |
| 취소 무결성 | 세 구의 형제 그룹 전원 취소 수 · `known28`류 지표 | 그룹 개수 기준 원천 = DB |
| 부산 회귀 | 부산 매매·recheck run의 셀 수·소요 | 서울 추가 전과 같은 수준(매매 ~22초, recheck ~42초) |
| quota | 다음 quota 확인 시점의 remaining | 서울분 ≤ 42 |
| 비공개 유지 | `enablement.ts` · live sitemap | 서울 설정 전부 false · sitemap 서울 0 |

## 테스트

`npx tsx --test src/lib/sync/sale-sync-scope.test.ts` → 13/13(기존 9 + cron 집합 4: 부산 3개 불변·서울 2개 정확·중복 0 / 서울 scope가 허용 목록으로 해석·구 코드·강남 없음 /
04:15·08:15 KST 변환 / ops 스케줄 표시가 부산 항목). 관련 회귀 27개 파일 → **502/502**. `npx tsc --noEmit` src/ 0 · eslint 0 · build exit 0.
