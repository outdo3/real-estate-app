// REPORT-4 — 단지 비교 한장 리포트 템플릿.
//
// REPORT-2/3의 시트 셸을 그대로 재사용한다. **envelope만 읽는다.**
//
// 두 가지를 화면에서 지킨다:
//   §13 360px에서 가로 스크롤이 생기는 넓은 표를 쓰지 않는다 — 항목명을 위에,
//       A/B 값을 아래 2열로 쌓는다.
//   §14 우열 강조는 **우열이 정당한 경우에만** 조용히 붙인다. 모든 행을 빨강/파랑으로
//       칠하는 스코어보드가 되면 리포트가 아니라 승부표가 된다.

import Link from 'next/link';
import styles from './RegionReportSheet.module.css';
import type { ReportEnvelope, ReportMetric, ReportSection } from '@/lib/report/types';
import type { ApartmentCompareReportData } from '@/lib/report/compare-report';
import ReportActions from './ReportActions';

function TrustChip({ trust }: { trust: ReportMetric['trust'] }) {
  if (trust === 'SAFE' || trust === 'MISSING') return null;
  if (trust === 'LIMITED') return <span className={`${styles.trustChip} ${styles.trustLimited}`}>참고</span>;
  return <span className={`${styles.trustChip} ${styles.trustMissing}`}>미검증</span>;
}

/** "A vs B" 한 줄을 항목명 + 2열 값으로 쌓아 그린다. */
function CompareRow({
  label,
  aValue,
  bValue,
  trust,
  note,
  favors,
}: {
  label: string;
  aValue: string;
  bValue: string;
  trust?: ReportMetric['trust'];
  note?: string | null;
  /** SAFE 우열이 확정된 경우에만 'a'|'b'. 그 외에는 null이어야 한다(§6/§14). */
  favors?: 'a' | 'b' | null;
}) {
  const cls = (side: 'a' | 'b', value: string) => {
    if (value.includes('정보 없음') || value.includes('준비 중')) return styles.cmpMissing;
    return favors === side ? `${styles.cmpValue} ${styles.cmpWin}` : styles.cmpValue;
  };
  return (
    <div className={styles.cmpRow}>
      <div className={styles.cmpLabel}>
        {label}
        {trust && <TrustChip trust={trust} />}
      </div>
      <div className={styles.cmpValues}>
        <div className={cls('a', aValue)}>
          {aValue}
          {favors === 'a' && <span className={styles.cmpWinMark}>▲</span>}
        </div>
        <div className={cls('b', bValue)}>
          {bValue}
          {favors === 'b' && <span className={styles.cmpWinMark}>▲</span>}
        </div>
      </div>
      {note && <div className={styles.cmpNote}>{note}</div>}
    </div>
  );
}

function RowsSection({
  section,
  favorsByKey,
}: {
  section: ReportSection;
  favorsByKey?: Record<string, 'a' | 'b' | null>;
}) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{section.title}</h2>
      {section.rows.length === 0 ? (
        <div className={styles.cmpEmpty}>해당하는 항목이 없습니다.</div>
      ) : (
        section.rows.map((r) => (
          <CompareRow
            key={r.key}
            label={String(r.cells.name ?? '')}
            aValue={String(r.cells.aValue ?? '정보 없음')}
            bValue={String(r.cells.bValue ?? '정보 없음')}
            note={r.cells.note ? String(r.cells.note) : null}
            favors={favorsByKey?.[r.key] ?? null}
          />
        ))
      )}
      {section.note && <p className={styles.sectionNote}>{section.note}</p>}
    </section>
  );
}

const COMPLETENESS_LABEL: Record<string, { text: string; cls: string }> = {
  COMPLETE: { text: '검증 완료', cls: 'cComplete' },
  PARTIAL: { text: '일부 제한', cls: 'cPartial' },
  UNVERIFIED: { text: '검증 중', cls: 'cUnverified' },
};

