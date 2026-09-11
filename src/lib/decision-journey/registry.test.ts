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

// COMPARE_SHARE_URL_COMPACT_FIX_V1 §5 — aptSeq를 알면 그것 하나로 끝난다. 예전에는
// 이름·구·동을 함께 실었고, 그 형태가 그대로 공유 링크가 되어 카카오톡에서 300자짜리
// %EB%... 말풍선을 만들었다.
test('buildDetailCompareUrl: aptSeq가 있으면 a=aptSeq 하나만 들어간다(이름/동 없음)', () => {
  const url = buildDetailCompareUrl({ name: '대신해모로센트럴아파트', lawdCd: '26140', dong: '서대신동2가', aptSeq: '26140-1234' });
  assert.equal(url, '/stats/compare?a=26140-1234');
  const qs = new URLSearchParams(url.split('?')[1]);
  assert.equal(qs.get('a'), '26140-1234');
  for (const banned of ['aName', 'aLawdCd', 'aDong', 'aptSeq']) {
    assert.equal(qs.has(banned), false, `${banned}가 남아 있다`);
  }
  assert.ok(!/%[0-9A-F]{2}/i.test(url), '인코딩된 한글이 남아 있다');
});

test('buildDetailCompareUrl: aptSeq가 없으면 name/lawdCd/dong으로 복원 가능한 형태를 유지한다', () => {
  // 짧게 만들자고 열리지 않는 링크를 만들지 않는다.
  const url = buildDetailCompareUrl({ name: '대신해모로센트럴아파트', lawdCd: '26140', dong: '서대신동2가' });
  const qs = new URLSearchParams(url.split('?')[1]);
  assert.equal(qs.has('a'), false);
  assert.equal(qs.get('aName'), '대신해모로센트럴아파트');
  assert.equal(qs.get('aLawdCd'), '26140');
  assert.equal(qs.get('aDong'), '서대신동2가');
});
