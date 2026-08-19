'use client';

import React, { useEffect, useRef, useState } from 'react';

interface KakaoShareButtonProps {
  title: string;
  description: string;
  /** true면 카카오 브랜드 노란 버튼 대신, Hero 등 다른 요소 옆에 자연스럽게 붙는
   *  작고 중립적인 아이콘+텍스트 버튼으로 렌더한다. 공유 로직(navigator.share →
   *  카카오 SDK → 클립보드 폴백)은 완전히 동일하고 겉모습만 다르다. */
  compact?: boolean;
}

declare global {
  interface Window {
    Kakao: any;
  }
}

let kakaoShareSdkPromise: Promise<void> | null = null;

// 지도(Maps) SDK와는 별개인 카카오 JavaScript SDK(공유하기)를 필요할 때 한 번만 로드한다.
function loadKakaoShareSdk(): Promise<void> {
  if (kakaoShareSdkPromise) return kakaoShareSdkPromise;

  kakaoShareSdkPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('no window'));
      return;
    }
    if (window.Kakao) {
      resolve();
      return;
    }
    const scriptId = 'kakao-share-sdk-script';
    let script = document.getElementById(scriptId) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement('script');
      script.id = scriptId;
      script.src = 'https://developers.kakao.com/sdk/js/kakao.js';
      document.head.appendChild(script);
    }
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () => {
      // 실패한 프로미스를 그대로 캐시해두면 일시적인 네트워크 문제가 세션 내내 영구적으로
      // 카카오 공유를 막아버리므로, 다음 클릭에서 다시 로드를 시도할 수 있도록 캐시를 비운다.
      kakaoShareSdkPromise = null;
      reject(new Error('카카오 SDK 로드 실패'));
    });
  });

  return kakaoShareSdkPromise;
}

function getAppKey(): string | undefined {
  return process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY || process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;
}

function ensureInitialized(): boolean {
  const appKey = getAppKey();
  if (!appKey || !window.Kakao) return false;
  if (!window.Kakao.isInitialized()) {
    window.Kakao.init(appKey);
  }
  return true;
}

