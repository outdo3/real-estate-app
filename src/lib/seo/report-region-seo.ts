// REGIONAL_SEO_KEYWORD_LANDING_V1 §6/§8/§12/§13 — 부산 지역 한장 브리핑(/report/city|district|dong)을
// 지역 SEO 템플릿에 연결하는 어댑터(순수 모듈).
//
// 지역 식별은 새로 만들지 않는다 — REPORT-1의 단일 지점(region-scope: 검증된 16개 lawdCd)과
// 리포트 경로 단일 정의(report-links)를 그대로 쓴다. 이 파일은 "무엇을 제목/색인/경로로
// 내보낼지"만 정한다.

import { BUSAN_DISTRICTS, districtName, isBusanCurrentLawdCd, normalizeDong } from '@/lib/report/region-scope';
import { cityReportHref, districtReportHref, dongReportHref } from '@/lib/report/report-links';
import {
  buildRegionSeoMetadata,
  decideRegionRobots,
  DONG_INDEX_MIN_TRADES_1Y,
  type RegionAvailableData,
  type RegionSeoLevel,
  type RobotsDecision,
} from './region-seo';
import { BRAND_NAME, TITLE_BRAND_SUFFIX, type BreadcrumbItem } from './site-seo';

/** 부산 리포트의 시도명. 리포트 스코프 자체가 부산 전용이다(region-scope 헤더 참고). */
export const REPORT_REGION_SIDO = '부산광역시';

/**
 * 지역 한장 브리핑이 렌더하는 섹션(RegionReportSheet / buildRegionReport 기준).
 * 매매 실거래만 있다 — 전세·월세는 없으므로 설명에 넣지 않는다.
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

const HOME_CRUMB: BreadcrumbItem = { name: BRAND_NAME, path: '/' };
const CITY_CRUMB: BreadcrumbItem = { name: '부산', path: cityReportHref() };

export function cityReportSeo(): ReportRegionSeo {
  const meta = buildRegionSeoMetadata({
    level: 'CITY',
    region: { sido: REPORT_REGION_SIDO },
    availableData: REPORT_AVAILABLE_DATA.CITY,
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

export function districtReportSeo(lawdCd: string): ReportRegionSeo {
  if (!isBusanCurrentLawdCd(lawdCd)) return invalid();
  const name = districtName(lawdCd);
  const path = districtReportHref(lawdCd);
  const meta = name
    ? buildRegionSeoMetadata({
        level: 'DISTRICT',
        region: { sido: REPORT_REGION_SIDO, district: name },
        availableData: REPORT_AVAILABLE_DATA.DISTRICT,
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
export function dongReportSeo(lawdCd: string, rawDong: string, trailingYearTrades: number | null): ReportRegionSeo {
  if (!isBusanCurrentLawdCd(lawdCd)) return invalid();
  const dong = normalizeDong(rawDong);
  const district = districtName(lawdCd);
  if (!dong || !district) return invalid();
  if (trailingYearTrades == null || trailingYearTrades < 1) return invalid();
  const meta = buildRegionSeoMetadata({
    level: 'DONG',
    region: { sido: REPORT_REGION_SIDO, district, dong },
    availableData: REPORT_AVAILABLE_DATA.DONG,
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
