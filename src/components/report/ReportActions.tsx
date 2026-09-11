'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Share2, Download, ArrowLeft, Check, Loader2 } from 'lucide-react';
import styles from './RegionReportSheet.module.css';
import { trackEvent } from '@/lib/analytics/trackEvent';
import {
  buildExportFilename,
  buildShareText,
  reportCanonicalUrl,
  type ReportIdentity,
} from '@/lib/report/export-identity';
import type { ReportEnvelope } from '@/lib/report/types';
import { useKakaoSharePreload } from '@/hooks/useKakaoSharePreload';
import { isKakaoShareReady, sendKakaoShare, buildKakaoShareImageUrl, resolveShareOrigin } from '@/lib/share/shareUtils';
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

type ActionState = 'idle' | 'image' | 'pdf' | 'share';

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

  // SHARE_CARD_UNIFICATION_V1 §8 — 리포트 공유에도 브랜드 카카오 카드를 쓴다.
  // 클릭 전에 SDK가 준비돼 있어야 팝업이 차단되지 않는다(훅 주석 참고).
  useKakaoSharePreload();

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
      }
    : null;

  const canonicalUrl = useCallback(() => {
    if (typeof window === 'undefined') return '';
    // SHARE_CARD_UNIFICATION_V1 §11 — 오리진은 siteConfig(NEXT_PUBLIC_SITE_URL)에서 온다.
    // 그래야 도메인 커토버 후 리포트 공유 링크도 같이 e-jip.com으로 넘어간다.
    const fromIdentity = identity ? reportCanonicalUrl(resolveShareOrigin(), identity) : null;
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
   * §8 — Web Share 우선, 없으면 링크 복사.
   *
   * 파일 공유를 지원하는 환경(주로 Android Chrome)에서는 캡처 이미지를 함께 싣는다.
   * 다만 **URL/text는 항상 포함**한다 — 이미지는 클릭할 수 없으므로(§8) 링크가
   * 없으면 수신자가 리포트로 돌아올 방법이 사라진다.
   *
   * iOS Safari는 files와 url을 함께 넘기면 canShare가 false를 주는 경우가 있어,
   * 그때는 조용히 URL 공유로 내려간다(거짓 실패 표시 없음).
   */
  const share = async () => {
    if (running.current) return;
    const url = canonicalUrl();
    if (!url) return;
    const text = envelope ? buildShareText(envelope) : title;

    /**
     * SHARE_CARD_UNIFICATION_V1 §8 — 카카오 브랜드 카드가 1순위.
     *
     * 카카오톡으로 리포트를 보내면 예전에는 일반 OG 미리보기(또는 클릭할 수 없는 PNG
     * 한 장)만 갔다. 이제는 다른 화면과 같은 브랜드 카드 + "이집에서 리포트 보기"
     * 버튼이 가고, 수신자가 **살아있는 리포트로 돌아올 수 있다**.
     *
     * PDF/이미지를 카드에 싣지는 않는다(§8) — 액션바의 [이미지]/[PDF] 저장 버튼과
     * 인쇄 파이프라인은 이 분기와 무관하게 그대로다. 카카오를 쓸 수 없는 환경에서는
     * 아래 기존 파일 첨부 공유 → URL 공유 → 링크 복사 사슬이 그대로 살아 있다.
     *
     * await보다 먼저 와야 사용자 제스처가 끊기지 않는다.
     */
    if (isKakaoShareReady()) {
      try {
        const copy = reportShareCopy(title);
        sendKakaoShare({
          type: 'report',
          title: copy.title,
          description: copy.description,
          url,
          imageUrl: buildKakaoShareImageUrl(),
        });
        // 카카오 SDK는 전송 완료 콜백이 없다 — 보낸 척하지 않도록 method로 경로만 남긴다.
        trackEvent('report_share', { ga: { ...gaContext(), method: 'kakao_card' } });
        return;
      } catch {
        // 카카오 공유 제품 비활성화/절대 URL 실패 등 — 아래 기존 경로로 내려간다.
      }
    }

    if (typeof navigator !== 'undefined' && navigator.share) {
      // 파일 공유가 가능한지 먼저 확인한 뒤에만 캡처한다 — 불가능한 환경에서
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

      if (canShareFiles) {
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
              await navigator.share({ title, text, url, files: [file] });
              trackEvent('report_share', { ga: { ...gaContext(), method: 'web_share_file' } });
              return;
            }
          }
        } catch {
          // 캡처/파일 공유가 안 되면 URL 공유로 내려간다(아래).
        } finally {
          running.current = false;
          setBusy('idle');
        }
      }

      try {
        await navigator.share({ title, text, url });
        trackEvent('report_share', { ga: { ...gaContext(), method: 'web_share' } });
        return;
      } catch {
        // 사용자가 취소한 경우도 여기로 온다 — 실패로 표시하지 않는다.
        // 취소는 공유가 아니므로 이벤트도 보내지 않는다(share 수치를 부풀리지 않는다).
        return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      trackEvent('report_share', { ga: { ...gaContext(), method: 'copy_link' } });
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      flash(setError, '링크를 복사하지 못했습니다');
    }
  };

  const shareButton = (
    <button type="button" className={`${styles.actionBtn} ${styles.actionPrimary}`} onClick={share}>
      {copied ? <Check size={16} aria-hidden="true" /> : <Share2 size={16} aria-hidden="true" />}
      <ActionLabel text={busy === 'share' ? '공유 준비 중...' : copied ? '링크 복사됨' : '공유하기'} />
    </button>
  );
  if (variant === 'share-only') return shareButton;

  return (
    <>
      <div className={styles.actions} data-export-exclude="" data-bottom-bar="">
        <div className={styles.actionInner}>
          {shareButton}
          <button
            type="button"
            className={styles.actionBtn}
            onClick={saveImage}
            disabled={busy !== 'idle'}
            aria-label="리포트 이미지 저장"
          >
            {busy === 'image' ? (
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
