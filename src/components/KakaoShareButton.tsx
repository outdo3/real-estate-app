'use client';

import React, { useState } from 'react';
import { absoluteUrl } from '@/config/site';

interface KakaoShareButtonProps {
  title: string;
  description: string;
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
    script.addEventListener('error', () => reject(new Error('카카오 SDK 로드 실패')));
  });

  return kakaoShareSdkPromise;
}

// 카카오 디벨로퍼스 콘솔에서 "카카오톡 공유" 제품이 활성화돼 있지 않으면 Kakao.Share 호출이
// 실패할 수 있다 — 이 경우 URL을 클립보드에 복사하는 것으로 폴백해 완전히 막히지 않게 한다.
export default function KakaoShareButton({ title, description }: KakaoShareButtonProps) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle');

  const handleShare = async () => {
    const url = window.location.href;
    const appKey = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY || process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;

    try {
      if (!appKey) throw new Error('카카오 키 없음');
      await loadKakaoShareSdk();
      if (!window.Kakao.isInitialized()) {
        window.Kakao.init(appKey);
      }
      window.Kakao.Share.sendDefault({
        objectType: 'feed',
        content: {
          title,
          description,
          imageUrl: absoluteUrl('/og-image.png'),
          link: { mobileWebUrl: url, webUrl: url },
        },
        buttons: [
          { title: '자세히 보기', link: { mobileWebUrl: url, webUrl: url } },
        ],
      });
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

  return (
    <button
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