// 카카오 디벨로퍼스 콘솔에서 "카카오톡 공유" 제품이 활성화돼 있지 않으면 Kakao.Share 호출이
// 실패할 수 있다 — 이 경우 URL을 클립보드에 복사하는 것으로 폴백해 완전히 막히지 않게 한다.
export default function KakaoShareButton({ title, description, compact }: KakaoShareButtonProps) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const sdkReadyRef = useRef(false);

  // SDK를 클릭 시점에 처음 로드하면, 로드가 끝난 뒤 Kakao.Share.sendDefault()를 호출하는
  // 시점은 더 이상 "사용자가 직접 클릭한 동기 실행 흐름"이 아니게 된다(await를 한 번이라도
  // 거치면 브라우저가 팝업 차단 대상으로 간주함). sendDefault 내부는 팝업을 열 때
  // window.open()의 반환값에 곧바로 .focus()를 호출하는데, 팝업이 차단되면 그 반환값이
  // null이라 "Cannot read properties of null (reading 'focus')" 예외로 조용히 실패한다
  // (실측 확인 — 클릭해도 아무 일도 안 일어나는 것처럼 보이던 원인). 그래서 마운트 시
  // 미리 SDK를 로드/초기화해두고, 클릭 핸들러는 이미 준비된 경우 await 없이 동기적으로
  // sendDefault를 호출해 사용자 제스처 흐름을 끊지 않는다.
  useEffect(() => {
    loadKakaoShareSdk()
      .then(() => {
        if (ensureInitialized()) sdkReadyRef.current = true;
      })
      .catch(() => {});
  }, []);

  const buildShareUrl = () => {
    // location.href를 그대로 써도 되지만, 이 페이지는 ?lawdCd=&dong= 같은 쿼리스트링에
    // 실제 지역 컨텍스트가 실려 있어(없으면 기본 지역으로 폴백) 쿼리스트링은 반드시
    // 유지해야 한다. NEXT_PUBLIC_APP_URL 같은 빌드타임 환경변수가 없어도(또는 Vercel의
    // 배포별 임시 도메인이 잡혀도) 항상 지금 실제로 열려있는 도메인을 쓰도록
    // location.origin을 직접 조합한다.
    return `${window.location.origin}${window.location.pathname}${window.location.search}`;
  };

  const buildImageUrl = () => `${window.location.origin}/brand/og/ejip-og-main-1200x630.jpg`;

  const sendShare = () => {
    const url = buildShareUrl();
    window.Kakao.Share.sendDefault({
      objectType: 'feed',
      content: {
        title,
        description,
        imageUrl: buildImageUrl(),
        link: { mobileWebUrl: url, webUrl: url },
      },
      buttons: [
        { title: '이집에서 단지정보 보기', link: { mobileWebUrl: url, webUrl: url } },
      ],
    });
  };

  const handleShare = async () => {
    const url = buildShareUrl();

    // 모바일 브라우저(iOS Safari, Android Chrome 등)는 navigator.share()를 지원하며,
    // 클릭 즉시 OS 자체 공유 시트를 띄운다 — 카카오톡이 설치돼 있으면 그 목록에 바로
    // 나타난다. 카카오 JS SDK의 sendDefault()는 데스크톱에서 팝업을 여는 방식이라
    // "사용자 클릭과 완전히 동기적으로 이어지지 않으면 팝업이 차단되고 SDK 내부에서
    // null.focus() 예외로 조용히 실패"하는 문제가 있다는 게 카카오 공식 답변으로
    // 확인됐다(devtalk.kakao.com) — 이 앱을 실제 만졌던 브라우저 환경에서도 재현됨.
    // navigator.share()는 이 문제 자체가 없는 더 안정적인 경로라 있으면 최우선으로 쓴다.
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title, text: description, url });
        setStatus('idle');
        return;
      } catch (e) {
        // 사용자가 공유 시트에서 취소한 경우(AbortError)는 실패가 아니라 정상 취소이므로
        // 에러 상태로 넘어가지 않는다.
        if (e instanceof Error && e.name === 'AbortError') return;
        // 그 외 실패면 아래 카카오 SDK/클립보드 경로로 계속 폴백한다.
      }
    }

    try {
      if (!getAppKey()) throw new Error('카카오 키 없음');

      if (sdkReadyRef.current && window.Kakao?.isInitialized?.()) {
        // 이미 준비돼 있으면 await 없이 곧바로 호출 — 클릭 이벤트와 동기적으로 이어져야
        // 브라우저가 팝업을 차단하지 않는다.
        sendShare();
      } else {
        await loadKakaoShareSdk();
        if (!ensureInitialized()) throw new Error('카카오 SDK 초기화 실패');
        sendShare();
      }
      setStatus('idle');
    } catch (e) {
      try {
        await navigator.clipboard.writeText(url);
        setStatus('copied');
        setTimeout(() => setStatus('idle'), 2000);
      } catch {
        setStatus('error');
        setTimeout(() => setStatus('idle'), 2000);
      }
    }
  };

  if (compact) {
    return (
      <button
        type="button"
        onClick={handleShare}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.4rem 0.75rem',
          backgroundColor: 'white', color: 'var(--text-secondary)', border: '1px solid var(--border-color)',
          borderRadius: '999px', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer', whiteSpace: 'nowrap',
        }}
      >
        {status === 'copied' ? '복사됨' : status === 'error' ? '공유 실패' : <>↗ 공유</>}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleShare}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1.5rem',
        backgroundColor: '#FEE500', color: '#191919', border: 'none', borderRadius: '8px',
        fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer',
      }}
    >
      💬 {status === 'copied' ? '링크가 복사되었습니다' : status === 'error' ? '공유에 실패했습니다' : '카카오톡으로 공유하기'}
    </button>
  );
}
