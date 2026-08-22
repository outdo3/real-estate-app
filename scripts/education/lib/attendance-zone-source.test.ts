import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseZoneSchoolNameTokens, parseLinkageCsv } from './attendance-zone-source';

test('parseZoneSchoolNameTokens: single zone -> one token', () => {
  assert.deepEqual(parseZoneSchoolNameTokens('장림초통학구역'), ['장림초']);
});

test('parseZoneSchoolNameTokens: symmetric shared zone -> two tokens in name order', () => {
  assert.deepEqual(parseZoneSchoolNameTokens('만덕초상학초공동통학구역'), ['만덕초', '상학초']);
});

test('parseZoneSchoolNameTokens: asymmetric(일방) shared zone -> three tokens, first is the zone-owning(큰) school', () => {
  assert.deepEqual(parseZoneSchoolNameTokens('온천초공덕초금성초공동(일방)통학구역'), ['온천초', '공덕초', '금성초']);
});

test('parseZoneSchoolNameTokens: middle school group name has no 초/중/고 token pattern to split cleanly -> returns whole stripped string', () => {
  const tokens = parseZoneSchoolNameTokens('9학교군');
  assert.equal(tokens.length, 1);
});

test('parseLinkageCsv: parses EUC-KR encoded fields correctly', () => {
  const sampleLine = Buffer.concat([
    Buffer.from('학구ID,학교ID,학교명,학교급구분,시도교육청코드,시도교육청명,교육지원청코드,교육지원청명,데이터기준일자\r\n', 'binary'),
    Buffer.from('Z000100598,B000002463,', 'ascii'),
    require('iconv-lite').encode('장림초등학교', 'euc-kr'),
    Buffer.from(',', 'ascii'),
    require('iconv-lite').encode('초등학교', 'euc-kr'),
    Buffer.from(',7150000,', 'ascii'),
    require('iconv-lite').encode('부산광역시교육청', 'euc-kr'),
    Buffer.from(',7171000,', 'ascii'),
    require('iconv-lite').encode('부산광역시서부교육지원청', 'euc-kr'),
    Buffer.from(',2026-03-20\n', 'ascii'),
  ]);
  const rows = parseLinkageCsv(sampleLine);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].zoneId, 'Z000100598');
  assert.equal(rows[0].schoolId, 'B000002463');
  assert.equal(rows[0].schoolName, '장림초등학교');
  assert.equal(rows[0].schoolLevelRaw, '초등학교');
  assert.equal(rows[0].eduOfficeName, '부산광역시서부교육지원청');
});

test('parseLinkageCsv: skips malformed lines with too few columns', () => {
  const raw = Buffer.from('header\r\nonly,two,cols\n', 'ascii');
  const rows = parseLinkageCsv(raw);
  assert.equal(rows.length, 0);
});

test('parseLinkageCsv: skips empty trailing lines', () => {
  const raw = Buffer.concat([
    Buffer.from('h1,h2,h3,h4,h5,h6,h7,h8,h9\r\n', 'ascii'),
    Buffer.from('a,b,c,d,e,f,g,h,i\r\n\r\n', 'ascii'),
  ]);
  const rows = parseLinkageCsv(raw);
  assert.equal(rows.length, 1);
});
