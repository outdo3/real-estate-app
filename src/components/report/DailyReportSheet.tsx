// REPORT-5 — 일별 "새로 확인된 실거래" 템플릿.
//
// **envelope만 읽는다.** 발행 가능 여부(numbersPublished)도 envelope이 이미 판단해뒀다 —
// 화면에서 다시 판단하지 않는다.
//
// §19 공유 안전: 이 시트는 스크린샷으로 문맥 없이 돌아다닐 수 있다. 그래서
//   (1) 제목에 "새로 확인된"이 들어가고
//   (2) 모든 거래 행에 계약일이 눈에 띄게 붙고
//   (3) 관찰일≠계약일 설명이 툴팁이 아니라 본문에 있다.
// "오늘 부산에서 N건 계약"으로 읽힐 여지를 남기지 않는다.

import styles from './RegionReportSheet.module.css';
import type { ReportEnvelope, ReportSection } from '@/lib/report/types';
import type { DailyTradeReportData } from '@/lib/report/daily-report';
import ReportActions from './ReportActions';

const STATE_TITLE: Record<string, string> = {
  WITHHELD_BACKFILL: '이 날짜는 집계를 제공하지 않습니다',
  PREPARING: '데이터 확인 중',
  OUTSIDE_SUPPORTED_RANGE: '집계 제공 기간이 아닙니다',
  READY_ZERO: '새로 확인된 실거래가 없습니다',
};

const STATE_CLASS: Record<string, string> = {
  WITHHELD_BACKFILL: 'stateWithheld',
  PREPARING: 'statePreparing',
  OUTSIDE_SUPPORTED_RANGE: 'statePreparing',
  READY_ZERO: 'stateZero',
};

function DistributionSection({ section }: { section: ReportSection }) {
  const top = section.rows.slice(0, 8);
  const max = Math.max(1, ...top.map((r) => Number(r.cells.count ?? 0)));
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{section.title}</h2>
      {top.map((r) => {
        const count = Number(r.cells.count ?? 0);
        return (
          <div key={r.key} className={styles.barRow}>
            <span className={styles.barName}>{String(r.cells.name ?? '')}</span>
            <span className={styles.barTrack}>
              <span className={styles.barFill} style={{ width: `${Math.round((count / max) * 100)}%` }} />
            </span>
            <span className={styles.barValue}>{count}건</span>
          </div>
        );
      })}
    </section>
  );
}

