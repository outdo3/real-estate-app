// ADMIN_USER_BEHAVIOR_ANALYTICS_V1_PHASE2 — write-time traffic exclusion. Phase 1's own
// read-only DB audit directly proved this session's localhost QA traffic skewed the live
// "popular apartment" ranking (docs/development/ADMIN_USER_BEHAVIOR_ANALYTICS_V1_PHASE1.md §14).
// No schema/column exists to TAG rows for later exclusion at query time, so this module gates
// writes instead — a request classified as excluded traffic simply never creates a PageView/
// SearchLog row. Historical rows are never touched (§9 of the Phase 2 spec).
import { isAdminSessionUser } from '@/lib/auth-helpers';

export type TrafficExclusionReason = 'BOT' | 'NON_PRODUCTION' | 'ADMIN_SESSION' | 'QA_SUPPRESSED';

// 보수적으로 작성 — 일반 모바일 브라우저 UA에는 등장하지 않는, 알려진 크롤러/헬스체크
// 토큰만 매칭한다. "mobile"/"android" 같은 넓은 단어는 절대 포함하지 않는다(오탐 방지).
const BOT_USER_AGENT_PATTERN =
  /bot|crawler|spider|slurp|bingpreview|facebookexternalhit|whatsapp|telegrambot|discordbot|semrushbot|ahrefsbot|mj12bot|petalbot|yandexbot|applebot|headlesschrome|lighthouse|pingdom|uptimerobot|vercel-cron|python-requests|curl\//i;

export function isBotUserAgent(userAgent: string | null): boolean {
  // 빈 UA를 자동으로 bot 취급하지 않는다 — UA를 보내지 않는 정상 클라이언트를
  // 오탐하는 것이 bot을 하나 놓치는 것보다 나쁘다.
  if (!userAgent) return false;
  return BOT_USER_AGENT_PATTERN.test(userAgent);
}

// VERCEL_ENV는 Vercel Functions에 자동 제공되며(별도 설정 불필요) 'production'/'preview'/
// 'development' 중 하나다. 로컬 `next dev`/`next start`에서는 undefined이므로 'production'이
// 아닌 모든 경우(로컬 개발 + Vercel Preview 배포)를 한 번에 걸러낸다 — host 헤더 기반 판단보다
// 안정적이다(프록시/헤더 조작에 영향받지 않음).
export function isNonProductionEnvironment(): boolean {
  return process.env.VERCEL_ENV !== 'production';
}

export interface TrafficClassificationInput {
  userAgent: string | null;
  user: { role?: string | null; email?: string | null } | null;
  qaSuppressed: boolean;
}

export function classifyTraffic(input: TrafficClassificationInput): TrafficExclusionReason | null {
  if (input.qaSuppressed) return 'QA_SUPPRESSED';
  if (isAdminSessionUser(input.user)) return 'ADMIN_SESSION';
  if (isBotUserAgent(input.userAgent)) return 'BOT';
  if (isNonProductionEnvironment()) return 'NON_PRODUCTION';
  return null;
}
