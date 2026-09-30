// REALTOR_PRO_PREVIEW_EXTERNAL_GUARD_V1 — Realtor Pro Preview에서 외부 데이터 API를 부르지 않게 하는 서버 관문.
//
// 켜지는 조건(둘 다): VERCEL_ENV === 'preview' 이고 REALTOR_PRO_ENABLED === 'true'.
//   · Production(VERCEL_ENV=production)·로컬(VERCEL_ENV 없음)·다른 Preview 브랜치(REALTOR_PRO_ENABLED 없음)는 **항상 꺼짐**.
//   · Pro Preview DB에는 공개 거래 데이터가 없어서, 공개 화면이 DB 미스 → live MOLIT로 넘어가 Production과 같은
//     공공데이터 키 한도를 쓰거나, 유료 API·실제 메일 발송·검색엔진 핑 같은 바깥 효과를 낼 수 있다.
// 막는 방식: src/instrumentation.ts가 서버 시작 때 전역 fetch를 한 번 감싼다(모든 호출부·앞으로 생길 호출부 포함).
//   아래 호스트로 가는 요청은 네트워크 없이 PreviewExternalBlockedError로 실패한다 — "데이터 0건"으로 위장하지 않고
//   기존 오류 경로(요청 실패·준비 중)로 드러난다. MOLIT 거래는 api-molit.ts 단일 관문에서도 한 번 더 닫는다.
// 막지 않는 것(화면 동작에 필요): Kakao 지도 SDK·로컬 검색, OAuth(Kakao·Naver·Google), 지역코드 프록시, 브라우저 쪽 요청.

/** 막는 호스트(정확히 같거나 그 하위 도메인). */
export const PREVIEW_BLOCKED_HOSTS = [
  'apis.data.go.kr', // MOLIT 실거래 · 건축물대장 · TAGO 교통 · 준공연도 등 공공데이터포털
  'api.odcloud.kr', // 청약홈(공공데이터포털 키)
  'open.neis.go.kr', // NEIS 학교 정보
  'www.schoolinfo.go.kr', // 학교알리미
  'generativelanguage.googleapis.com', // Gemini(유료)
  'api.resend.com', // 실제 메일 발송
  'api.indexnow.org', // 검색엔진 색인 핑
] as const;

export const PREVIEW_EXTERNAL_BLOCKED_MESSAGE = 'Preview 환경에서는 외부 공공데이터를 호출하지 않습니다.';

export class PreviewExternalBlockedError extends Error {
  constructor(public readonly host: string) {
    super(`preview external data blocked: ${host}`); // 호스트만 — URL(쿼리의 서비스키 등)은 넣지 않는다
    this.name = 'PreviewExternalBlockedError';
  }
}

export function isPreviewExternalDataBlocked(env: Record<string, string | undefined>): boolean {
  return env.VERCEL_ENV === 'preview' && env.REALTOR_PRO_ENABLED === 'true';
}

function hostOf(input: unknown): string | null {
  try {
    if (typeof input === 'string') return new URL(input).hostname.toLowerCase();
    if (input instanceof URL) return input.hostname.toLowerCase();
    if (input && typeof input === 'object' && 'url' in input && typeof (input as { url: unknown }).url === 'string') {
      return new URL((input as { url: string }).url).hostname.toLowerCase();
    }
  } catch {
    return null; // 상대 경로 등 — 외부 호스트가 아니다
  }
  return null;
}

export function blockedHostFor(input: unknown): string | null {
  const host = hostOf(input);
  if (!host) return null;
  return PREVIEW_BLOCKED_HOSTS.find((h) => host === h || host.endsWith(`.${h}`)) ?? null;
}

type FetchLike = (input: any, init?: any) => Promise<any>;

/** 막힌 호스트는 네트워크 없이 거부, 나머지는 원래 fetch로 그대로 넘긴다. */
export function createGuardedFetch<F extends FetchLike>(base: F): F {
  const guarded = ((input: unknown, init?: unknown) => {
    const blocked = blockedHostFor(input);
    if (blocked) return Promise.reject(new PreviewExternalBlockedError(blocked));
    return base(input, init);
  }) as F;
  return guarded;
}

const INSTALLED = Symbol.for('ejip.previewExternalGuard');

/** 조건이 맞을 때만 전역 fetch를 한 번 감싼다(중복 설치 없음). 설치했으면 true. */
export function installPreviewExternalGuard(
  env: Record<string, string | undefined>,
  target: { fetch: FetchLike } & Record<symbol, unknown> = globalThis as unknown as { fetch: FetchLike } & Record<symbol, unknown>
): boolean {
  if (!isPreviewExternalDataBlocked(env)) return false;
  if (target[INSTALLED]) return true;
  target.fetch = createGuardedFetch(target.fetch.bind(target));
  target[INSTALLED] = true;
  return true;
}
