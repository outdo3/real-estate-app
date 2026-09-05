// RENT_OCCURRENCE_SAFETY_V1 §7 — Option E group insert guard 테스트.
//
// 실제 정규화 경로(normalizeMolitRentItemsToRentRows)를 그대로 써서 occurrenceIndex가
// 진짜로 어떻게 매겨지는지까지 함께 검증한다 — 가짜 fixture로 슬롯을 손으로 매기면
// 이번 버그(정렬 순위 밀림)를 재현할 수 없다.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RENT_COMPARE_FIELDS,
  planRentCellWrites,
  rentOccurrenceGroupKey,
  rentNaturalKeyStr,
} from './rent-group-guard-logic.ts';
import { normalizeMolitRentItemsToRentRows } from './rent-history-logic.ts';

const LAWD = '26170';
const YMD = '202608';

/** 실측된 26170:202608 오염 사례를 그대로 본뜬 raw MOLIT item. */
function item(overrides = {}) {
  return {
    aptSeq: '26170-825',
    aptNm: 'e편한세상부산항',
    umdNm: '초량동',
    jibun: '1218',
    excluUseAr: '84.6836',
    floor: '29',
    buildYear: '2019',
    dealYear: '2026',
    dealMonth: '8',
    dealDay: '29',
    deposit: '40,000',
    monthlyRent: '0',
    contractType: '신규',
    contractTerm: '26.10~28.10',
    ...overrides,
  };
}

/** 정규화된 feed row는 구조적으로 그대로 "기존 DB row" 역할을 할 수 있다(필드명/의미 동일). */
function normalize(items) {
  const { rows, invalid } = normalizeMolitRentItemsToRentRows(items, LAWD, YMD);
  assert.equal(invalid.length, 0, '테스트 fixture는 전부 유효해야 한다');
  return rows;
}

test('COMPARE_FIELDS 계약 — 자연키 밖 서술 필드 9개가 그대로 유지된다', () => {
  assert.deepEqual([...RENT_COMPARE_FIELDS], [
    'aptName', 'dong', 'jibun', 'buildYear', 'contractType',
    'contractTerm', 'preDeposit', 'preMonthlyRent', 'useRenewalRight',
  ]);
});

// ── CASE 1 — 깨끗한 단일 행 그룹: 기존 동작 그대로 ────────────────────────
test('CASE 1a: DB에 동일 행이 이미 있으면 unchanged, 쓰기 0 (기존 동작 유지)', () => {
  const rows = normalize([item()]);
  const plan = planRentCellWrites(rows, rows);
  assert.equal(plan.unchanged, 1);
  assert.equal(plan.inserts.length, 0);
  assert.equal(plan.skippedInserts.length, 0);
  assert.equal(plan.guardedGroups.length, 0);
  assert.equal(plan.reviewDiffs.length, 0);
});

test('CASE 1b: DB가 비어 있으면 신규 INSERT는 그대로 허용된다 (가드가 막지 않는다)', () => {
  const rows = normalize([item()]);
  const plan = planRentCellWrites(rows, []);
  assert.equal(plan.inserts.length, 1);
  assert.equal(plan.skippedInserts.length, 0);
  assert.equal(plan.guardedGroups.length, 0);
  assert.equal(plan.reviewCandidateFieldCount, 0);
});

