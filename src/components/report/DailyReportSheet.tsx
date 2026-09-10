// REPORT-5 — 일별 "새로 확인된 실거래" (TEMPLATE REDESIGN V1).
//
// PHASE A/B와 같은 디자인 시스템을 쓰되, **상태가 숫자보다 앞선다.**
// 보류/준비 중이면 화면의 주인공은 상태 설명이고 숫자는 아예 만들지 않는다
// (envelope이 이미 숫자를 만들지 않았다 — 화면에서 다시 판단하지 않는다).
//
// 공유 안전: 이 시트는 스크린샷으로 문맥 없이 돌아다닌다. 그래서
//   (1) 제목에 "새로 확인된"이 들어가고
//   (2) 모든 거래 행에 계약일이 붙고
//   (3) 관찰일≠계약일 설명이 툴팁이 아니라 본문에 있다.
// "오늘 부산에서 N건 계약"으로 읽힐 여지를 남기지 않는다.

import styles from './ReportSheet.module.css';
import type { ReportEnvelope, ReportSection } from '@/lib/report/types';
import type { DailyTradeReportData } from '@/lib/report/daily-report';
import ReportActions from './ReportActions';
import { KpiCard, ReportHeader, SectionHead, TrustFooter } from './ReportPrimitives';

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
      <SectionHead title={section.title} meta={`상위 ${top.length}곳`} />
      {top.map((r) => {
        const count = Number(r.cells.count ?? 0);
        return (
          <div key={r.key} className={styles.barRow}>
            <span className={styles.barName}>{String(r.cells.name ?? '')}</span>
            <span className={styles.barTrack} data-export-fixed-size="">
              <span
                className={styles.barFill}
                data-export-fixed-size=""
                style={{ width: `${Math.round((count / max) * 100)}%` }}
              />
            </span>
            <span className={styles.barValue}>{count}건</span>
          </div>
        );
      })}
    </section>
  );
}

/** 거래 행 — 단지명/지역/전용㎡ + **계약일**을 항상 함께. */
function TradeSection({ section }: { section: ReportSection }) {
  if (section.rows.length === 0) return null;
  return (
    <section className={styles.section}>
      <SectionHead title={section.title} meta={`${section.rows.length}건`} />
      <div className={styles.tradeList}>
        {section.rows.map((r) => {
          const meta = [
            r.cells.regionLabel ? String(r.cells.regionLabel) : null,
            // 평 변환 금지 — ㎡ 그대로.
            r.cells.exclusiveAreaM2 != null ? `전용 ${r.cells.exclusiveAreaM2}㎡` : null,
            r.cells.floor != null ? `${r.cells.floor}층` : null,
          ]
            .filter(Boolean)
            .join(' · ');
          return (
            <div key={r.key} className={styles.tradeRow}>
              <span className={styles.tradeMeta}>
                <strong className={styles.dlVal}>{String(r.cells.aptName ?? '')}</strong>
                <span className={styles.tradeDate}>{meta}</span>
                {/* 관찰일과 헷갈리지 않도록 계약일을 별도로 분리한다. */}
                <span className={styles.tradeDate}>{String(r.cells.dealDateLabel ?? '')}</span>
              </span>
              <span className={styles.tradePrice}>{String(r.cells.dealAmountLabel ?? '')}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function DailyReportSheet({ envelope }: { envelope: ReportEnvelope<DailyTradeReportData> }) {
  const data = envelope.data!;
  const published = data.numbersPublished;
  const state = data.publicationState;

  const dist = envelope.sections.find((s) => s.key === 'districtDistribution');
  const rep = envelope.sections.find((s) => s.key === 'representativeTrades');
  const high = envelope.sections.find((s) => s.key === 'highValueTrades');
  const band = envelope.sections.find((s) => s.key === 'standardAreaTrades');
  const kpis = envelope.metrics.filter((m) =>
    ['newlyObserved', 'districtsTouched', 'contractDateRange'].includes(m.key)
  );

  return (
    <div className={styles.page}>
      <article className={styles.sheet} data-export-root="">
        <ReportHeader
          title={envelope.title}
          subtitle={envelope.subtitle}
          tags={['일별 리포트', `관찰일 ${data.observationDate}`]}
          completeness={envelope.trust.completeness}
          stamp={envelope.dataAsOf ? `데이터 기준 ${envelope.dataAsOf.slice(0, 10).replace(/-/g, '.')}` : null}
        />

        <div className={styles.body}>
          {/* 발행 불가 상태도 1급 화면이다 — 빈 시트를 보여주지 않는다. */}
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

          {published && data.totalObserved > 0 && kpis.length > 0 && (
            <div className={styles.kpiGrid}>
              {kpis.map((m, i) => (
                <KpiCard key={m.key} metric={m} accent={i === 0} />
              ))}
            </div>
          )}

          {/* 관찰일/계약일 구분은 툴팁이 아니라 본문에 둔다. */}
          <p className={styles.summaryLine}>
            이 리포트의 날짜는 <strong>이집이 거래를 새로 확인한 날</strong>입니다. 실제 계약일은 훨씬 이전일 수
            있어 각 거래에 계약일을 따로 표시합니다.
          </p>

          {published && (
            <div className={styles.cols}>
              <div className={styles.col}>
                {rep && <TradeSection section={rep} />}
                {band && <TradeSection section={band} />}
              </div>
              <div className={styles.col}>
                {dist && dist.rows.length > 0 && <DistributionSection section={dist} />}
                {high && <TradeSection section={high} />}
              </div>
            </div>
          )}
        </div>

        <TrustFooter
          envelope={envelope}
          extra={[`관찰일 ${data.observationDate}`]}
          sourceNote="국토교통부 실거래가 · 취소 거래 제외 · 부산 16개 자치구·군 기준 · 전용면적(㎡) 기준"
        />
      </article>

      <ReportActions title={envelope.title} envelope={envelope} />
    </div>
  );
}
