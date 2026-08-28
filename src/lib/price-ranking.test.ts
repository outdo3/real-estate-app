import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDeclineRows,
  buildRecordHighRows,
  buildRisingRows,
  buildDeclineInterpretation,
  buildRecordHighInterpretation,
  buildRisingInterpretation,
  resolvePriceRankingPeriod,
  historicalCoverageLabel,
  HISTORICAL_LOOKBACK_MONTHS,
  isInArea84Band,
  buildArea84RankingRows,
  buildArea84Interpretation,
  buildArea84RegionDistributionInterpretation,
  DEFAULT_AREA84_BAND,
  type FeedTrade,
} from './price-ranking';

const NOW = new Date('2026-08-27T10:00:00+09:00');

test('resolvePriceRankingPeriod: 7d는 오늘 포함 7일', () => {
  const r = resolvePriceRankingPeriod('7d', NOW);
  assert.equal(r.from, '2026-08-21');
  assert.equal(r.to, '2026-08-27');
});

test('resolvePriceRankingPeriod: 30d는 오늘 포함 30일', () => {
  const r = resolvePriceRankingPeriod('30d', NOW);
  assert.equal(r.from, '2026-07-29');
  assert.equal(r.to, '2026-08-27');
});

test('resolvePriceRankingPeriod: 3m/6m/12m은 오늘에서 개월수만큼 뒤로', () => {
  assert.equal(resolvePriceRankingPeriod('3m', NOW).from, '2026-05-27');
  assert.equal(resolvePriceRankingPeriod('6m', NOW).from, '2026-02-27');
  assert.equal(resolvePriceRankingPeriod('12m', NOW).from, '2025-08-27');
});

function trade(overrides: Partial<FeedTrade>): FeedTrade {
  return {
    uid: Math.random().toString(36),
    aptSeq: 'AS1',
    name: '테스트단지',
    dong: '서대신동',
    lawdCd: '26140',
    dealType: 'sale',
    dealAmount: 50000,
    excluUseArea: 84.7855,
    floorRaw: 10,
    dealDate: '2026-06-01',
    dealCanceled: false,
    ...overrides,
  };
}

const PERIOD = { from: '2026-08-01', to: '2026-08-31' };

// ── DECLINE ──

test('decline: 기간 내 최근 거래가 이전 최고가보다 낮으면 하락 row 생성', () => {
  const trades = [
    trade({ uid: 'high', dealDate: '2021-10-12', dealAmount: 105000 }),
    trade({ uid: 'latest', dealDate: '2026-08-21', dealAmount: 44000 }),
  ];
  const rows = buildDeclineRows(trades, PERIOD);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].currentAmount, 44000);
  assert.equal(rows[0].priorHighAmount, 105000);
  assert.equal(rows[0].declineAmount, -61000);
  assert.equal(rows[0].declinePct, Math.round((-61000 / 105000) * 1000) / 10);
});

test('decline: 이전 최고가 자체가 없으면(첫 거래) 하락 row 아님', () => {
  const trades = [trade({ uid: 'only', dealDate: '2026-08-21', dealAmount: 44000 })];
  assert.equal(buildDeclineRows(trades, PERIOD).length, 0);
});

test('decline: 현재가가 이전 최고가 이상이면 하락 row 아님', () => {
  const trades = [
    trade({ uid: 'high', dealDate: '2021-10-12', dealAmount: 50000 }),
    trade({ uid: 'latest', dealDate: '2026-08-21', dealAmount: 50000 }),
  ];
  assert.equal(buildDeclineRows(trades, PERIOD).length, 0);
});

test('decline: 그룹에 기간 내 거래가 여러 건이면 "가장 최근" 것 하나만 사용', () => {
  const trades = [
    trade({ uid: 'high', dealDate: '2021-01-01', dealAmount: 100000 }),
    trade({ uid: 'mid', dealDate: '2026-08-10', dealAmount: 60000 }),
    trade({ uid: 'latest', dealDate: '2026-08-25', dealAmount: 40000 }),
  ];
  const rows = buildDeclineRows(trades, PERIOD);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].currentDate, '2026-08-25');
  assert.equal(rows[0].currentAmount, 40000);
});

