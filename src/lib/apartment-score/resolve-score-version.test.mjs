import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDisplayedScoreVersion } from './resolve-score-version.ts';

test('resolveDisplayedScoreVersion: v2가 있으면 v2 버전을 보고한다(실제로 화면에 v2가 표시되므로)', () => {
  assert.equal(resolveDisplayedScoreVersion('EJIP_SCORE_V2_1', 'EJIP_SCORE_V1_BETA'), 'EJIP_SCORE_V2_1');
});

test('resolveDisplayedScoreVersion: v2가 없으면(계산 실패 등) v1 버전으로 폴백한다', () => {
  assert.equal(resolveDisplayedScoreVersion(null, 'EJIP_SCORE_V1_BETA'), 'EJIP_SCORE_V1_BETA');
  assert.equal(resolveDisplayedScoreVersion(undefined, 'EJIP_SCORE_V1_BETA'), 'EJIP_SCORE_V1_BETA');
});

test('resolveDisplayedScoreVersion: 둘 다 없으면 null', () => {
  assert.equal(resolveDisplayedScoreVersion(null, null), null);
});
