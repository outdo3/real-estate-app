/**
 * SEOUL_SALE_BACKFILL_DRIVER_V1 — 서울 아파트 매매 full-history backfill driver.
 *
 * 기본은 DRY RUN(쓰기 0, 쓰기 가능한 DB 객체도 만들지 않음). 쓰기 판정은 운영 cron과 같은
 * `planSaleCellWrites`(dry-run) / `syncOneSaleCell(..., 'apply')`(apply)를 그대로 쓴다 — 취소·insert 판정을 복제하지 않는다.
 *
 * apply는 아직 **BLOCKED_FOR_APPLY**(Defect A 선결). 조건이 모두 맞아야만 쓴다:
 *   --apply · ALLOW_PROD_DB_READ=1 · ALLOW_PROD_DB_WRITE=1 · DEFECT_A_GATE_PASS=1 · --district · --from · --to ·
 *   --expect-inserts=<dry-run 계획 insert 수> · 범위 전 셀 READY · (기존 행 UPDATE가 있으면) --approve-existing-updates
 *
 * 원천: MOLIT RTMSDataSvcAptTradeDev, 구+연월 셀. totalCount까지 전 페이지, 수집 = totalCount일 때만 COMPLETE.
 * 오류는 빈 결과가 아니라 PARTIAL/ERROR. x-ratelimit-remaining이 예약분(--reserve-calls, 기본 2000)에 닿으면 checkpoint 후 정지.
 *
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/backfill-seoul-sale.ts --district=11140 --from=2025-10 --to=2026-09
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import * as zlib from 'zlib';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { createMolitXmlParser, mapMolitItems } from '../src/lib/api-molit';
import { normalizeMolitItemsToTradeRows, type TradeRowInput } from './trade-history-logic';
import { planSaleCellWrites, type ExistingTradeRow, type SaleCellPlan } from '../src/lib/sync/sale-sync-core';
import { fetchSaleCell, type PageFetcher, type PageOutcome } from './seed-seoul-apartment-master-logic';
import {
  applyMatchesPlan,
  cellStateFromPlan,
  classifyTradeMaster,
  evaluateApplyGates,
  existingRowDrift,
  parseYm,
  quotaDecision,
  resolveScope,
  type CellState,
  type DriftRow,
  type MasterClass,
} from './backfill-seoul-sale-logic';

// ───────────────────────── 의존성 ─────────────────────────

export interface ReadDb {
  /** 운영 syncOneSaleCell과 같은 조건(lawdCd·dealYmd·dealDate 월 범위)으로 셀의 기존 행을 읽는다. */
  findExisting(lawdCd: string, ym: string): Promise<ExistingTradeRow[]>;
  seoulMasterAptSeqs(): Promise<Set<string>>;
}

export interface ApplyCellReport { status: string; inserted: number; updated: number }

export interface BackfillDeps {
  fetchPage: PageFetcher;
  quotaRemaining: () => number | null;
  readDb: () => Promise<ReadDb>;
  /** 모든 게이트 통과 후에만 호출(운영 syncOneSaleCell apply). */
  applyCell: (lawdCd: string, ym: string) => Promise<ApplyCellReport>;
  now: () => Date;
  log: (m: string) => void;
}

export interface BackfillOptions {
  outDir: string;
  districts: string[] | null;
  from: string | null;
  to: string | null;
  apply: boolean;
  env: Record<string, string | undefined>;
  expectInserts: number | null;
  approveExistingUpdates: boolean;
  reserveCalls: number;
  maxCalls: number | null;
  refetch: boolean;
}

interface CellCheckpoint {
  state: CellState;
  totalCount: number | null;
  collected: number;
  pages: number;
  errors: string[];
  fetchedAt: string | null;
  plan?: { inserts: number; insertCanceled: number; cancelFlips: number; cancelRestores: number; registrySupplements: number; existing: number; existingMatched: number; reviewCandidates: number; insertReconcileSkipped: number; cancelReconcileSkipped: number };
  blockedReasons?: string[];
  applied?: { at: string; inserted: number; updated: number; status: string };
}

// ───────────────────────── 본체 ─────────────────────────

