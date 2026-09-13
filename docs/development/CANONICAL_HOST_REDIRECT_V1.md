# E-JIP CANONICAL HOST REDIRECT V1

PRE-LAUNCH AUTH P1 FIX · 사용자 승인: "vercel.app → e-jip.com 308 canonical redirect 승인". 기준 커밋 `b940b14`.

## 목적

프로덕션 기본 Vercel 호스트로 들어온 사용자를 항상 `https://e-jip.com`으로 보내, 로그인이 정규 호스트에서만
시작되게 한다. 근거는 `MULTI_PROVIDER_FIRST_LOGIN_CALLBACK_AUDIT_V1.md`(Vercel 로그로 원인 확정).

## 근본 원인 (요약)

```
real-estate-app-park11.vercel.app  POST /api/auth/signin/{google,kakao}  → state(+PKCE) 쿠키: vercel.app host-only
e-jip.com                          GET  /api/auth/callback/*             → State cookie was missing → OAuthCallback
```

기기(모바일/PC) 문제가 아니라 **진입 호스트** 문제다. vercel.app과 e-jip.com은 서로 다른 등록 도메인이라
쿠키 Domain/SameSite를 어떻게 바꿔도 공유할 수 없다 — 쿠키 정책 완화는 해결책이 아니다.

## 현재 호스트 감사

| 항목 | 결과 |
|---|---|
| `https://e-jip.com` | 정규 호스트, 200 |
| `https://www.e-jip.com` | Vercel 도메인 설정으로 308 → apex(코드 아님) |
| `https://real-estate-app-park11.vercel.app` | 수정 전 **200, redirect 없음** |
| `src/proxy.ts` | `/admin`만 매칭(인증 가드). 이번 변경 없음 |
| `next.config.ts` | redirects 없음 → 추가 |
| `vercel.json` | regions + crons 3개(`/api/cron/{sale-sync,rent-sync,sale-recheck}?mode=apply`). 변경 없음 |
| `src/config/site.ts` | `NEXT_PUBLIC_SITE_URL` 없으면 프로덕션 폴백 = vercel.app → e-jip.com으로 변경 |
| 프로덕션 env | `NEXT_PUBLIC_SITE_URL` 존재(1일 전 추가), `NEXTAUTH_URL` 존재. 값 변경 없음 |

## Cron 안전 확인

- cron 라우트는 `Authorization: Bearer CRON_SECRET`만 허용(`src/lib/cron-auth.ts`, 미설정 시 fail-closed).
- 어느 호스트로 Vercel Cron이 호출되는지는 **확인하지 못했다** — 마지막 실행(09-12 19/21/23시 UTC) 구간 요청 로그가
  보존 기간 밖이었다. 레거시 호스트로 호출된다면 308은 실행 실패가 되므로 **`/api/cron`과 그 하위만 정확히 제외**했다.
  사용자가 브라우저로 들어오는 경로가 아니고, 인증이 호스트와 무관하게 걸려 있어 제외해도 위험이 없다.
- cron 스케줄/설정 변경 없음.

## 설계

`next.config.ts`의 `redirects()`(선언형, 파일시스템·페이지보다 먼저 평가 — installed docs `redirects.md`):

```ts
{
  source: '/:path((?!(?:api/cron)(?:/|$)).*)',
  has: [{ type: 'host', value: 'real-estate-app-park11\\.vercel\\.app' }],
  destination: 'https://e-jip.com/:path',
  permanent: true, // 308, 메서드 보존
}
```

- 규칙은 `src/config/canonical-host.ts` 한 곳에서 만든다(`CANONICAL_ORIGIN`, `LEGACY_PRODUCTION_HOST`, 제외 접두사).
- Next는 `has` 값을 `^value$`로 비교한다 → 점을 이스케이프해 **정확한 호스트만** 일치. 프리뷰
  (`real-estate-app-git-*-park11.vercel.app`, `real-estate-app-<hash>-park11.vercel.app`)는 대상이 아니다.
- 쿼리는 Next가 목적지로 그대로 넘긴다.
- `proxy.ts`를 넓히지 않았다 — 모든 요청마다 `getToken`을 돌리게 되고 인증 가드와 섞인다.
- 인증 설정(쿠키/SameSite/Domain/checks/NEXTAUTH_URL/callback/세션 전략) 변경 없음.

