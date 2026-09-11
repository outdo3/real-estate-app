import { test } from 'node:test';
import assert from 'node:assert/strict';
import { areaMatchesSelection } from './unit-area-match';
import { buildUnitTrendSeries, type PriceTrendTrade } from './price-trend-data';
import { findNearestSchool } from './report/nearest-school';

/**
 * APT_DETAIL_DEFAULT_ALL_TRUST_FIX_V1 §4 — 신뢰 회귀 테스트.
 *
 * 사용자가 보고한 실제 버그: 상세 진입 시 84㎡가 자동 선택되고, 헤더는 "최근 실거래가"
 * 인데 값은 84㎡의 최신 거래였다. 다른 평형에 더 최근 거래가 있어도 가려졌다.
 */

interface DetailTrade {
  area: string;
  tradeDate: string;
  price: number;
  priceStr: string;
}

/**
 * apt-client의 Hero 파이프라인을 그대로 축약한 것.
 *
 * 실제 화면은 (1) API가 tradeDate 내림차순으로 정렬해 주고
 * (2) selectedTradeArea가 '전체'면 areaMatchesSelection이 전부 통과시키며
 * (3) heroTrade = filteredTrades[0] 이다. 이 세 단계를 그대로 재현한다.
 */
function heroTradeFor(trades: DetailTrade[], selectedArea: string): DetailTrade | null {
  const sorted = [...trades].sort((a, b) => b.tradeDate.localeCompare(a.tradeDate));
  const filtered = sorted.filter((t) => areaMatchesSelection(t.area, selectedArea));
  return filtered.length > 0 ? filtered[0] : null;
}

// §4에 명시된 회귀 케이스.
const TRUST_CASE: DetailTrade[] = [
  { area: '84.9500m²', tradeDate: '2026-08-21', price: 3.87, priceStr: '3억 8,700만' },
  { area: '129.7178m²', tradeDate: '2026-09-05', price: 6.65, priceStr: '6억 6,500만' },
];

// ── §1/§2 기본 상태 = 전체, 값 = 전 평형 최신 ───────────────────────────────

test('첫 진입(전체)에서 최근 실거래가는 모든 평형을 통틀어 가장 최근 거래다', () => {
  const hero = heroTradeFor(TRUST_CASE, '전체');
  assert.ok(hero);
  assert.equal(hero.priceStr, '6억 6,500만');
  assert.equal(hero.tradeDate, '2026-09-05');
  assert.equal(hero.area, '129.7178m²', '그 거래의 실제 평형을 그대로 보여줘야 한다');
});

test('84㎡가 더 흔한 평형이라는 이유로 이전 거래가 대표값이 되면 안 된다', () => {
  const hero = heroTradeFor(TRUST_CASE, '전체');
  assert.notEqual(hero?.priceStr, '3억 8,700만', '이것이 사용자가 보고한 버그다');
  assert.notEqual(hero?.tradeDate, '2026-08-21');
});

test('84㎡ 거래가 여러 건이어도 전체 최신이 우선한다', () => {
  const many: DetailTrade[] = [
    ...TRUST_CASE,
    { area: '84.9500m²', tradeDate: '2026-08-19', price: 3.8, priceStr: '3억 8,000만' },
    { area: '84.9500m²', tradeDate: '2026-07-11', price: 3.75, priceStr: '3억 7,500만' },
    { area: '59.9200m²', tradeDate: '2026-06-02', price: 2.9, priceStr: '2억 9,000만' },
  ];
  assert.equal(heroTradeFor(many, '전체')?.tradeDate, '2026-09-05');
});

// ── §3/§5 특정 평형 선택 ────────────────────────────────────────────────────

test('평형을 고르면 그 평형의 최신 거래만 보여준다', () => {
  const hero = heroTradeFor(TRUST_CASE, '84.9500');
  assert.ok(hero);
  assert.equal(hero.priceStr, '3억 8,700만');
  assert.equal(hero.area, '84.9500m²');
});

test('전체 → 평형 → 전체로 돌아오면 다시 전 평형 최신이다(상태가 남지 않는다)', () => {
  assert.equal(heroTradeFor(TRUST_CASE, '전체')?.tradeDate, '2026-09-05');
  assert.equal(heroTradeFor(TRUST_CASE, '84.9500')?.tradeDate, '2026-08-21');
  assert.equal(heroTradeFor(TRUST_CASE, '전체')?.tradeDate, '2026-09-05');
});

test('선택한 평형에 거래가 없으면 다른 평형 가격을 빌려오지 않는다', () => {
  assert.equal(heroTradeFor(TRUST_CASE, '59.9200'), null);
});

test('전용면적 표기 차이(m² 접미사)는 같은 평형으로 매칭된다', () => {
  assert.equal(heroTradeFor(TRUST_CASE, '129.7178')?.tradeDate, '2026-09-05');
});

// ── §6 전체 모드 차트: 면적을 절대 섞지 않는다 ──────────────────────────────

const CHART_TRADES: PriceTrendTrade[] = [
  { area: '84.9500m²', tradeDate: '2026-01-10', price: 3.7, priceStr: '3억 7,000만' },
  { area: '84.9500m²', tradeDate: '2026-08-21', price: 3.87, priceStr: '3억 8,700만' },
  { area: '129.7178m²', tradeDate: '2026-09-05', price: 6.65, priceStr: '6억 6,500만' },
  { area: '59.9200m²', tradeDate: '2026-06-02', price: 2.9, priceStr: '2억 9,000만' },
];