export default function CompareReportSheet({ envelope }: { envelope: ReportEnvelope<ApartmentCompareReportData> }) {
  const data = envelope.data!;
  const [sa, sb] = data.sides;
  const c = COMPLETENESS_LABEL[envelope.trust.completeness] ?? COMPLETENESS_LABEL.UNVERIFIED;
  const dataAsOfText = envelope.dataAsOf ? envelope.dataAsOf.slice(0, 10).replace(/-/g, '.') : '확인 중';

  // §6/§14 — 우열 표시는 리포트 기준으로 SAFE인 항목에서만.
  const favorsByKey: Record<string, 'a' | 'b' | null> = {};
  for (const d of data.tradeoff.aStrengths) favorsByKey[d.metricKey] = 'a';
  for (const d of data.tradeoff.bStrengths) favorsByKey[d.metricKey] = 'b';

  const sections = envelope.sections;
  const scoreDomains = sections.find((s) => s.key === 'scoreDomains');
  const locationCompare = sections.find((s) => s.key === 'locationCompare');
  const aStrengths = sections.find((s) => s.key === 'aStrengths')!;
  const bStrengths = sections.find((s) => s.key === 'bStrengths')!;
  const similar = sections.find((s) => s.key === 'similar')!;
  const needsReview = sections.find((s) => s.key === 'needsReview')!;

  return (
    <div className={styles.page}>
      <article className={styles.sheet}>
        <header className={styles.header}>
          <div className={styles.brand}>이집 E-JIP</div>
          <h1 className={styles.title}>단지 비교 한장 리포트</h1>
          <p className={styles.subtitle}>{envelope.period.label} · 취소 거래 제외</p>
        </header>

        {/* A/B identity 카드 — 표시명은 라벨일 뿐이고 identity는 aptSeq다(§3). */}
        <div className={styles.cmpHead}>
          <div className={styles.cmpCard}>
            <span className={styles.cmpBadge}>A</span>
            <div className={styles.cmpName}>{sa.name}</div>
            {sa.regionLabel && <div className={styles.cmpRegion}>{sa.regionLabel}</div>}
          </div>
          <div className={styles.cmpCard}>
            <span className={`${styles.cmpBadge} ${styles.cmpBadgeB}`}>B</span>
            <div className={styles.cmpName}>{sb.name}</div>
            {sb.regionLabel && <div className={styles.cmpRegion}>{sb.regionLabel}</div>}
          </div>
        </div>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>핵심 비교</h2>
          {envelope.metrics.map((m) => {
            const [av, bv] = m.displayValue.split(' vs ');
            return (
              <CompareRow
                key={m.key}
                label={m.label}
                aValue={av ?? '정보 없음'}
                bValue={bv ?? '정보 없음'}
                trust={m.trust}
                note={m.reason}
                favors={favorsByKey[m.key] ?? null}
              />
            );
          })}
        </section>

        {scoreDomains && <RowsSection section={scoreDomains} />}
        {locationCompare && <RowsSection section={locationCompare} favorsByKey={favorsByKey} />}

        {/* §12 트레이드오프 4분류 */}
        <RowsSection section={aStrengths} />
        <RowsSection section={bStrengths} />
        <RowsSection section={similar} />
        <RowsSection section={needsReview} />

        {envelope.interpretation.text && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>이집 데이터 해석</h2>
            {/* §7 — 종합 승자를 만들지 않는다. 무엇이 앞서는지와 "선택은 우선순위에 달렸다"만. */}
            <p className={styles.interpretation}>{envelope.interpretation.text}</p>
          </section>
        )}

        <footer className={styles.footer}>
          <div className={styles.footerRow}>
            <span className={`${styles.completeness} ${styles[c.cls]}`}>{c.text}</span>
            <span>데이터 기준: {dataAsOfText}</span>
          </div>
          {envelope.trust.notes.length > 0 && (
            <ul className={styles.footerNotes}>
              {envelope.trust.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          <p className={styles.sourceNote}>
            국토교통부 실거래가 · 취소 거래 제외 · 우열은 데이터가 충분한 항목에서만 표시합니다
          </p>
        </footer>
      </article>

      <div className={styles.actions}>
        <div className={styles.actionInner}>
          <ReportActionsInline title={envelope.title} />
          {envelope.navigationTargets.map((t, i) => (
            <Link key={t.href} href={t.href} className={styles.actionBtn}>
              {i === 0 ? 'A 자세히' : 'B 자세히'}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

/** 공유 버튼만 재사용한다(액션바 레이아웃은 비교 리포트가 직접 구성). */
function ReportActionsInline({ title }: { title: string }) {
  return <ReportActions title={title} variant="share-only" />;
}
