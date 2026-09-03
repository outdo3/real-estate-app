// ADMIN_ACCESS_FIX_V1 §7 — 관리자 판정 단위 테스트(네트워크/DB 없음).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAdminByEnvEmail, isAdminSessionUser } from './admin-access.ts';

function withAdminEmail(value, fn) {
  const prev = process.env.ADMIN_EMAIL;
  if (value === undefined) delete process.env.ADMIN_EMAIL;
  else process.env.ADMIN_EMAIL = value;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.ADMIN_EMAIL;
    else process.env.ADMIN_EMAIL = prev;
  }
}

// --- DB role 경로 -----------------------------------------------------------

test('role이 ADMIN이면 관리자다(ADMIN_EMAIL 미설정이어도)', () => {
  withAdminEmail(undefined, () => {
    assert.equal(isAdminSessionUser({ role: 'ADMIN', email: 'someone@example.com' }), true);
  });
});

test('일반 role은 관리자가 아니다', () => {
  withAdminEmail(undefined, () => {
    for (const role of ['USER', 'GUEST', 'VERIFIED']) {
      assert.equal(isAdminSessionUser({ role, email: 'someone@example.com' }), false, `${role}이 관리자로 판정되면 안 된다`);
    }
  });
});

// --- ADMIN_EMAIL 부트스트랩 경로 --------------------------------------------

test('ADMIN_EMAIL과 일치하면 role이 USER여도 관리자다(부트스트랩)', () => {
  withAdminEmail('owner@example.com', () => {
    assert.equal(isAdminSessionUser({ role: 'USER', email: 'owner@example.com' }), true);
  });
});

test('ADMIN_EMAIL 비교는 대소문자와 공백을 무시한다', () => {
  withAdminEmail('  Owner@Example.COM  ', () => {
    assert.equal(isAdminSessionUser({ role: 'USER', email: 'owner@example.com' }), true);
    assert.equal(isAdminSessionUser({ role: 'USER', email: '  OWNER@EXAMPLE.com ' }), true);
  });
});

test('다른 이메일은 관리자가 아니다', () => {
  withAdminEmail('owner@example.com', () => {
    assert.equal(isAdminSessionUser({ role: 'USER', email: 'someone-else@example.com' }), false);
  });
});

// --- fail-closed 경계 -------------------------------------------------------

test('ADMIN_EMAIL 미설정이면 이메일만으로는 절대 관리자가 되지 않는다', () => {
  withAdminEmail(undefined, () => {
    assert.equal(isAdminByEnvEmail('owner@example.com'), false);
    assert.equal(isAdminSessionUser({ role: 'USER', email: 'owner@example.com' }), false);
  });
});

test('ADMIN_EMAIL이 빈 문자열이면 관리자를 만들지 않는다(모두 통과 금지)', () => {
  withAdminEmail('', () => {
    assert.equal(isAdminByEnvEmail(''), false, '빈 secret과 빈 email이 일치로 취급되면 안 된다');
    assert.equal(isAdminByEnvEmail('owner@example.com'), false);
    assert.equal(isAdminSessionUser({ role: 'USER', email: '' }), false);
  });
});

test('이메일이 없는 계정(예: 이메일 미제공 소셜 로그인)은 env 경로로 관리자가 될 수 없다', () => {
  withAdminEmail('owner@example.com', () => {
    assert.equal(isAdminSessionUser({ role: 'USER', email: null }), false);
    assert.equal(isAdminSessionUser({ role: 'USER', email: undefined }), false);
    assert.equal(isAdminSessionUser({ role: 'USER' }), false);
  });
});

test('세션이 없으면 관리자가 아니다(미로그인)', () => {
  withAdminEmail('owner@example.com', () => {
    assert.equal(isAdminSessionUser(null), false);
    assert.equal(isAdminSessionUser(undefined), false);
  });
});