test('decline: 취소거래는 이전 최고가/현재 거래 어느 쪽으로도 사용하지 않는다', () => {
  const trades = [
    trade({ uid: 'cancelled-high', dealDate: '2021-10-12', dealAmount: 999000, dealCanceled: true }),
    trade({ uid: 'real-high', dealDate: '2022-01-01', dealAmount: 90000 }),
    trade({ uid: 'latest', dealDate: '2026-08-21', dealAmount: 44000 }),
  ];
  const rows = buildDeclineRows(trades, PERIOD);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].priorHighAmount, 90000); // 취소거래(999000) 무시됨
});

test('decline: 다른 raw area는 별도 그룹 — 84.7855와 84.9950을 섞어 비교하지 않는다', () => {
  const trades = [
    trade({ uid: 'a-high', excluUseArea: 84.7855, dealDate: '2021-01-01', dealAmount: 100000 }),
    trade({ uid: 'b-latest', excluUseArea: 84.995, dealDate: '2026-08-21', dealAmount: 40000 }),
  ];
  // b는 자기 그룹에 이전 거래가 없어 하락 판정 불가(a의 최고가를 빌려오지 않음)
  assert.equal(buildDeclineRows(trades, PERIOD).length, 0);
});

test('decline: 미래 거래를 이전 최고가 계산에 포함하지 않는다', () => {
  const trades = [
    trade({ uid: 'latest', dealDate: '2026-08-10', dealAmount: 40000 }),
    trade({ uid: 'future-high', dealDate: '2026-09-01', dealAmount: 200000 }), // 기간 밖, 미래
  ];
  // latest 이전에 아무 거래도 없으므로 하락 판정 불가(미래의 200000을 끌어오면 안 됨)
  assert.equal(buildDeclineRows(trades, PERIOD).length, 0);
});

// ── RECORD HIGH ──

test('record-high: 이전 최고가를 실제로 넘어선 거래만 신고가로 인정', () => {
  const trades = [
    trade({ uid: 'old-high', dealDate: '2025-11-03', dealAmount: 175000 }),
    trade({ uid: 'new', dealDate: '2026-08-28', dealAmount: 183000 }),
  ];
  const rows = buildRecordHighRows(trades, PERIOD);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].currentAmount, 183000);
  assert.equal(rows[0].priorHighAmount, 175000);
  assert.equal(rows[0].deltaAmount, 8000);
});

test('record-high: 그룹의 첫 거래는 이전 최고가가 없어 신고가가 아니다', () => {
  const trades = [trade({ uid: 'first', dealDate: '2026-08-28', dealAmount: 183000 })];
  assert.equal(buildRecordHighRows(trades, PERIOD).length, 0);
});

test('record-high: 이전 최고가를 넘지 못하면 신고가 아님', () => {
  const trades = [
    trade({ uid: 'high', dealDate: '2025-11-03', dealAmount: 200000 }),
    trade({ uid: 'lower', dealDate: '2026-08-28', dealAmount: 183000 }),
  ];
  assert.equal(buildRecordHighRows(trades, PERIOD).length, 0);
});

test('record-high: 같은 그룹에서 기간 내 여러 건이 각각 경신하면 모두 별도 row', () => {
  const trades = [
    trade({ uid: 'base', dealDate: '2025-01-01', dealAmount: 100000 }),
    trade({ uid: 'first-break', dealDate: '2026-08-05', dealAmount: 110000 }),
    trade({ uid: 'second-break', dealDate: '2026-08-20', dealAmount: 120000 }),
  ];
  const rows = buildRecordHighRows(trades, PERIOD);
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.currentDate === '2026-08-05')?.priorHighAmount, 100000);
  assert.equal(rows.find((r) => r.currentDate === '2026-08-20')?.priorHighAmount, 110000);
});

