import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * MASTER_COVERAGE_SYNC_APPLY_DOMAIN_OG_FIX_V1 §10/§11 — 사이트 오리진 단일 출처 계약.
 *
 * 도메인을 바꿀 때 환경변수 하나만 넣으면 **모든** 메타데이터가 따라와야 한다.
 * 예전에는 layout.tsx의 openGraph/twitter 세 곳이 Vercel 호스트를 직접 박아둬서
 * 그 셋만 뒤처졌고, 공유 카드가 옛 도메인을 가리켰다.
 */

const ROOT = resolve(__dirname, '../..');
const LAYOUT = readFileSync(resolve(ROOT, 'src/app/layout.tsx'), 'utf8');
const SITE = readFileSync(resolve(ROOT, 'src/config/site.ts'), 'utf8');

const LEGACY_HOST = 'real-estate-app-park11.vercel.app';
const OG_IMAGE_PATH = '/brand/og/ejip-og-main-1200x630.jpg';

test('§10 layout.tsx에 호스트 하드코딩이 없다', () => {
  assert.ok(!LAYOUT.includes(LEGACY_HOST), 'layout.tsx에 레거시 호스트가 남아 있다');
  // 우리 사이트 오리진을 직접 박지 않는다 — 오리진은 siteConfig만 정한다.
  // (preconnect의 dapi.kakao.com 같은 제3자 호스트는 오리진이 아니라 그대로 둔다.)
  assert.ok(!/vercel\.app|e-jip\.com/.test(LAYOUT), 'layout.tsx에 사이트 오리진이 직접 들어 있다');
});

test('§10 오리진을 정하는 곳은 site.ts 하나뿐이다', () => {
  // 폴백 상수는 여기 하나만 존재해야 한다.
  const occurrences = (SITE.match(new RegExp(LEGACY_HOST, 'g')) ?? []).length;
  assert.equal(occurrences, 1, `site.ts의 폴백 상수는 1개여야 한다(현재 ${occurrences})`);
  assert.ok(/NEXT_PUBLIC_SITE_URL/.test(SITE), 'NEXT_PUBLIC_SITE_URL 우선 규칙이 없다');
});

test('§11 OG/Twitter가 siteConfig에서 파생된다', () => {
  assert.ok(/url: siteConfig\.url/.test(LAYOUT), 'openGraph.url이 siteConfig에서 오지 않는다');
  assert.ok(/url: absoluteUrl\(OG_IMAGE_PATH\)/.test(LAYOUT), 'OG 이미지가 absoluteUrl을 쓰지 않는다');
  assert.ok(/images: \[absoluteUrl\(OG_IMAGE_PATH\)\]/.test(LAYOUT), 'twitter 이미지가 absoluteUrl을 쓰지 않는다');
  assert.ok(/metadataBase: new URL\(siteConfig\.url\)/.test(LAYOUT), 'metadataBase가 siteConfig에서 오지 않는다');
});

/**
 * site.ts를 주어진 환경으로 **다시 평가**한다.
 *
 * siteConfig.url은 모듈 최초 평가 때 한 번 정해지므로, 환경변수만 바꿔서는
 * 아무것도 달라지지 않는다. require 캐시를 비워 실제 도메인 전환을 재현한다.
 */
const SITE_MODULE = require.resolve('./site.ts');

function resolveOrigin(env: Record<string, string>): { url: string; ogImage: string } {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key];
    process.env[key] = env[key];
  }
  try {
    delete require.cache[SITE_MODULE];
    const mod = require(SITE_MODULE) as typeof import('./site');
    return {
      url: mod.siteConfig.url,
      ogImage: mod.absoluteUrl(OG_IMAGE_PATH),
    };
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key]!;
    }
    delete require.cache[SITE_MODULE];
  }
}

test('§11 NEXT_PUBLIC_SITE_URL=https://e-jip.com 이면 메타데이터가 e-jip.com이 된다', () => {
  const r = resolveOrigin({ NEXT_PUBLIC_SITE_URL: 'https://e-jip.com' });
  assert.equal(r.url, 'https://e-jip.com');
  assert.equal(r.ogImage, 'https://e-jip.com/brand/og/ejip-og-main-1200x630.jpg');
});

test('§13 환경변수가 없어도 프로덕션은 고정 도메인으로 떨어진다(현 Vercel 배포 보존)', () => {
  const r = resolveOrigin({ NEXT_PUBLIC_SITE_URL: '', VERCEL_ENV: 'production' });
  assert.equal(r.url, `https://${LEGACY_HOST}`);
  assert.ok(r.ogImage.startsWith(`https://${LEGACY_HOST}/`), '현 배포의 OG 이미지가 깨진다');
});

test('§13 URL이 이중 슬래시나 undefined로 깨지지 않는다', () => {
  for (const base of ['https://e-jip.com', 'https://e-jip.com/']) {
    const r = resolveOrigin({ NEXT_PUBLIC_SITE_URL: base });
    assert.ok(!r.ogImage.includes('//brand'), `이중 슬래시: ${r.ogImage}`);
    assert.ok(!r.ogImage.includes('undefined'), `undefined 누출: ${r.ogImage}`);
    assert.ok(!r.url.endsWith('/'), `말미 슬래시가 남았다: ${r.url}`);
  }
});

test('§13 프로덕션에 localhost가 새어 나가지 않는다', () => {
  const prod = resolveOrigin({ NEXT_PUBLIC_SITE_URL: '', VERCEL_ENV: 'production' });
  assert.ok(!prod.url.includes('localhost'), 'localhost가 프로덕션 메타데이터에 들어간다');
  const named = resolveOrigin({ NEXT_PUBLIC_SITE_URL: 'https://e-jip.com' });
  assert.ok(!named.url.includes('localhost'));
});
