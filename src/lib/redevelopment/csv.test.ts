import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from './csv';

test('parseCsv — 기본 콤마 분리', () => {
  const rows = parseCsv('a,b,c\n1,2,3\n');
  assert.deepEqual(rows, [
    ['a', 'b', 'c'],
    ['1', '2', '3'],
  ]);
});

test('parseCsv — 따옴표로 감싼 필드 안의 콤마', () => {
  const rows = parseCsv('a,b\n"1, 2",3\n');
  assert.deepEqual(rows, [
    ['a', 'b'],
    ['1, 2', '3'],
  ]);
});

test('parseCsv — 마지막 행에 개행이 없어도 파싱', () => {
  const rows = parseCsv('a,b\n1,2');
  assert.deepEqual(rows, [
    ['a', 'b'],
    ['1', '2'],
  ]);
});

test('parseCsv — 국토부 실제 헤더/행 형태', () => {
  const text = '시도,시군구,구역명칭,현 사업추진단계,사업유형,사업시행자,공급 예정 세대수\n강원특별자치도,속초시,속초중앙동,6)관리처분인가,1)재개발(주택정비),1)조합,1449\n';
  const rows = parseCsv(text);
  assert.equal(rows.length, 2);
  assert.equal(rows[1][6], '1449');
});
