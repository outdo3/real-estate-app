'use client';

// USER_FEEDBACK_V1 — 의견 이벤트 전송 래퍼. 이름과 의견 유형(고정 enum)만 보낸다.
// 메시지·사용자·단지·페이지·쿼리·IP·UA는 시그니처상 넣을 자리가 없다.
import { trackEvent } from './trackEvent';
import type { FeedbackCategory } from '@/lib/feedback/feedback-rules';

export function trackFeedbackOpen(): void {
  try {
    trackEvent('feedback_open');
  } catch {
    // 트래킹 실패는 화면 동작에 영향을 주지 않는다.
  }
}

export function trackFeedbackSubmit(category: FeedbackCategory): void {
  try {
    trackEvent('feedback_submit', { actionType: category });
  } catch {
    // 트래킹 실패는 화면 동작에 영향을 주지 않는다.
  }
}
