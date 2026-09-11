'use client';

import { useCallback, useState } from 'react';
import {
  buildShareUrl,
  copyToClipboard,
  nativeShare,
  isKakaoShareReady,
  sendKakaoShare,
  buildKakaoShareImageUrl,
} from '@/lib/share/shareUtils';
import { useKakaoSharePreload } from './useKakaoSharePreload';
import type { EjipShareType } from '@/lib/share/ejipShareCard';
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
   * SHARE_CARD_UNIFICATION_V1 §3 — 이 화면의 공유 카드 성격. CTA 버튼 라벨이 여기서
   * 갈린다(단지=자세히 보기 / 통계=통계 보기 / 비교=비교 보기 / 리포트=리포트 보기).
   */
  shareType?: EjipShareType;
  /**
   * GLOBAL SHARE SYSTEM V1 §4 / SHARE_CARD_UNIFICATION_V1 §2 — 카카오 브랜드 카드 사용 여부.
   *
   * 예전에는 이 훅이 navigator.share를 **먼저** 호출하고, 네이티브 공유가 없는 환경
   * (주로 데스크톱)에서만 카카오 카드로 보강했다. 그런데 모바일에는 navigator.share가
   * 항상 있으므로 실제 사용자(안드로이드 카카오톡)는 카카오 카드 분기에 영영 도달하지
   * 못했고, OS가 title+text+url을 이어붙인 평문을 카카오톡에 넘겨 **일반 OG 미리보기**가
   * 떴다 — 아파트 상세(KakaoShareButton)만 브랜드 카드가 나오던 이유다.
   *
   * 이제 두 경로의 우선순위를 아파트 상세 쪽(실전 검증된 브랜드 카드)으로 통일한다.
   */
  enableKakao?: boolean;
}

export function useSharePage({ title, text, params, url: explicitUrl, shareType = 'generic', enableKakao = true }: UseSharePageOptions) {
  const [status, setStatus] = useState<ShareStatus>('idle');

  // SDK 선로드 규칙(팝업 차단 회피 + idle 지연)은 ReportActions와 공유한다.
  useKakaoSharePreload(enableKakao);

  const resetSoon = useCallback(() => {
    setTimeout(() => setStatus('idle'), 2000);
  }, []);

  const share = useCallback(async () => {
    // 호출부가 canonical 링크를 준 경우 주소창을 보지 않는다(§6).
    const url = explicitUrl || buildShareUrl(params);
    if (!url) return;

    // SHARE_CARD_UNIFICATION_V1 §2-A — 카카오 SDK가 준비돼 있으면 브랜드 카드가 1순위다.
    //
    // **await보다 먼저** 와야 한다. 한 번이라도 await를 거치면 브라우저가 사용자 제스처
    // 흐름이 끊긴 것으로 보고 sendDefault 내부의 window.open()을 차단하고, 그 반환값이
    // null이라 조용히 실패한다(KakaoShareButton에서 실측 확인된 문제).
    if (enableKakao && isKakaoShareReady()) {
      try {
        sendKakaoShare({
          type: shareType,
          title,
          description: text || title,
          url,
          imageUrl: buildKakaoShareImageUrl(),
        });
        // ANALYTICS V1 — 카카오 SDK는 실제 전송 완료를 알려주는 콜백이 없다(fire-and-forget
        // 팝업 트리거일 뿐). 성공 여부를 신뢰성 있게 판별할 수 없으므로 share_success가
        // 아닌 share_attempt로 기록한다.
        trackEvent('share_attempt');
        setStatus('idle');
        return;
      } catch {
        // 카카오 콘솔에서 "카카오톡 공유" 제품이 비활성화됐거나, 오리진을 절대 URL로
        // 만들지 못한 경우(빌더가 던짐) — 아래 네이티브 공유로 폴백한다(§16).
      }
    }

    // §2-B — 카카오가 없거나 실패하면 OS 공유 시트. 제목 + 짧은 설명 + canonical URL.
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

    // §2-C — 둘 다 없으면 링크 복사.
    const copied = await copyToClipboard(url);
    if (copied) {
      // ANALYTICS V1 — navigator.clipboard.writeText가 실제로 resolve된 시점(진짜 완료 확인).
      trackEvent('share_success');
    }
    setStatus(copied ? 'copied' : 'error');
    resetSoon();
  }, [title, text, params, explicitUrl, shareType, enableKakao, resetSoon]);

  return { status, share };
}
