'use client';

// COMMUNITY_EDITOR_V2 — 저장하지 않은 글이 있을 때 이탈 경고.
//
//  - 탭 닫기/새로고침/외부 이동: beforeunload
//  - 화면 안 링크(하단 내비 등): 문서 캡처 단계에서 같은 출처 <a> 클릭을 가로채 confirm
//  - 뒤로 가기(헤더 뒤로 버튼·취소 버튼의 router.back(), Android 시스템 뒤로 제스처): 같은 URL의 history 항목을 하나
//    더 쌓아 두고 popstate에서 confirm. 취소하면 항목을 다시 쌓고, 확인하면 한 번 더 뒤로 간다.
//    Next App Router는 history.state의 내부 값이 없으면 새로고침하므로 기존 state를 복사해서 쌓는다.
//  저장 성공 후에는 release()로 끄고, 쌓아 둔 항목은 router.replace로 덮는다.
import { useCallback, useEffect, useRef } from 'react';

export const LEAVE_CONFIRM_MESSAGE = '작성 중인 내용이 저장되지 않았어요. 나가시겠어요?';
const GUARD_KEY = '__ejipLeaveGuard';

export function useLeaveGuard(active: boolean, message: string = LEAVE_CONFIRM_MESSAGE) {
  const activeRef = useRef(active);
  const releasedRef = useRef(false);
  const leavingRef = useRef(false);
  const pushedRef = useRef(false);

  useEffect(() => {
    activeRef.current = active && !releasedRef.current;
  }, [active]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!activeRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const onClick = (event: MouseEvent) => {
      if (!activeRef.current || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (!window.confirm(message)) {
        event.preventDefault();
        event.stopPropagation();
      } else {
        activeRef.current = false;
      }
    };
    const onPopState = () => {
      if (leavingRef.current || !pushedRef.current) return;
      if (!activeRef.current) {
        // 편집했다가 원래대로 되돌린 경우: 쌓아 둔 같은 URL 항목에서 한 번 더 뒤로 가 사용자가 두 번 누르지 않게 한다.
        if (!releasedRef.current) {
          leavingRef.current = true;
          window.history.back();
        }
        return;
      }
      if (window.confirm(message)) {
        leavingRef.current = true;
        activeRef.current = false;
        window.history.back();
      } else {
        window.history.pushState({ ...(window.history.state ?? {}), [GUARD_KEY]: true }, '', window.location.href);
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('popstate', onPopState);
    };
  }, [message]);

  // 처음 편집 상태가 되는 순간 한 번만 같은 URL 항목을 쌓는다.
  useEffect(() => {
    if (!active || pushedRef.current || releasedRef.current) return;
    window.history.pushState({ ...(window.history.state ?? {}), [GUARD_KEY]: true }, '', window.location.href);
    pushedRef.current = true;
  }, [active]);

  /** 저장 성공 등으로 경고를 끈다. 호출 후 router.replace로 이동하면 쌓아 둔 항목이 새 화면으로 덮인다. */
  const release = useCallback(() => {
    releasedRef.current = true;
    activeRef.current = false;
  }, []);

  /** 취소 버튼: 경고(필요 시)를 거쳐 뒤로 간다. */
  const requestLeave = useCallback(
    (leave: () => void) => {
      if (activeRef.current && !window.confirm(message)) return;
      leavingRef.current = true;
      activeRef.current = false;
      if (pushedRef.current) window.history.go(-2);
      else leave();
    },
    [message]
  );

  return { release, requestLeave };
}
