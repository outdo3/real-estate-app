# SEOUL 25 PUBLIC BETA PREP V1

2026-09-27 KST. LOCAL 코드·테스트·Preview 준비만. Production DB write 0 · ANALYZE 0 · resume 0 · cron/env/배포/push 0 · 서울 17 공개 0.
브랜치 `seoul-25-public-beta-prep-v1`(worktree `.worktrees/seoul-25-public-beta-prep`, 기준 main `2343646`).
배경: 서울 17구 Production 적재는 PARTIAL/HOLD(`SEOUL_17_APPLY_RESUME_MODE_V1.md`, DB 상태 UNSTABLE). 이 STEP은 적재가 끝난 뒤 바로 열 수 있도록 코드만 준비한다.

## 1. 현재 공개 정책(변경 전 = Production)

| 지역 | app | search | map | detail | report | stats | seoIndex | sitemap | cronSync(DB-first 읽기) |
|---|---|---|---|---|---|---|---|---|---|
| 부산 16 (시도 층 `'26'`) | ON | ON | ON | ON | ON | ON | ON | ON | ON |
| 서울 공개 8 (시군구 allowlist) | ON | ON | ON | ON | OFF | OFF | OFF | OFF | ON |
| 서울 차단 17 | OFF | OFF | OFF | OFF | OFF | OFF | OFF | OFF | OFF |
| 경기 8 (`GYEONGGI_BETA_ENABLED=false`) | OFF | OFF | OFF | OFF | OFF | OFF | OFF | OFF | OFF |
| 그 밖·모르는 코드 | OFF | OFF | OFF | OFF | OFF | OFF | OFF | OFF | OFF |

- sitemap은 enablement와 별개로 `sitemap-scope`가 부산 16구·부산 동만 싣는다(단지 URL 없음) → 서울 URL 0.
- `cronSync`는 이름과 달리 상세·지도·통계 피드의 **DB-first 읽기** 스위치다. 정기 수집 범위는 `sale-sync-scope.ts`의 별도 목록(서울 8 · 경기 8 · 부산 기본).
- 서울 시도 층(`ENABLEMENT_BY_SIDO['11']`)은 없다 → 서울 전체 통계·피드·DB-first는 항상 거부.

## 2. 서울 25 beta 정책(준비 — Production OFF)

| 지역 | app | search | map | detail | report | stats | seoIndex | sitemap | cronSync |
|---|---|---|---|---|---|---|---|---|---|
| 서울 공개 8 | ON | ON | ON | ON | OFF | OFF | OFF | OFF | ON(기존) |
| 서울 17 — Preview 전용 | ON | ON | ON | ON | OFF | OFF | OFF | OFF | **OFF** |

- 17구 목록 `SEOUL_17_BETA_LAWDCDS`, 축 `SEOUL_17_PREVIEW_ENABLEMENT`. 서울 마스터 스위치(`SEOUL_BETA_ENABLED`)가 꺼지면 25구 전부 닫힘.
- 17구 cronSync OFF 이유: DB 적재 미완료(11380 일부 · 11560 등 0행) — DB-first로 읽으면 빈 DB가 "거래 0건"으로 보인다(데이터 진실 원칙 위반). Preview의 17구 상세·지도는 지금 비-DB-first 공개 지역과 같은 live MOLIT 경로(공개 게이트 뒤)를 탄다. **Production 공개 시점**(적재 + parity + cron 첫 실행 검증 뒤)에는 17구를 공개 8구와 같은 프로필(cronSync ON)로 옮긴다 — 별도 승인.

## 3. "서울특별시 전체" 가드

문제: 선택기가 `!isSidoPartiallyPublic(sido)`일 때만 "시도 전체"를 보였다. 25/25가 열리면 이 값이 false가 되어 "서울특별시 전체"가 되살아나고, 서버가 지원하지 않는 시도 단위 질의(`sidoCode=11`)를 보낸다.
수정: `isSidoWholeQuerySupported(sido)` — **시도 층에서 통째로 출시된 시도**(시도 단위 질의 경로가 있다)이고 공개 구가 있고 일부 공개가 아닐 때만 true. 지금은 부산만 true, 서울은 구가 몇 개 열려도 false. 선택기 버튼·핸들러 둘 다 이 판정으로 바꿨다.
회귀 테스트: 8구 부분 공개 → 없음 · 25구 공개(시뮬레이션 + 실제 Preview env) → 없음 · 부산 전체 유지 · 경기/모르는 시도 없음.

## 4. Preview 전용 스위치

```
SEOUL_25_BETA_PREVIEW_ENABLED = (NEXT_PUBLIC_VERCEL_ENV === 'preview') && (NEXT_PUBLIC_SEOUL_25_BETA_PREVIEW === 'true')
```

