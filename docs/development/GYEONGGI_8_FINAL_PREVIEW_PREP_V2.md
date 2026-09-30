# GYEONGGI8 FINAL PREVIEW PREP V2 — 현재 main 위에 다시 만든 경기 8구 공개 beta 준비 (2026-09-30)

## 목적

서울25 공개(main `4be3c02`) 뒤, 예전 경기 Preview 브랜치(`gyeonggi-8-public-beta-preview-v1` @ `567cd19`)의 유효한 부분만 현재 구조로 옮겨
경기 8구 Preview QA를 할 수 있게 한다. **Production 노출 변경 0**(스위치 false, Preview 스위치는 Preview env에서만).

## 작업 공간

- 새 worktree `.worktrees/gyeonggi8-final-prep`, 브랜치 `gyeonggi8-final-prep-v2`, 기반 `origin/main` `4be3c02`
- 사용자 로컬 main 체크아웃(`D:\anti2\aaa\real-estate-app`, 사용자 작업 파일 42개)은 건드리지 않음

## 예전 브랜치 감사 (`567cd19`, 공통 조상 `2343646`, 고유 커밋 5)

| 커밋 | 내용 | 판단 |
|---|---|---|
| `b7bc120` blocker prep | 학교 API 시/군/구 두 토큰("수원시 장안구") 해석 · 학원 동 토큰 · 지도 하단 "미지원 지역" 문구 · 리포트 CTA 게이트 · 상단 안내 | **학교·지도 하단 문구 이식**. 리포트 CTA(현재 `isReportRegionOpen`)와 상단 안내(현재 `UnsupportedRegionNotice`)는 서울25에서 이미 대체 → 이식 안 함 |
| `b52c6c8` Preview 스위치 | `NEXT_PUBLIC_GYEONGGI_8_BETA_PREVIEW` + VERCEL_ENV preview | **현재 구조로 재작성**(서울 17구 스위치 패턴과 같은 모양) |
| `4401d13` 공급 게이트 | 경기 공급 차단 | 이미 main(`84e1c61`) — 이식 불필요 |
| `611faa2`, `567cd19` | 문서 | 참고만 |

예전 테스트(`gyeonggi-8-preview-*`)는 서울 8구 기준 개수·옛 헬퍼를 가정해 **폐기**하고, `gyeonggi-8-final-prep.test.ts`로 현재 구조에 맞춰 새로 썼다.
`gyeonggi-beta-blockers.test.ts`는 유효한 항목(지도 하단 문구 · 수원/성남 일반구 분리 · 학교 해석기 · null 좌표)만 남겼다.

## 구현

| 파일 | 변경 |
|---|---|
| `src/lib/region/enablement.ts` | `resolveGyeonggi8PreviewFlag` / `GYEONGGI_8_BETA_PREVIEW_ENABLED`(Vercel Preview + `NEXT_PUBLIC_GYEONGGI_8_BETA_PREVIEW=true` 둘 다) · `GYEONGGI_8_OPEN` = Production 스위치 **또는** Preview 스위치 · 런타임 맵이 `GYEONGGI_8_OPEN`을 따름 · 경기 프로필 `cronSync: true`(열리면 DB-first) · `isDbOnlyLawdCd`에 경기 8구(열렸을 때) 추가 → live MOLIT 관문에서 닫힘. `GYEONGGI_BETA_ENABLED = false` 그대로 |
| `src/lib/neis-sido-codes.ts`, `src/app/api/school/*`, `src/app/school/school-client.tsx` | 학교 지역을 canonical lawdCd로 해석(수원 4구·성남 2구 분리, 분당 섞임 없음), 학원 동 토큰 |
| `src/lib/map/apt-map-notice.ts`, `src/app/map/page.tsx` | 서버 `regionUnsupported` 응답을 "표시할 아파트가 없습니다"(검증된 0건)가 아니라 "아직 지원하지 않는 지역"으로 말함(캐시에도 보존) |
| 테스트 | `gyeonggi-8-final-prep.test.ts`(11) 신규, `gyeonggi-beta-blockers.test.ts`(9) 정리 이식, 기존 3개 테스트를 새 구조에 맞춤, `transactions-read-state.test.mjs` 캐시 모양 |

Production 영향: 경기 스위치·Preview 스위치 모두 꺼진 빌드에서 경기 enablement는 이전과 같이 전 축 닫힘(테스트 4). 서울 25구·부산 enablement 불변(테스트 11). 라우트 표 동일.

## 경기 8구 공개 beta 기능 표

| 기능 | Preview(스위치 ON) | Production(현재) | 비고 |
|---|---|---|---|
| 셀렉터 | 8구만 · "경기도 전체" 없음 | 경기 숨김 | app 축 |
| 검색 | ON | OFF | allowlist(IN) |
| 지도 | ON(DB) | OFF(상단 안내 + 하단 "지원하지 않는 지역") | cronSync = DB-first |
| 상세 | ON(DB), noindex | OFF | |
| 전월세 | 준비 중(DB 미적재 0행, live MOLIT 없음) | OFF | DB 전용 관문 |
| 리포트 | OFF | OFF | |
| 통계 | OFF | OFF | |
| 공급(청약홈) | OFF | OFF | 84e1c61 게이트 유지 |
| SEO(색인) | OFF(noindex) | OFF | |
| sitemap | 없음 | 없음 | |
| 이집점수 | DECISION_REQUIRED | — | 경기 Score 피처 산정 여부 미결(표시 "데이터 부족" 예상) |
| Production 공개 | — | DECISION_REQUIRED | 별도 승인 |

