'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Share2 } from 'lucide-react';
import styles from './KakaoShareButton.module.css';

interface KakaoShareButtonProps {
  title: string;
  description: string;
  /** true면 카카오 브랜드 노란 버튼 대신, Hero 등 다른 요소 옆에 자연스럽게 붙는
   *  작고 중립적인 아이콘+텍스트 버튼으로 렌더한다. 공유 로직(navigator.share →
   *  카카오 SDK → 클립보드 폴백)은 완전히 동일하고 겉모습만 다르다. */
  compact?: boolean;
  /** APT DETAIL CONSISTENCY HOTFIX V1 §19 — compact 버튼의 기본(idle) 상태 라벨.
   *  기본값 '공유하기'는 Hero/학교상세 등 기존 호출부 동작을 그대로 유지하고,
   *  StickyActionBar만 짧은 '공유'를 넘겨 3-action bar 폭을 좁게 유지한다. */
  label?: string;
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
export default function KakaoShareButton({ title, description, compact, label = '공유하기' }: KakaoShareButtonProps) {
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

  // 카카오톡 Feed 카드는 실기기에서 1200x630 원본을 정사각형에 가깝게 crop해서 보여준다
  // (좌우로 약 24%씩 잘려나가는 것을 실측 확인) — SEO/Twitter용 OG 이미지(og-main, 좌측
  // 로고+우측 캐릭터+하단 메뉴 배너 레이아웃)를 그대로 쓰면 왼쪽 로고가 잘리고 하단 메뉴
  // UI까지 노출돼 카드가 복잡해 보인다. 그래서 카카오 공유 전용으로 중앙 정렬 + 여백을
  // 넉넉히 둔 단순한 이미지를 따로 쓴다 — OG/Twitter metadata의 og-main은 그대로 유지.
  const buildImageUrl = () => `${window.location.origin}/brand/share/ejip-kakao-share-1200x630.jpg`;

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
        { title: '이집에서 자세히 보기', link: { mobileWebUrl: url, webUrl: url } },
      ],
    });
  };

  const handleShare = async () => {
    const url = buildShareUrl();

    // 버튼이 "카카오톡으로 공유하기"를 명시하므로, 우리가 완전히 통제하는 Feed 템플릿
    // (OG 이미지 + 제목 + 설명 + "이집에서 자세히 보기" 버튼)을 최우선으로 시도한다 —
    // 이 경로는 본문에 URL 텍스트가 노출되지 않는다(link는 버튼/카드의 링크 필드에만
    // 실린다). navigator.share()로 먼저 OS 공유 시트를 띄우면 사용자가 거기서 카카오톡을
    // 선택했을 때 OS가 title+text+url을 이어붙인 일반 텍스트로 넘겨 카카오톡 채팅창에
    // 긴 URL이 그대로 보이는 문제가 있었다 — 그래서 카카오 전용 버튼에서는 이 경로를
    // 더 이상 최우선으로 쓰지 않는다.
    // SDK는 마운트 시점에 이미 로드/초기화해뒀으므로(sdkReadyRef), 여기서 await 없이
    // 동기적으로 호출해야 브라우저가 팝업을 차단하지 않는다(loadKakaoShareSdk 주석 참고).
    if (getAppKey() && sdkReadyRef.current && window.Kakao?.isInitialized?.()) {
      try {
        sendShare();
        setStatus('idle');
        return;
      } catch {
        // 카카오 제품(공유하기)이 콘솔에서 비활성화돼 있는 등 호출 자체가 실패하면
        // 아래 경로로 계속 폴백한다.
      }
    }

    // 카카오 SDK가 아직 준비되지 않았거나(마운트 직후 클릭 등) 키가 없는 경우의 폴백.
    // navigator.share()는 window.open 기반이 아니라 팝업 차단 문제가 없는 안정적인
    // 경로라 — SDK를 새로 await해서 재시도하는 것보다 이쪽이 더 안전하다.
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title, text: description, url });
        setStatus('idle');
        return;
      } catch (e) {
        // 사용자가 공유 시트에서 취소한 경우(AbortError)는 실패가 아니라 정상 취소이므로
        // 에러 상태로 넘어가지 않는다.
        if (e instanceof Error && e.name === 'AbortError') return;
        // 그 외 실패면 아래 클립보드 복사로 계속 폴백한다.
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setStatus('copied');
      setTimeout(() => setStatus('idle'), 2000);
    } catch {
      setStatus('error');
      setTimeout(() => setStatus('idle'), 2000);
    }
  };

  if (compact) {
    return (
      <button type="button" onClick={handleShare} className={styles.shareBtn} title="공유하기">
        {status === 'copied' ? (
          '복사됨'
        ) : status === 'error' ? (
          '공유 실패'
        ) : (
          <>
            <Share2 className={styles.icon} aria-hidden="true" />
            {label}
          </>
        )}
      </button>
    );
  }

  return (
    <button type="button" onClick={handleShare} className={styles.fullBtn} title="카카오톡으로 공유하기">
      💬 {status === 'copied' ? '링크가 복사되었습니다' : status === 'error' ? '공유에 실패했습니다' : '카카오톡으로 공유하기'}
    </button>
  );
}
