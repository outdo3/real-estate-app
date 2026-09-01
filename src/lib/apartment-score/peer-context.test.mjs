import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computePeerContext,
  percentileRank,
  confidenceFor,
  sizeBandOf,
  decadeOf,
  UNAVAILABLE_PEER_CONTEXT,
} from './peer-context-pure.ts';

// ── helpers ──────────────────────────────────────────────────────────────
function row(aptSeq, sigungu, buildYear, totalHouseholds, v2Score) {
  return { aptSeq, sigungu, buildYear, totalHouseholds, v2Score };
}
function poolOf(n, { sigungu = '부산진구', buildYear = 2015, households = 100, scoreStart = 30 } = {}) {
  return Array.from({ length: n }, (_, i) => row(`seq-${i}`, sigungu, buildYear, households, scoreStart + i));
}

// ── sizeBandOf / decadeOf (PHASE 1.6 §8 boundaries: small<50, mid 50-220, large>=221) ──
test('sizeBandOf: boundary 49/50 — 49는 small, 50은 mid', () => {
  assert.equal(sizeBandOf(49), 'small');
  assert.equal(sizeBandOf(50), 'mid');
});
test('sizeBandOf: boundary 220/221 — 220은 mid, 221은 large', () => {
  assert.equal(sizeBandOf(220), 'mid');
  assert.equal(sizeBandOf(221), 'large');
});
test('sizeBandOf: null(unknown households) → UNKNOWN', () => {
  assert.equal(sizeBandOf(null), 'UNKNOWN');
});
test('decadeOf: 2015 -> "2010s", null -> "NA"', () => {
  assert.equal(decadeOf(2015), '2010s');
  assert.equal(decadeOf(null), 'NA');
});

// ── percentileRank ───────────────────────────────────────────────────────
test('percentileRank: rank-1 of 8 (PHASE 1.6 §8 실측치 93.8 재현)', () => {
  const pool = [34, 40, 43, 45, 50, 58, 60, 65]; // rank-1 = 65 (고유 최댓값, tie 없음)
  assert.equal(percentileRank(65, pool), 93.8);
});
test('percentileRank: 자기 자신만 있는 값(중간)도 결정적으로 계산된다', () => {
  const pool = [10, 20, 30, 40, 50];
  assert.equal(percentileRank(30, pool), 50);
});
test('percentileRank: 같은 입력에 항상 같은 출력(deterministic)', () => {
  const pool = [10, 20, 30, 40, 50, 60, 70];
  const a = percentileRank(45, pool);
  const b = percentileRank(45, pool);
  assert.equal(a, b);
});

// ── confidenceFor ────────────────────────────────────────────────────────
test('confidenceFor: L1 + comparisonCount>=15 -> HIGH', () => {
  assert.equal(confidenceFor('SIGUNGU_DECADE_SIZE', 15), 'HIGH');
  assert.equal(confidenceFor('SIGUNGU_DECADE_SIZE', 48), 'HIGH');
});
test('confidenceFor: L1 8~14 -> MEDIUM', () => {
  assert.equal(confidenceFor('SIGUNGU_DECADE_SIZE', 8), 'MEDIUM');
  assert.equal(confidenceFor('SIGUNGU_DECADE_SIZE', 14), 'MEDIUM');
});
test('confidenceFor: L2 -> MEDIUM (규모 무관)', () => {
  assert.equal(confidenceFor('SIGUNGU_DECADE', 8), 'MEDIUM');
  assert.equal(confidenceFor('SIGUNGU_DECADE', 100), 'MEDIUM');
});
test('confidenceFor: L3/L4(broader fallback) -> LOW', () => {
  assert.equal(confidenceFor('DECADE_BUSAN', 200), 'LOW');
  assert.equal(confidenceFor('BUSAN_ALL', 2000), 'LOW');
});

// ── computePeerContext: level assignment (L1→L2→L3→L4) ──────────────────
test('computePeerContext: L1 pool>=8이면 SIGUNGU_DECADE_SIZE 사용', () => {
  const target = row('target', '부산진구', 2015, 100, 50);
  const pool = [target, ...poolOf(10, { sigungu: '부산진구', buildYear: 2015, households: 100 })];
  const ctx = computePeerContext(target, pool);
  assert.equal(ctx.available, true);
  assert.equal(ctx.level, 'SIGUNGU_DECADE_SIZE');
  assert.equal(ctx.basis.sizeBand, 'mid');
});

test('computePeerContext: L1<8, L2>=8이면 SIGUNGU_DECADE로 fallback', () => {
  const target = row('target', '부산진구', 2015, 100, 50);
  // L1(부산진구|2010s|mid) 후보 5개뿐 -> L1 실패. L2(부산진구|2010s, 규모 무관) 후보를
  // 다른 사이즈 밴드로 채워 8개 이상 만든다.
  const l1Only = poolOf(4, { sigungu: '부산진구', buildYear: 2015, households: 100 }); // + target = 5, <8
  const l2Extra = poolOf(6, { sigungu: '부산진구', buildYear: 2016, households: 500 }).map((r, i) => ({ ...r, aptSeq: `l2-${i}`, buildYear: 2015, totalHouseholds: 500 }));
  const pool = [target, ...l1Only, ...l2Extra];
  const ctx = computePeerContext(target, pool);
  assert.equal(ctx.available, true);
  assert.equal(ctx.level, 'SIGUNGU_DECADE');
});

