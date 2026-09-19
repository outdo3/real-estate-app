'use client';

// ONE_PAGE_REPORT_REDESIGN_V1 — 인스타 피드 이미지를 굽는 임시 무대.
//
// 사용자가 "인스타 피드용"을 눌렀을 때만 ReportActions가 next/dynamic으로 불러온다 — 리포트를 읽기만 하는
// 사용자의 첫 화면 번들·렌더에는 들어가지 않는다. 화면 밖(left:-100000px)에 카드를 그린 뒤 정확히
// 1080×1350 PNG로 굽고, 결과(blob) 또는 실패를 부모에게 돌려준다. 성공한 척하지 않는다:
// 카드 내용이 1350px을 넘치면 잘라서 저장하지 않고 실패로 알린다.

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import RegionInstagramCard, { INSTAGRAM_FEED_HEIGHT, INSTAGRAM_FEED_WIDTH } from './RegionInstagramCard';
import { captureElementToFixedPng, EXPORT_EXCLUDE_ATTR } from '@/lib/report/dom-to-png';
import type { ReportEnvelope } from '@/lib/report/types';

/**
 * 레이아웃이 반영된 다음 프레임을 기다린다. 탭이 가려져 있으면 requestAnimationFrame이 멈춰
 * 영원히 기다릴 수 있어(실측: 백그라운드 탭에서 20초 이상 멈춤) 짧은 타이머와 경주시킨다 —
 * 레이아웃 계산은 getBoundingClientRect가 동기적으로 강제하므로 타이머로 넘어가도 값은 같다.
 */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    requestAnimationFrame(() => requestAnimationFrame(finish));
    setTimeout(finish, 120);
  });
}

export default function InstagramExportStage({
  envelope,
  onDone,
  onError,
}: {
  envelope: ReportEnvelope;
  onDone: (blob: Blob) => void;
  onError: (reason: string) => void;
}) {
  const holder = useRef<HTMLDivElement>(null);
  // StrictMode(개발)에서 effect가 두 번 돌아도 한 번만 굽는다. 정리(cleanup)로 결과를 버리지 않는다 —
  // 버리면 두 번째 실행이 건너뛰어져 아무것도 저장되지 않는다.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        if (typeof document !== 'undefined' && document.fonts?.ready) await document.fonts.ready;
        await nextFrame();
        const card = holder.current?.firstElementChild as HTMLElement | null;
        if (!card) throw new Error('EXPORT_NO_CARD');
        // 1350px 안에 다 들어갔는지 먼저 확인한다(잘린·겹친 이미지를 저장하지 않는다).
        // 본문은 flex로 줄어들 수 있어 넘친 내용이 푸터 위에 겹쳐도 카드 높이는 그대로다 —
        // 그래서 카드뿐 아니라 본문 자체의 scrollHeight도 본다(서구 15일 실측: 목록이 푸터와 겹쳤다).
        const body = card.querySelector<HTMLElement>('[data-instagram-body]');
        const overflows = (el: HTMLElement | null) => !!el && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1);
        if (overflows(card) || overflows(body)) throw new Error('EXPORT_CARD_OVERFLOW');
        const { blob, width, height } = await captureElementToFixedPng(card, INSTAGRAM_FEED_WIDTH, INSTAGRAM_FEED_HEIGHT);
        if (width !== INSTAGRAM_FEED_WIDTH || height !== INSTAGRAM_FEED_HEIGHT) throw new Error('EXPORT_SIZE_MISMATCH');
        onDone(blob);
      } catch (e) {
        onError(e instanceof Error ? e.message : 'EXPORT_FAILED');
      }
    })();
    // onDone/onError는 부모가 매 렌더 새로 만들 수 있다 — 한 번만 굽기 위해 의존성에 넣지 않는다(started ref).
  }, []);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={holder}
      {...{ [EXPORT_EXCLUDE_ATTR]: '' }}
      aria-hidden="true"
      style={{ position: 'fixed', left: -100000, top: 0, width: INSTAGRAM_FEED_WIDTH, pointerEvents: 'none' }}
    >
      <RegionInstagramCard envelope={envelope} />
    </div>,
    document.body
  );
}
