import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildInventory,
  classifyDistrict,
  crossCheckWithRegistry,
  DEFAULT_CLASSIFY,
  detectCodeDiscontinuity,
  estimateDistrictCalls,
  evaluateNationalApplyGate,
  mapDriverCellState,
  aggregateDistrictState,
  planBatch,
  planHash,
  readinessLevels,
  resumeAction,
  safeBackfillBudget,
  twoPassCost,
  type DistrictEvidence,
  type InventoryEntry,
  type InventorySnapshot,
  type NationalApplyGateInput,
  type PlanCandidate,
  type QuotaModel,
} from './orchestrator-logic';
import { loadInventory, runNationalDryRun } from './orchestrator';
import { classifyTradeMaster } from '../backfill-seoul-sale-logic';
import type { BackfillDeps, ReadDb } from '../backfill-seoul-sale';
import type { PageFetcher } from '../seed-seoul-apartment-master-logic';
import { REGION_NODES } from '../../src/lib/region/registry';
import { BUSAN_LAWDCD_16 } from '../../src/lib/rent-verified-range';
import { SEOUL_SALE_SYNC_LAWDCDS } from '../../src/lib/sync/sale-sync-scope';

// NATIONAL_BACKFILL_ORCHESTRATOR_V1 — 네트워크·DB 없이 오케스트레이터 규칙을 고정한다.