test('computePeerContext: L1/L2 부족, L3(연식대 전체)로 fallback', () => {
  const target = row('target', '부산진구', 2015, 100, 50);
  const sameGuDecade = poolOf(3, { sigungu: '부산진구', buildYear: 2015, households: 100 }); // +target = 4, <8 for both L1/L2
  const otherGu = poolOf(10, { sigungu: '해운대구', buildYear: 2015, households: 300 }).map((r, i) => ({ ...r, aptSeq: `og-${i}` }));
  const pool = [target, ...sameGuDecade, ...otherGu];
  const ctx = computePeerContext(target, pool);
  assert.equal(ctx.available, true);
  assert.equal(ctx.level, 'DECADE_BUSAN');
});

test('computePeerContext: 모든 상위 fallback 부족, L4(부산 전체)로 fallback', () => {
  const target = row('target', '부산진구', 2015, 100, 50);
  const thin = poolOf(2, { sigungu: '부산진구', buildYear: 2015, households: 100 }); // +target=3
  const otherDecade = poolOf(10, { sigungu: '해운대구', buildYear: 1990, households: 300 }).map((r, i) => ({ ...r, aptSeq: `od-${i}` }));
  const pool = [target, ...thin, ...otherDecade];
  const ctx = computePeerContext(target, pool);
  assert.equal(ctx.available, true);
  assert.equal(ctx.level, 'BUSAN_ALL');
});

test('computePeerContext: L4까지도 8 미만이면 NOT_AVAILABLE — 다른 비교군으로 억지로 채우지 않는다', () => {
  const target = row('target', '부산진구', 2015, 100, 50);
  const tiny = poolOf(3, { sigungu: '부산진구', buildYear: 2015, households: 100 }); // +target=4 total, <8
  const ctx = computePeerContext(target, [target, ...tiny]);
  assert.deepEqual(ctx, UNAVAILABLE_PEER_CONTEXT);
  assert.equal(ctx.percentile, null);
  assert.equal(ctx.comparisonCount, null);
});

test('computePeerContext: comparisonCount는 self 포함, denominator<8인 경우가 없다', () => {
  const target = row('target', '부산진구', 2015, 100, 50);
  const pool = [target, ...poolOf(7, { sigungu: '부산진구', buildYear: 2015, households: 100 })]; // total 8
  const ctx = computePeerContext(target, pool);
  assert.equal(ctx.comparisonCount, 8);
  assert.ok(ctx.comparisonCount >= 8, 'percentile denominator must never be below MIN_PEER_SAMPLE');
});

test('computePeerContext: peerCount는 항상 comparisonCount - 1 (self 제외, PHASE 1.6 §13 확정)', () => {
  const target = row('target', '부산진구', 2015, 100, 50);
  const pool = [target, ...poolOf(20, { sigungu: '부산진구', buildYear: 2015, households: 100 })];
  const ctx = computePeerContext(target, pool);
  assert.equal(ctx.peerCount, ctx.comparisonCount - 1);
});

test('computePeerContext: totalHouseholds가 unknown이면 L1을 억지로 배정하지 않고 L2로 간다(§9)', () => {
  const target = row('target', '부산진구', 2015, null, 50); // households unknown
  // L1 key would be '부산진구|2010s|UNKNOWN' — even if 8+ other UNKNOWN-household rows
  // existed there, the target must still skip L1 per PHASE 2 §9's explicit requirement.
  const unknownPeers = poolOf(10, { sigungu: '부산진구', buildYear: 2015, households: null });
  const pool = [target, ...unknownPeers];
  const ctx = computePeerContext(target, pool);
  assert.notEqual(ctx.level, 'SIGUNGU_DECADE_SIZE');
  assert.equal(ctx.level, 'SIGUNGU_DECADE');
});

test('computePeerContext: basis에 sigungu/buildDecade/sizeBand가 사람이 읽을 수 있는 형태로 담긴다', () => {
  const target = row('target', '동래구', 1995, 300, 40);
  const pool = [target, ...poolOf(10, { sigungu: '동래구', buildYear: 1995, households: 300 })];
  const ctx = computePeerContext(target, pool);
  assert.equal(ctx.basis.sigungu, '동래구');
  assert.equal(ctx.basis.buildDecade, '1990s');
  assert.equal(ctx.basis.sizeBand, 'large');
});

test('computePeerContext: L2/L3/L4 fallback에서는 basis.sizeBand가 null (특정 규모로 좁혀 비교한 게 아니므로)', () => {
  const target = row('target', '부산진구', 2015, 100, 50);
  const thin = poolOf(2, { sigungu: '부산진구', buildYear: 2015, households: 100 });
  const l2Extra = poolOf(8, { sigungu: '부산진구', buildYear: 2015, households: 900 }).map((r, i) => ({ ...r, aptSeq: `l2b-${i}` }));
  const pool = [target, ...thin, ...l2Extra];
  const ctx = computePeerContext(target, pool);
  assert.equal(ctx.level, 'SIGUNGU_DECADE');
  assert.equal(ctx.basis.sizeBand, null);
});
