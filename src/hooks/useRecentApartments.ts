'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import useSWR from 'swr';
import { getRecentApartments, type RecentApartment } from '@/lib/recent-apartments';

/**
 * RECENT_VIEWED_AUTH_PARITY_V1 §4~§7 — "최근 본 단지"의 **출처를 세션에 따라 가르는** 훅.
 *
 * ── 고친 문제 ───────────────────────────────────────────────────────────────
 * 홈은 세션을 보지 않고 localStorage만 읽었다. 그래서
 *  - 로그인해도 홈은 계정 기록이 아니라 로컬 기록을 보여줬고(사용자 신고 증상),
 *  - 로그아웃한 뒤에도 이전에 본 단지가 그대로 남았고,
 *  - 같은 브라우저에서 다른 계정으로 로그인해도 이전 기록이 먼저 보였다.
 *
 * ── 정책(§2) ────────────────────────────────────────────────────────────────
 *  로그인   → 서버(계정) 기록만. 로컬은 보지 않는다.
 *  비로그인 → 이 기기에서 **비회원으로** 본 기록만. 서버는 건드리지 않는다.
 *  세션 확인 중 → 아무것도 보여주지 않는다(§4 — 잘못된 목록을 먼저 flash하지 않는다).
 *
 * ── 계정 격리(§7) ───────────────────────────────────────────────────────────
 * SWR 키에 사용자 id를 넣는다. 키가 계정마다 다르므로 A의 응답이 B의 화면에 캐시로
 * 재사용될 수 없다. 로그아웃하면 키가 사라져 authenticated 목록이 즉시 화면에서
 * 빠진다(늦게 도착한 응답도 다른 키라 렌더되지 않는다).
 *
 * ── 실패 처리(§11) ──────────────────────────────────────────────────────────
 * 서버 조회가 실패하면 **로컬로 대체하지 않는다.** 계정 기록인 척하는 남의 목록보다
 * 비어 있거나 오류인 편이 낫다.
 */

export type RecentSource = 'account' | 'guest';

export interface RecentApartmentsState {
  items: RecentApartment[];
  /** 세션 확인 중이거나 계정 목록을 불러오는 중. */
  loading: boolean;
  /** 계정 목록 조회 실패. 로컬로 대체하지 않는다. */
  error: boolean;
  /** 지금 보여주고 있는 목록의 출처. */
  source: RecentSource;
}

/** 서버 recent_views 한 행(JSON 직렬화된 형태). */
interface ServerRecentView {
  lawdCd: string;
  dong: string;
  name: string;
  address?: string | null;
  viewedAt: string;
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

/** 서버 행을 화면이 쓰는 형태로 맞춘다. 정렬은 서버(viewedAt desc)를 그대로 따른다. */
function fromServer(rows: ServerRecentView[]): RecentApartment[] {
  return rows.map((r) => ({
    name: r.name,
    address: r.address ?? '',
    lawdCd: r.lawdCd,
    dong: r.dong,
    visitedAt: new Date(r.viewedAt).getTime(),
  }));
}

export function useRecentApartments(): RecentApartmentsState {
  const { data: session, status } = useSession();
  const userId = (session?.user as { id?: string } | undefined)?.id;

  // §7 — 계정별 SWR 키. 로그인하지 않았으면 키가 null이라 조회 자체가 일어나지 않고,
  // 로그아웃하면 이전 계정 키의 데이터가 더 이상 읽히지 않는다.
  const accountKey = status === 'authenticated' && userId ? `/api/my/recent#${userId}` : null;
  const { data, error: swrError, isLoading } = useSWR(
    accountKey,
    () => fetcher('/api/my/recent'),
    { revalidateOnFocus: false }
  );

  // 게스트 목록은 클라이언트에서만 읽는다(SSR 중 localStorage 접근 없음).
  const [guestItems, setGuestItems] = useState<RecentApartment[] | null>(null);
  useEffect(() => {
    if (status !== 'unauthenticated') return;
    setGuestItems(getRecentApartments());
  }, [status]);

  if (status === 'loading') {
    return { items: [], loading: true, error: false, source: 'guest' };
  }

  if (status === 'authenticated') {
    const failed = !!swrError || (data && !data.success);
    if (failed) {
      // §11 — 로컬로 속이지 않는다.
      return { items: [], loading: false, error: true, source: 'account' };
    }
    if (isLoading || !data) {
      return { items: [], loading: true, error: false, source: 'account' };
    }
    return {
      items: fromServer((data.data ?? []) as ServerRecentView[]),
      loading: false,
      error: false,
      source: 'account',
    };
  }

  // 비로그인. guestItems가 null이면 아직 첫 effect가 돌지 않은 것뿐이다.
  return {
    items: guestItems ?? [],
    loading: guestItems === null,
    error: false,
    source: 'guest',
  };
}
