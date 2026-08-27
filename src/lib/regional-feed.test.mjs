import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolvePeriodRange,
  monthsForRange,
  isDateInRange,
  identityKey,
  areaKey,
  groupKey,
  dedupeTrades,
  filterVerifiedTrades,
  groupTradesByDate,
  annotateTrades,
  buildRegionSummary,
  buildMarketInterpretation,
  areaBandLabel,
  windowCoverageLabel,
  previousPeriodRange,
  toFeedTrade,
  buildConcentrationRanking,
} from './regional-feed.ts';

const NOW = new Date('2026-08-27T10:00:00+09:00');

function trade(overrides) {
  return {
    uid: Math.random().toString(36),
    aptSeq: null,
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

test('resolvePeriodRange: today는 from=to=오늘', () => {
  const r = resolvePeriodRange('today', NOW);
  assert.equal(r.from, '2026-08-27');
  assert.equal(r.to, '2026-08-27');
});

test('resolvePeriodRange: yesterday는 어제 하루', () => {
  const r = resolvePeriodRange('yesterday', NOW);
  assert.equal(r.from, '2026-08-26');
  assert.equal(r.to, '2026-08-26');
});

test('resolvePeriodRange: 7d는 오늘 포함 7일(경계 포함)', () => {
  const r = resolvePeriodRange('7d', NOW);
  assert.equal(r.from, '2026-08-21');
  assert.equal(r.to, '2026-08-27');
});

test('resolvePeriodRange: thisWeek은 월요일부터 오늘까지', () => {
  // 2026-08-27은 목요일 -> 이번 주 월요일은 08-24
  const r = resolvePeriodRange('thisWeek', NOW);
  assert.equal(r.from, '2026-08-24');
  assert.equal(r.to, '2026-08-27');
});

test('resolvePeriodRange: lastWeek은 지난주 월~일 전체', () => {
  const r = resolvePeriodRange('lastWeek', NOW);
  assert.equal(r.from, '2026-08-17');
  assert.equal(r.to, '2026-08-23');
});

test('resolvePeriodRange: 30d는 오늘 포함 30일', () => {
  const r = resolvePeriodRange('30d', NOW);
  assert.equal(r.from, '2026-07-29');
  assert.equal(r.to, '2026-08-27');
});

test('resolvePeriodRange: 12m은 이번 달 포함 최근 12개월(1일부터)', () => {
  const r = resolvePeriodRange('12m', NOW);
  assert.equal(r.from, '2025-09-01');
  assert.equal(r.to, '2026-08-27');
});

test('resolvePeriodRange: custom은 지정값 그대로, from>to면 12m로 안전 폴백', () => {
  const ok = resolvePeriodRange('custom', NOW, { from: '2026-01-01', to: '2026-01-31' });
  assert.deepEqual(ok, { from: '2026-01-01', to: '2026-01-31' });
  const bad = resolvePeriodRange('custom', NOW, { from: '2026-02-01', to: '2026-01-01' });
  assert.equal(bad.from, '2025-09-01'); // 12m 폴백
});

test('monthsForRange: 월 경계를 걸치면 두 달 모두 포함', () => {
  assert.deepEqual(monthsForRange({ from: '2026-07-29', to: '2026-08-05' }), ['202607', '202608']);
});

test('monthsForRange: 연도 경계도 정확히 넘어간다', () => {
  assert.deepEqual(monthsForRange({ from: '2025-12-20', to: '2026-01-05' }), ['202512', '202601']);
});

test('isDateInRange: 경계값 포함', () => {
  const r = { from: '2026-08-01', to: '2026-08-31' };
  assert.equal(isDateInRange('2026-08-01', r), true);
  assert.equal(isDateInRange('2026-08-31', r), true);
  assert.equal(isDateInRange('2026-07-31', r), false);
  assert.equal(isDateInRange('2026-09-01', r), false);
});

test('identityKey: aptSeq 있으면 그것만 사용, 없으면 name+dong', () => {
  assert.equal(identityKey({ aptSeq: 'AS1', name: 'X', dong: 'Y' }), 'id:AS1');
  assert.equal(identityKey({ aptSeq: null, name: 'X', dong: 'Y' }), 'nd:X|Y');
});

test('areaKey: 소수점 정밀도를 그대로 보존(84.7855와 84.9950을 다르게 취급)', () => {
  assert.notEqual(areaKey({ excluUseArea: 84.7855 }), areaKey({ excluUseArea: 84.995 }));
  assert.equal(areaKey({ excluUseArea: null }), 'unknown');
});

test('groupKey: identity+area+dealType 조합', () => {
  const a = trade({ aptSeq: 'AS1' });
  const b = trade({ aptSeq: 'AS1', dealType: 'jeonse' });
  assert.notEqual(groupKey(a), groupKey(b));
});

test('dedupeTrades: 동일 그룹/금액/날짜/층 거래는 하나만 남긴다(달 겹침 재조회 대비)', () => {
  const t1 = trade({ uid: 'a' });
  const t2 = trade({ uid: 'b' }); // 내용은 동일, uid만 다름(중복 fetch 시나리오)
  const result = dedupeTrades([t1, t2]);
  assert.equal(result.length, 1);
});

test('dedupeTrades: 금액이 다르면 서로 다른 거래로 유지', () => {
  const t1 = trade({ uid: 'a', dealAmount: 50000 });
  const t2 = trade({ uid: 'b', dealAmount: 51000 });
  assert.equal(dedupeTrades([t1, t2]).length, 2);
});

test('filterVerifiedTrades: 취소거래 제외', () => {
  const trades = [trade({ dealCanceled: false }), trade({ dealCanceled: true })];
  assert.equal(filterVerifiedTrades(trades).length, 1);
});

test('groupTradesByDate: 날짜 내림차순, 같은 날짜 안에서는 금액 내림차순', () => {
  const trades = [
    trade({ uid: 'a', dealDate: '2026-08-25', dealAmount: 10000 }),
    trade({ uid: 'b', dealDate: '2026-08-27', dealAmount: 50000 }),
    trade({ uid: 'c', dealDate: '2026-08-27', dealAmount: 70000 }),
  ];
  const grouped = groupTradesByDate(trades);
  assert.equal(grouped[0].date, '2026-08-27');
  assert.equal(grouped[0].trades[0].uid, 'c'); // 금액 더 높은 것 먼저
  assert.equal(grouped[1].date, '2026-08-25');
});

test('annotateTrades: 신고가는 그룹 내 시간순 누적 최고가 기준(미래 거래가 과거 판정에 영향 없음), 이전 최고가가 없는 첫 거래는 신고가가 아니다', () => {
  const g = { aptSeq: 'AS1', name: 'X', dong: 'Y', excluUseArea: 84.7855, dealType: 'sale' };
  const t1 = trade({ ...g, uid: 't1', dealDate: '2026-01-01', dealAmount: 50000 });
  const t2 = trade({ ...g, uid: 't2', dealDate: '2026-03-01', dealAmount: 40000 }); // 하락, 신고가 아님
  const t3 = trade({ ...g, uid: 't3', dealDate: '2026-06-01', dealAmount: 60000 }); // 신고가
  const ann = annotateTrades([t2, t1, t3]); // 입력 순서 뒤섞여도 무관해야 함
  // [STATISTICS V2.1-2 §11/§20 버그 수정] 이전에는 첫 관측 거래(비교할 과거가
  // 없음)까지 무조건 신고가로 표시했다 — price-ranking.ts의 "이전 최고가가
  // 없으면 신고가 아님" 원칙과 어긋나는 실제 버그였다. 이제 이전 최고가가
  // 실제로 존재하고 그것을 넘어선 경우만 신고가다.
  assert.equal(ann.get('t1').isRecordHigh, false); // 이전 최고가 없음 — 신고가 아님
  assert.equal(ann.get('t2').isRecordHigh, false);
  assert.equal(ann.get('t3').isRecordHigh, true); // t1(50000)을 실제로 넘어섬
  assert.equal(ann.get('t2').previousTrade.dealAmount, 50000);
  assert.equal(ann.get('t2').changeAmount, -10000);
});

test('annotateTrades: 다른 raw area는 별도 그룹 — 84.7855와 84.9950을 섞어 비교하지 않는다', () => {
  const t1 = trade({ uid: 'a', excluUseArea: 84.7855, dealDate: '2026-01-01', dealAmount: 50000 });
  const t2 = trade({ uid: 'b', excluUseArea: 84.995, dealDate: '2026-02-01', dealAmount: 100000 });
  const ann = annotateTrades([t1, t2]);
  assert.equal(ann.get('a').previousTrade, null);
  assert.equal(ann.get('b').previousTrade, null); // 서로 다른 면적이라 비교 대상 없음
});

test('annotateTrades: 취소거래는 신고가/직전거래 계산에서 완전히 제외된다', () => {
  const g = { aptSeq: 'AS1', name: 'X', dong: 'Y', excluUseArea: 84.7855, dealType: 'sale' };
  const t1 = trade({ ...g, uid: 't1', dealDate: '2026-01-01', dealAmount: 90000, dealCanceled: true });
  const t2 = trade({ ...g, uid: 't2', dealDate: '2026-02-01', dealAmount: 50000 });
  const ann = annotateTrades([t1, t2]);
  assert.equal(ann.has('t1'), false); // 취소거래는 annotate 대상에서 제외
  assert.equal(ann.get('t2').previousTrade, null); // 취소된 t1을 직전거래로 보지 않는다
  assert.equal(ann.get('t2').isRecordHigh, false); // t1이 제외되면 t2가 이 그룹의 첫 관측 거래 — 이전 최고가 없음
});

test('annotateTrades: 직전거래가 없으면 changeAmount/changePct는 null(0으로 만들지 않음)', () => {
  const t1 = trade({ uid: 'only' });
  const ann = annotateTrades([t1]);
  assert.equal(ann.get('only').changeAmount, null);
  assert.equal(ann.get('only').changePct, null);
});

test('buildRegionSummary: 취소/신고가/상승/하락 집계', () => {
  const g = { aptSeq: 'AS1', name: 'X', dong: 'Y', excluUseArea: 84.7855, dealType: 'sale' };
  const t1 = trade({ ...g, uid: 't1', dealDate: '2026-01-01', dealAmount: 50000 });
  const t2 = trade({ ...g, uid: 't2', dealDate: '2026-02-01', dealAmount: 40000 }); // 하락
  const t3 = trade({ ...g, uid: 't3', dealDate: '2026-03-01', dealAmount: 90000 }); // 상승+신고가
  const cancelled = trade({ uid: 'c1', dealCanceled: true });
  const all = [t1, t2, t3, cancelled];
  const ann = annotateTrades(all);
  const summary = buildRegionSummary(all, ann);
  assert.equal(summary.totalCount, 4);
  assert.equal(summary.verifiedCount, 3);
  assert.equal(summary.cancelledCount, 1);
  assert.equal(summary.recordHighCount, 1); // t3만(t1은 이전 최고가가 없어 신고가 아님)
  assert.equal(summary.riseCount, 1);
  assert.equal(summary.fallCount, 1);
  assert.equal(summary.byDealType.sale, 3);
});

test('buildMarketInterpretation: 표본이 너무 적으면 문장을 만들지 않는다(과잉해석 방지)', () => {
  const summary = { totalCount: 2, verifiedCount: 2, cancelledCount: 0, recordHighCount: 1, riseCount: 0, fallCount: 0, byDealType: { sale: 2, jeonse: 0, wolse: 0 } };
  const lines = buildMarketInterpretation({
    periodLabel: '최근 7일', periodDays: 7, summary, lookbackVerifiedCount: 100, lookbackDays: 365, dongCounts: {}, areaBandCounts: {}, recordHighCoverageLabel: '1년',
  });
  assert.deepEqual(lines, []);
});

test('buildMarketInterpretation: 단정적 표현("확정", "적기", "급등") 없이 사실 기반 문장만 생성', () => {
  const summary = { totalCount: 10, verifiedCount: 10, cancelledCount: 0, recordHighCount: 4, riseCount: 5, fallCount: 1, byDealType: { sale: 10, jeonse: 0, wolse: 0 } };
  const lines = buildMarketInterpretation({
    periodLabel: '최근 7일',
    periodDays: 7,
    summary,
    lookbackVerifiedCount: 120,
    lookbackDays: 365,
    dongCounts: { 서대신동: 8, 부민동: 2 },
    areaBandCounts: { '80~90': 6, '100~110': 4 },
    recordHighCoverageLabel: '1년',
  });
  const joined = lines.join(' ');
  for (const banned of ['확정', '적기', '급등']) assert.equal(joined.includes(banned), false);
  // [§11/§20] "신고가"라는 무제한 단어를 단독으로 쓰지 않고 실제 조회 범위를 밝힌다.
  assert.ok(lines.some((l) => l.includes('최근 1년 최고가 거래가 4건')));
  assert.ok(lines.some((l) => l.includes('서대신동 거래가 집중')));
  assert.ok(lines.some((l) => l.includes('80~90㎡')));
  assert.ok(lines.some((l) => l.includes('상승 거래 5건, 하락 거래 1건')));
});

test('areaBandLabel: 10㎡ 단위로 묶는다(특정 평형 단정 없음)', () => {
  assert.equal(areaBandLabel(84.7855), '80~90');
  assert.equal(areaBandLabel(101.2), '100~110');
  assert.equal(areaBandLabel(null), null);
  assert.equal(areaBandLabel(NaN), null);
});

test('windowCoverageLabel: 60일 이하는 일수로, 그 이상은 개월/년 단위로 정직하게 표기(과대 주장 금지)', () => {
  assert.equal(windowCoverageLabel('2026-08-21', '2026-08-27'), '7일');
  assert.equal(windowCoverageLabel('2026-07-29', '2026-08-27'), '30일');
  assert.equal(windowCoverageLabel('2025-09-01', '2026-08-27'), '1년'); // 12개월 배수 -> 년 단위
  assert.equal(windowCoverageLabel('2024-08-27', '2026-08-27'), '2년'); // 24개월 배수 -> 년 단위
});

test('previousPeriodRange: 같은 길이의 바로 직전 기간(끊김/겹침 없음)', () => {
  const r = previousPeriodRange({ from: '2026-08-01', to: '2026-08-30' }); // 30일
  assert.equal(r.from, '2026-07-02');
  assert.equal(r.to, '2026-07-31');
});

test('previousPeriodRange: 하루짜리 기간(오늘)도 하루짜리 직전 기간', () => {
  const r = previousPeriodRange({ from: '2026-08-27', to: '2026-08-27' });
  assert.equal(r.from, '2026-08-26');
  assert.equal(r.to, '2026-08-26');
});

test('toFeedTrade: 에러 placeholder/dealAmount 없는 항목은 null(feed와 거래집중이 동일 규칙 공유)', () => {
  assert.equal(toFeedTrade({ typeLabel: '에러' }, 'sale', '26140'), null);
  assert.equal(toFeedTrade({ dealAmount: 0 }, 'sale', '26140'), null);
  const ok = toFeedTrade({ id: 'x1', aptSeq: 'AS1', name: 'X', dong: 'Y', dealAmount: 50000, excluUseArea: 84.7855, floorRaw: 5, dealDate: '2026-08-01' }, 'sale', '26140');
  assert.equal(ok.uid, 'x1');
  assert.equal(ok.lawdCd, '26140');
});

test('buildConcentrationRanking: aptSeq 기준 단지별 정상거래 건수, 이전 기간 대비 증감', () => {
  const g = { aptSeq: 'AS1', name: '레이카운티', dong: '거제동', lawdCd: '26470', dealType: 'sale' };
  const current = [
    trade({ ...g, uid: 'c1', dealDate: '2026-08-01', dealAmount: 90000 }),
    trade({ ...g, uid: 'c2', dealDate: '2026-08-15', dealAmount: 92000 }),
    trade({ ...g, uid: 'c3', dealDate: '2026-08-20', dealAmount: 91000, dealCanceled: true }), // 취소 — 집계 제외
  ];
  const previous = [trade({ ...g, uid: 'p1', dealDate: '2026-07-05', dealAmount: 88000 })];
  const rows = buildConcentrationRanking(current, previous);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].currentCount, 2); // 취소 제외
  assert.equal(rows[0].previousCount, 1);
  assert.equal(rows[0].deltaCount, 1);
  assert.equal(rows[0].latestDealDate, '2026-08-15'); // 취소 거래는 latest 후보에서도 제외
});

