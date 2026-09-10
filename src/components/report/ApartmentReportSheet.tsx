// REPORT-3 — 단지 한장 리포트 (TEMPLATE REDESIGN V1).
//
// 카드 나열을 끝내고 **한 장 문서**로 재구성했다:
//   헤더(브랜드/제목/기준) → KPI 스트립 → 2단 본문(가격·거래 / 점수·입지)
//   → 해석 → 신뢰·출처 푸터
//
// **envelope만 읽는다.** Prisma도, 점수 재계산도, trust 재해석도 없다.
// 값이 없으면 비워둔다 — 채우려고 추정하지 않는다.

import styles from './ReportSheet.module.css';
import type { ReportEnvelope, ReportMetric, ReportSection } from '@/lib/report/types';
import ReportActions from './ReportActions';
import {
  DefinitionList,
  KpiCard,
  ReportHeader,
  ScoreDial,
  SectionHead,
  TrustFooter,
} from './ReportPrimitives';

/** KPI 스트립 — 한 장에서 가장 먼저 읽히는 6개. */
const KPI_KEYS = [
  'latestDealAmount',
  'ejipScore',
  'transactionCount12m',
  'medianPricePerM2_12m',
  'buildYear',
  'totalHouseholds',
];

/** 가격·거래 요약에 들어가는 항목(KPI와 중복돼도 맥락이 달라 함께 둔다). */
const PRICE_KEYS = ['medianDealAmount12m', 'medianPricePerM2_12m', 'priceChange12m'];

function metricOf(envelope: ReportEnvelope<unknown>, key: string): ReportMetric | undefined {
  return envelope.metrics.find((m) => m.key === key);
}

function formatManwon(manwon: number): string {
  const eok = Math.floor(manwon / 10000);
  const rest = Math.round(manwon % 10000);
  if (eok > 0) return rest > 0 ? `${eok}억 ${rest.toLocaleString('ko-KR')}` : `${eok}억`;
  return `${manwon.toLocaleString('ko-KR')}만`;
}

/** 항목별 점수 — count=점수, enriched=점수 존재 여부를 envelope이 담아둔 그대로. */
function ScoreDomains({ section }: { section: ReportSection }) {
  return (
    <>
      {/* 막대를 컨테이너로 감싼다 — A4 내보내기에서 2×2로 접기 위한 자리(§6). */}
      <div className={styles.barGrid}>
        {section.rows.map((r) => {
          const score = Number(r.cells.count ?? 0);
          return (
            <div key={r.key} className={styles.barRow}>
              <span className={styles.barName}>{String(r.cells.name ?? '')}</span>
              <span className={styles.barTrack} data-export-fixed-size="">
                {/* 점수가 없으면 막대를 그리지 않는다 — 0점처럼 보이면 안 된다. */}
                <span
                  className={styles.barFill}
                  data-export-fixed-size=""
                  style={{ width: r.enriched ? `${Math.min(100, score)}%` : '0%' }}
                />
              </span>
              <span className={`${styles.barValue} ${r.enriched ? '' : styles.barValueMissing}`}>
                {r.enriched ? `${score}점` : '정보 없음'}
              </span>
            </div>
          );
        })}
      </div>
      {section.note && <p className={styles.sectionNote}>{section.note}</p>}
    </>
  );
}