`src/config/site.ts`: 프로덕션 폴백을 `CANONICAL_ORIGIN`(e-jip.com)으로. 프리뷰(`VERCEL_URL`)·로컬(localhost) 동작은 그대로.

## 테스트

### 실제 라우터 매트릭스 (로컬 `next start` 프로덕션 빌드 + Host 헤더)

| Host | 요청 | 결과 |
|---|---|---|
| legacy | `GET /` | 308 → `https://e-jip.com/` |
| legacy | `GET /map` | 308 → `https://e-jip.com/map` |
| legacy | `GET /map?lat=35.1&lng=129.07&zoom=5&lawdCd=26140&layers=apt` | 308 → 같은 경로+쿼리 |
| legacy | `GET /stats/rankings` | 308 → `https://e-jip.com/stats/rankings` |
| legacy | `GET /report/apartment/26140-123?period=12` | 308 → 같은 경로+쿼리 |
| legacy | `GET /apt/%EB%8C%80…?lawdCd=26140&dong=%EC%84…` | 308 → 인코딩 그대로 보존 |
| legacy | `GET /api/auth/providers`, `GET /api/auth/csrf` | 308 → e-jip.com, **Set-Cookie 없음** |
| legacy | `POST /api/auth/signin/{kakao,google}` | 308 → e-jip.com(메서드 보존), **Set-Cookie 없음** |
| legacy | `GET /api/cron/sale-sync`, `/api/cron/rent-sync?mode=apply` | **401**(redirect 안 됨, 시크릿 없어 인증 거부) |
| e-jip.com | `GET /`, `/map`, `/api/auth/providers` | 200(루프 없음) |
| real-estate-app-git-main-park11.vercel.app | `GET /` | 200(프리뷰 제외) |
| real-estate-app-abc123xyz-park11.vercel.app | `GET /map` | 200(배포별 URL 제외) |
| localhost | `GET /` | 200 |

### 자동 테스트

- `src/config/canonical-host.test.ts` 7 tests: 308·경로 유지, 정확한 호스트만(정규/www/프리뷰/유사 호스트 제외),
  사용자 경로 전부 대상, `/api/cron`만 제외(vercel.json cron 경로 전수), next.config 배선, 인증 설정 무변경, 메타데이터에 레거시 호스트 없음.
- `src/config/site-metadata.test.ts`: 프로덕션 폴백 e-jip.com, 프리뷰/로컬 유지(+1 test).
- src 전체 `npx tsx --test` → 1761/1761 pass
- `npx tsc --noEmit` → FAIL_EXISTING_SCRIPT_ERRORS(25건 전부 `scripts/`·`tmp/`, `src/`·`next.config.ts` 0)
- `npx eslint <변경 파일 5개>` → exit 0
- `npm run build` → exit 0

## DEVICE QA REQUIRED

A. Chrome에서 `https://real-estate-app-park11.vercel.app` 직접 열기 → 주소가 `https://e-jip.com`으로 바뀜
B. Google 로그인 1회 → 성공
C. Kakao 로그인 1회 → 성공
D. 기존 홈 화면 이집 아이콘(PWA) 삭제
E. Chrome에서 `https://e-jip.com` 접속
F. 홈 화면에 추가(새 PWA 설치)
G. 새 아이콘으로 열어 로그인 재확인

PWA 재설치 권장 이유: vercel.app에서 설치한 앱은 그 호스트가 scope/start_url이다. redirect로 e-jip.com에 도착하긴
하지만 설치 앱의 scope 밖이라 Android에서 Custom Tab/브라우저 UI로 열릴 수 있다. e-jip.com에서 새로 설치하면
처음부터 정규 호스트로 열린다.

## 남은 위험

- Vercel Cron 호출 호스트는 미확인이지만 `/api/cron` 제외로 어느 쪽이든 안전하다.
- 과거 공유 링크/검색 결과는 redirect로 계속 동작한다(308은 브라우저·검색엔진이 영구 캐시).
- 레거시 호스트에서 이미 로그인 중이던 세션 쿠키는 e-jip.com으로 옮겨지지 않는다 — 한 번 다시 로그인해야 한다.
