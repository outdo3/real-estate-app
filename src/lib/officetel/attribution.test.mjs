// OFFICETEL FINAL QA — 귀속 판정 회귀 테스트.
//
// 이 모듈이 지키는 계약은 하나다: **실패한 귀속을 "거래 없음"으로 위장하지 않는다.**
// 다중 동 단지(이안해운대 5동 등)는 원천이 동을 구분해 주지 않아 연결이 0건인데,
// 그걸 "매매 거래 없음"이라고 쓰면 실제 1,350건이 있는 주소에 대고 거짓을 말하게 된다.
//
// 실행: node --experimental-strip-types --test src/lib/officetel/attribution.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveAttribution,
  officetelEmptyRowsLabel,
  officetelAttributionNote,
} from './attribution.ts';

const base = { linkedSale: 0, linkedRent: 0, unlinkedSale: 0, unlinkedRent: 0, mastersAtAddress: 1 };

// ── 세 상태가 섞이지 않는다 ───────────────────────────────────────────
test('연결된 거래가 있으면 ATTRIBUTED', () => {
  assert.equal(resolveAttribution({ ...base, linkedSale: 124, linkedRent: 162 }).status, 'ATTRIBUTED');
  assert.equal(resolveAttribution({ ...base, linkedSale: 1 }).status, 'ATTRIBUTED');
  assert.equal(resolveAttribution({ ...base, linkedRent: 1 }).status, 'ATTRIBUTED');
});

test('연결 0건인데 같은 주소에 거래가 있으면 UNATTRIBUTED_AT_ADDRESS', () => {
  const a = resolveAttribution({ ...base, unlinkedSale: 680, unlinkedRent: 670, mastersAtAddress: 5 });
  assert.equal(a.status, 'UNATTRIBUTED_AT_ADDRESS');
  assert.equal(a.unlinkedSale, 680);
  assert.equal(a.unlinkedRent, 670);
  assert.equal(a.mastersAtAddress, 5);
});

test('원천에도 없을 때만 NO_TRANSACTIONS — 이것만이 신뢰할 수 있는 0이다', () => {
  assert.equal(resolveAttribution(base).status, 'NO_TRANSACTIONS');
});

test('연결이 있으면 같은 주소의 미연결 건수는 상태를 바꾸지 않는다', () => {
  const a = resolveAttribution({ linkedSale: 5, linkedRent: 0, unlinkedSale: 99, unlinkedRent: 99, mastersAtAddress: 3 });
  assert.equal(a.status, 'ATTRIBUTED');
});

test('음수/NaN/문자열 같은 이상 입력은 0으로 취급한다', () => {
  const a = resolveAttribution({ linkedSale: -3, linkedRent: NaN, unlinkedSale: '7', unlinkedRent: null, mastersAtAddress: -1 });
  assert.equal(a.status, 'NO_TRANSACTIONS');
  assert.equal(a.unlinkedSale, 0);
});

// ── 빈 목록 문구 ─────────────────────────────────────────────────────
test('진짜 0일 때만 "거래 없음"이라고 쓴다', () => {
  assert.equal(officetelEmptyRowsLabel('sale', 'NO_TRANSACTIONS'), '매매 거래 없음');
  assert.equal(officetelEmptyRowsLabel('jeonse', 'NO_TRANSACTIONS'), '전세 거래 없음');
  assert.equal(officetelEmptyRowsLabel('wolse', 'NO_TRANSACTIONS'), '월세 거래 없음');
});

test('귀속 불가일 때는 어느 탭에서도 "거래 없음"이라고 쓰지 않는다', () => {
  for (const tab of ['sale', 'jeonse', 'wolse']) {
    const label = officetelEmptyRowsLabel(tab, 'UNATTRIBUTED_AT_ADDRESS');
    assert.ok(!label.includes('거래 없음'), `${tab}: ${label}`);
    assert.match(label, /구분할 수 없어/);
  }
});

// ── 안내문 ───────────────────────────────────────────────────────────
test('안내문은 귀속 불가일 때만 나오고 건수를 밝힌다', () => {
  assert.equal(officetelAttributionNote(resolveAttribution(base)), null);
  assert.equal(officetelAttributionNote(resolveAttribution({ ...base, linkedSale: 3 })), null);

  const note = officetelAttributionNote(
    resolveAttribution({ ...base, unlinkedSale: 680, unlinkedRent: 670, mastersAtAddress: 5 })
  );
  assert.match(note, /5개 동/);
  assert.match(note, /매매 680건/);
  assert.match(note, /전월세 670건/);
  assert.ok(!note.includes('거래 없음'));
});

test('한쪽만 있으면 그쪽만 적는다 — 0건을 지어내지 않는다', () => {
  const saleOnly = officetelAttributionNote(resolveAttribution({ ...base, unlinkedSale: 18, mastersAtAddress: 3 }));
  assert.match(saleOnly, /매매 18건/);
  assert.ok(!saleOnly.includes('전월세'));

  const rentOnly = officetelAttributionNote(resolveAttribution({ ...base, unlinkedRent: 124, mastersAtAddress: 2 }));
  assert.match(rentOnly, /전월세 124건/);
  assert.ok(!rentOnly.includes('매매'));
});

test('동이 하나뿐이면 동 개수를 주장하지 않는다', () => {
  const note = officetelAttributionNote(resolveAttribution({ ...base, unlinkedSale: 4, mastersAtAddress: 1 }));
  assert.ok(!note.includes('개 동'));
  assert.match(note, /매매 4건/);
});
