import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { PREVIEW_DB_NOT_CONFIGURED_URL, resolveRuntimeDatabaseUrl } from './db-url-policy';
import { resolveDbOnly, isDbOnlyLawdCd, getRegionEnablement, SEOUL_17_BETA_LAWDCDS, SEOUL_BETA_LAWDCDS } from './region/enablement';
import { REGION_NODES } from './region/registry';

// SEOUL25_PREVIEW_READ_ONLY_DB_V1 — Preview는 read-only 전용 연결만, Production·로컬은 그대로. Production DB·네트워크 0.

const PROD_URL = 'postgresql://prod-user:prod-secret@prod.example:6543/postgres';
const RO_URL = 'postgresql://ro-user:ro-secret@prod.example:6543/postgres';

test('Preview + PREVIEW_DATABASE_URL → read-only 연결', () => {
  assert.deepEqual(resolveRuntimeDatabaseUrl({ VERCEL_ENV: 'preview', PREVIEW_DATABASE_URL: RO_URL, DATABASE_URL: PROD_URL }), { url: RO_URL, source: 'PREVIEW_READ_ONLY' });
});

test('Preview인데 PREVIEW_DATABASE_URL이 없으면 닫힘 — DATABASE_URL로 절대 떨어지지 않는다', () => {
  for (const v of [undefined, '', '   ']) {
    const r = resolveRuntimeDatabaseUrl({ VERCEL_ENV: 'preview', PREVIEW_DATABASE_URL: v, DATABASE_URL: PROD_URL });
    assert.equal(r.source, 'PREVIEW_NOT_CONFIGURED');
    assert.equal(r.url, PREVIEW_DB_NOT_CONFIGURED_URL);
    assert.notEqual(r.url, PROD_URL);
  }
  assert.match(PREVIEW_DB_NOT_CONFIGURED_URL, /\.invalid[:/]/);
});

test('Production·로컬·테스트는 지금과 같다(override 없음 = Prisma가 DATABASE_URL을 읽는다)', () => {
  for (const env of [
    { VERCEL_ENV: 'production', PREVIEW_DATABASE_URL: RO_URL, DATABASE_URL: PROD_URL },
    { VERCEL_ENV: 'development', PREVIEW_DATABASE_URL: RO_URL },
    { DATABASE_URL: PROD_URL },
    {},
    { VERCEL_ENV: 'Preview', PREVIEW_DATABASE_URL: RO_URL },
  ]) assert.deepEqual(resolveRuntimeDatabaseUrl(env), { url: null, source: 'DEFAULT' }, JSON.stringify(Object.keys(env)));
});

test('prisma.ts가 이 판정을 쓰고, 테스트 URL이 여전히 우선이다', () => {
  const src = readFileSync(resolve(__dirname, 'prisma.ts'), 'utf8');
  assert.match(src, /const runtimeDb = resolveRuntimeDatabaseUrl\(process\.env/);
  assert.match(src, /const overrideUrl = testUrl \?\? runtimeDb\.url;/);
});

test('DB 자격증명은 클라이언트로 나가지 않는다 — NEXT_PUBLIC_*DATABASE* 참조 없음, PREVIEW_DATABASE_URL은 서버 모듈에서만', () => {
  const root = resolve(__dirname, '..');
  const hits: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.(ts|tsx)$/.test(f) || /\.test\.tsx?$/.test(f)) continue;
      const s = readFileSync(p, 'utf8');
      if (/NEXT_PUBLIC_[A-Z_]*DATABASE/.test(s)) hits.push(`public:${p}`);
      if (/PREVIEW_DATABASE_URL/.test(s) && !/db-url-policy\.ts$/.test(p)) hits.push(`other:${p}`);
    }
  };
  walk(root);
  assert.deepEqual(hits, []);
  assert.ok(!/['"]use client['"]/.test(readFileSync(resolve(__dirname, 'db-url-policy.ts'), 'utf8')));
});

test('Preview DB 전용 판정: 스위치가 켜졌을 때 서울 17구만', () => {
  for (const c of SEOUL_17_BETA_LAWDCDS) {
    assert.equal(resolveDbOnly(true, c), true, c);
    assert.equal(resolveDbOnly(false, c), false, c);
  }
  for (const c of [...SEOUL_BETA_LAWDCDS, '26350', '26440', '41111', '11', '1168', '11680x', '', null, undefined]) assert.equal(resolveDbOnly(true, c as string), false, String(c));
});

// SEOUL25_PRODUCTION_PUBLIC_ENABLE_V1 — 2026-09-30 공개 뒤: DB 전용은 정확히 서울 17구, 17구 DB-first 읽기 열림.
test('Production 런타임(이 테스트 env): DB 전용 = 서울 17구뿐 · 17구 DB-first 읽기 열림 · 8구·부산 DB-first 그대로', () => {
  const s17 = SEOUL_17_BETA_LAWDCDS as readonly string[];
  for (const n of REGION_NODES) assert.equal(isDbOnlyLawdCd(n.lawdCd), s17.includes(n.lawdCd), n.lawdCd);
  for (const c of SEOUL_17_BETA_LAWDCDS) assert.equal(getRegionEnablement(c).cronSync, true, c);
  for (const c of SEOUL_BETA_LAWDCDS) assert.equal(getRegionEnablement(c).cronSync, true, c);
  assert.equal(getRegionEnablement('26350').cronSync, true);
});
