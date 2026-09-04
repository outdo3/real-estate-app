import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRegistryOnlyUpdateFields,
  classifyRow,
  isRegistrySupplementUnambiguous,
  occurrenceGroupKey,
} from './write-policy-logic.ts';

function row(overrides = {}) {
  return {
    lawdCd: '26140', dealYmd: '202608', aptSeq: '26140-1', identityKey: 'id:26140-1', dealType: 'sale',
    groupKeyStr: 'id:26140-1::84.0::sale', aptName: '테스트단지', dong: '테스트동', jibun: null,
    exclusiveArea: 84.0, dealAmount: 50000, dealYear: 2026, dealMonth: 8, dealDay: 1, dealDate: '2026-08-01',
    floor: 5, buildYear: 2020, dealCanceled: false, cancelDate: null, registryDate: null, occurrenceIndex: 0, rawUid: null,
    ...overrides,
  };
}
function existing(overrides = {}) {
  return { id: 1, aptName: '테스트단지', dong: '테스트동', dealCanceled: false, registryDate: null, ...overrides };
}

test('aptSeq 있고 기존 row 없으면 insert', () => {
  assert.equal(classifyRow(row({ aptSeq: '26140-1' }), undefined), 'insert');
});

test('aptSeq 없고 기존 row 없으면 reviewRequired(name+dong만으로 canonical apartment에 편입 금지)', () => {
  assert.equal(classifyRow(row({ aptSeq: null }), undefined), 'reviewRequired');
});

test('aptSeq가 빈 문자열이어도 reviewRequired(falsy 취급)', () => {
  assert.equal(classifyRow(row({ aptSeq: '' }), undefined), 'reviewRequired');
});

test('기존 row와 aptName이 다르면 aptSeq 유무와 무관하게 conflict', () => {
  assert.equal(classifyRow(row({ aptName: '다른단지' }), existing({ aptName: '테스트단지' })), 'conflict');
});

test('기존 row와 dong이 다르면 conflict', () => {
  assert.equal(classifyRow(row({ dong: '다른동' }), existing({ dong: '테스트동' })), 'conflict');
});

test('기존 row와 dealCanceled가 같으면 noop', () => {
  assert.equal(classifyRow(row({ dealCanceled: false }), existing({ dealCanceled: false })), 'noop');
  assert.equal(classifyRow(row({ dealCanceled: true }), existing({ dealCanceled: true })), 'noop');
});

test('false→true는 updateFalseToTrue(반영)', () => {
  assert.equal(classifyRow(row({ dealCanceled: true }), existing({ dealCanceled: false })), 'updateFalseToTrue');
});

test('true→false는 updateTrueToFalseSkipped(§14 가드, 절대 되돌리지 않음)', () => {
  assert.equal(classifyRow(row({ dealCanceled: false }), existing({ dealCanceled: true })), 'updateTrueToFalseSkipped');
});

test('기존 row가 있으면 aptSeq 유무와 무관하게 insert/reviewRequired로 가지 않는다(신규 판정만 aptSeq 게이트 적용)', () => {
  assert.equal(classifyRow(row({ aptSeq: null, dealCanceled: true }), existing({ dealCanceled: false })), 'updateFalseToTrue');
});

// ── TRADE_REGISTRY_DATA_V1.1 §9 — registryDate self-heal ──────────────────────

test('A. DB registryDate NULL + 원천 값 있음 → updateRegistryOnly', () => {
  assert.equal(
    classifyRow(row({ registryDate: '25.03.14' }), existing({ registryDate: null })),
    'updateRegistryOnly'
  );
});

test('B. DB 값 있음 + 원천 동일 값 → noop(쓰지 않음)', () => {
  assert.equal(
    classifyRow(row({ registryDate: '25.03.14' }), existing({ registryDate: '25.03.14' })),
    'noop'
  );
});

test('C. DB 값 있음 + 원천 값 다름 → noop(덮어쓰기 금지)', () => {
  assert.equal(
    classifyRow(row({ registryDate: '25.09.09' }), existing({ registryDate: '25.03.14' })),
    'noop'
  );
  // write contract 층에서도 독립적으로 차단된다.
  assert.equal(buildRegistryOnlyUpdateFields({ registryDate: '25.09.09' }, { registryDate: '25.03.14' }), null);
});

