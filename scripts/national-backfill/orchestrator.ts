/**
 * NATIONAL_BACKFILL_ORCHESTRATOR_V1 — 전국 아파트 매매 full-history backfill 오케스트레이터.
 *
 *   inventory  스냅샷 → 전국 시군구 inventory(네트워크·DB 없음)
 *   audit      Production **읽기 전용** 증거 → tmp/national-backfill/readiness.{json,csv}
 *   plan       readiness → 배치 선택 + 호출 추정 + quota 판정 → tmp/national-backfill/plan.json
 *   dry-run    plan의 구를 순서대로 서울 driver(runBackfill, dry-run)로 계획. DB write 0. MOLIT 호출은 plan 한도 안에서만.
 *   apply      전국 게이트 + driver 게이트를 모두 통과해야만. (이 STEP에서는 실행하지 않는다)
 *   verify     apply 후 원천(raw) ↔ DB 월별 대조(읽기 전용)
 *
 * 셀 판정(취소·insert·자연키 충돌)은 scripts/backfill-seoul-sale.ts → 운영 cron의 planSaleCellWrites / syncOneSaleCell 그대로다.
 * backfill 완료는 공개도 cron 편입도 아니다 — 후보만 출력한다. enablement.ts·sale-sync-scope.ts는 audit에서
 * 현재 공개·cron 여부를 **읽기만** 하고, 어떤 명령도 그 파일이나 설정을 바꾸지 않는다.
 *
 *   npx tsx scripts/national-backfill/orchestrator.ts inventory
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/national-backfill/orchestrator.ts audit
 *   npx tsx scripts/national-backfill/orchestrator.ts plan --strategy=priority --max-calls=3000 --max-districts=10
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/national-backfill/orchestrator.ts dry-run [--resume] [--retry-errors] [--replan]
 */
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import {
  aggregateDistrictState,
  buildInventory,
  classifyDistrict,
  crossCheckWithRegistry,
  DEFAULT_CLASSIFY,
  detectCodeDiscontinuity,
  estimateCronCalls,
  estimateDistrictCalls,
  evaluateNationalApplyGate,
  mapDriverCellState,
  NATIONAL_SALE_START,
  observedMaxMultipageRate,
  planBatch,
  planHash,
  readinessLevels,
  resumeAction,
  toCsv,
  ymAdd,
  type DistrictEvidence,
  type HashableCell,
  type Inventory,
  type InventorySnapshot,
  type NationalCellState,
  type NationalDistrictState,
  type PlanCandidate,
  type QuotaModel,
  type Strategy,
} from './orchestrator-logic';
import type { BackfillDeps } from '../backfill-seoul-sale';

export const ROOT_OUT = path.resolve(__dirname, '../../tmp/national-backfill');
const SNAPSHOT = path.resolve(__dirname, 'region-inventory.snapshot.json');

// ───────────────────────── 공통 ─────────────────────────

export function loadInventory(): Inventory {
  const snap: InventorySnapshot = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
  return buildInventory(snap);
}

export function kstYm(now: Date): string {
  const k = new Date(now.getTime() + 9 * 3600 * 1000);
  return `${k.getUTCFullYear()}${String(k.getUTCMonth() + 1).padStart(2, '0')}`;
}

const writeJson = (p: string, v: unknown) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2)); };
const readJson = <T>(p: string): T | null => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) as T : null);

export interface OrchestratorDefaults {
  quota: QuotaModel;
  estimate: { unknownVolumeMargin: number; knownVolumeMargin: number };
}

/**
 * 기본 quota 모델. cronAllowance는 운영 cron 코드 상수에서 계산한다(부산 16 · 서울 8 · sale 4개월 · recheck 10 · rent 2).
 * appAllowance는 비-DB 지역 상세/통계의 live MOLIT 사용량 여유다 — 계측값이 없으므로 **가정**이며 --app-allowance로 바꾼다.
 */
export function defaultQuota(over: Partial<QuotaModel> = {}): QuotaModel {
  return {
    dailyLimit: 10_000,
    reserve: 2_000,
    cronAllowance: estimateCronCalls({ busanDistricts: 16, seoulDistricts: 8, saleMonths: 4, recheckMonths: 10, rentMonths: 2, pageMargin: 1.3 }),
    appAllowance: 1_000,
    ...over,
  };
}

// ───────────────────────── audit (읽기 전용) ─────────────────────────