## 읽기 전용 감사 (Production DB, `SET TRANSACTION READ ONLY`)

| 항목 | 결과 |
|---|---|
| Preview read-only 역할 `ejip_preview_ro` | SELECT 전용 22개 테이블(apartments·apartment_masters·apartment_trade_histories·apartment_rent_histories·apartment_unit_types·location/market features·officetel 3·schools·school_stats·kindergartens·childcares·presales·redevelopment·sync_coverage_cells 등), `default_transaction_read_only=on`, 연결 한도 15, RLS 우회 없음 — 검색·지도·상세·지역 판정에 필요한 테이블은 전부 있음, 사용자 테이블 없음 → **NEEDS_ENV_ONLY** |
| master | 1,193 · 좌표 1,174 · 좌표 없음 19(41113:4, 41131:2, 41133:2, 41150:7, 41210:4) · 41135 master 0 |
| 매매 이력 | 539,661 = 적재 539,443(2026-09-24) + cron 94(09-28) + 124(09-29) · 8구 · 200507–202609 · 취소 7,300 · 다른 구 aptSeq 0 · aptSeq 없음 0 · 자연키 중복 0 · 41135 행 0 |
| 전월세 | 8구 0행 |
| null 좌표 처리 | 마커 없음(0,0·다른 단지 좌표로 채우지 않음) — 테스트 `10·11`로 고정 → SAFE |
| cron | 자연 실행 확인: 매매 `sale-2026-09-29T20-02` 24셀(202606–08) 전부 COMPLETE +8/수정 1 · recheck `sale-recheck-2026-09-30T00-11` 80셀(202508–202605) 전부 COMPLETE · 202508–202608 월별 8/8 COMPLETE · 현재월 202609 행 적재(설계상 coverage 미기록) → **PASS** |

## QA 대상 (실제 DB, 최근 12개월 거래 최다 단지 · 전부 좌표 있음)

| 구 | 단지 | aptSeq | 동 | 12개월 거래 |
|---|---|---|---|---|
| 41111 수원 장안 | 화서역파크푸르지오 | 41111-2267 | 정자동 | 145 |
| 41113 수원 권선 | 수원하늘채더퍼스트2단지 | 41113-2569 | 곡반정동 | 205 |
| 41115 수원 팔달 | 매교역푸르지오SKVIEW | 41115-1905 | 매교동 | 349 |
| 41117 수원 영통 | 황골마을주공1 | 41117-65 | 영통동 | 281 |
| 41131 성남 수정 | 산성역포레스티아 | 41131-1652 | 신흥동 | 238 |
| 41133 성남 중원 | 은행주공 | 41133-7 | 은행동 | 133 |
| 41150 의정부 | 의정부역센트럴자이앤위브캐슬 | 41150-2703 | 의정부동 | 220 |
| 41210 광명 | 주공1 | 41210-13 | 하안동 | 258 |

## 테스트 (실행한 명령)

| 명령 | 결과 |
|---|---|
| 지역·학교·지도·공급·SEO 대상 | region 전체 통과, `gyeonggi-8-final-prep` 11/11, `gyeonggi-beta-blockers` 9/9, `transactions-read-state` 18/18 |
| 전체 src | 2766 중 2759 pass · fail 2(기존 worktree CRLF: community-launch §15, recent-auth-parity §5) · skip 5 |
| scripts | 650 중 648 pass · fail 1(BENCHMARK, DATABASE_URL 필요 — 기존) · skip 1 |
| `npx tsc --noEmit` | 21 errors 전부 `scripts/`, src 0 |
| eslint(변경 파일) | 0 |
| `npm run build` | PASS · 라우트 표 main과 동일 |

## 다음 단계 (승인 필요)

1. **브랜치 push**: `gyeonggi8-final-prep-v2` → 예전 Preview 브랜치 `gyeonggi-8-public-beta-preview-v1`에 이 트리를 그대로 복사한 fast-forward 커밋으로 올리는 방법 권장(그 브랜치에는 `NEXT_PUBLIC_GYEONGGI_8_BETA_PREVIEW=true`가 이미 branch-scoped로 있음). 새 브랜치 이름을 쓰면 플래그도 새로 필요.
2. **Preview env (ENV_CHANGE_APPROVAL)**: 그 브랜치에 `PREVIEW_DATABASE_URL`(기존 `ejip_preview_ro` 연결, 값은 Vercel에서 복사 — 로그·문서에 남기지 않음). 없으면 Preview DB 연결이 닫혀(fail-closed) QA 불가.
3. **Kakao JS SDK 도메인**: 경기 Preview 브랜치 alias(`real-estate-app-git-gyeonggi-8-public-beta-preview-v1-park11.vercel.app`)가 Kakao 콘솔에 등록돼 있어야 지도 QA 가능(사용자 작업).
4. **Preview 배포 (PREVIEW_DEPLOY_APPROVAL)** → 검색·지도·상세·전월세 준비 중·셀렉터 8구·모바일 375/390 QA(위 QA 대상). 존재하지 않는 단지명 등 DB 미스로 live MOLIT를 부르는 탐침 금지.
5. DB 권한 추가는 **불필요**(DB_GRANT_APPROVAL 불요).
6. 경기 Production 공개 결정(별도 승인): `GYEONGGI_BETA_ENABLED = true` 한 줄. 이집점수 표시 정책 결정 필요.
