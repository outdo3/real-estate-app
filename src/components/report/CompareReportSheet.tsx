// REPORT-4 — 단지 비교 한장 리포트 (TEMPLATE REDESIGN V1).
//
// A/B 요약 카드 → 비교 매트릭스 → 트레이드오프 4분류 → 해석 → 신뢰 푸터.
// PHASE A(단지 리포트)와 **같은 디자인 시스템**을 쓴다 — 두 리포트가 같은 물건처럼
// 보여야 하고, 스타일을 복제하면 곧 갈라진다.
//
// 지키는 것:
//   종합 승자를 만들지 않는다. 우열 강조는 리포트 기준 SAFE 항목에서만, 조용히.
//   360px에서 가로 스크롤이 나는 넓은 표를 쓰지 않는다(3열 그리드가 그대로 좁아진다).

import styles from './ReportSheet.module.css';
import type { ReportEnvelope, ReportMetric, ReportSection } from '@/lib/report/types';
import type { ApartmentCompareReportData } from '@/lib/report/compare-report';
import ReportActions from './ReportActions';
import { ReportHeader, SectionHead, TrustChip, TrustFooter } from './ReportPrimitives';

const MISSING_RE = /정보 없음|준비 중|확인 중/;

/** 매트릭스 한 줄 — 항목명 + A값 + B값. */
function MatrixRow({
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
  /** SAFE 우열이 확정된 경우에만 'a'|'b'. 그 외에는 null이어야 한다. */
  favors?: 'a' | 'b' | null;
}) {
  const cls = (side: 'a' | 'b', value: string) => {
    if (MISSING_RE.test(value)) return `${styles.matrixVal} ${styles.matrixValMissing}`;
    if (favors !== side) return styles.matrixVal;
    return `${styles.matrixVal} ${side === 'a' ? styles.matrixWin : styles.matrixWinB}`;
  };
  return (
    <div className={styles.matrixRow}>
      <div className={styles.matrixKey}>
        {label}
        {trust && <TrustChip trust={trust} />}
      </div>
      <div className={cls('a', aValue)}>
        {aValue}
        {favors === 'a' && <span className={styles.winMark}>▲</span>}
      </div>
      <div className={cls('b', bValue)}>
        {bValue}
        {favors === 'b' && <span className={styles.winMark}>▲</span>}
      </div>
      {note && <div className={styles.matrixNote}>{note}</div>}
    </div>
  );
}

function MatrixSection({
  title,
  meta,
  aName,
  bName,
  children,
}: {
  title: string;
  meta?: string | null;
  aName: string;
  bName: string;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.section}>
      <SectionHead title={title} meta={meta} />
      <div className={styles.matrix}>
        <div className={styles.matrixHead}>
          <span>항목</span>
          <span className={styles.matrixHeadA}>A · {aName}</span>
          <span className={styles.matrixHeadB}>B · {bName}</span>
        </div>
        {children}
      </div>
    </section>
  );
}

