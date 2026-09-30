// 개인정보 구역(privacy zone) 판정 — 순수 모듈.
// REALTOR_PRO_BRIEFING_ADS_ISOLATION_V1 (b548cde) → REALTOR_PRO_PRIVATE_APP_ISOLATION_V1 (구역 3개 + 스크립트 등록부).
//
// 구역
//   PUBLIC     일반 공개 화면(app/(public)/*)          광고·분석·방문 로그·위치 조회 허용(기존 그대로)
//   PRO        중개사 Pro(app/(pro)/pro/*)             서드파티·공개 추적 0 — 자체 루트 layout, 세션만
//   TOKENIZED  고객 브리핑(app/(briefing)/b/*)          URL이 곧 열람 권한 — 어떤 스크립트·추적도 0
//
// 1차 경계는 **루트 layout 분리**다: 구역마다 루트 layout이 달라 구역을 넘는 이동은 항상 전체 문서 로드가 된다
// (공개 화면에서 실행된 스크립트가 Pro/브리핑 문서로 넘어오지 않음). 아래 판정은 공개 루트 안에서 쓰는 2차 방어이고,
// next.config.ts의 응답 헤더(CSP·no-referrer·noindex)가 3차 방어다.
//
// 새 서드파티/추적 스크립트를 추가할 때: THIRD_PARTY_SCRIPTS에 id와 허용 구역을 **먼저** 등록하고, 마운트 지점에서
// scriptAllowed(id, pathname)를 거친다. 등록되지 않은 스크립트는 어느 구역에서도 허용되지 않는다.
// docs/pro/REALTOR_PRO_V1_SECURITY.md §0.

export type PrivacyZone = 'PUBLIC' | 'PRO' | 'TOKENIZED';

function normalize(pathname: string | null | undefined): string {
  if (!pathname) return '';
  const p = pathname.split('?')[0].split('#')[0];
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
}

function underPrefix(p: string, prefix: string): boolean {
  return p === prefix || p.startsWith(`${prefix}/`);
}

export function privacyZoneOf(pathname: string | null | undefined): PrivacyZone {
  const p = normalize(pathname);
  if (underPrefix(p, '/b')) return 'TOKENIZED';
  if (underPrefix(p, '/pro')) return 'PRO';
  return 'PUBLIC';
}

/** 서드파티·추적 스크립트 등록부 — 각 항목이 실행될 수 있는 구역을 선언한다. */
export const THIRD_PARTY_SCRIPTS = {
  adsense: { zones: ['PUBLIC'], what: 'AdSense 소유권 확인 로더(pagead2.googlesyndication.com)' },
  ga4: { zones: ['PUBLIC'], what: 'GA4 gtag.js(www.googletagmanager.com)' },
  visitLogging: { zones: ['PUBLIC'], what: '자체 방문 로그 ViewTracker(/api/log/view·heartbeat·leave)' },
  locationLookup: { zones: ['PUBLIC'], what: 'RegionProvider 위치 권한 + Kakao 역지오코딩(dapi.kakao.com)' },
  kakaoPreconnect: { zones: ['PUBLIC'], what: 'Kakao 지도 preconnect 힌트(연결만, 경로·리퍼러 없음)' },
  pretendardFont: { zones: ['PUBLIC', 'PRO', 'TOKENIZED'], what: 'Pretendard 폰트 CSS·파일(cdn.jsdelivr.net) — 스크립트 아님, 리퍼러 없음' },
} as const satisfies Record<string, { zones: readonly PrivacyZone[]; what: string }>;

export type ThirdPartyScriptId = keyof typeof THIRD_PARTY_SCRIPTS;

export function scriptAllowed(id: ThirdPartyScriptId, pathname: string | null | undefined): boolean {
  return (THIRD_PARTY_SCRIPTS[id].zones as readonly PrivacyZone[]).includes(privacyZoneOf(pathname));
}

/** 접근 토큰이 URL에 들어 있는 공개 경로(현재: 고객 브리핑). */
export function isTokenizedPrivatePath(pathname: string | null | undefined): boolean {
  return privacyZoneOf(pathname) === 'TOKENIZED';
}

/** 광고 로더를 싣지 않는 경로. */
export function isAdFreePath(pathname: string | null | undefined): boolean {
  return !scriptAllowed('adsense', pathname);
}

/** 서드파티 분석(GA4 등)을 허용하는가. */
export function allowsThirdPartyAnalytics(pathname: string | null | undefined): boolean {
  return scriptAllowed('ga4', pathname);
}

/** 1차 방문 로그(/api/log/*)를 허용하는가 — 토큰·Pro 경로를 공개 방문 로그에 남기지 않는다. */
export function allowsFirstPartyAnalytics(pathname: string | null | undefined): boolean {
  return scriptAllowed('visitLogging', pathname);
}

/** 위치 권한 요청 + 외부 역지오코딩을 허용하는가. */
export function allowsLocationLookup(pathname: string | null | undefined): boolean {
  return scriptAllowed('locationLookup', pathname);
}

/** 전체 URL 문자열이 비공개 구역(토큰·Pro)을 가리키는지(분석 URL 스냅샷 방어용). */
export function isTokenizedPrivateHref(href: string | null | undefined): boolean {
  return zoneOfHref(href) === 'TOKENIZED';
}

export function isPrivateZoneHref(href: string | null | undefined): boolean {
  const z = zoneOfHref(href);
  return z === 'TOKENIZED' || z === 'PRO';
}

function zoneOfHref(href: string | null | undefined): PrivacyZone | null {
  if (!href) return null;
  try {
    return privacyZoneOf(new URL(href, 'http://local.invalid').pathname);
  } catch {
    return null;
  }
}

/** 비공개 구역이 불러오는 외부 스타일/폰트(Pretendard CDN, globals.css @import). 스크립트·연결은 허용하지 않는다. */
export const BRIEFING_FONT_ORIGIN = 'https://cdn.jsdelivr.net';

type Header = { key: string; value: string };

/**
 * `/b/*` 응답 헤더. CSP가 외부 스크립트·XHR/fetch·iframe을 막아, 코드 회귀로 로더가 다시 실려도 브라우저가 거부한다.
 * Next의 인라인 부트스트랩 스크립트 때문에 script-src에 'unsafe-inline'이 필요하다(외부 출처는 없음).
 * 개발 서버는 HMR 때문에 'unsafe-eval'과 ws: 연결이 필요하다.
 */
export function privateBriefingHeaders(opts: { dev: boolean }): Header[] {
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

/**
 * `/pro`, `/pro/*` 응답 헤더. 외부 **스크립트 실행·연결**만 막는다(서드파티 추적기가 Pro 문서에서 돌 수 없게).
 * 이미지·스타일·로그인 이동(OAuth는 화면 이동이라 connect-src 대상 아님)은 제한하지 않아 기존 첫 화면 기능을 깨지 않는다.
 */
export function privateAppHeaders(opts: { dev: boolean }): Header[] {
  const csp = [
    `script-src 'self' 'unsafe-inline'${opts.dev ? " 'unsafe-eval'" : ''}`,
    `connect-src 'self'${opts.dev ? ' ws: wss:' : ''}`,
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  return [
    { key: 'Content-Security-Policy', value: csp },
    { key: 'Referrer-Policy', value: 'no-referrer' },
    { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
    { key: 'X-Frame-Options', value: 'DENY' },
  ];
}