test('record-high: 취소거래는 이전 최고가로 쓰이지 않고, 취소거래 자체도 신고가 후보가 아니다', () => {
  const trades = [
    trade({ uid: 'high', dealDate: '2025-01-01', dealAmount: 100000 }),
    trade({ uid: 'cancelled', dealDate: '2026-08-05', dealAmount: 999000, dealCanceled: true }),
    trade({ uid: 'normal', dealDate: '2026-08-20', dealAmount: 110000 }),
  ];
  const rows = buildRecordHighRows(trades, PERIOD);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].priorHighAmount, 100000);
});

test('record-high: 미래 거래가 과거 판정에 영향을 주지 않는다(입력 순서 뒤섞여도)', () => {
  const trades = [
    trade({ uid: 'future', dealDate: '2026-09-15', dealAmount: 999000 }),
    trade({ uid: 'base', dealDate: '2025-01-01', dealAmount: 100000 }),
    trade({ uid: 'current', dealDate: '2026-08-20', dealAmount: 110000 }),
  ];
  const rows = buildRecordHighRows(trades, PERIOD);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].priorHighAmount, 100000); // future(999000)를 끌어오지 않음
});

// ── RISING ──

test('rising: 기간 내 최근 거래가 직전 거래보다 높으면 상승 row', () => {
  const trades = [
    trade({ uid: 'prev', dealDate: '2026-06-03', dealAmount: 50000 }),
    trade({ uid: 'latest', dealDate: '2026-08-24', dealAmount: 57600 }),
  ];
  const rows = buildRisingRows(trades, PERIOD);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].riseAmount, 7600);
  assert.equal(rows[0].previousDate, '2026-06-03');
});

test('rising: 직전 거래가 없으면(첫 거래) 상승 row 아님', () => {
  const trades = [trade({ uid: 'only', dealDate: '2026-08-24', dealAmount: 57600 })];
  assert.equal(buildRisingRows(trades, PERIOD).length, 0);
});

test('rising: 직전 거래보다 낮거나 같으면 상승 아님', () => {
  const trades = [
    trade({ uid: 'prev', dealDate: '2026-06-03', dealAmount: 60000 }),
    trade({ uid: 'latest', dealDate: '2026-08-24', dealAmount: 57600 }),
  ];
  assert.equal(buildRisingRows(trades, PERIOD).length, 0);
});

test('rising: 역대 최고가보다 낮아도 직전 거래보다만 높으면 상승 row(하락 후 반등 오분류 방지 검증용 반대 사례 아님 — 상승은 직전거래 기준이 맞다는 것을 확인)', () => {
  const trades = [
    trade({ uid: 'all-time-high', dealDate: '2021-01-01', dealAmount: 200000 }),
    trade({ uid: 'crash', dealDate: '2025-01-01', dealAmount: 40000 }),
    trade({ uid: 'latest', dealDate: '2026-08-24', dealAmount: 45000 }),
  ];
  const rows = buildRisingRows(trades, PERIOD);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].previousAmount, 40000); // 역대최고(200000)가 아니라 직전거래(40000) 기준
  assert.equal(rows[0].riseAmount, 5000);
});

test('rising: 표본 규칙 — 트레일링 12개월 동일 그룹 거래 3건 이상이면 hasSufficientSample=true', () => {
  const trades = [
    trade({ uid: 't1', dealDate: '2026-01-01', dealAmount: 40000 }),
    trade({ uid: 't2', dealDate: '2026-03-01', dealAmount: 42000 }),
    trade({ uid: 't3', dealDate: '2026-06-03', dealAmount: 50000 }),
    trade({ uid: 'latest', dealDate: '2026-08-24', dealAmount: 57600 }),
  ];
  const rows = buildRisingRows(trades, PERIOD);
  assert.equal(rows[0].hasSufficientSample, true);
  assert.equal(rows[0].trailing12moSampleCount, 4);
});

test('rising: 표본이 2건 이하면(직전 거래 1건만) hasSufficientSample=false', () => {
  const trades = [
    trade({ uid: 'prev', dealDate: '2026-06-03', dealAmount: 50000 }),
    trade({ uid: 'latest', dealDate: '2026-08-24', dealAmount: 57600 }),
  ];
  const rows = buildRisingRows(trades, PERIOD);
  assert.equal(rows[0].hasSufficientSample, false);
});

