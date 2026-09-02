import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFinanceFitUrl, parseFinanceFitUrl } from './url';

test('buildFinanceFitUrl → parseFinanceFitUrl: identity와 참고가격이 그대로 왕복된다', () => {
  const seed = {
    name: '롯데캐슬',
    lawdCd: '26530',
    dong: '엄궁동',
    aptSeq: '26530-837',
    refPriceWon: 315_000_000,
    refTradeDate: '2026-08-20',
  };
  const url = buildFinanceFitUrl(seed);
  const qs = new URLSearchParams(url.split('?')[1]);
  const parsed = parseFinanceFitUrl(qs);
  assert.deepEqual(parsed, seed);
});

test('민감 금액(availableCash/loanAmount)은 애초에 이 계약에 존재하지 않는다', () => {
  const url = buildFinanceFitUrl({ name: '테스트', lawdCd: '26110', dong: '중앙동' });
  assert.equal(url.includes('cash'), false);
  assert.equal(url.includes('loan'), false);
});

test('name 없는 쿼리는 null을 반환한다(진입 컨텍스트 없음 = 수동 입력 모드)', () => {
  const parsed = parseFinanceFitUrl(new URLSearchParams());
  assert.equal(parsed, null);
});

test('refPrice 없이도 identity만으로 유효하게 파싱된다', () => {
  const url = buildFinanceFitUrl({ name: '테스트', lawdCd: '26110', dong: '중앙동' });
  const qs = new URLSearchParams(url.split('?')[1]);
  const parsed = parseFinanceFitUrl(qs);
  assert.equal(parsed?.refPriceWon, undefined);
  assert.equal(parsed?.name, '테스트');
});
