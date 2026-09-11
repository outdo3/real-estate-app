'use client';

import { getClientSessionId } from '@/lib/live-presence';
import { isQaSuppressed } from '@/lib/analytics/qa-suppression';
import { gaEvent, type GaEventParams } from '@/lib/analytics/ga';
import { toGaEventName } from '@/lib/analytics/ga-events';
import type { AnalyticsEventName } from './events';

export interface TrackEventContext {
  complexId?: string | null;
  aptName?: string | null;
  // ADMIN_USER_BEHAVIOR_ANALYTICS_V1_PHASE2 §15-17 — next_action_click 전용, 실제
  // NextActionType 값만 의미가 있다. 서버가 다시 검증하므로 여기서는 그대로 전달만 한다.
  actionType?: string | null;
  /**
   * GA4_INTEGRATION_V1 §10 — **GA4에만** 실리는 파라미터.
   *
   * 1st-party POST 본문에는 절대 포함되지 않는다(아래 fetch body를 보라). 그래서 이
   * 필드를 쓰더라도 서버/스키마/관리자 대시보드는 전혀 영향을 받지 않는다.
   * 값은 ga.ts의 allowlist를 한 번 더 통과하므로, 여기에 자유 텍스트를 넣어도
   * 전송되지 않고 버려진다.
   */
  ga?: GaEventParams;
}

/**
 * 클라이언트 범용 이벤트 트래커. ViewTracker.tsx의 fetch 관례(keepalive, 실패 무시)를
 * 그대로 따른다 — 트래킹 실패가 실제 기능(찜/공유)을 절대 막으면 안 된다.
 *
 * GA4_INTEGRATION_V1 §7 — 여기가 1st-party와 GA4를 잇는 **유일한 다리**다.
 * 호출부는 한 줄도 바뀌지 않으며, 한 번의 사용자 행동은
 *   1st-party 1건 + (매핑돼 있다면) GA4 1건
 * 이 된다. 두 경로는 서로의 실패에 영향받지 않는다.
 */
export function trackEvent(name: AnalyticsEventName, context: TrackEventContext = {}): void {
  // QA/운영자 세션은 두 시스템에서 **함께** 제외한다. 한쪽에만 남으면 지표가 어긋난다.
  if (isQaSuppressed()) return;

  // GA4를 먼저 보낸다. sessionId가 없어도(= 1st-party가 기록할 수 없어도) GA4는
  // 독립적으로 동작해야 한다 — 한쪽이 다른 쪽의 선행 조건이 되면 안 된다(§1).
  const gaName = toGaEventName(name);
  if (gaName) gaEvent(gaName, context.ga);

  const sessionId = getClientSessionId();
  if (!sessionId) return;

  fetch('/api/log/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      sessionId,
      complexId: context.complexId ?? null,
      aptName: context.aptName ?? null,
      actionType: context.actionType ?? null,
      qaSuppressed: false,
    }),
    keepalive: true,
  }).catch(() => {});
}
