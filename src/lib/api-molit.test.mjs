import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCancellationFields } from './api-molit.ts';

// TRADE_CANCELLATION_AUDIT_V1 — 실제 live MOLIT 응답은 영문 필드명(cdealType/cdealDay/
// rgstDate)만 내려준다(2026-08-30 실측, 부산 3개구 12개월 13,716건 스캔). 과거 코드는
// 한글 필드명(해제여부/해제사유발생일/등기일자)만 확인해 항상 매칭 실패했다.

test('live 응답 영문 필드명(cdealType=O)이 취소로 인식된다', () => {
  const item = { cdealType: 'O', cdealDay: '26.08.04', rgstDate: '' };
  const result = parseCancellationFields(item);
  assert.equal(result.dealCanceled, true);
  assert.equal(result.cancelDate, '26.08.04');
});

test('cdealType이 빈 문자열이면 정상(미취소) 거래다', () => {
  const item = { cdealType: '', cdealDay: '', rgstDate: '26.09.01' };
  const result = parseCancellationFields(item);
  assert.equal(result.dealCanceled, false);
  assert.equal(result.cancelDate, '');
  assert.equal(result.registryDate, '26.09.01');
});

test('cdealType 필드 자체가 없으면(구버전 응답 등) 정상(미취소)으로 처리한다', () => {
  const item = { dealAmount: '65,000' };
  const result = parseCancellationFields(item);
  assert.equal(result.dealCanceled, false);
  assert.equal(result.cancelDate, '');
  assert.equal(result.registryDate, '');
});

test('한글 필드명(해제여부/해제사유발생일)도 여전히 인식한다(하위 호환)', () => {
  const item = { 해제여부: 'O', 해제사유발생일: '20260804', 등기일자: '20260901' };
  const result = parseCancellationFields(item);
  assert.equal(result.dealCanceled, true);
  assert.equal(result.cancelDate, '20260804');
  assert.equal(result.registryDate, '20260901');
});

test('cdealType이 O가 아닌 다른 값이면 취소로 오인하지 않는다', () => {
  const item = { cdealType: 'X' };
  const result = parseCancellationFields(item);
  assert.equal(result.dealCanceled, false);
});

test('cdealType에 공백이 섞여도(원본 오염 대비) trim 후 정확히 매칭한다', () => {
  const item = { cdealType: ' O ' };
  const result = parseCancellationFields(item);
  assert.equal(result.dealCanceled, true);
});
