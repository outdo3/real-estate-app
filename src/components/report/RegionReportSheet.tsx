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
import { aptDetailHref, districtReportHref, dongReportHref } from '@/lib/report/report-links';
import type { BreadcrumbItem } from '@/lib/seo/site-seo';
import { DefinitionList, KpiCard, ReportHeader, SectionHead, TrustFooter } from './ReportPrimitives';
import {
  isLowSampleCount,
  regionPriceTop,
  regionReportDataOf,
  topPriceBandSub,
  type RegionReportData,
} from '@/lib/report/region-report';
import { formatRegionAvgPrice, REGION_PRICE_LOW_SAMPLE_BELOW, type RegionPriceRow } from '@/lib/stats/region-price-comparison';

/**
 * KPI로 띄울 지표 키와 순서 — ONE_PAGE_REPORT_REDESIGN_V1: 통계 화면 상단과 같은 네 칸
 * (거래건수 · 많이 거래된 가격대 · ㎡당 중앙가격 · 거래량 변화). 매매 중앙가격은 지우지 않고
 * 아래 "가격 상세"로 옮겼다(envelope 값 그대로). 동은 예전처럼 증감 대신 매매 중앙가격을 둔다(표본이 작다).
 */
const KPI_KEYS_BY_TYPE: Record<string, string[]> = {
  REGION_CITY: ['transactionCount', 'topPriceBand', 'medianPricePerM2', 'transactionCountDelta'],
  REGION_DISTRICT: ['transactionCount', 'topPriceBand', 'medianPricePerM2', 'transactionCountDelta'],
  REGION_DONG: ['transactionCount', 'topPriceBand', 'medianPricePerM2', 'medianDealAmount'],
};

/**
 * STATS_PERIOD_IMAGE_PARITY_V2 §14 — 중앙값 카드 아래 한 줄 설명. 툴팁이 아니라 카드 안에 적는다 —
 * 이미지(PNG)·PDF로 저장해도 같이 남아야 뜻이 전달된다.
 */
const KPI_HINTS: Record<string, string> = {
  medianDealAmount: '가격순 가운데 값 · 평균과 다름',
  medianPricePerM2: '전용면적 기준 · 가격순 가운데 값',
  transactionCountDelta: '직전 동일기간 대비',
};

/** KPI 칸에서만 쓰는 짧은 이름(통계 화면과 같은 말). envelope 라벨은 그대로 둔다. */
const KPI_LABELS: Record<string, string> = {
  medianPricePerM2: '㎡당 중앙가격',
  transactionCountDelta: '거래량 변화',
};

/** 하루짜리 기간은 증감을 만들지 않는다(통계 화면과 같은 정책) — 빈칸 대신 이유를 적는다. 값이 아니라 안내다. */
const SINGLE_DAY_DELTA: ReportMetric = {
  key: 'transactionCountDelta',
  label: '거래량 변화',
  value: null,
  displayValue: '비교 안 함',
  unit: null,
  trust: 'MISSING',
  reason: '하루 단위는 신고 시차가 커서 전날과 비교하지 않습니다.',
  sampleSize: null,
  source: { source: '', dataAsOf: null },
};

/**
 * 거래량 변화 칸: "-29.3% (1120건 → 792건)"을 한 값으로 쓰면 360px에서 세 줄로 접힌다. 값(증감률)과
 * 근거(직전 → 현재 건수)를 나눠 쓴다 — 숫자는 envelope 지표 그대로(value = 증감률, sampleSize = 직전 건수).
 */
function presentKpi(m: ReportMetric, envelope: ReportEnvelope): { metric: ReportMetric; hint: string | null } | null {
  if (m.key !== 'transactionCountDelta' || m.value == null) return null;
  const pct = Number(m.value);
  const current = Number(envelope.metrics.find((x) => x.key === 'transactionCount')?.value ?? 0);
  return {
    metric: { ...m, label: KPI_LABELS[m.key] ?? m.label, displayValue: `${pct > 0 ? '+' : ''}${pct}%` },
    hint: `${Number(m.sampleSize ?? 0).toLocaleString('ko-KR')}건 → ${current.toLocaleString('ko-KR')}건 · 직전 동일기간 대비`,
  };
}

function kpiHint(m: ReportMetric, data: RegionReportData | null): string | null {
  if (m.key === 'topPriceBand' && data) {
    const sub = topPriceBandSub(data.priceKpi);
    if (!sub) return null;
    return isLowSampleCount(data.priceKpi.count) ? `${sub} · 표본 적음` : sub;
  }
  if (m === SINGLE_DAY_DELTA) return '하루 단위';
  return KPI_HINTS[m.key] ?? null;
}

