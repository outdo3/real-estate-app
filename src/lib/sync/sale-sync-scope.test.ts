import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SEOUL_SALE_SYNC_LAWDCDS, resolveSaleSyncScope } from './sale-sync-scope';
import { BUSAN_LAWDCD_16 } from '../rent-verified-range';
import { getRegionByLawdCd } from '../region/registry';
import { getSidoEnablement } from '../region/enablement';
import { describeDailyUtcCronInKst, findCronForRoute } from '../cron-schedule';
import { monthsInRange, orderRecheckCellsByStaleness, resolveSaleRange, resolveSaleRecheckBand } from './shared';
import { subtractMonths } from '../../../scripts/rent-trade-history/incremental-sync-completed-month-logic';

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

// SEOUL_PHASE_C_CRON_SCOPE_EXPANSION_V1 — 기존 3구 + Phase C 5구.
const SEOUL_BASE_3 = ['11110', '11140', '11170'] as const;
const SEOUL_PHASE_C_5 = ['11440', '11410', '11230', '11215', '11545'] as const;

test('§B scope=seoul → 정확히 8개 구(기존 3 + Phase C 5, 전부 등록된 서울 MOLIT 구)', () => {
  const r = resolveSaleSyncScope('seoul');
  assert.ok(r.ok);
  assert.deepEqual(r.ok && r.lawdCds, ['11110', '11140', '11170', '11440', '11410', '11230', '11215', '11545']);
  for (const code of SEOUL_SALE_SYNC_LAWDCDS) {
    const node = getRegionByLawdCd(code);
    assert.ok(node, `${code}가 registry에 없다`);
    assert.equal(node!.sidoCode, '11');
    assert.equal(node!.isMolitLeaf, true);
  }
});

test('§B2 기존 3구는 그대로 남고 Phase C 5구가 빠짐없이 들어갔다', () => {
  const set = new Set<string>(SEOUL_SALE_SYNC_LAWDCDS);
  for (const c of SEOUL_BASE_3) assert.ok(set.has(c), `기존 구 ${c}가 빠졌다`);
  for (const c of SEOUL_PHASE_C_5) assert.ok(set.has(c), `Phase C 구 ${c}가 없다`);
});

test('§C 강남 11680은 없다 — 서울 25구 자동 포함도 없다', () => {
  assert.ok(!(SEOUL_SALE_SYNC_LAWDCDS as readonly string[]).includes('11680'));
  assert.equal(SEOUL_SALE_SYNC_LAWDCDS.length, 8);
  // 승인된 8개 말고는 어떤 서울 구도 들어올 수 없다.
  const approved = new Set<string>([...SEOUL_BASE_3, ...SEOUL_PHASE_C_5]);
  for (const c of SEOUL_SALE_SYNC_LAWDCDS) assert.ok(approved.has(c), `승인되지 않은 구 ${c}`);
});

test('§C2 중복 lawdCd가 없다', () => {
  assert.equal(new Set<string>(SEOUL_SALE_SYNC_LAWDCDS).size, SEOUL_SALE_SYNC_LAWDCDS.length);
});

