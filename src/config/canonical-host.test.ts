import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CANONICAL_ORIGIN,
  CANONICAL_REDIRECT_EXCLUDED_PREFIXES,
  LEGACY_PRODUCTION_HOST,
  buildCanonicalHostRedirects,
  escapeHostForRouteMatch,
} from './canonical-host';

// E-JIP CANONICAL HOST REDIRECT V1 — 규칙 계약 검증. 실제 Next 라우터 동작은 배포 전
// `next start` + Host 헤더 매트릭스와 배포 후 프로덕션 curl로 확인한다(문서 참고).

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const [rule] = buildCanonicalHostRedirects();

/** Next matchHas와 같은 방식(`^value$`)으로 host를 비교한다. */
const hostMatches = (host: string) => new RegExp(`^${rule.has[0].value}$`).test(host);

/** source `/:path(<pattern>)`의 사용자 패턴을 꺼내 전체 경로 일치로 평가한다. */
const pathPattern = /^\/:path\((.*)\)$/.exec(rule.source)?.[1] ?? '';
const pathMatches = (pathname: string) => new RegExp(`^/(${pathPattern})$`).test(pathname);

test('규칙은 하나, 308(permanent), 정규 오리진으로 경로를 그대로 붙인다', () => {
  assert.equal(buildCanonicalHostRedirects().length, 1);
  assert.equal(rule.permanent, true, '308이 아니다');
  assert.equal(CANONICAL_ORIGIN, 'https://e-jip.com');
  assert.equal(rule.destination, 'https://e-jip.com/:path', '홈으로만 보내면 안 된다 — 경로를 유지해야 한다');
  assert.ok(pathPattern.length > 0, 'source 형식이 /:path(<pattern>)가 아니다');
});

test('정확히 레거시 프로덕션 호스트만 대상이다 — 정규 호스트/www/프리뷰/유사 호스트는 제외', () => {
  assert.equal(LEGACY_PRODUCTION_HOST, 'real-estate-app-park11.vercel.app');
  assert.equal(hostMatches('real-estate-app-park11.vercel.app'), true);
  for (const host of [
    'e-jip.com', // 루프 금지
    'www.e-jip.com',
    'real-estate-app-git-main-park11.vercel.app', // 브랜치 프리뷰
    'real-estate-app-abc123xyz-park11.vercel.app', // 배포별 URL
    'real-estate-app-park11xvercel.app', // 점 미이스케이프 시 잘못 일치할 호스트
    'evil.real-estate-app-park11.vercel.app',
    'real-estate-app-park11.vercel.app.evil.test',
    'localhost',
  ]) {
    assert.equal(hostMatches(host), false, `${host}가 redirect 대상이 됐다`);
  }
  assert.equal(escapeHostForRouteMatch('a.b'), 'a\\.b');
});

test('모든 사용자 경로(루트·지도·통계·리포트·인증·일반 API)는 redirect 대상이다', () => {
  for (const p of [
    '/',
    '/map',
    '/stats/rankings',
    '/report/apartment/abc',
    '/apt/%EB%8C%80%EC%8B%A0%ED%95%B4%EB%AA%A8%EB%A1%9C',
    '/api/auth/signin/google',
    '/api/auth/callback/kakao',
    '/api/transactions',
    '/api/cronjobs', // /api/cron 접두사만 정확히 제외
    '/manifest.webmanifest',
  ]) {
    assert.equal(pathMatches(p), true, `${p}가 redirect되지 않는다`);
  }
});

test('/api/cron과 그 하위만 제외된다(Vercel Cron 보호)', () => {
  assert.deepEqual([...CANONICAL_REDIRECT_EXCLUDED_PREFIXES], ['/api/cron']);
  for (const p of ['/api/cron', '/api/cron/', '/api/cron/sale-sync', '/api/cron/rent-sync', '/api/cron/sale-recheck']) {
    assert.equal(pathMatches(p), false, `${p}가 redirect된다 — cron 실행이 깨진다`);
  }
  // 등록된 cron 경로가 전부 제외 목록 안에 있다.
  const crons = (JSON.parse(read('vercel.json')).crons as Array<{ path: string }>).map((c) => c.path.split('?')[0]);
  assert.ok(crons.length > 0);
  for (const c of crons) assert.equal(pathMatches(c), false, `vercel.json cron ${c}가 redirect된다`);
});

test('next.config.ts가 이 규칙을 redirects()로 쓴다', () => {
  const config = read('next.config.ts');
  assert.match(config, /import \{ buildCanonicalHostRedirects \} from "\.\/src\/config\/canonical-host";/);
  assert.match(config, /async redirects\(\) \{\s*return buildCanonicalHostRedirects\(\);\s*\}/);
});

test('인증 설정은 바꾸지 않았다 — 쿠키/SameSite/Domain/checks/세션 전략', () => {
  const auth = read('src/lib/auth.ts').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(auth, /\bcookies\s*:|sameSite|useSecureCookies|domain\s*:/i);
  assert.match(auth, /checks: \['state'\],/);
  assert.match(auth, /strategy: 'jwt'/);
  // redirect는 인증 라우트가 아니라 진입 호스트에서만 동작한다.
  assert.doesNotMatch(read('src/proxy.ts'), /vercel\.app|e-jip\.com/);
});

test('공유/메타데이터 오리진에 레거시 호스트가 남지 않는다', () => {
  assert.ok(!read('src/config/site.ts').includes(LEGACY_PRODUCTION_HOST));
  assert.ok(!read('src/app/layout.tsx').includes(LEGACY_PRODUCTION_HOST));
});
