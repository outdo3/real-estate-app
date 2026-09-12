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
import { getRecentApartments, type RecentApartment } from '@/lib/recent-apartments';

const SYNC_FLAG_KEY = 'ejip:recentSyncedThisSession';

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
        if (!json.success) return;
        // RECENT_VIEWED_AUTH_PARITY_V1 §10 — **서버 목록을 local에 mirror하지 않는다.**
        //
        // 예전에는 병합 결과(계정 기록)를 localStorage에 써넣었다. 홈이 세션과 무관하게
        // local을 읽었으므로, 로그아웃한 뒤에도(또는 같은 기기의 다른 사람에게도) 그
        // 계정이 본 단지가 그대로 보였다. 게스트 저장소에는 비회원 상태로 본 것만 남는다.
        //
        // 로그인 상태의 화면은 이제 useRecentApartments가 /api/my/recent에서 직접
        // 읽으므로 mirror가 필요 없다 — 업로드(local → 서버 병합)만 남긴다.
        try {
          window.sessionStorage.setItem(SYNC_FLAG_KEY, '1');
        } catch { /* 무시 */ }
      })
      .catch(() => {
        // sync 실패 — local data 손실 없이 유지
      });
  }, [status]);
}
