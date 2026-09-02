import assert from 'node:assert/strict';
import test from 'node:test';
import { splitVerifiedMonths, RENT_VERIFIED_FROM, RENT_VERIFIED_TO } from './rent-verified-range.ts';

test('RENT_VERIFIED_FROM/TO match the PHASE C snapshot exactly', () => {
  assert.equal(RENT_VERIFIED_FROM, '202408');
  assert.equal(RENT_VERIFIED_TO, '202607');
});

test('splitVerifiedMonths: fully inside verified range', () => {
  const { verified, unverified } = splitVerifiedMonths(['202501', '202502', '202607']);
  assert.deepEqual(verified, ['202501', '202502', '202607']);
  assert.deepEqual(unverified, []);
});

test('splitVerifiedMonths: fully outside verified range (before)', () => {
  const { verified, unverified } = splitVerifiedMonths(['202301', '202402']);
  assert.deepEqual(verified, []);
  assert.deepEqual(unverified, ['202301', '202402']);
});

test('splitVerifiedMonths: fully outside verified range (after, current rolling window case)', () => {
  const { verified, unverified } = splitVerifiedMonths(['202608', '202609']);
  assert.deepEqual(verified, []);
  assert.deepEqual(unverified, ['202608', '202609']);
});

test('splitVerifiedMonths: real 2026-09 rolling 12-month window splits 10 verified / 2 unverified', () => {
  const last12 = ['202510', '202511', '202512', '202601', '202602', '202603', '202604', '202605', '202606', '202607', '202608', '202609'];
  const { verified, unverified } = splitVerifiedMonths(last12);
  assert.equal(verified.length, 10);
  assert.deepEqual(unverified, ['202608', '202609']);
  assert.ok(verified.every((m) => m >= RENT_VERIFIED_FROM && m <= RENT_VERIFIED_TO));
});

test('splitVerifiedMonths: exact boundary months are inclusive', () => {
  const { verified, unverified } = splitVerifiedMonths([RENT_VERIFIED_FROM, RENT_VERIFIED_TO]);
  assert.deepEqual(verified, [RENT_VERIFIED_FROM, RENT_VERIFIED_TO]);
  assert.deepEqual(unverified, []);
});

test('splitVerifiedMonths: does not mutate input array and preserves order within each bucket', () => {
  const input = ['202609', '202501', '202301'];
  const { verified, unverified } = splitVerifiedMonths(input);
  assert.deepEqual(input, ['202609', '202501', '202301']); // unchanged
  assert.deepEqual(verified, ['202501']);
  assert.deepEqual(unverified, ['202609', '202301']);
});
