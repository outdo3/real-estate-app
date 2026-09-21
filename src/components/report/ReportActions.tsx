'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { Share2, Download, ArrowLeft, Check, Loader2, Image as ImageIcon, Smartphone } from 'lucide-react';
import styles from './RegionReportSheet.module.css';
import { trackEvent } from '@/lib/analytics/trackEvent';
import {
  buildExportFilename,
  buildInstagramFilename,
  buildShareText,
  periodKeyOf,
  reportShareUrl,
  type ReportIdentity,
} from '@/lib/report/export-identity';
import type { ReportEnvelope } from '@/lib/report/types';
import { resolveShareOrigin, type NativeShareResult } from '@/lib/share/shareUtils';
import { useShareSheet } from '@/hooks/useShareSheet';
import ShareSheet from '@/components/share/ShareSheet';
import { reportShareCopy } from '@/lib/share/ejipShareCard';

/**
 * REPORT-6 §2 — 리포트 액션바.
 *
 * [이미지 저장] [PDF 저장] [공유하기] (+ 상세 링크)
 *
 * 원칙:
 *  - **성공한 척하지 않는다.** 캡처가 실패하면 실패라고 말한다(§2).
 *  - 캡처 코드는 탭할 때 **lazy import**한다 — 리포트를 읽기만 하는 사용자의
 *    번들에 들어가지 않는다(§22).
 *  - 공유 URL은 화면 이름이 아니라 envelope identity에서 만든다(§10).
 */

type ActionState = 'idle' | 'image' | 'pdf' | 'share' | 'insta';

/**
 * ONE_PAGE_REPORT_REDESIGN_V1 — 인스타 피드용 무대는 **누른 뒤에만** 불러온다(Next lazy loading, ssr:false).
 * 리포트를 읽기만 하는 사용자의 번들·첫 렌더에는 들어가지 않는다.
 */
const InstagramExportStage = dynamic(() => import('./InstagramExportStage'), { ssr: false });

