'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildCanonicalShareUrl,
  copyToClipboard,
  nativeShare,
  isKakaoShareReady,
  sendKakaoShare,
  buildKakaoShareImageUrl,
  loadKakaoShareSdk,
  ensureKakaoInitialized,
  type NativeShareResult,
} from '@/lib/share/shareUtils';
import { resolveShareChannels, type ShareChannelAvailability } from '@/lib/share/shareChannels';
import { useKakaoSharePreload } from './useKakaoSharePreload';
import type { EjipShareType } from '@/lib/share/ejipShareCard';
import { trackEvent } from '@/lib/analytics/trackEvent';

/**
 * SHARE_UX_V2 §2/§3 — 공유는 **캐스케이드가 아니라 사용자 선택**이다.
 *
 * 기존 useSharePage는 카카오 → 네이티브 → 복사 순으로 **코드가 골랐다**. 모바일에서는
 * 카카오 SDK가 항상 준비되므로 첫 분기에서 끝났고, OS 공유 시트에는 영영 도달하지
 * 못했다. 그래서 카카오톡을 두 개 쓰는 사용자(듀얼 메신저/업무용 프로필)는 **어느
 * 카카오톡으로 보낼지 고를 방법이 없었다** — OS 시트가 그 선택이 일어나는 유일한
 * 장소인데 그 시트가 열리지 않았기 때문이다.
 *
 * 이제 세 경로를 **동시에 보여주고** 사용자가 고른다.
 *   [카카오톡]  = 이집 브랜드 카드로 바로 전송(기존 경로 그대로)
 *   [공유하기]  = OS 공유 시트 → 여기서 어느 앱/어느 카카오톡인지 사용자가 고른다
 *   [링크 복사] = 항상 되는 최후 경로
 *
 * 이집은 **특정 카카오톡 인스턴스를 코드에서 고르지 않는다.** 그것은 OS/카카오 앱의
 * 권한이고, 우리가 할 수 있고 해야 하는 일은 그 선택 화면으로 가는 길을 막지 않는 것이다.
 */
export interface ShareTargetOptions {
  /** 카카오 카드/네이티브 공유 시트의 제목. */
  title: string;
  /** 카카오 카드 설명 / 네이티브 공유의 본문. 없으면 title을 그대로 재사용한다. */
  text?: string;
  /** 현재 URL의 쿼리스트링에 추가/덮어쓸 값(지역/기간/필터 등 client-only state 보존용). */
  params?: Record<string, string | null | undefined>;
  /**
   * COMPARE_SHARE_URL_COMPACT_FIX_V1 §6 — 공유할 URL을 호출부가 직접 정한다.
   * 기본 동작(params)은 현재 주소창 경로를 따르지만, 복원용 파라미터가 잔뜾 붙는
   * 화면은 자기만의 canonical 링크를 알고 있으므로 그걸 그대로 쓴다.
   */
  url?: string;
  /** SHARE_CARD_UNIFICATION_V1 §3 — 카드 CTA 라벨을 가르는 공유 성격. */
  shareType?: EjipShareType;
  /** 카카오 브랜드 카드 사용 여부. false면 카카오 행을 그리지 않는다. */
  enableKakao?: boolean;
}

export type ShareChannel = 'kakao' | 'native' | 'copy';
export type ShareSheetStatus = 'idle' | 'copied' | 'copy_failed' | 'kakao_failed';

export interface UseShareSheetOptions extends ShareTargetOptions {
  /**
   * 네이티브 공유 경로를 호출부가 직접 처리해야 할 때(리포트의 PNG 첨부 공유 등).
   * 주지 않으면 표준 navigator.share를 쓴다.
   */
  onNativeShare?: (payload: { title: string; text?: string; url: string }) => Promise<NativeShareResult>;
  /** 화면 고유 분석 이벤트를 추가로 남기고 싶을 때(리포트의 report_share 등). */
  onChannel?: (channel: ShareChannel) => void;
}

