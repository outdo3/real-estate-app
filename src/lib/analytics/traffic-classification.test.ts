import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBotUserAgent, classifyTraffic } from './traffic-classification';

test('알려진 크롤러 UA는 bot으로 판정된다', () => {
  assert.equal(isBotUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'), true);
  assert.equal(isBotUserAgent('Mozilla/5.0 (compatible; bingbot/2.0)'), true);
  assert.equal(isBotUserAgent('curl/8.0.1'), true);
  assert.equal(isBotUserAgent('python-requests/2.31.0'), true);
});

test('일반 모바일/데스크톱 브라우저 UA는 오탐하지 않는다', () => {
  assert.equal(
    isBotUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'),
    false
  );
  assert.equal(
    isBotUserAgent('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36'),
    false
  );
  assert.equal(
    isBotUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'),
    false
  );
});

test('빈 UA는 자동으로 bot 취급하지 않는다(오탐 방지 우선)', () => {
  assert.equal(isBotUserAgent(null), false);
  assert.equal(isBotUserAgent(''), false);
});

test('QA suppression 플래그가 최우선으로 제외 사유가 된다', () => {
  const reason = classifyTraffic({ userAgent: 'Mozilla/5.0', user: null, qaSuppressed: true });
  assert.equal(reason, 'QA_SUPPRESSED');
});

test('ADMIN role 사용자는 제외된다(일반 로그인 사용자는 제외되지 않음)', () => {
  const adminReason = classifyTraffic({ userAgent: 'Mozilla/5.0', user: { role: 'ADMIN' }, qaSuppressed: false });
  assert.equal(adminReason, 'ADMIN_SESSION');

  const normalUserReason = classifyTraffic({ userAgent: 'Mozilla/5.0', user: { role: 'USER' }, qaSuppressed: false });
  // 개발 환경(VERCEL_ENV 미설정)에서 테스트가 돌아가므로 NON_PRODUCTION으로 걸러지는 것은
  // 정상이다 — 여기서 확인하려는 건 ADMIN_SESSION이 아니라는 것뿐이다.
  assert.notEqual(normalUserReason, 'ADMIN_SESSION');
});

test('익명 사용자(user null)는 ADMIN_SESSION으로 분류되지 않는다', () => {
  const reason = classifyTraffic({ userAgent: 'Mozilla/5.0', user: null, qaSuppressed: false });
  assert.notEqual(reason, 'ADMIN_SESSION');
});