export default function ReportActions({
  title,
  envelope,
  detailHref = null,
  detailLabel = '지도 보기',
  variant = 'full',
  extraLinks = null,
}: {
  title: string;
  /** 파일명/공유 URL의 identity 원본. 없으면 현재 주소로 공유만 한다. */
  envelope?: ReportEnvelope<unknown> | null;
  detailHref?: string | null;
  detailLabel?: string;
  variant?: 'full' | 'share-only';
  /** 비교 리포트처럼 상세 링크가 2개 이상인 경우. detailHref 대신 쓴다. */
  extraLinks?: readonly { href: string; label: string }[] | null;
}) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<ActionState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // 연타로 캡처가 겹치지 않게. 상태와 별도로 즉시 반영돼야 해서 ref를 쓴다.
  const running = useRef(false);
  // ONE_PAGE_REPORT_REDESIGN_V1 — 지역 리포트만 [이미지]가 이미지 형식 메뉴(기본 이미지 / 인스타 피드용)를 연다.
  // ONE_PAGE_REPORT_FINAL_POLISH_V1 — PDF는 액션바의 독립 [PDF] 버튼 하나만 둔다(메뉴와 중복 제거).
  // 다른 리포트(단지·비교·일별)의 [이미지] 버튼은 예전처럼 바로 저장한다.
  const saveMenuEnabled = !!envelope && envelope.reportType.startsWith('REGION_');
  const [menuOpen, setMenuOpen] = useState(false);
  const [instaRequested, setInstaRequested] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    const onPointer = (e: PointerEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [menuOpen]);

  const identity: ReportIdentity | null = envelope
    ? {
        reportType: envelope.reportType,
        scope: {
          level: envelope.scope.level,
          lawdCd: envelope.scope.lawdCd,
          dong: envelope.scope.dong,
          aptSeqs: envelope.scope.aptSeqs,
        },
        periodEnd: envelope.period.end,
        // STATS_PERIOD_IMAGE_PARITY_V2 — 선택 기간을 공유 링크·파일명까지 가져간다.
        periodKey: periodKeyOf(envelope),
      }
    : null;

  const canonicalUrl = useCallback(() => {
    if (typeof window === 'undefined') return '';
    // SHARE_CARD_UNIFICATION_V1 §11 — 오리진은 siteConfig(NEXT_PUBLIC_SITE_URL)에서 온다.
    // 그래야 도메인 커토버 후 리포트 공유 링크도 같이 e-jip.com으로 넘어간다.
    const fromIdentity = identity ? reportShareUrl(resolveShareOrigin(), identity) : null;
    // identity로 못 만들면 현재 주소를 쓴다 — 추측한 경로로 다른 리포트를 가리키지 않는다.
    return fromIdentity ?? window.location.href;
  }, [identity]);

  /**
   * GA4_INTEGRATION_V1 §10/§11 — 리포트 이벤트에 실리는 문맥.
   *
   * 전부 **고정 enum + 공개 행정코드**다. 단지명/동 이름 같은 표시용 문자열이나
   * aptSeq는 싣지 않는다(§10 판단 근거는 GA4_INTEGRATION_V1.md에 기록).
   * ga.ts의 allowlist를 한 번 더 통과하므로 여기에 무엇을 넣든 목록 밖 키는 버려진다.
   */
  const gaContext = useCallback(
    () => ({
      report_type: envelope?.reportType,
      scope_type: envelope?.scope.level,
      ...(envelope?.scope.lawdCd ? { lawd_cd: envelope.scope.lawdCd } : {}),
    }),
    [envelope]
  );

  // §11 — 리포트 진입. ReportActions는 4개 시트 각각에 **정확히 한 번** 렌더되므로
  // 여기가 리포트당 1회 진입을 보장하는 유일한 클라이언트 마운트 지점이다.
  // ref 가드는 개발 모드 StrictMode의 effect 이중 실행을 막는다.
  const viewFired = useRef(false);
  useEffect(() => {
    if (variant !== 'full') return;
    if (!envelope || viewFired.current) return;
    viewFired.current = true;
    trackEvent('report_view', { ga: gaContext() });
  }, [variant, envelope, gaContext]);

  const flash = (setter: (v: string | null) => void, value: string) => {
    setter(value);
    setTimeout(() => setter(null), 2500);
  };

  /** §3/§4 — 시트를 A4 한 장 문서 레이아웃으로 굽는다. */
  const saveImage = async () => {
    if (running.current) return;
    running.current = true;
    setBusy('image');
    setError(null);
    try {
      const { captureReportExport, findExportRoot } = await import('@/lib/report/dom-to-png');
      const node = findExportRoot();
      if (!node) throw new Error('EXPORT_NO_ROOT');
      // 보이는 화면이 아니라 A4 문서 레이아웃을 굽는다(REPORT A4 EXPORT LAYOUT V1).
      const { blob } = await captureReportExport(node);
      const filename = identity ? buildExportFilename(identity, 'png') : 'e-jip-report.png';
      downloadBlob(blob, filename);
      // 캡처가 실제로 성공했을 때만 집계한다 — 실패한 저장을 저장으로 세지 않는다.
      trackEvent('report_image_save', { ga: gaContext() });
      flash(setDone, '저장 완료');
    } catch {
      // 무엇이 실패했는지 모른 채 "저장됨"이라고 하지 않는다.
      flash(setError, '이미지를 만들지 못했습니다');
    } finally {
      running.current = false;
      setBusy('idle');
    }
  };

  /** ONE_PAGE_REPORT_REDESIGN_V1 — 인스타 피드용 4:5(1080×1350). 같은 envelope을 전용 레이아웃으로 굽는다. */
  const saveInstagram = () => {
    if (running.current || !envelope) return;
    running.current = true;
    setBusy('insta');
    setError(null);
    setInstaRequested(true);
  };
  const finishInstagram = (blob: Blob | null) => {
    setInstaRequested(false);
    running.current = false;
    setBusy('idle');
    if (!blob) {
      // 잘린 이미지·다른 크기를 저장하지 않는다 — 실패라고 말한다.
      flash(setError, '인스타 이미지를 만들지 못했습니다');
      return;
    }
    downloadBlob(blob, identity ? buildInstagramFilename(identity) : 'e-jip-report-instagram-4x5.png');
    trackEvent('report_image_save', { ga: { ...gaContext(), method: 'instagram_4x5' } });
    flash(setDone, '인스타 피드용 저장 완료');
  };

  /**
   * §6/§7 — 브라우저 인쇄 파이프라인. 인쇄 대화상자에서 "PDF로 저장"을 고른다.
   * 서버 렌더러를 추가하지 않으며, 본문이 벡터 텍스트로 남아 한글이 선명하다.
   */
  const savePdf = () => {
    if (running.current) return;
    setBusy('pdf');
    // 인쇄 대화상자에서 사용자가 실제로 "PDF로 저장"까지 했는지는 브라우저가 알려주지
    // 않는다. 그래서 이 이벤트의 의미는 **"PDF 저장을 시작했다"**이며, 완료율로 읽으면
    // 안 된다(GA4_INTEGRATION_V1.md 한계 항목).
    trackEvent('report_pdf_save', { ga: gaContext() });
    // print()는 동기적으로 블로킹되므로 버튼 상태가 먼저 그려지도록 한 틱 넘긴다.
    setTimeout(() => {
      try {
        window.print();
      } finally {
        setBusy('idle');
      }
    }, 50);
  };

  /**
   * SHARE_UX_V2 §3/§8 — 리포트도 다른 화면과 **같은 공통 공유 시트**를 여는다.
   *
   * 예전에는 이 파일이 자기만의 캐스케이드(카카오 → 파일 동반 Web Share → URL
   * 공유 → 링크 복사)를 직접 돌렸다. 그래서 카카오 SDK가 준비된 모바일에서는
   * 첫 분기에서 끝나 OS 공유 시트가 열리지 않았고, 캐프처 이미지 공유 경로에도
   * 닿지 못했다. 이제 사용자가 고른다.
   *
   * §8의 파일 동반 공유는 **그대로 살아 있다** — 시트의 [공유하기] 행이 아래
   * 핸들러로 내려오므로, 지원하는 환경에서는 여전히 캐프처 PNG가 함께 간다.
   */
  const shareNativeWithReportImage = useCallback(
    async (payload: { title: string; text?: string; url: string }): Promise<NativeShareResult> => {
      if (typeof navigator === 'undefined' || !navigator.share) return 'unsupported';
      const url = payload.url;
      const text = envelope ? buildShareText(envelope) : title;

      // 파일 공유가 가능한지 먼저 확인한 뒤에만 캐처한다 — 불가능한 환경에서
      // 쓸데없이 1~2초를 쓰지 않기 위해.
      const canShareFiles =
        typeof navigator.canShare === 'function' &&
        (() => {
          try {
            const probe = new File([new Blob([''], { type: 'image/png' })], 'probe.png', { type: 'image/png' });
            return navigator.canShare({ files: [probe] });
          } catch {
            return false;
          }
        })();

      if (canShareFiles && !running.current) {
        running.current = true;
        setBusy('share');
        try {
          const { captureReportExport, findExportRoot } = await import('@/lib/report/dom-to-png');
          const node = findExportRoot();
          if (node) {
            const { blob } = await captureReportExport(node);
            const filename = identity ? buildExportFilename(identity, 'png') : 'e-jip-report.png';
            const file = new File([blob], filename, { type: 'image/png' });
            if (navigator.canShare({ files: [file] })) {
              // 이미지만 보내면 수신자가 살아있는 리포트로 돌아올 수 없다 — URL은 항상 함께.
              await navigator.share({ title, text, url, files: [file] });
              return 'shared';
            }
          }
        } catch (e) {
          // 사용자가 공유창을 닫은 것은 실패가 아니다.
          if (e instanceof Error && e.name === 'AbortError') return 'aborted';
          // 캐처/파일 공유가 안 되면 URL 공유로 내려간다(아래).
        } finally {
          running.current = false;
          setBusy('idle');
        }
      }

      try {
        await navigator.share({ title, text, url });
        return 'shared';
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') return 'aborted';
        return 'failed';
      }
    },
    [envelope, identity, title]
  );

  const shareCopyText = reportShareCopy(title);
  const sheet = useShareSheet({
    title: shareCopyText.title,
    text: shareCopyText.description,
    shareType: 'report',
    // §10 — 공유 URL은 화면 이름이 아니라 envelope identity에서 만든다.
    url: canonicalUrl(),
    onNativeShare: shareNativeWithReportImage,
    onChannel: (channel) => {
      // 카카오 SDK는 전송 완료 콜백이 없다 — 보낌 척하지 않도록 method로 경로만 남긴다.
      const method = channel === 'kakao' ? 'kakao_card' : channel === 'native' ? 'web_share' : 'copy_link';
      trackEvent('report_share', { ga: { ...gaContext(), method } });
      if (channel === 'copy') {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    },
  });

  const shareSheet = (
    <ShareSheet
      open={sheet.open}
      onClose={sheet.closeSheet}
      channels={sheet.channels}
      url={sheet.url}
      status={sheet.status}
      onKakao={sheet.shareKakao}
      onNative={sheet.shareNative}
      onCopy={sheet.shareCopy}
      heading={title}
    />
  );


  const shareButton = (
    <>
      <button
        type="button"
        className={`${styles.actionBtn} ${styles.actionPrimary}`}
        onClick={sheet.openSheet}
        aria-haspopup="dialog"
      >
        {copied ? <Check size={16} aria-hidden="true" /> : <Share2 size={16} aria-hidden="true" />}
        <ActionLabel text={busy === 'share' ? '공유 준비 중...' : copied ? '링크 복사됨' : '공유하기'} />
      </button>
      {shareSheet}
    </>
  );
  if (variant === 'share-only') return shareButton;

  return (
    <>
      <div className={styles.actions} data-export-exclude="" data-bottom-bar="" ref={barRef}>
        {saveMenuEnabled && menuOpen && (
          <div className={styles.saveMenu} role="menu" aria-label="저장 형식">
            <button
              type="button"
              role="menuitem"
              className={styles.saveMenuItem}
              onClick={() => {
                setMenuOpen(false);
                saveImage();
              }}
            >
              <ImageIcon size={20} aria-hidden="true" />
              <span className={styles.saveMenuText}>
                <strong>기본 이미지</strong>
                <span>한 장 리포트 PNG</span>
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              className={styles.saveMenuItem}
              onClick={() => {
                setMenuOpen(false);
                saveInstagram();
              }}
            >
              <Smartphone size={20} aria-hidden="true" />
              <span className={styles.saveMenuText}>
                <strong>인스타 피드용</strong>
                <span>1080×1350 PNG · 4:5</span>
              </span>
            </button>
          </div>
        )}
        <div className={styles.actionInner}>
          {shareButton}
          <button
            type="button"
            className={styles.actionBtn}
            onClick={saveMenuEnabled ? () => setMenuOpen((v) => !v) : saveImage}
            disabled={busy !== 'idle'}
            aria-label="리포트 이미지 저장"
            {...(saveMenuEnabled ? { 'aria-haspopup': 'menu' as const, 'aria-expanded': menuOpen } : {})}
          >
            {busy === 'image' || busy === 'insta' ? (
              <Loader2 size={16} aria-hidden="true" className={styles.spin} />
            ) : (
              <Download size={16} aria-hidden="true" />
            )}
            <ActionLabel text={busy === 'image' ? '이미지 만드는 중...' : '이미지'} />
          </button>
          <button
            type="button"
            className={styles.actionBtn}
            onClick={savePdf}
            disabled={busy !== 'idle'}
            aria-label="리포트 PDF 저장"
          >
            {/* §5 — 이미지와 같은 저장 동작이므로 같은 아이콘을 쓴다(예전 FileText는
                "문서"를 뜻해 저장 동작을 가리키지 않았다). */}
            <Download size={16} aria-hidden="true" />
            <ActionLabel text="PDF" />
          </button>
          {extraLinks && extraLinks.length > 0 ? (
            extraLinks.map((l) => (
              <Link key={l.href} href={l.href} className={styles.actionBtn}>
                <ArrowLeft size={16} aria-hidden="true" />
                <ActionLabel text={l.label} />
              </Link>
            ))
          ) : (
            <Link href={detailHref ?? '/map'} className={styles.actionBtn}>
              {/* §5 — 라벨이 "단지로 돌아가기"가 되면서 ExternalLink(바깥으로 나감)는
                  뜻이 맞지 않는다. 되돌아가는 동작이므로 ArrowLeft를 쓴다. */}
              <ArrowLeft size={16} aria-hidden="true" />
              <ActionLabel text={detailHref ? detailLabel : '지도 보기'} />
            </Link>
          )}
        </div>
        {(error || done) && (
          <p className={error ? styles.actionError : styles.actionDone} role="status">
            {error ?? done}
          </p>
        )}
      </div>
      {instaRequested && envelope && (
        <InstagramExportStage envelope={envelope} onDone={(blob) => finishInstagram(blob)} onError={() => finishInstagram(null)} />
      )}
    </>
  );
}

