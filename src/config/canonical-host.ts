// E-JIP CANONICAL HOST REDIRECT V1 — 프로덕션 정규 호스트 단일 출처.
//
// 근본 원인(docs/development/MULTI_PROVIDER_FIRST_LOGIN_CALLBACK_AUDIT_V1.md, Vercel 로그로 확정):
// 프로덕션이 기본 Vercel 호스트(real-estate-app-park11.vercel.app)에서도 200으로 그대로 서비스됐다.
// 거기서 로그인을 시작하면 NextAuth의 state/PKCE 쿠키가 그 호스트에만(host-only) 생기는데,
// Google/Kakao는 NEXTAUTH_URL 기준으로 https://e-jip.com/api/auth/callback/* 로 돌려보낸다.
// vercel.app과 e-jip.com은 서로 다른 등록 도메인이라 브라우저가 쿠키를 보낼 방법이 없어
// 매번 "State cookie was missing" → OAuthCallback 오류였다. 기기(모바일/PC) 문제가 아니라
// **진입 호스트** 문제이고, 쿠키 정책을 완화해서는 고칠 수 없다(도메인이 달라 공유 자체가 불가).
//
// 그래서 레거시 호스트로 들어온 요청을 경로·쿼리를 그대로 둔 채 정규 호스트로 308 보낸다.
// 로그인은 항상 e-jip.com에서 시작되고, 인증 설정은 하나도 바꾸지 않는다.
//
// next.config.ts가 이 파일을 직접 import하므로 경로 alias(@/)를 쓰지 않는다.

/** 공유/OG/sitemap/robots/인증 콜백이 가리키는 정규 오리진. */
export const CANONICAL_ORIGIN = 'https://e-jip.com';

/**
 * 프로덕션 기본 Vercel 호스트. 이 **정확한** 호스트만 redirect한다.
 * 프리뷰(`real-estate-app-git-<branch>-park11.vercel.app`, 배포별 `real-estate-app-<hash>-park11.vercel.app`)는
 * 이름이 달라 대상이 아니다 — 프리뷰에서 계속 확인할 수 있어야 한다.
 */
export const LEGACY_PRODUCTION_HOST = 'real-estate-app-park11.vercel.app';

/**
 * redirect 제외 경로 접두사.
 *
 * Vercel Cron은 프로덕션 배포로 GET을 보내는데, 어느 호스트로 부르는지 로그 보존 기간 밖이라
 * 확인하지 못했다. 레거시 호스트로 부른다면 308은 실행 실패가 된다. cron 라우트는
 * `Authorization: Bearer CRON_SECRET`으로만 열리므로(src/lib/cron-auth.ts) 호스트와 무관하게
 * 안전하고, 사용자가 브라우저로 들어오는 경로도 아니다 — 이 접두사만 정확히 뺀다.
 */
export const CANONICAL_REDIRECT_EXCLUDED_PREFIXES = ['/api/cron'] as const;

/** Next `has` 값은 `^value$` 정규식으로 비교된다 — 점을 이스케이프해야 정확 일치가 된다. */
export function escapeHostForRouteMatch(host: string): string {
  return host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface CanonicalHostRedirect {
  source: string;
  has: Array<{ type: 'host'; value: string }>;
  destination: string;
  permanent: true;
}

/**
 * next.config.ts `redirects()`에 넣을 규칙.
 *
 * - source `/:path((?!api/cron(?:/|$)).*)` — 모든 경로(루트 포함)에서 `/api/cron`과 그 하위만 제외.
 * - 쿼리는 Next가 목적지로 그대로 넘긴다(installed docs: redirects.md).
 * - permanent: true → 308(메서드 보존).
 */
export function buildCanonicalHostRedirects(): CanonicalHostRedirect[] {
  const excluded = CANONICAL_REDIRECT_EXCLUDED_PREFIXES
    .map((prefix) => escapeHostForRouteMatch(prefix.replace(/^\//, '')))
    .join('|');
  return [
    {
      source: `/:path((?!(?:${excluded})(?:/|$)).*)`,
      has: [{ type: 'host', value: escapeHostForRouteMatch(LEGACY_PRODUCTION_HOST) }],
      destination: `${CANONICAL_ORIGIN}/:path`,
      permanent: true,
    },
  ];
}
