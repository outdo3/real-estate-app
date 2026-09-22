import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SEOUL_SALE_SYNC_LAWDCDS, resolveSaleSyncScope } from './sale-sync-scope';
import { BUSAN_LAWDCD_16 } from '../rent-verified-range';
import { getRegionByLawdCd } from '../region/registry';
import { getSidoEnablement } from '../region/enablement';

// SEOUL_SALE_INCREMENTAL_SYNC_PREP_V1 — 매매 cron 범위(scope) 계약. 쓰기 0 · DB 0.

const ROOT = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const SALE_ROUTE = read('src/app/api/cron/sale-sync/route.ts');
const RECHECK_ROUTE = read('src/app/api/cron/sale-recheck/route.ts');

test('§A scope 생략 → 코어 기본값(부산 16구) 그대로', () => {
  const r = resolveSaleSyncScope(null);
  assert.deepEqual(r, { ok: true, scope: 'busan', lawdCds: undefined });
  assert.equal(BUSAN_LAWDCD_16.length, 16);
  assert.ok(BUSAN_LAWDCD_16.every((c) => c.startsWith('26')));
  // 기본값을 쓰는 자리가 그대로다 — undefined를 넘기면 부산 16구가 된다.
  assert.ok(/const all = opts\.lawdCds \?\? BUSAN_LAWDCD_16;/.test(read('src/lib/sync/sale-sync-core.ts')));
  assert.ok(/const lawdCds = opts\.lawdCds \?\? BUSAN_LAWDCD_16;/.test(read('src/lib/sync/sale-recheck-core.ts')));
});

test('§B scope=seoul → 정확히 11110 · 11140 · 11170 (등록된 서울 MOLIT 구)', () => {
  const r = resolveSaleSyncScope('seoul');
  assert.ok(r.ok);
  assert.deepEqual(r.ok && r.lawdCds, ['11110', '11140', '11170']);
  for (const code of SEOUL_SALE_SYNC_LAWDCDS) {
    const node = getRegionByLawdCd(code);
    assert.ok(node, `${code}가 registry에 없다`);
    assert.equal(node!.sidoCode, '11');
    assert.equal(node!.isMolitLeaf, true);
  }
});

test('§C 강남 11680은 없다 — 서울 25구 자동 포함도 없다', () => {
  assert.ok(!(SEOUL_SALE_SYNC_LAWDCDS as readonly string[]).includes('11680'));
  assert.equal(SEOUL_SALE_SYNC_LAWDCDS.length, 3);
});

test('§D 잘못된 scope는 거부된다(기본값으로 삼키지 않는다)', () => {
  for (const bad of ['', 'SEOUL', 'Seoul', 'busan', 'seoul,busan', 'all', '11680', '11110', '26350', ' seoul']) {
    assert.deepEqual(resolveSaleSyncScope(bad), { ok: false, error: 'invalid scope' }, `"${bad}"가 통과했다`);
  }
});

test('§D 라우트가 잘못된 scope에 400을 준다 — DB/MOLIT에 닿기 전에', async () => {
  const prev = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'test-only-secret';
  try {
    const { GET: saleGet } = await import('../../app/api/cron/sale-sync/route');
    const { GET: recheckGet } = await import('../../app/api/cron/sale-recheck/route');
    for (const GET of [saleGet, recheckGet]) {
      for (const bad of ['all', '11680', '']) {
        const res = await GET(new Request(`http://localhost/api/cron/x?mode=dry-run&scope=${encodeURIComponent(bad)}`, { headers: { authorization: 'Bearer test-only-secret' } }));
        assert.equal(res.status, 400, `scope="${bad}"가 400이 아니다`);
      }
      // 인증 게이트는 scope보다 먼저다.
      const unauth = await GET(new Request('http://localhost/api/cron/x?scope=seoul'));
      assert.equal(unauth.status, 401);
    }
  } finally {
    if (prev === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prev;
  }
});

test('§E URL로 임의의 구를 넣을 수 없다 — 라우트는 scope만 읽는다', () => {
  for (const [name, src] of [['sale-sync', SALE_ROUTE], ['sale-recheck', RECHECK_ROUTE]] as const) {
    const code = stripComments(src);
    assert.ok(!/searchParams\.get\('lawdCd/.test(code), `${name}가 lawdCd 파라미터를 읽는다`);
    assert.ok(!/searchParams\.getAll\(/.test(code), `${name}가 다중 파라미터를 읽는다`);
    assert.ok(/resolveSaleSyncScope\(url\.searchParams\.get\('scope'\)\)/.test(code), `${name}가 허용 목록을 거치지 않는다`);
  }
});

test('§F sale-sync와 sale-recheck 둘 다 scope의 구 목록을 코어에 넘긴다', () => {
  assert.ok(/runSaleSync\(\{ mode, districtOffset, districtLimit, lawdCds: resolved\.lawdCds \}, log\)/.test(stripComments(SALE_ROUTE)));
  assert.ok(/lawdCds: resolved\.lawdCds,/.test(stripComments(RECHECK_ROUTE)));
  // 쓰기 경로는 하나 — 서울 전용 sync 로직이 없다.
  assert.ok(/import \{ syncOneSaleCell \} from '\.\/sale-sync-core';/.test(read('src/lib/sync/sale-recheck-core.ts')));
});

test('§G /admin/ops의 매매 coverage는 부산 16구만 센다', () => {
  const ops = stripComments(read('src/app/api/admin/ops/route.ts'));
  assert.ok(/summarizeCoverage\('SALE', BUSAN_16\)/.test(ops), 'SALE coverage가 전체 테이블을 센다');
  assert.ok(/summarizeSaleRunKinds\(BUSAN_16\)/.test(ops), 'SALE run 요약이 전체 테이블을 본다');
  const cov = stripComments(read('src/lib/sync-coverage.ts'));
  assert.ok(/const where = lawdCds \? \{ dataset, lawdCd: \{ in: \[\.\.\.lawdCds\] \} \} : \{ dataset \};/.test(cov));
  assert.ok(/const scope = lawdCds \? \{ lawdCd: \{ in: \[\.\.\.lawdCds\] \} \} : \{\};/.test(cov));
});

test('§H cronSync는 그대로 — 서울은 여전히 비공개이고 scope 모듈은 enablement를 읽지 않는다', () => {
  const seoul = getSidoEnablement('11');
  assert.deepEqual(
    { app: seoul.app, stats: seoul.stats, report: seoul.report, sitemap: seoul.sitemap, seoIndex: seoul.seoIndex, cronSync: seoul.cronSync },
    { app: false, stats: false, report: false, sitemap: false, seoIndex: false, cronSync: false }
  );
  assert.ok(!/enablement/.test(stripComments(read('src/lib/sync/sale-sync-scope.ts'))), 'scope가 enablement를 읽는다');
  assert.ok(!/cronSync/.test(stripComments(SALE_ROUTE) + stripComments(RECHECK_ROUTE)));
});
