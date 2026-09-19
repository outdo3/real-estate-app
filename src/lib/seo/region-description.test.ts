import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildRegionReport, type RegionLevel, type RegionReportInput } from '../report/region-report';
import type { TradeRow } from '../report/region-aggregate';
import {
  NO_REGION_DATA,
  buildRegionSeoMetadata,
  regionDescriptionKind,
} from './region-seo';
import {
  REPORT_AVAILABLE_DATA,
  cityReportSeo,
  districtReportSeo,
  dongReportSeo,
  regionAvailableDataFromEnvelope,
} from './report-region-seo';
import { buildDongRoutes, buildLaunchRegionRoutes } from '../sitemap-scope';

/**
 * REGIONAL_SEO_DATA_AWARE_DESCRIPTION_PATCH_V1 — meta description은 페이지가 **실제로 값을 보여주는** 섹션만 약속한다.
 *
 * Production 실측: 색인 동 116개 중 11개(대청동1가·보수동2가·남부민동·동대신동2가·동대신동3가·충무동1가·토성동1가·
 * 봉래동1가·봉래동2가·봉래동3가·금사동)는 기본 기간(최근 30일) 거래가 0건이라 화면에 0건·"정보 없음"과 최근 2년 최고가만
 * 있었는데, 설명은 "최근 실거래, 중앙 거래가·㎡당 가격, 거래건수, 거래가 많은 단지"를 약속했다.
 *
 * envelope은 실제 리포트 조립 함수(buildRegionReport, 순수)로 만든다 — 테스트용 가짜 구조를 따로 만들지 않는다.
 */

const ROOT = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const PERIOD = { start: '2026-08-15', end: '2026-09-13', label: '최근 30일' };

function trade(over: Partial<TradeRow> = {}): TradeRow {
  return {
    aptSeq: '26140-1361',
    lawdCd: '26140',
    dong: '암남동',
    aptName: '테스트단지',
    exclusiveArea: 84.9,
    dealAmount: 54720,
    dealDate: '2026-09-09',
    dealCanceled: false,
    floor: 10,
    ...over,
  };
}

function envelopeFor(level: RegionLevel, over: Partial<RegionReportInput>) {
  const base: RegionReportInput = {
    level,
    lawdCd: level === 'CITY' ? null : '26140',
    dong: level === 'DONG' ? '암남동' : null,
    rows: [],
    previousCount: 0,
    trailingYearCount: 0,
    twoYearRows: [],
    masters: [],
    period: PERIOD,
    generatedAt: '2026-09-14T00:00:00.000Z',
    dataAsOf: null,
    coverageComplete: false,
  };
  return buildRegionReport({ ...base, ...over });
}

/** 최근 30일에 거래가 충분한 동(암남동 같은 정상 데이터). */
const RICH_DONG = envelopeFor('DONG', {
  rows: Array.from({ length: 25 }, (_, i) => trade({ dealAmount: 40000 + i * 100, dealDate: `2026-09-${String((i % 9) + 1).padStart(2, '0')}` })),
  previousCount: 23,
  trailingYearCount: 180,
  twoYearRows: [trade({ dealAmount: 152000, exclusiveArea: 138.867, dealDate: '2025-04-10' })],
});

/** 최근 30일 0건이지만 1년 표본·2년 최고가가 있는 동(남부민동 같은 Production 사례). */
const ZERO_30D_DONG = envelopeFor('DONG', {
  lawdCd: '26140',
  dong: '남부민동',
  rows: [],
  previousCount: 2,
  trailingYearCount: 14,
  twoYearRows: [trade({ dong: '남부민동', dealAmount: 38000, exclusiveArea: 79.4032, dealDate: '2026-04-24' })],
});

/** 보여줄 거래 값이 전혀 없는 상태. */
const SPARSE_DONG = envelopeFor('DONG', { rows: [], twoYearRows: [], trailingYearCount: 0 });

const FAKE_RECENT = /최근 실거래|중앙 거래가|㎡당 가격|거래가 많은 단지|거래건수|거래량 변화|시세를/;

// ── 1. 데이터가 충분하면 rich 설명 유지 ────────────────────────────────────

test('1 rich-data 동: 기존 풍부한 설명 그대로(약해지지 않음)', () => {
  const data = regionAvailableDataFromEnvelope('DONG', RICH_DONG);
  assert.deepEqual(data, REPORT_AVAILABLE_DATA.DONG, '정상 데이터 동인데 섹션이 빠졌다');
  assert.equal(regionDescriptionKind(data), 'RICH');
  const seo = dongReportSeo('26140', '암남동', 180, data);
  assert.equal(
    seo.description,
    '부산 서구 암남동 아파트 매매 시세를 국토교통부 실거래가로 확인하세요. 최근 실거래, 중앙 거래가·㎡당 가격, 거래건수, 거래가 많은 단지, 최근 2년 최고 거래가를 한 장에 정리했습니다.'
  );
});

