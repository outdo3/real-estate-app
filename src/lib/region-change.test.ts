import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveRegionChangeCurrentWindow,
  resolveRegionChangeWindows,
  regionChangeFetchMonths,
  buildRegionChangePairs,
  aggregateChangeByBucket,
  buildRegionChangeInterpretation,
  buildComplexChangeRows,
  deriveConfidence,
  classifyDirection,
  classifyIntensity,
  periodLabelOf,
  MIN_SAMPLE_PAIRS,
  NEUTRAL_RANGE_PCT,
  type FeedTrade,
} from './region-change';

const NOW = new Date('2026-08-29T10:00:00+09:00');

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
    dealDate: '2026-08-01',
    dealCanceled: false,
    ...overrides,
  };
}

// ── WINDOWS ──

test('resolveRegionChangeCurrentWindow: 3m은 오늘 포함 최근 3개월', () => {
  const w = resolveRegionChangeCurrentWindow('3m', NOW);
  assert.equal(w.from, '2026-05-29');
  assert.equal(w.to, '2026-08-29');
});

test('resolveRegionChangeWindows: previous는 current 바로 직전 동일 길이(끊김/겹침 없음)', () => {
  const { current, previous } = resolveRegionChangeWindows('3m', NOW);
  assert.equal(current.from, '2026-05-29');
  assert.equal(previous.to, '2026-05-28'); // current.from 바로 하루 전
  const days = (d: string) => new Date(d).getTime();
  const currentDays = Math.round((days(current.to) - days(current.from)) / 86400000);
  const previousDays = Math.round((days(previous.to) - days(previous.from)) / 86400000);
  assert.equal(currentDays, previousDays); // 길이 동일
});

test('regionChangeFetchMonths: current+previous 두 window를 커버하는 월만 포함(추가 lookback 없음)', () => {
  const months = regionChangeFetchMonths('1m', NOW);
  // 1개월짜리 두 window(현재 7/29~8/29, 직전 6/29~7/28)를 커버하려면 2026-06,07,08 세 달이면 충분.
  assert.ok(months.includes('202608'));
  assert.ok(months.includes('202607'));
  assert.ok(!months.includes('202601')); // 불필요하게 먼 과거까지 fetch하지 않음
});

// ── PAIRING / COMPOSITION BIAS ──

const WINDOWS_3M = resolveRegionChangeWindows('3m', NOW);

test('buildRegionChangePairs: 두 window 모두에 거래가 있어야 pair 성립', () => {
  const trades = [
    trade({ uid: 'cur', dealDate: '2026-08-01', dealAmount: 55000 }),
    trade({ uid: 'prev', dealDate: '2026-04-01', dealAmount: 50000 }),
  ];
  const pairs = buildRegionChangePairs(trades, WINDOWS_3M);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].changePct, 10);
});

test('buildRegionChangePairs: 한쪽 window에만 거래가 있으면 pair 아님(억지로 채우지 않음)', () => {
  const onlyCurrent = [trade({ uid: 'cur', dealDate: '2026-08-01' })];
  assert.equal(buildRegionChangePairs(onlyCurrent, WINDOWS_3M).length, 0);

  const onlyPrevious = [trade({ uid: 'prev', dealDate: '2026-04-01' })];
  assert.equal(buildRegionChangePairs(onlyPrevious, WINDOWS_3M).length, 0);
});

test('buildRegionChangePairs: 취소거래는 pair 후보에서 제외', () => {
  const trades = [
    trade({ uid: 'cur', dealDate: '2026-08-01', dealAmount: 999000, dealCanceled: true }),
    trade({ uid: 'cur2', dealDate: '2026-08-05', dealAmount: 52000 }),
    trade({ uid: 'prev', dealDate: '2026-04-01', dealAmount: 50000 }),
  ];
  const pairs = buildRegionChangePairs(trades, WINDOWS_3M);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].currentAmount, 52000);
});

test('buildRegionChangePairs: 같은 단지라도 raw area가 다르면 별도 pair(병합 금지, 84.7855 vs 84.9950)', () => {
  const trades = [
    trade({ uid: 'c1', dealDate: '2026-08-01', dealAmount: 55000, excluUseArea: 84.7855 }),
    trade({ uid: 'p1', dealDate: '2026-04-01', dealAmount: 50000, excluUseArea: 84.7855 }),
    trade({ uid: 'c2', dealDate: '2026-08-02', dealAmount: 60000, excluUseArea: 84.995 }),
    trade({ uid: 'p2', dealDate: '2026-04-02', dealAmount: 58000, excluUseArea: 84.995 }),
  ];
  const pairs = buildRegionChangePairs(trades, WINDOWS_3M);
  assert.equal(pairs.length, 2);
  const areas = pairs.map((p) => p.excluUseArea).sort();
  assert.deepEqual(areas, [84.7855, 84.995]);
});

