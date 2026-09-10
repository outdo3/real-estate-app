'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Share2, Download, ExternalLink, Check } from 'lucide-react';
import styles from './RegionReportSheet.module.css';

/**
 * REPORT-2 §15 — 리포트 액션바.
 *
 * 이미지/PDF 내보내기는 REPORT-6에서 만든다. 여기서 **성공한 척하지 않는다** —
 * 버튼을 disabled로 두고 "준비 중"이라고 적는다. 누르면 아무 일도 안 일어나면서
 * 저장된 것처럼 보이는 게 최악이다.
 *
 * 공유는 리포트 URL을 쓴다. 공유된 이미지 자체는 딥링크가 될 수 없으므로
 * (ARCHITECTURE §9) URL을 항상 함께 싣는 지금 형태가 V1에 맞다.
 */
export default function ReportActions({
  title,
  detailHref = null,
  detailLabel = '지도 보기',
  variant = 'full',
}: {
  title: string;
  /** 있으면 이 링크로, 없으면 지도로 보낸다. 단지 리포트는 canonical aptSeq 상세로 간다(§12). */
  detailHref?: string | null;
  detailLabel?: string;
  /**
   * 'share-only'는 공유 버튼만 그린다 — 비교 리포트는 A/B 상세 링크 2개를 직접
   * 배치하므로 액션바 컨테이너와 나머지 버튼을 이 컴포넌트가 다시 만들면 중첩된다.
   */
  variant?: 'full' | 'share-only';
}) {
  const [copied, setCopied] = useState(false);

  const share = async () => {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    if (!url) return;
    // Web Share가 있으면 그걸 쓰고(모바일 기본 공유 시트), 없으면 링크 복사로 대체한다.
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // 사용자가 취소한 경우도 여기로 온다 — 실패라고 표시하지 않는다.
        return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* 클립보드가 막힌 환경에서는 조용히 아무 것도 하지 않는다(거짓 성공 금지). */
    }
  };

  const shareButton = (
    <button type="button" className={`${styles.actionBtn} ${styles.actionPrimary}`} onClick={share}>
      {copied ? <Check size={16} aria-hidden="true" /> : <Share2 size={16} aria-hidden="true" />}
      {copied ? '링크 복사됨' : '공유하기'}
    </button>
  );
  if (variant === 'share-only') return shareButton;

  return (
    <div className={styles.actions}>
      <div className={styles.actionInner}>
        <button type="button" className={`${styles.actionBtn} ${styles.actionPrimary}`} onClick={share}>
          {copied ? <Check size={16} aria-hidden="true" /> : <Share2 size={16} aria-hidden="true" />}
          {copied ? '링크 복사됨' : '공유하기'}
        </button>
        <button
          type="button"
          className={styles.actionBtn}
          disabled
          title="이미지 저장은 준비 중입니다"
          aria-label="이미지 저장 준비 중"
        >
          <Download size={16} aria-hidden="true" />
          저장 준비 중
        </button>
        <Link href={detailHref ?? '/map'} className={styles.actionBtn}>
          <ExternalLink size={16} aria-hidden="true" />
          {detailHref ? detailLabel : '지도 보기'}
        </Link>
      </div>
    </div>
  );
}
