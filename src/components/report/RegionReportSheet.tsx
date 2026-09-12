// REPORT-2 — 지역 한장 브리핑 (TEMPLATE REDESIGN V1).
//
// PHASE A/B와 **같은 디자인 시스템**(ReportSheet.module.css)을 쓴다.
//
// **이 컴포넌트는 envelope만 읽는다.** Prisma도, 집계도, trust 재해석도 하지 않는다.
// 화면에 나오는 모든 숫자/문구/신뢰 표시는 이미 envelope 안에 결정되어 있고, 여기서는
// 그것을 배치만 한다. 규칙을 화면에서 다시 판단하기 시작하면 REPORT-1이 막아둔
// "화면마다 다른 진실"이 그대로 돌아온다.

import Link from 'next/link';
import styles from './ReportSheet.module.css';
import type { ReportEnvelope, ReportMetric, ReportSection } from '@/lib/report/types';
import ReportActions from './ReportActions';
import { complexCountLabel, complexRowLabels } from '@/lib/report/complex-row-labels';
import { KpiCard, ReportHeader, SectionHead, TrustFooter } from './ReportPrimitives';

/** KPI로 띄울 지표 키와 순서. 스코프별로 의미 있는 것만 고른다. */
const KPI_KEYS_BY_TYPE: Record<string, string[]> = {
  REGION_CITY: ['transactionCount', 'medianDealAmount', 'medianPricePerM2', 'transactionCountDelta', 'latestDealDate'],
  REGION_DISTRICT: ['transactionCount', 'medianDealAmount', 'medianPricePerM2', 'transactionCountDelta', 'latestDealDate'],
  // 동은 표본이 작아 ㎡당 중앙가가 오히려 더 읽을 만하다.
  REGION_DONG: ['transactionCount', 'medianDealAmount', 'medianPricePerM2', 'latestDealDate'],
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
            <span className={styles.barValue}>
              {count}건 · {String(r.cells.share ?? 0)}%
            </span>
          </div>
        );
      })}
      {section.note && <p className={styles.sectionNote}>{section.note}</p>}
    </section>
  );
}

/**
 * 대표 거래는 canonical aptSeq가 있을 때만 상세로 링크한다.
 * 이름만으로 링크를 만들지 않는다(다른 단지로 보낼 위험).
 */
function aptHref(cells: Record<string, string | number | null>): string | null {
  const aptSeq = cells.aptSeq;
  const name = cells.aptName;
  if (!aptSeq || typeof name !== 'string') return null;
  return `/apt/${encodeURIComponent(name)}?aptSeq=${encodeURIComponent(String(aptSeq))}`;
}

/**
 * "거래가 많은 단지" — 한 줄 `[단지명] [N건]`.
 *
 * REPORT_TOP_COMPLEX_ROW_UI_TUNE_V1: 예전에는 `TradeSection`을 그대로 썼는데 이 섹션의
 * 행에는 가격이 없어서(cells에 dealAmount가 없다) 오른쪽이 비었고, 건수는 단지명 아래
 * 작은 글씨로 `동 · N건 거래`로 내려가 같은 정보가 두 줄로 흩어졌다. 이름과 건수를
 * 한 줄에서 바로 비교하도록 별도 컴포넌트로 분리한다 — `TradeSection`(최근 실거래)은
 * 그대로 둔다.
 *
 * 데이터는 손대지 않는다: 건수·순위·정렬·기간·집계는 모두 envelope이 이미 정했고
 * 여기서는 배치만 한다(이 파일의 헤더 원칙 그대로).
 */
function ComplexCountSection({ section, showDong }: { section: ReportSection; showDong: boolean }) {
  const rows = section.rows.slice(0, 5);
  // 같은 목록에 같은 이름이 있을 때만 동을 덧붙인다(평상시에는 이름 그대로).
  const labels = complexRowLabels(
    rows.map((r) => ({ aptName: String(r.cells.aptName ?? ''), dong: r.cells.dong != null ? String(r.cells.dong) : null })),
    showDong
  );
  return (
    <section className={styles.section}>
      <SectionHead title={section.title} meta={`상위 ${rows.length}곳`} />
      <div className={styles.tradeList}>
        {rows.map((r, i) => {
          const href = aptHref(r.cells);
          const body = (
            <>
              <span className={styles.complexName}>{labels[i]}</span>
              <span className={styles.complexCount}>{complexCountLabel(r.cells.count)}</span>
            </>
          );
          return href ? (
            <Link key={r.key} href={href} className={styles.complexRow}>
              {body}
            </Link>
          ) : (
            <div key={r.key} className={styles.complexRow}>
              {body}
            </div>
          );
        })}
      </div>
      {section.note && <p className={styles.sectionNote}>{section.note}</p>}
    </section>
  );
}

