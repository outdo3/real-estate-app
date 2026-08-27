import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMasterCoordIndex, resolveApartmentCoords } from './map-marker-coords.ts';
import { aptNamesMatch } from './apt-name-match.ts';

const resolve = (index, dong, name, fuzzyCache) => resolveApartmentCoords(index, dong, name, aptNamesMatch, fuzzyCache);

const masters = [
  { name: '연산동한솔솔파크', umdName: '연산동', aptSeq: '26470-1040', buildYear: 2007, latitude: 35.1876, longitude: 129.1041 },
  { name: '해운대한솔솔파크', umdName: '우동', aptSeq: '26350-2115', buildYear: 2003, latitude: 35.16, longitude: 129.13 },
  { name: '대신푸르지오2차', umdName: '동대신동', aptSeq: '26140-9001', buildYear: 2010, latitude: 35.11, longitude: 129.0 },
  { name: '대신푸르지오1차', umdName: '동대신동', aptSeq: '26140-9000', buildYear: 2008, latitude: 35.111, longitude: 129.001 },
  { name: '에이젠아파트', umdName: '연산동', aptSeq: '26470-1049', buildYear: 1998, latitude: null, longitude: null },
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

// B. 표기 차이(MOLIT 원본에 지번/괄호가 붙는 등)로 완전일치가 실패해도, 같은 dong 안에서만
// aptNamesMatch로 안전하게 보강한다.
test('resolveApartmentCoords: 완전일치 실패 시 같은 dong 안에서 aptNamesMatch로 보강한다', () => {
  const index = buildMasterCoordIndex(masters);
  const result = resolve(index, '연산동', '연산동한솔솔파크 101동');
  assert.equal(result.aptSeq, '26470-1040');
});

// C. 차수가 다른 단지는 절대 같은 단지로 보지 않는다(aptNamesMatch의 안전장치 그대로 적용됨).
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
