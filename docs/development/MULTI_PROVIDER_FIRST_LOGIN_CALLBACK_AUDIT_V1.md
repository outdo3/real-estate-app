# E-JIP MULTI-PROVIDER FIRST LOGIN CALLBACK AUDIT V1

PRE-LAUNCH AUTH P1 · READ-ONLY. 기준 커밋 `b940b14`. 코드/설정/환경변수 변경 없음.

## VERDICT: ROOT_CAUSE_CONFIRMED

모바일 첫 로그인 실패(Google·Kakao 공통)는 **로그인을 `real-estate-app-park11.vercel.app`에서 시작했기 때문**이다.
state(Google은 PKCE도) 쿠키는 그 호스트에만 발급되고, 프로바이더는 `NEXTAUTH_URL` 기준
`https://e-jip.com/api/auth/callback/*`로 돌려보내므로 콜백 요청에는 쿠키가 없다 → `State cookie was missing`
→ `error=OAuthCallback` → NextAuth 기본 페이지 "Try signing in with a different account.".
그 페이지는 `e-jip.com`에 있으므로 거기서 다시 누르면 쿠키와 콜백이 같은 호스트라 성공한다.

## 1. 프로덕션 인증 기준선 (값 미출력)

| 항목 | 값 |
|---|---|
| NextAuth | 4.24.15 |
| session | `strategy: 'jwt'` |
| `pages` | 비어 있음 → 오류는 기본 `/api/auth/signin?error=` |
| cookie options | 미지정(NextAuth 기본값) |
| NEXTAUTH_URL | Production env에 존재(Secret, 20일 전). 모든 `redirect_uri`가 `https://e-jip.com/api/auth/callback/*`로 나오는 것으로 값의 호스트를 확인 |
| NEXT_PUBLIC_SITE_URL | Production env에 존재(1일 전). 현재 OG/sitemap/robots가 전부 `e-jip.com` |
| checks | Google `["pkce","state"]`(프로바이더 기본), Kakao `["state"]`(NextAuth 기본), Naver `['state']`(명시) |

실제 발급 쿠키(두 호스트 모두 동일 속성):

```
__Secure-next-auth.state                Max-Age=900; Path=/; HttpOnly; Secure; SameSite=Lax   (Domain 없음 = host-only)
__Secure-next-auth.pkce.code_verifier   Max-Age=900; Path=/; HttpOnly; Secure; SameSite=Lax   (Google만)
__Secure-next-auth.callback-url         Path=/; HttpOnly; Secure; SameSite=Lax                 (e-jip.com 시작 시에만 — vercel.app 시작 시 callbackUrl이 NEXTAUTH_URL과 다른 오리진이라 설정 안 됨)
```

## 2. 오류 화면 출처

`node_modules/next-auth/core/pages/signin.js`: `Signin` / `OAuthSignin` / `OAuthCallback` / `OAuthCreateAccount` / `Callback`
→ "Try signing in with a different account.". 실제 흐름은
`GET /api/auth/callback/{provider}` 302 → `/api/auth/error?error=OAuthCallback` 302 → `/api/auth/signin?error=OAuthCallback` 200.

## 3~5. 런타임 로그 (Vercel production, `vercel logs`)

최근 7일 `next-auth` 오류 5건:

| 시각(UTC) | provider | 메시지 | 판정 |
|---|---|---|---|
| 06:34:32 | kakao | State cookie was missing | 실제 사용자. 해당 구간 요청 로그 보존 안 됨 → 시작 호스트 확인 불가 |
| 06:57:13 | kakao | state mismatch | **이전 STEP의 curl probe**(state 값 일치) — 사용자 문제 아님 |
| 06:57:14 | kakao | State cookie was missing | **이전 STEP의 curl probe**(쿠키 없이 콜백) |
| 07:22:56 | kakao | State cookie was missing | 실기기 |
| 07:23:19 | google | State cookie was missing | 실기기 |

실패 요청 순서(07:22~07:23):