test('rising: 12개월보다 오래된 거래는 표본 카운트에서 제외', () => {
  const trades = [
    trade({ uid: 'old', dealDate: '2024-01-01', dealAmount: 30000 }),
    trade({ uid: 'prev', dealDate: '2026-06-03', dealAmount: 50000 }),
    trade({ uid: 'latest', dealDate: '2026-08-24', dealAmount: 57600 }),
  ];
  const rows = buildRisingRows(trades, PERIOD);
  assert.equal(rows[0].trailing12moSampleCount, 2); // old는 12개월 밖
});

// ── 공통: 대신롯데캐슬 unit collision ──

test('unit collision: 84.7855㎡와 84.9950㎡가 각자 독립적으로 하락/신고가/상승 판정된다', () => {
  const trades = [
    trade({ uid: 'a-high', excluUseArea: 84.7855, dealDate: '2021-01-01', dealAmount: 100000 }),
    trade({ uid: 'a-latest', excluUseArea: 84.7855, dealDate: '2026-08-21', dealAmount: 60000 }), // 하락
    trade({ uid: 'b-high', excluUseArea: 84.995, dealDate: '2025-11-03', dealAmount: 90000 }),
    trade({ uid: 'b-latest', excluUseArea: 84.995, dealDate: '2026-08-25', dealAmount: 95000 }), // 신고가
  ];
  const decline = buildDeclineRows(trades, PERIOD);
  const recordHigh = buildRecordHighRows(trades, PERIOD);
  assert.equal(decline.length, 1);
  assert.equal(decline[0].excluUseArea, 84.7855);
  assert.equal(recordHigh.length, 1);
  assert.equal(recordHigh[0].excluUseArea, 84.995);
});

// ── interpretation ──

test('buildDeclineInterpretation: 구간별 문구, 투자 권유형 표현 없음', () => {
  const l1 = buildDeclineInterpretation({ declinePct: -58.1 });
  const l2 = buildDeclineInterpretation({ declinePct: -25 });
  const l3 = buildDeclineInterpretation({ declinePct: -5 });
  for (const l of [l1, l2, l3]) {
    for (const banned of ['저평가', '매수기회', '싸다', '반등']) assert.equal(l.includes(banned), false);
  }
  assert.ok(l1.includes('크게 벌어졌'));
  assert.ok(l2.includes('내려와 있'));
});

test('buildRecordHighInterpretation: 표본 충분 여부로 문구 분기', () => {
  assert.ok(buildRecordHighInterpretation({ trailing12moSampleCount: 5 }).includes('최근 12개월'));
  assert.ok(buildRecordHighInterpretation({ trailing12moSampleCount: 1 }).includes('최고가'));
});

// ── FIX_PRICE_RANKINGS_V2_1_1A — historical coverage 정직성 ──
// 감사 결과: MOLIT 실거래 API는 지역+월 단위로만 조회되어(단지/면적 필터
// 없음) "역대 진짜 최고가"를 무제한으로 보장할 수 없다(시도 전체 집계에서
// fetch 규모가 그대로 폭증). 따라서 이 STEP은 계산 로직(§8~§16, 이미
// 위에서 검증됨)이 아니라 "그 계산이 실제로는 HISTORICAL_LOOKBACK_MONTHS로
// 제한된 범위 안에서의 최고가일 뿐"이라는 사실을 문구가 항상 정직하게
// 밝히는지를 검증한다.

test('historicalCoverageLabel: 24개월은 "2년", 12의 배수가 아니면 개월 단위', () => {
  assert.equal(historicalCoverageLabel(24), '2년');
  assert.equal(historicalCoverageLabel(12), '1년');
  assert.equal(historicalCoverageLabel(18), '18개월');
  assert.equal(HISTORICAL_LOOKBACK_MONTHS, 24);
  assert.equal(historicalCoverageLabel(), '2년'); // 기본값 = HISTORICAL_LOOKBACK_MONTHS
});