test('§C3 서울 scope는 부산 구를 하나도 싣지 않는다(양방향 격리)', () => {
  const seoul = new Set<string>(SEOUL_SALE_SYNC_LAWDCDS);
  for (const b of BUSAN_LAWDCD_16) assert.ok(!seoul.has(b), `부산 ${b}가 서울 scope에 있다`);
  for (const s of SEOUL_SALE_SYNC_LAWDCDS) assert.ok(!BUSAN_LAWDCD_16.includes(s), `서울 ${s}가 부산 목록에 있다`);
  // 부산 기본값은 이 변경과 무관하게 16구 그대로다.
  assert.equal(BUSAN_LAWDCD_16.length, 16);
  assert.ok(BUSAN_LAWDCD_16.every((c) => c.startsWith('26')));
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

// ── SEOUL_SALE_INCREMENTAL_CRON_ENABLE_V1 — 승인된 cron 집합 고정 ─────────────────────────

const CRONS = (JSON.parse(read('vercel.json')).crons as { path: string; schedule: string }[]);

test('cron: 부산 3개는 그대로 + 승인된 서울 2개만 추가 = 5개, 중복 없음', () => {
  assert.deepEqual(CRONS, [
    { path: '/api/cron/sale-sync?mode=apply', schedule: '0 19 * * *' },
    { path: '/api/cron/rent-sync?mode=apply', schedule: '0 21 * * *' },
    { path: '/api/cron/sale-recheck?mode=apply', schedule: '0 23 * * *' },
    { path: '/api/cron/sale-sync?mode=apply&scope=seoul', schedule: '15 19 * * *' },
    { path: '/api/cron/sale-recheck?mode=apply&scope=seoul', schedule: '15 23 * * *' },
  ]);
  assert.equal(new Set(CRONS.map((c) => c.path)).size, CRONS.length);
});

test('cron: 서울 호출의 scope는 허용 목록으로 해석되고 강남·임의 구를 싣지 않는다', () => {
  for (const c of CRONS) {
    const q = new URL(`https://e-jip.com${c.path}`).searchParams;
    assert.ok(!q.has('lawdCd') && !q.has('lawdCds'), `${c.path}에 구 코드가 실렸다`);
    const r = resolveSaleSyncScope(q.get('scope'));
    assert.ok(r.ok, `${c.path}의 scope가 거부된다`);
  }
  assert.ok(!CRONS.some((c) => c.path.includes('11680')));
});

test('cron: 서울 매매 04:15 KST · 서울 recheck 08:15 KST (부산보다 15분 뒤, 같은 호출에 섞이지 않음)', () => {
  const kst = (path: string) => describeDailyUtcCronInKst(CRONS.find((c) => c.path === path)!.schedule);
  assert.equal(kst('/api/cron/sale-sync?mode=apply&scope=seoul'), '매일 04:15 KST');
  assert.equal(kst('/api/cron/sale-recheck?mode=apply&scope=seoul'), '매일 08:15 KST');
  assert.equal(kst('/api/cron/sale-sync?mode=apply'), '매일 04:00 KST');
  assert.equal(kst('/api/cron/sale-recheck?mode=apply'), '매일 08:00 KST');
});

test('cron: /admin/ops의 스케줄 표시는 계속 부산 호출을 가리킨다(서울 항목은 뒤에 있다)', () => {
  // findCronForRoute는 경로(쿼리 제외)로 **첫** 항목을 고른다 — 서울 항목을 앞에 넣으면 부산 표시가 바뀐다.
  assert.equal(findCronForRoute(CRONS, '/api/cron/sale-sync').scheduleUtc, '0 19 * * *');
  assert.equal(findCronForRoute(CRONS, '/api/cron/sale-recheck').scheduleUtc, '0 23 * * *');
});


// ── SEOUL_PHASE_C_CRON_SCOPE_EXPANSION_V1 — 셀 수 · 실행 예산 ────────────────────────────

test('예산: 서울 sale sync는 8구 × 4개월 = 32셀, 50s 예산 안', () => {
  // 운영과 같은 식으로 범위를 구한다(재구현 아님).
  const latestComplete = '202608';
  const nowMonth = '202609';
  const { from, to } = resolveSaleRange(latestComplete, nowMonth, subtractMonths, {});
  const months = monthsInRange(from, to);
  assert.deepEqual(months, ['202606', '202607', '202608', '202609']); // overlap 3 + 현재월
  const cells = SEOUL_SALE_SYNC_LAWDCDS.length * months.length;
  assert.equal(cells, 32);

  // 관측치(2026-09-23 첫 서울 실행): 12셀 ≈ 5.0s → 셀당 ~420ms. 넉넉히 600ms로 본다.
  const worstMs = cells * 600;
  assert.ok(worstMs < 50_000 - 2_500, `sale sync 최악 ${worstMs}ms가 예산을 넘는다`);
});

test('예산: 서울 recheck는 8구 × 10개월 = 80셀, 45s 예산 안', () => {
  const latestComplete = '202608';
  const { from, to } = resolveSaleRecheckBand(latestComplete, subtractMonths);
  const months = monthsInRange(from, to);
  assert.equal(months.length, 10); // latestComplete-12 ~ latestComplete-3
  const cells = SEOUL_SALE_SYNC_LAWDCDS.length * months.length;
  assert.equal(cells, 80);

  // 관측치(2026-09-23): 서울 30셀 ≈ 11.0s, 부산 121셀 ≈ 42s → 둘 다 셀당 ~350ms(MOLIT pacing).
  // 예산 판정은 elapsed + ESTIMATED_CELL_MS(2500) < 45000, 즉 실질 한계는 42.5s다.
  const worstMs = cells * 500;
  assert.ok(worstMs < 45_000 - 2_500, `recheck 최악 ${worstMs}ms가 예산을 넘는다`);
});

test('예산: band를 다 못 돌아도 실패가 아니다 — 다음 실행이 가장 오래된 셀부터 이어받는다', () => {
  const core = stripComments(read('src/lib/sync/sale-recheck-core.ts'));
  // 셀을 하나도 못 돌았을 때만 PARTIAL_RUN이다(부분 sweep은 설계상 정상).
  assert.ok(/if \(reports\.length === 0\) status = 'PARTIAL_RUN';/.test(core));
  // 미검증 셀이 먼저 온다 — 새로 들어온 Phase C 5구가 첫 실행에서 우선 처리된다.
  const never = orderRecheckCellsByStaleness([
    { lawdCd: '11110', dealYmd: '202512', lastVerifiedAtMs: 1 },
    { lawdCd: '11440', dealYmd: '202512' }, // 기록 없음 = 미검증
  ]);
  assert.equal(never[0].lawdCd, '11440');
});
