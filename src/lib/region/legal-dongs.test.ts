import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getPublicLegalDongs } from './legal-dongs';
import { isPublicRegionAllowed } from './enablement';
import { REGION_NODES } from './registry';

test('공개 49개 시군구에서만 현존 법정동 목록을 제공한다', () => {
  const counts = { '26': 0, '11': 0, '41': 0 };
  for (const district of REGION_NODES) {
    const rows = getPublicLegalDongs(district.lawdCd);
    if (!isPublicRegionAllowed(district.lawdCd, 'app')) {
      assert.deepEqual(rows, []);
      continue;
    }
    counts[district.sidoCode as keyof typeof counts]++;
    assert.ok(rows.length > 0, district.fullName);
    assert.equal(new Set(rows.map(({ code }) => code)).size, rows.length);
    for (const { code, name } of rows) {
      assert.match(code, new RegExp(`^${district.lawdCd}\\d{5}$`));
      assert.notEqual(code, `${district.lawdCd}00000`);
      assert.ok(name.trim());
    }
  }
  assert.deepEqual(counts, { '26': 16, '11': 25, '41': 8 });
});

test('수영구 선택은 법정동 광안동 코드와 거래 검색명을 그대로 제공한다', () => {
  const rows = getPublicLegalDongs('26500');
  assert.deepEqual(rows.find(({ code }) => code === '2650010400'), { code: '2650010400', name: '광안동' });
  assert.equal(rows.length, 5);
  assert.ok(getPublicLegalDongs('26710').some(({ name }) => name === '장안읍 좌천리'));
  assert.deepEqual(getPublicLegalDongs('41135'), []);
});
