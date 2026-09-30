// REALTOR_PRO_MVP_V1 — 요청 가드 테스트(CSRF 판정 · JSON 강제 · 로그 요약에 메시지 없음)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isJsonContentType, isSameOriginWrite, summarizeErrorForLog } from './request-guards';

const H = (o: Record<string, string>) => ({ get: (n: string) => o[n.toLowerCase()] ?? null });

test('CSRF: 같은 Origin 허용, 다른 Origin·깨진 Origin 거부', () => {
  assert.equal(isSameOriginWrite(H({ origin: 'https://e-jip.kr', host: 'e-jip.kr' })), true);
  assert.equal(isSameOriginWrite(H({ origin: 'https://evil.example', host: 'e-jip.kr' })), false);
  assert.equal(isSameOriginWrite(H({ origin: 'null', host: 'e-jip.kr' })), false);
});

test('CSRF: Origin 없으면 Sec-Fetch-Site=same-origin만 허용, 둘 다 없으면 거부', () => {
  assert.equal(isSameOriginWrite(H({ host: 'e-jip.kr', 'sec-fetch-site': 'same-origin' })), true);
  assert.equal(isSameOriginWrite(H({ host: 'e-jip.kr', 'sec-fetch-site': 'cross-site' })), false);
  assert.equal(isSameOriginWrite(H({ host: 'e-jip.kr' })), false);
});

test('쓰기 본문은 application/json만', () => {
  assert.equal(isJsonContentType(H({ 'content-type': 'application/json; charset=utf-8' })), true);
  assert.equal(isJsonContentType(H({ 'content-type': 'text/plain' })), false);
  assert.equal(isJsonContentType(H({})), false);
});

test('오류 로그 요약에 메시지(PII 가능)가 들어가지 않는다', () => {
  const e = Object.assign(new Error('Invalid value 홍길동 010-1234-5678'), { name: 'PrismaClientKnownRequestError', code: 'P2002' });
  const s = summarizeErrorForLog(e);
  assert.equal(s, 'PrismaClientKnownRequestError P2002');
  assert.ok(!s.includes('홍길동') && !s.includes('010'));
  assert.equal(summarizeErrorForLog('x'), 'unknown');
  assert.equal(summarizeErrorForLog(Object.assign(new Error('m'), { code: '홍길동' })), 'Error');
});

import { nameInitial } from './rules';

test('고객 이니셜: 꼬리표·기호 건너뛰고 첫 글자만', () => {
  assert.equal(nameInitial('홍길동'), '홍OO');
  assert.equal(nameInitial('[데모] 박고객'), '박OO');
  assert.equal(nameInitial('(VIP) Kim'), 'KOO');
  assert.equal(nameInitial('  '), '고객');
  assert.equal(nameInitial('010'), '고객');
});

import { ymdKst } from './briefing';

test('브리핑 날짜는 KST 달력 기준(KST 자정 입력이 하루 앞당겨지지 않는다)', () => {
  assert.equal(ymdKst(new Date('2026-12-01T00:00:00+09:00')), '2026-12-01'); // 입력 화면이 보내는 값
  assert.equal(ymdKst(new Date('2026-12-01T00:00:00Z')), '2026-12-01'); // API에 날짜만 보낸 경우
  assert.equal(ymdKst(null), null);
});
