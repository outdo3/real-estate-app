import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyZeroHouseholdRecord, policyBHouseholds, policyCHouseholds } from './audit-ledger-zero-household-policy.ts';
import { policyOutcomes } from './analyze-ledger-zero-household-policy.ts';

const rec = (o = {}) => ({ mainPurpsCdNm: '공동주택', hhldCnt: 0, hoCnt: 0, fmlyCnt: 0, etcPurps: '', mainAtchGbCdNm: '주건축물', ...o });

// ── 실측이 뒤집은 가정: 호수·가구수는 주거의 증거가 아니다 ──
// 상업 용도 0세대 레코드 77건 중 74건이 hoCnt>0, 25건이 fmlyCnt>0이었다(엘지 상가동은
// 가구수 60·호수 67). 호·가구는 상가 호실에도 그대로 쓰인다.

test('상가동은 호수·가구수가 있어도 비주거로 판정한다 — 호실 수이지 세대가 아니다', () => {
  const v = classifyZeroHouseholdRecord(rec({ etcPurps: '생활편익시설, 의료시설, 근린생활시설', hoCnt: 25, fmlyCnt: 25 }));
  assert.equal(v.cls, 'COMMERCIAL_OR_AMENITY');
  assert.equal(v.excludable, true);
});

test('엘지 상가동(가구수 60·호수 67)도 비주거다', () => {
  const v = classifyZeroHouseholdRecord(rec({ etcPurps: '생활편익시설, 제1ㆍ2종근린생활시설, 의료시설,교육연구시설', hoCnt: 67, fmlyCnt: 60 }));
  assert.equal(v.excludable, true);
});

// ── 주/부속 구분이 가장 강한 공식 신호 ──

test('부속건축물이고 주거 단위 신고가 0이면 제외 가능하다', () => {
  const v = classifyZeroHouseholdRecord(rec({ mainAtchGbCdNm: '부속건축물', etcPurps: '경비실' }));
  assert.equal(v.cls, 'MANAGEMENT_SECURITY');
  assert.equal(v.excludable, true);
});

test('부속건축물이어도 가구수가 신고돼 있으면 근거 상충 — 자동 제외하지 않는다', () => {
  // 실측: 성도뷰크 부속건축물 · etcPurps=공동주택 · fmlyCnt=48 · 연면적 905㎡
  const v = classifyZeroHouseholdRecord(rec({ mainAtchGbCdNm: '부속건축물', etcPurps: '공동주택', fmlyCnt: 48 }));
  assert.equal(v.cls, 'RESIDENTIAL_ZERO_SUSPICIOUS');
  assert.equal(v.excludable, false);
});

test('부속건축물이어도 호수가 신고돼 있으면 제외하지 않는다', () => {
  // 실측: 한보장산 부속건축물 · 경비실 · hoCnt=1
  assert.equal(classifyZeroHouseholdRecord(rec({ mainAtchGbCdNm: '부속건축물', etcPurps: '경비실', hoCnt: 1 })).excludable, false);
});

// ── 기타용도의 괄호 해석 ──

test('"공동주택(경비실)"은 괄호 안이 실제 용도이므로 주거가 아니다', () => {
  const v = classifyZeroHouseholdRecord(rec({ mainAtchGbCdNm: '부속건축물', etcPurps: '공동주택(경비실)' }));
  assert.equal(v.excludable, true);
});

test('"공동주택(아파트)"은 자기 용도가 주거이므로 제외하지 않는다', () => {
  const v = classifyZeroHouseholdRecord(rec({ etcPurps: '공동주택(아파트)' }));
  assert.equal(v.cls, 'RESIDENTIAL_ZERO_SUSPICIOUS');
  assert.equal(v.excludable, false);
});

test('주상복합 상가동처럼 주거와 비주거가 함께 적히면 MIXED_USE — 자동 제외하지 않는다', () => {
  const v = classifyZeroHouseholdRecord(rec({ etcPurps: '공동주택, 판매시설', hoCnt: 8 }));
  assert.equal(v.cls, 'MIXED_USE');
  assert.equal(v.excludable, false);
});

// ── 근거가 없으면 추측하지 않는다 ──

test('공식 필드에 근거가 없으면 UNRESOLVED이고 제외하지 않는다', () => {
  const v = classifyZeroHouseholdRecord(rec({}));
  assert.equal(v.cls, 'UNRESOLVED');
  assert.equal(v.excludable, false);
});

test('동 이름은 판정 근거가 아니다 — 이름이 상가동이어도 근거가 없으면 UNRESOLVED', () => {
  const v = classifyZeroHouseholdRecord(rec({ dongNm: '상가동', bldNm: '상가' }));
  assert.equal(v.cls, 'UNRESOLVED');
  assert.equal(v.excludable, false);
});

// ── 정책 비교 ──

test('POLICY B는 근거로 제외 가능한 0세대만 빼고 합산한다', () => {
  const recs = [
    rec({ hhldCnt: 84 }), rec({ hhldCnt: 90 }),
    rec({ hhldCnt: 0, etcPurps: '생활편익시설', hoCnt: 12 }),
    { mainPurpsCdNm: '제1종근린생활시설', hhldCnt: 7 },
  ];
  const b = policyBHouseholds(recs);
  assert.equal(b.sum, 174, '비주거 주용도 7은 애초에 합산 대상이 아니다');
  assert.equal(b.excluded, 1);
  assert.deepEqual(b.blocked, []);
});

test('POLICY B는 근거 없는 0세대가 하나라도 있으면 막힌다', () => {
  assert.deepEqual(policyBHouseholds([rec({ hhldCnt: 84 }), rec({ hhldCnt: 0 })]).blocked, ['UNRESOLVED']);
});

test('POLICY C는 0세대를 따지지 않고 주거 hhldCnt를 전부 더한다', () => {
  assert.equal(policyCHouseholds([rec({ hhldCnt: 84 }), rec({ hhldCnt: 0, hoCnt: 20 })]), 84);
});

test('정책 A는 0세대 레코드가 하나라도 있으면 값을 내지 않는다', () => {
  const o = policyOutcomes({ residentialSumNonZero: 1848, zeros: [rec({ etcPurps: '생활편익시설', hoCnt: 67 })] });
  assert.equal(o.A, null);
  assert.equal(o.B, 1848);
  assert.equal(o.C, 1848);
});

test('엘지 케이스: 0세대 상가동 2개를 근거로 제외하면 1,848세대가 후보가 된다', () => {
  const o = policyOutcomes({
    residentialSumNonZero: 1848,
    zeros: [
      rec({ etcPurps: '생활편익시설, 제1ㆍ2종근린생활시설, 의료시설,교육연구시설', hoCnt: 67, fmlyCnt: 60 }),
      rec({ etcPurps: '생활편익시설, 의료시설, 제2종근린생활시설', hoCnt: 10, fmlyCnt: 10 }),
    ],
  });
  assert.equal(o.B, 1848);
  assert.equal(o.excluded, 2);
  assert.deepEqual(o.blockedBy, []);
  // 주차 1,984대 기준 세대당 1.07대 — 41.33에서 정상 범위로 내려온다
  assert.equal(Math.round((1984 / o.B) * 100) / 100, 1.07);
});
