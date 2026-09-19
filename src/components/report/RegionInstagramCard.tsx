// ONE_PAGE_REPORT_REDESIGN_V1 — 인스타그램 피드 4:5(1080×1350) 전용 레이아웃.
//
// 한 장 리포트를 줄여 찍지 않는다. 같은 envelope(같은 기간·같은 값)을 피드 한 장 크기에 맞춘 **전용 배치**로 그린다.
// 이 컴포넌트는 envelope만 읽는다 — 집계·통계 계산을 다시 하지 않는다(RegionReportSheet와 같은 원칙).
// 화면에는 보이지 않고, 사용자가 "인스타 피드용"을 눌렀을 때만 화면 밖에 잠깐 그려 PNG로 굽는다.

import styles from './RegionInstagramCard.module.css';
import type { ReportEnvelope, ReportMetric, ReportSection } from '@/lib/report/types';
import {
  isLowSampleCount,
  regionPriceTop,
  regionReportDataOf,
  topPriceBandSub,
  topPriceBandText,
} from '@/lib/report/region-report';
import { formatRegionAvgPrice, REGION_PRICE_LOW_SAMPLE_BELOW } from '@/lib/stats/region-price-comparison';
import { complexCountLabel, complexRowLabels } from '@/lib/report/complex-row-labels';
import { isVolumePeriodPreset, needsReportingLagNotice } from '@/lib/stats/volume-period';

/** 출력 크기(px). 4:5 = 인스타그램 피드 세로 최대 비율. */
export const INSTAGRAM_FEED_WIDTH = 1080;
export const INSTAGRAM_FEED_HEIGHT = 1350;

const LIST_LIMIT = 5;

const COMPLETENESS_TEXT: Record<string, string> = {
  COMPLETE: '검증 완료',
  PARTIAL: '일부 제한',
  UNVERIFIED: '수집 검증 중',
};

function dot(ymd: string): string {
  return ymd.replace(/-/g, '.');
}

function metricOf(envelope: ReportEnvelope, key: string): ReportMetric | null {
  return envelope.metrics.find((m) => m.key === key) ?? null;
}

function sectionOf(envelope: ReportEnvelope, key: string): ReportSection | null {
  return envelope.sections.find((s) => s.key === key) ?? null;
}

function manwonShort(manwon: number): string {
  const eok = Math.floor(manwon / 10000);
  const rest = Math.round(manwon % 10000);
  if (eok > 0) return rest > 0 ? `${eok}억 ${rest.toLocaleString('ko-KR')}` : `${eok}억`;
  return `${manwon.toLocaleString('ko-KR')}만`;
}

interface Kpi {
  label: string;
  value: string;
  sub: string | null;
  muted: boolean;
  low?: boolean;
}

/** envelope 지표 → 카드 4칸. 값은 envelope 그대로, 긴 표기만 두 줄(값 / 설명)로 나눈다. */
function buildKpis(envelope: ReportEnvelope): Kpi[] {
  const data = regionReportDataOf(envelope);
  const count = metricOf(envelope, 'transactionCount');
  const band = metricOf(envelope, 'topPriceBand');
  const perM2 = metricOf(envelope, 'medianPricePerM2');
  const delta = metricOf(envelope, 'transactionCountDelta');
  const countValue = Number(count?.value ?? 0);

  const kpis: Kpi[] = [
    { label: '거래건수', value: `${countValue.toLocaleString('ko-KR')}건`, sub: '취소 거래 제외', muted: countValue === 0 },
  ];

  if (data) {
    const sub = topPriceBandSub(data.priceKpi);
    kpis.push({
      label: '많이 거래된 가격대',
      value: topPriceBandText(data.priceKpi),
      sub,
      muted: data.priceKpi.topBands.length === 0 || data.priceKpi.topBands.length > 2,
      low: isLowSampleCount(data.priceKpi.count),
    });
  } else if (band) {
    kpis.push({ label: '많이 거래된 가격대', value: band.displayValue, sub: null, muted: band.value == null });
  }

  kpis.push(
    perM2 && perM2.value != null
      ? { label: '㎡당 중앙가격', value: `${Number(perM2.value).toLocaleString('ko-KR')}만원`, sub: '전용면적 기준 가운데 값', muted: false }
      : { label: '㎡당 중앙가격', value: '데이터 없음', sub: null, muted: true }
  );

  if (envelope.scope.level === 'DONG') {
    // 한장 리포트와 같은 선택: 동은 증감 대신 매매 중앙가격(표본이 작다).
    const med = metricOf(envelope, 'medianDealAmount');
    kpis.push(
      med && med.value != null
        ? { label: '매매 중앙가격', value: formatRegionAvgPrice(Number(med.value)), sub: '가격순 가운데 값', muted: false }
        : { label: '매매 중앙가격', value: '거래 없음', sub: null, muted: true }
    );
  } else if (!delta) {
    kpis.push({ label: '거래량 변화', value: '비교 안 함', sub: '하루 단위는 비교하지 않음', muted: true });
  } else if (delta.value == null) {
    kpis.push({ label: '거래량 변화', value: '비교 불가', sub: '직전 동일기간 거래 없음', muted: true });
  } else {
    const pct = Number(delta.value);
    kpis.push({
      label: '거래량 변화',
      value: `${pct > 0 ? '+' : ''}${pct}%`,
      sub: `직전 동일기간 ${Number(delta.sampleSize ?? 0).toLocaleString('ko-KR')}건 → ${countValue.toLocaleString('ko-KR')}건`,
      muted: false,
    });
  }
  return kpis;
}

