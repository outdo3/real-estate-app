// REALTOR_PRO_BRIEFING_ADS_ISOLATION_V1 — 개인 정보·접근 토큰이 URL/화면에 있는 경로의 서드파티 경계(순수 모듈).
//
// 왜: 고객 브리핑 `/b/<token>`의 URL 자체가 열람 권한이다. 광고·분석 스크립트는 location.href를
// 읽거나(page_location) 화면을 훑을 수 있으므로, 토큰 경로에는 **어떤 서드파티 스크립트도** 실리면 안 된다.
// 1차 방어는 로더를 렌더하지 않는 것이고, 2차 방어는 `/b/*` 응답의 CSP(외부 스크립트·연결 차단)다.
//
// 경로 등급
//   TOKENIZED  /b, /b/*        서드파티 스크립트 0 · 1차(자체) 방문 로그 0 · 위치 권한 요청 0
//   AD_FREE    TOKENIZED + /pro, /pro/*   광고 로더 없음(중개사 CRM 화면에 고객 정보·브리핑 링크가 표시됨)
//
// 앞으로 분석·광고·SDK를 추가할 때: 전역 마운트 지점(루트 layout / AppProviders)에 붙인다면
// 반드시 여기 판정 함수를 거친다. docs/pro/REALTOR_PRO_V1_SECURITY.md §브리핑 서드파티 경계.

function normalize(pathname: string | null | undefined): string {
  if (!pathname) return '';
  const p = pathname.split('?')[0].split('#')[0];
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
}

function underPrefix(p: string, prefix: string): boolean {
  return p === prefix || p.startsWith(`${prefix}/`);
}

/** 접근 토큰이 URL에 들어 있는 공개 경로(현재: 고객 브리핑). */
export function isTokenizedPrivatePath(pathname: string | null | undefined): boolean {
  return underPrefix(normalize(pathname), '/b');
}

/** 광고 로더를 싣지 않는 경로. */
export function isAdFreePath(pathname: string | null | undefined): boolean {
  const p = normalize(pathname);
  return isTokenizedPrivatePath(p) || underPrefix(p, '/pro');
}

/** 서드파티 분석(GA4 등)을 허용하는가. */
export function allowsThirdPartyAnalytics(pathname: string | null | undefined): boolean {
  return !isTokenizedPrivatePath(pathname);
}

/** 1차 방문 로그(/api/log/*)를 허용하는가 — 토큰이 든 경로를 자체 DB에도 남기지 않는다. */
export function allowsFirstPartyAnalytics(pathname: string | null | undefined): boolean {
  return !isTokenizedPrivatePath(pathname);
}

/** 전체 URL 문자열이 토큰 경로를 가리키는지(분석 URL 스냅샷 방어용). */
export function isTokenizedPrivateHref(href: string | null | undefined): boolean {
  if (!href) return false;
  try {
    return isTokenizedPrivatePath(new URL(href, 'http://local.invalid').pathname);
  } catch {
    return false;
  }
}

/** 브리핑 페이지가 불러오는 외부 스타일/폰트(Pretendard CDN, globals.css @import). 스크립트·연결은 허용하지 않는다. */
export const BRIEFING_FONT_ORIGIN = 'https://cdn.jsdelivr.net';

/**
 * `/b/*` 응답 헤더. CSP가 외부 스크립트·XHR/fetch·iframe을 막아, 코드 회귀로 로더가 다시 실려도 브라우저가 거부한다.
 * Next의 인라인 부트스트랩 스크립트 때문에 script-src에 'unsafe-inline'이 필요하다(외부 출처는 없음).
 * 개발 서버는 HMR 때문에 'unsafe-eval'과 ws: 연결이 필요하다.
 */
export function privateBriefingHeaders(opts: { dev: boolean }): { key: string; value: string }[] {
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${opts.dev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'unsafe-inline' ${BRIEFING_FONT_ORIGIN}`,
    `font-src 'self' data: ${BRIEFING_FONT_ORIGIN}`,
    "img-src 'self' data: blob:",
    `connect-src 'self'${opts.dev ? ' ws: wss:' : ''}`,
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  return [
    { key: 'Content-Security-Policy', value: csp },
    { key: 'Referrer-Policy', value: 'no-referrer' },
    { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
  ];
}
