// OFFICETEL_V1 STEP 4B §22 — 검색 랭킹/빈이름 표시 순수 로직 테스트.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeOfficetelSearchKeyword,
  normalizeOfficetelSearchName,
  rankOfficetelMatches,
} from './search-contract.ts';
import { officetelFallbackDisplayName } from './detail-contract.ts';

const row = (name, umd = '우동', jibun = '1435-3') => ({
  officetelName: name,
  normalizedName: name.replace(/\s+/g, '').toLowerCase().replace(/오피스텔$/, ''),
  normalizedUmdNm: umd,
  normalizedJibun: jibun,
  roadAddress: null,
});

// ── §3 EMPTY-NAME POLICY ───────────────────────────────────────────────
test('이름이 있으면 그대로 쓴다', () => {
  assert.equal(officetelFallbackDisplayName({ officetelName: '한일오르듀', umdNm: '우동', jibun: '1435-3' }), '한일오르듀');
});

test('이름이 비면 "법정동 지번 오피스텔"로 표시한다(건물명을 지어내지 않는다)', () => {
  assert.equal(officetelFallbackDisplayName({ officetelName: '', umdNm: '전포동', jibun: '897-0' }), '전포동 897-0 오피스텔');
  assert.equal(officetelFallbackDisplayName({ officetelName: '   ', umdNm: '전포동', jibun: '897-0' }), '전포동 897-0 오피스텔');
  assert.equal(officetelFallbackDisplayName({ officetelName: null, umdNm: '온천동', jibun: '153-8' }), '온천동 153-8 오피스텔');
});

test('주소마저 없으면 최소 라벨만 준다 — 없는 정보를 만들지 않는다', () => {
  assert.equal(officetelFallbackDisplayName({ officetelName: '', umdNm: '', jibun: '' }), '오피스텔');
  assert.equal(officetelFallbackDisplayName({ officetelName: null, umdNm: '전포동', jibun: null }), '전포동 오피스텔');
});

// ── 검색어 정규화 ───────────────────────────────────────────────────────
test('검색어는 공백 제거 + 소문자화', () => {
  assert.equal(normalizeOfficetelSearchKeyword(' 한일 오르듀 '), '한일오르듀');
  assert.equal(normalizeOfficetelSearchKeyword('ABC Tower'), 'abctower');
});

test('후행 "오피스텔"은 이름 비교에서 제거된다', () => {
  assert.equal(normalizeOfficetelSearchName('센트렐 오피스텔'), '센트렐');
  assert.equal(normalizeOfficetelSearchName('센트렐'), '센트렐');
});

// ── §2 랭킹 ────────────────────────────────────────────────────────────
test('완전일치가 부분일치보다 항상 위에 온다', () => {
  const rows = [row('센트렐타워'), row('센트렐'), row('뉴센트렐빌')];
  const ranked = rankOfficetelMatches(rows, '센트렐', 10);
  assert.equal(ranked[0].officetelName, '센트렐');
});

test('접두 일치가 중간 부분일치보다 위에 온다', () => {
  const rows = [row('뉴센트렐빌'), row('센트렐타워')];
  const ranked = rankOfficetelMatches(rows, '센트렐', 10);
  assert.equal(ranked[0].officetelName, '센트렐타워');
});

test('"센트렐 오피스텔"로 검색해도 "센트렐오피스텔"을 완전일치로 잡는다', () => {
  const rows = [row('다른건물'), row('센트렐오피스텔')];
  const ranked = rankOfficetelMatches(rows, '센트렐 오피스텔', 10);
  assert.equal(ranked[0].officetelName, '센트렐오피스텔');
});

test('이름이 안 맞고 주소만 맞는 후보는 가장 뒤(tier 3)', () => {
  const nameHit = row('우동타워', '좌동', '1-1');
  const addrOnly = row('전혀다른이름', '우동', '1435-3');
  const ranked = rankOfficetelMatches([addrOnly, nameHit], '우동', 10);
  assert.equal(ranked[0].officetelName, '우동타워');
  assert.equal(ranked[1].officetelName, '전혀다른이름');
});

test('limit을 넘지 않는다', () => {
  const rows = Array.from({ length: 30 }, (_, i) => row(`센트렐${i}`));
  assert.equal(rankOfficetelMatches(rows, '센트렐', 8).length, 8);
});

test('같은 입력이면 항상 같은 순서(결정적)', () => {
  const rows = [row('가나'), row('가나'), row('가나다')];
  const a = rankOfficetelMatches(rows, '가나', 10).map((r) => r.officetelName);
  const b = rankOfficetelMatches(rows, '가나', 10).map((r) => r.officetelName);
  assert.deepEqual(a, b);
});

test('빈 검색어는 결과 없음', () => {
  assert.deepEqual(rankOfficetelMatches([row('센트렐')], '', 10), []);
  assert.deepEqual(rankOfficetelMatches([row('센트렐')], '   ', 10), []);
});

test('이름이 빈 master도 주소 매칭으로 검색된다(tier 3)', () => {
  const blank = { officetelName: '', normalizedName: '', normalizedUmdNm: '전포동', normalizedJibun: '897-0', roadAddress: null };
  const ranked = rankOfficetelMatches([blank], '전포동', 10);
  assert.equal(ranked.length, 1);
  assert.equal(officetelFallbackDisplayName({ officetelName: ranked[0].officetelName, umdNm: '전포동', jibun: '897-0' }), '전포동 897-0 오피스텔');
});
