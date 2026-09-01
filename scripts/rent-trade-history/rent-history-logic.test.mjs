import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeMolitRentItemsToRentRows,
  identityKey,
  areaKey,
  groupKey,
  classifyRentType,
} from './rent-history-logic.ts';
import * as tradeLogic from '../trade-history-logic.ts';

// § PARITY — identityKey/areaKey는 sale(trade-history-logic.ts)과 정의가 완전히
// 동일해야 한다(dealType 값 집합만 다름). 어긋나면 두 도메인의 identity 정의가
// 갈라지는 회귀다.
test('PARITY: identityKey/areaKey가 sale(trade-history-logic.ts)과 동일하게 동작한다', () => {
  const cases = [
    { aptSeq: '26140-1164', name: '대신아파트', dong: '서대신동3가', excluUseArea: 59.99 },
    { aptSeq: null, name: '이름만있는단지', dong: '어떤동', excluUseArea: 84.7855 },
  ];
  for (const c of cases) {
    assert.equal(identityKey(c), tradeLogic.identityKey(c));
    assert.equal(areaKey(c), tradeLogic.areaKey(c));
  }
});

test('classifyRentType: monthlyRent===0이면 jeonse, >0이면 wolse', () => {
  assert.equal(classifyRentType(0), 'jeonse');
  assert.equal(classifyRentType(1), 'wolse');
  assert.equal(classifyRentType(170), 'wolse');
});

function item(overrides = {}) {
  return {
    aptSeq: '26140-1164',
    aptNm: '대신아파트',
    umdNm: '서대신동3가',
    jibun: '100-1',
    excluUseAr: 84.7855,
    floor: 10,
    buildYear: '2015',
    dealYear: 2026,
    dealMonth: 5,
    dealDay: 15,
    deposit: '10,000',
    monthlyRent: 0,
    contractType: '',
    contractTerm: '',
    preDeposit: '',
    preMonthlyRent: '',
    useRRRight: '',
    ...overrides,
  };
}

test('정상 전세 item은 row로 변환되고 identity/group key가 계산된다', () => {
  const { rows, invalid } = normalizeMolitRentItemsToRentRows([item()], '26140', '202605');
  assert.equal(invalid.length, 0);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].dealType, 'jeonse');
  assert.equal(rows[0].deposit, 10000);
  assert.equal(rows[0].monthlyRent, 0);
  assert.equal(rows[0].identityKey, 'id:26140-1164');
  assert.equal(rows[0].groupKeyStr, 'id:26140-1164::84.7855::jeonse');
  assert.equal(rows[0].dealDate, '2026-05-15');
  assert.equal(rows[0].floor, 10);
  assert.equal(rows[0].buildYear, 2015);
});

test('monthlyRent > 0이면 wolse로 분류되고 groupKey의 dealType이 다르다', () => {
  const { rows } = normalizeMolitRentItemsToRentRows([item({ monthlyRent: 50 })], '26140', '202605');
  assert.equal(rows[0].dealType, 'wolse');
  assert.equal(rows[0].groupKeyStr, 'id:26140-1164::84.7855::wolse');
});

// PHASE A §4 — deposit=0, monthlyRent>0 (순수 월세)은 실제 관측된 유효 케이스.
test('deposit=0, monthlyRent>0(순수 월세) edge case는 정상 wolse row로 저장된다', () => {
  const { rows, invalid } = normalizeMolitRentItemsToRentRows([item({ deposit: 0, monthlyRent: 170 })], '26140', '202605');
  assert.equal(invalid.length, 0);
  assert.equal(rows[0].deposit, 0);
  assert.equal(rows[0].monthlyRent, 170);
  assert.equal(rows[0].dealType, 'wolse');
});

test('money unit: 콤마 포함 문자열도 정수로 정확히 파싱된다', () => {
  const { rows } = normalizeMolitRentItemsToRentRows([item({ deposit: '123,456,789' })], '26140', '202605');
  assert.equal(rows[0].deposit, 123456789);
});