test('전체 모드 차트는 면적마다 독립된 시리즈를 만든다', () => {
  const { series, points, omittedCount } = buildUnitTrendSeries(CHART_TRADES);
  assert.equal(series.length, 3);
  assert.equal(omittedCount, 0);
  assert.ok(points.length > 0, '기본 상태에서 차트가 비면 안 된다(§6)');
  // 범례는 면적 오름차순
  assert.deepEqual(series.map((s) => parseFloat(s.area)), [59.92, 84.95, 129.7178]);
});

test('한 포인트는 정확히 하나의 면적에만 값을 갖는다(선이 섞이지 않는다)', () => {
  const { series, points } = buildUnitTrendSeries(CHART_TRADES);
  for (const point of points) {
    const filled = series.filter((s) => point[s.key] != null);
    assert.equal(filled.length, 1, '한 거래가 두 면적 시리즈에 동시에 들어가면 안 된다');
  }
});

test('표기만 다른 같은 면적은 한 시리즈로 묶고, 다른 면적은 절대 합치지 않는다', () => {
  const mixed: PriceTrendTrade[] = [
    { area: '84.7855m²', tradeDate: '2026-01-01', price: 3.5, priceStr: 'a' },
    { area: '84.7855', tradeDate: '2026-02-01', price: 3.6, priceStr: 'b' },
    { area: '84.9950m²', tradeDate: '2026-03-01', price: 3.7, priceStr: 'c' },
  ];
  const { series } = buildUnitTrendSeries(mixed);
  assert.equal(series.length, 2, '84.7855와 84.9950은 서로 다른 전용면적이다');
  const counts = series.map((s) => s.count).sort();
  assert.deepEqual(counts, [1, 2]);
});

test('가독성 상한은 결정적이며, 빠진 평형은 지어내지 않고 개수만 알린다', () => {
  const many: PriceTrendTrade[] = [];
  // 면적마다 건수를 다르게 줘서 "거래 많은 순" 선택이 결정적인지 본다.
  const spec: [string, number][] = [['59.1', 1], ['74.2', 2], ['84.3', 5], ['99.4', 4], ['109.5', 3], ['129.6', 6]];
  for (const [area, n] of spec) {
    for (let i = 0; i < n; i += 1) {
      many.push({ area: `${area}m²`, tradeDate: `2026-0${(i % 9) + 1}-01`, price: 1, priceStr: 'x' });
    }
  }
  const first = buildUnitTrendSeries(many, 5);
  assert.equal(first.series.length, 5);
  assert.equal(first.omittedCount, 1);
  // 건수가 가장 적은 59.1이 빠진다.
  assert.ok(!first.series.some((s) => parseFloat(s.area) === 59.1));
  // 같은 입력이면 같은 결과(결정적).
  const second = buildUnitTrendSeries(many, 5);
  assert.deepEqual(second.series, first.series);
});

test('거래가 없으면 빈 결과이고, 가짜 포인트를 만들지 않는다', () => {
  const empty = buildUnitTrendSeries([]);
  assert.deepEqual(empty.series, []);
  assert.deepEqual(empty.points, []);
  assert.equal(empty.omittedCount, 0);
});

// ── §7 리포트 초등학교 이름 ─────────────────────────────────────────────────

const SCHOOLS = [
  { schoolName: '대연초등학교', latitude: 35.1370, longitude: 129.0820 },
  { schoolName: '해운대초등학교', latitude: 35.1630, longitude: 129.1630 },
  { schoolName: '좌표없는초등학교', latitude: null, longitude: null },
];

test('가장 가까운 초등학교의 이름과 거리를 같은 출처에서 함께 얻는다', () => {
  const nearest = findNearestSchool(35.1366, 129.0814, SCHOOLS);
  assert.ok(nearest);
  assert.equal(nearest.name, '대연초등학교');
  assert.ok(nearest.distanceM >= 0 && nearest.distanceM < 1000);
});

test('아파트 좌표가 없으면 학교 이름을 추측하지 않는다', () => {
  assert.equal(findNearestSchool(null, null, SCHOOLS), null);
  assert.equal(findNearestSchool(35.1, undefined, SCHOOLS), null);
});

test('좌표 없는 학교는 후보에서 제외된다', () => {
  const onlyBroken = [{ schoolName: '좌표없는초등학교', latitude: null, longitude: null }];
  assert.equal(findNearestSchool(35.1366, 129.0814, onlyBroken), null, '이름만 있다고 쓰면 거리를 지어내게 된다');
});

test('후보가 없으면 null이다(이름 없는 거리를 대신 보여주지 않는다)', () => {
  assert.equal(findNearestSchool(35.1366, 129.0814, []), null);
});

test('같은 거리면 이름 오름차순으로 결정적으로 고른다', () => {
  const tie = [
    { schoolName: '나초등학교', latitude: 35.2, longitude: 129.2 },
    { schoolName: '가초등학교', latitude: 35.2, longitude: 129.2 },
  ];
  assert.equal(findNearestSchool(35.3, 129.2, tie)?.name, '가초등학교');
  assert.equal(findNearestSchool(35.3, 129.2, [...tie].reverse())?.name, '가초등학교');
});