test('COMPOSITION BIAS GUARD: 기간별 거래 면적 mix가 완전히 달라도 median은 실제 가격 변화만 반영한다', () => {
  // 이전 기간엔 59㎡ 거래가 많고, 현재 기간엔 84㎡ 거래가 많다 — 84㎡가 59㎡보다
  // 절대가격이 훨씬 비싸므로, 단순 "이전 평균가 vs 현재 평균가"였다면 mix 변화만으로
  // 지역이 크게 "상승"한 것처럼 보였을 것이다. paired 방식은 각 면적을 그 자신의
  // 이전 거래와만 비교하므로 이 오염이 발생하지 않아야 한다.
  const trades = [
    // 59㎡ 계열 5개 단지: 이전 기간 거래 많음(활발), 현재 기간엔 거의 없음 — 가격은 그대로(변화 없음)
    ...Array.from({ length: 5 }, (_, i) => [
      trade({ uid: `p59a-${i}`, dealDate: '2026-04-01', dealAmount: 30000, excluUseArea: 59.0, aptSeq: `AS-59-${i}` }),
      trade({ uid: `p59b-${i}`, dealDate: '2026-04-15', dealAmount: 30000, excluUseArea: 59.0, aptSeq: `AS-59-${i}` }),
      trade({ uid: `p59c-${i}`, dealDate: '2026-05-01', dealAmount: 30000, excluUseArea: 59.0, aptSeq: `AS-59-${i}` }),
      trade({ uid: `c59-${i}`, dealDate: '2026-08-01', dealAmount: 30000, excluUseArea: 59.0, aptSeq: `AS-59-${i}` }),
    ]).flat(),
    // 84㎡ 계열 5개 단지: 반대로 현재 기간 거래가 많음(활발) — 가격도 그대로(변화 없음)
    ...Array.from({ length: 5 }, (_, i) => [
      trade({ uid: `p84-${i}`, dealDate: '2026-04-01', dealAmount: 60000, excluUseArea: 84.0, aptSeq: `AS-84-${i}` }),
      trade({ uid: `c84a-${i}`, dealDate: '2026-08-01', dealAmount: 60000, excluUseArea: 84.0, aptSeq: `AS-84-${i}` }),
      trade({ uid: `c84b-${i}`, dealDate: '2026-08-15', dealAmount: 60000, excluUseArea: 84.0, aptSeq: `AS-84-${i}` }),
      trade({ uid: `c84c-${i}`, dealDate: '2026-08-29', dealAmount: 60000, excluUseArea: 84.0, aptSeq: `AS-84-${i}` }),
    ]).flat(),
  ];
  const pairs = buildRegionChangePairs(trades, WINDOWS_3M);
  // 두 그룹(59㎡, 84㎡) 모두 가격이 그대로이므로 각 pair의 changePct는 0이어야 하고,
  // 단순 평균가 비교였다면 mix가 59㎡ 위주 → 84㎡ 위주로 바뀌며 크게 "상승"했을 것이다.
  for (const p of pairs) assert.equal(p.changePct, 0);
  const buckets = aggregateChangeByBucket(pairs, () => 'region', () => '지역');
  assert.equal(buckets[0].medianPct, 0); // mix 변화에도 불구하고 0%(실제 가격 변화 없음)를 정확히 반영
});

// ── OUTLIER / MEDIAN ──

test('OUTLIER GUARD: 극단 거래 1건이 median을 뒤집지 않는다', () => {
  const trades: FeedTrade[] = [];
  for (let i = 0; i < 20; i++) {
    trades.push(trade({ uid: `p${i}`, dealDate: '2026-04-01', dealAmount: 50000, aptSeq: `AS-${i}` }));
    trades.push(trade({ uid: `c${i}`, dealDate: '2026-08-01', dealAmount: 50500, aptSeq: `AS-${i}` })); // +1%
  }
  // 극단 outlier 1건 추가: +500%
  trades.push(trade({ uid: 'p-out', dealDate: '2026-04-01', dealAmount: 10000, aptSeq: 'AS-OUT' }));
  trades.push(trade({ uid: 'c-out', dealDate: '2026-08-01', dealAmount: 60000, aptSeq: 'AS-OUT' }));

  const pairs = buildRegionChangePairs(trades, WINDOWS_3M);
  assert.equal(pairs.length, 21);
  const buckets = aggregateChangeByBucket(pairs, () => 'region', () => '지역');
  // median은 outlier 없이도 +1% 근처여야 하고, outlier가 섞여도 크게 흔들리면 안 됨.
  assert.ok(Math.abs(buckets[0].medianPct! - 1) < 0.5, `median이 outlier에 왜곡됨: ${buckets[0].medianPct}`);
});