/** 트레이드오프 한 상자. 비어 있으면 억지로 채우지 않고 그대로 말한다. */
function TradeoffBox({
  title,
  rows,
  variant,
  emptyText,
}: {
  title: string;
  rows: ReportSection['rows'];
  variant: 'a' | 'b' | 'n';
  emptyText: string;
}) {
  const cls = variant === 'a' ? styles.toBoxA : variant === 'b' ? styles.toBoxB : styles.toBoxN;
  return (
    <div className={`${styles.toBox} ${cls}`}>
      <div className={styles.toTitle}>{title}</div>
      {rows.length === 0 ? (
        <div className={styles.toEmpty}>{emptyText}</div>
      ) : (
        <ul className={styles.toList}>
          {rows.map((r) => (
            <li key={r.key}>
              {String(r.cells.name ?? '')}
              {r.cells.aValue != null && r.cells.bValue != null && (
                <> — {String(r.cells.aValue)} vs {String(r.cells.bValue)}</>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function CompareReportSheet({ envelope }: { envelope: ReportEnvelope<ApartmentCompareReportData> }) {
  const data = envelope.data!;
  const [sa, sb] = data.sides;

  // 우열 표시는 리포트 기준으로 SAFE인 항목에서만.
  const favorsByKey: Record<string, 'a' | 'b' | null> = {};
  for (const d of data.tradeoff.aStrengths) favorsByKey[d.metricKey] = 'a';
  for (const d of data.tradeoff.bStrengths) favorsByKey[d.metricKey] = 'b';

  const sections = envelope.sections;
  const scoreDomains = sections.find((s) => s.key === 'scoreDomains');
  const locationCompare = sections.find((s) => s.key === 'locationCompare');
  const aStrengths = sections.find((s) => s.key === 'aStrengths');
  const bStrengths = sections.find((s) => s.key === 'bStrengths');
  const similar = sections.find((s) => s.key === 'similar');
  const needsReview = sections.find((s) => s.key === 'needsReview');

  /** 요약 카드에 얹을 값 — envelope metric의 "A vs B" 표기를 그대로 나눠 쓴다. */
  const sideStat = (key: string, side: 0 | 1): string | null => {
    const m = envelope.metrics.find((x) => x.key === key);
    if (!m) return null;
    const parts = m.displayValue.split(' vs ');
    return parts[side] ?? null;
  };
  const cardStats = (side: 0 | 1) =>
    [
      { k: '최근 실거래가', v: sideStat('latestDealAmount', side) },
      { k: '12개월 거래량', v: sideStat('transactionCount12m', side) },
      { k: '이집 점수', v: sideStat('ejipScore', side) },
    ].filter((s): s is { k: string; v: string } => !!s.v);

  const sideMeta = (s: typeof sa) =>
    [
      s.buildYear ? `${s.buildYear}년 준공` : null,
      s.totalHouseholds ? `${s.totalHouseholds.toLocaleString('ko-KR')}세대` : null,
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <div className={styles.page}>
      <article className={styles.sheet} data-export-root="">
        <ReportHeader
          title="단지 비교 한장 리포트"
          subtitle={`${sa.name} vs ${sb.name}`}
          tags={['비교 리포트', envelope.period.label, '취소 거래 제외']}
          completeness={envelope.trust.completeness}
          stamp={envelope.dataAsOf ? `데이터 기준 ${envelope.dataAsOf.slice(0, 10).replace(/-/g, '.')}` : null}
        />

        <div className={styles.body}>
          {/* ── A/B 요약 카드 ──────────────────────────────────────────── */}
          <div className={styles.vsHead}>
            <div className={`${styles.vsCard} ${styles.vsCardA}`}>
              <span className={styles.vsBadge}>A</span>
              <div className={styles.vsName}>{sa.name}</div>
              {sa.regionLabel && <div className={styles.vsRegion}>{sa.regionLabel}</div>}
              {sideMeta(sa) && <div className={styles.vsRegion}>{sideMeta(sa)}</div>}
              <div className={styles.vsStats}>
                {cardStats(0).map((s) => (
                  <div key={s.k} className={styles.vsStatRow}>
                    <span className={styles.vsStatKey}>{s.k}</span>
                    <span className={styles.vsStatVal}>{s.v}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className={styles.vsMid}>VS</div>
            <div className={`${styles.vsCard} ${styles.vsCardB}`}>
              <span className={`${styles.vsBadge} ${styles.vsBadgeB}`}>B</span>
              <div className={styles.vsName}>{sb.name}</div>
              {sb.regionLabel && <div className={styles.vsRegion}>{sb.regionLabel}</div>}
              {sideMeta(sb) && <div className={styles.vsRegion}>{sideMeta(sb)}</div>}
              <div className={styles.vsStats}>
                {cardStats(1).map((s) => (
                  <div key={s.k} className={styles.vsStatRow}>
                    <span className={styles.vsStatKey}>{s.k}</span>
                    <span className={styles.vsStatVal}>{s.v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── 비교 매트릭스 ──────────────────────────────────────────── */}
          <MatrixSection title="핵심 비교" meta={envelope.period.label} aName={sa.name} bName={sb.name}>
            {envelope.metrics.map((m) => {
              const [av, bv] = m.displayValue.split(' vs ');
              return (
                <MatrixRow
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
          </MatrixSection>

          <div className={styles.cols}>
            {scoreDomains && scoreDomains.rows.length > 0 && (
              <MatrixSection title={scoreDomains.title} aName={sa.name} bName={sb.name}>
                {scoreDomains.rows.map((r) => (
                  <MatrixRow
                    key={r.key}
                    label={String(r.cells.name ?? '')}
                    aValue={String(r.cells.aValue ?? '정보 없음')}
                    bValue={String(r.cells.bValue ?? '정보 없음')}
                  />
                ))}
              </MatrixSection>
            )}
            {locationCompare && locationCompare.rows.length > 0 && (
              <MatrixSection title={locationCompare.title} aName={sa.name} bName={sb.name}>
                {locationCompare.rows.map((r) => (
                  <MatrixRow
                    key={r.key}
                    label={String(r.cells.name ?? '')}
                    aValue={String(r.cells.aValue ?? '정보 없음')}
                    bValue={String(r.cells.bValue ?? '정보 없음')}
                    favors={favorsByKey[r.key] ?? null}
                  />
                ))}
              </MatrixSection>
            )}
          </div>

          {/* ── 트레이드오프 4분류 ─────────────────────────────────────── */}
          <section className={styles.section}>
            <SectionHead title="무엇이 서로 다른가" meta="우열은 데이터가 충분한 항목에서만" />
            <div className={styles.tradeoffGrid}>
              <TradeoffBox
                title={aStrengths?.title ?? 'A가 앞서는 항목'}
                rows={aStrengths?.rows ?? []}
                variant="a"
                emptyText="앞서는 것으로 확인된 항목이 없습니다."
              />
              <TradeoffBox
                title={bStrengths?.title ?? 'B가 앞서는 항목'}
                rows={bStrengths?.rows ?? []}
                variant="b"
                emptyText="앞서는 것으로 확인된 항목이 없습니다."
              />
              <TradeoffBox
                title={similar?.title ?? '비슷한 항목'}
                rows={similar?.rows ?? []}
                variant="n"
                emptyText="비슷하다고 볼 항목이 없습니다."
              />
              <TradeoffBox
                title={needsReview?.title ?? '판단이 제한되는 항목'}
                rows={needsReview?.rows ?? []}
                variant="n"
                emptyText="추가 확인이 필요한 항목이 없습니다."
              />
            </div>
          </section>

          {/* ── 해석 ───────────────────────────────────────────────────── */}
          {envelope.interpretation.text && (
            <section className={styles.section}>
              <SectionHead title="이집 데이터 해석" />
              {/* 종합 승자를 만들지 않는다. 무엇이 앞서는지와 "선택은 우선순위에 달렸다"만. */}
              <p className={styles.summaryLine}>{envelope.interpretation.text}</p>
            </section>
          )}
        </div>

        <TrustFooter
          envelope={envelope}
          sourceNote="국토교통부 실거래가 · 취소 거래 제외 · 우열은 데이터가 충분한 항목에서만 표시하며 종합 순위를 매기지 않습니다 · 전용면적(㎡) 기준"
        />
      </article>

      <ReportActions
        title={envelope.title}
        envelope={envelope}
        extraLinks={envelope.navigationTargets.map((t, i) => ({
          href: t.href,
          label: i === 0 ? 'A 자세히' : 'B 자세히',
        }))}
      />
    </div>
  );
}