export interface ReadinessRow {
  lawdCd: string; sido: string; sidoCode: string; name: string; isMolitLeaf: boolean;
  status: string; reasons: string[];
  tradeRows: number; canceledRows: number; earliestYm: string | null; latestYm: string | null; monthsWithRows: number; distinctAptSeq: number;
  masters: number; geocodedMasters: number; coverageCells: number; latestVerifiedAt: string | null;
  inCron: boolean; isPublic: boolean;
  estBasis: string; estMonths: number; estExtraPages: number; estCalls: number; plannedDryRunCalls: number; plannedApplyCalls: number;
}

export async function runAudit(now = new Date()) {
  const { assertProductionDbAccessAllowed } = await import('../_prod-db-guard');
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'national-backfill/orchestrator(audit)');
  const { PrismaClient } = await import('@prisma/client');
  const { BUSAN_LAWDCD_16 } = await import('../../src/lib/rent-verified-range');
  const { SEOUL_SALE_SYNC_LAWDCDS } = await import('../../src/lib/sync/sale-sync-scope');
  const { getRegionEnablement } = await import('../../src/lib/region/enablement');
  const { REGION_NODES } = await import('../../src/lib/region/registry');

  const inv = loadInventory();
  const xc = crossCheckWithRegistry(inv, REGION_NODES);
  if (!xc.ok) throw new Error(`inventory가 registry와 다르다: ${JSON.stringify(xc)}`);

  const prisma = new PrismaClient();
  const q = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '180s'");
    const monthly = await tx.$queryRawUnsafe(`SELECT lawd_cd, deal_ymd, COUNT(*)::int AS n, COUNT(*) FILTER (WHERE deal_canceled)::int AS c FROM apartment_trade_histories GROUP BY 1,2`) as { lawd_cd: string; deal_ymd: string; n: number; c: number }[];
    const seqs = await tx.$queryRawUnsafe(`SELECT lawd_cd, COUNT(DISTINCT apt_seq)::int AS n FROM apartment_trade_histories GROUP BY 1`) as { lawd_cd: string; n: number }[];
    const masters = await tx.$queryRawUnsafe(`SELECT sgg_cd, COUNT(*)::int AS n, COUNT(*) FILTER (WHERE latitude IS NOT NULL AND longitude IS NOT NULL)::int AS g FROM apartment_masters WHERE sgg_cd IS NOT NULL GROUP BY 1`) as { sgg_cd: string; n: number; g: number }[];
    const cov = await tx.$queryRawUnsafe(`SELECT lawd_cd, COUNT(*)::int AS n, COUNT(*) FILTER (WHERE status::text = 'EMPTY_VALID')::int AS e, MAX(verified_at) AS v FROM sync_coverage_cells WHERE dataset = 'SALE' GROUP BY 1`) as { lawd_cd: string; n: number; e: number; v: Date }[];
    return { monthly, seqs, masters, cov };
  }, { timeout: 240_000 });
  await prisma.$disconnect();

  const monthlyBy: Record<string, Record<string, number>> = {};
  const canceledBy: Record<string, number> = {};
  for (const r of q.monthly) { (monthlyBy[r.lawd_cd] ??= {})[r.deal_ymd] = r.n; canceledBy[r.lawd_cd] = (canceledBy[r.lawd_cd] ?? 0) + r.c; }
  const seqBy = new Map(q.seqs.map((r) => [r.lawd_cd, r.n]));
  const masterBy = new Map(q.masters.map((r) => [r.sgg_cd, r]));
  const covBy = new Map(q.cov.map((r) => [r.lawd_cd, r]));
  const cron = new Set<string>([...BUSAN_LAWDCD_16, ...SEOUL_SALE_SYNC_LAWDCDS]);
  const latestComplete = ymAdd(kstYm(now), -1);
  const to = kstYm(now);
  const prior = observedMaxMultipageRate(monthlyBy);
  const defaults = { unknownVolumeMargin: 1.15, knownVolumeMargin: 1.1 };

  const invCodes = new Set(inv.entries.map((e) => e.lawdCd));
  const rows: ReadinessRow[] = inv.entries.map((e) => {
    const m = monthlyBy[e.lawdCd] ?? {};
    const yms = Object.keys(m).sort();
    const ev: DistrictEvidence = {
      lawdCd: e.lawdCd,
      tradeRows: Object.values(m).reduce((s, n) => s + n, 0),
      canceledRows: canceledBy[e.lawdCd] ?? 0,
      earliestYm: yms[0] ?? null, latestYm: yms[yms.length - 1] ?? null, monthsWithRows: yms.length,
      distinctAptSeq: seqBy.get(e.lawdCd) ?? 0,
      masters: masterBy.get(e.lawdCd)?.n ?? 0, geocodedMasters: masterBy.get(e.lawdCd)?.g ?? 0,
      coverageCells: covBy.get(e.lawdCd)?.n ?? 0, emptyValidCoverageCells: covBy.get(e.lawdCd)?.e ?? 0,
      latestVerifiedAt: covBy.get(e.lawdCd)?.v ? new Date(covBy.get(e.lawdCd)!.v).toISOString() : null,
      inCron: cron.has(e.lawdCd),
      isPublic: getRegionEnablement(e.lawdCd).app,
    };
    const cls = classifyDistrict(e, ev, { ...DEFAULT_CLASSIFY, latestComplete, now });
    const est = estimateDistrictCalls(e.lawdCd, yms.length ? m : null, { from: NATIONAL_SALE_START, to, priorMultipageRate: prior, ...defaults });
    return {
      lawdCd: e.lawdCd, sido: e.sidoName, sidoCode: e.sidoCode, name: e.displayName, isMolitLeaf: e.isMolitLeaf,
      status: cls.status, reasons: cls.reasons,
      tradeRows: ev.tradeRows, canceledRows: ev.canceledRows, earliestYm: ev.earliestYm, latestYm: ev.latestYm, monthsWithRows: ev.monthsWithRows, distinctAptSeq: ev.distinctAptSeq,
      masters: ev.masters, geocodedMasters: ev.geocodedMasters, coverageCells: ev.coverageCells, latestVerifiedAt: ev.latestVerifiedAt,
      inCron: ev.inCron, isPublic: ev.isPublic,
      estBasis: est.basis, estMonths: est.months, estExtraPages: est.extraPages, estCalls: est.estimatedCalls, plannedDryRunCalls: est.plannedCalls, plannedApplyCalls: est.plannedCalls,
    };
  });
  // inventory 밖 lawd_cd에 행이 있으면(코드 체계 변경·오기재) 그대로 드러낸다.
  const orphanCodes = Object.keys(monthlyBy).filter((c) => !invCodes.has(c)).map((c) => ({ lawdCd: c, rows: Object.values(monthlyBy[c]).reduce((s, n) => s + n, 0) }));

  const byStatus = rows.reduce((m: Record<string, number>, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {});
  const out = {
    at: now.toISOString(), mode: 'READ_ONLY_AUDIT', latestComplete, window: { from: NATIONAL_SALE_START, to },
    inventory: { sidos: new Set(inv.entries.map((e) => e.sidoCode)).size, districts: rows.length, leaves: rows.filter((r) => r.isMolitLeaf).length, gaps: inv.gaps },
    byStatus, orphanCodes, priorMultipageRate: prior, estimateDefaults: defaults,
    monthlyEvidence: monthlyBy,
    rows,
  };
  writeJson(path.join(ROOT_OUT, 'readiness.json'), out);
  fs.writeFileSync(path.join(ROOT_OUT, 'readiness.csv'), toCsv(rows.map((r) => ({ ...r, reasons: r.reasons.join('|') }))));
  return out;
}

