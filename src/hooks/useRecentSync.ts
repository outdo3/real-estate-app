'use client';

// AUTH/MY V1 — MY-3. 로그인 성공 직후(session authenticated 전환) 한 번만
// localStorage recent 배열을 /api/my/recent/sync로 올리고,
// 서버가 반환한 병합 결과를 local에 mirror한다.
//
// 이 훅은 인증 상태가 authenticated가 되는 순간(= 로그인 직후 또는 세션 복원)
// 현재 browser session에서 아직 sync하지 않았으면 1회 실행한다.
// 실패해도 local data는 손실 없이 유지된다.

import { useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { getRecentApartments, RecentApartment } from '@/lib/recent-apartments';

const SYNC_FLAG_KEY = 'ejip:recentSyncedThisSession';
const LOCAL_RECENT_KEY = 'ejip:recentApartments';

export function useRecentSync() {
  const { status } = useSession();
  const attempted = useRef(false);

  useEffect(() => {
    if (status !== 'authenticated') return;
    // 이미 시도했으면 중복 실행 방지
    if (attempted.current) return;
    // sessionStorage로 현재 브라우저 세션에서 이미 sync 했는지 확인
    try {
      if (typeof window !== 'undefined' && window.sessionStorage.getItem(SYNC_FLAG_KEY) === '1') return;
    } catch { /* sessionStorage 비활성화 환경 — sync 시도는 계속 */ }

    attempted.current = true;

    const localItems = getRecentApartments();
    if (localItems.length === 0) {
      // local data가 없어도 서버 목록은 받아서 local에 미러한다(다른 기기에서 쌓인 데이터 복원).
    }

    // local items를 서버가 기대하는 형식으로 변환
    const payload = localItems.map((item: RecentApartment) => ({
      lawdCd: item.lawdCd,
      dong: item.dong,
      name: item.name,
      address: item.address,
      viewedAt: item.visitedAt, // local의 visitedAt → server의 viewedAt
    }));

    fetch('/api/my/recent/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: payload }),
    })
      .then((res) => res.json())
      .then((json) => {
        if (!json.success || !Array.isArray(json.data)) return;
        // 서버 결과(최대 20개)를 local에 mirror.
        // local 최신 8개 UX를 유지하기 위해 최신 8개만 local에 쓴다.
        const serverItems = json.data as Array<{
          lawdCd: string;
          dong: string;
          name: string;
          address?: string | null;
          viewedAt: string; // Prisma DateTime → JSON string
        }>;
        const mirrorItems: RecentApartment[] = serverItems.slice(0, 8).map((item) => ({
          lawdCd: item.lawdCd,
          dong: item.dong,
          name: item.name,
          address: item.address ?? '',
          visitedAt: new Date(item.viewedAt).getTime(),
        }));
        try {
          window.localStorage.setItem(LOCAL_RECENT_KEY, JSON.stringify(mirrorItems));
        } catch { /* localStorage 쿼터 초과 등 — 무시 */ }
        // sync 완료 flag
        try {
          window.sessionStorage.setItem(SYNC_FLAG_KEY, '1');
        } catch { /* 무시 */ }
      })
      .catch(() => {
        // sync 실패 — local data 손실 없이 유지
      });
  }, [status]);
}
