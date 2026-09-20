import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { runBackfill, parseCli, type BackfillDeps, type BackfillOptions, type ReadDb } from './backfill-seoul-sale';
import {
  evaluateApplyGates, quotaDecision, resolveScope, classifyTradeMaster,
  computeExpectedSkips, applyMatchesPlan, naturalKeyOf, canonicalLawdCdOf,
  type CellPlannedKeys,
} from './backfill-seoul-sale-logic';
import { monthDateRange, type ExistingTradeRow } from '../src/lib/sync/sale-sync-core';
import { fetchSaleCell, type PageFetcher, type PageOutcome } from './seed-seoul-apartment-master-logic';

// SEOUL_SALE_BACKFILL_DRIVER_V1 — 네트워크·DB 없이 가짜 의존성으로 driver 규칙을 고정한다.

const raw = (o: Record<string, string> = {}) => ({
  aptSeq: '11140-1', aptNm: '남산타운', umdNm: '신당동', jibun: '844', sggCd: '11140', excluUseAr: '84.9', dealAmount: '120,000',
  dealYear: '2026', dealMonth: '9', dealDay: '3', floor: '5', buildYear: '2002', cdealType: '', cdealDay: '', rgstDate: '', ...o,
});
type Cell = any[] | { fail: PageOutcome['kind']; page?: number };
function fakeFetch(data: Record<string, Record<string, Cell>>, log: string[] = []): PageFetcher {
  return async (lawdCd, ym, pageNo, numOfRows) => {
    log.push(`${lawdCd}:${ym}:${pageNo}`);
    const cell = data[lawdCd]?.[ym] ?? [];
    if (!Array.isArray(cell)) {
      if ((cell.page ?? 1) === pageNo) return { kind: cell.fail as Exclude<PageOutcome['kind'], 'OK'>, detail: 'fake' };
      return { kind: 'OK', totalCount: 1500, items: Array.from({ length: pageNo === 1 ? 1000 : 400 }, () => raw()) };
    }
    return { kind: 'OK', totalCount: cell.length, items: cell.slice((pageNo - 1) * numOfRows, pageNo * numOfRows) };
  };
}
const dbRow = (o: Partial<ExistingTradeRow> = {}): ExistingTradeRow => ({
  id: 1, groupKeyStr: 'id:11140-1::84.9::sale', dealAmount: 120000, dealDate: new Date('2026-09-03T00:00:00Z'), floor: 5, occurrenceIndex: 0,
  dealCanceled: false, cancelDate: null, aptName: '남산타운', dong: '신당동', registryDate: null, ...o,
});
function fakeDb(
  existing: Record<string, ExistingTradeRow[]> = {},
  masters = ['11140-1'],
  /** 이미 DB에 있는 자연키(자연키에는 lawdCd가 없다 — 다른 구가 넣은 행을 여기로 표현한다). */
  existingKeys: string[] = []
): ReadDb & { lookups: string[] } {
  const lookups: string[] = [];
  return {
    lookups,
    findExisting: async (l, ym) => { lookups.push(`${l}:${ym}`); return (existing[`${l}:${ym}`] ?? []).map((r) => ({ ...r })); },
    seoulMasterAptSeqs: async () => new Set(masters),
    existingNaturalKeys: async (keys) => new Set(keys.filter((k) => existingKeys.includes(k))),
  };
}
function setup(o: { data: Record<string, Record<string, Cell>>; db?: ReadDb; opts?: Partial<BackfillOptions>; deps?: Partial<BackfillDeps>; outDir?: string; fetchLog?: string[] }) {
  const outDir = o.outDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'seoul-sale-'));
  const applied: string[] = [];
  const opts: BackfillOptions = { outDir, districts: ['11140'], from: '202609', to: '202609', apply: false, env: {}, expectInserts: null, approveExistingUpdates: false, reserveCalls: 2000, maxCalls: null, refetch: false, ...o.opts };
  const deps: BackfillDeps = {
    fetchPage: fakeFetch(o.data, o.fetchLog), quotaRemaining: () => 9000, readDb: async () => o.db ?? fakeDb(),
    applyCell: async (l, ym) => { applied.push(`${l}:${ym}`); return { status: 'COMPLETE', inserted: 1, updated: 0 }; },
    now: () => new Date('2026-09-19T03:00:00Z'), log: () => {}, ...o.deps,
  };
  return { outDir, applied, run: () => runBackfill(opts, deps) };
}
const read = (dir: string, f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const src = (p: string) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
const GATES_OK = { ALLOW_PROD_DB_READ: '1', ALLOW_PROD_DB_WRITE: '1', DEFECT_A_GATE_PASS: '1' };

test('1 · 1000행 초과 셀 — 모든 페이지를 읽어 계획', async () => {
  const rows = Array.from({ length: 1042 }, (_, i) => raw({ aptSeq: `11140-${i + 10}` }));
  const r = await setup({ data: { '11140': { '202609': rows } } }).run();
  assert.equal(r.summary.source.rows, 1042);
  assert.equal(r.summary.plan.inserts, 1042);
});

test('2 · COMPLETE는 수집 = totalCount일 때만, 아니면 PARTIAL로 계획하지 않는다', async () => {
  const short: PageFetcher = async (_l, _y, p) => ({ kind: 'OK', totalCount: 1200, items: Array.from({ length: p === 1 ? 1000 : 100 }, () => raw()) });
  assert.equal((await fetchSaleCell(short, '11140', '202609')).status, 'PARTIAL');
  const s = setup({ data: { '11140': { '202609': { fail: 'PARSE_ERROR', page: 2 } } } });
  const r = await s.run();
  assert.equal(r.summary.cellsByState.PARTIAL, 1);
  assert.equal(r.summary.plan.inserts, 0);
  assert.equal(read(s.outDir, 'paging-errors.json').length, 1);
});

test('3 · HTTP 오류·타임아웃은 빈 결과가 아니라 PARTIAL(적재 후보 0, 다른 셀과 섞지 않음)', async () => {
  const s = setup({ data: { '11140': { '202608': { fail: 'HTTP_ERROR' }, '202609': [raw()] } }, opts: { from: '202608', to: '202609' } });
  const r = await s.run();
  assert.deepEqual(r.summary.cellsByState, { PARTIAL: 1, READY: 1 });
  assert.equal(r.summary.plan.inserts, 1);
});

test('4·5 · master는 aptSeq 정확 일치만 — 없는 aptSeq는 MASTER_MISSING으로 분리(매핑·생성 없음)', async () => {
  assert.equal(classifyTradeMaster({ aptSeq: '11140-1', lawdCd: '11140' }, new Set(['11140-1'])), 'EXACT_MASTER');
  assert.equal(classifyTradeMaster({ aptSeq: '11140-999', lawdCd: '11140' }, new Set(['11140-1'])), 'MASTER_MISSING');
  assert.equal(classifyTradeMaster({ aptSeq: '11140-1012', lawdCd: '11200' }, new Set(['11140-1012'])), 'REVIEW_REQUIRED');
  assert.equal(classifyTradeMaster({ aptSeq: '26350-2', lawdCd: '11140' }, new Set()), 'INVALID_APTSEQ');
  const s = setup({ data: { '11140': { '202609': [raw(), raw({ aptSeq: '11140-999', aptNm: '옛단지' })] } } });
  const r = await s.run();
  assert.deepEqual([r.summary.master.EXACT_MASTER, r.summary.master.MASTER_MISSING], [1, 1]);
  const mm = read(s.outDir, 'master-missing.json');
  assert.equal(mm.list[0].aptSeq, '11140-999');
  assert.ok(!/apartmentMaster\.(create|update|upsert)/.test(src('backfill-seoul-sale.ts')), 'master를 만들지 않는다');
});

test('6 · 같은 조건 실제 복수 거래는 접지 않는다', async () => {
  const s = setup({ data: { '11140': { '202609': [raw(), raw(), raw()] } } });
  const r = await s.run();
  assert.equal(r.summary.plan.inserts, 3);
  assert.deepEqual(read(s.outDir, 'ready-inserts.json').rows.map((x: any) => x.occurrenceIndex), [0, 1, 2]);
});

test('7·8 · occurrenceIndex 결정성 · 응답 순서와 무관한 insert 수·취소 수', async () => {
  const items = [raw({ cdealType: 'O', cdealDay: '26.09.10' }), raw(), raw({ dealAmount: '99,000' })];
  const a = await setup({ data: { '11140': { '202609': items } } }).run();
  const b = await setup({ data: { '11140': { '202609': [...items].reverse() } } }).run();
  assert.equal(a.summary.plan.inserts, b.summary.plan.inserts);
  assert.equal(a.summary.source.canceled, b.summary.source.canceled);
  const c = await setup({ data: { '11140': { '202609': items } } }).run();
  assert.deepEqual(a.summary.plan, c.summary.plan);
});

test('9 · 원천 > DB — 부족분만 count 기반 insert', async () => {
  const db = fakeDb({ '11140:202609': [dbRow()] });
  const r = await setup({ data: { '11140': { '202609': [raw(), raw()] } }, db }).run();
  assert.equal(r.summary.plan.inserts, 1);
  assert.equal(r.summary.plan.existingMatched, 1);
});

test('10·13 · 원천 = DB — count 기반 reconcile, 기존 행 취소 drift는 별도 목록 + apply 승인 필요', async () => {
  const db = fakeDb({ '11140:202609': [dbRow({ id: 940441 })] });
  const s = setup({ data: { '11140': { '202609': [raw({ cdealType: 'O', cdealDay: '26.09.15' })] } }, db });
  const r = await s.run();
  assert.equal(r.summary.plan.inserts, 0);
  assert.equal(r.summary.plan.existingUpdates, 1);
  const drift = read(s.outDir, 'existing-state-drift.json');
  assert.deepEqual([drift.count, drift.rows[0].id, drift.rows[0].kind, drift.rows[0].dbCanceled, drift.rows[0].after.dealCanceled], [1, 940441, 'CANCEL_FLIP', false, true]);
  const g = evaluateApplyGates({ apply: true, env: GATES_OK, districtGiven: true, fromGiven: true, toGiven: true, expectInserts: 0, plannedInserts: 0, cellsNotReady: 0, existingUpdates: 1, approveExistingUpdates: false });
  assert.deepEqual(g.reasons, ['EXISTING_UPDATES_NEED_APPROVAL_1']);
});

test('11 · 원천 < DB — 삭제 없음(Defect B 보류), 셀은 BLOCKED로 적재 보류', async () => {
  const db = fakeDb({ '11140:202609': [dbRow({ id: 1 }), dbRow({ id: 2, occurrenceIndex: 1 })] });
  const r = await setup({ data: { '11140': { '202609': [raw()] } }, db }).run();
  assert.equal(r.summary.plan.inserts, 0);
  assert.equal(r.summary.cellsByState.BLOCKED, 1);
  assert.ok(!/\.(delete|deleteMany)\s*\(|DELETE FROM/.test(src('backfill-seoul-sale.ts')), 'driver에 삭제 경로 없음');
});

test('12 · 기존 자연키 일치 행은 SKIP(insert 0)', async () => {
  const s = setup({ data: { '11140': { '202609': [raw()] } }, db: fakeDb({ '11140:202609': [dbRow()] }) });
  const r = await s.run();
  assert.deepEqual([r.summary.plan.inserts, r.summary.plan.existingMatched, r.summary.plan.existingUpdates], [0, 1, 0]);
  assert.equal(read(s.outDir, 'existing-skipped.json').count, 1);
});

test('14 · 기존 행 조회는 dealDate 월 범위(index 사용) — 운영 core와 driver 모두', () => {
  assert.deepEqual(monthDateRange('202602'), { gte: new Date('2026-02-01T00:00:00Z'), lt: new Date('2026-03-01T00:00:00Z') });
  assert.deepEqual(monthDateRange('202612'), { gte: new Date('2026-12-01T00:00:00Z'), lt: new Date('2027-01-01T00:00:00Z') });
  assert.match(src('../src/lib/sync/sale-sync-core.ts'), /where: \{ lawdCd, dealYmd, dealDate: monthDateRange\(dealYmd\) \}/);
  assert.match(src('backfill-seoul-sale.ts'), /where: \{ lawdCd, dealYmd: ym, dealDate: monthDateRange\(ym\) \}/);
});

test('15 · checkpoint 재개 — 수집한 셀은 다시 부르지 않고 같은 결과', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seoul-sale-'));
  const data = { '11140': { '202608': [raw({ dealMonth: '8' })], '202609': [raw()] } };
  const r1 = await setup({ data, outDir, opts: { from: '202608', to: '202609' } }).run();
  const log: string[] = [];
  const r2 = await setup({ data, outDir, fetchLog: log, opts: { from: '202608', to: '202609' } }).run();
  assert.equal(log.length, 0);
  assert.deepEqual(r2.summary.plan, r1.summary.plan);
  assert.equal(r2.summary.calls, 0);
});

test('16 · quota 예약분에 닿으면 checkpoint 후 정지(나머지 PENDING)', async () => {
  assert.equal(quotaDecision(2000, 2000, 0, null), 'STOP_RESERVE');
  assert.equal(quotaDecision(5000, 2000, 10, 10), 'STOP_MAX_CALLS');
  assert.equal(quotaDecision(null, 2000, 0, null), 'CONTINUE');
  const s = setup({ data: { '11140': { '202608': [raw()], '202609': [raw()] } }, opts: { from: '202608', to: '202609' }, deps: { quotaRemaining: () => 1999 } });
  const r = await s.run();
  assert.equal(r.summary.stoppedBy, 'STOP_RESERVE');
  assert.equal(r.summary.cellsByState.PENDING, 2);
  assert.equal(r.summary.calls, 0);
});

test('17 · 429는 제한 횟수만 재시도, 소진되면 PARTIAL(무한 재시도 없음)', async () => {
  const s = setup({ data: { '11140': { '202609': { fail: 'RATE_LIMITED' } } } });
  const r = await s.run();
  assert.equal(r.summary.cellsByState.PARTIAL, 1);
  assert.match(src('backfill-seoul-sale.ts'), /if \(attempt < 4\) \{ await sleep\(1000 \* 2 \*\* attempt\); continue; \}/);
  assert.match(src('backfill-seoul-sale.ts'), /for \(let attempt = 0; attempt < 5; attempt\+\+\)/);
});

test('18 · dry-run(기본)은 쓰기 0 — apply 함수를 부르지 않는다', async () => {
  const s = setup({ data: { '11140': { '202609': [raw()] } } });
  const r = await s.run();
  assert.equal(s.applied.length, 0);
  assert.deepEqual(r.summary.writes, { insert: 0, update: 0, delete: 0 });
  assert.equal(r.summary.mode, 'DRY_RUN');
});

test('19 · Defect A gate — 다른 조건이 다 맞아도 DEFECT_A_GATE_PASS=1 없으면 BLOCKED_FOR_APPLY', async () => {
  const s = setup({ data: { '11140': { '202609': [raw()] } }, opts: { apply: true, env: { ALLOW_PROD_DB_READ: '1', ALLOW_PROD_DB_WRITE: '1' }, expectInserts: 1 } });
  const r = await s.run();
  assert.deepEqual(r.summary.apply.reasons, ['BLOCKED_FOR_APPLY_DEFECT_A_GATE']);
  assert.equal(s.applied.length, 0);
  const ok = setup({ data: { '11140': { '202609': [raw()] } }, opts: { apply: true, env: GATES_OK, expectInserts: 1 } });
  const r2 = await ok.run();
  assert.equal(r2.summary.mode, 'APPLIED');
  assert.deepEqual(ok.applied, ['11140:202609']);
});

test('20 · 범위 필수 — 구 없이·서울 밖·기간 없이 apply 불가, 서울 전체 one-shot 불가', async () => {
  assert.deepEqual(resolveScope({ districts: null, from: null, to: null }).errors, ['DISTRICT_REQUIRED']);
  assert.ok(resolveScope({ districts: ['26350'], from: null, to: null }).errors.includes('NOT_SEOUL_DISTRICT_26350'));
  assert.ok(resolveScope({ districts: ['11140'], from: '200501', to: '200512' }).errors.includes('FROM_BEFORE_200507'));
  const r = await setup({ data: { '11140': { '202609': [raw()] } }, opts: { apply: true, env: GATES_OK, expectInserts: 1, from: null, to: '202609' } }).run().catch((e) => e);
  assert.ok(!(r instanceof Error));
  assert.ok((r as any).summary.apply.reasons.includes('SCOPE_FROM_TO_REQUIRED'));
  assert.deepEqual(parseCli(['--district=11140', '--from=2025-10', '--to=2026-09']).from, '202510');
});

test('21 · 파일럿 dry-run(중구 12개월 형태) — 셀 12개, 분류 합계 일치', async () => {
  const months = ['202510', '202511', '202512', '202601', '202602', '202603', '202604', '202605', '202606', '202607', '202608', '202609'];
  const data = { '11140': Object.fromEntries(months.map((ym, i) => [ym, [raw({ dealYear: ym.slice(0, 4), dealMonth: String(Number(ym.slice(4))), dealDay: String(i + 1) })]])) };
  const r = await setup({ data, opts: { from: '202510', to: '202609' } }).run();
  assert.equal(r.summary.scope.cells, 12);
  assert.equal(r.summary.cellsByState.READY, 12);
  assert.equal(r.summary.source.rows, 12);
  assert.equal(r.summary.source.active + r.summary.source.canceled, r.summary.source.rows);
});

test('22 · 멱등 재실행 — 같은 원천·master·checkpoint면 같은 결과 · apply 결과가 계획과 다르면 그 셀에서 정지', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seoul-sale-'));
  const data = { '11140': { '202609': [raw(), raw({ aptSeq: '11140-999' })] } };
  const a = await setup({ data, outDir }).run();
  const b = await setup({ data, outDir }).run();
  const strip = (x: any) => ({ ...x, at: 0, ms: 0, calls: 0 });
  assert.deepEqual(strip(a.summary), strip(b.summary));
  const bad = setup({ data: { '11140': { '202608': [raw()], '202609': [raw()] } }, opts: { from: '202608', to: '202609', apply: true, env: GATES_OK, expectInserts: 2 },
    deps: { applyCell: async () => ({ status: 'COMPLETE', inserted: 0, updated: 0 }) } });
  const r = await bad.run();
  assert.match(r.summary.stoppedBy, /^APPLY_MISMATCH_11140_202608/);
});