// ── CASE 2 — 늦게 추가된 형제가 기존 형제보다 **앞으로** 정렬되는 경우 ─────
// 이것이 2026-09-05에 실제로 오염을 만든 시나리오다.
test('CASE 2: 새 형제가 앞으로 정렬되면 review 발생 + 그 그룹 INSERT까지 전면 보류', () => {
  const oldItem = item({ contractTerm: '26.10~28.10' });
  const newItem = item({ contractTerm: '26.09~28.09' }); // '26.09…' < '26.10…' → 앞으로 정렬

  const db = normalize([oldItem]); // 최초 sync 시점의 DB 상태(1행, occ0)
  assert.equal(db.length, 1);
  assert.equal(db[0].occurrenceIndex, 0);

  const source = normalize([oldItem, newItem]); // 원천이 형제를 하나 더 갖게 됨
  assert.equal(source.length, 2);
  // 슬롯이 실제로 밀렸는지 확인 — 신규 행이 occ0을 가져간다.
  assert.equal(source.find((r) => r.occurrenceIndex === 0).contractTerm, '26.09~28.09');
  assert.equal(source.find((r) => r.occurrenceIndex === 1).contractTerm, '26.10~28.10');

  const plan = planRentCellWrites(source, db);

  // review candidate 1건(contractTerm)
  assert.equal(plan.reviewDiffs.length, 1);
  assert.deepEqual(plan.reviewDiffs[0].fields, ['contractTerm']);
  assert.equal(plan.reviewDiffs[0].match.contractTerm, '26.10~28.10');
  assert.equal(plan.reviewDiffs[0].row.contractTerm, '26.09~28.09');
  assert.equal(plan.reviewCandidateFieldCount, 1);

  // UPDATE 0 (RENT는 애초에 UPDATE 경로가 없다) AND INSERT 0 — Option E 불변식
  assert.equal(plan.inserts.length, 0, '가드된 그룹에는 INSERT가 하나도 없어야 한다');
  assert.equal(plan.skippedInserts.length, 1, '밀려난 기존 내용의 복제본 INSERT가 보류돼야 한다');
  assert.deepEqual(plan.guardedGroups, [rentOccurrenceGroupKey(db[0])]);

  // 가드 이전 동작이었다면 이 행이 INSERT되어 "26.10~28.10"이 DB에 2개가 됐을 것이다.
  assert.equal(plan.skippedInserts[0].contractTerm, '26.10~28.10');
});

// ── CASE 3 — 늦게 추가된 형제가 **뒤로** 정렬되는 경우(안전 경로) ─────────
test('CASE 3: 새 형제가 뒤로 정렬되면 기존 행이 밀리지 않아 정상 INSERT된다', () => {
  const oldItem = item({ contractTerm: '26.09~28.09' });
  const newItem = item({ contractTerm: '26.10~28.10' }); // 뒤로 정렬

  const db = normalize([oldItem]);
  const source = normalize([oldItem, newItem]);
  assert.equal(source.find((r) => r.occurrenceIndex === 0).contractTerm, '26.09~28.09');

  const plan = planRentCellWrites(source, db);

  // 기존 행 변경 없음 → review 0 → 가드 미발동
  assert.equal(plan.reviewDiffs.length, 0);
  assert.equal(plan.guardedGroups.length, 0);
  assert.equal(plan.unchanged, 1);
  assert.equal(plan.inserts.length, 1);
  assert.equal(plan.inserts[0].contractTerm, '26.10~28.10');
  assert.equal(plan.inserts[0].occurrenceIndex, 1);
  assert.equal(plan.skippedInserts.length, 0);
});

// ── CASE 4 — 한 셀에 가드된 그룹 + 깨끗한 그룹이 함께 있는 경우 ───────────
test('CASE 4: 가드는 그룹 단위다 — 같은 셀의 무관한 깨끗한 그룹은 정상 INSERT된다', () => {
  const dirtyOld = item({ contractTerm: '26.10~28.10' });
  const dirtyNew = item({ contractTerm: '26.09~28.09' });
  // 다른 자연 그룹(다른 단지/보증금/층)
  const cleanNew = item({ aptSeq: '26170-999', aptNm: '다른단지', deposit: '25,000', floor: '7' });

  const db = normalize([dirtyOld]);
  const source = normalize([dirtyOld, dirtyNew, cleanNew]);

  const plan = planRentCellWrites(source, db);

  assert.equal(plan.guardedGroups.length, 1, '가드는 문제 그룹 하나에만 걸린다');
  assert.equal(plan.reviewDiffs.length, 1);

  // 깨끗한 그룹의 INSERT는 살아남는다
  assert.equal(plan.inserts.length, 1);
  assert.equal(plan.inserts[0].aptSeq, '26170-999');

  // 가드된 그룹의 INSERT만 보류된다
  assert.equal(plan.skippedInserts.length, 1);
  assert.equal(plan.skippedInserts[0].aptSeq, '26170-825');

  // 셀 전체가 막히지 않았음을 명시적으로 확인
  assert.notEqual(plan.inserts.length, 0, '셀 전체를 막으면 안 된다(§3 group-level guard)');
});

