'use client';

import { getClientSessionId } from '@/lib/live-presence';
import { isQaSuppressed } from '@/lib/analytics/qa-suppression';
import type { AnalyticsEventName } from './events';

export interface TrackEventContext {
  complexId?: string | null;
  aptName?: string | null;
  // ADMIN_USER_BEHAVIOR_ANALYTICS_V1_PHASE2 §15-17 — next_action_click 전용, 실제
  // NextActionType 값만 의미가 있다. 서버가 다시 검증하므로 여기서는 그대로 전달만 한다.
  actionType?: string | null;
}

// 클라이언트 범용 이벤트 트래커. ViewTracker.tsx의 fetch 관례(keepalive, 실패 무시)를
// 그대로 따른다 — 트래킹 실패가 실제 기능(찜/공유)을 절대 막으면 안 된다.
export function trackEvent(name: AnalyticsEventName, context: TrackEventContext = {}): void {
  const sessionId = getClientSessionId();
  if (!sessionId) return;
  if (isQaSuppressed()) return;

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
