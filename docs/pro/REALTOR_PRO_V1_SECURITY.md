# REALTOR PRO V1 — 보안 경계

이 문서는 Pro의 보안 경계 중 **코드 전체에 걸친 규칙**을 적는다. 기능별 세부(암호화·소유권·RLS)는
`REALTOR_PRO_V1_ARCHITECTURE.md`, 필드 분류는 `REALTOR_PRO_DATA_CLASSIFICATION.md`를 본다.

## 1. 브리핑 서드파티 경계 (REALTOR_PRO_BRIEFING_ADS_ISOLATION_V1, 2026-09-30)

### 왜

고객 브리핑 `/b/<token>`은 로그인 없이 열린다. **URL 자체가 열람 권한**이다. 광고·분석 스크립트는
`location.href`(page_location)를 읽어 자기 서버로 보내고, 일부는 화면 내용을 훑는다. 그러므로 토큰이 든
페이지에 서드파티 스크립트가 하나라도 실리면 토큰이 제3자 로그에 남는다. 리퍼러 차단만으로는 막을 수 없다
(스크립트는 리퍼러가 아니라 주소를 직접 읽는다).

### 변경 전 `/b/<token>`에 실리던 것

| 항목 | 출처 | 토큰 노출 경로 |
|---|---|---|
| AdSense 로더(+ 하위 요청 googleads.g.doubleclick.net · adtrafficquality.google · google.com) | 루트 layout `<head>` | 스크립트가 페이지 URL을 읽음 |
| GA4(gtag.js) — `NEXT_PUBLIC_GA_MEASUREMENT_ID`가 있을 때 | `AppProviders` → `GoogleAnalytics` | page_view의 page_location. 브리핑에서 다른 화면으로 옮기면 "유입 스냅샷"으로 브리핑 URL이 첫 page_view에 실릴 수 있었음 |
| 자체 방문 로그(`/api/log/view`·`heartbeat`) | `AppProviders` → `ViewTracker` | 토큰 경로가 자체 DB(PageView·실시간 접속)와 관리자 화면에 남음 |
| 위치 권한 요청 + Kakao 역지오코딩(dapi.kakao.com) | `RegionProvider` | 고객에게 위치 권한 팝업, 외부 호출(좌표) |

### 지금 규칙

판정은 `src/lib/privacy/private-routes.ts` 한 곳에서 한다.

| 경로 | 광고 | GA4 | 자체 방문 로그 | 위치 조회 | 응답 헤더 |
|---|---|---|---|---|---|
| `/b`, `/b/*` (토큰 경로) | 없음 | 없음 | 없음 | 없음 | CSP · `Referrer-Policy: no-referrer` · `X-Robots-Tag: noindex, nofollow, noarchive` |
| `/pro`, `/pro/*` | 없음 | 유지 | 유지 | 유지 | — |
| 그 밖의 공개 화면 | **유지(변경 없음)** | 유지 | 유지 | 유지 | — |

`/pro`에서 광고를 빼는 이유: 중개사 화면에는 고객 이름·조건과 **생성 직후의 브리핑 링크(토큰 포함)**가 표시된다.

2중 방어

1. 로더를 렌더하지 않는다: `AdSenseLoader`(루트 layout `<body>`)·`GoogleAnalytics`·`ga.ts` 런타임 게이트·`ViewTracker`·`RegionContext`가 같은 판정을 쓴다.
2. 브라우저가 거부한다: `next.config.ts`가 `/b`·`/b/*`에 CSP를 건다 — `script-src 'self' 'unsafe-inline'`(외부 출처 없음), `connect-src 'self'`, `frame-src 'none'`, `frame-ancestors 'none'`. 코드 회귀로 로더가 다시 실려도 실행·전송되지 않는다. 외부 허용은 Pretendard 폰트 CDN(`cdn.jsdelivr.net`)의 style·font뿐(스크립트·연결 불가, 리퍼러 없음).

메타데이터(`src/lib/pro/briefing-page-policy.ts`): `robots noindex, nofollow, nocache`, `referrer no-referrer`,
canonical 없음, 루트의 `og:url`·이미지를 덮어쓴 고정 문구 og/twitter(고객·매물·토큰 정보 없음).
링크 미리보기(카카오톡 스크랩·네이버 Yeti 등)·크롤러·프리페치는 조회수에 넣지 않는다.

### 남은 한계

- 브리핑은 **외부 링크로만** 열린다(앱 안에 `/b`로 가는 링크 없음) → 항상 새 문서로 시작하므로 로더가 한 번도 붙지 않는다.
  앱 안에 `/b` 링크를 만들 때는 `<a target="_blank" rel="noopener noreferrer">`처럼 **새 문서**로 열어야 한다(클라이언트 전환이면 이전 화면에서 이미 로드된 스크립트가 남는다).
- `/pro`도 같은 이유로, 일반 화면에서 클라이언트 전환으로 들어오면 이미 로드된 AdSense가 남는다. 브리핑 링크를 새 탭으로 여는 것은 위 규칙으로 막히고, 토큰은 생성 직후 한 번만 화면에 표시된다.
- 루트 layout `<head>`의 Kakao `preconnect` 두 줄은 모든 화면에 남는다 — 연결 준비(DNS/TLS)만 하고 경로·리퍼러·쿠키를 보내지 않는다.
- PWA 설치 배너(`InstallBanner`)는 UI일 뿐 외부 호출이 없어 그대로 둔다.

### 앞으로 분석·광고·SDK를 추가할 때

1. 전역 마운트 지점(루트 layout, `AppProviders`)에 붙이면 **반드시** `isAdFreePath` / `allowsThirdPartyAnalytics` / `allowsFirstPartyAnalytics`를 거친다.
2. 새로 토큰 URL 화면을 만들면 `isTokenizedPrivatePath`와 `next.config.ts`의 헤더 대상에 추가한다.
3. 테스트 `src/lib/pro/briefing-isolation.test.ts`가 루트 layout·AppProviders에 판정 없는 `<Script>`/`<script>`·알려진 추적기 문자열이 새로 붙으면 실패한다.
4. 루트 layout `<head>`에 서드파티 `<Script>`를 직접 두지 않는다(경로 판정을 할 수 없다).
