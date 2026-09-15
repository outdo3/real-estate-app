import type { Metadata } from 'next';
import { Suspense } from 'react';
import FeedbackClient from './feedback-client';

// USER_FEEDBACK_V1 — 의견 보내기. 개인 제출 화면이라 검색 색인하지 않는다.
export const metadata: Metadata = {
  title: '의견 보내기',
  robots: { index: false, follow: false },
};

export default function FeedbackPage() {
  return (
    <Suspense fallback={null}>
      <FeedbackClient />
    </Suspense>
  );
}
