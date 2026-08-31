import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeCoverage,
  buildForensicProfile,
  classifyCandidateProfile,
  profileToRepairCandidate,
  BUSAN_LAWD_CODES,
} from './master-coverage-sync-logic.ts';
import { buildAllPlans } from './repair-recent-missing-masters-logic.ts';

// A. current baseline coverage — missing=0 case computes cleanly.
test('A: 모든 traded aptSeq가 Master에 있으면 missing=0, coverage=100%', () => {
  const coverage = computeCoverage(['26290-1', '26290-2'], new Set(['26290-1', '26290-2']));
  assert.equal(coverage.missingCount, 0);
  assert.equal(coverage.coveragePercent, 100);
  assert.deepEqual(coverage.missingAptSeqs, []);
});

// B. missing detection fixture — one aptSeq absent from Master is detected exactly.
test('B: Master에 없는 aptSeq가 정확히 missing으로 탐지된다', () => {
  const coverage = computeCoverage(['26290-1', '26290-2', '26290-3'], new Set(['26290-1', '26290-2']));
  assert.equal(coverage.missingCount, 1);
  assert.deepEqual(coverage.missingAptSeqs, ['26290-3']);
  assert.ok(coverage.coveragePercent < 100 && coverage.coveragePercent > 0);
});

const cleanTrades = [
  { aptName: '해피빌', dong: '남천동', jibun: '10-1', lawdCd: '26500', buildYear: 2015 },
  { aptName: '해피빌', dong: '남천동', jibun: '10-1', lawdCd: '26500', buildYear: 2015 },
];

// C. clean identity + no conflicts -> HIGH_CONFIDENCE, ready for master create.
test('C: identity가 흔들리지 않고 충돌이 없으면 HIGH_CONFIDENCE로 분류된다', () => {
  const profile = buildForensicProfile('26500-999', cleanTrades, []);
  const result = classifyCandidateProfile(profile);
  assert.equal(result.decision, 'HIGH_CONFIDENCE');
  assert.equal(result.masterCreateReadiness, 'READY_FOR_MASTER_CREATE');
  assert.equal(result.classification, 'A_ACTIVE_APARTMENT_MASTER_OMISSION');
});

// D. ambiguous identity — name/dong/jibun disagree across trades within the same
// aptSeq -> REVIEW_REQUIRED, never auto-created.
test('D: 동일 aptSeq 내에서 이름/동/지번이 흔들리면 REVIEW_REQUIRED로 분류된다', () => {
  const conflicting = [
    { aptName: '해피빌', dong: '남천동', jibun: '10-1', lawdCd: '26500', buildYear: 2015 },
    { aptName: '해피빌라트', dong: '남천동', jibun: '10-1', lawdCd: '26500', buildYear: 2015 },
  ];
  const profile = buildForensicProfile('26500-999', conflicting, []);
  const result = classifyCandidateProfile(profile);
  assert.equal(result.decision, 'REVIEW_REQUIRED');
  assert.equal(result.classification, 'I_UNKNOWN');
});

// E. address collision with an existing different-aptSeq Master row -> REVIEW_REQUIRED.
test('E: 동일 dong+jibun에 다른 aptSeq의 기존 Master row가 있으면 REVIEW_REQUIRED로 분류된다', () => {
  const existingMasters = [
    { aptSeq: '26500-111', name: '해피빌', normalizedName: '해피빌', umdName: '남천동', jibun: '10-1' },
  ];
  const profile = buildForensicProfile('26500-999', cleanTrades, existingMasters);
  const result = classifyCandidateProfile(profile);
  assert.equal(result.decision, 'REVIEW_REQUIRED');
  assert.equal(result.classification, 'F_SOURCE_ALIAS_MISMATCH');
});

