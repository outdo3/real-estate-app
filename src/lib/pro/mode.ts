// REALTOR_PRO_MVP_V1 — Pro 실행 모드 판정(순수). runtime.ts가 쓴다. 테스트가 next/next-auth 없이 import할 수 있게 분리.
//   OFF  : 기본. REALTOR_PRO_ENABLED가 'true'가 아니면 Pro 전체 비공개(페이지 "준비 중", API 404).
//   LIVE : REALTOR_PRO_ENABLED=true — Prisma 저장소.
//   DEMO : REALTOR_PRO_DEMO=1 + 개발 환경(NODE_ENV≠production, VERCEL_ENV 없음)에서만 — 메모리 저장소·합성 데이터.

export type ProMode = 'OFF' | 'LIVE' | 'DEMO';

export function resolveProMode(env: Record<string, string | undefined>): ProMode {
  const production = env.NODE_ENV === 'production' || !!env.VERCEL_ENV;
  if (env.REALTOR_PRO_DEMO === '1' && !production) return 'DEMO';
  if (env.REALTOR_PRO_ENABLED === 'true') return 'LIVE';
  return 'OFF';
}
