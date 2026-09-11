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
import { trackEvent } from '@/lib/analytics/trackEvent';

export type ShareStatus = 'idle' | 'shared' | 'copied' | 'error';

export interface UseSharePageOptions {
  /** 카카오 카드/네이티브 공유 시트의 제목. */
  title: string;
  /** 카카오 카드 설명 / 네이티브 공유의 본문. 없으면 title을 그대로 재사용한다. */
  text?: string;
  /** 현재 URL의 쿼리스트링에 추가/덮어쓸 값(지역/기간/필터 등 client-only state 보존용). */
  params?: Record<string, string | null | undefined>;
  /**
   * COMPARE_SHARE_URL_COMPACT_FIX_V1 §6 — 공유할 절대 URL을 호출부가 직접 정한다.
   *
   * 기본 동작(params)은 **현재 주소창 URL을 그대로 복사**해 값을 덧씌운다. 화면 상태가
   * 전부 쿼리스트링에 있는 통계 화면에는 맞지만, 주소창에 복원용 파라미터가 잔뜩 붙는
   * 화면에서는 그 쓰레기까지 공유 링크에 딸려 간다. 그런 화면은 자기만의 canonical
   * 링크를 알고 있으므로 그걸 그대로 쓴다.
   */
  url?: string;
  /**
   * GLOBAL SHARE SYSTEM V1 §4 — 공통 공유는 Web Share API를 최우선으로 쓰고, 네이티브
   * 공유가 없는 환경(주로 데스크톱)에서만 이미 안정적으로 검증된 카카오 공유 카드로
   * 보강한다(별도 이미지 자산 불필요, 브랜드 공용 이미지 재사용). 기존 KakaoShareButton
   * 3개 호출부(아파트 상세/StickyActionBar/학교 상세)는 이 훅을 쓰지 않고 카카오 우선
   * 순서를 그대로 유지해 회귀하지 않는다.
   */
  enableKakao?: boolean;
}

export function useSharePage({ title, text, params, url: explicitUrl, enableKakao = true }: UseSharePageOptions) {
  const [status, setStatus] = useState<ShareStatus>('idle');

  // 카카오 SDK는 클릭 시점에 처음 로드하면 sendDefault 호출이 더 이상 "사용자가 직접
  // 클릭한 동기 실행 흐름"이 아니게 돼 팝업이 차단될 수 있다(KakaoShareButton에서 실측
  // 확인된 문제) — 그래서 클릭 전에 미리 로드해두는 것 자체는 그대로 유지한다.
  //
  // PERCEIVED_PERFORMANCE_V2_5 §3 — 다만 **마운트 즉시**는 너무 이르다. /map 실측
  // waterfall에서 이 스크립트(developers.kakao.com/sdk/js/kakao.js)는 3,587~6,740ms에
  // 걸쳐 받아지는데, 하필 지도 모듈(t1.daumcdn.net)과 첫 타일(mts.daumcdn.net)이
  // 대역폭을 다투는 바로 그 구간이다. 공유 SDK는 첫 화면에 필요하지 않다.
  //
  // 그래서 브라우저가 한가해진 뒤로 미룬다. requestIdleCallback이 없으면 짧은 타이머로
  // 대체한다. 사용자가 공유를 누르기까지는 어떤 경우에도 이보다 훨씬 오래 걸리므로
  // "클릭 전에 이미 로드돼 있다"는 성질(=팝업 차단 방지)은 그대로 지켜진다.
  useEffect(() => {
    if (!enableKakao) return;
    let cancelled = false;
    const start = () => {
      if (cancelled) return;
      loadKakaoShareSdk()
        .then(() => ensureKakaoInitialized())
        .catch(() => {});
    };
    const w = typeof window !== 'undefined' ? (window as typeof window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    }) : undefined;
    if (w?.requestIdleCallback) {
      const id = w.requestIdleCallback(start, { timeout: 4000 });
      return () => { cancelled = true; w.cancelIdleCallback?.(id); };
    }
    const t = setTimeout(start, 2000);
    return () => { cancelled = true; clearTimeout(t); };
  }, [enableKakao]);

  const resetSoon = useCallback(() => {
    setTimeout(() => setStatus('idle'), 2000);
  }, []);

  const share = useCallback(async () => {
    // 호출부가 canonical 링크를 준 경우 주소창을 보지 않는다(§6).
    const url = explicitUrl || buildShareUrl(params);
    if (!url) return;

    const nativeResult = await nativeShare({ title, text, url });
    if (nativeResult === 'shared') {
      // ANALYTICS V1 — Web Share API의 promise가 resolve된 시점 = 브라우저가 공유 완료를
      // 확인해준 시점이므로 share_success로 기록한다(과장 아님, 실제 확인 가능).
      trackEvent('share_success');
      setStatus('shared');
      resetSoon();
      return;
    }
    if (nativeResult === 'aborted') {
      // 사용자가 공유 시트를 닫은 정상 취소 — 오류로 처리하지 않는다. 이벤트도 기록하지 않는다.
      return;
    }

    if (enableKakao && isKakaoShareReady()) {
      try {
        sendKakaoShare({ title, description: text || title, url, imageUrl: buildKakaoShareImageUrl() });
        // ANALYTICS V1 — 카카오 SDK는 실제 전송 완료를 알려주는 콜백이 없다(fire-and-forget
        // 팝업 트리거일 뿐). 성공 여부를 신뢰성 있게 판별할 수 없으므로 share_success가
        // 아닌 share_attempt로 기록한다.
        trackEvent('share_attempt');
        setStatus('idle');
        return;
      } catch {
        // 카카오 콘솔에서 "카카오톡 공유" 제품이 비활성화된 경우 등 — 아래 클립보드로 폴백.
      }
    }

    const copied = await copyToClipboard(url);
    if (copied) {
      // ANALYTICS V1 — navigator.clipboard.writeText가 실제로 resolve된 시점(진짜 완료 확인).
      trackEvent('share_success');
    }
    setStatus(copied ? 'copied' : 'error');
    resetSoon();
  }, [title, text, params, explicitUrl, enableKakao, resetSoon]);

  return { status, share };
}
