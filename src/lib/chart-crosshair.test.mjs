import assert from 'node:assert/strict';
import test from 'node:test';
import { findNearestIndex } from './chart-crosshair.ts';

const positions = [
  { id: 0, x: 10 },
  { id: 1, x: 40 },
  { id: 2, x: 70 },
  { id: 3, x: 100 },
];

test('returns the exact id when the pointer is exactly on a point', () => {
  assert.equal(findNearestIndex(70, positions), 2);
});

test('returns the closer neighbor when the pointer is between two points', () => {
  assert.equal(findNearestIndex(50, positions), 1); // closer to 40 than 70
  assert.equal(findNearestIndex(60, positions), 2); // closer to 70 than 40
});

test('clamps to the first point when the pointer is left of the plot', () => {
  assert.equal(findNearestIndex(-100, positions), 0);
});

test('clamps to the last point when the pointer is right of the plot', () => {
  assert.equal(findNearestIndex(9999, positions), 3);
});

test('returns null for an empty position set (no data rendered yet)', () => {
  assert.equal(findNearestIndex(50, []), null);
});

test('breaks an exact-midpoint tie toward the first candidate encountered', () => {
  // 25 is equidistant between id 0 (x=10) and id 1 (x=40)
  assert.equal(findNearestIndex(25, positions), 0);
});
