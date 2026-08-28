'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Share2 } from 'lucide-react';
import {
  buildShareUrl,
  buildKakaoShareImageUrl,
  copyToClipboard,
  loadKakaoShareSdk,
  ensureKakaoInitialized,
  getKakaoAppKey,
  sendKakaoShare,
  nativeShare,
} from '@/lib/share/shareUtils';
import styles from './KakaoShareButton.module.css';

interface KakaoShareButtonProps {
  title: string;
  description: string;
  /** true면 카카오 브랜드 노란 버튼 대신, Hero 등 다른 요소 옆에 자연스럽게 붙는
   *  작고 중립적인 아이콘+텍스트 버튼으로 렌더한다. 공유 로직(카카오 SDK → navigator.share
   *  → 클립보드 폴백)은 완전히 동일하고 겉모습만 다르다. */
  compact?: boolean;
  /** APT DETAIL CONSISTENCY HOTFIX V1 §19 — compact 버튼의 기본(idle) 상태 라벨.
   *  기본값 '공유하기'는 Hero/학교상세 등 기존 호출부 동작을 그대로 유지하고,
   *  StickyActionBar만 짧은 '공유'를 넘겨 3-action bar 폭을 좁게 유지한다. */
  label?: string;
}

// GLOBAL SHARE SYSTEM V1 §11 — 이 컴포넌트는 이미 안정적으로 동작 중인 3개 호출부
// (아파트 상세 Hero, StickyActionBar, 학교 상세)를 위해 그대로 남겨둔다. 겉모습/props/
// 공유 우선순위(카카오 우선)는 전혀 바뀌지 않았고, 내부에서 URL 조합·카카오 SDK 로더·
// 클립보드 복사만 새 공통 유틸(src/lib/share/shareUtils.ts)로 옮겨 재사용한다 — 새로
// 만드는 페이지가 쓰는 ShareAction/useSharePage와 같은 저수준 로직을 공유해 중복을
// 없앤다(회귀 없는 리팩터링).
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
        if (ensureKakaoInitialized()) sdkReadyRef.current = true;
      })
      .catch(() => {});
  }, []);

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
    if (getKakaoAppKey() && sdkReadyRef.current && window.Kakao?.isInitialized?.()) {
      try {
        sendKakaoShare({ title, description, url, imageUrl: buildKakaoShareImageUrl() });
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
    const nativeResult = await nativeShare({ title, text: description, url });
    if (nativeResult === 'shared') {
      setStatus('idle');
      return;
    }
    if (nativeResult === 'aborted') {
      // 사용자가 공유 시트에서 취소한 경우는 실패가 아니라 정상 취소이므로 에러 상태로
      // 넘어가지 않는다.
      return;
    }

    const copied = await copyToClipboard(url);
    setStatus(copied ? 'copied' : 'error');
    setTimeout(() => setStatus('idle'), 2000);
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