// ───────────────────────── plan ─────────────────────────

export function runPlan(args: { strategy: Strategy; sido: string | null; districts: string[] | null; maxCalls: number; maxDistricts: number; quota: QuotaModel; now: Date }) {
  const readiness = readJson<Awaited<ReturnType<typeof runAudit>>>(path.join(ROOT_OUT, 'readiness.json'));
  if (!readiness) throw new Error('readiness.json이 없다 — 먼저 audit(읽기 전용)을 실행한다');
  const inv = loadInventory();
  const byCode = new Map(inv.entries.map((e) => [e.lawdCd, e]));
  const to = kstYm(args.now);
  const candidates: PlanCandidate[] = readiness.rows.map((r) => ({
    entry: byCode.get(r.lawdCd)!,
    status: r.status as PlanCandidate['status'],
    statusReasons: r.reasons,
    estimate: estimateDistrictCalls(r.lawdCd, r.tradeRows ? readiness.monthlyEvidence[r.lawdCd] ?? null : null, { from: NATIONAL_SALE_START, to, priorMultipageRate: readiness.priorMultipageRate, ...readiness.estimateDefaults }),
    masters: r.masters, geocodedMasters: r.geocodedMasters,
  }));
  const plan = planBatch(candidates, { strategy: args.strategy, sido: args.sido, districts: args.districts, maxCalls: args.maxCalls, maxDistricts: args.maxDistricts, quota: args.quota });
  const out = {
    at: args.now.toISOString(), readinessAt: readiness.at,
    window: { from: NATIONAL_SALE_START, to },
    ...plan,
    decoupling: {
      publicExposure: 'UNCHANGED — backfill은 enablement.ts를 읽거나 쓰지 않는다',
      cronScope: 'UNCHANGED — sale-sync-scope.ts를 읽거나 쓰지 않는다. 완료 후 CRON_EXPANSION_CANDIDATES만 출력',
    },
  };
  writeJson(path.join(ROOT_OUT, 'plan.json'), out);
  return out;
}