test('1 rich-data 구·부산 전체: 거래량 변화·분포까지 그대로', () => {
  const district = envelopeFor('DISTRICT', {
    rows: Array.from({ length: 58 }, (_, i) => trade({ dong: i % 2 ? '암남동' : '서대신동3가', dealAmount: 30000 + i * 50 })),
    previousCount: 68,
    trailingYearCount: 700,
    twoYearRows: [trade({ dealAmount: 152000 })],
  });
  const d = districtReportSeo('26140', regionAvailableDataFromEnvelope('DISTRICT', district));
  assert.equal(
    d.description,
    '부산 서구 아파트 매매 시세를 국토교통부 실거래가로 확인하세요. 최근 실거래, 중앙 거래가·㎡당 가격, 거래량 변화, 거래가 많은 단지, 동별 거래 분포, 최근 2년 최고 거래가를 한 장에 정리했습니다.'
  );
  const city = envelopeFor('CITY', {
    rows: Array.from({ length: 40 }, (_, i) => trade({ lawdCd: i % 2 ? '26140' : '26380', dealAmount: 30000 + i })),
    previousCount: 50,
    trailingYearCount: 20000,
    twoYearRows: [trade({ dealAmount: 570000 })],
  });
  assert.ok(cityReportSeo(regionAvailableDataFromEnvelope('CITY', city)).description.includes('구·군별 거래 분포'));
});

// ── 2. 최근 30일 0건 + 과거 기록 ───────────────────────────────────────────

test('2 zero-30d 동: 최근·시세·가격지표 약속을 빼고 실제 있는 최근 2년 최고 거래가만', () => {
  const data = regionAvailableDataFromEnvelope('DONG', ZERO_30D_DONG);
  assert.deepEqual(data, { ...NO_REGION_DATA, twoYearHigh: true });
  assert.equal(regionDescriptionKind(data), 'HISTORICAL');
  const seo = dongReportSeo('26140', '남부민동', 14, data);
  assert.equal(
    seo.description,
    '부산 서구 남부민동 아파트 매매 실거래 기록을 국토교통부 실거래가로 확인하세요. 최근 2년 최고 거래가를 한 장에 정리했습니다.'
  );
  assert.ok(!FAKE_RECENT.test(seo.description), `없는 섹션을 약속한다: ${seo.description}`);
});

test('2 Production 11개 zero-30d 동 전부 — index·canonical·title 유지, 설명은 사실만', () => {
  const cases: Array<[string, string]> = [
    ['26110', '대청동1가'], ['26110', '보수동2가'], ['26140', '남부민동'], ['26140', '동대신동2가'], ['26140', '동대신동3가'],
    ['26140', '충무동1가'], ['26140', '토성동1가'], ['26200', '봉래동1가'], ['26200', '봉래동2가'], ['26200', '봉래동3가'], ['26410', '금사동'],
  ];
  for (const [lawdCd, dong] of cases) {
    const env = envelopeFor('DONG', {
      lawdCd,
      dong,
      rows: [],
      trailingYearCount: 12,
      twoYearRows: [trade({ lawdCd, dong, dealAmount: 30000 })],
    });
    const data = regionAvailableDataFromEnvelope('DONG', env);
    const before = dongReportSeo(lawdCd, dong, 12, REPORT_AVAILABLE_DATA.DONG);
    const after = dongReportSeo(lawdCd, dong, 12, data);
    assert.equal(after.robots.index, true, `${dong}: 색인 기준이 바뀌었다`);
    assert.equal(after.canonicalPath, before.canonicalPath, `${dong}: canonical이 바뀌었다`);
    assert.equal(after.title, before.title, `${dong}: title이 바뀌었다`);
    assert.equal(after.heading, before.heading);
    assert.ok(after.description.includes(dong));
    assert.ok(!FAKE_RECENT.test(after.description), `${dong}: ${after.description}`);
  }
});

// ── 3. 데이터 매우 부족 ────────────────────────────────────────────────────

test('3 sparse: 보여줄 값이 없으면 일반·사실 문구(섹션 나열 없음)', () => {
  const data = regionAvailableDataFromEnvelope('DONG', SPARSE_DONG);
  assert.deepEqual(data, NO_REGION_DATA);
  assert.equal(regionDescriptionKind(data), 'SPARSE');
  const seo = dongReportSeo('26140', '암남동', 12, data);
  assert.equal(seo.description, '부산 서구 암남동 아파트 매매 실거래 정보를 이집에서 확인하세요.');
  // envelope 조회 실패(null)도 과장하지 않는다.
  assert.deepEqual(regionAvailableDataFromEnvelope('DONG', null), NO_REGION_DATA);
  assert.equal(dongReportSeo('26140', '암남동', 12, null).description, '부산 서구 암남동 아파트 매매 실거래 정보를 이집에서 확인하세요.');
});