test('CASE A(false record-high 시나리오): 조회 범위 밖에 더 높은 실거래가 있어도 계산은 주어진 데이터로만 이뤄지므로, 문구가 반드시 범위를 명시해야 한다', () => {
  // 2021년 12억 거래는 24개월 lookback 밖이라 allTrades에 애초에 포함되지
  // 않는다(fetch 자체가 안 됨) — 이 테스트는 "그 상태에서도 계산이 거짓
  // 무제한 주장을 하지 않는지"를 검증한다(실제 12억 거래를 안 보이게 만드는
  // 것이 이 STEP의 목표가 아니라 — 그건 스키마 변경 없이는 불가능 — 문구가
  // 정직한 범위로 스스로를 한정하는 것이 목표).
  const trades = [
    trade({ uid: 'window-high', dealDate: '2025-01-01', dealAmount: 90000 }), // 조회 범위 안 최고가(9억)
    trade({ uid: 'current', dealDate: '2026-08-20', dealAmount: 100000 }), // 10억, 조회 범위 안에서는 신고가
  ];
  const rows = buildRecordHighRows(trades, PERIOD);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].priorHighAmount, 90000);
  const text = buildRecordHighInterpretation(rows[0], historicalCoverageLabel());
  // "역대"/"진짜"처럼 무제한을 뜻하는 표현이 없어야 하고, 조회 범위(coverageLabel)가 문구에 명시돼야 한다.
  assert.equal(text.includes('역대'), false);
  assert.equal(text.includes('진짜'), false);
  assert.ok(text.includes('2년'));
});

test('buildDeclineInterpretation/buildRecordHighInterpretation: coverageLabel을 넘기면 문구에 그대로 반영되고, 무제한 표현("과거 최고가"/"이전 최고가"만 단독으로) 대신 범위가 명시된다', () => {
  const decline = buildDeclineInterpretation({ declinePct: -30 }, '3년');
  assert.ok(decline.includes('3년'));
  const recordHigh = buildRecordHighInterpretation({ trailing12moSampleCount: 1 }, '3년');
  assert.ok(recordHigh.includes('3년'));
});

test('buildRisingInterpretation: 표본 부족 시 "상승세" 같은 과장 표현 없이 단순 사실만', () => {
  const weak = buildRisingInterpretation({ hasSufficientSample: false });
  const strong = buildRisingInterpretation({ hasSufficientSample: true });
  assert.equal(weak.includes('상승세'), false);
  assert.ok(weak.includes('직전 거래보다'));
  assert.ok(strong.includes('이어지고'));
});

// ── 84SQM_RANKING_V1 — AREA84 ──

test('isInArea84Band: 경계값 — 83.99 제외, 84.00 포함, 84.9999 포함, 85.00 제외, 85.01 제외', () => {
  assert.equal(isInArea84Band(83.99), false);
  assert.equal(isInArea84Band(83.5), false);
  assert.equal(isInArea84Band(84), true);
  assert.equal(isInArea84Band(84.0001), true);
  assert.equal(isInArea84Band(84.7855), true);
  assert.equal(isInArea84Band(84.9999), true);
  assert.equal(isInArea84Band(85), false);
  assert.equal(isInArea84Band(85.01), false);
  assert.equal(isInArea84Band(82.6), false);
  assert.equal(isInArea84Band(86.1), false);
  assert.equal(isInArea84Band(null), false);
});

test('buildArea84RankingRows: band 밖 거래는 후보에서 제외된다', () => {
  const trades = [
    trade({ uid: 'in-band', dealDate: '2026-08-10', dealAmount: 50000, excluUseArea: 84.5 }),
    trade({ uid: 'below-band', dealDate: '2026-08-11', dealAmount: 99000, excluUseArea: 83.9, aptSeq: 'AS2', name: '다른단지' }),
    trade({ uid: 'above-band', dealDate: '2026-08-12', dealAmount: 99000, excluUseArea: 85.1, aptSeq: 'AS3', name: '또다른단지' }),
  ];
  const rows = buildArea84RankingRows(trades, PERIOD);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].excluUseArea, 84.5);
});

