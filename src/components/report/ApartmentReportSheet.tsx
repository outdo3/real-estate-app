// REPORT-3 — 단지 한장 리포트 템플릿.
//
// REPORT-2의 시트 셸(RegionReportSheet.module.css)을 그대로 재사용한다 —
// 두 리포트가 같은 물건처럼 보여야 하고, 스타일을 복제하면 곧 갈라진다.
//
// **envelope만 읽는다.** Prisma도, 점수 재계산도, trust 재해석도 하지 않는다.

import Link from 'next/link';
import styles from './RegionReportSheet.module.css';
import type { MetricTrust, ReportEnvelope, ReportMetric, ReportSection } from '@/lib/report/types';
import ReportActions from './ReportActions';

/** KPI 4개 — §3 PRIMARY에서 고른다. */
const KPI_KEYS = ['latestDealAmount', 'ejipScore', 'transactionCount12m', 'buildYear'];

function TrustChip({ trust }: { trust: MetricTrust }) {
  if (trust === 'SAFE') return null;
  // MISSING은 값 자체가 '정보 없음'/'준비 중'이라 칩을 중복으로 붙이지 않는다.
  if (trust === 'MISSING') return null;
  if (trust === 'LIMITED') return <span className={`${styles.trustChip} ${styles.trustLimited}`}>참고</span>;
  return <span className={`${styles.trustChip} ${styles.trustMissing}`}>미검증</span>;
}

function Kpi({ metric }: { metric: ReportMetric }) {
  const missing = metric.trust === 'MISSING';
  return (
    <div className={styles.kpi}>
      <div className={styles.kpiLabel}>
        {metric.label}
        <TrustChip trust={metric.trust} />
      </div>
      <div className={`${styles.kpiValue} ${missing ? styles.kpiValueMissing : ''}`}>{metric.displayValue}</div>
    </div>
  );
}

/** 항목별 점수 — count=점수, share=coverage(%)로 envelope이 담아둔 것을 그대로 읽는다. */
function ScoreDomains({ section }: { section: ReportSection }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{section.title}</h2>
      {section.rows.map((r) => {
        const score = Number(r.cells.count ?? 0);
        return (
          <div key={r.key} className={styles.barRow}>
            <span className={styles.barName}>{String(r.cells.name ?? '')}</span>
            <span className={styles.barTrack}>
              <span className={styles.barFill} style={{ width: `${Math.min(100, score)}%` }} />
            </span>
            {/* 점수가 없는 domain은 0점이 아니라 '정보 없음'이다. */}
            <span className={styles.barValue}>{r.enriched ? `${score}점` : '정보 없음'}</span>
          </div>
        );
      })}
      {section.note && <p className={styles.sectionNote}>{section.note}</p>}
    </section>
  );
}

function TradeRows({ section }: { section: ReportSection }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{section.title}</h2>
      <div className={styles.tradeList}>
        {section.rows.map((r) => {
          const meta = [
            // 평 라벨을 만들지 않는다 — ㎡ 그대로.
            r.cells.exclusiveAreaM2 != null ? `전용 ${r.cells.exclusiveAreaM2}㎡` : null,
            r.cells.floor != null ? `${r.cells.floor}층` : null,
            r.cells.dealDate ? String(r.cells.dealDate) : null,
          ]
            .filter(Boolean)
            .join(' · ');
          return (
            <div key={r.key} className={styles.tradeCard}>
              <div className={styles.tradeTop}>
                <span className={styles.tradeName}>{meta}</span>
                <span className={styles.tradePrice}>{formatManwon(Number(r.cells.dealAmount))}</span>
              </div>
            </div>
          );
        })}
      </div>
      {section.note && <p className={styles.sectionNote}>{section.note}</p>}
    </section>
  );
}

function InfoRows({ section }: { section: ReportSection }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{section.title}</h2>
      {section.rows.map((r) => (
        <div key={r.key} className={styles.barRow} style={{ gridTemplateColumns: '96px 1fr' }}>
          <span className={styles.barName}>{String(r.cells.name ?? '')}</span>
          <span className={`${styles.barValue}`} style={{ textAlign: 'left' }}>
            {String(r.cells.value ?? '정보 없음')}
          </span>
        </div>
      ))}
    </section>
  );
}

function formatManwon(manwon: number): string {
  const eok = Math.floor(manwon / 10000);
  const rest = Math.round(manwon % 10000);
  if (eok > 0) return rest > 0 ? `${eok}억 ${rest.toLocaleString('ko-KR')}` : `${eok}억`;
  return `${manwon.toLocaleString('ko-KR')}만`;
}

