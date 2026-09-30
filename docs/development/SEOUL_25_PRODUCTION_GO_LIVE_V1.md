# SEOUL25 PRODUCTION GO-LIVE V1 (2026-09-30)

## 결과

**서울 25구 공개 beta LIVE.** 사용자 승인("서울25 Production 공개 승인")으로 신규 17구를 Production에 공개했다. 롤백 불필요.

| 항목 | 값 |
|---|---|
| 공개 시각 | 2026-09-30 04:45:09Z (13:45 KST) Production 배포 생성 |
| main | `377acf7` → `cd5706f` (fast-forward, 역사 재작성 없음) |
| 통합 | go-live 브랜치 `seoul-25-go-live-prep-v1` 그대로: `103f6fd` 공개 안전장치 · `cf44df6` 전월세 준비 중·미래 사용승인일 · `0a1a088` "총 0건" · `a91ad5b` QA 문서 · `cd5706f` 스위치 |
| 스위치 커밋 | `cd5706f feat(seoul25): enable public Seoul 25 beta` — `src/lib/region/enablement.ts` `SEOUL_17_PUBLIC_ENABLED = true` 한 줄 + 공개 전 상태를 고정하던 테스트 13개 갱신 |
| Production 배포 | `dpl_GxqQTbPSzoAHFfvQCZKn7hg9yorx` Ready · alias e-jip.com / www.e-jip.com |
| 이전 Production | `real-estate-ni24c7uf6` (377acf7) |

## 공개 범위 (서울 신규 17구)

| 축 | 상태 |
|---|---|
| 셀렉터·검색·지도·상세 | ON |
| DB 읽기(cronSync) | ON — 17구는 DB 전용, live MOLIT 관문 닫힘 |
| 전월세 | 준비 중("이 지역의 이 거래 유형은 아직 제공 준비 중입니다", MOLIT 호출 없음) |
| 리포트·통계·공급·SEO(색인)·sitemap | OFF(변경 없음) |
| "서울특별시 전체" | 계속 없음 |

런타임 축 개수(배포 코드 기준): app·search·cronSync 41(부산 16 + 서울 25) · report·stats·sitemap·seoIndex 16(부산) · supply 24(부산 16 + 서울 8, 변경 없음).

## 배포 전 검증 (실행한 명령)

| 명령 | 결과 |
|---|---|
| 지역·SEO·DB 정책·페이징·상세 출처 대상 테스트 | 공개 전 상태를 고정한 37건을 공개 상태로 갱신 후 통과 |
| 전체 src 테스트 | 2746 중 2739 pass · fail 2(기존 worktree CRLF: community-launch §15, recent-auth-parity §5) · skip 5 |
| scripts 테스트 | 650 중 648 pass · fail 1(BENCHMARK, DATABASE_URL 필요 — 기존) · skip 1 |
| `npx tsc --noEmit` | 21 errors 전부 `scripts/`(FAIL_EXISTING_SCRIPT_ERRORS), src 0 |
| eslint(변경 파일) | 0 |
| `npm run build` | PASS · 라우트 표 이전과 동일 |

## Production 스모크 (e-jip.com, 배포 직후)

| 항목 | 결과 |
|---|---|
| 셀렉터 | PASS — 서울 25구(중복 0·누락 0), "서울특별시 전체" 없음 · 375/390에서도 25/25 |
| 검색 | PASS — 왕십리 11200 · 상계주공 11350 · 우장산 11500 · 반포자이 11650 · 은마 11680 · 헬리오시티 11710 전부 자기 구, aptSeq↔구 불일치 0, aptSeq 없음 0 |
| 지도 | PASS — 6개 구 마커 144/274/433/408/375/328, 다른 구 0, aptSeq 없음 0(null 5행 계속 제외), 좌표 없음 0 · 타일·가격·마커 클릭(송파 예명 11710-39 선택) · 시트 상세보기 → aptSeq 포함 상세 |
| 상세 | PASS — 상계주공1 142건(2026-09-11) · 반포자이 48건(2026-09-08) · 은마 44건(2026-09-28) · 헬리오시티 184건(2026-08-30), 전부 `tradeDataSource=DB`·단일 aptSeq · 서버 HTML `noindex, nofollow`·canonical 없음 · 리포트 CTA 없음 |
| 전월세 | PASS — 은마: Hero "준비 중", 안내 문구, 타임라인 "전체 평형 · 준비 중", "요청 실패"·"조회 중"·2034 없음 |
| 닫힌 면 | PASS — 통계 랭킹 "준비 중", region-change 400, 리포트(단지·구) "리포트를 만들 수 없는 지역입니다"+noindex, 공급(강남) 구 제거·0행, sitemap 139개 중 17구 0 |
| 안내 문구 | PASS — 부산·서울 8구·17구(노원) 없음(3초·8초 모두), 경기(분당) 일반 문구 · 오래된 "부산 외 지역" 문구 없음 |
| 모바일 375/390 | PASS — 홈·셀렉터·지도(시트)·상세 2곳·전월세: 문서 가로 넘침 0, 오류 0, 작은 터치 목표 0 |
| 회귀 | 서울 8구(경희궁자이2단지 11110-2445 DB 23건·지도 정상) · 부산(센텀SKVIEW 26350-164 DB 52건·지도 정상) · 경기(검색 0·지도 안내 문구) — 없음 |
| 상태 코드 | 주요 페이지·API 14개 200(모르는 URL 404), 응답 0.1–0.6초 |

## MOLIT·DB·cron

- 17구 사용자 경로의 live MOLIT: 0(매매 DB, 전월세는 DB 전용 관문). 이번 스모크는 검색 결과로 확인한 aptSeq로만 상세를 열어 DB 미스 → MOLIT 폴백을 만들지 않았다.
- 상세 기본정보(건축물대장, data.go.kr) live 조회는 기존 전 지역 공통 동작 — 스모크 중 수 회.
- DB 스키마 변경 0 · 수동 데이터 쓰기 0 · cron 수동 실행 0 · `vercel.json`(cron 일정) 변경 없음 — 서울 17구 cron(seoul-b 19:45Z, seoul-c 20:00Z, recheck 23:45/00:00Z) 그대로.

## 롤백 (실행 안 함)

`src/lib/region/enablement.ts`의 `SEOUL_17_PUBLIC_ENABLED`를 `false`로 되돌리는 커밋 → main push → Production 배포. 데이터·cron·서울 8구·부산·경기 불변, DB 롤백 없음. 테스트는 이 커밋에서 갱신한 13개 파일을 함께 되돌린다(`git revert cd5706f`).

## 알려진 것 / 남은 일

- 이름만 있는 상세 URL(`/apt/은마`, lawdCd·aptSeq 없음)은 지역을 판정하지 않아 noindex가 붙지 않는다 — 공개 전과 같은 기존 동작(앱 안 링크는 항상 lawdCd·aptSeq 포함, sitemap 미포함). 별도 판단 필요
- 로컬 main 체크아웃(`D:\anti2\aaa\real-estate-app`)의 `main`은 84e1c61에 머물러 있다(사용자 작업 파일 보호로 건드리지 않음) — origin/main은 `cd5706f`
- 남은 보류: 17구 전월세 데이터셋 · 17구 공급 · 17구 리포트/통계 · 17구 SEO/sitemap · 17구 이집점수 산정
