// REGIONAL_SEO_KEYWORD_LANDING_V1 §6/§8/§12/§13 — 부산 지역 한장 브리핑(/report/city|district|dong)을
// 지역 SEO 템플릿에 연결하는 어댑터(순수 모듈).
//
// 지역 식별은 새로 만들지 않는다 — REPORT-1의 단일 지점(region-scope: 검증된 16개 lawdCd)과
// 리포트 경로 단일 정의(report-links)를 그대로 쓴다. 이 파일은 "무엇을 제목/색인/경로로
// 내보낼지"만 정한다.

import { BUSAN_DISTRICTS, districtName, isBusanCurrentLawdCd, normalizeDong } from '@/lib/report/region-scope';
import { cityReportHref, districtReportHref, dongReportHref } from '@/lib/report/report-links';
import type { ReportEnvelope } from '@/lib/report/types';
import {
  buildRegionSeoMetadata,
  decideRegionRobots,
  DONG_INDEX_MIN_TRADES_1Y,
  NO_REGION_DATA,
  type RegionAvailableData,
  type RegionSeoLevel,
  type RobotsDecision,
} from './region-seo';
import { BRAND_NAME, TITLE_BRAND_SUFFIX, type BreadcrumbItem } from './site-seo';

/** 부산 리포트의 시도명. 리포트 스코프 자체가 부산 전용이다(region-scope 헤더 참고). */
export const REPORT_REGION_SIDO = '부산광역시';

/**
 * 지역 한장 브리핑이 **구조상** 렌더할 수 있는 섹션의 상한(RegionReportSheet / buildRegionReport 기준).
 * 매매 실거래만 있다 — 전세·월세는 없으므로 설명에 넣지 않는다.
 *
 * REGIONAL_SEO_DATA_AWARE_DESCRIPTION_PATCH_V1 — 설명은 이 상한을 그대로 쓰지 않는다.
 * `regionAvailableDataFromEnvelope`가 이 상한과 **실제 envelope 값**을 함께 만족하는 섹션만 남긴다.
 */
export const REPORT_AVAILABLE_DATA: Record<RegionSeoLevel, RegionAvailableData> = {
  CITY: {
    recentTrades: true,
    medianPrice: true,
    tradeCount: true,
    tradeCountDelta: true,
    topComplexes: true,
    subRegionDistribution: 'DISTRICT',
    twoYearHigh: true,
  },
  DISTRICT: {
    recentTrades: true,
    medianPrice: true,
    tradeCount: true,
    tradeCountDelta: true,
    topComplexes: true,
    subRegionDistribution: 'DONG',
    twoYearHigh: true,
  },
  // 동 KPI에는 증감률 카드가 없다(KPI_KEYS_BY_TYPE.REGION_DONG) — "거래건수"로 적는다.
  DONG: {
    recentTrades: true,
    medianPrice: true,
    tradeCount: true,
    tradeCountDelta: false,
    topComplexes: true,
    subRegionDistribution: null,
    twoYearHigh: true,
  },
};

export interface ReportRegionSeo {
  title: string;
  description: string;
  /** 페이지 H1. 식별 실패면 null(시트는 기존 제목을 쓴다). */
  heading: string | null;
  /** self canonical — 쿼리(?period=)를 싣지 않는 깨끗한 경로. 식별 실패면 null. */
  canonicalPath: string | null;
  robots: RobotsDecision;
  breadcrumbs: BreadcrumbItem[];
}

const INVALID_TITLE = `지역 리포트${TITLE_BRAND_SUFFIX}`;
const INVALID_DESCRIPTION = `${BRAND_NAME} 지역 리포트`;

function invalid(): ReportRegionSeo {
  return {
    title: INVALID_TITLE,
    description: INVALID_DESCRIPTION,
    heading: null,
    canonicalPath: null,
    robots: { index: false, follow: true },
    breadcrumbs: [],
  };
}

/**
 * 페이지가 실제로 보여줄 값이 있는 섹션 = 구조상 상한 ∩ envelope 값.
 * 새 DB 조회 없이 페이지가 이미 읽는 리포트 envelope만 본다. 판정은 RegionReportSheet의 렌더 조건과 같다
 * (섹션 행이 1개 이상, 지표 값이 null이 아님, 하이라이트 존재).
 */
export function regionAvailableDataFromEnvelope(level: RegionSeoLevel, envelope: ReportEnvelope | null): RegionAvailableData {
  if (!envelope) return NO_REGION_DATA;
  const cap = REPORT_AVAILABLE_DATA[level];
  const metric = (key: string) => envelope.metrics.find((m) => m.key === key) ?? null;
  const rows = (key: string) => envelope.sections.find((sec) => sec.key === key)?.rows.length ?? 0;
  const count = Number(metric('transactionCount')?.value ?? 0);
  const distribution = envelope.sections.find((sec) => sec.kind === 'DISTRIBUTION');
  return {
    recentTrades: cap.recentTrades && rows('recentTrades') > 0,
    medianPrice: cap.medianPrice && metric('medianDealAmount')?.value != null,
    tradeCount: cap.tradeCount && Number.isFinite(count) && count > 0,
    // 증감률은 계산됐을 때만(비교 불가 = value null) 약속한다.
    tradeCountDelta: cap.tradeCountDelta && metric('transactionCountDelta')?.value != null,
    topComplexes: cap.topComplexes && rows('representativeComplexes') > 0,
    subRegionDistribution: cap.subRegionDistribution && distribution && distribution.rows.length > 0 ? cap.subRegionDistribution : null,
    twoYearHigh: cap.twoYearHigh && envelope.highlights.length > 0,
  };
}

