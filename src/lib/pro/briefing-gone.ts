// REALTOR_PRO_POLICY_HARDENING_V1 — 취소·만료된 고객 브리핑 링크는 HTTP 410 Gone.
//
// App Router 페이지는 응답 상태를 410으로 정할 수 없어서(notFound()=404뿐), src/proxy.ts가 /b/<token> 요청을
// 페이지보다 먼저 이 모듈로 판정한다. 410일 때만 여기서 고정 HTML로 답하고, 나머지는 기존 페이지가 그대로 처리한다.
//
//   존재한 적 없는 토큰(형식 불일치 포함) → 페이지 notFound() 404
//   유효                                  → 페이지 200
//   취소(REVOKED) · 만료(EXPIRED)          → 410 (이 모듈)
//   중개사 정지(UNAVAILABLE) · 저장소 오류  → 페이지(기존 동작 그대로)
//
// 410 본문에는 브리핑·중개사·고객 정보가 전혀 없다(고정 문구). 조회수는 세지 않는다. 헤더는 /b/*와 같은 정책
// (privateBriefingHeaders: CSP · no-referrer · X-Robots-Tag)에 no-store를 더한다. 스크립트·외부 리소스 0.

import { privateBriefingHeaders } from '@/lib/privacy/private-routes';
import type { BriefingAccess } from './briefing';

const BRIEFING_PATH = /^\/b\/([^/]+)\/?$/;

/** 브리핑 열람 판정 → HTTP 상태. 페이지와 proxy가 같은 기준을 쓴다. */
export function briefingHttpStatus(access: BriefingAccess): 200 | 404 | 410 {
  if (access === 'NOT_FOUND') return 404;
  if (access === 'REVOKED' || access === 'EXPIRED') return 410;
  return 200;
}

export function briefingTokenFromPath(pathname: string): string | null {
  const m = BRIEFING_PATH.exec(pathname);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

export const BRIEFING_GONE_TITLE = '만료되었거나 더 이상 볼 수 없는 브리핑입니다';
const BRIEFING_GONE_TEXT = '필요하면 안내받은 중개사에게 새 링크를 요청해 주세요.';

export const BRIEFING_GONE_HTML = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="referrer" content="no-referrer">
<title>매물 브리핑</title>
<style>
  body { margin: 0; min-height: 100vh; background: #f8fafc; color: #475569; font-family: -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; }
  main { padding: 20px 16px 32px; box-sizing: border-box; }
  .state { max-width: 480px; margin: 48px auto 0; padding: 32px 16px; text-align: center; background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; box-sizing: border-box; }
  h1 { margin: 0 0 10px; font-size: 1.0625rem; font-weight: 700; color: #0f172a; line-height: 1.4; word-break: keep-all; }
  p { margin: 0; font-size: 0.875rem; line-height: 1.6; word-break: keep-all; }
  @media (prefers-color-scheme: dark) { body { background: #0f172a; color: #cbd5e1; } .state { background: #1e293b; border-color: #334155; } h1 { color: #f1f5f9; } }
</style>
</head>
<body>
<main><div class="state"><h1>${BRIEFING_GONE_TITLE}</h1><p>${BRIEFING_GONE_TEXT}</p></div></main>
</body>
</html>`;

export function briefingGoneHeaders(opts: { dev: boolean }): Record<string, string> {
  const h: Record<string, string> = {};
  for (const { key, value } of privateBriefingHeaders(opts)) h[key] = value;
  h['Content-Type'] = 'text/html; charset=utf-8';
  h['Cache-Control'] = 'private, no-store, max-age=0';
  return h;
}

export function briefingGoneResponse(opts: { dev: boolean }): Response {
  return new Response(BRIEFING_GONE_HTML, { status: 410, headers: briefingGoneHeaders(opts) });
}
