import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAuthorizedCronRequest } from './cron-auth';

test('secret이 설정되지 않으면(현재 실제 상태) 무조건 거부한다 — fail closed', () => {
  assert.equal(isAuthorizedCronRequest('Bearer anything', undefined), false);
  assert.equal(isAuthorizedCronRequest(null, undefined), false);
});

test('헤더가 없으면 secret이 설정돼 있어도 거부한다', () => {
  assert.equal(isAuthorizedCronRequest(null, 'real-secret'), false);
});

test('틀린 secret은 거부한다', () => {
  assert.equal(isAuthorizedCronRequest('Bearer wrong-secret', 'real-secret'), false);
});

test('올바른 secret(Bearer 형식)은 허용한다', () => {
  assert.equal(isAuthorizedCronRequest('Bearer real-secret', 'real-secret'), true);
});

test('Bearer 접두사 없이 secret만 보내면 거부한다(형식 정확히 일치해야 함)', () => {
  assert.equal(isAuthorizedCronRequest('real-secret', 'real-secret'), false);
});

test('대소문자/공백이 다른 secret은 거부한다', () => {
  assert.equal(isAuthorizedCronRequest('Bearer Real-Secret', 'real-secret'), false);
  assert.equal(isAuthorizedCronRequest('Bearer real-secret ', 'real-secret'), false);
});