// ───────────────────────── dry-run ─────────────────────────

export interface DistrictCheckpoint {
  lawdCd: string;
  /** 이 checkpoint가 계획한 기간. 기간이 다르면 READY여도 재개 시 다시 계획한다. */
  window: { from: string; to: string };
  state: NationalDistrictState;
  cells: Record<string, NationalCellState>;
  expectedCells: number;
  planHash: string | null;
  plannedInserts: number;
  existingUpdates: number;
  review: number;
  discontinuity: string[];
  calls: number;
  quotaObserved: { remaining: number; at: string } | null;
  updatedAt: string;
  runs: { at: string; calls: number; stoppedBy: string | null; mode: string }[];
}

interface DriverCell { state: string; totalCount: number | null; plan?: { inserts: number; cancelFlips: number; cancelRestores: number; registrySupplements: number; reviewCandidates: number; insertKeys?: { naturalKey: string }[] } }

/** driver 산출물(checkpoints/<lawdCd>.json · review-required.json)에서 구 checkpoint를 다시 만든다. 파일 존재가 아니라 기록된 상태로. */
export function summarizeDistrict(districtDir: string, lawdCd: string, months: string[], prev: DistrictCheckpoint | null, run: { at: string; calls: number; stoppedBy: string | null; quota: number | null }): DistrictCheckpoint {
  const cells = readJson<Record<string, DriverCell>>(path.join(districtDir, 'checkpoints', `${lawdCd}.json`)) ?? {};
  const review = readJson<{ count: number; rows: { ym: string }[] }>(path.join(districtDir, 'review-required.json'));
  const reviewYm = new Set((review?.rows ?? []).map((r) => r.ym));
  const mapped: Record<string, NationalCellState> = {};
  const hashCells: HashableCell[] = [];
  const totals: Record<string, number> = {};
  let plannedInserts = 0;
  let existingUpdates = 0;
  for (const ym of months) {
    const c = cells[ym];
    mapped[ym] = mapDriverCellState(c, reviewYm.has(ym));
    if (c?.totalCount != null) totals[ym] = c.totalCount;
    if (c?.plan) {
      plannedInserts += c.plan.inserts;
      existingUpdates += c.plan.cancelFlips + c.plan.cancelRestores + c.plan.registrySupplements;
      hashCells.push({ lawdCd, ym, state: c.state, totalCount: c.totalCount, inserts: c.plan.inserts, cancelFlips: c.plan.cancelFlips, cancelRestores: c.plan.cancelRestores, registrySupplements: c.plan.registrySupplements, reviewCandidates: c.plan.reviewCandidates, insertKeys: (c.plan.insertKeys ?? []).map((k) => k.naturalKey) });
    }
  }
  const allFetched = months.every((ym) => cells[ym]?.totalCount != null);
  const discontinuity = allFetched ? detectCodeDiscontinuity(totals) : [];
  let state = aggregateDistrictState(Object.values(mapped), months.length);
  // 코드 체계 불연속은 셀 상태와 무관하게 사람 검토 대상이다(0건을 "거래 없음"으로 믿지 않는다).
  if (discontinuity.length && (state === 'READY' || state === 'IN_PROGRESS')) state = 'REVIEW';
  return {
    lawdCd, window: { from: months[0], to: months[months.length - 1] }, state, cells: mapped, expectedCells: months.length,
    planHash: state === 'READY' || state === 'REVIEW' ? planHash(hashCells) : null,
    plannedInserts, existingUpdates, review: review?.count ?? 0, discontinuity,
    calls: (prev?.calls ?? 0) + run.calls,
    quotaObserved: run.quota != null ? { remaining: run.quota, at: run.at } : prev?.quotaObserved ?? null,
    updatedAt: run.at,
    runs: [...(prev?.runs ?? []), { at: run.at, calls: run.calls, stoppedBy: run.stoppedBy, mode: 'DRY_RUN' }],
  };
}

export interface NationalDryRunOptions {
  outRoot: string;
  districts: string[];
  from: string;
  to: string;
  maxCalls: number;
  reserveCalls: number;
  resume: boolean;
  retryErrors: boolean;
  replan: boolean;
  allowedDistricts: ReadonlySet<string>;
  knownCodes: ReadonlySet<string>;
}

/**
 * 구 단위로 **독립** 실행한다(구마다 별도 디렉터리·checkpoint). 한 구가 실패해도 이미 끝난 구의 산출물은 건드리지 않는다.
 * dry-run이므로 driver는 apply 경로에 들어가지 않는다 — deps.applyCell은 호출되지 않는다(테스트로 고정).
 */