// ── SAMPLE THRESHOLD ──

test('SAMPLE THRESHOLD: threshold-1/threshold/threshold+1 경계', () => {
  assert.equal(deriveConfidence(MIN_SAMPLE_PAIRS - 1), 'INSUFFICIENT');
  assert.equal(deriveConfidence(MIN_SAMPLE_PAIRS), 'LOW');
  assert.equal(deriveConfidence(MIN_SAMPLE_PAIRS + 1), 'LOW');
});

test('aggregateChangeByBucket: 표본 부족(threshold 미만)이면 medianPct/direction/intensity 모두 null(숫자를 억지로 보여주지 않음)', () => {
  const trades = [
    trade({ uid: 'c1', dealDate: '2026-08-01', dealAmount: 55000 }),
    trade({ uid: 'p1', dealDate: '2026-04-01', dealAmount: 50000 }),
  ];
  const pairs = buildRegionChangePairs(trades, WINDOWS_3M);
  assert.equal(pairs.length, 1); // MIN_SAMPLE_PAIRS(5)보다 적음
  const buckets = aggregateChangeByBucket(pairs, () => 'region', () => '지역');
  assert.equal(buckets[0].confidence, 'INSUFFICIENT');
  assert.equal(buckets[0].medianPct, null);
  assert.equal(buckets[0].direction, null);
  assert.equal(buckets[0].intensity, null);
});

// ── NEUTRAL / DIRECTION / INTENSITY ──

test('classifyDirection: neutral range 경계(±0.5%)', () => {
  assert.equal(classifyDirection(0.5), 'neutral');
  assert.equal(classifyDirection(-0.5), 'neutral');
  assert.equal(classifyDirection(0.51), 'up');
  assert.equal(classifyDirection(-0.51), 'down');
  assert.equal(classifyDirection(0), 'neutral');
});

test('classifyIntensity: 0-1/1-3/3-5/5+ 대칭 구간', () => {
  assert.equal(classifyIntensity(0.9), '0-1');
  assert.equal(classifyIntensity(-0.9), '0-1');
  assert.equal(classifyIntensity(1), '1-3');
  assert.equal(classifyIntensity(2.9), '1-3');
  assert.equal(classifyIntensity(-3), '3-5');
  assert.equal(classifyIntensity(4.9), '3-5');
  assert.equal(classifyIntensity(5), '5+');
  assert.equal(classifyIntensity(-10), '5+');
});

// ── INTERPRETATION ──

test('buildRegionChangeInterpretation: 표본 충분 + 상승폭 1위 지역만 문장 생성', () => {
  const buckets = [
    { key: 'a', label: '해운대구', medianPct: 3.2, pairCount: 40, complexCount: 20, minPct: -5, maxPct: 10, confidence: 'HIGH' as const, direction: 'up' as const, intensity: '3-5' as const },
    { key: 'b', label: '수영구', medianPct: 1.1, pairCount: 30, complexCount: 15, minPct: -5, maxPct: 10, confidence: 'HIGH' as const, direction: 'up' as const, intensity: '1-3' as const },
  ];
  const text = buildRegionChangeInterpretation(buckets, '부산', '3개월');
  assert.ok(text);
  assert.ok(text!.includes('해운대구'));
  assert.ok(text!.includes('상승폭'));
});

test('buildRegionChangeInterpretation: 비교 가능한 지역이 1개뿐이면 null', () => {
  const buckets = [
    { key: 'a', label: '서구', medianPct: 3.2, pairCount: 40, complexCount: 20, minPct: -5, maxPct: 10, confidence: 'HIGH' as const, direction: 'up' as const, intensity: '3-5' as const },
  ];
  assert.equal(buildRegionChangeInterpretation(buckets, '부산', '3개월'), null);
});

test('buildRegionChangeInterpretation: 표본 부족 지역은 후보에서 제외', () => {
  const buckets = [
    { key: 'a', label: '서구', medianPct: null, pairCount: 2, complexCount: 2, minPct: null, maxPct: null, confidence: 'INSUFFICIENT' as const, direction: null, intensity: null },
    { key: 'b', label: '연제구', medianPct: 2.0, pairCount: 30, complexCount: 15, minPct: -5, maxPct: 10, confidence: 'HIGH' as const, direction: 'up' as const, intensity: '1-3' as const },
  ];
  // 유효 후보가 1개뿐(표본 부족 제외) → 비교 불가 → null
  assert.equal(buildRegionChangeInterpretation(buckets, '부산', '3개월'), null);
});

