import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyLocationText } from './officeDetector';

test('classifyLocationText — 층/호 패턴은 OFFICE(R3A: 조합 사무실 82% 위험)', () => {
  assert.equal(classifyLocationText('남구 수영로 26(문현동, 문현대림시티프라자 상가 208호)').locationType, 'OFFICE');
  assert.equal(classifyLocationText('대영로45번길20, 3층(서대신동2가)').locationType, 'OFFICE');
});

test('classifyLocationText — 상가/빌딩/오피스/조합/사무실 키워드는 OFFICE', () => {
  for (const text of ['서구 OO빌딩', 'OO조합 임시사무소', 'OO오피스텔 3동', '무슨무슨상가']) {
    assert.equal(classifyLocationText(text).locationType, 'OFFICE', text);
  }
});

test('classifyLocationText — 번지/일원 표현은 PROJECT_SITE + HIGH', () => {
  const result = classifyLocationText('동래구 명장동 623번지 일원');
  assert.equal(result.locationType, 'PROJECT_SITE');
  assert.equal(result.locationConfidence, 'HIGH');
});

test('classifyLocationText — 동 이름까지만 있으면 APPROXIMATE + MEDIUM', () => {
  const result = classifyLocationText('부산 서구 아미동');
  assert.equal(result.locationType, 'APPROXIMATE');
  assert.equal(result.locationConfidence, 'MEDIUM');
});

test('classifyLocationText — location 없으면 UNKNOWN(지어내지 않음)', () => {
  const result = classifyLocationText(null);
  assert.equal(result.locationType, 'UNKNOWN');
  assert.equal(result.locationConfidence, 'UNKNOWN');
});

test('classifyLocationText — office 패턴이 site 패턴보다 항상 먼저 검사된다(안전 우선)', () => {
  // 지번처럼 보여도 "호"가 붙어있으면 office 의심을 우선한다 — PROJECT_SITE로
  // 잘못 표시하지 않는 것이 이 함수의 목적(R3B office 좌표 처리 전략).
  const result = classifyLocationText('123번지 일원 상가 105호');
  assert.equal(result.locationType, 'OFFICE');
});
