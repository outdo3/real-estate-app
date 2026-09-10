// APT DETAIL UNIT/TRADE FILTER BUG V1 — 회귀 테스트.
//
// fixture는 대신롯데캐슬(aptSeq 26140-1164)의 **실제 Production 값**이다.
// 다만 검증하는 규칙은 전부 일반 규칙이며 이 단지에 특화된 분기는 없다.
//
// 실측 배경:
//   Unit Master canonicalExclusiveArea : "84.7855" / "129.7178" (bare)
//   실거래 trade.area                  : "84.7855m²" / "129.7178m²" (suffix)
// 이 둘을 문자열 === 로 비교하던 것이 P0 버그의 원인이었다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_AREAS,
  AREA_MATCH_EPSILON,
  areaMatchesSelection,
  countTradesByArea,
  findUnitForArea,
  isAllAreas,
  parseAreaM2,
  selectTradesForArea,
} from './unit-area-match';
import { computeInvestmentMetrics } from './investment-metrics';
import { filterTradesForArea } from './price-trend-data';

interface T {
  area: string;
  tradeDate: string;
  price: number;
  priceStr: string;
  monthlyRent?: number;
  tradeType: string;
  dealCanceled?: boolean;
}

// 대신롯데캐슬 실제 전용면적 6종 + Unit Master에만 있는 33.2024(거래 0건).
const trades: T[] = [
  { area: '129.7178m²', tradeDate: '2026-09-05', price: 6.65, priceStr: '6억 6,500', tradeType: '아파트 매매' },
  { area: '59.8839m²', tradeDate: '2026-09-01', price: 3.4, priceStr: '3억 4,000', tradeType: '아파트 매매' },
  { area: '84.7855m²', tradeDate: '2026-08-21', price: 3.87, priceStr: '3억 8,700', tradeType: '아파트 매매' },
  { area: '102.7835m²', tradeDate: '2026-07-25', price: 5.25, priceStr: '5억 2,500', tradeType: '아파트 매매' },
  { area: '84.995m²', tradeDate: '2026-04-27', price: 4.3, priceStr: '4억 3,000', tradeType: '아파트 매매' },
  { area: '59.8826m²', tradeDate: '2026-01-20', price: 3.1, priceStr: '3억 1,000', tradeType: '아파트 매매' },
  { area: '84.7855m²', tradeDate: '2025-11-02', price: 3.75, priceStr: '3억 7,500', tradeType: '아파트 매매' },
];

const unitMaster = [
  { canonicalExclusiveArea: '33.2024', displayExclusiveArea: '33.2', representativePyeong: 14 },
  { canonicalExclusiveArea: '59.8826', displayExclusiveArea: '59.88', representativePyeong: 25 },
  { canonicalExclusiveArea: '59.8839', displayExclusiveArea: '59.88', representativePyeong: 25 },
  { canonicalExclusiveArea: '84.7855', displayExclusiveArea: '84.79', representativePyeong: 34 },
  { canonicalExclusiveArea: '84.995', displayExclusiveArea: '85', representativePyeong: 34 },
  { canonicalExclusiveArea: '102.7835', displayExclusiveArea: '102.78', representativePyeong: 40 },
  { canonicalExclusiveArea: '129.7178', displayExclusiveArea: '129.72', representativePyeong: 50 },
];

const latest = (rows: T[]) => (rows.length > 0 ? rows[0] : null);

test('suffix가 붙은 raw trade.area와 bare canonical이 매칭된다(버그의 핵심)', () => {
  assert.equal(areaMatchesSelection('84.7855m²', '84.7855'), true);
  assert.equal(areaMatchesSelection('129.7178m²', '129.7178'), true);
  // 같은 도메인끼리도 그대로 동작해야 한다(기존 raw 선택 경로 하위호환).
  assert.equal(areaMatchesSelection('84.7855m²', '84.7855m²'), true);
  assert.equal(parseAreaM2('84.7855m²'), 84.7855);
  assert.equal(parseAreaM2('84.7855'), 84.7855);
});

test('micro-variant는 절대 병합되지 않는다(결정론적 그룹핑)', () => {
  // 59.8826 vs 59.8839, 84.7855 vs 84.995 — 실존하는 서로 다른 전용면적.
  assert.equal(areaMatchesSelection('59.8826m²', '59.8839'), false);
  assert.equal(areaMatchesSelection('84.7855m²', '84.995'), false);
  // epsilon은 Decimal↔float 왕복 오차 흡수용일 뿐, 근접 병합용이 아니다.
  assert.ok(Math.abs(59.8839 - 59.8826) > AREA_MATCH_EPSILON);
});

test('평형 A 선택 → 그 평형의 최신 거래', () => {
  const rows = selectTradesForArea(trades, '129.7178');
  assert.equal(rows.length, 1);
  assert.equal(latest(rows)!.tradeDate, '2026-09-05');
  assert.equal(latest(rows)!.price, 6.65);
});

test('평형 B 선택 → 다른 데이터셋 / 다른 최신 거래', () => {
  const rows = selectTradesForArea(trades, '84.7855');
  assert.equal(rows.length, 2);
  assert.equal(latest(rows)!.tradeDate, '2026-08-21');
  assert.equal(latest(rows)!.price, 3.87);
});

test('A → B → A 전환이 매번 정확히 같은 결과로 돌아온다(stale 없음)', () => {
  const a1 = selectTradesForArea(trades, '129.7178');
  const b = selectTradesForArea(trades, '84.7855');
  const a2 = selectTradesForArea(trades, '129.7178');
  assert.deepEqual(a1, a2);
  assert.notDeepEqual(a1, b);
  assert.equal(a2.length, 1);
  assert.equal(latest(a2)!.price, 6.65);
});

