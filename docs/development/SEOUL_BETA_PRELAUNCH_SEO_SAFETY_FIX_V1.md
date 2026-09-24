# SEOUL BETA PRE-LAUNCH SEO SAFETY FIX V1

- 일시: 2026-09-24 (KST) · 기준 커밋 `b43e788`
- 범위: 공개 차단된 서울 단지 화면의 **메타데이터만**. 데이터 게이트·enablement·sitemap 코드 변경 없음
- `SEOUL_BETA_ENABLED = false` 유지 · DB write 0 · migration 0 · cron 실행 0

## 1. 목적

`SEOUL_8_DISTRICT_FIRST_CRON_VERIFY_V1`에서 발견: 차단된 서울 단지 페이지가 HTTP 200 + 단지명 `<title>` + self canonical + robots 없음.
데이터는 나가지 않지만 검색엔진에는 색인 가능한 단지 페이지로 보인다. beta 공개 전에 닫는다.

## 2. 감사 결과(수정 전 Production)

| 화면 | 상태 | robots | title | canonical | 판정 |
|---|---|---|---|---|---|
| `/apt/[name]?lawdCd=11xxx…` | 200 | 없음 | 단지명 | 단지 self | **LEAK** |
| `/report/apt/11xxx-n` | 200 | 없음 | 단지명 | 단지 self | **LEAK** |
| `/stats/compare?a=11xxx-n&b=…` | 200 | noindex, follow | 단지명 vs 단지명 | 조합 URL | 색인은 안 되나 단지명 노출 |
| `/report/district/11xxx` | 200 | noindex, follow | 일반 | 없음 | 이미 안전 |
| `/report/dong/11xxx/동` | 200 | noindex, follow | 일반 | 없음 | 이미 안전 |
| `/report/city/seoul` | 404 | — | — | — | 이미 안전 |

## 3. 설계 결정

- 판정은 enablement 축에 위임(`src/lib/seo/seoul-blocked-seo.ts` `decideSeoulSeo`), 규칙을 새로 만들지 않는다.
  - 기능 축 닫힘 → `BLOCKED`: 일반 제목, `noindex, nofollow`, canonical 없음, 단지명 조회 안 함
  - 기능은 열렸지만 `seoIndex` 닫힘(beta ON 승인 8구 상세) → `NOINDEX`: 사용자용 제목 유지, `noindex, nofollow`, canonical 없음
  - 서울 아님 → `NONE`: 기존 그대로
- 404/`notFound()`는 쓰지 않았다 — beta를 켜면 같은 URL이 그대로 열려야 하고, 본문은 이미 정직한 "준비 중" 화면이다.
- 지역 판정은 쿼리 `lawdCd`와 aptSeq 앞 5자리로만 한다. 둘이 다른 구를 가리키면 덜 열린 쪽으로 판정. 이름으로 추측하지 않는다.

## 4. 구현

- `src/lib/seo/seoul-blocked-seo.ts` (신규)
- `src/app/apt/[name]/page.tsx` — BLOCKED/NOINDEX 분기
- `src/app/report/apt/[aptSeq]/page.tsx` — `report` 축 게이트를 master 조회보다 먼저
- `src/app/stats/compare/page.tsx` — 차단 서울 단지가 끼면 일반 제목 + `noindex, nofollow` + canonical `/stats/compare`
- `src/lib/seo/seoul-blocked-seo.test.ts` (신규, 11 tests)

## 5. beta 동작 표

| 대상 | beta OFF | beta ON |
|---|---|---|
| 승인 8구 상세 | BLOCKED | NOINDEX(열림, 색인 안 함) |
| 강남 11680 상세 | BLOCKED | BLOCKED |
| 나머지 17구 상세 | BLOCKED | BLOCKED |
| 서울 단지 리포트(25구) | BLOCKED | BLOCKED |
| 부산 | NONE(불변) | NONE(불변) |

## 6. Sitemap 138 → 140

2026-09-22 12:18 KST 스냅샷(`tmp/analytics-session-audit/sitemap-paths.txt`, 138)과 현재 live(140) 비교:
추가 2 · 삭제 0.

- `/report/dong/26440/강동동` — 부산 강서구. 스냅샷 시점 최근 1년 유효 거래 8건 → 09-23 부산 cron insert 7건으로 15건
- `/report/dong/26440/화전동` — 부산 강서구. 9건 → 09-23 부산 sale-sync insert 1건(2026-09-21 거래)으로 10건

동 URL은 `DONG_INDEX_MIN_TRADES_1Y = 10` 기준으로 매번 생성된다. **EXPECTED**, 서울 작업과 무관. 변경하지 않았다.
구성: 정적 5 + 부산시 1 + 구 16 + 동 117 + 커뮤니티 글 1 = 140. 서울 0.

## 7. 테스트 / 빌드

- `npx tsx --test src/lib/seo/seoul-blocked-seo.test.ts` 11/11
- `npx tsx --test "src/**/*.test.ts"` 2052/2052
- `npx tsc --noEmit` src 오류 0 · eslint(변경 파일) 0 · `npm run build` exit 0
- 로컬 `next start` 메타데이터 확인: 서울 상세/리포트/비교 = 일반 제목 + `noindex, nofollow` + canonical 없음(비교는 `/stats/compare`), 부산 상세/리포트/비교 불변

## 8. 알려진 한계

- 이름만 있는 상세 주소(`/apt/이름`, lawdCd·aptSeq 없음)는 지역을 알 수 없어 기존 동작 그대로다(canonical 없음, 본문은 `/api/apt` 게이트가 준비 중으로 응답). 이름으로 지역을 추측하면 부산 동명 단지를 잘못 noindex하게 된다. 이런 주소는 검색·지도·sitemap 어디에서도 서울로 링크되지 않는다.
- `/stats/compare`는 메타데이터만 닫았다. SSR 본문에 서울 단지명이 시드로 들어가는 동작(데이터 조회는 게이트됨)은 이번 범위 밖 — beta 전 별도 검토 권장.
- 지역/동 리포트의 `noindex, follow`는 이미 비색인이라 바꾸지 않았다.
