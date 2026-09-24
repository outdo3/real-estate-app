# SEOUL 8-DISTRICT FIRST CRON VERIFY V1

- 일시: 2026-09-24 (KST) · 검증 시각 DB `NOW()` = 2026-09-24T10:57Z
- 성격: **READ-ONLY 검증.** Production DB write 0 · cron 수동 실행 0 · MOLIT 호출 0 · flag 변경 0 · schema 변경 0
- 기준 커밋: `b43e788` (HEAD = origin/main, Vercel status `success` 2026-09-23T05:25Z — 두 cron 실행 이전에 배포 완료)
- 스크립트: `scripts/audit-seoul-8district-cron-verify.ts` (`SET TRANSACTION READ ONLY`), 노출 확인은 e-jip.com GET 요청만

## 결론

`SEOUL_8_DISTRICT_CRON_VERIFY = PASS` · `SEOUL_MOBILE_BETA_LAUNCH = GO` (launch 자체는 이 STEP에서 하지 않았다)

## 1. 기대값(코드에서 도출)

- `latestCompleteMonth`는 UTC 기준 전월 → 실행 시점(09-23 UTC) `202608`.
- sale-sync 범위 = `latestComplete-2 .. 현재월` = 202606..202609 → 8구 × 4개월 = **32셀 처리**, coverage는 현재월 제외 **24셀** (`sale-sync-core.ts` §15).
- sale-recheck band = `latestComplete-12 .. latestComplete-3` = 202508..202605 → 8구 × 10개월 = **80셀**. 실행 전 never-verified = Phase C 5구 × 10 = **50셀**.
- 예산: sale 50s(셀당 추정 2.5s), recheck 45s.

## 2. sale-sync (run `sale-2026-09-23T20-14-30-898Z`)

- 시작 2026-09-23T20:14:30.898Z (05:14 KST, Hobby 1시간 창 안) · coverage 기록 20:14:42.530Z → 약 11.6s
- 24/24 coverage 셀 COMPLETE, 8구 × 202606..202608, fetched == source_total (truncation 0), blocked 0
- 마지막 셀(11545/202609)까지 insert 흔적이 있어 32/32 처리 — BUDGET_STOP 없음
- insert 31(현재월 29 + 202608 2), cancellation flip 0, registry 보충 37행

## 3. sale-recheck (run `sale-recheck-2026-09-23T23-46-18-921Z`)

- 시작 23:46:18.921Z (08:46 KST) · coverage 기록 23:46:47.778Z → 약 28.9s (예산 45s 이내)
- **80/80 band 전체 처리(sweepComplete)**, 전부 COMPLETE, fetched 13,552 == source_total, insert 0, flip 0, registry 보충 14행
- 순서: Phase C 5구 행 갱신 23:46:20–24Z → 기존 3구 23:46:37–40Z. `orderRecheckCellsByStaleness`가 never-verified 셀을 먼저 처리함을 확인

## 4. 구별 결과

| 구 | lawdCd | sale 셀 | recheck 셀 | coverage(총) | insert | registry 보충 | 취소 수(불변) |
|---|---|---|---|---|---|---|---|
| 종로 | 11110 | 3 | 10 | 13 | 0 | 2+4 | 190 |
| 중구 | 11140 | 3 | 10 | 13 | 3 | 2+1 | 339 |
| 용산 | 11170 | 3 | 10 | 13 | 0 | 2+1 | 400 |
| 광진 | 11215 | 3 | 10 | 13 | 6 | 2+1 | 394 |
| 동대문 | 11230 | 3 | 10 | 13 | 6 | 11+5 | 862 |
| 서대문 | 11410 | 3 | 10 | 13 | 6 | 5+0 | 575 |
| 마포 | 11440 | 3 | 10 | 13 | 3 | 7+1 | 663 |
| 금천 | 11545 | 3 | 10 | 13 | 7 | 6+1 | 252 |

모든 구 coverage 202508..202608 13셀, 비검증 상태 0, 최신 검증 2026-09-23T23:46:47.778Z.

## 5. 데이터 무결성

- Phase C 행 수 205,015 = apply 204,987 + cron insert 28 (정확히 일치)
- 서울 합계 260,157 = Phase A/B 55,142(09-22 cron 포함) + Phase C 205,015
- 취소 수: 종로/중구/용산 190/339/400, Phase C 합 2,746 — 모두 기준선과 동일 → flip 0, restore 0
- 창 안 갱신 51행 전부 `deal_canceled=false`, `cancel_date=null`, registry_date(26.09.xx) 보충 — coverage `updated_count`(flip 전용) 0과 일치
- 강남 11680 46행, 마지막 write 2026-08-31 — 불변. 서울 8구 외 coverage 셀 0
- 삭제 경로 없음(sync core에 delete 없음), error_logs 최근 2일 0건

## 6. 부산 회귀

- 부산 sale-sync 19:59:32Z–19:59:54Z 48셀/16구 COMPLETE, recheck 23:29:18Z–23:30:00Z 121셀(예산 회전)
- 부산 write 마지막 시각 19:59:54Z / 23:29:58Z — 서울 run(20:14:30–42Z, 23:46:18–47Z)과 시간상 겹침 없음
- 서울 run 셀에 부산 lawdCd 0, 부산 run 셀에 서울 lawdCd 0, 서울·부산 외 지역 최근 3일 write 0
- 참고: 이 스크립트의 `kst_day` 버킷은 naive UTC 컬럼에 `AT TIME ZONE`을 한 번만 적용해 날짜 라벨이 어긋날 수 있다. 판정은 UTC 타임스탬프로 했다.

## 7. 공개 노출(Production GET)

- `SEOUL_BETA_ENABLED = false` (배포 커밋 `b43e788` 소스)
- `/api/search` 은마·남산타운·광화문스페이스본·상암월드컵파크·세곡푸르지오 → 모두 빈 결과, 해운대 → 26350 23건(부산 정상)
- `/api/apt/[name]` 11440·11110·11680·11545 → `UNSUPPORTED_REGION`, trades 0
- `/report/apt/{11440-136, 11110-2203, 11680-4090}` → "리포트를 만들 수 없는 지역" 화면, 데이터 없음 · `/report/district/11440·11680` 동일 · `/report/city/seoul` 404
- `/api/stats/supply` 서울·마포·강남 → `UNSUPPORTED` · 부산 해운대 → OK
- `sitemap.xml` 140 URL 중 서울 0
- 지역 선택: `RegionSelectModal`이 `isSeoulPublicBlocked`로 필터(배포 코드 기준, 브라우저 확인은 안 함)

## 8. 쿼터 / 실행 시간

- MOLIT 호출(추정, 재시도 제외): 서울 sale 32 + recheck 80 = **112**. 셀당 최대 source 551건 < 1000/page라 셀당 1페이지
- 남은 일일 쿼터: 읽지 않음(1-call probe를 쓰지 않음)
- Vercel 함수 로그는 읽지 않았다 — 실행 상태는 coverage 셀 + 행 타임스탬프로 판정

## 알려진 문제 / 관찰

- 차단된 서울 `/report/apt/*` 페이지가 HTTP 200에 단지명이 들어간 `<title>`을 내고 `noindex`가 없다. sitemap에는 없고 데이터도 없지만, beta 전에 noindex 또는 404 처리를 검토할 만하다(이번 범위 밖).

## 다음 STEP

- 서울 모바일 beta launch switch (별도 승인 STEP)