test('buildArea84RankingRows: 취소거래/미래거래/기간 밖 거래는 대표 거래 후보가 아니다', () => {
  const trades = [
    trade({ uid: 'cancelled', dealDate: '2026-08-15', dealAmount: 99000, dealCanceled: true }),
    trade({ uid: 'future', dealDate: '2026-09-15', dealAmount: 99000 }),
    trade({ uid: 'out-of-period', dealDate: '2026-01-01', dealAmount: 99000 }),
    trade({ uid: 'valid', dealDate: '2026-08-05', dealAmount: 45000 }),
  ];
  const rows = buildArea84RankingRows(trades, PERIOD);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].currentAmount, 45000);
});

test('buildArea84RankingRows: 단지당 대표 거래 1건만 — 기간 내 가장 최근 거래를 고른다', () => {
  const trades = [
    trade({ uid: 'older', dealDate: '2026-08-01', dealAmount: 40000 }),
    trade({ uid: 'newer', dealDate: '2026-08-20', dealAmount: 47000 }),
  ];
  const rows = buildArea84RankingRows(trades, PERIOD);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].currentAmount, 47000);
  assert.equal(rows[0].currentDate, '2026-08-20');
});

test('buildArea84RankingRows: 같은 날짜 동점이면 금액 DESC로 결정론적 tie-break', () => {
  const trades = [
    trade({ uid: 'low', dealDate: '2026-08-20', dealAmount: 40000, floorRaw: 3 }),
    trade({ uid: 'high', dealDate: '2026-08-20', dealAmount: 47000, floorRaw: 15 }),
  ];
  const rows = buildArea84RankingRows(trades, PERIOD);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].currentAmount, 47000);
  assert.equal(rows[0].floorRaw, 15);
});

test('buildArea84RankingRows: band 안에서도 exact raw area는 병합하지 않고 대표 거래의 값만 보존한다(대신롯데캐슬 84.7855 vs 84.9950)', () => {
  const trades = [
    trade({ uid: 'a', dealDate: '2026-08-10', dealAmount: 40000, excluUseArea: 84.7855, aptSeq: 'AS-LOTTE', name: '대신롯데캐슬' }),
    trade({ uid: 'b', dealDate: '2026-08-05', dealAmount: 41000, excluUseArea: 84.995, aptSeq: 'AS-LOTTE', name: '대신롯데캐슬' }),
  ];
  const rows = buildArea84RankingRows(trades, PERIOD);
  // 같은 단지(identity)이므로 대표 거래는 1건만 — 더 최근인 84.7855가 선택되고, 그 exact area가 그대로 보존된다.
  assert.equal(rows.length, 1);
  assert.equal(rows[0].excluUseArea, 84.7855);
});

test('buildArea84RankingRows: 서로 다른 단지는 각각 별도 row(단지당 1건 원칙)', () => {
  const trades = [
    trade({ uid: 'a', dealDate: '2026-08-10', dealAmount: 60000, aptSeq: 'AS-A', name: 'A단지' }),
    trade({ uid: 'b', dealDate: '2026-08-11', dealAmount: 50000, aptSeq: 'AS-B', name: 'B단지' }),
  ];
  const rows = buildArea84RankingRows(trades, PERIOD);
  assert.equal(rows.length, 2);
  const names = rows.map((r) => r.name).sort();
  assert.deepEqual(names, ['A단지', 'B단지']);
});

test('buildArea84RankingRows: previousAmount/previousDate는 같은 exact area의 직전 거래만 사용한다', () => {
  const trades = [
    trade({ uid: 'prev', dealDate: '2026-06-01', dealAmount: 42000, excluUseArea: 84.5 }),
    trade({ uid: 'other-area-prev', dealDate: '2026-07-01', dealAmount: 999000, excluUseArea: 84.1 }),
    trade({ uid: 'current', dealDate: '2026-08-10', dealAmount: 47000, excluUseArea: 84.5 }),
  ];
  const rows = buildArea84RankingRows(trades, PERIOD);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].previousAmount, 42000); // 다른 면적(84.1)의 999000이 아니라 같은 84.5의 직전 거래
  assert.equal(rows[0].changeAmount, 5000);
});