/** 'YYYY-MM-DD' 기간 → 헤더용 'YYYY.MM.DD' 또는 'YYYY.MM.DD ~ YYYY.MM.DD'. 이미지 안에서도 기간을 확정한다. */
function periodRangeText(start: string, end: string): string {
  const dot = (ymd: string) => ymd.replace(/-/g, '.');
  return start === end ? dot(start) : `${dot(start)} ~ ${dot(end)}`;
}

/**
 * REGIONAL_SEO_KEYWORD_LANDING_V1 §12 — 분포 행의 하위 지역 링크(부산 → 구, 구 → 동).
 * 행 자체가 이미 envelope의 실제 거래에서 나온 지역이라 이름을 지어내지 않는다.
 * 경로는 리포트 경로 단일 정의(report-links)만 쓴다.
 */
function distributionHref(envelope: ReportEnvelope, cells: Record<string, string | number | null>): string | null {
  if (envelope.scope.level === 'CITY' && cells.lawdCd != null) return districtReportHref(String(cells.lawdCd));
  if (envelope.scope.level === 'DISTRICT' && cells.dong != null) return dongReportHref(envelope.scope.lawdCd, String(cells.dong));
  return null;
}

function DistributionSection({ section, envelope }: { section: ReportSection; envelope: ReportEnvelope }) {
  // ONE_PAGE_REPORT_REDESIGN_V1 — 지역 비교(평균 매매가격)가 위로 올라가 분포는 상위 5곳만 보조로 둔다.
  const top = section.rows.slice(0, 5);
  const max = Math.max(1, ...top.map((r) => Number(r.cells.count ?? 0)));
  return (
    // ONE_PAGE_REPORT_REDESIGN_V1 — 문서(PNG/PDF)에서는 싣지 않는다: 위 지역 비교가 하위 지역별 건수를 이미 보여 주고,
    // A4 한 장 예산을 넘긴다(부산 15일 실측 1080×1772). 웹에서는 하위 지역 이동 링크로 그대로 남는다.
    <section className={styles.section} data-export-hide="">
      <SectionHead title={section.title} meta={`상위 ${top.length}곳`} />
      {top.map((r) => {
        const count = Number(r.cells.count ?? 0);
        const href = distributionHref(envelope, r.cells);
        const name = String(r.cells.name ?? '');
        return (
          <div key={r.key} className={styles.barRow}>
            {href ? (
              <Link href={href} className={`${styles.barName} ${styles.barNameLink}`}>
                {name}
              </Link>
            ) : (
              <span className={styles.barName}>{name}</span>
            )}
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
 * 대표 거래는 canonical 식별(aptSeq + 그 거래의 lawdCd·dong)이 모두 있을 때만 상세로 링크한다.
 * 이름(+aptSeq)만으로 링크를 만들지 않는다 — 상세가 동명 다른 단지를 열었다(Production 재현).
 */
function aptHref(cells: Record<string, string | number | null>): string | null {
  const str = (v: string | number | null | undefined) => (v == null ? null : String(v));
  return aptDetailHref({ name: str(cells.aptName), aptSeq: str(cells.aptSeq), lawdCd: str(cells.lawdCd), dong: str(cells.dong) });
}

/**
 * ONE_PAGE_REPORT_REDESIGN_V1 — 하위 지역 평균 매매가격 TOP5(부산 → 구·군, 구 → 동).
 * 값·정렬은 envelope.data(통계 화면과 같은 함수)가 정했고 여기서는 자르기(regionPriceTop)와 배치만 한다.
 * 5건 이상은 순위, 1~4건은 "참고용" 묶음(순위 없음, 흐리게) — 통계 화면과 같은 규칙.
 */
function RegionPriceSection({ data, envelope }: { data: RegionReportData; envelope: ReportEnvelope }) {
  const top = regionPriceTop(data.regionPrice);
  const title = envelope.scope.level === 'CITY' ? '구·군별 평균 매매가격' : '동별 평균 매매가격';
  const empty = top.ranked.length === 0 && top.reference.length === 0;
  const row = (r: RegionPriceRow, rank: number | null) => {
    const href = distributionHref(envelope, envelope.scope.level === 'CITY' ? { lawdCd: r.key } : { dong: r.key });
    const body = (
      <>
        <span className={styles.priceRank}>{rank ?? ''}</span>
        <span className={styles.priceName}>
          <span className={styles.priceNameText}>{r.name}</span>
          <span className={styles.priceSub}>
            {r.count.toLocaleString('ko-KR')}건
            {r.avgPricePerM2 != null && ` · ㎡당 평균 ${Math.round(r.avgPricePerM2).toLocaleString('ko-KR')}만원`}
            {r.lowSample && <span className={styles.lowSampleTag}>표본 적음</span>}
          </span>
        </span>
        <span className={styles.priceValue}>{r.avgAmount != null ? formatRegionAvgPrice(r.avgAmount) : '거래 없음'}</span>
      </>
    );
    const cls = `${styles.priceRow} ${r.lowSample ? styles.priceRowLow : ''}`;
    return href ? (
      <Link key={r.key} href={href} className={cls}>
        {body}
      </Link>
    ) : (
      <div key={r.key} className={cls}>
        {body}
      </div>
    );
  };
  return (
    <section className={styles.section}>
      <SectionHead title={title} meta={empty ? null : `상위 ${top.ranked.length + top.reference.length}곳`} />
      {empty ? (
        <p className={styles.sectionNote}>해당 기간에 확인된 매매 거래가 없습니다.</p>
      ) : (
        <div className={styles.tradeList}>
          {top.ranked.map((r, i) => row(r, i + 1))}
          {top.reference.length > 0 && (
            <div className={styles.priceGroupLabel}>거래 {REGION_PRICE_LOW_SAMPLE_BELOW}건 미만 · 참고용</div>
          )}
          {top.reference.map((r) => row(r, null))}
        </div>
      )}
      {!empty && (
        <p className={styles.sectionNote}>
          기간 안 유효 매매 거래금액의 단순 평균(취소 제외) · 시세가 아닙니다.
          {top.omittedLowSample > 0 && ` 거래 ${REGION_PRICE_LOW_SAMPLE_BELOW}건 미만 ${top.omittedLowSample}곳은 생략했습니다.`}
        </p>
      )}
    </section>
  );
}

/** 매매 중앙가격·최근 계약일 — 상단 KPI에서 내려온 값(envelope 지표 그대로, 새 계산 없음). KPI에 이미 있는 값은 반복하지 않는다. */
function PriceDetailSection({ envelope, shownKeys }: { envelope: ReportEnvelope; shownKeys: readonly string[] }) {
  const keys = ['medianDealAmount', 'latestDealDate'].filter((k) => !shownKeys.includes(k));
  const rows = keys
    .map((k) => envelope.metrics.find((m) => m.key === k))
    .filter((m): m is ReportMetric => !!m)
    .map((m) => ({ key: m.key, label: m.label, value: m.displayValue, trust: m.trust }));
  if (rows.length === 0) return null;
  return (
    <section className={styles.section}>
      <SectionHead title="가격 상세" />
      <DefinitionList rows={rows} />
    </section>
  );
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

/** 문서(PNG/PDF)에 싣는 최근 실거래 수 — ReportSheet.module.css의 data-export-cap='3'과 짝. */
const DOC_TRADE_CAP = 3;

function TradeSection({ section, showDong }: { section: ReportSection; showDong: boolean }) {
  const rows = section.rows.slice(0, 5);
  return (
    <section className={styles.section}>
      {/* ONE_PAGE_REPORT_FINAL_POLISH_V1 — 건수 표시는 실제로 보이는 행 수와 같아야 한다: 웹 5건 / 문서 3건. */}
      <SectionHead
        title={section.title}
        meta={
          rows.length > DOC_TRADE_CAP ? (
            <>
              <span className={styles.webOnly}>{rows.length}건</span>
              <span className={styles.docOnly}>{DOC_TRADE_CAP}건</span>
            </>
          ) : (
            `${rows.length}건`
          )
        }
      />
      {/* 문서(PNG/PDF)는 3건까지 — A4 한 장 예산. 나머지는 exportNote가 밝힌다(단지 리포트와 같은 장치). */}
      <div className={styles.tradeList} data-export-cap="3">
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
      {rows.length > DOC_TRADE_CAP && <p className={styles.exportNote}>최근 거래 일부 표시 · 전체는 이집에서 확인</p>}
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

export interface RegionSubNav {
  title: string;
  links: readonly { name: string; href: string }[];
}

export default function RegionReportSheet({
  envelope,
  heading = null,
  breadcrumbs = [],
  subRegionNav = null,
}: {
  envelope: ReportEnvelope;
  /**
   * REGIONAL_SEO_KEYWORD_LANDING_V1 §10 — 페이지 H1(지역 SEO 템플릿). 없으면 기존 제목을 쓴다.
   * 공유/내보내기 제목(`title`)은 바꾸지 않는다 — 카카오 공유 카드 문구가 그대로 유지된다.
   */
  heading?: string | null;
  /** §12 — 이집 › 부산 › 서구 › 암남동. 시트 바깥(내보내기 이미지 밖)에 렌더한다. */
  breadcrumbs?: readonly BreadcrumbItem[];
  /** §12 — 하위 지역 브리핑 링크(부산 → 16개 구·군, 구 → 색인 대상 동). */
  subRegionNav?: RegionSubNav | null;
}) {
  const data = regionReportDataOf(envelope);
  const kpiKeys = KPI_KEYS_BY_TYPE[envelope.reportType] ?? [];
  const kpis = kpiKeys
    .map((k) => envelope.metrics.find((m) => m.key === k) ?? (k === 'transactionCountDelta' && envelope.period.singleDay ? SINGLE_DAY_DELTA : undefined))
    .filter((m): m is ReportMetric => !!m);

  const distribution = envelope.sections.find((s) => s.kind === 'DISTRIBUTION');
  const complexes = envelope.sections.find((s) => s.key === 'representativeComplexes');
  const recent = envelope.sections.find((s) => s.key === 'recentTrades');
  const showDong = envelope.scope.level !== 'DONG';
  const hasRegionPrice = !!data?.regionPrice;
  // 보조 묶음 — 분포(하위 지역 링크 포함)·가격 상세(매매 중앙가격·최근 계약일)·최근 2년 최고가.
  const secondary = (
    <>
      {distribution && distribution.rows.length > 0 && <DistributionSection section={distribution} envelope={envelope} />}
      <PriceDetailSection envelope={envelope} shownKeys={kpiKeys} />
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
    </>
  );
  const title = `${envelope.scope.displayName} 부동산 한장 브리핑`;
  const h1 = heading ?? title;

  return (
    <div className={styles.page}>
      {breadcrumbs.length > 1 && (
        <nav aria-label="지역 경로" className={styles.regionCrumbs}>
          <ol>
            {breadcrumbs.map((c, i) => (
              <li key={c.path}>
                {i < breadcrumbs.length - 1 ? <Link href={c.path}>{c.name}</Link> : <span aria-current="page">{c.name}</span>}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <article className={styles.sheet} data-export-root="">
        <ReportHeader
          title={h1}
          subtitle={envelope.subtitle}
          // H1이 지역 검색어로 바뀌어도 진입 CTA("서구 한장 브리핑")와 같은 제품 이름이 보이게 한다.
          // STATS_PERIOD_IMAGE_PARITY_V2 §13 — 기간 라벨과 **실제 날짜 범위**를 함께 싣는다. 저장한 이미지만 봐도
          // 어느 기간인지 알 수 있어야 한다(예: 최근 7일 · 2026.09.13 ~ 2026.09.19 / 어제 · 2026.09.18).
          tags={[heading ? '한장 브리핑' : '지역 브리핑', envelope.period.label, periodRangeText(envelope.period.start, envelope.period.end)]}
          completeness={envelope.trust.completeness}
          stamp={envelope.dataAsOf ? `데이터 기준 ${envelope.dataAsOf.slice(0, 10).replace(/-/g, '.')}` : null}
        />

        <div className={styles.body}>
          {/* ONE_PAGE_REPORT_REDESIGN_V1 — 한 줄 요약: envelope이 현재 데이터로만 만든 사실 문장(평가·전망 없음). */}
          {data && <p className={styles.summaryLead}>{data.summaryLine}</p>}

          <div className={`${styles.kpiGrid} ${styles.kpiGrid4}`}>
            {kpis.map((m, i) => {
              const split = presentKpi(m, envelope);
              return (
                <KpiCard
                  key={m.key}
                  metric={split ? split.metric : KPI_LABELS[m.key] ? { ...m, label: KPI_LABELS[m.key] } : m}
                  accent={i === 0}
                  hint={split ? split.hint : kpiHint(m, data)}
                />
              );
            })}
          </div>

          {/* 지역 비교 → 거래 많은 단지 → 최근 실거래 → 보조(분포·가격 상세·2년 최고가). 동 리포트는 하위 지역이 없어
              단지 옆에 가격 상세를 둔다. */}
          <div className={styles.cols}>
            <div className={styles.col}>
              {hasRegionPrice ? (
                <RegionPriceSection data={data!} envelope={envelope} />
              ) : (
                complexes && complexes.rows.length > 0 && <ComplexCountSection section={complexes} showDong={showDong} />
              )}
            </div>
            <div className={styles.col}>
              {hasRegionPrice ? (
                complexes && complexes.rows.length > 0 && <ComplexCountSection section={complexes} showDong={showDong} />
              ) : (
                secondary
              )}
            </div>
          </div>

          <div className={`${styles.cols} ${hasRegionPrice ? '' : styles.colsSingle}`}>
            <div className={styles.col}>
              {recent && recent.rows.length > 0 && <TradeSection section={recent} showDong={showDong} />}
            </div>
            {hasRegionPrice && <div className={styles.col}>{secondary}</div>}
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

      {subRegionNav && subRegionNav.links.length > 0 && (
        <nav aria-label={subRegionNav.title} className={styles.regionNav}>
          <h2 className={styles.regionNavTitle}>{subRegionNav.title}</h2>
          <ul className={styles.regionNavList}>
            {subRegionNav.links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className={styles.regionNavLink}>
                  {l.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <ReportActions title={title} envelope={envelope} />
    </div>
  );
}
