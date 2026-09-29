// REALTOR_PRO_MVP_V1 — 요청 가드(순수): 같은 출처 판정 · 로그용 오류 요약. runtime.ts가 쓴다(테스트는 next 없이 import).
//
// CSRF(쓰기 요청): 세션 쿠키 SameSite=Lax에 더해
//   · Origin이 있으면 host와 같아야 한다
//   · Origin이 없으면 Sec-Fetch-Site가 'same-origin'이어야 한다
//   · 둘 다 없으면 거부(프록시가 Origin을 벗긴 요청·구형 클라이언트 — Pro는 브라우저 fetch만 쓴다)
// 쓰기 본문은 Content-Type: application/json만 받는다(text/plain 폼 CSRF 차단).

export type HeaderGetter = { get(name: string): string | null };

export function isSameOriginWrite(h: HeaderGetter): boolean {
  const origin = h.get('origin');
  const host = h.get('x-forwarded-host') ?? h.get('host');
  if (origin) {
    try {
      return !!host && new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  return h.get('sec-fetch-site') === 'same-origin';
}

export function isJsonContentType(h: HeaderGetter): boolean {
  const ct = (h.get('content-type') ?? '').toLowerCase();
  return ct.startsWith('application/json');
}

/** 로그에는 오류 이름과 Prisma 코드만 — 메시지에는 쿼리 인자(이름·메모·암호문)가 들어갈 수 있다. */
export function summarizeErrorForLog(e: unknown): string {
  if (!(e instanceof Error)) return 'unknown';
  const code = (e as { code?: unknown }).code;
  return typeof code === 'string' && /^[A-Z]?\d{3,5}$|^P\d{4}$/.test(code) ? `${e.name} ${code}` : e.name;
}
