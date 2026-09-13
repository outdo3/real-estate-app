# E-JIP FINAL DEVICE UX FIX V1

PRE-LAUNCH P1 · 실기기(Android Chrome)에서 재현된 두 문제만 다룬다. 기준 커밋 `63b8fc9`.

## A. 지도 첫 진입 flash

### 증상
지도 버튼 → 부산 서구청 근처가 잠깐 보임 → 잠시 후 현재 위치로 이동. 로드뷰는 정상.

### 원인 (코드 기준)

| 확인 항목 | 결과 |
|---|---|
| 서구청 좌표 출처 | `DEFAULT_MAP_CENTER = { lat: 35.0979, lng: 129.0244 }` (`src/lib/map-marker-share.ts`), **하드코딩 상수** |
| 저장된 위치인가 | 아니다. local/sessionStorage 위치 저장 없음. URL(`lat/lng/lawdCd`)은 공유·복원 링크에서만 |
| 지도 init 전에 geolocation 대기? | **안 했다.** 렌더 게이트는 `isMapReady`(Kakao SDK 로드)만 봤다 |
| 위치 도착 후 처리 | `setCenter` → `<KakaoMap center>`가 이동. 레이어는 다시 부르지 않음 |
| 첫 frame에 fallback 지도? | **그렇다.** SDK(실측 약 1.5s)가 GPS보다 먼저 준비되면 서구청으로 먼저 그려졌다 |

같은 구조에서 함께 생기던 문제:
- 최초 마커 로드도 `isMapReady` 시점의 center(= 서구, `DEFAULT_LAWD_CD`)로 나갔고, 지오로케이션의 `setCenter`는
  레이어를 다시 부르지 않았다 → 지도는 현재 위치인데 마커는 서구 것이 남을 수 있었다.
- URL 동기화가 `isMapReady` 직후 기본 center를 URL에 썼다 → 그 사이 새로고침/뒤로가기로 돌아오면 그 URL이
  복원 상태로 읽혀 지오로케이션을 건너뛰고 서구청이 다시 보였다.

### 수정

`src/lib/map-initial-location.ts`(순수 로직) + `src/app/map/page.tsx`(배선).

- 위치를 **먼저 확정한 뒤** 지도를 그린다. SDK는 준비됐지만 위치가 미확정이면
  `FullPageLoader` "현재 위치를 확인하고 있어요".
- 위치 정책은 그대로: GPS(옵션 `enableHighAccuracy:false, timeout:10000, maximumAge:300000` 그대로) → IP(ipinfo) → 기본 지역.
  공유/복원 링크는 URL center로 바로 연다(지오로케이션 생략).
- 권한 상태(Permissions API):
  - `denied` → GPS를 부르지 않고 IP → 기본 지역.
  - `granted` → GPS를 최대 4초 기다리고, 넘으면 IP → 기본 지역으로 확정. 늦게 온 GPS는 사용자가 아직
    대체 위치를 그대로 보고 있을 때만 반영(레이어도 새 위치로 다시 조회).
  - `prompt`/`unknown` → 상한 없음. 권한 프롬프트가 떠 있는 동안 기본 지역을 먼저 그리면 같은 flash가 난다.
    이 경우 상한은 브라우저 geolocation timeout(허용 이후 10초)이다.
- IP 조회에 3초 timeout(예전엔 없었다 — 이제 로더가 이 응답을 기다리므로 멈추면 지도가 안 떴을 것).
- 최초 마커 로드, URL 동기화, 안전영역 측정은 위치 확정 후에 실행.
- IP/기본 지역으로 열렸으면 지도 위에 사실을 말한다:
  - IP: "현재 위치를 확인하지 못해 접속 지역 기준으로 보여드려요."
  - 기본: "현재 위치를 확인하지 못해 기본 지역(부산 서구)을 보여드려요."
  - 지도를 옮기면(center가 확정 위치와 달라지면) 사라진다.

건드리지 않은 것: 로드뷰(`KakaoMapEmbed`, `AptLocationCard`), "내 위치" 버튼, 드래그 갱신, 마커 데이터/클러스터,
canonical 좌표, 공유 링크 복원 규칙, 부트 스크립트 prefetch.

## B. 로그인 첫 시도 배너

