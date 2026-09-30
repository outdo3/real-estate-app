# REALTOR PRO V1 — 보안 경계

이 문서는 Pro의 보안 경계 중 **코드 전체에 걸친 규칙**을 적는다. 기능별 세부(암호화·소유권·RLS)는
`REALTOR_PRO_V1_ARCHITECTURE.md`, 필드 분류는 `REALTOR_PRO_DATA_CLASSIFICATION.md`를 본다.

## 0. 개인정보 구역 3개 (REALTOR_PRO_PRIVATE_APP_ISOLATION_V1, 2026-09-30)

### 구역

| 구역 | 경로(URL 변경 없음) | 루트 layout | 허용 |
|---|---|---|---|
| **PUBLIC** | 그 밖의 모든 화면 | `app/(public)/layout.tsx` | AdSense · GA4 · 공개 방문 로그(ViewTracker) · 위치 조회(RegionProvider) · Kakao preconnect · 서비스 워커 · 설치 배너 — **기존 그대로** |
| **PRO PRIVATE APP** | `/pro`, `/pro/*` | `app/(pro)/layout.tsx` | 로그인 세션(SessionProvider)과 Pretendard 폰트만 |
| **TOKENIZED BRIEFING** | `/b`, `/b/*` | `app/(briefing)/layout.tsx` | Pretendard 폰트만(공급자 없음, 세션 조회도 없음) |

### 경계가 생기는 원리 — 문서 경계

구역마다 **루트 layout이 다르다**(route group 3개, 최상위 `app/layout.tsx` 없음). Next는 루트 layout이 다른 경로 사이의
이동을 클라이언트 전환이 아니라 **전체 문서 로드**로 처리한다(설치본 문서 `route-groups.md` "Full page load").
`<Link>`·`router.push`·주소 직접 입력·새로고침·뒤로/앞으로 모두 해당한다. 그래서 공개 화면에서 이미 실행된
광고·분석 스크립트는 Pro·브리핑 문서로 **넘어올 수 없다** — 조건부 렌더링에 기대지 않는다.

변경 전: 루트 layout이 하나(`app/layout.tsx`)라 공개 → `/pro` 이동이 같은 문서 안의 클라이언트 전환이었고,
공개 화면에서 로드된 AdSense·GA·ViewTracker가 Pro 문서에 그대로 살아 있었다(b548cde의 경로 판정은 "새로 싣지 않기"만 막음).

### 3중 방어

1. **문서 경계**(위). Pro·브리핑 루트 layout에는 추적 요소가 아예 import되지 않는다.
2. **판정**: 공개 루트 안의 로더도 `src/lib/privacy/private-routes.ts`의 구역 판정을 거친다(`scriptAllowed`).
3. **응답 헤더**(`next.config.ts`):
   - `/pro`, `/pro/*`: CSP `script-src 'self' 'unsafe-inline'` · `connect-src 'self'` · `frame-src 'none'` · `frame-ancestors 'none'` (외부 스크립트 실행·외부 연결 불가, 이미지·스타일·로그인 이동은 제한 안 함) · `Referrer-Policy: no-referrer` · `X-Robots-Tag: noindex, nofollow, noarchive` · `X-Frame-Options: DENY`
   - `/b`, `/b/*`: §1의 더 엄격한 CSP(default-src 'self') + 같은 리퍼러·색인 헤더

Pro → 공개 이동: Pro 문서의 `no-referrer` 때문에 공개 화면은 `document.referrer`가 비어 있고(GA의 page_referrer로 Pro URL이 나가지 않음),
GA 유입 스냅샷도 Pro·브리핑 URL이면 버린다(`safeInitialLocationHref`).

### 브라우저 실측 (2026-09-30, 로컬 데모·합성 데이터)

- A: `/terms`(AdSense 로드·방문 로그·GA/ViewTracker/위치 조회 코드 포함) → `router.push('/pro/dashboard')` → **새 문서**(이전 문서의 전역 변수 소멸, navigation entry = /pro/dashboard), `adsbygoogle`/`gtag`/`dataLayer` 없음, 외부 스크립트 0, 외부 요청은 폰트뿐, API 호출은 `/api/pro/dashboard`·`/api/auth/session`뿐, 로드된 JS에 GA·ViewTracker·역지오코딩·광고 로더 코드 없음.
- 합성 문자열 `FAKE_CUSTOMER_SECRET_123`·`FAKE_PRIVATE_LISTING_NOTE_456`을 화면에 띄운 상태에서 외부 요청은 폰트 URL(고정)뿐, 어떤 요청 URL에도 합성 문자열 없음, 콘솔 출력 없음, `/api/log/*` 0.
- Pro → 공개(`이집으로 돌아가기` Link): 새 문서, `document.referrer` = 빈 값, 공개 화면 광고·방문 로그 정상 재개, 어떤 요청에도 `/pro/` 경로·합성 문자열 없음.
- B: `/pro/briefings` 직접 열기 + 새로고침: 추적 요소 0, `robots noindex, nofollow`, `referrer no-referrer`.
- D: 뒤로 → Pro 문서가 bfcache에서 **자기 자신**으로 복원(공개 문서 아님), 앞으로 → 공개 문서 복원.
- GA4는 로컬에서 Measurement ID가 없어 실제 전송은 관찰하지 않았다(대신 Pro 문서가 로드한 JS에 gtag 로더 코드가 없음을 확인).