export async function runNationalDryRun(o: NationalDryRunOptions, deps: BackfillDeps) {
  const { runBackfill } = await import('../backfill-seoul-sale');
  const months: string[] = [];
  for (let ym = o.from; ym <= o.to; ym = ymAdd(ym, 1)) months.push(ym);
  let used = 0;
  let stoppedBy: string | null = null;
  const results: { lawdCd: string; action: string; state?: NationalDistrictState; calls?: number; error?: string }[] = [];

  for (const lawdCd of o.districts) {
    const dir = path.join(o.outRoot, 'districts', lawdCd);
    const cpPath = path.join(dir, 'checkpoint.json');
    const prev = readJson<DistrictCheckpoint>(cpPath);
    if (prev && !o.resume) throw new Error(`${lawdCd} checkpoint가 이미 있다 — 이어서 하려면 --resume`);
    const sameWindow = prev?.window?.from === o.from && prev?.window?.to === o.to;
    if (prev && (sameWindow || prev.state === 'APPLIED')) {
      const act = resumeAction(prev.state, { retryErrors: o.retryErrors, replan: o.replan });
      if (act !== 'RUN_DRY_RUN' && act !== 'RETRY_ERROR') { results.push({ lawdCd, action: act, state: prev.state }); continue; }
    }
    if (stoppedBy) { results.push({ lawdCd, action: `NOT_STARTED_${stoppedBy}` }); continue; }
    const remaining = o.maxCalls - used;
    if (remaining <= 0) { stoppedBy = 'PLAN_MAX_CALLS'; results.push({ lawdCd, action: 'NOT_STARTED_PLAN_MAX_CALLS' }); continue; }
    try {
      const res = await runBackfill({
        outDir: dir, districts: [lawdCd], from: o.from, to: o.to, apply: false, env: {},
        expectInserts: null, approveExistingUpdates: false, reserveCalls: o.reserveCalls, maxCalls: remaining, refetch: false,
        allowedDistricts: o.allowedDistricts, knownCodes: o.knownCodes, retryPartial: o.retryErrors,
      }, deps);
      const calls = res.summary.calls as number;
      used += calls;
      if (res.summary.stoppedBy) stoppedBy = res.summary.stoppedBy;
      const cp = summarizeDistrict(dir, lawdCd, months, prev, { at: deps.now().toISOString(), calls, stoppedBy: res.summary.stoppedBy, quota: deps.quotaRemaining() });
      writeJson(cpPath, cp);
      results.push({ lawdCd, action: prev ? 'RESUMED' : 'RAN', state: cp.state, calls });
    } catch (e: any) {
      // 구 격리: 이 구만 ERROR로 남기고 다음 구로 간다. 다른 구의 checkpoint는 읽지도 쓰지도 않는다.
      const cp: DistrictCheckpoint = {
        lawdCd, window: { from: o.from, to: o.to }, state: 'ERROR', cells: prev?.cells ?? {}, expectedCells: months.length, planHash: null, plannedInserts: 0, existingUpdates: 0, review: 0, discontinuity: [],
        calls: prev?.calls ?? 0, quotaObserved: prev?.quotaObserved ?? null, updatedAt: deps.now().toISOString(),
        runs: [...(prev?.runs ?? []), { at: deps.now().toISOString(), calls: 0, stoppedBy: `EXCEPTION_${String(e?.message ?? e).slice(0, 120)}`, mode: 'DRY_RUN' }],
      };
      writeJson(cpPath, cp);
      results.push({ lawdCd, action: 'ERROR', state: 'ERROR', error: String(e?.message ?? e).slice(0, 200) });
    }
  }

  const cps = o.districts.map((d) => readJson<DistrictCheckpoint>(path.join(o.outRoot, 'districts', d, 'checkpoint.json')));
  const summary = {
    at: deps.now().toISOString(), mode: 'DRY_RUN', writes: { insert: 0, update: 0, delete: 0 },
    calls: used, maxCalls: o.maxCalls, stoppedBy, results,
    districts: cps.filter(Boolean).map((c) => ({ lawdCd: c!.lawdCd, state: c!.state, plannedInserts: c!.plannedInserts, existingUpdates: c!.existingUpdates, review: c!.review, discontinuity: c!.discontinuity, planHash: c!.planHash, calls: c!.calls })),
    readiness: cps.filter(Boolean).map((c) => readinessLevels(c!.lawdCd, c!.state, false)),
    cronExpansionCandidates: [] as string[], // apply + verify 통과 전에는 항상 비어 있다
  };
  writeJson(path.join(o.outRoot, 'summary.json'), summary);
  return summary;
}

// ───────────────────────── apply (게이트) ─────────────────────────