// ── SEOUL_SALE_NATURAL_KEY_COLLISION_PATCH_V1 ────────────────────────────────
//
// 실측 근거(서울 1,440,126행 전수 census): 중복 자연키 2개, 전부 cross-district,
// aptSeq 11590-3369(관악푸르지오102동, 사당동) 한 단지. canonical 구는 동작구 11590이다
// — 두 응답 모두 aptSeq와 umdCd(10700 사당동)가 같고 sggCd만 조회 구를 되돌려준다.

const KEY_A = 'id:11590-3369::114.69::sale|106000|2025-03-15|4|0';
const KEY_B = 'id:11590-3369::114.69::sale|105000|2025-08-08|10|0';
const cell = (lawdCd: string, ym: string, keys: string[]): CellPlannedKeys =>
  ({ lawdCd, ym, keys: keys.map((naturalKey) => ({ naturalKey, aptSeq: '11590-3369' })) });

test('자연키/ canonical 구 추출 — lawdCd는 자연키에 없고, canonical은 aptSeq 앞 5자리뿐', () => {
  assert.equal(
    naturalKeyOf({ groupKeyStr: 'id:11590-3369::114.69::sale', dealAmount: 106000, dealDate: '2025-03-15', floor: 4, occurrenceIndex: 0 }),
    KEY_A
  );
  assert.equal(canonicalLawdCdOf('11590-3369'), '11590');
  assert.equal(canonicalLawdCdOf(null), null, '추측하지 않는다');
  assert.equal(canonicalLawdCdOf('관악푸르지오102동'), null, '이름으로 구를 정하지 않는다');
});

