import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveArea84PriceFields, isInArea84Band, AREA84_BAND_MIN, AREA84_BAND_MAX } from './area84-pure.ts';

// ── AREA84 exact-area rule (PERFORMANCE_V1_1_B §5 — raw area, no rounding) ──
test('area84 band: 84.0000 lower bound is inside (inclusive)', () => {
  assert.equal(isInArea84Band(84), true);
  assert.equal(isInArea84Band(84.0001), true);
});
test('area84 band: 85.0000 upper bound is excluded (exclusive)', () => {
  assert.equal(isInArea84Band(85), false);
  assert.equal(isInArea84Band(84.9999), true);
});
test('area84 band: below 84 or null are excluded', () => {
  assert.equal(isInArea84Band(83.9999), false);
  assert.equal(isInArea84Band(null), false);
});
test('area84 band constants match the documented 84~85 range', () => {
  assert.equal(AREA84_BAND_MIN, 84);
  assert.equal(AREA84_BAND_MAX, 85);
});

// ── deriveArea84PriceFields (shared by JS path and SQL-pushdown path) ──────
test('deriveArea84PriceFields: no priorHigh (first-ever trade in group) -> current amount is its own 2y high', () => {
  const d = deriveArea84PriceFields(50000, null, null);
  assert.equal(d.recent2yHighAmount, 50000);
  assert.equal(d.isRecent2yHigh, true);
  assert.equal(d.recent2yHighDeltaPct, null);
});

test('deriveArea84PriceFields: priorHigh lower than current -> current is the new 2y high', () => {
  const d = deriveArea84PriceFields(60000, 50000, null);
  assert.equal(d.recent2yHighAmount, 60000);
  assert.equal(d.isRecent2yHigh, true);
  assert.equal(d.recent2yHighDeltaPct, null);
});

test('deriveArea84PriceFields: priorHigh higher than current -> not a 2y high, delta is negative', () => {
  const d = deriveArea84PriceFields(45000, 50000, null);
  assert.equal(d.recent2yHighAmount, 50000);
  assert.equal(d.isRecent2yHigh, false);
  assert.equal(d.recent2yHighDeltaPct, -10); // (45000-50000)/50000*100 = -10
});

test('deriveArea84PriceFields: no immediatePrior -> previous/change fields are all null', () => {
  const d = deriveArea84PriceFields(50000, null, null);
  assert.equal(d.previousAmount, null);
  assert.equal(d.previousDate, null);
  assert.equal(d.changeAmount, null);
  assert.equal(d.changePct, null);
});

test('deriveArea84PriceFields: immediatePrior present -> change fields computed from it, not from priorHigh', () => {
  const d = deriveArea84PriceFields(55000, 60000, { amount: 53000, date: '2026-08-01' });
  assert.equal(d.previousAmount, 53000);
  assert.equal(d.previousDate, '2026-08-01');
  assert.equal(d.changeAmount, 2000);
  assert.equal(d.changePct, 3.8); // round((55000-53000)/53000*1000)/10
});

test('deriveArea84PriceFields: immediatePrior amount is 0 -> changePct stays null (no division by zero)', () => {
  const d = deriveArea84PriceFields(50000, null, { amount: 0, date: '2026-08-01' });
  assert.equal(d.changeAmount, 50000);
  assert.equal(d.changePct, null);
});

test('deriveArea84PriceFields: priorHigh exactly equal to current -> current counts as the 2y high (strict > only)', () => {
  const d = deriveArea84PriceFields(50000, 50000, null);
  assert.equal(d.recent2yHighAmount, 50000);
  assert.equal(d.isRecent2yHigh, true);
});
