// REPORT-2 — 지역 한장 브리핑 템플릿.
//
// **이 컴포넌트는 envelope만 읽는다.** Prisma도, 집계도, trust 재해석도 하지 않는다(§2).
// 화면에 나오는 모든 숫자/문구/신뢰 표시는 이미 envelope 안에 결정되어 있고, 여기서는
// 그것을 배치만 한다. 규칙을 화면에서 다시 판단하기 시작하면 REPORT-1이 막아둔
// "화면마다 다른 진실"이 그대로 돌아온다.

import Link from 'next/link';
import styles from './RegionReportSheet.module.css';
import type { MetricTrust, ReportEnvelope, ReportMetric, ReportSection } from '@/lib/report/types';
import ReportActions from './ReportActions';

/** KPI로 띄울 지표 키와 순서. 스코프별로 의미 있는 것만 고른다(§6). */
const KPI_KEYS_BY_TYPE: Record<string, string[]> = {
  REGION_CITY: ['transactionCount', 'medianDealAmount', 'transactionCountDelta', 'latestDealDate'],
  REGION_DISTRICT: ['transactionCount', 'medianDealAmount', 'transactionCountDelta', 'latestDealDate'],
  // 동은 표본이 작아 ㎡당 중앙가가 오히려 더 읽을 만하다(§9).
  REGION_DONG: ['transactionCount', 'medianDealAmount', 'medianPricePerM2', 'latestDealDate'],
};

function TrustChip({ trust }: { trust: MetricTrust }) {
  if (trust === 'SAFE') return null;
  // MISSING은 값 자체가 이미 '정보 없음'을 말하므로 칩을 또 붙이지 않는다(중복 표기 방지).
  if (trust === 'MISSING') return null;
  if (trust === 'LIMITED') return <span className={`${styles.trustChip} ${styles.trustLimited}`}>참고</span>;
  return <span className={`${styles.trustChip} ${styles.trustMissing}`}>미검증</span>;
}

function Kpi({ metric }: { metric: ReportMetric }) {
  const missing = metric.trust === 'MISSING';
  // 증감률만 방향 색을 준다. 나머지에 색을 칠하면 한 장 안에서 강조가 흩어진다.
  const dir =
    metric.key === 'transactionCountDelta' && typeof metric.value === 'number'
      ? metric.value > 0
        ? styles.kpiUp
        : metric.value < 0
          ? styles.kpiDown
          : ''
      : '';
  return (
    <div className={styles.kpi}>
      <div className={styles.kpiLabel}>
        {metric.label}
        <TrustChip trust={metric.trust} />
      </div>
      {/* MISSING은 0이 아니다 — envelope이 만든 '정보 없음'을 그대로 쓴다(§6). */}
      <div className={`${styles.kpiValue} ${missing ? styles.kpiValueMissing : ''} ${dir}`}>
        {metric.displayValue}
      </div>
    </div>
  );
}

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
 * §16 — 대표 거래는 canonical aptSeq가 있을 때만 상세로 링크한다.
 * 이름만으로 링크를 만들지 않는다(다른 단지로 보낼 위험).
 */
function aptHref(cells: Record<string, string | number | null>): string | null {
  const aptSeq = cells.aptSeq;
  const name = cells.aptName;
  if (!aptSeq || typeof name !== 'string') return null;
  return `/apt/${encodeURIComponent(name)}?aptSeq=${encodeURIComponent(String(aptSeq))}`;
}

function TradeSection({ section, showDong }: { section: ReportSection; showDong: boolean }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{section.title}</h2>
      <div className={styles.tradeList}>
        {section.rows.slice(0, 5).map((r) => {
          const href = aptHref(r.cells);
          const area = r.cells.exclusiveAreaM2;
          const price = r.cells.dealAmount;
          const meta = [
            showDong && r.cells.dong ? String(r.cells.dong) : null,
            // 평 라벨을 만들지 않는다 — ㎡ 그대로.
            area != null ? `전용 ${area}㎡` : null,
            r.cells.dealDate ? String(r.cells.dealDate) : null,
            r.cells.count != null ? `${r.cells.count}건 거래` : null,
          ]
            .filter(Boolean)
            .join(' · ');
          const body = (
            <>
              <div className={styles.tradeTop}>
                <span className={styles.tradeName}>{String(r.cells.aptName ?? '')}</span>
                {price != null && <span className={styles.tradePrice}>{formatManwon(Number(price))}</span>}
              </div>
              {/* 보강이 없어도 행을 숨기지 않는다(§11) — 있는 사실만 적는다. */}
              <div className={styles.tradeMeta}>{meta}</div>
              {href && <div className={styles.linkHint}>이집에서 자세히 보기 →</div>}
            </>
          );
          return href ? (
            <Link key={r.key} href={href} className={styles.tradeCard}>
              {body}
            </Link>
          ) : (
            <div key={r.key} className={styles.tradeCard}>
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

const COMPLETENESS_LABEL: Record<string, { text: string; cls: string }> = {
  COMPLETE: { text: '검증 완료', cls: 'cComplete' },
  PARTIAL: { text: '일부 제한', cls: 'cPartial' },
  UNVERIFIED: { text: '검증 중', cls: 'cUnverified' },
};

export default function RegionReportSheet({ envelope }: { envelope: ReportEnvelope }) {
  const kpiKeys = KPI_KEYS_BY_TYPE[envelope.reportType] ?? [];
  const kpis = kpiKeys
    .map((k) => envelope.metrics.find((m) => m.key === k))
    .filter((m): m is ReportMetric => !!m);

  const distribution = envelope.sections.find((s) => s.kind === 'DISTRIBUTION');
  const complexes = envelope.sections.find((s) => s.key === 'representativeComplexes');
  const recent = envelope.sections.find((s) => s.key === 'recentTrades');
  const c = COMPLETENESS_LABEL[envelope.trust.completeness] ?? COMPLETENESS_LABEL.UNVERIFIED;
  const dataAsOfText = envelope.dataAsOf ? envelope.dataAsOf.slice(0, 10).replace(/-/g, '.') : '확인 중';

  return (
    <div className={styles.page}>
      <article className={styles.sheet} data-export-root="">
        <header className={styles.header}>
          <div className={styles.brand}>이집 E-JIP</div>
          <h1 className={styles.title}>{envelope.scope.displayName} 부동산 한장 브리핑</h1>
          <p className={styles.subtitle}>{envelope.subtitle}</p>
        </header>

        <div className={styles.kpiGrid}>
          {kpis.map((m) => (
            <Kpi key={m.key} metric={m} />
          ))}
        </div>

        {distribution && distribution.rows.length > 0 && <DistributionSection section={distribution} />}

        {complexes && complexes.rows.length > 0 && (
          <TradeSection section={complexes} showDong={envelope.scope.level !== 'DONG'} />
        )}

        {recent && recent.rows.length > 0 && (
          <TradeSection section={recent} showDong={envelope.scope.level !== 'DONG'} />
        )}

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

        {envelope.interpretation.text && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>이집 데이터 해석</h2>
            {/* 결정론적 문장만 온다(§13). 생성형 AI 없음, 예측 없음. */}
            <p className={styles.interpretation}>{envelope.interpretation.text}</p>
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
          <p className={styles.sourceNote}>
            국토교통부 실거래가 · 취소 거래 제외 · 부산 16개 자치구·군 기준
          </p>
        </footer>
      </article>

      <ReportActions title={`${envelope.scope.displayName} 부동산 한장 브리핑`} envelope={envelope} />
    </div>
  );
}
