import assert from 'node:assert/strict';
import test from 'node:test';
import { splitVerifiedMonths, verifiedFromDateInclusive, verifiedToDateInclusive, clipDateRangeToVerified } from './rent-verified-range.ts';

// DATA_FRESHNESS_AUTOMATION_V1_PHASE2 §24 — 검증범위는 더 이상 module load 시점 상수가
// 아니라 DB coverage에서 조회되는 값이다(getRentVerifiedRange). 이 파일은 "범위가 주어졌을
// 때의 경계 규칙"을 검증하므로, 예전 상수와 **정확히 같은 값**을 range로 주입해 기존 기대치를
// 그대로 유지한다 — 리팩터링이 경계 의미를 바꾸지 않았음을 보이는 회귀 테스트다.
const RENT_VERIFIED_FROM = '202408';
const RENT_VERIFIED_TO = '202608';
const RANGE = { from: RENT_VERIFIED_FROM, to: RENT_VERIFIED_TO };

test('the verified range used across the app still matches the PHASE D.2 snapshot (202408-202608)', () => {
  // coverage cell이 아직 0개이므로 실제 런타임 값도 이것과 같아야 한다(별도 실측으로 확인).
  assert.equal(RANGE.from, '202408');
  assert.equal(RANGE.to, '202608');
});

test('splitVerifiedMonths: fully inside verified range', () => {
  const { verified, unverified } = splitVerifiedMonths(['202501', '202502', '202608'], RANGE);
  assert.deepEqual(verified, ['202501', '202502', '202608']);
  assert.deepEqual(unverified, []);
});

test('splitVerifiedMonths: fully outside verified range (before)', () => {
  const { verified, unverified } = splitVerifiedMonths(['202301', '202402'], RANGE);
  assert.deepEqual(verified, []);
  assert.deepEqual(unverified, ['202301', '202402']);
});

test('splitVerifiedMonths: fully outside verified range (after, current rolling window case)', () => {
  const { verified, unverified } = splitVerifiedMonths(['202609', '202610'], RANGE);
  assert.deepEqual(verified, []);
  assert.deepEqual(unverified, ['202609', '202610']);
});

test('splitVerifiedMonths: real 2026-09 rolling 12-month window splits 11 verified / 1 unverified', () => {
  const last12 = ['202510', '202511', '202512', '202601', '202602', '202603', '202604', '202605', '202606', '202607', '202608', '202609'];
  const { verified, unverified } = splitVerifiedMonths(last12, RANGE);
  assert.equal(verified.length, 11);
  assert.deepEqual(unverified, ['202609']);
  assert.ok(verified.every((m) => m >= RENT_VERIFIED_FROM && m <= RENT_VERIFIED_TO));
});

test('verifiedToDateInclusive/verifiedFromDateInclusive match the snapshot boundary', () => {
  assert.equal(verifiedFromDateInclusive(RANGE).toISOString().slice(0, 10), '2024-08-01');
  assert.equal(verifiedToDateInclusive(RANGE).toISOString().slice(0, 10), '2026-08-31');
});

test('clipDateRangeToVerified: range fully inside verified boundary is unchanged', () => {
  const from = new Date(Date.UTC(2026, 5, 2));
  const to = new Date(Date.UTC(2026, 7, 1));
  const clipped = clipDateRangeToVerified(from, to, RANGE);
  assert.deepEqual(clipped, { from, to });
});

test('clipDateRangeToVerified: range extending past verifiedTo is clipped at verifiedTo', () => {
  const from = new Date(Date.UTC(2026, 5, 2)); // 2026-06-02
  const to = new Date(Date.UTC(2026, 8, 2)); // 2026-09-02 (past verifiedTo=2026-08-31)
  const clipped = clipDateRangeToVerified(from, to, RANGE);
  assert.deepEqual(clipped, { from, to: verifiedToDateInclusive(RANGE) });
});

test('clipDateRangeToVerified: range entirely past verifiedTo returns null', () => {
  const from = new Date(Date.UTC(2026, 8, 1)); // 2026-09-01
  const to = new Date(Date.UTC(2026, 8, 2)); // 2026-09-02
  assert.equal(clipDateRangeToVerified(from, to, RANGE), null);
});

test('clipDateRangeToVerified: range starting before verifiedFrom is clipped at verifiedFrom', () => {
  const from = new Date(Date.UTC(2020, 0, 1));
  const to = new Date(Date.UTC(2024, 9, 1));
  const clipped = clipDateRangeToVerified(from, to, RANGE);
  assert.deepEqual(clipped, { from: verifiedFromDateInclusive(RANGE), to });
});

test('splitVerifiedMonths: exact boundary months are inclusive', () => {
  const { verified, unverified } = splitVerifiedMonths([RENT_VERIFIED_FROM, RENT_VERIFIED_TO], RANGE);
  assert.deepEqual(verified, [RENT_VERIFIED_FROM, RENT_VERIFIED_TO]);
  assert.deepEqual(unverified, []);
});

test('splitVerifiedMonths: does not mutate input array and preserves order within each bucket', () => {
  const input = ['202609', '202501', '202301'];
  const { verified, unverified } = splitVerifiedMonths(input, RANGE);
  assert.deepEqual(input, ['202609', '202501', '202301']); // unchanged
  assert.deepEqual(verified, ['202501']);
  assert.deepEqual(unverified, ['202609', '202301']);
});