test('buildConcentrationRanking: 면적과 무관하게 같은 단지(aptSeq)면 하나로 합산(단지 전체 거래건수)', () => {
  const t1 = trade({ aptSeq: 'AS1', name: 'X', dong: 'Y', excluUseArea: 59.98, uid: 'a', dealDate: '2026-08-01' });
  const t2 = trade({ aptSeq: 'AS1', name: 'X', dong: 'Y', excluUseArea: 84.7855, uid: 'b', dealDate: '2026-08-02' });
  const rows = buildConcentrationRanking([t1, t2], []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].currentCount, 2);
});

test('annotateTrades: recentTrend은 같은 그룹의 시간순 최근 거래(자기 포함) 최대 5건, 표본이 3건 미만이면 호출부가 숨길 수 있도록 그대로 짧게 반환', () => {
  const g = { aptSeq: 'AS1', name: 'X', dong: 'Y', excluUseArea: 84.7855, dealType: 'sale' };
  const t1 = trade({ ...g, uid: 't1', dealDate: '2026-01-01', dealAmount: 50000 });
  const t2 = trade({ ...g, uid: 't2', dealDate: '2026-02-01', dealAmount: 52000 });
  const ann = annotateTrades([t1, t2]);
  assert.equal(ann.get('t1').recentTrend.length, 1);
  assert.equal(ann.get('t2').recentTrend.length, 2);
  const t3 = trade({ ...g, uid: 't3', dealDate: '2026-03-01', dealAmount: 51000 });
  const t4 = trade({ ...g, uid: 't4', dealDate: '2026-04-01', dealAmount: 53000 });
  const t5 = trade({ ...g, uid: 't5', dealDate: '2026-05-01', dealAmount: 54000 });
  const t6 = trade({ ...g, uid: 't6', dealDate: '2026-06-01', dealAmount: 55000 });
  const ann2 = annotateTrades([t1, t2, t3, t4, t5, t6]);
  assert.equal(ann2.get('t6').recentTrend.length, 5); // 최대 5건까지만(미래 leakage 없이 자기까지)
  assert.equal(ann2.get('t6').recentTrend[0].dealAmount, 52000); // t2~t6
});