test('buildArea84RankingRows: 직전 거래가 없으면 previousAmount/changeAmount는 null(숨김)', () => {
  const trades = [trade({ uid: 'only', dealDate: '2026-08-10', dealAmount: 47000 })];
  const rows = buildArea84RankingRows(trades, PERIOD);
  assert.equal(rows[0].previousAmount, null);
  assert.equal(rows[0].changeAmount, null);
  assert.equal(rows[0].changePct, null);
});

test('buildArea84RankingRows: 트레일링 24개월 내 최고가면 isRecent2yHigh=true', () => {
  const trades = [
    trade({ uid: 'lower-past', dealDate: '2025-01-01', dealAmount: 30000 }),
    trade({ uid: 'current', dealDate: '2026-08-10', dealAmount: 47000 }),
  ];
  const rows = buildArea84RankingRows(trades, PERIOD);
  assert.equal(rows[0].isRecent2yHigh, true);
  assert.equal(rows[0].recent2yHighAmount, 47000);
  assert.equal(rows[0].recent2yHighDeltaPct, null);
});

test('buildArea84RankingRows: 과거에 더 높은 거래가 있으면 isRecent2yHigh=false, 대비율 계산', () => {
  const trades = [
    trade({ uid: 'higher-past', dealDate: '2025-06-01', dealAmount: 60000 }),
    trade({ uid: 'current', dealDate: '2026-08-10', dealAmount: 48000 }),
  ];
  const rows = buildArea84RankingRows(trades, PERIOD);
  assert.equal(rows[0].isRecent2yHigh, false);
  assert.equal(rows[0].recent2yHighAmount, 60000);
  assert.equal(rows[0].recent2yHighDeltaPct, Math.round(((48000 - 60000) / 60000) * 1000) / 10);
});

test('buildArea84Interpretation: 최고가/대비율 문구 분기, "역대"/"신고가" 표현 없음', () => {
  const high = buildArea84Interpretation({ isRecent2yHigh: true, recent2yHighDeltaPct: null }, '2년');
  assert.ok(high.includes('2년'));
  assert.equal(high.includes('역대'), false);
  assert.equal(high.includes('신고가'), false);
  const below = buildArea84Interpretation({ isRecent2yHigh: false, recent2yHighDeltaPct: -8 }, '2년');
  assert.ok(below.includes('-8%'));
});

test('buildArea84RegionDistributionInterpretation: 표본 5건 미만이면 null', () => {
  const rows = [{ lawdCd: '26140' }, { lawdCd: '26140' }];
  const map = new Map([['26140', '서구']]);
  assert.equal(buildArea84RegionDistributionInterpretation(rows, map, '부산'), null);
});

test('buildArea84RegionDistributionInterpretation: 특정 구가 30% 이상 몰려있을 때만 문구 생성', () => {
  const rows = [
    { lawdCd: '26350' }, { lawdCd: '26350' }, { lawdCd: '26350' },
    { lawdCd: '26140' }, { lawdCd: '26470' },
  ];
  const map = new Map([['26350', '해운대구'], ['26140', '서구'], ['26470', '연제구']]);
  const text = buildArea84RegionDistributionInterpretation(rows, map, '부산');
  assert.ok(text && text.includes('해운대구'));
});

test('buildArea84RegionDistributionInterpretation: 고르게 분산돼 있으면 null(과장 금지)', () => {
  const rows = [
    { lawdCd: '26350' }, { lawdCd: '26140' }, { lawdCd: '26470' }, { lawdCd: '26230' }, { lawdCd: '26260' },
  ];
  const map = new Map([
    ['26350', '해운대구'], ['26140', '서구'], ['26470', '연제구'], ['26230', '남구'], ['26260', '동래구'],
  ]);
  assert.equal(buildArea84RegionDistributionInterpretation(rows, map, '부산'), null);
});

test('DEFAULT_AREA84_BAND: 84 이상 85 미만(exclusive)', () => {
  assert.equal(DEFAULT_AREA84_BAND.min, 84);
  assert.equal(DEFAULT_AREA84_BAND.max, 85);
});
