import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDetailMapUrl, buildDetailCompareUrl } from './registry';

// DECISION_JOURNEY_V1.1 — Map/Compare deep link builders must preserve aptSeq when given,
// and must never drop lawdCd/dong/name (the existing composite fallback identity).

test('buildDetailMapUrl: aptSeq가 있으면 쿼리에 포함된다(우선순위는 parseMapStateFromSearchParams가 처리)', () => {
  const url = buildDetailMapUrl({ lawdCd: '26140', dong: '서대신동2가', name: '대신해모로센트럴아파트', aptSeq: '26140-1234' });
  const qs = new URLSearchParams(url.split('?')[1]);
  assert.equal(qs.get('aptSeq'), '26140-1234');
  assert.equal(qs.get('dong'), '서대신동2가');
  assert.equal(qs.get('name'), '대신해모로센트럴아파트');
  assert.equal(qs.get('lawdCd'), '26140');
});

test('buildDetailMapUrl: aptSeq가 없으면(모호/미확보) 쿼리에서 aptSeq가 빠지고 dong/name만 남는다', () => {
  const url = buildDetailMapUrl({ lawdCd: '26140', dong: '서대신동2가', name: '대신해모로센트럴아파트' });
  const qs = new URLSearchParams(url.split('?')[1]);
  assert.equal(qs.has('aptSeq'), false);
  assert.equal(qs.get('dong'), '서대신동2가');
});

test('buildDetailCompareUrl: aptSeq가 있으면 쿼리에 포함된다(COMPARE_V2_PHASE2 — compare-v2/url.ts와 동일 계약)', () => {
  const url = buildDetailCompareUrl({ name: '대신해모로센트럴아파트', lawdCd: '26140', dong: '서대신동2가', aptSeq: '26140-1234' });
  const qs = new URLSearchParams(url.split('?')[1]);
  assert.equal(qs.get('aptSeq'), '26140-1234');
  assert.equal(qs.get('aName'), '대신해모로센트럴아파트');
  assert.equal(qs.get('aLawdCd'), '26140');
  assert.equal(qs.get('aDong'), '서대신동2가');
});

test('buildDetailCompareUrl: aptSeq가 없으면 aptSeq 없이 name/lawdCd/dong만으로도 동작한다', () => {
  const url = buildDetailCompareUrl({ name: '대신해모로센트럴아파트', lawdCd: '26140', dong: '서대신동2가' });
  const qs = new URLSearchParams(url.split('?')[1]);
  assert.equal(qs.has('aptSeq'), false);
  assert.equal(qs.get('aName'), '대신해모로센트럴아파트');
});