function EmptyList({ text }: { text: string }) {
  return <p className={styles.empty}>{text}</p>;
}

function RegionPriceList({ envelope }: { envelope: ReportEnvelope }) {
  const data = regionReportDataOf(envelope);
  const top = regionPriceTop(data?.regionPrice ?? null, LIST_LIMIT);
  const title = envelope.scope.level === 'CITY' ? '구·군별 평균 매매가격' : '동별 평균 매매가격';
  const row = (r: (typeof top.ranked)[number], rank: number | null) => (
    <div key={r.key} className={`${styles.row} ${r.lowSample ? styles.rowLow : ''}`}>
      <span className={styles.rank}>{rank ?? ''}</span>
      <span className={styles.nameInline}>
        <span className={styles.nameText}>{r.name}</span>
        {/* 표본 적음은 묶음 제목("거래 5건 미만 · 참고용")이 이미 말한다 — 행마다 반복하면 동 이름이 잘린다
            (서구 15일 실측: '서대신동2가'가 '서대신동'으로 잘려 다른 동처럼 읽혔다). */}
        <span className={styles.nameMeta}>{r.count.toLocaleString('ko-KR')}건</span>
      </span>
      <span className={styles.value}>{r.avgAmount != null ? formatRegionAvgPrice(r.avgAmount) : '거래 없음'}</span>
    </div>
  );
  return (
    <section className={styles.list}>
      <h2 className={styles.listTitle}>{title}</h2>
      {top.ranked.length === 0 && top.reference.length === 0 ? (
        <EmptyList text="해당 기간 거래가 없습니다" />
      ) : (
        <>
          {top.ranked.map((r, i) => row(r, i + 1))}
          {top.reference.length > 0 && <div className={styles.groupLabel}>거래 {REGION_PRICE_LOW_SAMPLE_BELOW}건 미만 · 참고용</div>}
          {top.reference.map((r) => row(r, null))}
        </>
      )}
    </section>
  );
}

function ComplexList({ envelope }: { envelope: ReportEnvelope }) {
  const section = sectionOf(envelope, 'representativeComplexes');
  const rows = (section?.rows ?? []).slice(0, LIST_LIMIT);
  const labels = complexRowLabels(
    rows.map((r) => ({ aptName: String(r.cells.aptName ?? ''), dong: r.cells.dong != null ? String(r.cells.dong) : null })),
    envelope.scope.level !== 'DONG'
  );
  return (
    <section className={styles.list}>
      <h2 className={styles.listTitle}>거래 많은 단지</h2>
      {rows.length === 0 ? (
        <EmptyList text="해당 기간 거래가 없습니다" />
      ) : (
        rows.map((r, i) => (
          <div key={r.key} className={styles.row}>
            <span className={styles.rank}>{i + 1}</span>
            <span className={styles.name}>
              <span className={styles.nameText}>{labels[i]}</span>
            </span>
            <span className={styles.value}>{complexCountLabel(r.cells.count)}</span>
          </div>
        ))
      )}
    </section>
  );
}