// A. 같은 실행에 동작·관악이 함께 있으면 뒤 구의 2행이 건너뛰어진다.
test('A · cross-district 중복 2행 → expectedSkips = 2', () => {
  const r = computeExpectedSkips(
    [cell('11590', '202503', [KEY_A]), cell('11590', '202508', [KEY_B]),
     cell('11620', '202503', [KEY_A]), cell('11620', '202508', [KEY_B])],
    new Set()
  );
  assert.equal(r.plannedInserts, 4);
  assert.equal(r.expectedSkips, 2);
  assert.equal(r.expectedActualInserts, 2);
  const gwanak = r.cells.filter((c) => c.lawdCd === '11620');
  assert.deepEqual(gwanak.map((c) => c.expectedSkips), [1, 1], '건너뛰는 쪽은 canonical이 아닌 관악이다');
  assert.deepEqual(gwanak.flatMap((c) => c.skipped.map((s) => s.reason)), ['RUN_EARLIER', 'RUN_EARLIER']);
});

// B. 충돌이 없는 구는 0이어야 한다(정상 구에 부작용 없음).
test('B · 충돌 없는 구 → expectedSkips = 0', () => {
  const r = computeExpectedSkips(
    [{ lawdCd: '11140', ym: '202609', keys: [{ naturalKey: 'id:11140-1::84.9::sale|120000|2026-09-03|5|0', aptSeq: '11140-1' }] }],
    new Set()
  );
  assert.equal(r.expectedSkips, 0);
  assert.equal(r.expectedActualInserts, 1);
  assert.equal(r.nonCanonicalOwnerWarnings.length, 0);
});