test('deposit/monthlyRent가 둘 다 파싱 불가면 MISSING_MONEY invalid', () => {
  const { rows, invalid } = normalizeMolitRentItemsToRentRows([item({ deposit: '', monthlyRent: '' })], '26140', '202605');
  assert.equal(rows.length, 0);
  assert.equal(invalid[0].reason, 'MISSING_MONEY');
});

test('aptSeq 없으면 MISSING_APTSEQ invalid로 blocked(name fallback 없음)', () => {
  const { rows, invalid } = normalizeMolitRentItemsToRentRows([item({ aptSeq: null })], '26140', '202605');
  assert.equal(rows.length, 0);
  assert.equal(invalid[0].reason, 'MISSING_APTSEQ');
});

test('전용면적이 없으면 MISSING_AREA로 분류한다', () => {
  const { invalid } = normalizeMolitRentItemsToRentRows([item({ excluUseAr: '' })], '26140', '202605');
  assert.equal(invalid[0].reason, 'MISSING_AREA');
});

test('연/월/일이 유효하지 않으면 MISSING_DATE로 분류한다', () => {
  const { invalid } = normalizeMolitRentItemsToRentRows([item({ dealMonth: 13 })], '26140', '202605');
  assert.equal(invalid[0].reason, 'MISSING_DATE');
});

test('층 정보가 없으면 MISSING_FLOOR로 분류한다(자연키 구성요소라 null 저장 금지)', () => {
  const { rows, invalid } = normalizeMolitRentItemsToRentRows([item({ floor: '' })], '26140', '202605');
  assert.equal(rows.length, 0);
  assert.equal(invalid[0].reason, 'MISSING_FLOOR');
});

test('contractType null(수집 이전/미기재)은 null로 보존되고 임의 값으로 치환되지 않는다', () => {
  const { rows } = normalizeMolitRentItemsToRentRows([item({ contractType: '' })], '26140', '202605');
  assert.equal(rows[0].contractType, null);
});

test('contractType이 실제 값이면 원본 그대로 저장된다(신규/갱신)', () => {
  // 정규화 함수 내부는 결정적 정렬을 위해 전체 필드 직렬화 순서로 재배열하므로(§ OCCURRENCE
  // DETERMINISM), 반환 배열의 위치가 아니라 값 집합으로 검증한다.
  const { rows } = normalizeMolitRentItemsToRentRows(
    [item({ deposit: 1000, contractType: '신규' }), item({ deposit: 2000, contractType: '갱신' })],
    '26140',
    '202605'
  );
  const types = rows.map((r) => r.contractType).sort();
  assert.deepEqual(types, ['갱신', '신규']);
});

test('useRRRight가 빈 값이면 null(UNKNOWN)이고, false로 임의 치환되지 않는다', () => {
  const { rows } = normalizeMolitRentItemsToRentRows([item({ useRRRight: '' })], '26140', '202605');
  assert.equal(rows[0].useRenewalRight, null);
});

test('useRRRight="사용"이면 true로 저장된다', () => {
  const { rows } = normalizeMolitRentItemsToRentRows([item({ useRRRight: '사용' })], '26140', '202605');
  assert.equal(rows[0].useRenewalRight, true);
});

test('preDeposit/preMonthlyRent가 비어있으면 null이고 0으로 치환되지 않는다', () => {
  const { rows } = normalizeMolitRentItemsToRentRows([item({ preDeposit: '', preMonthlyRent: '' })], '26140', '202605');
  assert.equal(rows[0].preDeposit, null);
  assert.equal(rows[0].preMonthlyRent, null);
});

test('preDeposit/preMonthlyRent 값이 있으면 정수로 저장된다(갱신계약)', () => {
  const { rows } = normalizeMolitRentItemsToRentRows(
    [item({ contractType: '갱신', preDeposit: '9,500', preMonthlyRent: 30 })],
    '26140',
    '202605'
  );
  assert.equal(rows[0].preDeposit, 9500);
  assert.equal(rows[0].preMonthlyRent, 30);
});

test('전용면적 소수점 정밀도가 그대로 보존된다(84.7855, 반올림 금지)', () => {
  const { rows } = normalizeMolitRentItemsToRentRows([item({ excluUseAr: 84.7855 })], '26140', '202605');
  assert.equal(rows[0].exclusiveArea, 84.7855);
});