// F. wrong-apartment fallback guard — same brand name at a DIFFERENT address must
// NOT be treated as a collision (regression for the "보해이브빌" 동명이인 case).
test('F: 같은 이름이라도 dong/jibun이 다르면 충돌로 취급하지 않고 HIGH_CONFIDENCE를 유지한다', () => {
  const existingMasters = [
    { aptSeq: '26380-181', name: '해피빌', normalizedName: '해피빌', umdName: '하단동', jibun: '511-4' },
  ];
  const profile = buildForensicProfile('26500-999', cleanTrades, existingMasters);
  const result = classifyCandidateProfile(profile);
  assert.equal(result.decision, 'HIGH_CONFIDENCE');
  assert.equal(profile.masterNameAliasMatches.length, 1);
  assert.equal(profile.masterAddressMatch, null);
});

// G. missing required identity field (no jibun on any trade) -> INVALID, never created.
test('G: jibun이 전혀 없으면 INVALID(DO_NOT_CREATE)로 분류된다', () => {
  const noJibun = [{ aptName: '해피빌', dong: '남천동', jibun: null, lawdCd: '26500', buildYear: 2015 }];
  const profile = buildForensicProfile('26500-999', noJibun, []);
  const result = classifyCandidateProfile(profile);
  assert.equal(result.decision, 'INVALID');
  assert.equal(result.masterCreateReadiness, 'DO_NOT_CREATE');
});

// H. aptSeq prefix / trade lawdCd mismatch -> REVIEW_REQUIRED (extra guard beyond
// the original 16-case audit).
test('H: aptSeq 접두부가 거래의 lawdCd와 다르면 REVIEW_REQUIRED로 분류된다', () => {
  const mismatched = [{ aptName: '해피빌', dong: '남천동', jibun: '10-1', lawdCd: '26200', buildYear: 2015 }];
  const profile = buildForensicProfile('26500-999', mismatched, []);
  assert.equal(profile.aptSeqLawdMismatch, true);
  const result = classifyCandidateProfile(profile);
  assert.equal(result.decision, 'REVIEW_REQUIRED');
});

// I. duplicate protection — an aptSeq already present in Master never becomes an
// INSERT plan even if classification is HIGH_CONFIDENCE (idempotency).
test('I: 이미 Master에 존재하는 aptSeq는 HIGH_CONFIDENCE여도 INSERT되지 않는다(idempotent)', () => {
  const profile = buildForensicProfile('26500-999', cleanTrades, []);
  const classification = classifyCandidateProfile(profile);
  const candidate = profileToRepairCandidate(profile, classification);
  const plans = buildAllPlans([candidate], new Set(['26500-999']));
  assert.equal(plans[0].action, 'SKIP_DUPLICATE');
});

// J. REVIEW_REQUIRED candidates never produce an INSERT plan.
test('J: REVIEW_REQUIRED 후보는 INSERT plan으로 이어지지 않는다', () => {
  const existingMasters = [
    { aptSeq: '26500-111', name: '해피빌', normalizedName: '해피빌', umdName: '남천동', jibun: '10-1' },
  ];
  const profile = buildForensicProfile('26500-999', cleanTrades, existingMasters);
  const classification = classifyCandidateProfile(profile);
  const candidate = profileToRepairCandidate(profile, classification);
  const plans = buildAllPlans([candidate], new Set());
  assert.equal(plans[0].action, 'SKIP_NOT_READY');
});

// K. secondary metadata null policy — end-to-end from profile to insert plan never
// introduces totalHouseholds/coordinates/etc.
test('K: HIGH_CONFIDENCE 후보의 INSERT plan에는 secondary metadata 키가 전혀 없다', () => {
  const profile = buildForensicProfile('26500-999', cleanTrades, []);
  const classification = classifyCandidateProfile(profile);
  const candidate = profileToRepairCandidate(profile, classification);
  const plans = buildAllPlans([candidate], new Set());
  assert.equal(plans[0].action, 'INSERT');
  const keys = Object.keys(plans[0].data);
  for (const forbidden of ['totalHouseholds', 'latitude', 'longitude', 'parkingCount', 'floorAreaRatio', 'buildingCoverageRatio']) {
    assert.ok(!keys.includes(forbidden));
  }
});

test('BUSAN_LAWD_CODES가 16개 구·군 코드를 그대로 재사용한다(중복 정의 없음)', () => {
  assert.equal(BUSAN_LAWD_CODES.length, 16);
  assert.ok(BUSAN_LAWD_CODES.includes('26290'));
});