// C. canonical 구를 먼저 적재한 **이전 실행** 뒤에는, 관악만 돌려도 DB에 이미 있어 건너뛴다.
test('C · canonical 구가 먼저 적재된 뒤 관악만 실행하면 DB_EXISTS로 건너뛴다', () => {
  const r = computeExpectedSkips(
    [cell('11620', '202503', [KEY_A]), cell('11620', '202508', [KEY_B])],
    new Set([KEY_A, KEY_B]) // 동작구가 이미 넣어 둔 상태
  );
  assert.equal(r.expectedSkips, 2);
  assert.equal(r.expectedActualInserts, 0);
  assert.deepEqual(r.cells.flatMap((c) => c.skipped.map((s) => s.reason)), ['DB_EXISTS', 'DB_EXISTS']);
});

// D. 순서가 뒤집혀 canonical이 아닌 구가 행을 차지하면 경고한다(적용 순서 조정 신호).
test('D · canonical owner 순서 검증 — 관악이 먼저면 경고, 동작이 먼저면 경고 없음', () => {
  const wrong = computeExpectedSkips([cell('11620', '202503', [KEY_A]), cell('11590', '202503', [KEY_A])], new Set());
  assert.equal(wrong.expectedSkips, 1);
  assert.equal(wrong.nonCanonicalOwnerWarnings.length, 1);
  assert.equal(wrong.nonCanonicalOwnerWarnings[0].claimedBy, '11620');
  assert.equal(wrong.nonCanonicalOwnerWarnings[0].canonicalLawdCd, '11590');

  const right = computeExpectedSkips([cell('11590', '202503', [KEY_A]), cell('11620', '202503', [KEY_A])], new Set());
  assert.equal(right.expectedSkips, 1);
  assert.equal(right.nonCanonicalOwnerWarnings.length, 0, 'canonical이 차지했으면 경고하지 않는다');
});