export async function runNationalApply(args: { districts: string[]; expectInserts: number | null; planHashArg: string | null; approveExistingUpdates: boolean; apply: boolean; env: Record<string, string | undefined>; now: Date; reserve: number }) {
  const plan = readJson<{ districts: { lawdCd: string; cost: { apply: number } }[]; window: { from: string; to: string } }>(path.join(ROOT_OUT, 'plan.json'));
  if (!plan) throw new Error('plan.json 없음');
  const cps = Object.fromEntries(args.districts.map((d) => [d, readJson<DistrictCheckpoint>(path.join(ROOT_OUT, 'districts', d, 'checkpoint.json'))]));
  const states = Object.fromEntries(Object.entries(cps).map(([d, c]) => [d, c?.state ?? 'PENDING'])) as Record<string, NationalDistrictState>;
  const recorded = args.districts.map((d) => cps[d]?.planHash ?? '').join('+');
  // apply 직전 재계획: raw 재사용 + DB 읽기만(MOLIT fetch를 허용하지 않는 fetcher). 원천·DB가 바뀌었으면 hash가 달라진다.
  const { realReadDb } = await import('../backfill-seoul-sale');
  const inv = loadInventory();
  const leaves = new Set(inv.entries.filter((e) => e.isMolitLeaf).map((e) => e.lawdCd));
  const known = new Set(inv.entries.map((e) => e.lawdCd));
  const months: string[] = [];
  for (let ym = plan.window.from; ym <= plan.window.to; ym = ymAdd(ym, 1)) months.push(ym);
  const { runBackfill } = await import('../backfill-seoul-sale');
  const recomputed: string[] = [];
  let currentReview = 0;
  let plannedInserts = 0;
  let unexpectedUpdates = 0;
  for (const d of args.districts) {
    const dir = path.join(ROOT_OUT, 'districts', d);
    await runBackfill({ outDir: dir, districts: [d], from: plan.window.from, to: plan.window.to, apply: false, env: {}, expectInserts: null, approveExistingUpdates: false, reserveCalls: args.reserve, maxCalls: null, refetch: false, allowedDistricts: leaves, knownCodes: known, retryPartial: false },
      { fetchPage: async () => ({ kind: 'NETWORK', detail: 'REPLAN_NO_FETCH' }), quotaRemaining: () => null, readDb: realReadDb, applyCell: async () => { throw new Error('REPLAN_NEVER_APPLIES'); }, now: () => args.now, log: () => {} });
    const cp = summarizeDistrict(dir, d, months, cps[d], { at: args.now.toISOString(), calls: 0, stoppedBy: null, quota: null });
    recomputed.push(cp.planHash ?? '');
    currentReview += cp.review;
    plannedInserts += cp.plannedInserts;
    unexpectedUpdates += cp.existingUpdates;
  }
  const obs = args.districts.map((d) => cps[d]?.quotaObserved).filter(Boolean).sort((a, b) => b!.at.localeCompare(a!.at))[0] ?? null;
  const gate = evaluateNationalApplyGate({
    apply: args.apply, env: args.env,
    plannedDistricts: plan.districts.map((d) => d.lawdCd), requestedDistricts: args.districts,
    expectInserts: args.expectInserts, plannedInserts,
    recordedPlanHash: recorded, recomputedPlanHash: recomputed.join('+'), givenPlanHash: args.planHashArg,
    recordedReview: args.districts.reduce((s, d) => s + (cps[d]?.review ?? 0), 0), currentReview,
    unexpectedUpdates, approveExistingUpdates: args.approveExistingUpdates,
    districtStates: states, observedQuota: obs, now: args.now, reserve: args.reserve,
    applyEstimate: plan.districts.filter((d) => args.districts.includes(d.lawdCd)).reduce((s, d) => s + d.cost.apply, 0),
    quotaMaxAgeMs: 2 * 3600 * 1000,
  });
  if (!gate.allowed) return { allowed: false, reasons: gate.reasons, recomputedPlanHash: recomputed.join('+') };
  // 게이트 통과 시에도 구 하나씩 driver apply(driver 자체 게이트 재통과). 이 STEP에서는 도달하지 않는다.
  // driver의 예비분 정지(quotaDecision)가 apply 중에도 살아 있어야 한다 — 셀마다 관측한 MOLIT 잔여량을 넘긴다.
  const { realFetchPage, realApplyCell, liveQuotaRemaining } = await import('../backfill-seoul-sale');
  const applied: unknown[] = [];
  for (const d of args.districts) {
    const res = await runBackfill({ outDir: path.join(ROOT_OUT, 'districts', d), districts: [d], from: plan.window.from, to: plan.window.to, apply: true, env: args.env, expectInserts: cps[d]!.plannedInserts, approveExistingUpdates: args.approveExistingUpdates, reserveCalls: args.reserve, maxCalls: null, refetch: false, allowedDistricts: leaves, knownCodes: known, retryPartial: false },
      { fetchPage: realFetchPage, quotaRemaining: () => liveQuotaRemaining(), readDb: realReadDb, applyCell: realApplyCell, now: () => new Date(), log: (m) => console.log(m) });
    applied.push({ lawdCd: d, summary: res.summary });
    if (res.summary.stoppedBy) break; // 구 격리: 멈춘 구 뒤로는 진행하지 않는다
  }
  return { allowed: true, applied };
}

