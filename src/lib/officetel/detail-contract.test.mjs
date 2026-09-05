// OFFICETEL_V1 STEP 4A §14 — 상세 READ 계약의 순수 로직 테스트.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OFFICETEL_BLOCKED_FEATURES,
  OFFICETEL_CANCELLATION_COVERAGE_FROM,
  OFFICETEL_TX_DEFAULT_LIMIT,
  OFFICETEL_TX_MAX_LIMIT,
  OfficetelQueryError,
  cancellationCoverageFor,
  classifyOfficetelRentType,
  officetelDisplayName,
  officetelParkingTotal,
  officetelScaleLabel,
  officetelTradeLimitations,
  parseOfficetelIdRef,
  parseOfficetelTxQuery,
} from './detail-contract.ts';

const q = (obj) => parseOfficetelTxQuery((k) => (k in obj ? String(obj[k]) : null));

// ── §2 IDENTITY — 정확한 것만 해석한다 ──────────────────────────────────
test('master id(숫자)를 정확히 해석한다', () => {
  assert.deepEqual(parseOfficetelIdRef('2243'), { kind: 'id', id: 2243 });
});

test('canonicalKey(5세그먼트)를 정확히 해석한다', () => {
  assert.deepEqual(parseOfficetelIdRef('OFFI:26350:우동:1435-3:_'), {
    kind: 'canonicalKey', canonicalKey: 'OFFI:26350:우동:1435-3:_',
  });
  assert.deepEqual(parseOfficetelIdRef('OFFI:26290:대연동:62-14:나동').kind, 'canonicalKey');
});

test('CASE I — 이름/부분키/모호한 입력은 절대 해석되지 않는다(느슨한 매칭 금지)', () => {
  for (const bad of [
    '한일오르듀',            // 이름
    '우동 오피스텔',         // 이름 + 동
    'OFFI:26350:우동',       // 부분 키
    'OFFI:26350:우동:1435-3',// 세그먼트 부족
    'OFFI:26350::1435-3:_',  // 빈 세그먼트
    'OFFI:',
    '',
    '0',
    '-1',
    'abc',
  ]) {
    assert.equal(parseOfficetelIdRef(bad).kind, 'invalid', `"${bad}"는 invalid여야 한다`);
  }
});

// ── §5 전세/월세 ────────────────────────────────────────────────────────
test('월세 0원은 전세, 0 초과는 월세', () => {
  assert.equal(classifyOfficetelRentType(0), 'jeonse');
  assert.equal(classifyOfficetelRentType(1), 'wolse');
  assert.equal(classifyOfficetelRentType(75), 'wolse');
});

// ── §9 취소 신뢰 구간 ───────────────────────────────────────────────────
test('CASE E 보강 — 2020-01 이전 거래는 취소 정보 원천 미제공으로 표시된다', () => {
  assert.equal(cancellationCoverageFor('2019-12-31'), 'NOT_PROVIDED_BY_SOURCE');
  assert.equal(cancellationCoverageFor('2006-01-02'), 'NOT_PROVIDED_BY_SOURCE');
  assert.equal(cancellationCoverageFor('2020-01-01'), 'PROVIDED');
  assert.equal(cancellationCoverageFor('2026-09-02'), 'PROVIDED');
  assert.equal(OFFICETEL_CANCELLATION_COVERAGE_FROM, '2020-01');
});

test('한계 문구는 취소 미제공 구간과 동일내용 형제를 각각 밝힌다', () => {
  const none = officetelTradeLimitations({ hasPreCoverageRows: false, identicalSiblingRows: 0 });
  assert.equal(none.length, 1); // 1:1 보존 원칙은 항상 포함

  const both = officetelTradeLimitations({ hasPreCoverageRows: true, identicalSiblingRows: 4 });
  assert.equal(both.length, 3);
  assert.ok(both.some((s) => s.includes('4건')));
  assert.ok(both.some((s) => s.includes('2020-01')));
});

test('Record High / Score / Finance / Map / 평형은 BLOCKED로 명시된다', () => {
  assert.deepEqual([...OFFICETEL_BLOCKED_FEATURES], [
    'RECORD_HIGH', 'SCORE', 'FINANCE', 'MAP_DISTANCE', 'SUPPLY_AREA_OR_PYEONG',
  ]);
});