test('buildRegionChangeInterpretation: 1위가 보합(neutral)이면 과장하지 않고 null', () => {
  const buckets = [
    { key: 'a', label: '서구', medianPct: 0.2, pairCount: 30, complexCount: 15, minPct: -5, maxPct: 10, confidence: 'HIGH' as const, direction: 'neutral' as const, intensity: '0-1' as const },
    { key: 'b', label: '연제구', medianPct: -0.1, pairCount: 30, complexCount: 15, minPct: -5, maxPct: 10, confidence: 'HIGH' as const, direction: 'neutral' as const, intensity: '0-1' as const },
  ];
  assert.equal(buildRegionChangeInterpretation(buckets, '부산', '3개월'), null);
});

// ── COMPLEX LEVEL ──

test('buildComplexChangeRows: 단지 안에 여러 면적이 있어도 대표 면적 1개만으로 변동률 계산(면적 혼합 금지)', () => {
  const trades = [
    // 59㎡: window당 1건씩만(비활발)
    trade({ uid: 'c59', dealDate: '2026-08-01', dealAmount: 32000, excluUseArea: 59.0, aptSeq: 'AS-X' }),
    trade({ uid: 'p59', dealDate: '2026-04-01', dealAmount: 30000, excluUseArea: 59.0, aptSeq: 'AS-X' }),
    // 84㎡: window당 3건씩(더 활발) — 대표로 선택돼야 함
    ...['c84a', 'c84b', 'c84c'].map((uid, i) => trade({ uid, dealDate: `2026-08-0${i + 1}`, dealAmount: 60000 + i * 100, excluUseArea: 84.0, aptSeq: 'AS-X' })),
    ...['p84a', 'p84b', 'p84c'].map((uid, i) => trade({ uid, dealDate: `2026-04-0${i + 1}`, dealAmount: 58000, excluUseArea: 84.0, aptSeq: 'AS-X' })),
  ];
  const rows = buildComplexChangeRows(trades, WINDOWS_3M);
  assert.equal(rows.length, 1); // 단지 1개 = row 1개(면적별로 쪼개지지 않음)
  assert.equal(rows[0].excluUseArea, 84.0); // 더 활발한 84㎡가 대표로 선택됨
});

test('buildComplexChangeRows: 두 window 모두에 거래가 있는 면적이 하나도 없으면 그 단지는 목록에서 제외', () => {
  const trades = [
    trade({ uid: 'c1', dealDate: '2026-08-01', dealAmount: 50000, aptSeq: 'AS-LONELY' }),
    // previous window 거래 없음
  ];
  const rows = buildComplexChangeRows(trades, WINDOWS_3M);
  assert.equal(rows.length, 0);
});

test('buildComplexChangeRows: 서로 다른 단지는 각각 독립적인 row', () => {
  const trades = [
    trade({ uid: 'c1', dealDate: '2026-08-01', dealAmount: 55000, aptSeq: 'AS-A', name: 'A단지' }),
    trade({ uid: 'p1', dealDate: '2026-04-01', dealAmount: 50000, aptSeq: 'AS-A', name: 'A단지' }),
    trade({ uid: 'c2', dealDate: '2026-08-01', dealAmount: 45000, aptSeq: 'AS-B', name: 'B단지' }),
    trade({ uid: 'p2', dealDate: '2026-04-01', dealAmount: 50000, aptSeq: 'AS-B', name: 'B단지' }),
  ];
  const rows = buildComplexChangeRows(trades, WINDOWS_3M);
  assert.equal(rows.length, 2);
  const names = rows.map((r) => r.name).sort();
  assert.deepEqual(names, ['A단지', 'B단지']);
});

// ── MISC ──

test('periodLabelOf: 12m은 "1년", 나머지는 "N개월"', () => {
  assert.equal(periodLabelOf('1m'), '1개월');
  assert.equal(periodLabelOf('3m'), '3개월');
  assert.equal(periodLabelOf('6m'), '6개월');
  assert.equal(periodLabelOf('12m'), '1년');
});

test('NEUTRAL_RANGE_PCT/MIN_SAMPLE_PAIRS는 문서화된 값과 일치', () => {
  assert.equal(NEUTRAL_RANGE_PCT, 0.5);
  assert.equal(MIN_SAMPLE_PAIRS, 5);
});