const COMPLETENESS_LABEL: Record<string, { text: string; cls: string }> = {
  COMPLETE: { text: '검증 완료', cls: 'cComplete' },
  PARTIAL: { text: '일부 제한', cls: 'cPartial' },
  UNVERIFIED: { text: '검증 중', cls: 'cUnverified' },
};

export default function ApartmentReportSheet({
  envelope,
  strengths,
  cautions,
}: {
  envelope: ReportEnvelope<unknown>;
  strengths: string[];
  cautions: string[];
}) {
  const kpis = KPI_KEYS.map((k) => envelope.metrics.find((m) => m.key === k)).filter((m): m is ReportMetric => !!m);
  const secondary = envelope.metrics.filter((m) =>
    ['medianDealAmount12m', 'medianPricePerM2_12m', 'priceChange12m', 'totalHouseholds', 'parking'].includes(m.key)
  );
  const domains = envelope.sections.find((s) => s.key === 'scoreDomains');
  const trades = envelope.sections.find((s) => s.key === 'recentTrades');
  const location = envelope.sections.find((s) => s.key === 'locationSummary');
  const c = COMPLETENESS_LABEL[envelope.trust.completeness] ?? COMPLETENESS_LABEL.UNVERIFIED;
  const dataAsOfText = envelope.dataAsOf ? envelope.dataAsOf.slice(0, 10).replace(/-/g, '.') : '확인 중';
  const detail = envelope.navigationTargets[0];

  return (
    <div className={styles.page}>
      <article className={styles.sheet} data-export-root="">
        <header className={styles.header}>
          <div className={styles.brand}>이집 E-JIP</div>
          <h1 className={styles.title}>{envelope.scope.displayName} 단지 리포트</h1>
          {envelope.subtitle && <p className={styles.subtitle}>{envelope.subtitle}</p>}
        </header>

        <div className={styles.kpiGrid}>
          {kpis.map((m) => (
            <Kpi key={m.key} metric={m} />
          ))}
        </div>

        {domains && domains.rows.length > 0 && <ScoreDomains section={domains} />}

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>가격 · 단지 정보</h2>
          {secondary.map((m) => (
            <div key={m.key} className={styles.barRow} style={{ gridTemplateColumns: '112px 1fr' }}>
              <span className={styles.barName}>{m.label}</span>
              <span className={styles.barValue} style={{ textAlign: 'left' }}>
                {m.displayValue}
                {m.trust === 'LIMITED' && <span className={`${styles.trustChip} ${styles.trustLimited}`} style={{ marginLeft: 6 }}>참고</span>}
              </span>
            </div>
          ))}
        </section>

        {envelope.highlights.length > 0 && (
          <section className={styles.section}>
            {envelope.highlights.map((h) => (
              <div key={h.key} className={styles.highlight}>
                <div className={styles.highlightLabel}>{h.label}</div>
                <div className={styles.highlightValue}>{h.displayValue}</div>
                {/* 기간 문구를 반드시 함께 — '역대 신고가'로 읽히면 안 된다. */}
                <div className={styles.highlightContext}>{h.contextLabel}</div>
              </div>
            ))}
          </section>
        )}

        {trades && trades.rows.length > 0 && <TradeRows section={trades} />}
        {location && <InfoRows section={location} />}

        {(envelope.interpretation.text || strengths.length > 0 || cautions.length > 0) && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>이집 데이터 해석</h2>
            {/* Score briefing이 만든 결정론적 문장만 온다. 예측/추천 없음(§10). */}
            {envelope.interpretation.text && <p className={styles.interpretation}>{envelope.interpretation.text}</p>}
            {strengths.length > 0 && (
              <>
                <div className={styles.highlightLabel} style={{ marginTop: 10 }}>강점</div>
                <ul className={styles.footerNotes}>
                  {strengths.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </>
            )}
            {cautions.length > 0 && (
              <>
                <div className={styles.highlightLabel} style={{ marginTop: 10 }}>확인할 점</div>
                <ul className={styles.footerNotes}>
                  {cautions.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}

        <footer className={styles.footer}>
          <div className={styles.footerRow}>
            <span className={`${styles.completeness} ${styles[c.cls]}`}>{c.text}</span>
            <span>데이터 기준: {dataAsOfText}</span>
            <span>기간: {envelope.period.label}</span>
          </div>
          {envelope.trust.notes.length > 0 && (
            <ul className={styles.footerNotes}>
              {envelope.trust.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          <p className={styles.sourceNote}>국토교통부 실거래가 · 취소 거래 제외 · 이집 점수는 상세 화면과 동일 기준</p>
        </footer>
      </article>

      <ReportActions title={`${envelope.scope.displayName} 단지 리포트`} envelope={envelope} detailHref={detail?.href ?? null} detailLabel={detail?.label} />
    </div>
  );
}
