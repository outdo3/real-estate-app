import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCompareUrl, parseCompareUrl } from './url';

test('buildCompareUrl → parseCompareUrl: 2개 슬롯 왕복 시 aptSeq/identity가 그대로 복원된다', () => {
  const a = { name: '대신해모로센트럴아파트', lawdCd: '26140', dong: '서대신동2가', aptSeq: '26140-1356' };
  const b = { name: '대신더샵', lawdCd: '26140', dong: '대신동', aptSeq: '26140-2000' };
  const url = buildCompareUrl(a, b);
  const qs = new URLSearchParams(url.split('?')[1]);
  const parsed = parseCompareUrl(qs);
  assert.deepEqual(parsed.a, a);
  assert.deepEqual(parsed.b, b);
});

test('buildCompareUrl: aptSeq 없는 슬롯도 name/lawdCd/dong만으로 URL을 만든다(name-only 아님 — lawdCd/dong 항상 동반)', () => {
  const a = { name: '경동', lawdCd: '26350', dong: '우동' };
  const url = buildCompareUrl(a);
  const qs = new URLSearchParams(url.split('?')[1]);
  assert.equal(qs.has('aptSeq'), false);
  assert.equal(qs.get('aLawdCd'), '26350');
  assert.equal(qs.get('aDong'), '우동');
});

test('parseCompareUrl: 빈 쿼리에서는 아무 슬롯도 복원하지 않는다', () => {
  const parsed = parseCompareUrl(new URLSearchParams());
  assert.equal(parsed.a, undefined);
  assert.equal(parsed.b, undefined);
});