test('구조상 없는 섹션은 값이 있어도 약속하지 않는다(동 KPI에는 증감률 카드 없음)', () => {
  const data = regionAvailableDataFromEnvelope('DONG', RICH_DONG);
  assert.equal(RICH_DONG.metrics.find((m) => m.key === 'transactionCountDelta')!.value != null, true, '픽스처 전제');
  assert.equal(data.tradeCountDelta, false);
  assert.equal(data.subRegionDistribution, null);
});

test('증감률이 계산되지 않은 구(비교 불가)는 "거래량 변화"를 약속하지 않는다', () => {
  const env = envelopeFor('DISTRICT', { rows: [trade(), trade({ dealAmount: 41000 })], previousCount: 0, trailingYearCount: 30 });
  const data = regionAvailableDataFromEnvelope('DISTRICT', env);
  assert.equal(data.tradeCountDelta, false);
  assert.ok(districtReportSeo('26140', data).description.includes('거래건수'));
  assert.ok(!districtReportSeo('26140', data).description.includes('거래량 변화'));
});

// ── 4~6. 색인·canonical·사이트맵 불변 ──────────────────────────────────────

test('4·5 index/canonical/title/breadcrumbs는 데이터 가용성과 무관하다', () => {
  for (const data of [REPORT_AVAILABLE_DATA.DONG, { ...NO_REGION_DATA, twoYearHigh: true }, NO_REGION_DATA, null]) {
    const s = dongReportSeo('26140', '암남동', 25, data);
    assert.deepEqual(s.robots, { index: true, follow: true });
    assert.equal(s.canonicalPath, `/report/dong/26140/${encodeURIComponent('암남동')}`);
    assert.equal(s.title, '부산 서구 암남동 아파트 시세·실거래가 | 이집');
    assert.deepEqual(s.breadcrumbs.map((b) => b.name), ['이집', '부산', '서구', '암남동']);
  }
  // 표본 기준(1년 10건)은 그대로 — 30일 0건이어도 1년 표본이 있으면 index.
  assert.equal(dongReportSeo('26140', '남부민동', 14, { ...NO_REGION_DATA, twoYearHigh: true }).robots.index, true);
  assert.equal(dongReportSeo('26140', '아미동2가', 9, REPORT_AVAILABLE_DATA.DONG).robots.index, false);
  for (const data of [REPORT_AVAILABLE_DATA.DISTRICT, NO_REGION_DATA]) {
    const d = districtReportSeo('26380', data);
    assert.equal(d.title, '부산 사하구 아파트 시세·실거래가·거래량 | 이집');
    assert.equal(d.canonicalPath, '/report/district/26380');
    assert.equal(d.robots.index, true);
  }
});

test('6 사이트맵은 설명 패치와 무관하다 — 경로 수·판정 그대로', () => {
  assert.equal(buildLaunchRegionRoutes().length, 17);
  const rows = [
    { lawdCd: '26140', dong: '남부민동', count: 14 },
    { lawdCd: '26140', dong: '아미동2가', count: 6 },
    { lawdCd: '26380', dong: '괴정동', count: 80 },
  ];
  assert.deepEqual(buildDongRoutes(rows).map((r) => decodeURIComponent(r.path)), ['/report/dong/26140/남부민동', '/report/dong/26380/괴정동']);
  const sitemap = codeOf(read('src/app/sitemap.ts'));
  assert.ok(!/regionAvailableDataFromEnvelope|readRegionReport/.test(sitemap), '사이트맵이 리포트 envelope에 의존하게 됐다');
});

// ── 7. 가짜 최근 약속 없음 ─────────────────────────────────────────────────

test('7 기간 거래 0건 envelope에서는 어떤 단계든 최근·시세·가격지표를 약속하지 않는다', () => {
  for (const level of ['CITY', 'DISTRICT', 'DONG'] as const) {
    const env = envelopeFor(level, { rows: [], trailingYearCount: 50, twoYearRows: [trade({ dealAmount: 90000 })] });
    const data = regionAvailableDataFromEnvelope(level, env);
    const seo = level === 'CITY' ? cityReportSeo(data) : level === 'DISTRICT' ? districtReportSeo('26140', data) : dongReportSeo('26140', '암남동', 50, data);
    assert.ok(!FAKE_RECENT.test(seo.description), `${level}: ${seo.description}`);
    assert.ok(seo.description.includes('최근 2년 최고 거래가'));
  }
});