- 둘 다 빌드 시 리터럴로 인라인(`node_modules/next/dist/docs/01-app/02-guides/environment-variables.md`) → 클라이언트 선택기와 서버 라우트가 같은 값.
- 값이 없거나 다르면 닫힘(대소문자·공백 포함 12가지 테스트). Production 빌드는 `NEXT_PUBLIC_VERCEL_ENV=production`이라 플래그가 잘못 들어가도 열리지 않는다. 로컬·테스트 기본값 닫힘.
- **확인 필요**: 이 Vercel 프로젝트가 `NEXT_PUBLIC_VERCEL_ENV`를 노출하는지(시스템 환경변수 자동 노출 설정). 노출되지 않으면 Preview에서도 닫힌 채(= 8구)로 보인다 — 안전 쪽 실패.

## 5. 검색 · 지도 · 상세 (시뮬레이션·Preview env 테스트)

- 검색: `sggCd IN publicAllowedLawdCds('search')` 하나(단지·지역·오피스텔·별칭 fallback·주변 단지 모두 같은 축). 이름·시도 전체 fallback 없음. Preview allowlist = 부산 16 + 서울 25 = 41, 경기 0. 구 선택은 REGCODE 목록 + `app` 축 필터(대표 강남·서초·송파·노원·강서·관악·성북·은평 registry 이름 일치 확인).
- 지도: 닫힌 구는 MOLIT 전에 `regionUnsupported`. null 좌표 master는 마커 좌표 null(0,0·다른 단지·동명 다른 구 좌표 없음), 이름 포함 관계로 잡지 않음.
- 상세: 공개 게이트가 MOLIT·DB보다 먼저. DB-first는 aptSeq 구 코드의 cronSync(17구 Preview는 live). canonical 좌표 없으면 NO_COORDINATE(이름 재검색 없음). 점수는 입지 피처 없으면 부적격(지어내지 않음). info/education/score/facilities 전부 `detail` 축.
- 이번 STEP은 Production DB 상태(UNSTABLE) 때문에 실제 DB 조회·화면 확인을 하지 않았다 — Preview QA에서 확인.

## 6. 리포트 · 통계 · SEO · sitemap

- **수정(누수)**: 상세의 "한장 리포트" 카드와 비교의 비교 리포트 CTA가 `report` 축을 보지 않고 aptSeq만 있으면 떴다 → 서울(공개 8구 포함)에서 막힌 "준비 중" 리포트로 보냈다. `isReportRegionOpen(aptSeq)`(aptSeq 앞 5자리의 report 축)으로 CTA를 만들지 않게 했다. 부산 동작 불변. 공유·내보내기 canonical URL(`aptReportHref`)은 그대로.
- 리포트 페이지·비교 리포트 read는 이미 report 축으로 BLOCKED. 서울 25 상세 SEO = NOINDEX(canonical 없음), 리포트 = BLOCKED. sitemap 서울 0, 부산 경로 유지.
- 통계: `stats` 축 OFF → 통계 화면 "준비 중". **알려진 예외(기존 동작, 이번에 바꾸지 않음)**: `/api/stats/supply`(분양 원천)는 `isSeoulPublicBlocked(lawdCd)` 기본 축 `app`으로 판정해 공개 서울 구 단위 요청을 받는다 — 지금 8구에서 그렇고 Preview 17구에서도 같다. 구 단위이며 "서울 전체" 요청은 막혀 있다. `/stats/compare` 본문의 서울 단지명(noindex)도 기존 감사의 알려진 항목.

## 7. 학교 · 위치 (SCHOOL_SAFE_FOR_BETA = YES)

안전 = "틀린 데이터를 붙이지 않는다". 서울 대표 구 기준 확인:
- 부산 전용 통학구역 artifact는 부산 밖 동명 학교에 쓰지 않음(NEIS 코드 매칭만) · 공식 학교 매칭은 시군구 코드 정확 일치.
- 유치원 데이터 부산만 → 서울은 "준비 중"(없음이라 하지 않음) · 좌표 없으면 "확인 불가".
- 건축물대장 법정동: 구 코드 + 마지막 토큰 정확 일치(강남 신사동 ≠ 관악 신사동 · "사동" 부분 문자열 불가).
- info/facilities 캐시는 lawdCd로 좁히고 다른 지역 행을 덮지 않음.
한계(정직): 서울은 통학구역·유치원 데이터가 없어 교육 정보가 제한적이다 — "준비 중" 표시로 드러난다.

## 8. 좌표 · master UX

null 좌표 → 마커 없음 · canonical master가 있으면 상세 접근 가능 · 좌표 차용·이름 기반 대체 없음 · master 없는 과거 거래는 지도 항목을 만들지 않음. master 쓰기 0.

## 9. Cron 준비(적용 안 함)

`docs/development/patches/SEOUL_17_CRON_EXPANSION_V1.patch` — `git apply --check` 통과, **적용하지 않았다**. 추가만(기존 scope·cron 줄 삭제 없음):
- `seoul-b` 9구 11200·11260·11290·11305·11320·11350·11380·11470·11500 (sale 36 · recheck 90)
- `seoul-c` 8구 11530·11560·11590·11620·11650·11680·11710·11740 (sale 32 · recheck 80)
- 합계 ≤ 238 MOLIT/일(구당 sale 4 + recheck 10). vercel.json 4항목(UTC 19:45 · 20:00 sale, 23:45 · 00:00 recheck — Hobby는 그 시각의 1시간 안 실행).
- 전제: 17구 전체 이력 적재 + parity 통과. 부산·서울 8·경기 cron 불변(테스트).