### 증상
로그인 → "Try signing in with a different account." 배너가 먼저 보임 → 그 화면에서 Kakao를 한 번 더 누르면 정상 로그인.

### 원인 조사

1. **배너 출처**: E-JIP 화면이 아니다. NextAuth 4.24.15 기본 로그인 페이지(`/api/auth/signin?error=…`)의 문구로,
   `Signin`/`OAuthSignin`/`OAuthCallback`/`OAuthCreateAccount`/`Callback` 다섯 코드가 이 문장을 쓴다.
   `authOptions.pages`가 비어 있어 콜백 오류는 `/api/auth/error?error=X` → `/api/auth/signin?error=X`로 간다.
2. **stale 여부**: `LoginModal`에는 에러 상태가 없고, 앱 어디에서도 `error` 파라미터를 읽거나 들고 다니지 않는다
   (proxy는 `/admin`만 매칭). 따라서 A(재시도 성공 뒤에도 남는 error), C(모달의 과거 에러 상태),
   D(callbackUrl에 실린 error)는 **구조적으로 불가능**하다. 배너가 보였다면 **방금 OAuth 흐름이 실제로 실패**한 것이다.
3. **첫 클릭은 프로바이더까지 가는가** (프로덕션, 계정 생성 없는 요청만):
   - `GET /api/auth/providers` 200, `GET /api/auth/csrf` 200
   - `POST /api/auth/signin/kakao` → `kauth.kakao.com`, `redirect_uri=https://e-jip.com/api/auth/callback/kakao` → **정상 redirect**
   - 따라서 `OAuthSignin`(redirect 이전 실패)은 아니다.
4. **실패 지점은 콜백의 state 검사**:
   - Kakao 프로바이더는 기본 `checks: ['state']`(Naver는 명시적으로 같은 값).
   - `signin` POST를 두 번 보내면 state가 매번 새로 발급되고(`6OPx…` → `KCIl…`) 브라우저에는
     `next-auth.state` 쿠키가 **하나만** 남는다.
   - 첫 번째 URL의 state + 두 번째 쿠키로 콜백 → `302 /api/auth/error?error=OAuthCallback` → `302 /api/auth/signin?error=OAuthCallback`
     → **그 배너**. state 쿠키가 없을 때도 같은 경로.
5. **두 번 누르기 쉬운 이유**: `next-auth/react`의 `signIn()`은 이동 전에 providers → csrf → signin POST를
   순서대로 왕복한다(프로덕션 첫 providers 응답 0.97s). 그 동안 모달 버튼은 아무 반응이 없다.

### 분류

| 분류 | 판정 |
|---|---|
| A. stale error가 재시도 성공 뒤에도 남음 | 아니다 (코드상 불가) |
| B. 직전 프로바이더 실패가 error 파라미터를 남김 | 부분 — 배너는 **직전 흐름의 실제 실패** 결과다(남은 게 아니라 방금 난 것) |
| C. 모달이 과거 에러 상태로 열림 | 아니다 (모달에 에러 상태 없음) |
| D. callbackUrl에 error | 아니다 |
| E. 프로바이더 특이 문제 | 아니다 — Kakao/Naver/Google 공통 state 메커니즘 |
| F. 세션 경합 | **해당** — 중복 탭으로 두 OAuth 흐름이 state 쿠키를 두고 경합(프로덕션에서 재현) |
| G. 기타 | **확인 필요** — 앱 전환(카카오톡/인앱 브라우저) 중 state 쿠키가 사라지는 경로도 같은 `OAuthCallback`을 낸다 |

실기기에서 실제로 F였는지 G였는지는 서버에서 구분할 수 없다(두 경우 모두 `error=OAuthCallback`, NextAuth 오류는
DB `error_logs`에 남지 않고 Vercel 함수 로그의 `[next-auth][error][OAUTH_CALLBACK_ERROR]` 메시지 —
`state mismatch` vs `state cookie was missing` — 로만 구분된다).

### 수정 (인증 설정 무변경)

`src/lib/login-attempt.ts` + `src/components/LoginModal.tsx`.

