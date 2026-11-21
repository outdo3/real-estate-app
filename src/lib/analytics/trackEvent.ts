'use client';

import type { GaEventParams } from '@/lib/analytics/ga';
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

// Analytics is disabled on this QA-only branch.
export function trackEvent(_name: AnalyticsEventName, _context: TrackEventContext = {}): void {}
