import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMatchConfidence, findBestCandidate, levenshtein } from './matching';
import type { MatchCandidateInput } from './matching';

function candidate(overrides: Partial<MatchCandidateInput> = {}): MatchCandidateInput {
  return {
    sido: '부산광역시',
    sigungu: '서구',
    normalizedName: '서대신4',
    businessType: 'REDEVELOPMENT',
    householdCount: 542,
    ...overrides,
  };
}

test('levenshtein — 기본 동작', () => {
  assert.equal(levenshtein('abc', 'abc'), 0);
  assert.equal(levenshtein('abc', 'abd'), 1);
  assert.equal(levenshtein('', 'abc'), 3);
});

test('EXACT — sido+sigungu+normalizedName+businessType 전부 일치(서대신4 사례)', () => {
  const incoming = candidate();
  assert.equal(computeMatchConfidence(incoming, candidate()), 'EXACT');
});

test('HIGH — 이름/지역 일치하지만 한쪽 businessType이 UNKNOWN', () => {
  const incoming = candidate({ businessType: 'UNKNOWN' });
  assert.equal(computeMatchConfidence(incoming, candidate()), 'HIGH');
});

test('LOW — 이름/지역 일치하지만 businessType이 서로 다른 known 값(거제2 재개발 vs 재건축 패턴)', () => {
  const incoming = candidate({ businessType: 'RECONSTRUCTION' });
  assert.equal(computeMatchConfidence(incoming, candidate({ businessType: 'REDEVELOPMENT' })), 'LOW');
});

test('MEDIUM — 이름 유사 + 시군구 일치 + 세대수 10% 이내', () => {
  const incoming = candidate({ normalizedName: '서대신4가', householdCount: 560 });
  assert.equal(computeMatchConfidence(incoming, candidate()), 'MEDIUM');
});

test('LOW — 이름 유사하지만 세대수 근거 없음(자동 merge 금지)', () => {
  const incoming = candidate({ normalizedName: '서대신4가', householdCount: null });
  assert.equal(computeMatchConfidence(incoming, candidate()), 'LOW');
});

test('EXACT — 부산 areaName이 유형 접미사를 포함해도(실물 데이터: "서대신4 재개발") 접미사 없는 MOLIT 이름과 매칭된다(R4.1 회귀 테스트)', () => {
  const molit = candidate({ normalizedName: '서대신4', businessType: 'REDEVELOPMENT' });
  const busan = candidate({ normalizedName: '서대신4재개발', businessType: 'REDEVELOPMENT' });
  assert.equal(computeMatchConfidence(busan, molit), 'EXACT');
});

test('LOW — 접미사를 떼면 이름이 같아져도 businessType이 다르면 여전히 강등(거제2 패턴 회귀 유지)', () => {
  const a = candidate({ normalizedName: '거2재개발', businessType: 'REDEVELOPMENT' });
  const b = candidate({ normalizedName: '거2재건축', businessType: 'RECONSTRUCTION' });
  assert.equal(computeMatchConfidence(a, b), 'LOW');
});

test('UNMATCHED — 시도 자체가 다름', () => {
  const incoming = candidate({ sido: '서울특별시' });
  assert.equal(computeMatchConfidence(incoming, candidate()), 'UNMATCHED');
});

test('UNMATCHED — 촉진5(금정구) vs 촉진5(영도구) — 동명이인은 sigungu가 갈라야 한다', () => {
  const incoming = candidate({ sido: '부산광역시', sigungu: '금정구', normalizedName: '촉진5' });
  const other = candidate({ sido: '부산광역시', sigungu: '영도구', normalizedName: '촉진5' });
  const result = computeMatchConfidence(incoming, other);
  assert.notEqual(result, 'EXACT');
  assert.notEqual(result, 'HIGH');
});

test('findBestCandidate — 여러 후보 중 가장 높은 confidence를 고른다', () => {
  const incoming = candidate();
  const candidates = [
    candidate({ businessType: 'UNKNOWN' }), // HIGH
    candidate(), // EXACT
    candidate({ sido: '서울특별시' }), // UNMATCHED — 제외
  ];
  const best = findBestCandidate(incoming, candidates);
  assert.equal(best?.confidence, 'EXACT');
});

test('findBestCandidate — 전부 UNMATCHED면 null', () => {
  const incoming = candidate();
  const result = findBestCandidate(incoming, [candidate({ sido: '서울특별시' })]);
  assert.equal(result, null);
});
