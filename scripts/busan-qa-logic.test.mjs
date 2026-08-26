import assert from 'node:assert/strict';
import test from 'node:test';
import {
  pct,
  parseAreaM2,
  toIsoDate,
  haversineMeters,
  classifyConsistency,
  isApiFailureMisclassifiedAsNoTrade,
} from './busan-qa-logic.ts';

const BBOX = { minLat: 34.9, maxLat: 35.45, minLng: 128.6, maxLng: 129.35 };
const YEAR = 2026;

function baseRow(overrides = {}) {
  return {
    floorAreaRatio: null,
    buildingCoverageRatio: null,
    totalHouseholds: null,
    parkingCount: null,
    parkingPerHousehold: null,
    buildYear: null,
    latitude: null,
    longitude: null,
    ...overrides,
  };
}

test('pct: 표본 0이면 N/A', () => {
  assert.equal(pct(0, 0), 'N/A(표본 0)');
});

test('pct: 정상 백분율 계산', () => {
  assert.equal(pct(1, 4), '25.0%');
});

test('parseAreaM2: "84.99㎡" 형식에서 숫자만 추출', () => {
  assert.equal(parseAreaM2('84.99㎡'), 84.99);
});

test('parseAreaM2: 숫자가 없으면 null', () => {
  assert.equal(parseAreaM2('정보없음'), null);
});

test('haversineMeters: 같은 지점이면 0', () => {
  assert.equal(haversineMeters(35.1, 129.0, 35.1, 129.0), 0);
});

test('haversineMeters: 위도 1도 차이는 대략 111km', () => {
  const d = haversineMeters(35.0, 129.0, 36.0, 129.0);
  assert.ok(d > 110000 && d < 112000, `got ${d}`);
});

// [연산동한솔솔파크 회귀] null 허용 원칙 — 값이 없으면 어떤 검사도 걸리지 않는다.
test('classifyConsistency: 전부 null이면 hard/soft 둘 다 비어있음(null 허용)', () => {
  const { hard, soft } = classifyConsistency(baseRow(), BBOX, YEAR);
  assert.deepEqual(hard, []);
  assert.deepEqual(soft, []);
});

test('classifyConsistency: floorAreaRatio<=0은 hard(FAIL)', () => {
  const { hard } = classifyConsistency(baseRow({ floorAreaRatio: 0 }), BBOX, YEAR);
  assert.equal(hard.length, 1);
});

// [동원화인패밀리/광안동에스케이뷰 회귀] buildingCoverageRatio>100은 soft(WARN)로만
// 분류한다 — 법정 상한 위반이지만 파싱 오류 vs 실제 예외 여부는 사람 확인이 필요해
// 자동으로 FAIL(P0) 단정하지 않는다.
test('classifyConsistency: buildingCoverageRatio>100은 soft(WARN), hard 아님', () => {
  const { hard, soft } = classifyConsistency(baseRow({ buildingCoverageRatio: 122.37 }), BBOX, YEAR);
  assert.equal(hard.length, 0);
  assert.equal(soft.length, 1);
});

test('classifyConsistency: totalHouseholds<=0은 hard', () => {
  const { hard } = classifyConsistency(baseRow({ totalHouseholds: 0 }), BBOX, YEAR);
  assert.equal(hard.length, 1);
});

test('classifyConsistency: buildYear가 미래년도면 hard', () => {
  const { hard } = classifyConsistency(baseRow({ buildYear: 2099 }), BBOX, YEAR);
  assert.equal(hard.length, 1);
});

test('classifyConsistency: parkingPerHousehold가 저장값과 계산값이 거의 같으면 통과', () => {
  const { hard } = classifyConsistency(
    baseRow({ parkingCount: 204, totalHouseholds: 165, parkingPerHousehold: 204 / 165 }),
    BBOX,
    YEAR
  );
  assert.equal(hard.length, 0);
});

test('classifyConsistency: parkingPerHousehold 저장값이 계산값과 크게 다르면 hard', () => {
  const { hard } = classifyConsistency(
    baseRow({ parkingCount: 204, totalHouseholds: 165, parkingPerHousehold: 5 }),
    BBOX,
    YEAR
  );
  assert.equal(hard.length, 1);
});

test('classifyConsistency: 부산 범위 밖 좌표(서울)는 hard', () => {
  const { hard } = classifyConsistency(baseRow({ latitude: 37.5, longitude: 127.0 }), BBOX, YEAR);
  assert.equal(hard.length, 1);
});

test('classifyConsistency: 부산 범위 안 좌표는 통과', () => {
  const { hard } = classifyConsistency(baseRow({ latitude: 35.18, longitude: 129.1 }), BBOX, YEAR);
  assert.equal(hard.length, 0);
});

// [TRADE DATA TRUST §6 핵심 규칙 회귀] API 실패 ≠ 거래 없음
test('isApiFailureMisclassifiedAsNoTrade: apiError 있고 trades=0이면 true(오분류 위험)', () => {
  assert.equal(isApiFailureMisclassifiedAsNoTrade('공공데이터 API 호출 실패', 0), true);
});

test('isApiFailureMisclassifiedAsNoTrade: apiError 없고 trades=0이면 false(진짜 무거래)', () => {
  assert.equal(isApiFailureMisclassifiedAsNoTrade(null, 0), false);
});

test('isApiFailureMisclassifiedAsNoTrade: apiError 있어도 trades>0이면 false', () => {
  assert.equal(isApiFailureMisclassifiedAsNoTrade('일부 월 실패', 3), false);
});

test('toIsoDate: 파싱 가능한 날짜는 YYYY-MM-DD로 변환', () => {
  assert.equal(toIsoDate('2026-08-01'), '2026-08-01');
});

test('toIsoDate: 파싱 불가능하면 원본 그대로 반환', () => {
  assert.equal(toIsoDate('알수없음'), '알수없음');
});
