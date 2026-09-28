import assert from 'node:assert/strict';
import test, { before } from 'node:test';

// GYEONGGI_8_PUBLIC_BETA_PREVIEW_V1 — Production 빌드에 Preview 플래그를 **잘못 넣은** 경우를 실제 env로 재현한다.
// VERCEL_ENV가 'production'이면 플래그가 'true'여도 경기는 전 축 닫힘이어야 한다. (별도 프로세스 — env 격리)

type E = typeof import('./enablement');
type R = typeof import('./registry');
let e: E;
let r: R;

before(async () => {
  process.env.NEXT_PUBLIC_VERCEL_ENV = 'production';
  process.env.NEXT_PUBLIC_GYEONGGI_8_BETA_PREVIEW = 'true';
  e = await import('./enablement');
  r = await import('./registry');
});

test('Production env + 플래그 true(오설정): 스위치 OFF · 경기 전 축 닫힘 · 선택기에 경기 없음', () => {
  assert.equal(e.GYEONGGI_8_BETA_PREVIEW_ENABLED, false);
  assert.equal(e.GYEONGGI_BETA_ENABLED, false);
  const gg = r.REGION_NODES.filter((n) => n.sidoCode === '41').map((n) => n.lawdCd);
  for (const c of gg) {
    for (const axis of ['app', 'search', 'map', 'detail', 'report', 'stats', 'supply', 'sitemap', 'seoIndex', 'cronSync'] as const) {
      assert.equal(e.isPublicRegionAllowed(c, axis), false, `${c} ${axis}`);
    }
  }
  assert.equal(e.isSidoPubliclyHidden('41'), true);
  assert.equal(e.publicAllowedLawdCds('search').length, 24, '부산 16 + 서울 8 — 현재 Production과 같다');
});