export function useShareSheet({
  title,
  text,
  params,
  url: explicitUrl,
  shareType = 'generic',
  enableKakao = true,
  onNativeShare,
  onChannel,
}: UseShareSheetOptions) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<ShareSheetStatus>('idle');
  const [kakaoReady, setKakaoReady] = useState(false);
  const [nativeReady, setNativeReady] = useState(false);
  const [url, setUrl] = useState('');
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // SDK 선로드 규칙(팝업 차단 회피 + idle 지연)은 기존 훅과 공유한다.
  useKakaoSharePreload(enableKakao);

  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
  }, []);

  const resetSoon = useCallback(() => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setStatus('idle'), 2500);
  }, []);

  /**
   * §4 — 시트를 여는 순간의 실제 능력으로 행을 정한다. 쓸 수 없는 채널은 그리지 않는다
   * (PC Firefox처럼 navigator.share가 없는 곳에 "공유하기"를 두면 눌러도 아무 일이
   * 없는 dead button이 된다).
   */
  const channels: ShareChannelAvailability = useMemo(
    () =>
      resolveShareChannels({
        kakaoReady: enableKakao && kakaoReady,
        hasNativeShare: nativeReady,
      }),
    [enableKakao, kakaoReady, nativeReady]
  );

  const openSheet = useCallback(() => {
    setStatus('idle');
    setUrl(buildCanonicalShareUrl(params, explicitUrl));
    // 가용성은 **시트를 여는 순간**에 재다다. 렌더 시점에 한 번 재고 말면
    // SSR/hydration 순간의 값이 그대로 굳어 실제로는 없는 채널을 그릴 수 있다.
    setKakaoReady(isKakaoShareReady());
    setNativeReady(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
    setOpen(true);
    // 아직 SDK가 안 붙었으면(진입 직후 클릭 등) 지금 붙이고, 끝나면 카카오 행을 띄운다.
    if (enableKakao && !isKakaoShareReady()) {
      loadKakaoShareSdk()
        .then(() => setKakaoReady(ensureKakaoInitialized() && isKakaoShareReady()))
        .catch(() => {});
    }
  }, [params, explicitUrl, enableKakao]);

  const closeSheet = useCallback(() => {
    setOpen(false);
    setStatus('idle');
  }, []);

  /**
   * 카카오 브랜드 카드. **동기 함수여야 한다** — await가 한 번이라도 끼면 브라우저가
   * 사용자 제스처 흐름이 끊긴 것으로 보고 sendDefault 내부의 window.open()을 차단하고,
   * 반환값이 null이라 카카오 SDK가 .focus()에서 조용히 죽는다(실측 확인).
   * 시트의 행 클릭 자체가 사용자 제스처이므로 이 조건은 그대로 지켜진다.
   */
  const shareKakao = useCallback(() => {
    if (!url) return;
    try {
      sendKakaoShare({
        type: shareType,
        title,
        description: text || title,
        url,
        imageUrl: buildKakaoShareImageUrl(),
      });
      // 카카오 SDK는 전송 완료 콜백이 없다 — 보낸 척하지 않고 attempt로만 남긴다.
      trackEvent('share_attempt');
      trackEvent('share_kakao');
      onChannel?.('kakao');
      setOpen(false);
    } catch {
      // 카카오 콘솔에서 공유 제품이 꺼져 있거나 절대 URL 조립에 실패한 경우.
      // 시트는 닫지 않는다 — 사용자가 바로 다른 채널을 고를 수 있어야 한다.
      setStatus('kakao_failed');
      setKakaoReady(false);
      resetSoon();
    }
  }, [url, shareType, title, text, onChannel, resetSoon]);

  const shareNative = useCallback(async () => {
    if (!url) return;
    const run = onNativeShare || nativeShare;
    const result = await run({ title, text, url });
    if (result === 'shared') {
      trackEvent('share_success');
      trackEvent('share_native');
      onChannel?.('native');
      setOpen(false);
      return;
    }
    // §7 — AbortError(사용자가 공유창을 닫음)는 실패가 아니다. 에러 토스트를 띄우지
    // 않고 이벤트도 남기지 않는다. 시트는 열어둬 다른 채널을 고를 수 있게 한다.
    if (result === 'aborted') return;
    // 지원하지 않거나 실패 → 링크 복사로 안내한다(자동 전환하지 않는다).
    setStatus('copy_failed');
    resetSoon();
  }, [url, title, text, onNativeShare, onChannel, resetSoon]);

  const shareCopy = useCallback(async () => {
    if (!url) return;
    const copied = await copyToClipboard(url);
    if (copied) {
      trackEvent('share_success');
      trackEvent('share_copy');
      onChannel?.('copy');
      setStatus('copied');
      resetSoon();
      return;
    }
    // 복사 실패 → URL을 화면에 그대로 보여준다(시트를 닫지 않는다).
    setStatus('copy_failed');
  }, [url, onChannel, resetSoon]);

  return { open, openSheet, closeSheet, channels, url, status, shareKakao, shareNative, shareCopy };
}
