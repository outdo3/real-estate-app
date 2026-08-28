'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  buildShareUrl,
  copyToClipboard,
  nativeShare,
  loadKakaoShareSdk,
  ensureKakaoInitialized,
  isKakaoShareReady,
  sendKakaoShare,
  buildKakaoShareImageUrl,
} from '@/lib/share/shareUtils';

export type ShareStatus = 'idle' | 'shared' | 'copied' | 'error';

export interface UseSharePageOptions {
  /** 카카오 카드/네이티브 공유 시트의 제목. */
  title: string;
  /** 카카오 카드 설명 / 네이티브 공유의 본문. 없으면 title을 그대로 재사용한다. */
  text?: string;
  /** 현재 URL의 쿼리스트링에 추가/덮어쓸 값(지역/기간/필터 등 client-only state 보존용). */
  params?: Record<string, string | null | undefined>;
  /**
   * GLOBAL SHARE SYSTEM V1 §4 — 공통 공유는 Web Share API를 최우선으로 쓰고, 네이티브
   * 공유가 없는 환경(주로 데스크톱)에서만 이미 안정적으로 검증된 카카오 공유 카드로
   * 보강한다(별도 이미지 자산 불필요, 브랜드 공용 이미지 재사용). 기존 KakaoShareButton
   * 3개 호출부(아파트 상세/StickyActionBar/학교 상세)는 이 훅을 쓰지 않고 카카오 우선
   * 순서를 그대로 유지해 회귀하지 않는다.
   */
  enableKakao?: boolean;
}

export function useSharePage({ title, text, params, enableKakao = true }: UseSharePageOptions) {
  const [status, setStatus] = useState<ShareStatus>('idle');

  // 카카오 SDK는 클릭 시점에 처음 로드하면 sendDefault 호출이 더 이상 "사용자가 직접
  // 클릭한 동기 실행 흐름"이 아니게 돼 팝업이 차단될 수 있다(KakaoShareButton에서 실측
  // 확인된 문제) — 컴포넌트가 마운트되는 시점에 미리 로드/초기화해둔다.
  useEffect(() => {
    if (!enableKakao) return;
    loadKakaoShareSdk()
      .then(() => ensureKakaoInitialized())
      .catch(() => {});
  }, [enableKakao]);

  const resetSoon = useCallback(() => {
    setTimeout(() => setStatus('idle'), 2000);
  }, []);

  const share = useCallback(async () => {
    const url = buildShareUrl(params);
    if (!url) return;

    const nativeResult = await nativeShare({ title, text, url });
    if (nativeResult === 'shared') {
      setStatus('shared');
      resetSoon();
      return;
    }
    if (nativeResult === 'aborted') {
      // 사용자가 공유 시트를 닫은 정상 취소 — 오류로 처리하지 않는다.
      return;
    }

    if (enableKakao && isKakaoShareReady()) {
      try {
        sendKakaoShare({ title, description: text || title, url, imageUrl: buildKakaoShareImageUrl() });
        setStatus('idle');
        return;
      } catch {
        // 카카오 콘솔에서 "카카오톡 공유" 제품이 비활성화된 경우 등 — 아래 클립보드로 폴백.
      }
    }

    const copied = await copyToClipboard(url);
    setStatus(copied ? 'copied' : 'error');
    resetSoon();
  }, [title, text, params, enableKakao, resetSoon]);

  return { status, share };
}
