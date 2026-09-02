'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { getClientSessionId, getCurrentAptName } from '@/lib/live-presence';
import { initQaSuppressionFromUrl, isQaSuppressed } from '@/lib/analytics/qa-suppression';

// 30초 간격 하트비트 — 관리자 대시보드의 "실시간 접속자"가 이 간격을 전제로 한다
// (presence-server.ts의 ONLINE_WINDOW_MS와 세트).
const HEARTBEAT_INTERVAL_MS = 30 * 1000;

// 앱 전역에 한 번만 마운트된다(AppProviders). 페이지 이동마다 조회 로그를 남기고,
// 30초마다 하트비트를 보내 "지금 접속 중"을 유지하며, 탭을 닫을 때 즉시 이탈 신호를
// 보낸다. 실패해도 실제 화면 기능에는 영향이 없어야 하므로 모든 호출은 fire-and-forget
// (await/에러 처리로 사용자에게 영향 주지 않음)이다.
export default function ViewTracker() {
  const pathname = usePathname();

  // ADMIN_USER_BEHAVIOR_ANALYTICS_V1_PHASE2 §7 — 최초 마운트 시 1회, URL의 QA
  // suppression 트리거를 확인하고 주소창에서 즉시 제거한다.
  useEffect(() => {
    initQaSuppressionFromUrl();
  }, []);

  useEffect(() => {
    if (!pathname) return;
    // /apt/[name]은 apt-client.tsx가 실제로 매칭된 단지명(complexId)까지 포함한 더
    // 정확한 조회 로그를 직접 남긴다 — 여기서 또 남기면 단지명 없는 중복 로그가 쌓인다.
    if (pathname.startsWith('/apt/')) return;
    if (isQaSuppressed()) return;
    const sessionId = getClientSessionId();
    if (!sessionId) return;
    fetch('/api/log/view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: pathname, sessionId, qaSuppressed: isQaSuppressed() }),
      keepalive: true,
    }).catch(() => {});
  }, [pathname]);

  useEffect(() => {
    const sendHeartbeat = () => {
      if (isQaSuppressed()) return;
      const sessionId = getClientSessionId();
      if (!sessionId) return;
      fetch('/api/log/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, url: pathname, aptName: getCurrentAptName(), qaSuppressed: isQaSuppressed() }),
        keepalive: true,
      }).catch(() => {});
    };

    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

    const handleUnload = () => {
      const sessionId = getClientSessionId();
      if (!sessionId || !navigator.sendBeacon) return;
      navigator.sendBeacon('/api/log/leave', JSON.stringify({ sessionId }));
    };
    window.addEventListener('beforeunload', handleUnload);

    return () => {
      clearInterval(interval);
      window.removeEventListener('beforeunload', handleUnload);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return null;
}