test('D. 취소 flip이 registryDate 보충보다 우선한다(DB false + 원천 true, registryDate도 보충 가능한 상황)', () => {
  assert.equal(
    classifyRow(row({ dealCanceled: true, registryDate: '25.03.14' }), existing({ dealCanceled: false, registryDate: null })),
    'updateFalseToTrue'
  );
});

test('E. DB true + 원천 false → updateTrueToFalseSkipped(registryDate가 있어도 downgrade 경로 유지)', () => {
  assert.equal(
    classifyRow(row({ dealCanceled: false, registryDate: '25.03.14' }), existing({ dealCanceled: true, registryDate: null })),
    'updateTrueToFalseSkipped'
  );
});

test('F. identity conflict면 registryDate 보충하지 않는다', () => {
  assert.equal(
    classifyRow(row({ aptName: '다른단지', registryDate: '25.03.14' }), existing({ registryDate: null })),
    'conflict'
  );
  assert.equal(
    classifyRow(row({ dong: '다른동', registryDate: '25.03.14' }), existing({ registryDate: null })),
    'conflict'
  );
});

test('G. 형제 occurrence의 registryDate가 엇갈리면 ambiguous(보충 금지)', () => {
  // 단일 행 그룹은 언제나 명확하다.
  assert.equal(isRegistrySupplementUnambiguous([{ registryDate: '25.03.14' }]), true);
  // 형제 전원이 같은 값 → 순서가 뒤바뀌어도 결과가 같으므로 안전.
  assert.equal(
    isRegistrySupplementUnambiguous([{ registryDate: '25.03.14' }, { registryDate: '25.03.14' }]),
    true
  );
  // 한쪽만 등기 완료 → 순서가 흔들리면 잘못된 행에 쓸 수 있으므로 금지.
  assert.equal(isRegistrySupplementUnambiguous([{ registryDate: '25.03.14' }, { registryDate: null }]), false);
  assert.equal(
    isRegistrySupplementUnambiguous([{ registryDate: '25.03.14' }, { registryDate: '25.08.01' }]),
    false
  );
});

test('H. 원천 registryDate가 없으면 noop(NULL로 만들지 않음)', () => {
  assert.equal(classifyRow(row({ registryDate: null }), existing({ registryDate: null })), 'noop');
  assert.equal(classifyRow(row({ registryDate: '' }), existing({ registryDate: null })), 'noop');
  assert.equal(buildRegistryOnlyUpdateFields({ registryDate: null }, { registryDate: '25.03.14' }), null);
  assert.equal(buildRegistryOnlyUpdateFields({ registryDate: null }, { registryDate: null }), null);
});

test('취소된 거래는 registryDate를 보충하지 않는다(원천이 등기일자를 주지 않는 영역)', () => {
  assert.equal(
    classifyRow(row({ dealCanceled: true, registryDate: '25.03.14' }), existing({ dealCanceled: true, registryDate: null })),
    'noop'
  );
});

test('write contract는 registryDate 단 하나의 필드만 반환한다', () => {
  const fields = buildRegistryOnlyUpdateFields({ registryDate: '25.03.14' }, { registryDate: null });
  assert.deepEqual(fields, { registryDate: '25.03.14' });
  assert.deepEqual(Object.keys(fields), ['registryDate']);
});

test('occurrenceGroupKey는 occurrenceIndex를 제외한 자연키로 형제를 묶는다', () => {
  const a = occurrenceGroupKey({ groupKeyStr: 'g', dealAmount: 50000, dealDate: '2026-08-01', floor: 5 });
  const b = occurrenceGroupKey({ groupKeyStr: 'g', dealAmount: 50000, dealDate: '2026-08-01', floor: 5 });
  const c = occurrenceGroupKey({ groupKeyStr: 'g', dealAmount: 50000, dealDate: '2026-08-01', floor: 6 });
  assert.equal(a, b);
  assert.notEqual(a, c);
});
