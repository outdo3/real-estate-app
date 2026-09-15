'use client';

import { FileText } from 'lucide-react';
import Button from '@/components/ui/Button';
import { trackEvent } from '@/lib/analytics/trackEvent';
import styles from './AptReportEntryCard.module.css';

// APT_DETAIL_REPORT_CTA_FLOW_V1 — 상세페이지 중후반의 한장 리포트 진입 카드.
//
// 흐름은 지도 → 상세 → 리포트다. 지도 카드에서 리포트 바로가기를 뺐고, 상세 상단의
// NextActionSection에 있던 REPORT 버튼을 이 카드로 옮겼다(페이지에 리포트 CTA는 이것 하나).
// 스크롤 감지·고정·팝업 없이 본문 흐름 안에 놓인 카드다.
//
// href는 호출부가 `aptReportHref(canonicalAptSeq)`로 만든 기존 리포트 route만 받는다.
// canonical aptSeq가 없으면 호출부가 이 카드를 렌더하지 않는다(이름 기반 식별 금지).
//
// 클릭 기록은 이전 상세 REPORT 버튼과 같은 이벤트·값(next_action_click / actionType REPORT)을 쓴다.
// 위치(source) 차원은 analytics URL 규칙이 actionType만 받으므로 추가하지 않았다.
export const APT_REPORT_ENTRY_COPY = {
  title: '이 단지, 한 장으로 정리해 볼까요?',
  description: '가격·거래·학군·교통·단지 정보를 한눈에 확인해 보세요.',
  button: '이집 한장 리포트 보기',
} as const;

interface Props {
  href: string;
  aptName?: string | null;
}

export default function AptReportEntryCard({ href, aptName }: Props) {
  return (
    <section className={styles.card} aria-labelledby="apt-report-entry-title">
      <div className={styles.body}>
        <span className={styles.icon} aria-hidden="true">
          <FileText size={20} strokeWidth={2} />
        </span>
        <div className={styles.text}>
          <h2 id="apt-report-entry-title" className={styles.title}>
            {APT_REPORT_ENTRY_COPY.title}
          </h2>
          <p className={styles.description}>{APT_REPORT_ENTRY_COPY.description}</p>
        </div>
      </div>
      <Button
        variant="primary"
        size="md"
        href={href}
        className={styles.button}
        onClick={() => trackEvent('next_action_click', { aptName: aptName ?? undefined, actionType: 'REPORT' })}
      >
        {APT_REPORT_ENTRY_COPY.button}
      </Button>
    </section>
  );
}
