import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMasterCoordIndex, resolveApartmentCoords } from './map-marker-coords.ts';

const resolve = (index, dong, name) => resolveApartmentCoords(index, dong, name);

const masters = [
  { name: '연산동한솔솔파크', umdName: '연산동', aptSeq: '26470-1040', buildYear: 2007, latitude: 35.1876, longitude: 129.1041 },
  { name: '해운대한솔솔파크', umdName: '우동', aptSeq: '26350-2115', buildYear: 2003, latitude: 35.16, longitude: 129.13 },
  { name: '대신푸르지오2차', umdName: '동대신동', aptSeq: '26140-9001', buildYear: 2010, latitude: 35.11, longitude: 129.0 },
  { name: '대신푸르지오1차', umdName: '동대신동', aptSeq: '26140-9000', buildYear: 2008, latitude: 35.111, longitude: 129.001 },
  { name: '에이젠아파트', umdName: '연산동', aptSeq: '26470-1049', buildYear: 1998, latitude: null, longitude: null },
  // MAP_TIER2_FALLBACK_REMOVAL_V1 회귀 fixture — 실제 오귀속 사례(부산 사상구 주례동)와
  // 같은 모양. `주례` ⊂ `주례일산맨션`이라 예전 2순위 규칙이 이 둘을 같은 단지로 봤다.
  { name: '주례', umdName: '주례동', aptSeq: '26530-72', buildYear: 1983, latitude: 35.153, longitude: 128.985 },
  // 같은 계열의 또 다른 실제 사례(부산 북구 화명동): 대림타운1/2/3이 전부 대림타운으로 접혔다.
  { name: '대림타운', umdName: '화명동', aptSeq: '26320-46', buildYear: 1999, latitude: 35.22, longitude: 129.01 },
];

test('resolveApartmentCoords: dong+name 완전일치는 canonical aptSeq/좌표를 그대로 반환한다', () => {
  const index = buildMasterCoordIndex(masters);
  const result = resolve(index, '연산동', '연산동한솔솔파크');
  assert.equal(result.aptSeq, '26470-1040');
  assert.equal(result.lat, 35.1876);
  assert.equal(result.lng, 129.1041);
});

// A. 같은 브랜드명이 다른 dong에 존재해도(한솔솔파크 사례, 실제 부산 데이터) 이름만으로
// 잘못된 단지를 집어오지 않는다 — dong이 다르면 완전일치도, byDong 폴백도 절대 넘어가지 않는다.
test('resolveApartmentCoords: 같은 이름이라도 dong이 다르면 다른 단지로 혼동하지 않는다', () => {
  const index = buildMasterCoordIndex(masters);
  const result = resolve(index, '연산동', '해운대한솔솔파크');
  assert.equal(result.aptSeq, null, '연산동에 없는 이름이므로 다른 dong의 매칭을 빌려오면 안 된다');
});

// B. MAP_TIER2_FALLBACK_REMOVAL_V1 — 예전에는 같은 dong 안에서 aptNamesMatch(부분포함)로
// 보강했다. 이름 포함 관계는 identity가 아니므로 이제 보강하지 않는다: 표기가 다르면
// 좌표를 빌려오지 않고 marker를 만들지 않는다.
test('resolveApartmentCoords: 완전일치가 아니면 같은 dong이라도 보강하지 않는다(2순위 제거)', () => {
  const index = buildMasterCoordIndex(masters);
  const result = resolve(index, '연산동', '연산동한솔솔파크 101동');
  assert.equal(result.aptSeq, null, '부분포함만으로 다른 단지의 identity를 빌려오면 안 된다');
  assert.equal(result.lat, null);
  assert.equal(result.lng, null);
});

// B-1 회귀(실제 오귀속 사례) — 주례일산맨션은 주례가 아니다.
test('resolveApartmentCoords: 주례일산맨션은 주례로 매칭되지 않는다(확정 오귀속 제거)', () => {
  const index = buildMasterCoordIndex(masters);
  const result = resolve(index, '주례동', '주례일산맨션');
  assert.equal(result.aptSeq, null, '26530-72(주례)의 aptSeq를 물려받으면 안 된다');
  assert.equal(result.lat, null, '주례의 좌표를 재사용하면 안 된다');
  assert.equal(result.lng, null);
});

// B-2 회귀 — 대림타운1은 대림타운이 아니다(차수가 한쪽에만 있어 차수 가드가 걸리지 않던 모양).
test('resolveApartmentCoords: 대림타운1은 대림타운으로 매칭되지 않는다', () => {
  const index = buildMasterCoordIndex(masters);
  const result = resolve(index, '화명동', '대림타운1');
  assert.equal(result.aptSeq, null);
  assert.equal(result.lat, null);
});

// B-3 — 완전일치하는 단지 자신은 그대로 매칭된다(제거가 tier-1을 건드리지 않았다).
test('resolveApartmentCoords: 완전일치하는 주례/대림타운 자신은 정상 매칭된다', () => {
  const index = buildMasterCoordIndex(masters);
  assert.equal(resolve(index, '주례동', '주례').aptSeq, '26530-72');
  assert.equal(resolve(index, '화명동', '대림타운').aptSeq, '26320-46');
});

// C. 차수가 다른 단지는 각자 완전일치로만 붙는다(1차 요청이 2차를 집어오지 않는다).
test('resolveApartmentCoords: 차수가 다르면 매칭하지 않는다(1차 vs 2차)', () => {
  const index = buildMasterCoordIndex(masters);
  const result = resolve(index, '동대신동', '대신푸르지오1차');
  assert.equal(result.aptSeq, '26140-9000');
  assert.notEqual(result.aptSeq, '26140-9001');
});

// D. 매칭되는 단지가 전혀 없으면 aptSeq/좌표 모두 null — 다른 단지로 fallback하지 않는다.
test('resolveApartmentCoords: 매칭 실패 시 aptSeq/좌표 모두 null(다른 단지 fallback 없음)', () => {
  const index = buildMasterCoordIndex(masters);
  const result = resolve(index, '연산동', '존재하지않는단지이름');
  assert.equal(result.aptSeq, null);
  assert.equal(result.lat, null);
  assert.equal(result.lng, null);
});

// E. aptSeq는 매칭됐지만 ApartmentMaster에 좌표가 없는 경우, 추정 좌표를 만들지 않고
// 정직하게 null로 남긴다(AGENTS.md "추정 좌표 생성 금지").
test('resolveApartmentCoords: 매칭된 master에 좌표가 없으면 좌표는 null이지만 aptSeq는 보존한다', () => {
  const index = buildMasterCoordIndex(masters);
  const result = resolve(index, '연산동', '에이젠아파트');
  assert.equal(result.aptSeq, '26470-1049');
  assert.equal(result.lat, null);
  assert.equal(result.lng, null);
});

test('buildMasterCoordIndex: 같은 dong+name이 여러 번 있으면 첫 항목만 채택한다(결정론적)', () => {
  const dupMasters = [
    { name: 'A', umdName: '동', aptSeq: 'seq-1', buildYear: 2000, latitude: 1, longitude: 1 },
    { name: 'A', umdName: '동', aptSeq: 'seq-2', buildYear: 2001, latitude: 2, longitude: 2 },
  ];
  const index = buildMasterCoordIndex(dupMasters);
  const result = resolve(index, '동', 'A');
  assert.equal(result.aptSeq, 'seq-1');
});