### 알려진 변화

- 어떤 라우트에도 맞지 않는 URL의 404는 이제 Next 기본 루트(공개 layout 아님)로 렌더된다 → 그 404 화면에는 광고·GA·방문 로그가 없다. 라우트 안에서 `notFound()`로 나는 404(예: 없는 단지)는 공개 layout 그대로.
- 서비스 워커(`/sw.js`, 캐시 없음·통과만)는 공개 화면에서 등록되면 범위 `/`라 Pro 요청도 통과시킨다 — 읽기·저장 없음.

### 새 서드파티·추적 스크립트 규칙

1. `THIRD_PARTY_SCRIPTS`(private-routes.ts)에 **id와 허용 구역을 먼저 선언**한다. 선언 없는 스크립트는 어느 구역에도 싣지 않는다.
2. PUBLIC 전용이면 `app/(public)/layout.tsx` 또는 `AppProviders`에만 붙이고 `scriptAllowed(id, pathname)`을 거친다.
3. PRO·TOKENIZED에 허용하려면 이 문서에 이유(전송되는 데이터·리퍼러·경로 노출 여부)를 적고 CSP를 함께 바꾼다 — 사용자 승인 대상.
4. 테스트 `pro-private-app-isolation.test.ts`·`briefing-isolation.test.ts`가 루트 layout 분리, Pro/브리핑 트리의 추적 요소 import, 등록부(비공개 구역 허용은 폰트뿐), 헤더를 검사한다.

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
| `/pro`, `/pro/*` | 없음 | 없음 (§0부터) | 없음 (§0부터) | 없음 (§0부터) | §0 헤더 |
| 그 밖의 공개 화면 | **유지(변경 없음)** | 유지 | 유지 | 유지 | — |

`/pro`에서 광고를 빼는 이유: 중개사 화면에는 고객 이름·조건과 **생성 직후의 브리핑 링크(토큰 포함)**가 표시된다.

2중 방어

1. 로더를 렌더하지 않는다(§0 이후에는 브리핑 전용 루트 layout이라 애초에 마운트되지 않음): `AdSenseLoader`(공개 루트 layout `<body>`)·`GoogleAnalytics`·`ga.ts` 런타임 게이트·`ViewTracker`·`RegionContext`가 같은 판정을 쓴다.
2. 브라우저가 거부한다: `next.config.ts`가 `/b`·`/b/*`에 CSP를 건다 — `script-src 'self' 'unsafe-inline'`(외부 출처 없음), `connect-src 'self'`, `frame-src 'none'`, `frame-ancestors 'none'`. 코드 회귀로 로더가 다시 실려도 실행·전송되지 않는다. 외부 허용은 Pretendard 폰트 CDN(`cdn.jsdelivr.net`)의 style·font뿐(스크립트·연결 불가, 리퍼러 없음).

메타데이터(`src/lib/pro/briefing-page-policy.ts`): `robots noindex, nofollow, nocache`, `referrer no-referrer`,
canonical 없음, 루트의 `og:url`·이미지를 덮어쓴 고정 문구 og/twitter(고객·매물·토큰 정보 없음).
링크 미리보기(카카오톡 스크랩·네이버 Yeti 등)·크롤러·프리페치는 조회수에 넣지 않는다.

### 남은 한계

- 브리핑은 **외부 링크로만** 열린다(앱 안에 `/b`로 가는 링크 없음) → 항상 새 문서로 시작하므로 로더가 한 번도 붙지 않는다.
  §0 이후에는 앱 안의 `<Link href="/b/...">`도 루트 layout이 달라 새 문서로 열린다.
- ~~`/pro`로 클라이언트 전환 시 이미 로드된 AdSense가 남는 문제~~ — §0 루트 layout 분리로 해결(구역 간 이동은 항상 새 문서).
- 공개 루트 layout `<head>`의 Kakao `preconnect` 두 줄은 공개 화면에만 있다(§0 이전에는 모든 화면) — 연결 준비(DNS/TLS)만 하고 경로·리퍼러·쿠키를 보내지 않는다.
- PWA 설치 배너(`InstallBanner`)는 UI일 뿐 외부 호출이 없어 그대로 둔다.

### 앞으로 분석·광고·SDK를 추가할 때

1. 전역 마운트 지점(루트 layout, `AppProviders`)에 붙이면 **반드시** `isAdFreePath` / `allowsThirdPartyAnalytics` / `allowsFirstPartyAnalytics`를 거친다.
2. 새로 토큰 URL 화면을 만들면 `isTokenizedPrivatePath`와 `next.config.ts`의 헤더 대상에 추가한다.
3. 테스트 `src/lib/pro/briefing-isolation.test.ts`가 루트 layout·AppProviders에 판정 없는 `<Script>`/`<script>`·알려진 추적기 문자열이 새로 붙으면 실패한다.
4. 루트 layout `<head>`에 서드파티 `<Script>`를 직접 두지 않는다(경로 판정을 할 수 없다).
