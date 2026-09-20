import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mergeMasterIntoRegistry, mergeLiveIntoRegistry, isFullyPopulated, masterApprovalYear,
} from './registry-precedence.ts';

const cache = (o = {}) => ({
  parkingCount: 962, far: 51.47, bcr: 22.31, totalHouseholds: 72, approvalDate: '1995년', ...o,
});
const master = (o = {}) => ({
  parkingCount: 962, floorAreaRatio: 51.47, buildingCoverageRatio: 22.31,
  totalHouseholds: 892, useApprovalDate: null, ...o,
});

// ── §6 A: master가 있으면 낡은 캐시 세대수를 이긴다 ──

test('A. master 세대수가 있으면 캐시의 낡은 세대수를 이긴다', () => {
  const r = mergeMasterIntoRegistry(cache({ totalHouseholds: 72 }), master({ totalHouseholds: 892 }));
  assert.equal(r.totalHouseholds, 892);
});

// ── §6 B: master가 null이면 캐시를 쓴다 (보완 9건) ──

test('B. master 세대수가 null이면 캐시 세대수를 그대로 쓴다 — 보완 케이스가 값을 잃지 않는다', () => {
  const r = mergeMasterIntoRegistry(cache({ totalHouseholds: 213 }), master({ totalHouseholds: null }));
  assert.equal(r.totalHouseholds, 213);
});

test('B-2. master row 자체가 없으면 캐시를 그대로 돌려준다', () => {
  const c = cache({ totalHouseholds: 3375 });
  assert.deepEqual(mergeMasterIntoRegistry(c, null), c);
});

// ── §6 C: 둘 다 null이면 live ──

test('C. master/캐시 둘 다 세대수가 없으면 live 값이 쓰인다', () => {
  const merged = mergeMasterIntoRegistry(cache({ totalHouseholds: null }), master({ totalHouseholds: null }));
  assert.equal(merged.totalHouseholds, null);
  assert.equal(isFullyPopulated(merged), false, '세대수가 비면 live를 불러야 한다');
  const withLive = mergeLiveIntoRegistry(merged, { parkingCount: 1, far: 1, bcr: 1, totalHouseholds: 165, approvalDate: '1990년' });
  assert.equal(withLive.totalHouseholds, 165);
});

// ── §6 D: 승인일은 캐시가 지킨다 ──

test('D. master 승인일이 null이어도 캐시의 승인일은 유지된다', () => {
  const r = mergeMasterIntoRegistry(cache({ approvalDate: '1995년' }), master({ useApprovalDate: null }));
  assert.equal(r.approvalDate, '1995년');
});

test('D-2. 캐시에 승인일이 없으면 master 원본에서 연도를 만든다', () => {
  const r = mergeMasterIntoRegistry(cache({ approvalDate: null }), master({ useApprovalDate: '19930412' }));
  assert.equal(r.approvalDate, '1993년');
});

test('D-3. 승인일 원본이 YYYYMMDD가 아니면 값을 만들지 않는다', () => {
  assert.equal(masterApprovalYear('1993'), null);
  assert.equal(masterApprovalYear(''), null);
  assert.equal(masterApprovalYear(null), null);
  assert.equal(masterApprovalYear('19930412'), '1993년');
});

// ── §6 E, F: 나머지 필드는 캐시 우선 그대로 ──

test('E. 세대수를 고쳐도 주차 총량은 캐시 값 그대로다', () => {
  const r = mergeMasterIntoRegistry(cache({ parkingCount: 962, totalHouseholds: 72 }), master({ parkingCount: 111, totalHouseholds: 892 }));
  assert.equal(r.parkingCount, 962, '주차는 캐시 우선 — master가 덮지 않는다');
  assert.equal(r.totalHouseholds, 892);
  // 세대당 주차는 화면이 재계산한다: 962/892 = 1.08 (72이던 시절 13.36이 아니다)
  assert.equal(Math.round((r.parkingCount / r.totalHouseholds) * 100) / 100, 1.08);
});

test('F. FAR/BCR은 캐시 값이 유지된다', () => {
  const r = mergeMasterIntoRegistry(cache({ far: 51.47, bcr: 22.31 }), master({ floorAreaRatio: 99, buildingCoverageRatio: 88 }));
  assert.equal(r.far, 51.47);
  assert.equal(r.bcr, 22.31);
});

test('F-2. 캐시에 없는 FAR/BCR은 master가 보충한다 — 기존 동작 유지', () => {
  const r = mergeMasterIntoRegistry(cache({ far: null, bcr: null }), master({ floorAreaRatio: 51.47, buildingCoverageRatio: 22.31 }));
  assert.equal(r.far, 51.47);
  assert.equal(r.bcr, 22.31);
});

// ── §5 실제 사례 회귀 ──

test('경동(26350-2): master 892 · 캐시 892 -> 892', () => {
  const r = mergeMasterIntoRegistry(cache({ totalHouseholds: 892 }), master({ totalHouseholds: 892 }));
  assert.equal(r.totalHouseholds, 892);
  assert.equal(r.parkingCount, 962);
  assert.equal(r.approvalDate, '1995년');
});

test('우성빌라(26350-278): master 15 · 캐시 15 -> 15', () => {
  const r = mergeMasterIntoRegistry(
    cache({ totalHouseholds: 15, parkingCount: 18, far: 28.65, bcr: 40.65, approvalDate: '1994년' }),
    master({ totalHouseholds: 15, parkingCount: 18 }));
  assert.equal(r.totalHouseholds, 15);
  assert.equal(r.parkingCount, 18);
  assert.equal(r.approvalDate, '1994년');
});

test('synthetic stale: master 892 · 캐시 72 -> 892 (이번 수정의 핵심)', () => {
  const r = mergeMasterIntoRegistry(cache({ totalHouseholds: 72 }), master({ totalHouseholds: 892 }));
  assert.equal(r.totalHouseholds, 892);
  // 캐시가 정당하게 가진 나머지는 그대로다
  assert.equal(r.parkingCount, 962);
  assert.equal(r.far, 51.47);
  assert.equal(r.bcr, 22.31);
  assert.equal(r.approvalDate, '1995년');
});

// ── isFullyPopulated: live 호출 판정은 바뀌지 않았다 ──

test('다섯 필드가 전부 차야 fully populated다', () => {
  assert.equal(isFullyPopulated(cache()), true);
  assert.equal(isFullyPopulated(cache({ totalHouseholds: null })), false);
  assert.equal(isFullyPopulated(cache({ approvalDate: null })), false);
  assert.equal(isFullyPopulated(cache({ parkingCount: null })), false);
  assert.equal(isFullyPopulated(null), false);
});

test('live는 빈 필드만 채우고 이미 있는 값을 덮지 않는다', () => {
  const r = mergeLiveIntoRegistry(cache({ far: null }), { parkingCount: 1, far: 300, bcr: 2, totalHouseholds: 3, approvalDate: '2000년' });
  assert.equal(r.far, 300, '비어 있던 필드는 live가 채운다');
  assert.equal(r.parkingCount, 962, '이미 있던 값은 유지');
  assert.equal(r.totalHouseholds, 72);
});