export async function runBackfill(opts: BackfillOptions, deps: BackfillDeps) {
  const writeJson = (p: string, v: unknown) => fs.writeFileSync(p, JSON.stringify(v, null, 2));
  const { scope, errors } = resolveScope({ districts: opts.districts, from: opts.from, to: opts.to, now: deps.now() });
  if (!scope) throw new Error(`범위 오류: ${errors.join(', ')}`);
  const cpDir = path.join(opts.outDir, 'checkpoints');
  const rawDir = path.join(opts.outDir, 'raw');
  fs.mkdirSync(cpDir, { recursive: true });
  let calls = 0;
  const countingFetch: PageFetcher = async (...a) => { calls++; return deps.fetchPage(...a); };

  const cps = new Map<string, Record<string, CellCheckpoint>>();
  const loadCp = (d: string) => {
    if (!cps.has(d)) { const p = path.join(cpDir, `${d}.json`); cps.set(d, fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {}); }
    return cps.get(d)!;
  };
  const saveCp = (d: string) => writeJson(path.join(cpDir, `${d}.json`), loadCp(d));

  const db = await deps.readDb();
  const masters = await db.seoulMasterAptSeqs();
  let stop: string | null = null;
  const readyInserts: any[] = [];
  const existingSkipped: any[] = [];
  const drift: (DriftRow & { lawdCd: string; ym: string })[] = [];
  const masterCounts: Record<MasterClass, number> = { EXACT_MASTER: 0, MASTER_MISSING: 0, INVALID_APTSEQ: 0, REVIEW_REQUIRED: 0 };
  const masterMissing = new Map<string, { rows: number; name: string; lastDate: string; lawdCd: string }>();
  const review: any[] = [];
  const cancel = { sourceRows: 0, sourceCanceled: 0, insertCanceled: 0, cancelFlips: 0, cancelRestores: 0, cancelReconcileSkipped: 0, sameConditionGroups: 0, sameConditionRows: 0 };
  const pagingErrors: any[] = [];
  let sourceRows = 0;
  let activeRows = 0;
  let canceledRows = 0;
  const t0 = Date.now();
  let dbMs = 0;

  // 1) 셀별 수집 → 정규화 → master 분류 → 기존 행과 계획(dry-run은 항상)
  for (const { lawdCd, ym } of scope.cells) {
    const cps0 = loadCp(lawdCd);
    const prev = cps0[ym];
    if (prev?.state === 'APPLIED') continue;
    const q = quotaDecision(deps.quotaRemaining(), opts.reserveCalls, calls, opts.maxCalls);
    if (q !== 'CONTINUE') { stop = q; saveCp(lawdCd); break; }

    const rawPath = path.join(rawDir, lawdCd, `${ym}.json.gz`);
    let items: any[];
    const reuse = !opts.refetch && prev && prev.state !== 'PARTIAL' && prev.state !== 'PENDING' && fs.existsSync(rawPath);
    if (reuse) {
      items = JSON.parse(zlib.gunzipSync(fs.readFileSync(rawPath)).toString('utf8'));
    } else {
      const c = await fetchSaleCell(countingFetch, lawdCd, ym);
      cps0[ym] = { state: c.status === 'COMPLETE' ? 'FETCHED' : 'PARTIAL', totalCount: c.totalCount, collected: c.collected, pages: c.pages, errors: c.errors, fetchedAt: deps.now().toISOString() };
      if (c.status !== 'COMPLETE') {
        pagingErrors.push({ lawdCd, ym, status: c.status, totalCount: c.totalCount, collected: c.collected, errors: c.errors });
        saveCp(lawdCd);
        continue; // 부분 셀은 계획·적재하지 않는다(다른 셀과 섞지 않음)
      }
      fs.mkdirSync(path.dirname(rawPath), { recursive: true });
      fs.writeFileSync(rawPath, zlib.gzipSync(JSON.stringify(c.items)));
      items = c.items;
    }
    const cp = cps0[ym];

    const { rows, invalid } = normalizeMolitItemsToTradeRows(mapMolitItems(items, 'apt', lawdCd, ym) as any, lawdCd, ym);
    cp.state = 'VALIDATED';
    sourceRows += rows.length + invalid.length;
    for (const r of rows) {
      if (r.dealCanceled) canceledRows++; else activeRows++;
      const mc = classifyTradeMaster(r, masters);
      masterCounts[mc]++;
      if (mc === 'MASTER_MISSING') {
        const e = masterMissing.get(r.aptSeq!) ?? { rows: 0, name: r.aptName, lastDate: '', lawdCd };
        e.rows++; if (r.dealDate > e.lastDate) e.lastDate = r.dealDate; masterMissing.set(r.aptSeq!, e);
      } else if (mc !== 'EXACT_MASTER') review.push({ lawdCd, ym, class: mc, aptSeq: r.aptSeq, name: r.aptName, dealDate: r.dealDate });
    }
    if (invalid.length) review.push(...invalid.map((i) => ({ lawdCd, ym, class: `INVALID_${i.reason}` })));
    const groups = new Map<string, number>();
    for (const r of rows) { const g = `${r.groupKeyStr}|${r.dealAmount}|${r.dealDate}|${r.floor}`; groups.set(g, (groups.get(g) ?? 0) + 1); }
    for (const n of groups.values()) if (n > 1) { cancel.sameConditionGroups++; cancel.sameConditionRows += n; }

    const td = Date.now();
    const existing = await db.findExisting(lawdCd, ym);
    dbMs += Date.now() - td;
    const plan: SaleCellPlan = planSaleCellWrites(rows, existing);
    const nk = (r: { groupKeyStr: string; dealAmount: number; dealDate: string; floor: number | null; occurrenceIndex: number }) => `${r.groupKeyStr}|${r.dealAmount}|${r.dealDate}|${r.floor}|${r.occurrenceIndex}`;
    const existingKeys = new Set(existing.map((e) => nk({ ...e, dealDate: e.dealDate.toISOString().slice(0, 10) })));
    const matched = rows.filter((r) => existingKeys.has(nk(r)));
    for (const r of matched) existingSkipped.push({ lawdCd, ym, aptSeq: r.aptSeq, dealDate: r.dealDate, dealAmount: r.dealAmount, floor: r.floor, occurrenceIndex: r.occurrenceIndex });
    for (const r of plan.inserts) readyInserts.push(insertView(lawdCd, ym, r, classifyTradeMaster(r, masters)));
    for (const d of existingRowDrift(plan, existing)) drift.push({ ...d, lawdCd, ym });
    cancel.sourceRows += rows.length;
    cancel.sourceCanceled += rows.filter((r) => r.dealCanceled).length;
    cancel.insertCanceled += plan.inserts.filter((r) => r.dealCanceled).length;
    cancel.cancelFlips += plan.cancelFlips.length;
    cancel.cancelRestores += plan.cancelRestores.length;
    cancel.cancelReconcileSkipped += plan.cancelReconcileSkipped;
    const st = cellStateFromPlan(plan);
    cp.state = st.state;
    cp.blockedReasons = st.reasons;
    cp.plan = {
      inserts: plan.inserts.length, insertCanceled: plan.inserts.filter((r) => r.dealCanceled).length, cancelFlips: plan.cancelFlips.length,
      cancelRestores: plan.cancelRestores.length, registrySupplements: plan.registrySupplements.length, existing: existing.length, existingMatched: matched.length,
      reviewCandidates: plan.reviewCandidates, insertReconcileSkipped: plan.insertReconcileSkipped, cancelReconcileSkipped: plan.cancelReconcileSkipped,
    };
    saveCp(lawdCd);
  }

  // 2) 요약 · 산출물
  const allCells = scope.cells.map(({ lawdCd, ym }) => ({ lawdCd, ym, ...(loadCp(lawdCd)[ym] ?? { state: 'PENDING' as CellState }) }));
  const byState = allCells.reduce((m: Record<string, number>, c) => ((m[c.state] = (m[c.state] ?? 0) + 1), m), {});
  const plannedInserts = allCells.reduce((s, c) => s + (c.plan?.inserts ?? 0), 0);
  const existingUpdates = allCells.reduce((s, c) => s + (c.plan ? c.plan.cancelFlips + c.plan.cancelRestores + c.plan.registrySupplements : 0), 0);
  const summary: any = {
    at: deps.now().toISOString(), mode: opts.apply ? 'APPLY_REQUESTED' : 'DRY_RUN',
    scope: { districts: scope.districts, from: scope.from, to: scope.to, cells: scope.cells.length },
    cellsByState: byState, stoppedBy: stop,
    source: { rows: sourceRows, active: activeRows, canceled: canceledRows },
    master: masterCounts, masterMissingAptSeqs: masterMissing.size,
    plan: { inserts: plannedInserts, insertExactMaster: readyInserts.filter((r) => r.master === 'EXACT_MASTER').length, insertMasterMissing: readyInserts.filter((r) => r.master === 'MASTER_MISSING').length,
      existingMatched: allCells.reduce((s, c) => s + (c.plan?.existingMatched ?? 0), 0), existingUpdates, review: review.length },
    calls, quotaRemaining: deps.quotaRemaining(), ms: { total: Date.now() - t0, existingLookup: dbMs },
    writes: { insert: 0, update: 0, delete: 0 },
  };
  const out = (f: string, v: unknown) => writeJson(path.join(opts.outDir, f), v);
  out('district-month-status.json', allCells);
  out('ready-inserts.json', { count: readyInserts.length, rows: readyInserts.slice(0, 20000), truncated: readyInserts.length > 20000 });
  out('existing-skipped.json', { count: existingSkipped.length, rows: existingSkipped.slice(0, 20000) });
  out('existing-state-drift.json', { count: drift.length, note: '적재 시 기존 행을 바꾸는 항목 — apply에 --approve-existing-updates 필요', rows: drift });
  out('master-missing.json', { aptSeqs: masterMissing.size, rows: [...masterMissing.values()].reduce((s, v) => s + v.rows, 0), policy: 'aptSeq 그대로(매핑·master 생성 없음). 과거 단지 master는 별도 STEP.', list: [...masterMissing.entries()].map(([aptSeq, v]) => ({ aptSeq, ...v })).sort((a, b) => b.rows - a.rows) });
  out('review-required.json', { count: review.length, rows: review.slice(0, 5000) });
  out('cancellation-summary.json', cancel);
  out('paging-errors.json', pagingErrors);
  out('quota-status.json', { calls, remaining: deps.quotaRemaining(), reserve: opts.reserveCalls, maxCalls: opts.maxCalls, stoppedBy: stop });

  if (!opts.apply) {
    out('summary.json', summary);
    deps.log(`[DRY RUN] cells=${scope.cells.length} ${JSON.stringify(byState)} inserts=${plannedInserts} existingUpdates=${existingUpdates} calls=${calls} — DB write 없음`);
    return { summary, applied: null as null | any[] };
  }

  // 3) apply(게이트 전부 통과할 때만) — 운영 syncOneSaleCell을 그대로 호출
  const gate = evaluateApplyGates({
    apply: opts.apply, env: opts.env, districtGiven: opts.districts != null && opts.districts.length > 0, fromGiven: opts.from != null, toGiven: opts.to != null,
    expectInserts: opts.expectInserts, plannedInserts, cellsNotReady: allCells.filter((c) => c.state !== 'READY' && c.state !== 'APPLIED').length,
    existingUpdates, approveExistingUpdates: opts.approveExistingUpdates,
  });
  if (!gate.allowed) {
    summary.apply = { allowed: false, reasons: gate.reasons };
    out('summary.json', summary);
    deps.log(`[APPLY 거부] ${gate.reasons.join(', ')} — DB write 없음`);
    return { summary, applied: null };
  }
  const applied: any[] = [];
  for (const c of allCells) {
    if (c.state !== 'READY') continue;
    const q = quotaDecision(deps.quotaRemaining(), opts.reserveCalls, calls, opts.maxCalls);
    if (q !== 'CONTINUE') { summary.stoppedBy = q; break; }
    calls++;
    const rep = await deps.applyCell(c.lawdCd, c.ym);
    const cp = loadCp(c.lawdCd)[c.ym];
    const ok = rep.status !== 'PARTIAL' && rep.status !== 'INVALID' && applyMatchesPlan(rep, { inserts: c.plan!.inserts, cancelFlips: c.plan!.cancelFlips });
    cp.state = ok ? 'APPLIED' : 'BLOCKED';
    cp.applied = { at: deps.now().toISOString(), inserted: rep.inserted, updated: rep.updated, status: rep.status };
    if (!ok) cp.blockedReasons = [...(cp.blockedReasons ?? []), `APPLY_DIFFERS_FROM_PLAN_${rep.inserted}/${c.plan!.inserts}`];
    saveCp(c.lawdCd);
    applied.push({ lawdCd: c.lawdCd, ym: c.ym, ...rep, planned: c.plan!.inserts });
    if (!ok) { summary.stoppedBy = `APPLY_MISMATCH_${c.lawdCd}_${c.ym}`; break; }
  }
  summary.mode = 'APPLIED';
  summary.writes = { insert: applied.reduce((s, a) => s + a.inserted, 0), update: applied.reduce((s, a) => s + a.updated, 0), delete: 0 };
  out(`applied-${deps.now().toISOString().replace(/[:.]/g, '-')}.json`, applied);
  out('summary.json', summary);
  return { summary, applied };
}