const ROOT = path.resolve(__dirname, '../..');
/** 주석을 뺀 실제 코드만 본다. */
const code = (p: string) => fs.readFileSync(path.resolve(ROOT, p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\/\/[^\n'`]*$/gm, '');
const FILES = ['scripts/national-backfill/orchestrator.ts', 'scripts/national-backfill/orchestrator-logic.ts', 'scripts/national-backfill/build-inventory-snapshot.ts'];

const NOW = new Date('2026-09-24T12:00:00Z');
const CTX = { ...DEFAULT_CLASSIFY, latestComplete: '202608', now: NOW };
const inv = loadInventory();
const entry = (lawdCd: string) => inv.entries.find((e) => e.lawdCd === lawdCd)!;
const ev = (o: Partial<DistrictEvidence> = {}): DistrictEvidence => ({
  lawdCd: '00000', tradeRows: 0, canceledRows: 0, earliestYm: null, latestYm: null, monthsWithRows: 0, distinctAptSeq: 0,
  masters: 0, geocodedMasters: 0, coverageCells: 0, emptyValidCoverageCells: 0, latestVerifiedAt: null, inCron: false, isPublic: false, ...o,
});
/** audit가 부산·서울 8구에서 실제로 본 모양(2006-01부터 249개월, cron 유지, 어제 검증). */
const fullHistory = (lawdCd: string) => ev({ lawdCd, tradeRows: 50_000, earliestYm: '200601', latestYm: '202609', monthsWithRows: 249, coverageCells: 13, latestVerifiedAt: '2026-09-23T23:46:47Z', inCron: true, isPublic: true });

// ── 1·2 inventory ─────────────────────────────────────────────────────────

test('1 · inventory 무결성 — 스냅샷이 오류 없이 빌드되고 registry(부산·서울·경기)와 코드·이름·leaf가 전부 같다', () => {
  assert.deepEqual(inv.errors, []);
  assert.equal(inv.entries.length, 261);
  assert.equal(new Set(inv.entries.map((e) => e.sidoCode)).size, 16);
  const xc = crossCheckWithRegistry(inv, REGION_NODES);
  assert.ok(xc.ok, JSON.stringify(xc));
  // 프록시에 없는 지역은 코드를 지어내지 않고 gap으로만 기록한다.
  assert.ok(!inv.entries.some((e) => e.sidoCode === '36' || e.sidoCode === '52'));
  assert.ok(inv.gaps.some((g) => g.what.includes('세종')));
});

test('2 · 중복·잘못된 lawdCd를 거부한다', () => {
  assert.equal(new Set(inv.entries.map((e) => e.lawdCd)).size, inv.entries.length);
  const bad: InventorySnapshot = { source: 't', fetchedAt: '', sidos: [{ code: '26', name: '부산광역시' }], sigungu: [{ lawdCd: '26110', fullName: '부산광역시 중구' }, { lawdCd: '26110', fullName: '부산광역시 중구' }, { lawdCd: '2614', fullName: '부산광역시 서구' }, { lawdCd: '99110', fullName: '어딘가 구' }], knownGaps: [], reviewNotes: {} };
  const errs = buildInventory(bad).errors;
  assert.ok(errs.includes('DUPLICATE_CODE_26110'));
  assert.ok(errs.includes('INVALID_CODE_2614'));
  assert.ok(errs.includes('UNKNOWN_SIDO_99110'));
});

test('2b · leaf 판정은 코드 앞 4자리만 보지 않는다 — 영동군(43740)과 증평군(43745)은 별개 군', () => {
  assert.equal(entry('43740').isMolitLeaf, true);
  assert.equal(entry('43745').parentLawdCd, null);
  assert.equal(entry('41110').isMolitLeaf, false); // 수원시(부모)
  assert.equal(entry('41135').parentLawdCd, '41130'); // 분당구 → 성남시
  assert.equal(inv.entries.filter((e) => !e.isMolitLeaf).length, 11);
});

// ── 3·4·5 분류 ────────────────────────────────────────────────────────────

test('3 · 부산 16구는 증거만으로 COMPLETE', () => {
  for (const c of BUSAN_LAWDCD_16) assert.equal(classifyDistrict(entry(c), fullHistory(c), CTX).status, 'COMPLETE', c);
});

test('4 · 서울 8구는 증거만으로 COMPLETE, 같은 이력이라도 cron 밖이면 REVIEW', () => {
  for (const c of SEOUL_SALE_SYNC_LAWDCDS) assert.equal(classifyDistrict(entry(c), fullHistory(c), CTX).status, 'COMPLETE', c);
  const r = classifyDistrict(entry('11650'), { ...fullHistory('11650'), inCron: false }, CTX);
  assert.equal(r.status, 'REVIEW_REQUIRED');
  assert.ok(r.reasons.includes('NOT_IN_CRON'));
  const stale = classifyDistrict(entry('11110'), { ...fullHistory('11110'), latestVerifiedAt: '2026-09-01T00:00:00Z' }, CTX);
  assert.ok(stale.reasons.includes('COVERAGE_STALE'));
});

test('5 · 강남 11680(46행 파일럿)은 PARTIAL, 행 0은 NOT_STARTED, 부모 코드는 BLOCKED, 코드 체계 의심은 REVIEW', () => {
  const g = classifyDistrict(entry('11680'), ev({ tradeRows: 46, earliestYm: '202608', latestYm: '202608', monthsWithRows: 1 }), CTX);
  assert.equal(g.status, 'PARTIAL');
  assert.ok(g.reasons.includes('HISTORY_STARTS_202608'));
  assert.equal(classifyDistrict(entry('11650'), ev(), CTX).status, 'NOT_STARTED');
  assert.equal(classifyDistrict(entry('41110'), ev(), CTX).status, 'BLOCKED');
  assert.equal(classifyDistrict(entry('41190'), ev(), CTX).status, 'REVIEW_REQUIRED');
  assert.equal(classifyDistrict(entry('45130'), ev(), CTX).status, 'REVIEW_REQUIRED'); // 전북 45 체계
  assert.equal(classifyDistrict(entry('11650'), ev({ coverageCells: 3, emptyValidCoverageCells: 3 }), CTX).status, 'EMPTY');
});

// ── 6·7·8·9 계획 · quota ─────────────────────────────────────────────────

const QUOTA: QuotaModel = { dailyLimit: 10_000, reserve: 2_000, cronAllowance: 479, appAllowance: 1_000 };
const EST = { from: '200507', to: '202609', priorMultipageRate: 0.064, unknownVolumeMargin: 1.15, knownVolumeMargin: 1.1 };
const cand = (lawdCd: string, status: PlanCandidate['status'] = 'NOT_STARTED'): PlanCandidate => ({
  entry: entry(lawdCd), status, statusReasons: [], estimate: estimateDistrictCalls(lawdCd, null, EST), masters: 0, geocodedMasters: 0,
});
const gyeonggi = inv.entries.filter((e) => e.sidoCode === '41' && e.isMolitLeaf && !e.reviewNotes.length).map((e) => cand(e.lawdCd));

test('6 · max-calls를 넘지 않는다', () => {
  const p = planBatch(gyeonggi, { strategy: 'sido', sido: '41', maxCalls: 1000, maxDistricts: 50, quota: QUOTA });
  assert.equal(p.verdict, 'PLANNED');
  assert.ok(p.totals.dryRun <= 1000, String(p.totals.dryRun));
  assert.equal(p.districts.length, 3);
});

test('7 · max-districts를 넘지 않고, 한 시의 일반구를 쪼개지 않는다', () => {
  const p = planBatch(gyeonggi, { strategy: 'priority', maxCalls: 100_000, maxDistricts: 5, quota: { ...QUOTA, dailyLimit: 1_000_000 } });
  assert.ok(p.districts.length <= 5);
  const parents = new Map<string, number>();
  for (const d of p.districts) { const par = entry(d.lawdCd).parentLawdCd; if (par) parents.set(par, (parents.get(par) ?? 0) + 1); }
  for (const [par, n] of parents) assert.equal(n, inv.entries.filter((e) => e.parentLawdCd === par).length, `${par} 일부만 들어갔다`);
});

test('8 · reserve는 침범할 수 없다 — safe budget = limit − reserve − cron − app, 초과 계획은 BLOCKED_BY_QUOTA_PLAN', () => {
  assert.equal(safeBackfillBudget(QUOTA), 6_521);
  const tight = planBatch(gyeonggi, { strategy: 'manual', districts: ['41135'], maxCalls: 50_000, maxDistricts: 10, quota: { ...QUOTA, dailyLimit: 3_500 } });
  assert.notEqual(tight.verdict, 'PLANNED');
  const p = planBatch(gyeonggi, { strategy: 'sido', sido: '41', maxCalls: 50_000, maxDistricts: 100, quota: QUOTA });
  assert.ok(p.totals.dryRun <= p.quota.safeBudget);
  assert.equal(planBatch([], { strategy: 'priority', maxCalls: 3000, maxDistricts: 5, quota: { ...QUOTA, reserve: 20_000 } }).verdict, 'BLOCKED_BY_QUOTA_PLAN');
});

test('9 · 2-pass 비용 — apply는 원천을 다시 가져오므로 dry-run과 같고, 0으로 보고하지 않는다', () => {
  assert.deepEqual(twoPassCost(313), { dryRun: 313, apply: 313, total: 626, applyReusesRaw: false });
  const p = planBatch(gyeonggi, { strategy: 'priority', maxCalls: 3000, maxDistricts: 10, quota: QUOTA });
  assert.equal(p.totals.apply, p.totals.dryRun);
  assert.equal(p.totals.total, p.totals.dryRun * 2);
  // 추정은 월당 1콜로 끝나지 않는다(다중 페이지 prior + 여유).
  const e = estimateDistrictCalls('41135', null, EST);
  assert.ok(e.plannedCalls > e.months);
  const hist = estimateDistrictCalls('26350', { '202001': 2442, '202002': 1500, '202003': 10 }, { ...EST, from: '202001', to: '202003' });
  assert.equal(hist.extraPages, 2 + 1);
});

// ── 10 resume ─────────────────────────────────────────────────────────────

test('10a · resume 규칙 — APPLIED 재적용 없음, REVIEW/BLOCKED 자동 통과 없음, ERROR는 명시할 때만', () => {
  const o = { retryErrors: false, replan: false };
  assert.equal(resumeAction('APPLIED', o), 'SKIP_APPLIED');
  assert.equal(resumeAction('REVIEW', o), 'SKIP_REVIEW');
  assert.equal(resumeAction('BLOCKED', o), 'SKIP_BLOCKED');
  assert.equal(resumeAction('ERROR', o), 'SKIP_ERROR');
  assert.equal(resumeAction('ERROR', { ...o, retryErrors: true }), 'RETRY_ERROR');
  assert.equal(resumeAction('READY', o), 'SKIP_READY');
  assert.equal(resumeAction('IN_PROGRESS', o), 'RUN_DRY_RUN');
});

// ── 가짜 driver 의존성 ───────────────────────────────────────────────────

const raw = (lawdCd: string, seq: number, o: Record<string, string> = {}) => ({
  aptSeq: `${lawdCd}-${seq}`, aptNm: `단지${seq}`, umdNm: '가동', jibun: '1', sggCd: lawdCd, excluUseAr: '84.9', dealAmount: '50,000',
  dealYear: '2026', dealMonth: '8', dealDay: '3', floor: '5', buildYear: '2002', cdealType: '', cdealDay: '', rgstDate: '', ...o,
});
function fakeDeps(o: { rows?: (lawdCd: string, ym: string) => any[]; failDistrict?: string; throwDistrict?: string; calls?: string[] } = {}) {
  const calls = o.calls ?? [];
  const applied: string[] = [];
  const writes: string[] = [];
  const fetchPage: PageFetcher = async (lawdCd, ym) => {
    calls.push(`${lawdCd}:${ym}`);
    if (lawdCd === o.failDistrict) return { kind: 'HTTP_ERROR', detail: 'fake' };
    const items = o.rows ? o.rows(lawdCd, ym) : [raw(lawdCd, 1, { dealYear: ym.slice(0, 4), dealMonth: String(Number(ym.slice(4))) })];
    return { kind: 'OK', totalCount: items.length, items };
  };
  const db: ReadDb = {
    findExisting: async (l) => { if (l === o.throwDistrict) throw new Error('db down'); return []; },
    seoulMasterAptSeqs: async () => new Set(),
    masterAptSeqsFor: async () => new Set(),
    existingNaturalKeys: async () => new Set(),
  };
  const deps: BackfillDeps = {
    fetchPage, quotaRemaining: () => 9000, readDb: async () => db,
    applyCell: async (l, ym) => { applied.push(`${l}:${ym}`); writes.push(`${l}:${ym}`); return { status: 'COMPLETE', inserted: 1, updated: 0 }; },
    now: () => NOW, log: () => {},
  };
  return { deps, applied, writes, calls };
}
const leaves = new Set(inv.entries.filter((e) => e.isMolitLeaf).map((e) => e.lawdCd));
const known = new Set(inv.entries.map((e) => e.lawdCd));
const runOpts = (outRoot: string, o: Partial<Parameters<typeof runNationalDryRun>[0]> = {}) => ({
  outRoot, districts: ['41135', '41150', '41210'], from: '202607', to: '202608', maxCalls: 100, reserveCalls: 2000,
  resume: false, retryErrors: false, replan: false, allowedDistricts: leaves, knownCodes: known, ...o,
});
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'national-'));
const cpOf = (root: string, d: string) => JSON.parse(fs.readFileSync(path.join(root, 'districts', d, 'checkpoint.json'), 'utf8'));

test('10b · 중단 후 재개 — 한도로 멈춘 뒤 --resume은 끝난 구를 다시 가져오지 않고 남은 구만 이어간다', async () => {
  const root = tmp();
  const calls: string[] = [];
  const f1 = fakeDeps({ calls });
  const s1 = await runNationalDryRun(runOpts(root, { maxCalls: 3 }), f1.deps); // 구당 2콜 → 둘째 구 중간에 멈춤
  assert.equal(s1.stoppedBy, 'STOP_MAX_CALLS');
  assert.equal(cpOf(root, '41135').state, 'READY');
  assert.equal(cpOf(root, '41150').state, 'IN_PROGRESS');
  await assert.rejects(runNationalDryRun(runOpts(root), fakeDeps().deps), /--resume/);
  const before = calls.length;
  const s2 = await runNationalDryRun(runOpts(root, { resume: true }), fakeDeps({ calls }).deps);
  assert.equal(s2.results.find((r) => r.lawdCd === '41135')!.action, 'SKIP_READY');
  assert.ok(!calls.slice(before).some((c) => c.startsWith('41135')), '끝난 구를 다시 가져왔다');
  assert.ok(!calls.slice(before).includes('41150:202607'), 'READY 셀을 다시 가져왔다');
  assert.equal(cpOf(root, '41150').state, 'READY');
  assert.equal(cpOf(root, '41210').state, 'READY');
});

test('10c · 기간이 다른 checkpoint(예: 1셀 probe)는 READY여도 재개 때 다시 계획한다', async () => {
  const root = tmp();
  await runNationalDryRun(runOpts(root, { districts: ['41135'], from: '202608', to: '202608' }), fakeDeps().deps);
  assert.equal(cpOf(root, '41135').state, 'READY');
  const s = await runNationalDryRun(runOpts(root, { districts: ['41135'], resume: true }), fakeDeps().deps);
  assert.equal(s.results[0].action, 'RESUMED');
  assert.deepEqual(cpOf(root, '41135').window, { from: '202607', to: '202608' });
});

// ── 11·12·13 apply 게이트 ────────────────────────────────────────────────

const GATE_OK: NationalApplyGateInput = {
  apply: true, env: { ALLOW_PROD_DB_READ: '1', ALLOW_PROD_DB_WRITE: '1', DEFECT_A_GATE_PASS: '1' },
  plannedDistricts: ['41135', '41150'], requestedDistricts: ['41150', '41135'], expectInserts: 100, plannedInserts: 100,
  recordedPlanHash: 'h', recomputedPlanHash: 'h', givenPlanHash: 'h', recordedReview: 0, currentReview: 0,
  unexpectedUpdates: 0, approveExistingUpdates: false, districtStates: { '41135': 'READY', '41150': 'READY' },
  observedQuota: { remaining: 9000, at: '2026-09-24T11:30:00Z' }, now: NOW, reserve: 2000, applyEstimate: 626, quotaMaxAgeMs: 2 * 3600 * 1000,
};

test('11 · 검토 대상이 있으면(또는 새로 생기면) apply 거부', () => {
  assert.deepEqual(evaluateNationalApplyGate(GATE_OK), { allowed: true, reasons: [] });
  const r = evaluateNationalApplyGate({ ...GATE_OK, currentReview: 2 });
  assert.ok(r.reasons.includes('REVIEW_PRESENT_2') && r.reasons.includes('NEW_REVIEW_APPEARED_0_TO_2'));
  assert.ok(!evaluateNationalApplyGate({ ...GATE_OK, districtStates: { '41135': 'REVIEW', '41150': 'READY' } }).allowed);
});

test('12 · 기존 행 UPDATE는 명시 승인 없이 거부, 계획 insert 수가 바뀌어도 거부', () => {
  assert.ok(evaluateNationalApplyGate({ ...GATE_OK, unexpectedUpdates: 3 }).reasons.includes('UNEXPECTED_EXISTING_UPDATES_3'));
  assert.ok(evaluateNationalApplyGate({ ...GATE_OK, unexpectedUpdates: 3, approveExistingUpdates: true }).allowed);
  assert.ok(evaluateNationalApplyGate({ ...GATE_OK, plannedInserts: 101 }).reasons.includes('PLANNED_INSERTS_CHANGED_100_NE_101'));
});

test('13 · checkpoint hash drift · 구 범위 변경 · quota 미확인/부족 · env 누락은 전부 거부', () => {
  assert.ok(evaluateNationalApplyGate({ ...GATE_OK, recomputedPlanHash: 'x', givenPlanHash: 'x' }).reasons.includes('CHECKPOINT_HASH_DRIFT'));
  assert.ok(evaluateNationalApplyGate({ ...GATE_OK, givenPlanHash: null }).reasons.includes('PLAN_HASH_ARG_REQUIRED'));
  assert.ok(evaluateNationalApplyGate({ ...GATE_OK, requestedDistricts: ['41135'] }).reasons.some((r) => r.startsWith('DISTRICT_SCOPE_CHANGED')));
  assert.ok(evaluateNationalApplyGate({ ...GATE_OK, observedQuota: null }).reasons.includes('QUOTA_UNKNOWN'));
  assert.ok(evaluateNationalApplyGate({ ...GATE_OK, observedQuota: { remaining: 2400, at: GATE_OK.observedQuota!.at } }).reasons.some((r) => r.startsWith('QUOTA_BELOW_RESERVE')));
  assert.ok(evaluateNationalApplyGate({ ...GATE_OK, observedQuota: { remaining: 9000, at: '2026-09-23T00:00:00Z' } }).reasons.includes('QUOTA_OBSERVATION_STALE'));
  assert.ok(evaluateNationalApplyGate({ ...GATE_OK, env: {} }).reasons.includes('DEFECT_A_GATE_NOT_PASSED'));
  // hash는 셀·키 순서와 무관하고 내용이 바뀌면 달라진다.
  const c = { lawdCd: '41135', ym: '202608', state: 'READY', totalCount: 2, inserts: 2, cancelFlips: 0, cancelRestores: 0, registrySupplements: 0, reviewCandidates: 0, insertKeys: ['a', 'b'] };
  assert.equal(planHash([c, { ...c, ym: '202607' }]), planHash([{ ...c, ym: '202607' }, { ...c, insertKeys: ['b', 'a'] }]));
  assert.notEqual(planHash([c]), planHash([{ ...c, inserts: 3 }]));
});

// ── 14 master · 18 identity ──────────────────────────────────────────────

test('14 · master가 없어도 적재 계획은 되고(MASTER_MISSING), master를 만들지 않는다', async () => {
  assert.equal(classifyTradeMaster({ aptSeq: '41135-7', lawdCd: '41135' }, new Set(), known), 'MASTER_MISSING');
  const root = tmp();
  const s = await runNationalDryRun(runOpts(root, { districts: ['41135'], from: '202608', to: '202608' }), fakeDeps().deps);
  assert.equal(s.districts[0].plannedInserts, 1);
  const sum = JSON.parse(fs.readFileSync(path.join(root, 'districts', '41135', 'summary.json'), 'utf8'));
  assert.equal(sum.master.MASTER_MISSING, 1);
  for (const f of [...FILES, 'scripts/backfill-seoul-sale.ts']) assert.ok(!/apartmentMaster\.(create|update|upsert|delete)/.test(code(f)), f);
});

test('18 · 이름 유사 매칭 없음 — aptSeq 정확 일치만, 다른 구 aptSeq는 REVIEW(서대문↔강동 선례)', () => {
  assert.equal(classifyTradeMaster({ aptSeq: '41135-8', lawdCd: '41135' }, new Set(['41135-80']), known), 'MASTER_MISSING');
  assert.equal(classifyTradeMaster({ aptSeq: '11740-12', lawdCd: '11410' }, new Set(['11740-12']), known), 'REVIEW_REQUIRED');
  assert.equal(classifyTradeMaster({ aptSeq: '99999-1', lawdCd: '41135' }, new Set(), known), 'INVALID_APTSEQ');
  for (const f of FILES) assert.ok(!/normalizedName|aptName\s*===|\.name\.includes\(|contains:/.test(code(f)), `${f}에 이름 기반 판정`);
});

test('18b · 다른 구 aptSeq가 섞이면 구 전체가 REVIEW로 서고 자동 진행되지 않는다', async () => {
  const root = tmp();
  const f = fakeDeps({ rows: (l) => [raw(l, 1), raw('41131', 99)] });
  const s = await runNationalDryRun(runOpts(root, { districts: ['41135'], from: '202608', to: '202608' }), f.deps);
  assert.equal(s.districts[0].state, 'REVIEW');
  assert.equal(s.districts[0].review, 1);
  assert.equal(resumeAction('REVIEW', { retryErrors: true, replan: true }), 'SKIP_REVIEW');
});

// ── 15·16 노출·cron 분리 ─────────────────────────────────────────────────

test('15 · 공개 노출은 건드리지 않는다 — publicReady는 항상 false, 어떤 파일도 src/·vercel.json을 쓰지 않는다', () => {
  assert.equal(readinessLevels('41135', 'APPLIED', true).publicReady, false);
  for (const f of FILES) {
    const c = code(f);
    assert.ok(!/writeFileSync\([^)]*(src\/|enablement|vercel\.json|sale-sync-scope)/.test(c), f);
    assert.ok(!/SEOUL_BETA_ENABLED\s*=|ENABLEMENT_BY_(SIDO|LAWDCD)/.test(c), f);
  }
});

test('16 · cron 범위는 건드리지 않는다 — 후보만, dry-run 후보는 비어 있다', async () => {
  const lv = readinessLevels('41135', 'APPLIED', true);
  assert.equal(lv.cronReadyCandidate, true);
  assert.ok(lv.notes.includes('CRON_EXPANSION_REQUIRES_SEPARATE_REVIEW'));
  assert.equal(readinessLevels('41135', 'READY', true).cronReadyCandidate, false);
  const s = await runNationalDryRun(runOpts(tmp(), { districts: ['41135'], from: '202608', to: '202608' }), fakeDeps().deps);
  assert.deepEqual(s.cronExpansionCandidates, []);
  assert.deepEqual([...SEOUL_SALE_SYNC_LAWDCDS].sort(), ['11110', '11140', '11170', '11215', '11230', '11410', '11440', '11545']);
});

test('17 · 지역 접두사 지름길 없음(startsWith / LIKE 접두사)', () => {
  for (const f of FILES) {
    const c = code(f);
    assert.ok(!/startsWith\('\d{2}'\)|LIKE '\d{2}%'/.test(c), `${f}가 접두사로 지역을 판정한다`);
  }
});

// ── 19·20 격리 · dry-run 무쓰기 ──────────────────────────────────────────

test('19 · 구 격리 — 한 구의 수집 오류·예외가 다른 구의 결과를 바꾸지 않는다', async () => {
  const root = tmp();
  const s = await runNationalDryRun(runOpts(root, { districts: ['41135', '41150', '41210'] }), fakeDeps({ failDistrict: '41150' }).deps);
  assert.equal(cpOf(root, '41135').state, 'READY');
  assert.equal(cpOf(root, '41150').state, 'ERROR');
  assert.equal(cpOf(root, '41210').state, 'READY');
  const root2 = tmp();
  await runNationalDryRun(runOpts(root2, { districts: ['41135', '41150', '41210'] }), fakeDeps({ throwDistrict: '41150' }).deps);
  assert.equal(cpOf(root2, '41150').state, 'ERROR');
  assert.equal(cpOf(root2, '41210').state, 'READY');
  assert.equal(s.results.length, 3);
});

test('20 · dry-run은 DB write 0 — applyCell 한 번도 호출되지 않고 읽기 의존성만 쓴다', async () => {
  const f = fakeDeps();
  const s = await runNationalDryRun(runOpts(tmp()), f.deps);
  assert.deepEqual(f.applied, []);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(s.writes, { insert: 0, update: 0, delete: 0 });
  assert.equal(s.mode, 'DRY_RUN');
});

// ── 부가: 상태 매핑 · 코드 연속성 ────────────────────────────────────────

test('상태 매핑은 기록된 상태로만 — 파일 존재로 완료를 추론하지 않는다', () => {
  assert.equal(mapDriverCellState(undefined, false), 'PENDING');
  assert.equal(mapDriverCellState({ state: 'PARTIAL' }, false), 'ERROR');
  assert.equal(mapDriverCellState({ state: 'READY', totalCount: 0 }, false), 'EMPTY_VALID');
  assert.equal(mapDriverCellState({ state: 'READY', totalCount: 3 }, true), 'REVIEW');
  assert.equal(aggregateDistrictState(['READY', 'EMPTY_VALID'], 2), 'READY');
  assert.equal(aggregateDistrictState(['READY', 'ERROR'], 2), 'ERROR');
  assert.equal(aggregateDistrictState(['READY'], 2), 'IN_PROGRESS');
  assert.equal(aggregateDistrictState(['APPLIED', 'EMPTY_VALID'], 2), 'APPLIED');
});

test('코드 체계 불연속(긴 앞/뒤 0건 구간·전부 0건)은 REVIEW 신호', () => {
  const series = (n: number, zeroFrom: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`20${String(10 + Math.floor(i / 12)).padStart(2, '0')}${String((i % 12) + 1).padStart(2, '0')}`, i >= zeroFrom ? 0 : 50]));
  assert.ok(detectCodeDiscontinuity(series(60, 40)).some((f) => f.startsWith('TRAILING_EMPTY_20')));
  assert.deepEqual(detectCodeDiscontinuity(series(60, 999)), []);
  assert.deepEqual(detectCodeDiscontinuity({ '202001': 0, '202002': 0 }), ['ALL_MONTHS_EMPTY']);
});