/** 거래 카드 — 단지명/지역/전용㎡/가격 + **계약일**을 항상 함께(§13/§14). */
function TradeSection({ section }: { section: ReportSection }) {
  if (section.rows.length === 0) return null;
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{section.title}</h2>
      <div className={styles.tradeList}>
        {section.rows.map((r) => (
          <div key={r.key} className={styles.tradeCard}>
            <div className={styles.tradeTop}>
              <span className={styles.tradeName}>{String(r.cells.aptName ?? '')}</span>
              <span className={styles.tradePrice}>{String(r.cells.dealAmountLabel ?? '')}</span>
            </div>
            <div className={styles.tradeMeta}>
              {[
                r.cells.regionLabel ? String(r.cells.regionLabel) : null,
                // 평 변환 금지 — ㎡ 그대로.
                r.cells.exclusiveAreaM2 != null ? `전용 ${r.cells.exclusiveAreaM2}㎡` : null,
                r.cells.floor != null ? `${r.cells.floor}층` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
            {/* 관찰일과 헷갈리지 않도록 계약일을 별도 배지로 분리한다. */}
            <div className={styles.contractDate}>{String(r.cells.dealDateLabel ?? '')}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

const COMPLETENESS_LABEL: Record<string, { text: string; cls: string }> = {
  COMPLETE: { text: '검증 완료', cls: 'cComplete' },
  PARTIAL: { text: '일부 제한', cls: 'cPartial' },
  UNVERIFIED: { text: '검증 중', cls: 'cUnverified' },
};

export default function DailyReportSheet({ envelope }: { envelope: ReportEnvelope<DailyTradeReportData> }) {
  const data = envelope.data!;
  const published = data.numbersPublished;
  const state = data.publicationState;
  const c = COMPLETENESS_LABEL[envelope.trust.completeness] ?? COMPLETENESS_LABEL.UNVERIFIED;
  const dataAsOfText = envelope.dataAsOf ? envelope.dataAsOf.slice(0, 10).replace(/-/g, '.') : '확인 중';

  const dist = envelope.sections.find((s) => s.key === 'districtDistribution');
  const rep = envelope.sections.find((s) => s.key === 'representativeTrades');
  const high = envelope.sections.find((s) => s.key === 'highValueTrades');
  const band = envelope.sections.find((s) => s.key === 'standardAreaTrades');
  const countMetric = envelope.metrics.find((m) => m.key === 'newlyObserved')!;
  const rangeMetric = envelope.metrics.find((m) => m.key === 'contractDateRange');
  const districtsMetric = envelope.metrics.find((m) => m.key === 'districtsTouched');

  return (
    <div className={styles.page}>
      <article className={styles.sheet}>
        <header className={styles.header}>
          <div className={styles.brand}>이집 E-JIP</div>
          {/* 제목 자체가 "새로 확인된"을 담는다(§19). */}
          <h1 className={styles.title}>{envelope.title}</h1>
          <p className={styles.subtitle}>{envelope.subtitle}</p>
        </header>

        {/* 발행 불가 상태도 1급 화면이다 — 빈 시트를 보여주지 않는다(§18). */}
        {(!published || state === 'READY_ZERO') && (
          <div className={`${styles.stateBox} ${styles[STATE_CLASS[state] ?? 'statePreparing']}`}>
            <div className={styles.stateTitle}>{STATE_TITLE[state] ?? '데이터 확인 중'}</div>
            {data.message && <p className={styles.stateBody}>{data.message}</p>}
            {state === 'READY_ZERO' && (
              <p className={styles.stateBody}>
                이 날짜에 이집이 새로 확인한 부산 아파트 실거래가 없습니다. 수집은 정상적으로 확인되었습니다.
              </p>
            )}
          </div>
        )}

        {published && data.totalObserved > 0 && (
          <div className={styles.kpiGrid}>
            <div className={styles.kpi}>
              <div className={styles.kpiLabel}>{countMetric.label}</div>
              <div className={styles.kpiValue}>{countMetric.displayValue}</div>
            </div>
            {districtsMetric && (
              <div className={styles.kpi}>
                <div className={styles.kpiLabel}>{districtsMetric.label}</div>
                <div className={styles.kpiValue}>{districtsMetric.displayValue}</div>
              </div>
            )}
            {rangeMetric && (
              <div className={styles.kpi} style={{ gridColumn: '1 / -1' }}>
                <div className={styles.kpiLabel}>{rangeMetric.label}</div>
                <div className={styles.kpiValue} style={{ fontSize: '0.98rem' }}>{rangeMetric.displayValue}</div>
              </div>
            )}
          </div>
        )}

        {/* §14 — 툴팁이 아니라 본문에 둔다. */}
        <p className={styles.obsNote}>
          이 리포트의 날짜는 <strong>이집이 거래를 새로 확인한 날</strong>입니다. 실제 계약일은 훨씬 이전일 수 있어
          각 거래에 계약일을 따로 표시합니다.
        </p>

        {published && dist && <DistributionSection section={dist} />}
        {published && rep && <TradeSection section={rep} />}
        {published && high && <TradeSection section={high} />}
        {published && band && <TradeSection section={band} />}

        <footer className={styles.footer}>
          <div className={styles.footerRow}>
            <span className={`${styles.completeness} ${styles[c.cls]}`}>{c.text}</span>
            <span>데이터 기준: {dataAsOfText}</span>
            <span>관찰일: {data.observationDate}</span>
          </div>
          {envelope.trust.notes.length > 0 && (
            <ul className={styles.footerNotes}>
              {envelope.trust.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          <p className={styles.sourceNote}>국토교통부 실거래가 · 취소 거래 제외 · 부산 16개 자치구·군 기준</p>
        </footer>
      </article>

      <ReportActions title={envelope.title} />
    </div>
  );
}
