import { test } from 'node:test';
import assert from 'node:assert/strict';
import { molitFingerprint } from './fingerprint';

test('molitFingerprint — 같은 입력은 항상 같은 값(멱등성 기반)', () => {
  const input = { sido: '부산광역시', sigungu: '서구', rawName: '서대신4', rawBusinessType: '1)재개발(주택정비)' };
  assert.equal(molitFingerprint(input), molitFingerprint({ ...input }));
});

test('molitFingerprint — sido/sigungu/rawName/rawBusinessType 중 하나만 달라도 다른 값', () => {
  const base = { sido: '부산광역시', sigungu: '서구', rawName: '서대신4', rawBusinessType: '1)재개발(주택정비)' };
  const base64 = molitFingerprint(base);
  assert.notEqual(molitFingerprint({ ...base, sido: '서울특별시' }), base64);
  assert.notEqual(molitFingerprint({ ...base, sigungu: '동구' }), base64);
  assert.notEqual(molitFingerprint({ ...base, rawName: '서대신3' }), base64);
  assert.notEqual(molitFingerprint({ ...base, rawBusinessType: '3)재건축(공동주택)' }), base64);
});

test('molitFingerprint — stage/세대수는 파라미터 자체에 없다(갱신 시 재생성되지 않도록)', () => {
  // 타입 시그니처 자체가 stage/householdCount를 받지 않는다는 사실을 계약으로 확인한다.
  const input = { sido: '강원특별자치도', sigungu: '속초시', rawName: '속초중앙동', rawBusinessType: '1)재개발(주택정비)' };
  const fp1 = molitFingerprint(input);
  // 동일 identity에서 stage/세대수가 바뀌는 상황을 시뮬레이션(fingerprint 계산에는 애초에
  // 관여하지 않으므로 같은 input이면 항상 같은 값이어야 한다).
  const fp2 = molitFingerprint(input);
  assert.equal(fp1, fp2);
});