function RecentList({ envelope }: { envelope: ReportEnvelope }) {
  const section = sectionOf(envelope, 'recentTrades');
  const rows = (section?.rows ?? []).slice(0, LIST_LIMIT);
  return (
    <section className={styles.list}>
      <h2 className={styles.listTitle}>최근 실거래</h2>
      {rows.length === 0 ? (
        <EmptyList text="해당 기간 거래가 없습니다" />
      ) : (
        rows.map((r) => (
          <div key={r.key} className={`${styles.row} ${styles.rowTall} ${styles.rowNoRank}`}>
            <span className={styles.name}>
              <span className={styles.nameText}>{String(r.cells.aptName ?? '')}</span>
              <span className={styles.nameSub}>
                {[r.cells.exclusiveAreaM2 != null ? `전용 ${r.cells.exclusiveAreaM2}㎡` : null, r.cells.dealDate ? String(r.cells.dealDate) : null]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
            <span className={styles.value}>{r.cells.dealAmount != null ? manwonShort(Number(r.cells.dealAmount)) : ''}</span>
          </div>
        ))
      )}
    </section>
  );
}

export default function RegionInstagramCard({ envelope }: { envelope: ReportEnvelope }) {
  const data = regionReportDataOf(envelope);
  const kpis = buildKpis(envelope);
  const range = envelope.period.start === envelope.period.end ? dot(envelope.period.start) : `${dot(envelope.period.start)} ~ ${dot(envelope.period.end)}`;
  const dataAsOf = envelope.dataAsOf ? dot(envelope.dataAsOf.slice(0, 10)) : '확인 중';
  const hasRegionPrice = !!data?.regionPrice;

  return (
    <div className={styles.card} data-instagram-card="" style={{ width: INSTAGRAM_FEED_WIDTH, height: INSTAGRAM_FEED_HEIGHT }}>
      <header className={styles.head}>
        <div className={styles.brandRow}>
          <span className={styles.brand}>
            <span className={styles.symbol} data-export-fixed-size="">이</span>
            이집 E-JIP
          </span>
          <span className={styles.periodChip}>{envelope.period.label}</span>
        </div>
        <h1 className={styles.region}>{envelope.scope.displayName}</h1>
        <p className={styles.sub}>
          아파트 매매 실거래 · {range}
        </p>
      </header>

      <div className={styles.body} data-instagram-body="">
        {data && <p className={styles.lead}>{data.summaryLine}</p>}

        <div className={styles.kpis}>
          {kpis.map((k, i) => (
            <div key={k.label} className={`${styles.kpi} ${i === 0 ? styles.kpiAccent : ''}`}>
              <div className={styles.kpiLabel}>
                {k.label}
                {k.low && <span className={styles.lowTag}>표본 적음</span>}
              </div>
              <div className={`${styles.kpiValue} ${k.muted ? styles.kpiMuted : ''} ${k.value.length > 8 ? styles.kpiValueLong : ''}`}>{k.value}</div>
              {k.sub && <div className={styles.kpiSub}>{k.sub}</div>}
            </div>
          ))}
        </div>

        <div className={styles.lists}>
          {hasRegionPrice ? <RegionPriceList envelope={envelope} /> : <ComplexList envelope={envelope} />}
          {hasRegionPrice ? <ComplexList envelope={envelope} /> : <RecentList envelope={envelope} />}
        </div>
      </div>

      <footer className={styles.foot}>
        <div className={styles.footBrandBox}>
          <span className={styles.footBrand}>이집 E-JIP</span>
          <span className={styles.footTag}>복잡한 부동산, 이집으로 쉽게</span>
        </div>
        <div className={styles.footMeta}>
          <span>
            데이터 기준 {dataAsOf} · {COMPLETENESS_TEXT[envelope.trust.completeness] ?? COMPLETENESS_TEXT.UNVERIFIED}
          </span>
          <span>출처 국토교통부 실거래가 · 취소 거래 제외</span>
          {/* 통계 화면과 같은 규칙(needsReportingLagNotice) — 짧은 기간은 신고 시차로 거래가 더 들어올 수 있다. */}
          {envelope.period.key && isVolumePeriodPreset(envelope.period.key) && needsReportingLagNotice(envelope.period.key) && (
            <span>신고 시차에 따라 이후 거래가 추가될 수 있습니다</span>
          )}
        </div>
      </footer>
    </div>
  );
}
