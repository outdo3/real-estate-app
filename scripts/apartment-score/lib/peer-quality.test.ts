// E-JIP SCORE V2 STEP 0.6 — peer-quality classifier fixture tests. node:test, DB 없음.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, classifyIdentity, classifyCoord, classifyPeerEligibility, type QualityInput } from './peer-quality';

function fixture(overrides: Partial<QualityInput>): QualityInput {
  return {
    aptSeq: 'TEST-1',
    roadAddress: null,
    jibunAddress: null,
    mgmBldrgstPk: null,
    totalHouseholds: null,
    parkingCount: null,
    mainBuildingCount: null,
    buildYear: 2020,
    geocodeQuality: 'exact',
    latitude: 35.1,
    longitude: 129.0,
    transactionCount12m: 0,
    ...overrides,
  };
}

test('registry 연결 + 주소 존재 -> IDENTITY_HIGH(대신해모로 실측 케이스)', () => {
  const i = fixture({ totalHouseholds: 733, roadAddress: '부산광역시 서구 대티로 178' });
  assert.equal(classifyIdentity(i), 'IDENTITY_HIGH');
});

test('registry만 있고 주소 없음 -> IDENTITY_MEDIUM(독립 증거 1개)', () => {
  const i = fixture({ totalHouseholds: 500 });
  assert.equal(classifyIdentity(i), 'IDENTITY_MEDIUM');
});

test('주소만 있고 registry 없음 -> IDENTITY_MEDIUM', () => {
  const i = fixture({ roadAddress: '부산광역시 서구 XX로 1' });
  assert.equal(classifyIdentity(i), 'IDENTITY_MEDIUM');
});

test('registry/주소 둘 다 없지만 실거래 이력 있음 -> IDENTITY_LOW(이름만으로 HIGH 금지 원칙)', () => {
  const i = fixture({ transactionCount12m: 2 });
  assert.equal(classifyIdentity(i), 'IDENTITY_LOW');
});

test('registry/주소/거래이력 전부 없음 -> IDENTITY_UNRESOLVED(STEP 0.5의 7개 peer 실측 케이스)', () => {
  const i = fixture({});
  assert.equal(classifyIdentity(i), 'IDENTITY_UNRESOLVED');
});

test('geocodeQuality=exact -> COORD_HIGH', () => {
  assert.equal(classifyCoord(fixture({ geocodeQuality: 'exact' })), 'COORD_HIGH');
});

test('geocodeQuality=normalized(동+건물명 키워드) -> COORD_LOW(STEP 0.5 오염원)', () => {
  assert.equal(classifyCoord(fixture({ geocodeQuality: 'normalized' })), 'COORD_LOW');
});

test('geocodeQuality=failed 또는 좌표 없음 -> COORD_UNRESOLVED', () => {
  assert.equal(classifyCoord(fixture({ geocodeQuality: 'failed' })), 'COORD_UNRESOLVED');
  assert.equal(classifyCoord(fixture({ latitude: null })), 'COORD_UNRESOLVED');
});

test('가짜 COORD_MEDIUM/normalized-address 단계를 만들지 않는다(스키마 한계 명시 원칙)', () => {
  // exact/normalized/failed 3단계 외에 어떤 문자열이 오더라도 UNRESOLVED로 안전하게 떨어진다
  // (임의의 새 등급을 만들어 처리하지 않음).
  assert.equal(classifyCoord(fixture({ geocodeQuality: 'something_unexpected' })), 'COORD_LOW');
});

test('PEER_FULL = COORD_HIGH + IDENTITY_HIGH(등록 대단지, 대신해모로 실측)', () => {
  assert.equal(classifyPeerEligibility('IDENTITY_HIGH', 'COORD_HIGH'), 'PEER_FULL');
});