test('7 페이지 배선: 설명은 기본 기간 envelope에서, page와 같은 캐시 조회를 공유한다', () => {
  for (const [p, level] of [
    ['src/app/report/city/busan/page.tsx', 'CITY'],
    ['src/app/report/district/[lawdCd]/page.tsx', 'DISTRICT'],
    ['src/app/report/dong/[lawdCd]/[dong]/page.tsx', 'DONG'],
  ] as const) {
    const code = codeOf(read(p));
    const meta = code.slice(code.indexOf('export async function generateMetadata'), code.indexOf('export default'));
    // STATS_PERIOD_IMAGE_PARITY_V2 — 기간 인자가 일수에서 기간 키로 바뀌었다(기본 = '30', 의미 동일).
    assert.ok(new RegExp(`readRegionReportForPeriod\\('${level}'[^)]*DEFAULT_REPORT_PERIOD_KEY\\)`).test(meta), `${p}: 기본 기간 envelope을 읽지 않는다`);
    assert.ok(new RegExp(`regionAvailableDataFromEnvelope\\('${level}', envelope\\)`).test(meta), `${p}: 설명이 envelope 값을 보지 않는다`);
    assert.ok(/\.catch\(\(\) => null\)/.test(meta), `${p}: 조회 실패 시 일반 설명으로 떨어지지 않는다`);
    assert.ok(!/searchParams/.test(meta), `${p}: 메타데이터가 ?period=에 따라 달라진다`);
    const page = code.slice(code.indexOf('export default'));
    assert.ok(/readRegionReportForPeriod\(/.test(page), `${p}: page가 같은 캐시 조회를 쓰지 않는다`);
    assert.ok(!/readRegionReport\(\{/.test(code), `${p}: 캐시를 거치지 않는 직접 조회가 남아 있다`);
  }
  const cached = codeOf(read('src/lib/report/region-read-cached.ts'));
  assert.ok(/from 'react'/.test(cached) && /cache\(/.test(cached), 'React cache로 감싸지 않았다');
  assert.ok(/resolveReportPeriod\(periodKey\)/.test(cached));
});

// ── 8~9. 서울·경기 재사용 ─────────────────────────────────────────────────

test('8 서울 — 같은 가용성 규칙으로 rich/historical/sparse 설명', () => {
  const region = { sido: '서울특별시', district: '강남구', dong: '대치동' };
  const rich = buildRegionSeoMetadata({ level: 'DONG', region, availableData: REPORT_AVAILABLE_DATA.DONG })!;
  assert.ok(rich.description.startsWith('서울 강남구 대치동 아파트 매매 시세를'));
  const hist = buildRegionSeoMetadata({ level: 'DONG', region, availableData: { ...NO_REGION_DATA, twoYearHigh: true } })!;
  assert.equal(hist.description, '서울 강남구 대치동 아파트 매매 실거래 기록을 국토교통부 실거래가로 확인하세요. 최근 2년 최고 거래가를 한 장에 정리했습니다.');
  const sparse = buildRegionSeoMetadata({ level: 'DISTRICT', region: { sido: '서울특별시', district: '송파구' }, availableData: NO_REGION_DATA })!;
  assert.equal(sparse.description, '서울 송파구 아파트 매매 실거래 정보를 이집에서 확인하세요.');
});

test('9 경기 — 시+구 2단계 이름에도 같은 규칙', () => {
  const region = { sido: '경기도', city: '성남시', district: '분당구' };
  const rich = buildRegionSeoMetadata({ level: 'DISTRICT', region, availableData: REPORT_AVAILABLE_DATA.DISTRICT })!;
  assert.ok(rich.description.startsWith('경기 성남시 분당구 아파트 매매 시세를'));
  assert.ok(rich.description.includes('동별 거래 분포'));
  const hist = buildRegionSeoMetadata({ level: 'DISTRICT', region, availableData: { ...NO_REGION_DATA, twoYearHigh: true } })!;
  assert.ok(!FAKE_RECENT.test(hist.description), hist.description);
  // 가용성 규칙에 지역 문자열이 섞이지 않는다.
  const rules = codeOf(read('src/lib/seo/region-seo.ts'));
  assert.ok(!/부산|서울|경기/.test(rules.slice(rules.indexOf('export function regionDescriptionKind'))), '설명 규칙에 지역 하드코딩이 있다');
});

test('조사: 마지막 항목 받침에 따라 을/를', () => {
  const onlyPrice = { ...NO_REGION_DATA, medianPrice: true };
  const d = buildRegionSeoMetadata({ level: 'DONG', region: { sido: '부산광역시', district: '서구', dong: '암남동' }, availableData: onlyPrice })!;
  assert.ok(d.description.endsWith('중앙 거래가·㎡당 가격을 한 장에 정리했습니다.'), d.description);
});