test('기본 평형(84.79㎡) 행이 다른 평형 선택 후 남지 않는다', () => {
  const rows = selectTradesForArea(trades, '129.7178');
  assert.equal(rows.some((t) => t.area.startsWith('84.7855')), false);
});

test('타임라인 건수가 선택 평형에 따라 바뀐다', () => {
  assert.equal(selectTradesForArea(trades, '84.7855').length, 2);
  assert.equal(selectTradesForArea(trades, '129.7178').length, 1);
  assert.equal(selectTradesForArea(trades, '59.8826').length, 1);
});

test('거래가 없는 평형은 빈 결과 — 다른 평형으로 대체하지 않는다', () => {
  // 33.2024는 Unit Master에는 있으나 실거래가 0건이다(실측).
  const rows = selectTradesForArea(trades, '33.2024');
  assert.equal(rows.length, 0);
  assert.equal(latest(rows), null); // 84㎡나 전체 최신으로 fallback하지 않는다
});

test('전체 평형은 모든 거래를 그대로 준다', () => {
  assert.equal(selectTradesForArea(trades, ALL_AREAS).length, trades.length);
  assert.equal(selectTradesForArea(trades, undefined).length, trades.length);
  assert.equal(isAllAreas(ALL_AREAS), true);
  assert.equal(isAllAreas(''), true);
  assert.equal(isAllAreas('84.7855'), false);
});

test('해석 불가능한 면적은 매칭하지 않는다(모르는 값을 일치로 처리하지 않음)', () => {
  assert.equal(areaMatchesSelection('', '84.7855'), false);
  assert.equal(areaMatchesSelection('abc', '84.7855'), false);
  assert.equal(areaMatchesSelection('84.7855m²', 'abc'), false);
  assert.equal(parseAreaM2('abc'), null);
  assert.equal(parseAreaM2(null), null);
});

test('취소 거래 의미론은 이 필터가 건드리지 않는다', () => {
  // 면적 필터는 dealCanceled를 읽지도 바꾸지도 않는다 — 취소 정책은 상위 계층 소관.
  const withCanceled: T[] = [
    { area: '84.7855m²', tradeDate: '2026-08-25', price: 9.9, priceStr: '9억 9,000', tradeType: '아파트 매매', dealCanceled: true },
    ...trades,
  ];
  const rows = selectTradesForArea(withCanceled, '84.7855');
  // 입력에 있던 취소 플래그가 그대로 보존된다(값을 바꾸거나 숨기지 않는다).
  assert.equal(rows.length, 3);
  assert.equal(rows[0].dealCanceled, true);
  const noneCanceled = selectTradesForArea(withCanceled.filter((t) => !t.dealCanceled), '84.7855');
  assert.equal(noneCanceled.length, 2);
});

test('Unit Master 라벨 조회가 suffix에도 동작한다', () => {
  assert.equal(findUnitForArea(unitMaster, '84.7855m²')?.representativePyeong, 34);
  assert.equal(findUnitForArea(unitMaster, '129.7178m²')?.representativePyeong, 50);
  assert.equal(findUnitForArea(unitMaster, '59.8839')?.canonicalExclusiveArea, '59.8839');
  assert.equal(findUnitForArea(unitMaster, '999')?.representativePyeong, undefined);
  assert.equal(findUnitForArea(null, '84.7855'), null);
});

test('칩 건수가 0으로 표시되지 않는다(칩 값이 canonical이어도)', () => {
  const counts = countTradesByArea(trades, unitMaster.map((u) => u.canonicalExclusiveArea));
  assert.equal(counts.get('84.7855'), 2);
  assert.equal(counts.get('129.7178'), 1);
  assert.equal(counts.get('59.8826'), 1);
  assert.equal(counts.get('33.2024'), 0); // 진짜 0건은 0으로
});

test('차트/지표/타임라인이 같은 계약을 공유한다(위젯 동기화)', () => {
  const selected = '129.7178';
  const timeline = selectTradesForArea(trades, selected);
  const chart = filterTradesForArea(
    trades.map((t) => ({ area: t.area, tradeDate: t.tradeDate, price: t.price, priceStr: t.priceStr })),
    selected
  );
  assert.equal(chart!.length, timeline.length);
  assert.equal(chart![0].price, timeline[0].price);

  // InvestmentMetrics도 같은 평형을 집계한다.
  const metrics = computeInvestmentMetrics(
    trades.map((t) => ({ area: t.area, tradeDate: t.tradeDate, price: t.price, priceStr: t.priceStr, monthlyRent: 0 })),
    [{ area: '129.7178m²', tradeDate: '2026-08-01', price: 3.5, priceStr: '3억 5,000', monthlyRent: 0 }],
    selected
  );
  assert.equal(metrics.latestSale!.price, 6.65);
  assert.ok(metrics.jeonseRate != null);
});

test('선택 평형에 거래가 없으면 지표도 만들어내지 않는다', () => {
  const metrics = computeInvestmentMetrics(
    trades.map((t) => ({ area: t.area, tradeDate: t.tradeDate, price: t.price, priceStr: t.priceStr, monthlyRent: 0 })),
    [],
    '33.2024'
  );
  assert.equal(metrics.latestSale, null);
  assert.equal(metrics.jeonseRate, null);
  assert.equal(metrics.gap, null);
});

test('면적 매칭은 단지 identity(aptSeq)를 건드리지 않는다', () => {
  // 이 모듈은 면적만 본다 — 이름/aptSeq를 입력으로 받지도, 반환하지도 않는다.
  const rows = selectTradesForArea(trades, '84.7855');
  assert.equal(Object.prototype.hasOwnProperty.call(rows[0], 'aptSeq'), false);
});
