import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateFavoriteInput, isPendingFavoriteValid, buildPendingFavorite } from './favorites';

test('validateFavoriteInput — lawdCd/dong/name 모두 있으면 통과', () => {
  const result = validateFavoriteInput({ lawdCd: '11680', dong: '역삼동', name: '래미안' });
  assert.equal(result.valid, true);
  if (result.valid) {
    assert.deepEqual(result.data, { lawdCd: '11680', dong: '역삼동', name: '래미안', aptSeq: undefined, address: undefined });
  }
});

test('validateFavoriteInput — 앞뒤 공백은 trim된다', () => {
  const result = validateFavoriteInput({ lawdCd: ' 11680 ', dong: ' 역삼동 ', name: ' 래미안 ' });
  assert.equal(result.valid, true);
  if (result.valid) {
    assert.equal(result.data.lawdCd, '11680');
    assert.equal(result.data.dong, '역삼동');
    assert.equal(result.data.name, '래미안');
  }
});

test('validateFavoriteInput — name 누락 시 실패', () => {
  const result = validateFavoriteInput({ lawdCd: '11680', dong: '역삼동' });
  assert.equal(result.valid, false);
});

test('validateFavoriteInput — 빈 문자열은 누락과 동일하게 처리', () => {
  const result = validateFavoriteInput({ lawdCd: '11680', dong: '  ', name: '래미안' });
  assert.equal(result.valid, false);
});

test('validateFavoriteInput — body가 객체가 아니면 실패', () => {
  assert.equal(validateFavoriteInput(null).valid, false);
  assert.equal(validateFavoriteInput('string').valid, false);
  assert.equal(validateFavoriteInput(undefined).valid, false);
});

test('validateFavoriteInput — aptSeq/address는 optional, 있으면 보존', () => {
  const result = validateFavoriteInput({
    lawdCd: '11680',
    dong: '역삼동',
    name: '래미안',
    aptSeq: '123456',
    address: '서울 강남구 역삼동',
  });
  assert.equal(result.valid, true);
  if (result.valid) {
    assert.equal(result.data.aptSeq, '123456');
    assert.equal(result.data.address, '서울 강남구 역삼동');
  }
});

test('validateFavoriteInput — aptSeq가 빈 문자열이면 undefined로 정규화', () => {
  const result = validateFavoriteInput({ lawdCd: '11680', dong: '역삼동', name: '래미안', aptSeq: '  ' });
  assert.equal(result.valid, true);
  if (result.valid) assert.equal(result.data.aptSeq, undefined);
});

const IDENTITY = { lawdCd: '11680', dong: '역삼동', name: '래미안' };

test('isPendingFavoriteValid — 동일 단지 + TTL 이내면 유효', () => {
  const pending = buildPendingFavorite(IDENTITY);
  assert.equal(isPendingFavoriteValid(pending, IDENTITY, pending.savedAt + 1000), true);
});

test('isPendingFavoriteValid — 다른 단지면 무효(로그인 후 엉뚱한 단지 자동 찜 방지)', () => {
  const pending = buildPendingFavorite(IDENTITY);
  assert.equal(
    isPendingFavoriteValid(pending, { lawdCd: '11680', dong: '역삼동', name: '다른아파트' }, pending.savedAt + 1000),
    false
  );
});

test('isPendingFavoriteValid — TTL(10분) 초과하면 무효', () => {
  const pending = buildPendingFavorite(IDENTITY);
  const elevenMinutesLater = pending.savedAt + 11 * 60 * 1000;
  assert.equal(isPendingFavoriteValid(pending, IDENTITY, elevenMinutesLater), false);
});

test('isPendingFavoriteValid — null/형식 불일치는 무효', () => {
  assert.equal(isPendingFavoriteValid(null, IDENTITY), false);
  assert.equal(isPendingFavoriteValid({ lawdCd: '11680' }, IDENTITY), false);
  assert.equal(isPendingFavoriteValid('not an object', IDENTITY), false);
});