## 10. 모바일 QA 체크리스트(Preview, 360 · 375 · 390px)

대표 구: 강남 · 노원 · 관악 · 은평 · 성북 (+ 기존 8구 1곳 · 부산 1곳 대조)

| 화면 | 확인 |
|---|---|
| 홈 · 지역 선택 | 시도 목록에 서울 · 서울 → **25구 전부**, "서울특별시 전체" **없음** · 부산 → "부산광역시 전체" 있음 · 25개 버튼 그리드 줄바꿈·잘림·가로 스크롤 없음 · 긴 이름(동대문구·서대문구·영등포구) 잘림 없음 · 닫기/뒤로 버튼 터치 영역 |
| 검색 | 대표 구 단지명 검색 결과 노출 · 결과 카드 구 이름 정확 · 경기 단지 0 · 카드 텍스트 잘림 없음 |
| 지도 | 대표 구 선택 시 마커 표시(좌표 있는 단지만) · 0,0/바다 마커 없음 · 다른 구 마커 섞임 없음 · 지도 컨트롤이 하단 탭과 겹치지 않음 · "지원 준비 중" 상태가 대표 구에서 사라짐 · 17구 live MOLIT 지연 체감 기록 |
| 상세 | 실거래 표시(live) · "한장 리포트" 카드 **없음** · 비교 → 비교 리포트 CTA **없음** · 교육 "준비 중" 문구 · 점수 부족 시 정직한 표시 · 평형 라벨 가짜 없음 · 하단 CTA 겹침 없음 · `<meta name="robots" content="noindex,nofollow">` |
| 미지원 상태 | 경기 단지 직접 URL → 준비 중 · `/report/apt/11680-…` → 준비 중 + noindex · 통계 → 서울 준비 중 |
| 공통 | 가로 overflow 0 · 라벨 잘림 0 · 하단 네비 겹침 0 · 콘솔 오류 |

## 11. Preview 배포 판단 — 배포하지 않음(READY_FOR_PREVIEW_DEPLOY)

배포하지 않은 이유(모호함 있음):
1. push 금지(이 STEP 조건) — Vercel Preview는 브랜치 push로 만들어진다.
2. Preview 환경은 Production과 같은 DB를 읽을 가능성이 높다(읽기 전용이지만 현재 DB UNSTABLE).
3. Preview의 17구 지도·상세는 live MOLIT를 호출한다(쿼터 사용).
4. `NEXT_PUBLIC_VERCEL_ENV` 노출 여부 미확인.

배포 절차(승인 후):
1. Vercel → Environment Variables → `NEXT_PUBLIC_SEOUL_25_BETA_PREVIEW=true`를 **Preview 환경에만**(가능하면 이 브랜치 한정) 추가. Production에는 넣지 않는다.
2. `seoul-25-public-beta-prep-v1` push → Preview URL(main 머지·Production 배포 아님).
3. Preview에서 서울 → 25구가 보이는지로 스위치 동작 확인(8구만 보이면 `NEXT_PUBLIC_VERCEL_ENV` 미노출 → 중단·보고).
4. §10 체크리스트. DB가 UNSTABLE이면 QA 보류.
5. Production 공개는 17구 적재·parity·cron 검증 뒤 별도 STEP(17구를 8구 프로필로 이동 + cron patch 적용).

## 12. 테스트

| 명령 | 결과 |
|---|---|
| `npx tsx --test src/lib/region/seoul-25-beta-prep.test.ts src/lib/region/seoul-25-preview-on.test.ts` | 17/17 (Production 설정 13 · 실제 Preview env 4) |
| region · report · decision-journey 스위트 | 374 pass · 0 fail · 5 skipped(기존) |
| src 전체 | 2,149 · 2,142 pass · 2 fail · 5 skipped — 2 fail은 `community-launch.test.ts` CRLF 고정 폭 검사(새 worktree, 미변경 파일 — 이전 STEP들과 동일) |
| scripts 전체 | 433 · 431 pass · 1 fail · 1 skipped — `score-v2-step4b/benchmark.test.ts`(DATABASE_URL 없음, 무관) |
| eslint 변경 파일 | exit 0(경고 2 = apt-client 748·772 기존 eslint-disable, 변경 줄 아님) |
| `npx tsc --noEmit` | 21 기존 scripts 오류, 변경 파일 0 → FAIL_EXISTING_SCRIPT_ERRORS |
| `npm run build` | exit 0 |

기존 소스 고정 테스트 2개(`seoul-leak-close` §14 · `apt-report-cta-flow` 4)는 새 가드 형태로 갱신(더 강한 조건).