```
07:22:45  real-estate-app-park11.vercel.app  GET  /                          (페이지 로드)
07:22:56  real-estate-app-park11.vercel.app  GET  /api/auth/providers
07:22:56  real-estate-app-park11.vercel.app  GET  /api/auth/csrf
07:22:56  real-estate-app-park11.vercel.app  POST /api/auth/signin/kakao     ← state 쿠키: vercel.app host-only
07:22:56  e-jip.com                          GET  /api/auth/callback/kakao   302  State cookie was missing
07:22:56  e-jip.com                          GET  /api/auth/error            302
07:22:56  e-jip.com                          GET  /api/auth/signin           200  (배너)
07:23:15  real-estate-app-park11.vercel.app  POST /api/auth/signin/google    ← state + PKCE 쿠키: vercel.app host-only
07:23:19  e-jip.com                          GET  /api/auth/callback/google  302  State cookie was missing
```

성공 요청 순서(07:25):

```
07:25:16  e-jip.com  POST /api/auth/signin/kakao    → 07:25:21  e-jip.com  GET /api/auth/callback/kakao   302 (오류 없음)
07:25:34  e-jip.com  POST /api/auth/signin/google   → 07:25:35  e-jip.com  GET /api/auth/callback/google  302 (오류 없음)
```

실패 2건은 시작 호스트가 vercel.app, 성공 2건은 e-jip.com이다. 예외 없음.

## 6~7. 쿠키 발급 vs 콜백 반환

- **발급**: vercel.app에서 시작해도 서버는 state/PKCE 쿠키를 정상 발급한다(`curl` 확인). 단 host-only로 vercel.app에만.
- **반환**: 콜백은 `e-jip.com`으로 온다. vercel.app과 e-jip.com은 서로 다른 등록 도메인이라 브라우저가 보낼 수 없다.
  서버 로그 `State cookie was missing`은 NextAuth가 `__Secure-next-auth.state`를 읽지 못했다는 뜻이다.
- Google PKCE: state 검사가 먼저 실패해 PKCE 검사까지 가지 않았다. PKCE 쿠키도 같은 이유로 없었을 것이다.

## 8. www / apex

`https://www.e-jip.com/` → 308 → `https://e-jip.com/`(HTML 이전) → 인증 상태가 www에 생성되지 않는다. **영향 없음.**

## 9. canonical host 코드 감사

- `real-estate-app-park11.vercel.app/` → **200, redirect 없음**(프로덕션 전체를 그대로 서비스).
- `src/config/site.ts`: `NEXT_PUBLIC_SITE_URL`이 없으면 프로덕션 기본값이 `https://real-estate-app-park11.vercel.app`.
  `NEXT_PUBLIC_SITE_URL`은 1일 전에 추가됐다 — 그 전 약 36일간 OG url/이미지, Kakao·리포트 공유 링크, sitemap, robots가
  vercel.app을 가리켰다. 이미 퍼진 공유 링크·검색 결과·북마크·홈 화면 아이콘은 계속 vercel.app으로 들어온다.
- `LoginModal`의 `callbackUrl`은 `window.location.href`(현재 호스트). vercel.app에서는 NextAuth가 교차 오리진이라 무시한다.
- Vercel 프로젝트 도메인 목록에는 `e-jip.com`만 있다(vercel.app 기본 도메인은 목록 밖에서 계속 연결).
- 코드에서 호스트를 섞는 다른 경로는 없다(proxy는 `/admin`만 매칭).

## 10. 브라우저 컨텍스트

- Kakao 콜백은 signin POST 0.3초 뒤에 도착했다 → 카카오톡 앱 전환 없이 같은 Chrome 탭에서 자동 승인된 흐름.
- 두 실패 모두 콜백·오류·재시도가 같은 브라우저 흐름으로 이어졌다.
- 따라서 이번 실패는 Custom Tab/앱 handoff 격리가 원인이 아니다(그 경로가 일반적으로 불가능하다는 뜻은 아님).
- "모바일만 실패"의 차이는 기기가 아니라 **진입 호스트**다. 로그에는 User-Agent가 없어 기기 종류 자체는 로그로 증명하지 못했다.

