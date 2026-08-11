'use client';

// 클라이언트 전용 익명 세션 ID(sessionStorage — 탭 단위) + "지금 보고 있는 단지명"
// 공유 상태. ViewTracker(전역 하트비트)와 apt-client.tsx(상세페이지 진입) 양쪽이
// 이 모듈을 통해서만 상태를 주고받는다 — props drilling이나 Context 없이 가볍게
// 연결하기 위함이다(둘 다 클라이언트 컴포넌트, 같은 브라우저 탭 안에서만 유효).

const SESSION_KEY = 'egip_session_id';

export function getClientSessionId(): string {
  if (typeof window === 'undefined') return '';
  let id = sessionStorage.getItem(SESSION_KEY);
  if (!id) {
    id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

let currentAptName: string | null = null;

export function setCurrentAptName(name: string | null) {
  currentAptName = name;
}

export function getCurrentAptName(): string | null {
  return currentAptName;
}
