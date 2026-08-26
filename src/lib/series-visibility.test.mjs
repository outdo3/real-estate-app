import assert from 'node:assert/strict';
import test from 'node:test';
import { toggleSeriesVisibility } from './series-visibility.ts';

test('toggling sale off from both-on leaves only rent visible', () => {
  assert.deepEqual(toggleSeriesVisibility({ sale: true, rent: true }, 'sale'), { sale: false, rent: true });
});

test('toggling rent off from both-on leaves only sale visible', () => {
  assert.deepEqual(toggleSeriesVisibility({ sale: true, rent: true }, 'rent'), { sale: true, rent: false });
});

test('toggling the last remaining visible series off is refused (at least one stays on)', () => {
  assert.deepEqual(toggleSeriesVisibility({ sale: false, rent: true }, 'rent'), { sale: false, rent: true });
  assert.deepEqual(toggleSeriesVisibility({ sale: true, rent: false }, 'sale'), { sale: true, rent: false });
});

test('toggling a hidden series back on restores both visible', () => {
  assert.deepEqual(toggleSeriesVisibility({ sale: false, rent: true }, 'sale'), { sale: true, rent: true });
});
