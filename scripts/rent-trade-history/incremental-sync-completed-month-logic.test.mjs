import assert from 'node:assert/strict';
import test from 'node:test';
import { latestCompleteMonth, subtractMonths } from './incremental-sync-completed-month-logic.ts';

test('latestCompleteMonth: returns previous calendar month, never current', () => {
  assert.equal(latestCompleteMonth(new Date(Date.UTC(2026, 8, 2))), '202608'); // Sept 2 -> Aug
  assert.equal(latestCompleteMonth(new Date(Date.UTC(2026, 8, 30))), '202608'); // Sept 30 -> still Aug
  assert.equal(latestCompleteMonth(new Date(Date.UTC(2026, 0, 15))), '202512'); // Jan -> Dec of prior year (year rollover)
});

test('subtractMonths: basic within-year subtraction', () => {
  assert.equal(subtractMonths('202608', 1), '202607');
  assert.equal(subtractMonths('202608', 0), '202608');
});

test('subtractMonths: crosses year boundary', () => {
  assert.equal(subtractMonths('202601', 1), '202512');
  assert.equal(subtractMonths('202601', 13), '202412');
});

test('subtractMonths + latestCompleteMonth: overlap=2 range matches Phase D.2 manual sync (2026-09-02)', () => {
  const now = new Date(Date.UTC(2026, 8, 2));
  const latest = latestCompleteMonth(now);
  const from = subtractMonths(latest, 1); // overlap=2 -> 1 extra month back
  assert.equal(latest, '202608');
  assert.equal(from, '202607');
});