function insertView(lawdCd: string, ym: string, r: TradeRowInput, master: MasterClass) {
  return { lawdCd, ym, aptSeq: r.aptSeq, name: r.aptName, dong: r.dong, dealDate: r.dealDate, dealAmount: r.dealAmount, exclusiveArea: r.exclusiveArea, floor: r.floor, occurrenceIndex: r.occurrenceIndex, dealCanceled: r.dealCanceled, master };
}

// ───────────────────────── 실제 의존성 ─────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const key = () => encodeURIComponent(decodeURIComponent((process.env.DATA_GO_KR_API_KEY || '').trim().replace(/['"]/g, '')));
const ENDPOINT = 'http://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev';
const liveQuota = { remaining: null as number | null };
let lastAt = 0;

/** 운영 fetcher와 같은 파서(createMolitXmlParser). 초당 제한·타임아웃·5xx만 제한 횟수 재시도, 나머지는 분류(빈 결과로 바꾸지 않음). */
export const realFetchPage: PageFetcher = async (lawdCd, ym, pageNo, numOfRows) => {
  let last: PageOutcome = { kind: 'NETWORK', detail: 'not attempted' };
  for (let attempt = 0; attempt < 5; attempt++) {
    const wait = lastAt + 350 - Date.now();
    if (wait > 0) await sleep(wait);
    lastAt = Date.now();
    let status = 0;
    let text = '';
    try {
      const res = await fetch(`${ENDPOINT}?serviceKey=${key()}&LAWD_CD=${lawdCd}&DEAL_YMD=${ym}&pageNo=${pageNo}&numOfRows=${numOfRows}`, { headers: { Accept: 'application/xml, text/xml, */*' }, signal: AbortSignal.timeout(20000) });
      status = res.status;
      const rem = res.headers.get('x-ratelimit-remaining');
      if (rem != null && rem !== '' && Number.isFinite(Number(rem))) liveQuota.remaining = Number(rem);
      text = await res.text();
    } catch (e: any) {
      last = { kind: e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK', detail: e?.name ?? 'error' };
      if (attempt < 2) { await sleep(1000 * 2 ** attempt); continue; }
      return last;
    }
    if (status === 429 || /LIMITED_NUMBER_OF_SERVICE_REQUESTS|초당\s*서비스\s*요청\s*제한/.test(text)) {
      last = { kind: 'RATE_LIMITED', detail: `http=${status}` };
      if (attempt < 4) { await sleep(1000 * 2 ** attempt); continue; }
      return last;
    }
    if (status >= 500 && attempt < 2) { last = { kind: 'HTTP_ERROR', detail: `http=${status}` }; await sleep(1000 * 2 ** attempt); continue; }
    if (status !== 200) return { kind: 'HTTP_ERROR', detail: `http=${status}` };
    let j: any;
    try { j = createMolitXmlParser().parse(text); } catch { return { kind: 'PARSE_ERROR', detail: 'xml' }; }
    const header = j?.response?.header;
    if (!header) return { kind: 'PARSE_ERROR', detail: 'no response.header' };
    const code = header.resultCode;
    if (code !== '00' && code !== 0 && code !== '000') return { kind: 'RESULT_CODE', detail: `resultCode=${code}` };
    const total = Number(j.response.body?.totalCount);
    if (!Number.isFinite(total)) return { kind: 'PARSE_ERROR', detail: 'totalCount' };
    const raw = j.response.body?.items?.item;
    return { kind: 'OK', totalCount: total, items: raw ? (Array.isArray(raw) ? raw : [raw]) : [] };
  }
  return last;
};

export async function realReadDb(): Promise<ReadDb> {
  const { assertProductionDbAccessAllowed } = await import('./_prod-db-guard');
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'backfill-seoul-sale(read)');
  const { PrismaClient } = await import('@prisma/client');
  const { monthDateRange } = await import('../src/lib/sync/sale-sync-core');
  const prisma = new PrismaClient();
  const ro = <T>(fn: (tx: any) => Promise<T>) => prisma.$transaction(async (tx) => { await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY'); return fn(tx); }, { timeout: 60000 });
  return {
    findExisting: (lawdCd, ym) => ro((tx) => tx.apartmentTradeHistory.findMany({
      where: { lawdCd, dealYmd: ym, dealDate: monthDateRange(ym) },
      select: { id: true, groupKeyStr: true, dealAmount: true, dealDate: true, floor: true, occurrenceIndex: true, dealCanceled: true, cancelDate: true, aptName: true, dong: true, registryDate: true },
    })),
    seoulMasterAptSeqs: async () => new Set((await ro((tx) => tx.$queryRawUnsafe(`SELECT apt_seq FROM apartment_masters WHERE sgg_cd LIKE '11%' AND apt_seq IS NOT NULL`)) as { apt_seq: string }[]).map((r) => r.apt_seq)),
  };
}

/** 게이트 통과 후에만 호출된다 — 운영 cron과 같은 syncOneSaleCell(apply). BACKFILL 가드(ALLOW_PROD_DB_WRITE=1) 재확인. */
export async function realApplyCell(lawdCd: string, ym: string): Promise<ApplyCellReport> {
  const { assertProductionDbAccessAllowed } = await import('./_prod-db-guard');
  assertProductionDbAccessAllowed('BACKFILL', 'backfill-seoul-sale(--apply)');
  const { syncOneSaleCell } = await import('../src/lib/sync/sale-sync-core');
  const { saleQuotaObserved } = await import('./sale-molit-fetch');
  const rep = await syncOneSaleCell(lawdCd, ym, 'apply', (m) => console.log(m));
  if (saleQuotaObserved.remaining != null) liveQuota.remaining = saleQuotaObserved.remaining;
  return { status: rep.status, inserted: rep.inserted, updated: rep.updated };
}

export function parseCli(argv: readonly string[]) {
  const get = (k: string) => argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
  const num = (k: string) => { const v = get(k); return v != null && /^\d+$/.test(v) ? Number(v) : null; };
  return {
    districts: get('district')?.split(',').map((s) => s.trim()).filter(Boolean) ?? null,
    from: get('from') != null ? parseYm(get('from')) ?? 'INVALID' : null,
    to: get('to') != null ? parseYm(get('to')) ?? 'INVALID' : null,
    apply: argv.includes('--apply'),
    expectInserts: num('expect-inserts'),
    approveExistingUpdates: argv.includes('--approve-existing-updates'),
    reserveCalls: num('reserve-calls') ?? 2000,
    maxCalls: num('max-calls'),
    refetch: argv.includes('--refetch'),
    outDir: get('out') ?? path.resolve(__dirname, '../tmp/seoul-sale-backfill-run'),
  };
}

async function main() {
  const cli = parseCli(process.argv.slice(2));
  if (cli.from === 'INVALID' || cli.to === 'INVALID') { console.error('--from/--to 형식: YYYY-MM'); process.exit(1); }
  const res = await runBackfill(
    { outDir: cli.outDir, districts: cli.districts, from: cli.from, to: cli.to, apply: cli.apply, env: process.env as Record<string, string | undefined>,
      expectInserts: cli.expectInserts, approveExistingUpdates: cli.approveExistingUpdates, reserveCalls: cli.reserveCalls, maxCalls: cli.maxCalls, refetch: cli.refetch },
    { fetchPage: realFetchPage, quotaRemaining: () => liveQuota.remaining, readDb: realReadDb, applyCell: realApplyCell, now: () => new Date(), log: (m) => console.log(m) }
  );
  console.log(JSON.stringify(res.summary));
  process.exit(0);
}

if (require.main === module) main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