function TradeSection({ section, showDong }: { section: ReportSection; showDong: boolean }) {
  const rows = section.rows.slice(0, 5);
  return (
    <section className={styles.section}>
      <SectionHead title={section.title} meta={`${rows.length}건`} />
      <div className={styles.tradeList}>
        {rows.map((r) => {
          const href = aptHref(r.cells);
          const area = r.cells.exclusiveAreaM2;
          const price = r.cells.dealAmount;
          const meta = [
            showDong && r.cells.dong ? String(r.cells.dong) : null,
            // 평 라벨을 만들지 않는다 — ㎡ 그대로.
            area != null ? `전용 ${area}㎡` : null,
            r.cells.dealDate ? String(r.cells.dealDate) : null,
            // `N건 거래`는 "거래가 많은 단지" 전용이었고 그 섹션은 이제
            // ComplexCountSection이 한 줄로 보여준다. 남은 소비처(최근 실거래)의
            // 행에는 count 자체가 없다(enrichRows cells 참고).
          ]
            .filter(Boolean)
            .join(' · ');
          const body = (
            <>
              <span className={styles.tradeMeta}>
                <strong className={styles.dlVal}>{String(r.cells.aptName ?? '')}</strong>
                {/* 보강이 없어도 행을 숨기지 않는다 — 있는 사실만 적는다. */}
                <span className={styles.tradeDate}>{meta}</span>
              </span>
              {price != null && <span className={styles.tradePrice}>{formatManwon(Number(price))}</span>}
            </>
          );
          return href ? (
            <Link key={r.key} href={href} className={styles.tradeRow}>
              {body}
            </Link>
          ) : (
            <div key={r.key} className={styles.tradeRow}>
              {body}
            </div>
          );
        })}
      </div>
      {section.note && <p className={styles.sectionNote}>{section.note}</p>}
    </section>
  );
}

function formatManwon(manwon: number): string {
  const eok = Math.floor(manwon / 10000);
  const rest = Math.round(manwon % 10000);
  if (eok > 0) return rest > 0 ? `${eok}억 ${rest.toLocaleString('ko-KR')}` : `${eok}억`;
  return `${manwon.toLocaleString('ko-KR')}만`;
}

export default function RegionReportSheet({ envelope }: { envelope: ReportEnvelope }) {
  const kpiKeys = KPI_KEYS_BY_TYPE[envelope.reportType] ?? [];
  const kpis = kpiKeys
    .map((k) => envelope.metrics.find((m) => m.key === k))
    .filter((m): m is ReportMetric => !!m);

  const distribution = envelope.sections.find((s) => s.kind === 'DISTRIBUTION');
  const complexes = envelope.sections.find((s) => s.key === 'representativeComplexes');
  const recent = envelope.sections.find((s) => s.key === 'recentTrades');
  const showDong = envelope.scope.level !== 'DONG';
  const title = `${envelope.scope.displayName} 부동산 한장 브리핑`;

  return (
    <div className={styles.page}>
      <article className={styles.sheet} data-export-root="">
        <ReportHeader
          title={title}
          subtitle={envelope.subtitle}
          tags={['지역 브리핑', envelope.period.label]}
          completeness={envelope.trust.completeness}
          stamp={envelope.dataAsOf ? `데이터 기준 ${envelope.dataAsOf.slice(0, 10).replace(/-/g, '.')}` : null}
        />

        <div className={styles.body}>
          <div className={`${styles.kpiGrid} ${kpis.length > 4 ? styles.kpiGrid6 : ''}`}>
            {kpis.map((m, i) => (
              <KpiCard key={m.key} metric={m} accent={i === 0} />
            ))}
          </div>

          <div className={styles.cols}>
            <div className={styles.col}>
              {complexes && complexes.rows.length > 0 && (
                <ComplexCountSection section={complexes} showDong={showDong} />
              )}
              {recent && recent.rows.length > 0 && <TradeSection section={recent} showDong={showDong} />}
            </div>

            <div className={styles.col}>
              {distribution && distribution.rows.length > 0 && <DistributionSection section={distribution} />}

              {envelope.highlights.length > 0 && (
                <section className={styles.section}>
                  {envelope.highlights.map((h) => (
                    <div key={h.key} className={styles.highlight}>
                      <div className={styles.highlightLabel}>{h.label}</div>
                      <div className={styles.highlightValue}>{h.displayValue}</div>
                      {/* 기간 문구를 반드시 함께 노출한다 — '역대 신고가'로 읽히면 안 된다. */}
                      <div className={styles.highlightContext}>{h.contextLabel}</div>
                    </div>
                  ))}
                </section>
              )}
            </div>
          </div>

          {envelope.interpretation.text && (
            <section className={styles.section}>
              <SectionHead title="이집 데이터 해석" />
              {/* 결정론적 문장만 온다. 생성형 AI 없음, 예측 없음. */}
              <p className={styles.summaryLine}>{envelope.interpretation.text}</p>
            </section>
          )}
        </div>

        <TrustFooter
          envelope={envelope}
          extra={[`기간 ${envelope.period.label}`]}
          sourceNote="국토교통부 실거래가 · 취소 거래 제외 · 부산 16개 자치구·군 기준 · 전용면적(㎡) 기준"
        />
      </article>

      <ReportActions title={title} envelope={envelope} />
    </div>
  );
}
