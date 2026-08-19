import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveByDongName, resolveByProjectName, buildDongNameIndex } from './sigunguResolver';
import type { DongEntry } from './sigunguResolver';

// 실제 REGCODE_PROXY 응답에서 발췌한 서구 법정동(2026-08-19 조회, scripts/redevelopment/
// _results/busan_regcodes_raw.json) — 네트워크 호출 없이 순수 로직만 테스트한다.
const SEOGU_ENTRIES: DongEntry[] = [
  { code: '2614010100', sido: '부산광역시', sigungu: '서구', dongName: '동대신동1가' },
  { code: '2614010200', sido: '부산광역시', sigungu: '서구', dongName: '동대신동2가' },
  { code: '2614010300', sido: '부산광역시', sigungu: '서구', dongName: '동대신동3가' },
  { code: '2614010400', sido: '부산광역시', sigungu: '서구', dongName: '서대신동1가' },
  { code: '2614010500', sido: '부산광역시', sigungu: '서구', dongName: '서대신동2가' },
  { code: '2614010600', sido: '부산광역시', sigungu: '서구', dongName: '서대신동3가' },
  { code: '2614010900', sido: '부산광역시', sigungu: '서구', dongName: '부민동1가' },
  { code: '2614011000', sido: '부산광역시', sigungu: '서구', dongName: '부민동2가' },
  { code: '2614011100', sido: '부산광역시', sigungu: '서구', dongName: '부민동3가' },
  { code: '2614011500', sido: '부산광역시', sigungu: '서구', dongName: '아미동1가' },
  { code: '2614011600', sido: '부산광역시', sigungu: '서구', dongName: '아미동2가' },
  { code: '2614012300', sido: '부산광역시', sigungu: '서구', dongName: '남부민동' },
  // 실제 동명이인 사례(2026-08-19 조회 확인): 송정동은 해운대구/강서구 양쪽에 존재.
  { code: '2635010100', sido: '부산광역시', sigungu: '해운대구', dongName: '송정동' },
  { code: '2644010100', sido: '부산광역시', sigungu: '강서구', dongName: '송정동' },
  { code: '2635010200', sido: '부산광역시', sigungu: '동래구', dongName: '명장동' },
];

const index = buildDongNameIndex(SEOGU_ENTRIES);

test('resolveByDongName — 서대신동2가 → 서구', () => {
  const result = resolveByDongName('대영로45번길20, 3층(서대신동2가)', index);
  assert.equal(result.sigungu, '서구');
  assert.equal(result.source, 'DONG_NAME');
});

test('resolveByDongName — 부민동(2가) → 서구', () => {
  // 서구의 부민동은 공식적으로 1가/2가/3가로만 존재한다(가 접미사 없는 "부민동"
  // 단독 법정동명은 실제로 없음 — REGCODE_PROXY 실측 확인) — 그래서 "가" 접미사가
  // 붙은 실제 표기로 테스트한다.
  const result = resolveByDongName('부민동2가 123-4', index);
  assert.equal(result.sigungu, '서구');
});

test('resolveByDongName — 아미동 → 서구', () => {
  const result = resolveByDongName('아미동1가 15번지 일원', index);
  assert.equal(result.sigungu, '서구');
});

test('resolveByDongName — 동대신동 → 서구', () => {
  const result = resolveByDongName('동대신동3가 55', index);
  assert.equal(result.sigungu, '서구');
});

test('resolveByDongName — 남부민동이 부민동으로 잘못 흡수되지 않는다(긴 이름 우선)', () => {
  const result = resolveByDongName('남부민동 10번지', index);
  assert.equal(result.sigungu, '서구'); // 남부민동도 서구라 이 케이스에선 결과가 같지만
  assert.equal(result.detail, '남부민동'); // 실제 매칭된 동명이 "남부민동"이어야 한다(부민동 아님)
});

test('resolveByDongName — 동명이인(송정동: 해운대구/강서구)은 추측하지 않고 UNRESOLVED', () => {
  const result = resolveByDongName('송정동 100번지', index);
  assert.equal(result.sigungu, null);
  assert.equal(result.source, 'UNRESOLVED');
  assert.match(result.detail ?? '', /ambiguous/);
});

test('resolveByDongName — location에 아무 동 이름도 없으면 UNRESOLVED', () => {
  const result = resolveByDongName('구서중앙로 20', index);
  assert.equal(result.sigungu, null);
});

test('resolveByProjectName — "당리1" 같은 구역번호 축약형은 정식 동명과 정확히 일치할 때만 채택', () => {
  const withDangri: DongEntry[] = [...SEOGU_ENTRIES, { code: '2647010100', sido: '부산광역시', sigungu: '사하구', dongName: '당리동' }];
  const idx = buildDongNameIndex(withDangri);
  const result = resolveByProjectName('당리1 재건축', idx);
  assert.equal(result.sigungu, '사하구');
  assert.equal(result.source, 'PROJECT_NAME');
});

test('resolveByProjectName — "명서1"처럼 실제 법정동(명장동)과 글자가 다르면 추측하지 않고 UNRESOLVED', () => {
  // R3A/R2 문서에 기록된 실제 사례: "명서1"은 동래구 소재지만 실제 법정동명은
  // "명장동"이다 — "명서"+"동"="명서동"은 존재하지 않으므로 반드시 실패해야 한다.
  const result = resolveByProjectName('명서1', index);
  assert.equal(result.sigungu, null);
  assert.equal(result.source, 'UNRESOLVED');
});

test('resolveByProjectName — 괄호 설명은 제거하고 판정한다', () => {
  const withDangri: DongEntry[] = [...SEOGU_ENTRIES, { code: '2647010100', sido: '부산광역시', sigungu: '사하구', dongName: '당리동' }];
  const idx = buildDongNameIndex(withDangri);
  const result = resolveByProjectName('당리1(삼익) 재건축', idx);
  assert.equal(result.sigungu, '사하구');
});

test('resolveByProjectName — 동명 자체가 없는 areaName은 UNRESOLVED', () => {
  const result = resolveByProjectName('대성주택 소규모재건축', index);
  assert.equal(result.sigungu, null);
});