const HOME_CRUMB: BreadcrumbItem = { name: BRAND_NAME, path: '/' };
const CITY_CRUMB: BreadcrumbItem = { name: '부산', path: cityReportHref() };

/**
 * `data`는 페이지가 실제로 보여줄 값(regionAvailableDataFromEnvelope). 모르면 null → 일반 설명(과장하지 않음).
 * title·canonical·robots·breadcrumbs는 data와 무관하다(이번 패치는 설명만 바꾼다).
 */
export function cityReportSeo(data: RegionAvailableData | null = null): ReportRegionSeo {
  const meta = buildRegionSeoMetadata({
    level: 'CITY',
    region: { sido: REPORT_REGION_SIDO },
    availableData: data ?? NO_REGION_DATA,
  });
  if (!meta) return invalid();
  return {
    title: meta.title,
    description: meta.description,
    heading: meta.heading,
    canonicalPath: cityReportHref(),
    robots: decideRegionRobots({ level: 'CITY', verified: true }),
    breadcrumbs: [HOME_CRUMB, CITY_CRUMB],
  };
}

export function districtReportSeo(lawdCd: string, data: RegionAvailableData | null = null): ReportRegionSeo {
  if (!isBusanCurrentLawdCd(lawdCd)) return invalid();
  const name = districtName(lawdCd);
  const path = districtReportHref(lawdCd);
  const meta = name
    ? buildRegionSeoMetadata({
        level: 'DISTRICT',
        region: { sido: REPORT_REGION_SIDO, district: name },
        availableData: data ?? NO_REGION_DATA,
      })
    : null;
  if (!meta || !path || !name) return invalid();
  return {
    title: meta.title,
    description: meta.description,
    heading: meta.heading,
    canonicalPath: path,
    robots: decideRegionRobots({ level: 'DISTRICT', verified: true }),
    breadcrumbs: [HOME_CRUMB, CITY_CRUMB, { name, path }],
  };
}

/**
 * 동 — URL의 동 이름은 **실제 거래 데이터에서 확인됐을 때만** 제목에 쓴다.
 *
 * `trailingYearTrades`
 *   - null: 조회 실패/미확인 → 이름을 쓰지 않고 noindex(없는 동에 가짜 랜딩을 만들지 않는다)
 *   - 0: 최근 1년 거래에 없는 동 → 동일
 *   - 1..9: 실제 동이지만 표본이 얇다 → 이름은 쓰되 noindex
 *   - ≥10: 색인
 */
export function dongReportSeo(
  lawdCd: string,
  rawDong: string,
  trailingYearTrades: number | null,
  data: RegionAvailableData | null = null
): ReportRegionSeo {
  if (!isBusanCurrentLawdCd(lawdCd)) return invalid();
  const dong = normalizeDong(rawDong);
  const district = districtName(lawdCd);
  if (!dong || !district) return invalid();
  if (trailingYearTrades == null || trailingYearTrades < 1) return invalid();
  const meta = buildRegionSeoMetadata({
    level: 'DONG',
    region: { sido: REPORT_REGION_SIDO, district, dong },
    availableData: data ?? NO_REGION_DATA,
  });
  const path = dongReportHref(lawdCd, dong);
  const districtPath = districtReportHref(lawdCd);
  if (!meta || !path || !districtPath) return invalid();
  return {
    title: meta.title,
    description: meta.description,
    heading: meta.heading,
    canonicalPath: path,
    robots: decideRegionRobots({ level: 'DONG', verified: true, trailingYearTrades }),
    breadcrumbs: [HOME_CRUMB, CITY_CRUMB, { name: district, path: districtPath }, { name: dong, path }],
  };
}

/** 사이트맵/동 목록 입력 — (lawdCd, dong)별 최근 1년 거래 수. */
export interface DongTradeCount {
  lawdCd: string;
  dong: string;
  count: number;
}

/** §15 — 색인 가능한 동만 남기고 결정론적으로 정렬한다(lawdCd → 동 이름). */
export function indexableDongs(rows: readonly DongTradeCount[]): DongTradeCount[] {
  const seen = new Set<string>();
  const out: DongTradeCount[] = [];
  for (const r of rows) {
    const dong = normalizeDong(r.dong);
    if (!dong || !isBusanCurrentLawdCd(r.lawdCd) || r.count < DONG_INDEX_MIN_TRADES_1Y) continue;
    const key = `${r.lawdCd}|${dong}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ lawdCd: r.lawdCd, dong, count: r.count });
  }
  return out.sort((a, b) => (a.lawdCd === b.lawdCd ? a.dong.localeCompare(b.dong, 'ko') : a.lawdCd < b.lawdCd ? -1 : 1));
}

/** §12 — 부산 전체 브리핑에서 내려가는 구·군 링크(검증된 16개 그대로). */
export function districtNavLinks(): { name: string; href: string }[] {
  return BUSAN_DISTRICTS.map((d) => ({ name: d.name, href: districtReportHref(d.lawdCd) })).filter(
    (l): l is { name: string; href: string } => !!l.href
  );
}

/** §12 — 구 브리핑에서 내려가는 동 링크. 색인 대상 동만 싣는다(얇은 페이지로 링크를 몰지 않는다). */
export function dongNavLinks(lawdCd: string, rows: readonly DongTradeCount[]): { name: string; href: string }[] {
  return indexableDongs(rows)
    .filter((r) => r.lawdCd === lawdCd)
    .map((r) => ({ name: r.dong, href: dongReportHref(r.lawdCd, r.dong) }))
    .filter((l): l is { name: string; href: string } => !!l.href);
}