## 11. 분류

| | 판정 |
|---|---|
| A. 모바일 콜백에서 state 쿠키 없음 | **증상** |
| B. state mismatch | 아니다(유일한 mismatch는 이전 STEP probe) |
| C. PKCE | 아니다(state에서 먼저 실패) |
| **D. canonical host** | **근본 원인** — vercel.app에서 시작, e-jip.com으로 콜백 |
| E. SameSite | 아니다 — 같은 Lax 속성으로 e-jip.com 시작은 성공 |
| F. Custom Tab/앱 handoff | 이번 실패의 원인 아님 |
| G. stale cookie 충돌 | 아니다 |
| H. callback/proxy host | D와 같은 사건(시작 호스트 ≠ 콜백 호스트) |
| I. provider-specific | 아니다 — Google/Kakao 동일 |

이전 STEP(FINAL DEVICE UX FIX V1)의 결론 정정: 실기기 실패는 중복 탭 경합(F)이 아니었다. 그때 로그에 보인
`state mismatch`는 내 probe였다. 중복 탭 잠금은 무해하지만 이 실패를 고치지 않는다.

## 12. 최소 수정안 (승인 전 미적용)

**권장 — 프로덕션 비정규 호스트를 `https://e-jip.com`으로 308 redirect(경로·쿼리 보존).**

- 방법 1: Vercel Project → Domains에서 vercel.app 프로덕션 도메인을 `e-jip.com`으로 redirect(대시보드 지원 여부 확인 필요).
- 방법 2: `src/proxy.ts`에서 `VERCEL_ENV === 'production'`이고 host가 `e-jip.com`이 아니면 308. matcher 확장 필요.
  `/api/cron/*`는 제외(Vercel Cron 호출 호스트를 먼저 확인), preview 배포는 제외.
- 인증 설정(쿠키/SameSite/Domain/checks/NEXTAUTH_URL/callback)은 **건드리지 않는다**.
- 롤백: redirect 제거 한 번.

보조(선택): `site.ts` 프로덕션 기본값을 `https://e-jip.com`으로 — `NEXT_PUBLIC_SITE_URL`이 빠져도 vercel.app이 다시 퍼지지 않게.

**하지 말아야 할 것**
- cookie Domain 확대: vercel.app과 e-jip.com은 쿠키를 공유할 수 없다(효과 없음).
- SameSite=None / state·PKCE check 해제: 보안 후퇴이고 이 원인과 무관.
- NEXTAUTH_URL을 vercel.app으로: 정상인 e-jip.com 사용자가 같은 방식으로 깨진다.

## 13. 캐시 삭제가 해결책이 아닌 이유

실패는 저장된 쿠키 때문이 아니라 **어느 주소로 들어왔는가** 때문이다. 사이트 데이터를 지워도 공유 링크·북마크·홈 화면
아이콘은 여전히 vercel.app을 연다. 시크릿 모드가 "되는" 경우는 사용자가 e-jip.com을 직접 입력했을 때뿐이다.
신규 사용자가 과거 공유 링크로 들어오면 아무 조작 없이 첫 시도에서 100% 실패한다.

## 14. 승인 필요

필요. 수정안은 전 경로 host redirect(라우팅)라 이번 STEP에서 적용하지 않았다.

## 15. 출시 영향

**PRE-LAUNCH AUTH P1.** vercel.app 호스트로 들어온 모든 사용자, 모든 프로바이더, 첫 로그인 100% 실패(재현 조건 확정).
e-jip.com으로 들어온 사용자는 PC·모바일 모두 정상.

## 16. 다음 단계

1. 승인 후 canonical host redirect 적용(cron 호출 호스트 확인 포함).
2. 실기기 확인: 폰에서 로그인 전 주소창 호스트 확인 → vercel.app 링크로 진입 → e-jip.com으로 이동되는지 → Google/Kakao 1회 탭 성공.
3. `vercel logs --query next-auth`로 `State cookie was missing` 재발 여부 확인.