// E. 중구 파일럿(최근 12개월 944행) — 충돌 0이므로 계획과 실제가 같아야 한다.
test('E · 중구 파일럿 944행 → skip 0, 예상 실제 insert 944', () => {
  const keys: CellPlannedKeys[] = Array.from({ length: 12 }, (_, m) => ({
    lawdCd: '11140', ym: `2026${String(m + 1).padStart(2, '0')}`,
    keys: Array.from({ length: m === 0 ? 944 - 11 * 1 : 1 }, (_, i) => ({ naturalKey: `id:11140-${m}-${i}::84.9::sale|1|2026-01-01|1|0`, aptSeq: '11140-1' })),
  }));
  const total = keys.reduce((s, c) => s + c.keys.length, 0);
  assert.equal(total, 944, 'fixture가 파일럿 규모와 같은지');
  const r = computeExpectedSkips(keys, new Set());
  assert.equal(r.plannedInserts, 944);
  assert.equal(r.expectedSkips, 0);
  assert.equal(r.expectedActualInserts, 944);
});

// applyMatchesPlan — 오탐 정지의 실제 원인이 닫혔는지.
test('applyMatchesPlan — expectedSkips만큼 적게 들어와도 정상으로 본다', () => {
  // 예전 동작(보정 없음)에서는 오탐 정지였다.
  assert.equal(applyMatchesPlan({ inserted: 8, updated: 0 }, { inserts: 10, cancelFlips: 0 }), false);
  // 보정 후: 10 계획 − 2 skip = 8이 정상.
  assert.equal(applyMatchesPlan({ inserted: 8, updated: 0 }, { inserts: 10, cancelFlips: 0, expectedSkips: 2 }), true);
  // 그래도 그보다 더/덜 들어오면 여전히 정지한다.
  assert.equal(applyMatchesPlan({ inserted: 9, updated: 0 }, { inserts: 10, cancelFlips: 0, expectedSkips: 2 }), false);
  assert.equal(applyMatchesPlan({ inserted: 7, updated: 0 }, { inserts: 10, cancelFlips: 0, expectedSkips: 2 }), false);
  // 취소 flip 수는 기존대로 정확히 일치해야 한다.
  assert.equal(applyMatchesPlan({ inserted: 8, updated: 1 }, { inserts: 10, cancelFlips: 0, expectedSkips: 2 }), false);
  // expectedSkips를 주지 않으면 기존 동작 그대로.
  assert.equal(applyMatchesPlan({ inserted: 10, updated: 0 }, { inserts: 10, cancelFlips: 0 }), true);
});
