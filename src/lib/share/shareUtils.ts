// GLOBAL SHARE SYSTEM V1 — 공유 실행에 필요한 순수 로직(카카오 SDK 로더/URL 조합/
// 클립보드/네이티브 공유)을 한 곳에 모은다. 기존 KakaoShareButton이 이미 실전에서
// 검증한 구현(SDK 사전 로드로 팝업 차단 회피, location.origin 기반 URL 조합, AbortError
// 정상 취소 처리 등)을 그대로 옮겨왔다 — 새 로직을 발명하지 않고 재사용한다.

declare global {
  interface Window {
    Kakao: any;
  }
}

let kakaoShareSdkPromise: Promise<void> | null = null;

// 지도(Maps) SDK와는 별개인 카카오 JavaScript SDK(공유하기)를 필요할 때 한 번만 로드한다.
export function loadKakaoShareSdk(): Promise<void> {
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
      // 카카오 공유를 막아버리므로, 다음 시도에서 다시 로드를 시도할 수 있도록 캐시를 비운다.
      kakaoShareSdkPromise = null;
      reject(new Error('카카오 SDK 로드 실패'));
    });
  });

  return kakaoShareSdkPromise;
}

export function getKakaoAppKey(): string | undefined {
  return process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY || process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;
}

export function ensureKakaoInitialized(): boolean {
  if (typeof window === 'undefined') return false;
  const appKey = getKakaoAppKey();
  if (!appKey || !window.Kakao) return false;
  if (!window.Kakao.isInitialized()) {
    window.Kakao.init(appKey);
  }
  return true;
}

export function isKakaoShareReady(): boolean {
  return typeof window !== 'undefined' && !!getKakaoAppKey() && !!window.Kakao?.isInitialized?.();
}

// 카카오 Feed 카드 전용 공유 이미지 — OG/Twitter용 og-main 이미지는 좌측 로고+우측
// 캐릭터+하단 메뉴 배너 레이아웃이라, 카카오톡이 정사각형에 가깝게 crop하면(실측 좌우
// 약 24%씩 잘림) 로고가 잘리고 메뉴 UI까지 노출된다. 그래서 중앙 정렬 + 여백을 넉넉히
// 둔 브랜드 공용 이미지를 카카오 공유 전용으로 따로 쓴다(페이지별 이미지 자산 불필요 —
// 모든 페이지가 동일한 이미지를 재사용할 수 있어 이 공통 시스템에 그대로 재사용 가능).
export const KAKAO_SHARE_IMAGE_PATH = '/brand/share/ejip-kakao-share-1200x630.jpg';

export function buildKakaoShareImageUrl(): string {
  if (typeof window === 'undefined') return KAKAO_SHARE_IMAGE_PATH;
  return `${window.location.origin}${KAKAO_SHARE_IMAGE_PATH}`;
}

export function sendKakaoShare({
  title,
  description,
  url,
  imageUrl,
}: {
  title: string;
  description: string;
  url: string;
  imageUrl: string;
}) {
  window.Kakao.Share.sendDefault({
    objectType: 'feed',
    content: {
      title,
      description,
      imageUrl,
      link: { mobileWebUrl: url, webUrl: url },
    },
    buttons: [{ title: '이집에서 자세히 보기', link: { mobileWebUrl: url, webUrl: url } }],
  });
}

// 현재 페이지의 origin+pathname+search를 조합해 공유 URL을 만든다. NEXT_PUBLIC_APP_URL
// 같은 빌드타임 환경변수 대신 항상 지금 실제로 열려있는 도메인을 쓴다(프리뷰 배포에서도
// 정확한 URL 보장, localhost를 프로덕션으로 잘못 강제하지 않음). extraParams가 있으면
// 기존 쿼리스트링은 보존한 채 위에 추가/덮어쓴다(값이 없는 항목은 넣지 않음) — 지역/
// 기간/필터처럼 client state로만 존재하는 값을 공유 링크에 실어 보내기 위함이다.
export function buildShareUrl(extraParams?: Record<string, string | null | undefined>): string {
  if (typeof window === 'undefined') return '';
  const url = new URL(window.location.href);
  if (extraParams) {
    Object.entries(extraParams).forEach(([key, value]) => {
      if (value) url.searchParams.set(key, value);
    });
  }
  return `${url.origin}${url.pathname}${url.search}`;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export type NativeShareResult = 'shared' | 'aborted' | 'unsupported' | 'failed';

export async function nativeShare(payload: { title: string; text?: string; url: string }): Promise<NativeShareResult> {
  if (typeof navigator === 'undefined' || !navigator.share) return 'unsupported';
  try {
    await navigator.share(payload);
    return 'shared';
  } catch (e) {
    // 사용자가 공유 시트를 닫은 경우(AbortError)는 실패가 아니라 정상 취소다.
    if (e instanceof Error && e.name === 'AbortError') return 'aborted';
    return 'failed';
  }
}