export default function ApartmentReportSheet({
  envelope,
  strengths,
  cautions,
}: {
  envelope: ReportEnvelope<unknown>;
  strengths: string[];
  cautions: string[];
}) {
  const kpis = KPI_KEYS.map((k) => metricOf(envelope, k)).filter((m): m is ReportMetric => !!m);
  const priceRows = PRICE_KEYS.map((k) => metricOf(envelope, k))
    .filter((m): m is ReportMetric => !!m)
    .map((m) => ({ key: m.key, label: m.label, value: m.displayValue, trust: m.trust }));

  const complexRows = ['totalHouseholds', 'parking', 'buildYear']
    .map((k) => metricOf(envelope, k))
    .filter((m): m is ReportMetric => !!m)
    .map((m) => ({ key: m.key, label: m.label, value: m.displayValue, trust: m.trust }));

  const domains = envelope.sections.find((s) => s.key === 'scoreDomains');
  const trades = envelope.sections.find((s) => s.key === 'recentTrades');
  const location = envelope.sections.find((s) => s.key === 'locationSummary');
  const detail = envelope.navigationTargets[0];

  const score = metricOf(envelope, 'ejipScore');
  const scoreValue = typeof score?.value === 'number' ? score.value : null;

  // 최근 실거래는 한 장에 맞게 5건까지만. 나머지는 상세로 유도한다.
  const tradeRows = trades?.rows.slice(0, 5) ?? [];
  const hasMoreTrades = (trades?.rows.length ?? 0) > tradeRows.length;

  const locationRows =
    location?.rows.map((r) => ({
      key: r.key,
      label: String(r.cells.name ?? ''),
      value: String(r.cells.value ?? '정보 없음'),
    })) ?? [];

  const hasInsight = !!envelope.interpretation.text || strengths.length > 0 || cautions.length > 0;

  return (
    <div className={styles.page}>
      <article className={styles.sheet} data-export-root="">
        <ReportHeader
          title={`${envelope.scope.displayName} 단지 리포트`}
          subtitle={envelope.subtitle}
          tags={['단지 리포트', envelope.period.label]}
          completeness={envelope.trust.completeness}
          stamp={envelope.dataAsOf ? `데이터 기준 ${envelope.dataAsOf.slice(0, 10).replace(/-/g, '.')}` : null}
        />

        <div className={styles.body}>
          {/* ── KPI 스트립 ─────────────────────────────────────────────── */}
          <div className={`${styles.kpiGrid} ${styles.kpiGrid6}`}>
            {kpis.map((m, i) => (
              <KpiCard key={m.key} metric={m} accent={i === 0} />
            ))}
          </div>

          {/* ── 2단 본문 ───────────────────────────────────────────────── */}
          <div className={styles.cols}>
            <div className={styles.col}>
              <section className={styles.section}>
                <SectionHead title="가격 · 거래 요약" meta={envelope.period.label} />
                <DefinitionList rows={priceRows} />
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

              {tradeRows.length > 0 && (
                <section className={styles.section}>
                  <SectionHead
                    title="최근 실거래"
                    meta={hasMoreTrades ? '최근 5건' : `총 ${tradeRows.length}건`}
                  />
                  <div className={styles.tradeList} data-export-cap="4">
                    {tradeRows.map((r) => {
                      const meta = [
                        // 평 라벨을 만들지 않는다 — ㎡ 그대로.
                        r.cells.exclusiveAreaM2 != null ? `전용 ${r.cells.exclusiveAreaM2}㎡` : null,
                        r.cells.floor != null ? `${r.cells.floor}층` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ');
                      return (
                        <div key={r.key} className={styles.tradeRow}>
                          <span className={styles.tradeMeta}>
                            {meta}
                            <span className={styles.tradeDate}>{String(r.cells.dealDate ?? '')}</span>
                          </span>
                          <span className={styles.tradePrice}>{formatManwon(Number(r.cells.dealAmount))}</span>
                        </div>
                      );
                    })}
                  </div>
                  {hasMoreTrades && (
                    <p className={styles.sectionNote}>더 많은 거래는 이집 단지 상세 화면에서 확인할 수 있습니다.</p>
                  )}
                  {/* PDF/공유 이미지는 한 장 예산 안에서 4건만 싣는다. 줄였다는
                      사실을 문서 안에서 밝힌다 — 전부인 척하지 않는다(§5). */}
                  {tradeRows.length > 4 && (
                    <p className={styles.exportNote}>최근 거래 일부 표시 · 자세한 내용은 이집에서 확인</p>
                  )}
                  {trades?.note && <p className={styles.sectionNote}>{trades.note}</p>}
                </section>
              )}
            </div>

            <div className={styles.col}>
              {domains && domains.rows.length > 0 && (
                <section className={styles.section}>
                  <SectionHead title="이집 점수" meta={score?.trust === 'LIMITED' ? '참고' : null} />
                  <ScoreDial
                    score={scoreValue}
                    state={score?.displayValue ?? '준비 중'}
                    desc={score?.reason ?? '교통·생활·교육·단지 데이터를 기준으로 평가한 주거 품질 점수입니다.'}
                  />
                  <ScoreDomains section={domains} />
                </section>
              )}

              {locationRows.length > 0 && (
                <section className={styles.section}>
                  <SectionHead title="생활 · 입지" />
                  <DefinitionList rows={locationRows} />
                </section>
              )}

              {complexRows.length > 0 && (
                <section className={styles.section}>
                  <SectionHead title="단지 정보" />
                  <DefinitionList rows={complexRows} />
                </section>
              )}
            </div>
          </div>

          {/* ── 해석 ───────────────────────────────────────────────────── */}
          {hasInsight && (
            <section className={styles.section}>
              <SectionHead title="이집 데이터 해석" />
              {/* Score briefing이 만든 결정론적 문장만 온다. 예측/추천 없음. */}
              {envelope.interpretation.text && (
                <p className={styles.summaryLine}>{envelope.interpretation.text}</p>
              )}
              {(strengths.length > 0 || cautions.length > 0) && (
                <div className={styles.insightCols}>
                  {strengths.length > 0 && (
                    <div className={styles.insightBox}>
                      <div className={styles.insightTitle}>강점</div>
                      <ul className={styles.insightList}>
                        {strengths.map((s) => (
                          <li key={s}>{s}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {cautions.length > 0 && (
                    <div className={`${styles.insightBox} ${styles.insightBoxWarn}`}>
                      <div className={`${styles.insightTitle} ${styles.insightTitleWarn}`}>확인할 점</div>
                      <ul className={styles.insightList}>
                        {cautions.map((s) => (
                          <li key={s}>{s}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
        </div>

        <TrustFooter
          envelope={envelope}
          extra={[`기간 ${envelope.period.label}`]}
          sourceNote="국토교통부 실거래가 · 취소 거래 제외 · 이집 점수는 상세 화면과 동일 기준 · 전용면적(㎡) 기준"
        />
      </article>

      <ReportActions
        title={`${envelope.scope.displayName} 단지 리포트`}
        envelope={envelope}
        detailHref={detail?.href ?? null}
        detailLabel={detail?.label}
      />
    </div>
  );
}