// ───────────────────────── verify (apply 후, 읽기 전용) ─────────────────────────

export async function runVerify(districts: string[]) {
  const { assertProductionDbAccessAllowed } = await import('../_prod-db-guard');
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'national-backfill/orchestrator(verify)');
  const { PrismaClient } = await import('@prisma/client');
  const { mapMolitItems } = await import('../../src/lib/api-molit');
  const { normalizeMolitItemsToTradeRows } = await import('../trade-history-logic');
  const prisma = new PrismaClient();
  const out: Record<string, { mismatches: { ym: string; source: number; sourceCanceled: number; db: number; dbCanceled: number; expectedSkips: number }[]; pass: boolean }> = {};
  for (const d of districts) {
    const dir = path.join(ROOT_OUT, 'districts', d);
    const skips = readJson<{ cells: { ym: string; expectedSkips: number }[] }>(path.join(dir, 'natural-key-collisions.json'));
    const skipBy = new Map((skips?.cells ?? []).map((c) => [c.ym, c.expectedSkips]));
    const db = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      return tx.$queryRawUnsafe(`SELECT deal_ymd, COUNT(*)::int n, COUNT(*) FILTER (WHERE deal_canceled)::int c FROM apartment_trade_histories WHERE lawd_cd = $1 GROUP BY 1`, d) as Promise<{ deal_ymd: string; n: number; c: number }[]>;
    });
    const dbBy = new Map(db.map((r) => [r.deal_ymd, r]));
    const rawDir = path.join(dir, 'raw', d);
    const mismatches = [];
    for (const f of fs.existsSync(rawDir) ? fs.readdirSync(rawDir) : []) {
      const ym = f.slice(0, 6);
      const items = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(rawDir, f))).toString('utf8'));
      const { rows } = normalizeMolitItemsToTradeRows(mapMolitItems(items, 'apt', d, ym) as any, d, ym);
      const sc = rows.filter((r) => r.dealCanceled).length;
      const dbr = dbBy.get(ym) ?? { n: 0, c: 0 };
      const skip = skipBy.get(ym) ?? 0;
      if (rows.length - skip > dbr.n || sc > dbr.c + skip) mismatches.push({ ym, source: rows.length, sourceCanceled: sc, db: dbr.n, dbCanceled: dbr.c, expectedSkips: skip });
    }
    out[d] = { mismatches, pass: mismatches.length === 0 };
  }
  await prisma.$disconnect();
  const candidates = Object.entries(out).filter(([d, v]) => v.pass && readJson<DistrictCheckpoint>(path.join(ROOT_OUT, 'districts', d, 'checkpoint.json'))?.state === 'APPLIED').map(([d]) => d);
  const res = { at: new Date().toISOString(), mode: 'READ_ONLY_VERIFY', districts: out, CRON_EXPANSION_CANDIDATES: candidates, note: 'cron·공개 범위는 바꾸지 않는다 — 후보만 출력' };
  writeJson(path.join(ROOT_OUT, 'verify.json'), res);
  return res;
}

// ───────────────────────── CLI ─────────────────────────