test('PEER_LIMITED = COORD_HIGH이지만 identity가 MEDIUM/LOW(좌표는 신뢰 가능, registry는 아님)', () => {
  assert.equal(classifyPeerEligibility('IDENTITY_MEDIUM', 'COORD_HIGH'), 'PEER_LIMITED');
  assert.equal(classifyPeerEligibility('IDENTITY_LOW', 'COORD_HIGH'), 'PEER_LIMITED');
});

test('DISPLAY_ONLY = COORD_LOW(identity와 무관 — 좌표 자체가 다른 단지 peer로 위험, STEP 0.5의 5/7 케이스)', () => {
  assert.equal(classifyPeerEligibility('IDENTITY_HIGH', 'COORD_LOW'), 'DISPLAY_ONLY');
  assert.equal(classifyPeerEligibility('IDENTITY_UNRESOLVED', 'COORD_LOW'), 'DISPLAY_ONLY');
});

test('UNRESOLVED = COORD_UNRESOLVED(위치 자체를 특정할 수 없음)', () => {
  assert.equal(classifyPeerEligibility('IDENTITY_HIGH', 'COORD_UNRESOLVED'), 'UNRESOLVED');
});

test('domain-specific eligibility — parking은 registry 값 없으면 coordinate와 무관하게 불가', () => {
  const noRegistry = classify(fixture({ geocodeQuality: 'exact', totalHouseholds: null, parkingCount: null }));
  assert.equal(noRegistry.parkingPeerEligible, false);
  const withRegistry = classify(fixture({ geocodeQuality: 'exact', totalHouseholds: 500, parkingCount: 600 }));
  assert.equal(withRegistry.parkingPeerEligible, true);
});

test('domain-specific eligibility — transport/life/school은 좌표만 HIGH면 registry 없어도 eligible', () => {
  const r = classify(fixture({ geocodeQuality: 'exact', totalHouseholds: null, roadAddress: null }));
  assert.equal(r.transportPeerEligible, true);
  assert.equal(r.livePeerEligible, true);
  assert.equal(r.schoolPeerEligible, true);
  assert.equal(r.parkingPeerEligible, false);
});

test('domain-specific eligibility — coordinate가 LOW면 transport/life/school도 전부 false', () => {
  const r = classify(fixture({ geocodeQuality: 'normalized' }));
  assert.equal(r.transportPeerEligible, false);
  assert.equal(r.livePeerEligible, false);
  assert.equal(r.schoolPeerEligible, false);
});

test('complexPeerEligible — buildYear 있고 identity가 UNRESOLVED가 아니면 true', () => {
  const r = classify(fixture({ buildYear: 2001, totalHouseholds: null, roadAddress: null, transactionCount12m: 1 }));
  assert.equal(r.identity, 'IDENTITY_LOW');
  assert.equal(r.complexPeerEligible, true);
});

test('complexPeerEligible — 완전히 근거 없는(UNRESOLVED) row는 buildYear가 있어도 false', () => {
  const r = classify(fixture({ buildYear: 2001, totalHouseholds: null, roadAddress: null, transactionCount12m: 0 }));
  assert.equal(r.identity, 'IDENTITY_UNRESOLVED');
  assert.equal(r.complexPeerEligible, false);
});

test('marketEvidence — MIN_TRANSACTION_SAMPLE(3) 재사용, 기존 market.ts와 threshold 일치', () => {
  assert.equal(classify(fixture({ transactionCount12m: 0 })).marketEvidence, 'ZERO');
  assert.equal(classify(fixture({ transactionCount12m: 2 })).marketEvidence, 'WEAK');
  assert.equal(classify(fixture({ transactionCount12m: 3 })).marketEvidence, 'STRONG');
});

test('registryAttempted vs registryLinked 구분 — mgmBldrgstPk 있어도 totalHouseholds 없을 수 있음(실측 80건)', () => {
  const r = classify(fixture({ mgmBldrgstPk: 'PK123', totalHouseholds: null }));
  assert.equal(r.registryAttempted, true);
  assert.equal(r.registryLinked, false);
});
