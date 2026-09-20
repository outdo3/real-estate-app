import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isResidentialRecord, decideHouseholds, decideRoadAddress, normalizeRoad, jibunToBunJi,
} from './busan-ledger-auto-safe-logic.ts';

const rec = (purpose, hhld, road) => ({ mainPurpsCdNm: purpose, hhldCnt: hhld, newPlatPlc: road });
const R = '부산광역시 해운대구 해운대로349번길 24 (우동)';

// ── §3 주거 판정은 공식 코드명으로만 ──

test('주거 판정은 mainPurpsCdNm 공식 코드명으로만 한다 — 이름 추정 금지', () => {
  assert.equal(isResidentialRecord(rec('공동주택', 84)), true);
  assert.equal(isResidentialRecord(rec('제1종근린생활시설', 0)), false);
  assert.equal(isResidentialRecord(rec('노유자시설', 0)), false);
  assert.equal(isResidentialRecord(rec('판매시설', 0)), false);
  assert.equal(isResidentialRecord(rec('단독주택', 1)), false);
  // 이름이 아파트처럼 보여도 주용도가 아니면 주거가 아니다.
  assert.equal(isResidentialRecord({ bldNm: '101동', mainPurpsCdNm: '창고시설', hhldCnt: 50 }), false);
});

test('비주거 레코드의 세대수는 합계에 들어가지 않는다', () => {
  const d = decideHouseholds([
    rec('공동주택', 100), rec('공동주택', 120),
    rec('제1종근린생활시설', 7), rec('판매시설', 3),
  ], 100);
  assert.equal(d.verdict, 'AUTO_SAFE');
  assert.equal(d.newValue, 220); // 7과 3은 제외
});

// ── §3 AUTO_SAFE 경계 ──

test('주거 레코드가 전부 hhldCnt>0이고 저장값이 한 동 값이면 AUTO_SAFE', () => {
  const d = decideHouseholds([rec('공동주택', 84), rec('공동주택', 90), rec('공동주택', 104)], 90);
  assert.equal(d.verdict, 'AUTO_SAFE');
  assert.equal(d.newValue, 278);
});

test('공동주택인데 0세대인 레코드가 하나라도 있으면 REVIEW_REQUIRED — 자동 적용하지 않는다', () => {
  // 26350-15 삼호가든맨션의 모양: 상가동이 공동주택으로 분류돼 0세대로 들어온다.
  const d = decideHouseholds([rec('공동주택', 84), rec('공동주택', 0), rec('공동주택', 90)], 90);
  assert.equal(d.verdict, 'REVIEW_REQUIRED');
  assert.equal(d.newValue, null);
});

test('저장값이 이미 주거 합계와 같으면 ALREADY_OK — 쓰지 않는다', () => {
  const d = decideHouseholds([rec('공동주택', 100), rec('공동주택', 120)], 220);
  assert.equal(d.verdict, 'ALREADY_OK');
  assert.equal(d.newValue, null);
});

test('저장값이 없으면 KEEP_NULL — 이번 승인 범위 밖이라 채우지 않는다', () => {
  const d = decideHouseholds([rec('공동주택', 100), rec('공동주택', 120)], null);
  assert.equal(d.verdict, 'KEEP_NULL');
  assert.equal(d.newValue, null);
});

test('주거 레코드가 없으면 NOT_APPLICABLE', () => {
  const d = decideHouseholds([rec('제1종근린생활시설', 0), rec('창고시설', 0)], 12);
  assert.equal(d.verdict, 'NOT_APPLICABLE');
});

test('주거 합계가 0이면 NOT_APPLICABLE — 0을 새 값으로 쓰지 않는다', () => {
  const d = decideHouseholds([rec('공동주택', 0)], 90);
  assert.equal(d.verdict, 'NOT_APPLICABLE');
  assert.equal(d.newValue, null);
});

// ── §4 도로명 ──

test('필지의 도로명이 단 하나로 합의될 때만 AUTO_SAFE', () => {
  const d = decideRoadAddress([rec('공동주택', 84, R), rec('공동주택', 90, R)], null);
  assert.equal(d.verdict, 'AUTO_SAFE');
  assert.equal(d.newValue, R);
});

test('도로명이 여러 종이면 REVIEW — first row도 다수결도 쓰지 않는다', () => {
  const d = decideRoadAddress([
    rec('공동주택', 84, R), rec('공동주택', 90, R), rec('공동주택', 104, '부산광역시 해운대구 다른로 1'),
  ], null);
  assert.equal(d.verdict, 'REVIEW_REQUIRED');
  assert.equal(d.newValue, null);
  // 3건 중 2건이 R이지만 다수결로 R을 고르지 않는다.
});

test('저장값이 이미 그 도로명이면 ALREADY_OK', () => {
  const d = decideRoadAddress([rec('공동주택', 84, R)], R);
  assert.equal(d.verdict, 'ALREADY_OK');
});

test('공백 차이만 있는 저장값은 같은 값으로 보고 쓰지 않는다', () => {
  const d = decideRoadAddress([rec('공동주택', 84, R)], R.replace(' ', '  '));
  assert.equal(d.verdict, 'ALREADY_OK');
});

test('정규화는 공백만 정리하고 주소 자체를 바꾸지 않는다', () => {
  assert.equal(normalizeRoad('  부산광역시   해운대구  해운대로349번길 24 (우동) '), R);
  assert.equal(normalizeRoad(null), '');
});

test('응답에 도로명이 없으면 NOT_APPLICABLE', () => {
  const d = decideRoadAddress([rec('공동주택', 84, ''), rec('공동주택', 90, null)], null);
  assert.equal(d.verdict, 'NOT_APPLICABLE');
});

// ── 지번 파싱 ──

test('지번은 본번-부번을 4자리로 채운다', () => {
  assert.deepEqual(jibunToBunJi('1104-1'), { bun: '1104', ji: '0001' });
  assert.deepEqual(jibunToBunJi('15'), { bun: '0015', ji: '0000' });
  assert.equal(jibunToBunJi('산 12-3'), null);
  assert.equal(jibunToBunJi(''), null);
});