export function parseArgs(argv: readonly string[]) {
  const get = (k: string) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const num = (k: string) => { const v = get(k); return v != null && /^\d+$/.test(v) ? Number(v) : null; };
  const strategy = (get('strategy') ?? 'priority') as Strategy;
  return {
    cmd: argv[0],
    strategy: ['priority', 'sido', 'manual'].includes(strategy) ? strategy : ('INVALID' as unknown as Strategy),
    sido: get('sido') ?? null,
    districts: get('district')?.split(',').map((s) => s.trim()).filter(Boolean) ?? null,
    maxCalls: num('max-calls') ?? 3000,
    maxDistricts: num('max-districts') ?? 10,
    reserve: num('reserve') ?? 2000,
    dailyLimit: num('daily-limit') ?? 10_000,
    appAllowance: num('app-allowance'),
    resume: argv.includes('--resume'),
    retryErrors: argv.includes('--retry-errors'),
    replan: argv.includes('--replan'),
    apply: argv.includes('--apply'),
    expectInserts: num('expect-inserts'),
    planHash: get('plan-hash') ?? null,
    approveExistingUpdates: argv.includes('--approve-existing-updates'),
    from: get('from')?.replace('-', '') ?? null,
    to: get('to')?.replace('-', '') ?? null,
    out: get('out') ?? null,
  };
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const now = new Date();
  const quota = defaultQuota({ dailyLimit: a.dailyLimit, reserve: a.reserve, ...(a.appAllowance != null ? { appAllowance: a.appAllowance } : {}) });
  if (a.cmd === 'inventory') {
    const inv = loadInventory();
    const { REGION_NODES } = await import('../../src/lib/region/registry');
    const bySido = inv.entries.reduce((m: Record<string, { total: number; leaves: number; review: number }>, e) => {
      const k = `${e.sidoCode} ${e.sidoName}`; m[k] ??= { total: 0, leaves: 0, review: 0 }; m[k].total++; if (e.isMolitLeaf) m[k].leaves++; if (e.reviewNotes.length) m[k].review++; return m;
    }, {});
    console.log(JSON.stringify({ registryCrossCheck: crossCheckWithRegistry(inv, REGION_NODES), bySido, gaps: inv.gaps }, null, 1));
  } else if (a.cmd === 'audit') {
    const r = await runAudit(now);
    console.log(JSON.stringify({ at: r.at, inventory: r.inventory, byStatus: r.byStatus, orphanCodes: r.orphanCodes, priorMultipageRate: r.priorMultipageRate }, null, 1));
  } else if (a.cmd === 'plan') {
    const p = runPlan({ strategy: a.strategy, sido: a.sido, districts: a.districts, maxCalls: a.maxCalls, maxDistricts: a.maxDistricts, quota, now });
    console.log(JSON.stringify({ verdict: p.verdict, errors: p.errors, totals: p.totals, quota: p.quota, districts: p.districts.map((d) => ({ lawdCd: d.lawdCd, name: d.fullName, planned: d.estimate.plannedCalls, basis: d.estimate.basis, risk: d.risk })) }, null, 1));
  } else if (a.cmd === 'dry-run') {
    const plan = readJson<{ verdict: string; districts: { lawdCd: string }[]; totals: { dryRun: number }; window: { from: string; to: string } }>(path.join(ROOT_OUT, 'plan.json'));
    if (!plan) throw new Error('plan.json 없음 — 먼저 plan');
    if (plan.verdict !== 'PLANNED') throw new Error(`plan verdict=${plan.verdict} — 실행하지 않는다`);
    const inv = loadInventory();
    const { realFetchPage, realReadDb } = await import('../backfill-seoul-sale');
    const live = await import('../backfill-seoul-sale');
    const s = await runNationalDryRun({
      outRoot: a.out ? path.resolve(a.out) : ROOT_OUT, districts: a.districts ?? plan.districts.map((d) => d.lawdCd),
      from: a.from ?? plan.window.from, to: a.to ?? plan.window.to,
      maxCalls: Math.min(a.maxCalls, plan.totals.dryRun), reserveCalls: a.reserve,
      resume: a.resume, retryErrors: a.retryErrors, replan: a.replan,
      allowedDistricts: new Set(inv.entries.filter((e) => e.isMolitLeaf).map((e) => e.lawdCd)),
      knownCodes: new Set(inv.entries.map((e) => e.lawdCd)),
    }, { fetchPage: realFetchPage, quotaRemaining: () => live.liveQuotaRemaining(), readDb: realReadDb, applyCell: async () => { throw new Error('DRY_RUN_NEVER_APPLIES'); }, now: () => new Date(), log: (m) => console.log(m) });
    console.log(JSON.stringify(s, null, 1));
  } else if (a.cmd === 'apply') {
    if (!a.districts?.length) throw new Error('--district 필요');
    const r = await runNationalApply({ districts: a.districts, expectInserts: a.expectInserts, planHashArg: a.planHash, approveExistingUpdates: a.approveExistingUpdates, apply: a.apply, env: process.env as Record<string, string | undefined>, now, reserve: a.reserve });
    console.log(JSON.stringify(r, null, 1));
  } else if (a.cmd === 'verify') {
    if (!a.districts?.length) throw new Error('--district 필요');
    console.log(JSON.stringify(await runVerify(a.districts), null, 1));
  } else {
    console.error('usage: orchestrator.ts inventory|audit|plan|dry-run|apply|verify');
    process.exit(1);
  }
}

if (require.main === module) main().then(() => process.exit(0)).catch((e) => { console.error(e?.message ?? e); process.exit(1); });