- 한 번 누르면 이동이 끝날 때까지 **세 버튼 모두 잠근다**(동기 guard — React state만으로는 같은 프레임의 두 번째 탭을 못 막는다).
- 누른 버튼은 "카카오로 이동 중…"처럼 진행 중임을 보여준다.
- `signIn()` 시작 자체가 실패하면 잠금을 풀어 다시 누를 수 있다.
- 프로바이더 화면에서 뒤로가기로 bfcache 복원(`pageshow.persisted`)되면 잠금을 푼다.
- `signIn(provider, { callbackUrl })` 호출 형태, 프로바이더, 쿠키, SameSite, checks, 세션 전략, `pages`, callback URL — **전부 그대로**.
- 실제 인증 오류는 계속 NextAuth 페이지에 보인다(숨기거나 파라미터를 지우지 않는다).

### 이 수정이 해결하지 않는 것

- 앱 전환 중 state 쿠키가 사라지는 경로(G). 고치려면 state 쿠키/SameSite/checks 같은 인증 보안 설정을 바꿔야 해서 **승인 필요**.
- **Naver 모바일 state-cookie 이슈**: 같은 부류(G)로 보이며 이번 STEP에서 건드리지 않았다.
  Naver 버튼은 모달 공통 중복 탭 잠금만 공유한다.
- NextAuth 기본 오류 페이지의 영어 문구("different account")는 실제 원인(같은 계정으로 다시 시도하면 됨)과 맞지 않는다.
  E-JIP 한국어 오류 페이지(`pages.error`)는 인증 라우팅 변경이라 이번 범위 밖 — 후속 제안.

## 테스트

- `src/lib/map-initial-location.test.ts` 10 tests: 확인 중 미확정/상한 없음, 로더 게이트 순서, GPS 성공, 거부 → IP → 기본 + 안내,
  GPS 실패/잘못된 좌표, granted 상한 + 늦은 GPS 규칙, 한 번만 확정/취소, 공유 링크 즉시 확정, 좌표 해석, 로드뷰·진입 경로 무영향.
- `src/lib/login-attempt.test.ts` 6 tests: 모달에 stale error 없음, 실제 오류 페이지 유지, 실패/bfcache 시 잠금 해제,
  Kakao 첫 클릭 1회 + 중복 탭 무시, Google 호출 그대로, Naver·인증 보안 설정 무변경.
- src 전체 `npx tsx --test` → 1753/1753 pass (기존 1737 + 신규 16)
- `npx tsc --noEmit` → FAIL_EXISTING_SCRIPT_ERRORS (25건 전부 `scripts/`·`tmp/`, `src/` 0)
- `npx eslint <변경 파일 6개>` → exit 0
- `npm run build` → exit 0
- 로컬 `next start` → `GET /map` 200, SSR HTML은 로더만(기본 center 좌표 없음)

## DEVICE QA REQUIRED

이 환경에는 실기기가 없다. **STRUCTURAL PASS / DEVICE QA REQUIRED.**

Android Chrome 체크리스트:
- [ ] 지도 탭 → 서구청 flash 없이 로더 → 현재 위치로 첫 표시
- [ ] 위치 권한 첫 요청(프롬프트) 동안 지도가 먼저 뜨지 않음, 허용 후 현재 위치
- [ ] 위치 권한 거부 → 대체 위치 안내 문구 표시, 지도 이동 시 사라짐
- [ ] 마커가 현재 위치 지역으로 표시(서구 마커가 남지 않음)
- [ ] 상세 → 로드뷰 정상, 지도 ↔ 상세 뒤로가기 복원 정상
- [ ] 로그인 모달 → Kakao 1회 탭 → "카카오로 이동 중…" → 배너 없이 로그인 완료
- [ ] Kakao 연속 탭해도 배너 없음
- [ ] 여전히 배너가 보이면: 주소창 `error=` 값과 시각을 기록(Vercel 로그의 `OAUTH_CALLBACK_ERROR` 메시지로 G 경로 확인)
- [ ] Google 로그인 정상

## 남은 위험

1. 로그인 G 경로(앱 전환 중 state 쿠키 소실)는 미해결일 수 있다 — 실기기 결과로 확인.
2. 위치 권한 프롬프트를 오래 두면 그동안 로더가 유지된다(의도된 동작).
3. `unknown` 권한(Permissions API 미지원)에서 GPS가 느리면 최대 10초 로더.
4. ipinfo.io 의존은 기존과 같다(신규 의존 아님).