/**
 * REPORT_BOTTOM_ACTION_BAR_COMPACT_FIX_V1 §2 — 줄바꿈 지점을 **구조로** 고정한다.
 *
 * 한글은 기본 줄바꿈 규칙(CJK)에서 **음절 단위로 끊긴다.** 그래서 "단지로 돌아가기"를
 * 그냥 문자열로 넣으면 좁은 폭에서 이렇게 깨진다:
 *
 *     단지로돌아          단지로 돌
 *     가기        또는     아가기
 *
 * CSS만으로는 이걸 확실히 막기 어렵다(word-break: keep-all은 브라우저·폰트에 따라
 * 동작이 갈린다). 그래서 **띄어쓰기로 나눈 각 어절을 nowrap span으로 감싼다.**
 * 어절 안에서는 절대 끊기지 않고, 유일한 줄바꿈 기회는 어절 사이의 공백뿐이다:
 *
 *     단지로
 *     돌아가기
 *
 * 이 구조는 CSS를 나중에 바꿔도 깨지지 않는다 — nowrap이 span에 직접 걸려 있다.
 * 한 어절짜리 라벨(공유하기 / 이미지 / PDF)은 자연히 통째로 nowrap이 된다.
 */
function ActionLabel({ text }: { text: string }) {
  const words = text.split(' ').filter(Boolean);
  return (
    <span className={styles.actionLabel}>
      {words.map((word, i) => (
        <span key={`${word}-${i}`} className={styles.actionWord}>
          {word}
        </span>
      ))}
    </span>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 즉시 revoke하면 일부 브라우저에서 다운로드가 취소된다.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