// ── CASE 5 — 내용이 완전히 동일한 정당한 형제(호실 미공개로 실제 존재) ────
test('CASE 5a: 원천에 내용 동일 형제가 2건이면 2건 모두 INSERT된다(병합 금지)', () => {
  const source = normalize([item(), item()]);
  assert.equal(source.length, 2);
  assert.deepEqual(source.map((r) => r.occurrenceIndex).sort(), [0, 1]);

  const plan = planRentCellWrites(source, []);
  assert.equal(plan.inserts.length, 2, '정당한 동일내용 형제를 합치지 않는다');
  assert.equal(plan.guardedGroups.length, 0);
  assert.equal(plan.reviewDiffs.length, 0);
});

test('CASE 5b: 동일내용 형제 2건이 이미 DB에 있으면 재실행해도 아무 변화가 없다(멱등)', () => {
  const source = normalize([item(), item()]);
  const plan = planRentCellWrites(source, source);
  assert.equal(plan.unchanged, 2);
  assert.equal(plan.inserts.length, 0);
  assert.equal(plan.skippedInserts.length, 0);
  assert.equal(plan.guardedGroups.length, 0);
  assert.equal(plan.reviewDiffs.length, 0);
});

// ── 부가 계약 ─────────────────────────────────────────────────────────────
test('floor가 null인 기존 행은 매칭 대상에서 제외된다(자연키에 floor 필수)', () => {
  const rows = normalize([item()]);
  const dbWithNullFloor = [{ ...rows[0], floor: null }];
  const plan = planRentCellWrites(rows, dbWithNullFloor);
  // 매칭되지 않으므로 신규 INSERT로 취급되고, review는 발생하지 않는다.
  assert.equal(plan.inserts.length, 1);
  assert.equal(plan.reviewDiffs.length, 0);
  assert.equal(plan.guardedGroups.length, 0);
});

test('그룹 key는 occurrenceIndex를 포함하지 않고, 자연키는 포함한다', () => {
  const rows = normalize([item(), item()]);
  assert.equal(rentOccurrenceGroupKey(rows[0]), rentOccurrenceGroupKey(rows[1]));
  assert.notEqual(rentNaturalKeyStr(rows[0]), rentNaturalKeyStr(rows[1]));
});

test('2026-09-05 실측 오염(26260:202607)도 동일하게 가드된다', () => {
  const base = {
    aptSeq: '26260-163', aptNm: '명장경동', umdNm: '명장동', jibun: '22-1',
    excluUseAr: '84.59', floor: '6', buildYear: '1992',
    dealYear: '2026', dealMonth: '7', dealDay: '30',
    deposit: '20,000', monthlyRent: '0', contractType: '신규',
  };
  const db = normalizeMolitRentItemsToRentRows([{ ...base, contractTerm: '27.09~29.09' }], '26260', '202607').rows;
  const source = normalizeMolitRentItemsToRentRows(
    [{ ...base, contractTerm: '27.09~29.09' }, { ...base, contractTerm: '26.09~28.09' }],
    '26260',
    '202607'
  ).rows;

  const plan = planRentCellWrites(source, db);
  assert.equal(plan.reviewDiffs.length, 1);
  assert.deepEqual(plan.reviewDiffs[0].fields, ['contractTerm']);
  assert.equal(plan.inserts.length, 0);
  assert.equal(plan.skippedInserts.length, 1);
});