// ── §3 규모/주차/표시명 ─────────────────────────────────────────────────
test('규모 라벨 단위는 호이며 세대가 아니다', () => {
  assert.equal(officetelScaleLabel(770), '770호');
  assert.equal(officetelScaleLabel(1234), '1,234호');
  assert.ok(!String(officetelScaleLabel(770)).includes('세대'));
});

test('규모 값이 없거나 0이면 지어내지 않고 null', () => {
  assert.equal(officetelScaleLabel(null), null);
  assert.equal(officetelScaleLabel(undefined), null);
  assert.equal(officetelScaleLabel(0), null);
});

test('주차 4종이 전부 없으면 0이 아니라 null(정보 없음)', () => {
  assert.equal(officetelParkingTotal({
    indoorMechanicalParking: null, indoorAutoParking: null,
    outdoorMechanicalParking: null, outdoorAutoParking: null,
  }), null);
  assert.equal(officetelParkingTotal({
    indoorMechanicalParking: 10, indoorAutoParking: null,
    outdoorMechanicalParking: 5, outdoorAutoParking: null,
  }), 15);
  // 실제로 0으로 보고된 경우는 0을 유지한다(결측과 구분).
  assert.equal(officetelParkingTotal({
    indoorMechanicalParking: 0, indoorAutoParking: 0,
    outdoorMechanicalParking: 0, outdoorAutoParking: 0,
  }), 0);
});

test('빈 표시명(실측 390건)은 null로 접힌다', () => {
  assert.equal(officetelDisplayName(''), null);
  assert.equal(officetelDisplayName('   '), null);
  assert.equal(officetelDisplayName(null), null);
  assert.equal(officetelDisplayName('한일오르듀'), '한일오르듀');
});

// ── §12 쿼리 계약 ───────────────────────────────────────────────────────
test('기본값은 sale / 전체면적 / 기본 limit / 취소 제외', () => {
  assert.deepEqual(q({}), {
    type: 'sale', area: null, limit: OFFICETEL_TX_DEFAULT_LIMIT, offset: 0, includeCanceled: false,
  });
});

test('CASE D — 정확한 전용면적만 받는다(근사/구간 없음)', () => {
  assert.equal(q({ area: '24.65' }).area, '24.65');
  assert.equal(q({ area: '84.6836' }).area, '84.6836');
  for (const bad of ['84~85', '0', '-3', 'abc', '84.', '1e3']) {
    assert.throws(() => q({ area: bad }), OfficetelQueryError, `area=${bad}`);
  }
});

test('limit 상한을 강제하고 잘못된 값을 조용히 보정하지 않는다', () => {
  assert.equal(q({ limit: '1' }).limit, 1);
  assert.equal(q({ limit: String(OFFICETEL_TX_MAX_LIMIT) }).limit, OFFICETEL_TX_MAX_LIMIT);
  assert.throws(() => q({ limit: String(OFFICETEL_TX_MAX_LIMIT + 1) }), OfficetelQueryError);
  assert.throws(() => q({ limit: '0' }), OfficetelQueryError);
  assert.throws(() => q({ limit: 'abc' }), OfficetelQueryError);
});

test('type은 sale/rent만 허용한다', () => {
  assert.equal(q({ type: 'rent' }).type, 'rent');
  assert.equal(q({ type: 'SALE' }).type, 'sale');
  assert.throws(() => q({ type: 'jeonse' }), OfficetelQueryError);
});

test('includeCanceled는 명시적으로 true일 때만 켜진다', () => {
  assert.equal(q({}).includeCanceled, false);
  assert.equal(q({ includeCanceled: '1' }).includeCanceled, false);
  assert.equal(q({ includeCanceled: 'true' }).includeCanceled, true);
});

test('offset은 정수만 받는다', () => {
  assert.equal(q({ offset: '100' }).offset, 100);
  assert.throws(() => q({ offset: '-1' }), OfficetelQueryError);
  assert.throws(() => q({ offset: '1.5' }), OfficetelQueryError);
});