test('건축년도가 없으면 buildYear는 null이다(0 이하를 실제 값으로 저장 금지)', () => {
  const { rows } = normalizeMolitRentItemsToRentRows([item({ buildYear: '' })], '26140', '202605');
  assert.equal(rows[0].buildYear, null);
});

// PHASE A §11 — 153건 실제 충돌 클래스 재현: 동일 층/면적/가격/날짜, 다른 호실(공개
// 데이터에 없음). 병합하지 않고 occurrenceIndex로 구분해야 한다.
test('완전히 동일한 자연키를 가진 두 계약(다른 호실)은 병합되지 않고 occurrenceIndex로 구분된다', () => {
  const { rows, invalid } = normalizeMolitRentItemsToRentRows([item(), item()], '26140', '202605');
  assert.equal(invalid.length, 0);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].occurrenceIndex, 0);
  assert.equal(rows[1].occurrenceIndex, 1);
  assert.equal(rows[0].groupKeyStr, rows[1].groupKeyStr);
  assert.equal(rows[0].deposit, rows[1].deposit);
  assert.equal(rows[0].monthlyRent, rows[1].monthlyRent);
  assert.equal(rows[0].dealDate, rows[1].dealDate);
  assert.equal(rows[0].floor, rows[1].floor);
});

test('보증금이 다르면 서로 다른 자연키이므로 occurrenceIndex가 둘 다 0이다', () => {
  const { rows } = normalizeMolitRentItemsToRentRows([item({ deposit: 10000 }), item({ deposit: 11000 })], '26140', '202605');
  assert.equal(rows[0].occurrenceIndex, 0);
  assert.equal(rows[1].occurrenceIndex, 0);
});

// § SHUFFLE DETERMINISM — 같은 원본 배열을 순서만 바꿔 넣어도(같은 API 응답을 다시
// 가져온 것과 동치) 최종 자연키(occurrenceIndex 포함) 집합이 동일해야 한다. API
// response 배열 등장 순서에만 의존하면 재동기화 시 동일 계약이 다른 occurrenceIndex를
// 받아 idempotent upsert가 깨진다 — 여기서는 입력 순서를 안정적으로 정렬한 뒤
// normalize하는 정책을 검증한다(§17 TEST).
function naturalKeySet(rows) {
  return new Set(
    rows.map((r) => `${r.groupKeyStr}|${r.deposit}|${r.monthlyRent}|${r.dealDate}|${r.floor}|${r.occurrenceIndex}`)
  );
}

test('원본 순서/역순/셔플 입력이 동일한 자연키 집합을 만든다(occurrenceIndex 결정성)', () => {
  // 서로 다른 aptSeq를 부여해 실제로 구분되는 3개 계약을 만들되, 그중 2개는 완전 동일
  // 자연키(다른 호실)를 갖게 해 정렬 안정성이 실제로 시험되게 한다. 정규화 함수
  // 내부적으로 전체 필드 직렬화 기준 정렬 후 occurrenceIndex를 부여하므로, 호출자가
  // 입력 배열을 API 응답 등장 순서 그대로 넘겨도(원본/역순/셔플 무엇이든) 동일한
  // 자연키 집합이 나와야 한다(§17).
  const original = [
    item({ aptSeq: 'A', deposit: 5000 }),
    item({ aptSeq: 'A', deposit: 5000 }), // A의 진짜 중복(다른 호실)
    item({ aptSeq: 'B', deposit: 8000 }),
  ];
  const reversed = [...original].reverse();
  const shuffled = [original[2], original[0], original[1]];

  const r1 = normalizeMolitRentItemsToRentRows(original, '26140', '202605').rows;
  const r2 = normalizeMolitRentItemsToRentRows(reversed, '26140', '202605').rows;
  const r3 = normalizeMolitRentItemsToRentRows(shuffled, '26140', '202605').rows;

  assert.deepEqual(naturalKeySet(r1), naturalKeySet(r2));
  assert.deepEqual(naturalKeySet(r1), naturalKeySet(r3));
  assert.equal(r1.length, 3);
});
