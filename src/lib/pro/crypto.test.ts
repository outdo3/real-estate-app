import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import {
  createLookupHash,
  decryptField,
  encryptField,
  isEncryptedPayload,
  loadPiiKeyring,
  normalizeEmail,
  normalizePhone,
  PiiCryptoError,
  protectPhone,
  reencryptIfStale,
} from './crypto';
import { testRing } from './pro-test-helpers';

// REALTOR_PRO_MVP_V1 — 필드 암호화·조회 해시(합성 값만).

const PHONE = '010-1234-5678';

test('9 · 올바른 키로 복호화 · 8 · 암호문에 평문이 없다', () => {
  const ring = testRing();
  const enc = encryptField(PHONE, ring)!;
  assert.ok(isEncryptedPayload(enc));
  assert.ok(!enc.includes(PHONE) && !enc.includes('12345678') && !enc.includes('5678'));
  assert.equal(decryptField(enc, ring), PHONE);
});

test('랜덤 IV — 같은 평문도 매번 다른 암호문', () => {
  const ring = testRing();
  assert.notEqual(encryptField(PHONE, ring), encryptField(PHONE, ring));
});

test('10 · 다른 키로는 복호화 실패(AUTH_FAILED), 모르는 키 id는 UNKNOWN_KEY', () => {
  const a = testRing('k1');
  const b = testRing('k1');
  const enc = encryptField(PHONE, a)!;
  assert.throws(() => decryptField(enc, b), (e: unknown) => e instanceof PiiCryptoError && e.code === 'AUTH_FAILED');
  assert.throws(() => decryptField(enc, testRing('k9')), (e: unknown) => e instanceof PiiCryptoError && e.code === 'UNKNOWN_KEY');
});

test('변조·형식 오류는 조용히 넘어가지 않는다', () => {
  const ring = testRing();
  const enc = encryptField(PHONE, ring)!;
  const parts = enc.split('.');
  const ct = Buffer.from(parts[4], 'base64url');
  ct[0] ^= 0xff;
  parts[4] = ct.toString('base64url');
  assert.throws(() => decryptField(parts.join('.'), ring), (e: unknown) => e instanceof PiiCryptoError && e.code === 'AUTH_FAILED');
  // 키 id 프리픽스 바꿔치기(AAD 불일치)
  const swapped = enc.replace('.k1.', '.k2.');
  const ring2 = loadPiiKeyring({ REALTOR_PRO_PII_KEY: randomBytes(32).toString('base64'), REALTOR_PRO_LOOKUP_PEPPER: 'x'.repeat(24), REALTOR_PRO_PII_KEY_ID: 'k2' });
  assert.throws(() => decryptField(swapped, ring2), PiiCryptoError);
  for (const bad of ['plain', 'pii.v1.k1.a.b', 'pii.v2.k1.a.b.c', 'pii.v1.k1.!!.b.c']) assert.throws(() => decryptField(bad, ring), PiiCryptoError, bad);
  assert.equal(decryptField(null, ring), null);
  assert.equal(encryptField('', ring), null);
});

test('키 없음·잘못된 키는 명시적 오류(KEY_MISSING/KEY_INVALID)', () => {
  assert.throws(() => loadPiiKeyring({}), (e: unknown) => e instanceof PiiCryptoError && e.code === 'KEY_MISSING');
  assert.throws(() => loadPiiKeyring({ REALTOR_PRO_PII_KEY: 'short', REALTOR_PRO_LOOKUP_PEPPER: 'x'.repeat(24) }), (e: unknown) => e instanceof PiiCryptoError && e.code === 'KEY_INVALID');
  assert.throws(() => loadPiiKeyring({ REALTOR_PRO_PII_KEY: randomBytes(32).toString('base64'), REALTOR_PRO_LOOKUP_PEPPER: 'short' }), PiiCryptoError);
  // hex 키도 받는다
  assert.ok(loadPiiKeyring({ REALTOR_PRO_PII_KEY: randomBytes(32).toString('hex'), REALTOR_PRO_LOOKUP_PEPPER: 'x'.repeat(24) }));
  // 오류 메시지에 키 값이 없다
  try { loadPiiKeyring({ REALTOR_PRO_PII_KEY: 'secretvalue123', REALTOR_PRO_LOOKUP_PEPPER: 'x'.repeat(24) }); } catch (e) { assert.ok(!String((e as Error).message).includes('secretvalue123')); }
});

test('키 회전: 이전 키로 암호화된 값을 읽고 현재 키로 재암호화', () => {
  const oldKey = randomBytes(32).toString('base64');
  const newKey = randomBytes(32).toString('base64');
  const pepper = randomBytes(24).toString('base64');
  const oldRing = loadPiiKeyring({ REALTOR_PRO_PII_KEY: oldKey, REALTOR_PRO_PII_KEY_ID: 'k1', REALTOR_PRO_LOOKUP_PEPPER: pepper });
  const rotated = loadPiiKeyring({ REALTOR_PRO_PII_KEY: newKey, REALTOR_PRO_PII_KEY_ID: 'k2', REALTOR_PRO_PII_KEYS_PREVIOUS: `k1:${oldKey}`, REALTOR_PRO_LOOKUP_PEPPER: pepper });
  const enc = encryptField(PHONE, oldRing)!;
  assert.equal(decryptField(enc, rotated), PHONE);
  const re = reencryptIfStale(enc, rotated)!;
  assert.ok(re.startsWith('pii.v1.k2.'));
  assert.equal(decryptField(re, rotated), PHONE);
  assert.equal(reencryptIfStale(re, rotated), re);
});

test('11 · 전화번호 정규화', () => {
  assert.equal(normalizePhone('010-1234-5678'), '01012345678');
  assert.equal(normalizePhone('+82 10 1234 5678'), '01012345678');
  assert.equal(normalizePhone('(051) 123-4567'), '0511234567');
  for (const bad of ['1234', 'abc', '010-12a4-5678', '999999999999', '']) assert.equal(normalizePhone(bad), null, bad);
  assert.equal(normalizeEmail(' Foo@Example.COM '), 'foo@example.com');
  assert.equal(normalizeEmail('nope'), null);
});

test('12 · 조회 해시는 결정적(같은 번호·다른 표기 → 같은 해시) · 13 · 원문과 다르고 SHA-256(평문)과도 다르다', async () => {
  const ring = testRing();
  const a = createLookupHash('phone', normalizePhone('010-1234-5678'), ring)!;
  const b = createLookupHash('phone', normalizePhone('01012345678'), ring)!;
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.ok(!a.includes('01012345678'));
  const { createHash } = await import('node:crypto');
  assert.notEqual(a, createHash('sha256').update('01012345678').digest('hex'));
  assert.notEqual(a, createHash('sha256').update('phone:01012345678').digest('hex'));
  // 다른 pepper → 다른 해시(사전 대입 방지)
  assert.notEqual(a, createLookupHash('phone', '01012345678', testRing())!);
  // 종류 분리
  assert.notEqual(createLookupHash('email', '01012345678', ring), a);
  const p = protectPhone('010-1234-5678', ring);
  assert.equal(p.hash, a);
  assert.equal(decryptField(p.enc, ring), '01012345678');
  assert.deepEqual(protectPhone('not a phone', ring), { enc: null, hash: null });
});
