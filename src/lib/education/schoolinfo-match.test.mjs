import assert from 'node:assert/strict';
import test from 'node:test';
import { matchSchoolInfoCandidate } from './schoolinfo-match.ts';

test('matchSchoolInfoCandidate: 후보 없으면 NOT_FOUND', () => {
  const result = matchSchoolInfoCandidate('서대신동3가', []);
  assert.equal(result.status, 'NOT_FOUND');
  assert.equal(result.matched, null);
});

test('matchSchoolInfoCandidate: 후보 1개면 무조건 MATCHED(이름+구군 유일)', () => {
  const result = matchSchoolInfoCandidate('서대신동3가', [{ schulCode: 'S1', addressBrkdn: '부산광역시 서구 어딘가' }]);
  assert.equal(result.status, 'MATCHED');
  assert.equal(result.matched.schulCode, 'S1');
});

// 실측 사례: 강서구 송정초등학교(신호동) vs 강서구 대저중앙초등학교(강동동) —
// 같은 이름의 두 학교를 dongName으로 안전하게 구분한다.
test('matchSchoolInfoCandidate: 동명이교 2건 + dongName 일치 1건이면 그 1건만 MATCHED', () => {
  const candidates = [
    { schulCode: 'S020001278', addressBrkdn: '부산광역시 강서구 대저2동' },
    { schulCode: 'S020002202', addressBrkdn: '부산광역시 강서구 신호동' },
  ];
  const result = matchSchoolInfoCandidate('신호동', candidates);
  assert.equal(result.status, 'MATCHED');
  assert.equal(result.matched.schulCode, 'S020002202');
});

test('matchSchoolInfoCandidate: dongName이 없으면(구정보 미확보) 동명이교를 REVIEW로 남긴다(첫 결과 사용 금지)', () => {
  const candidates = [
    { schulCode: 'A', addressBrkdn: '부산광역시 강서구 대저2동' },
    { schulCode: 'B', addressBrkdn: '부산광역시 강서구 신호동' },
  ];
  const result = matchSchoolInfoCandidate(null, candidates);
  assert.equal(result.status, 'REVIEW_IDENTITY');
  assert.equal(result.matched, null);
});

test('matchSchoolInfoCandidate: dongName으로도 여전히 모호하면(0건 또는 2건 이상 일치) REVIEW', () => {
  const candidates = [
    { schulCode: 'A', addressBrkdn: '부산광역시 강서구 명지동 111' },
    { schulCode: 'B', addressBrkdn: '부산광역시 강서구 명지동 222' },
  ];
  const result = matchSchoolInfoCandidate('명지동', candidates);
  assert.equal(result.status, 'REVIEW_IDENTITY');
});

// 실측: 경일중학교의 이전-이력 레코드(ABSCH_YN='Y')는 ADRES_BRKDN 필드 자체가
// 없다 — 호출부가 이런 레코드를 걸러내지 못하고 넘겨도 crash하지 않아야 한다.
test('matchSchoolInfoCandidate: addressBrkdn이 undefined인 후보가 섞여도 crash하지 않는다', () => {
  const candidates = [
    { schulCode: 'A', addressBrkdn: undefined },
    { schulCode: 'B', addressBrkdn: '부산광역시 강서구 명지동' },
  ];
  const result = matchSchoolInfoCandidate('명지동', candidates);
  assert.equal(result.status, 'MATCHED');
  assert.equal(result.matched.schulCode, 'B');
});

test('matchSchoolInfoCandidate: dongName이 어느 후보 주소에도 없으면 REVIEW(추정 금지)', () => {
  const candidates = [
    { schulCode: 'A', addressBrkdn: '부산광역시 강서구 대저2동' },
    { schulCode: 'B', addressBrkdn: '부산광역시 강서구 신호동' },
  ];
  const result = matchSchoolInfoCandidate('전혀다른동', candidates);
  assert.equal(result.status, 'REVIEW_IDENTITY');
});
