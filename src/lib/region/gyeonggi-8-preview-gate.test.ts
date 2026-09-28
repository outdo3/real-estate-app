import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  GYEONGGI_8_BETA_PREVIEW_ENABLED,
  GYEONGGI_BETA_ENABLED,
  isPublicRegionAllowed,
  isSidoPubliclyHidden,
  publicAllowedLawdCds,
  resolveGyeonggi8PreviewFlag,
} from './enablement';
import { REGION_NODES } from './registry';

// GYEONGGI_8_PUBLIC_BETA_PREVIEW_V1 — Preview 전용 스위치의 **기본 설정**(env 없음 = 로컬·테스트·Production과 같은 판정).
// 실제 Preview env로 새로 읽는 테스트는 gyeonggi-8-preview-on.test.ts, Production에 플래그를 잘못 넣은 경우는
// gyeonggi-8-preview-prod-misconfig.test.ts(각 파일은 별도 프로세스라 env가 서로 새지 않는다).

const ROOT = resolve(__dirname, '../../..');
const GG_ALL = REGION_NODES.filter((n) => n.sidoCode === '41').map((n) => n.lawdCd);
const AXES = ['app', 'search', 'map', 'detail', 'report', 'stats', 'supply', 'sitemap', 'seoIndex', 'cronSync'] as const;

test('판정은 정확히 VERCEL_ENV=preview + 플래그 "true"일 때만 true', () => {
  assert.equal(resolveGyeonggi8PreviewFlag('preview', 'true'), true);
  const closed: Array<[string | undefined, string | undefined]> = [
    [undefined, undefined], ['preview', undefined], [undefined, 'true'],
    ['production', 'true'], ['development', 'true'], ['', 'true'],
    ['preview', 'false'], ['preview', ''], ['preview', 'TRUE'], ['preview', ' true'], ['preview', '1'],
    ['Preview', 'true'], ['production', 'false'],
  ];
  for (const [env, flag] of closed) assert.equal(resolveGyeonggi8PreviewFlag(env, flag), false, `${env}/${flag}`);
});

test('env 없음(기본값): Preview 스위치 OFF · Production 스위치 OFF · 경기 전 축 닫힘', () => {
  assert.equal(GYEONGGI_8_BETA_PREVIEW_ENABLED, false);
  assert.equal(GYEONGGI_BETA_ENABLED, false);
  for (const c of GG_ALL) for (const axis of AXES) assert.equal(isPublicRegionAllowed(c, axis), false, `${c} ${axis}`);
  assert.equal(isSidoPubliclyHidden('41'), true, '선택기에 경기가 나온다');
  assert.equal(publicAllowedLawdCds('search').filter((c) => c.startsWith('41')).length, 0);
  assert.equal(publicAllowedLawdCds('search').length, 24, '부산 16 + 서울 8');
});

test('스위치는 두 env를 **리터럴**로 읽는다(Next 빌드 인라인) — 다른 이름·동적 접근 없음', () => {
  const src = readFileSync(resolve(ROOT, 'src/lib/region/enablement.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  assert.ok(/process\.env\.NEXT_PUBLIC_VERCEL_ENV,\s*process\.env\.NEXT_PUBLIC_GYEONGGI_8_BETA_PREVIEW/.test(src));
  assert.ok(/gyeonggiBeta: GYEONGGI_BETA_ENABLED \|\| GYEONGGI_8_BETA_PREVIEW_ENABLED/.test(src));
  assert.ok(/export const GYEONGGI_BETA_ENABLED = false;/.test(src), 'Production 스위치는 false 그대로');
  assert.ok(!/'41'\s*:/.test(src), '시도 층에 경기가 들어갔다');
  assert.ok(!/process\.env\[/.test(src), '동적 env 접근은 인라인되지 않는다');
});
