/**
 * 경기 첫 배치 ApartmentMaster seed 실행기.
 *
 * GYEONGGI_MASTER_SEEDING_DRYRUN_V1 — dry-run(기본): 원천 raw 캐시 → aptSeq 후보 → Kakao 양방향 필지 좌표 → 계획.
 * GYEONGGI_MASTER_PILOT_APPLY_PREP_V1 — apply/rollback/verify 모드 추가(이 STEP에서는 **실행하지 않는다**).
 *
 *   원천   : tmp/national-backfill/districts/<구>/raw — 이미 적재·검증된 매매 전체 이력(MOLIT 호출 0)
 *   DB     : dry-run·verify는 READ ONLY 트랜잭션. apply는 create-only 단일 트랜잭션. rollback은 id 목록 3중 조건 DELETE.
 *   좌표   : Kakao 주소 검색 → 필지 단일 일치 → 역지오코딩 필지 일치(서울 seed와 같은 클라이언트·헤더·간격·429 처리)
 *   산출물 : tmp/gyeonggi-master-seed/ — plan.json · summary.json · districts/<구>/checkpoint.json · applied/<runId>.json
 *
 *   dry-run : ALLOW_PROD_DB_READ=1 npx tsx scripts/national-backfill/gyeonggi-master-seed.ts [--district=41111,41113] [--resume] [--as-of=202609]
 *   preflight: ALLOW_PROD_DB_READ=1 npx tsx … --preflight --district=41115 --expect-inserts=116 --expect-plan-hash=<hash>   (apply와 같은 재계획·게이트, write 0)
 *   apply   : ALLOW_PROD_DB_READ=1 ALLOW_PROD_DB_WRITE=1 npx tsx … --apply --district=41115 --expect-inserts=116 --expect-plan-hash=<hash>
 *   verify  : ALLOW_PROD_DB_READ=1 npx tsx … --verify=tmp/gyeonggi-master-seed/applied/<runId>.json [--live]
 *   rollback: ALLOW_PROD_DB_READ=1 ALLOW_PROD_DB_WRITE=1 npx tsx … --rollback=<applied json> --run-id=<runId> --expect-deletes=<N>
 *
 * apply는 Kakao를 부르지 않는다 — dry-run checkpoint의 **종결** 좌표만 쓴다(없으면 UNRESOLVED → 게이트 거부).
 * null 좌표 행(GEOCODE_MISSING)은 `--allow-null-coords`가 있을 때만 insert 집합에 들어간다(기본 제외, 정책 미정).
 */
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { randomBytes } from 'crypto';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import type { PrismaClient } from '@prisma/client';
import { aggregateCandidates, type RawTradeItem, type SeedCandidate } from '../seoul-master-seed-plan-logic';
import { realReverseGeocode, realSearchAddress } from '../seed-seoul-apartment-master';
import { isPublicRegionAllowed, isSidoPubliclyHidden } from '../../src/lib/region/enablement';
import {
  buildGgAppliedArtifact,
  buildPlanHash,
  buildPlanRecord,
  classifyForward,
  classifyGgCandidates,
  computePublicExposureGuarded,
  evaluateGgApplyGate,
  evaluatePostApply,
  evaluateRollbackGate,
  findDuplicateAptSeqs,
  ggAddressQuery,
  ggPlanHash,
  ggVerifyReverseLot,
  GG_ROLLBACK_SQL,
  GG_SEED_POLICY_VERSION,
  GYEONGGI_FIRST_BATCH,
  insertSetHashes,
  NOT_ATTEMPTED_EVIDENCE,
  selectInsertSet,
  sharedParcelGroups,
  summarizeLot,
  TERMINAL,
  tierAWindowStart,
  type CoordEvidence,
  type GgAppliedArtifact,
  type GgInsertedRow,
  type GgSeedRow,
  type PlanRecord,
  type RollbackDbRow,
} from './gyeonggi-master-seed-logic';

const RAW_ROOT = path.resolve(__dirname, '../../tmp/national-backfill/districts');
const OUT = path.resolve(__dirname, '../../tmp/gyeonggi-master-seed');
const APPLIED_DIR = path.join(OUT, 'applied');

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const flag = (name: string) => process.argv.includes(`--${name}`);
const intArg = (name: string) => { const v = arg(name); return v != null && /^\d+$/.test(v) ? Number(v) : null; };

interface Checkpoint { asOfYm: string; policy: string; coords: Record<string, CoordEvidence> }

function readJson<T>(p: string): T | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) as T; } catch { return null; }
}
function writeJson(p: string, v: unknown) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(`${p}.tmp`, JSON.stringify(v, null, 1));
  fs.renameSync(`${p}.tmp`, p);
}

function loadRaw(d: string): RawTradeItem[] {
  const dir = path.join(RAW_ROOT, d, 'raw', d);
  const items: RawTradeItem[] = [];
  for (const f of fs.readdirSync(dir).sort()) items.push(...JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, f))).toString('utf8')));
  return items;
}

async function prismaClient(): Promise<PrismaClient> {
  const { PrismaClient: Client } = await import('@prisma/client');
  return new Client();
}

async function hostKind(): Promise<'PRODUCTION' | 'NON_PRODUCTION'> {
  const { isProductionDatabaseUrl } = await import('../_prod-db-guard');
  return isProductionDatabaseUrl(process.env.DATABASE_URL) ? 'PRODUCTION' : 'NON_PRODUCTION';
}

/** 모든 모드가 공통으로 쓰는 읽기 전용 조회. */
async function readDb(prisma: PrismaClient, districts: readonly string[], aptSeqs: readonly string[]) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const trades = await tx.$queryRawUnsafe(
      `SELECT lawd_cd, count(*)::int AS rows, count(DISTINCT apt_seq)::int AS apt_seqs FROM apartment_trade_histories WHERE lawd_cd = ANY($1) GROUP BY lawd_cd`, districts) as { lawd_cd: string; rows: number; apt_seqs: number }[];
    const tradeSeqs = await tx.$queryRawUnsafe(
      `SELECT DISTINCT apt_seq FROM apartment_trade_histories WHERE lawd_cd = ANY($1) AND apt_seq IS NOT NULL`, districts) as { apt_seq: string }[];
    const existing = await tx.$queryRawUnsafe(
      `SELECT apt_seq, sgg_cd FROM apartment_masters WHERE apt_seq = ANY($1) OR sgg_cd LIKE '41%' OR apt_seq LIKE '41%'`, aptSeqs) as { apt_seq: string | null; sgg_cd: string | null }[];
    return { trades, tradeSeqs: tradeSeqs.map((r) => r.apt_seq), existing };
  }, { timeout: 180_000 });
}

async function countsBySido(prisma: PrismaClient): Promise<Record<string, number>> {
  const rows = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    return tx.$queryRawUnsafe(`SELECT coalesce(left(sgg_cd, 2), '??') AS sido, count(*)::int AS n FROM apartment_masters GROUP BY 1`) as Promise<{ sido: string; n: number }[]>;
  });
  return Object.fromEntries(rows.map((r) => [r.sido, r.n]));
}

/** 한 후보의 좌표를 묻는다. RATE_LIMITED면 호출자가 중단한다. */
async function geocode(row: GgSeedRow, calls: { forward: number; reverse: number }): Promise<CoordEvidence> {
  const target = { sigungu: row.sigungu, dong: row.dong, jibun: row.jibun };
  const query = ggAddressQuery(target);
  calls.forward++;
  const f = await realSearchAddress(query);
  if (f.kind !== 'OK') return { ...NOT_ATTEMPTED_EVIDENCE, status: f.kind, query, detail: f.detail };
  const fw = classifyForward(f.docs as never, target);
  const base: CoordEvidence = { status: 'NOT_ATTEMPTED', query, forwardDocs: f.docs.length, forwardHits: fw.hits, forwardSummary: fw.summary, lat: null, lng: null, reverseLot: null, detail: null };
  if (fw.status !== 'EXACT') return { ...base, status: fw.status };
  calls.reverse++;
  const r = await realReverseGeocode(fw.lat!, fw.lng!);
  if (r.kind !== 'OK') return { ...base, status: r.kind, detail: r.detail };
  const v = ggVerifyReverseLot(r.doc as never, target);
  const reverseLot = summarizeLot((r.doc as { address?: never } | null)?.address);
  return v === 'VERIFIED'
    ? { ...base, status: 'VERIFIED', lat: fw.lat, lng: fw.lng, reverseLot }
    : { ...base, status: v, reverseLot };
}

/** 공개 노출 가드. 닫혀 있지 않으면 어떤 모드도 진행하지 않는다. */
function requireGuard() {
  const guard = computePublicExposureGuarded((c, axis) => isPublicRegionAllowed(c, axis));
  const selectorHidden = isSidoPubliclyHidden('41');
  if (!guard.guarded || !selectorHidden) throw new Error(`PUBLIC_EXPOSURE_NOT_GUARDED: ${guard.openAxes.join(',')} selectorHidden=${selectorHidden}`);
  return { ...guard, selectorHidden };
}

/**
 * 계획 생성(dry-run·apply 공통). `allowGeocode=false`(apply)면 Kakao를 부르지 않고 checkpoint의 종결 좌표만 쓴다.
 * identity는 8구 전부의 응답으로 판정한다(이웃 구 오기재를 잡기 위해).
 */
async function planDistricts(prisma: PrismaClient, opts: { districts: readonly string[]; asOfYm: string; resume: boolean; allowGeocode: boolean }) {
  const entries = new Map<string, SeedCandidate[]>();
  const rawRows: Record<string, number> = {};
  for (const d of GYEONGGI_FIRST_BATCH) {
    const items = loadRaw(d);
    rawRows[d] = items.length;
    for (const c of aggregateCandidates(d, items.map((item) => ({ item, source: 'SALE' as const }))).candidates) {
      entries.set(c.aptSeq, [...(entries.get(c.aptSeq) ?? []), c]);
    }
  }
  const allSeqs = [...entries.keys()];
  const db = await readDb(prisma, GYEONGGI_FIRST_BATCH, allSeqs);
  const existingSeqs = new Set(db.existing.map((r) => r.apt_seq).filter((s): s is string => !!s));
  const windowStart = tierAWindowStart(opts.asOfYm);
  const rows = classifyGgCandidates({ entriesByAptSeq: entries, districts: GYEONGGI_FIRST_BATCH, existingAptSeqs: existingSeqs, windowStart })
    .filter((r) => opts.districts.includes(r.district));
  const dbSeqSet = new Set(db.tradeSeqs);
  const srcSeqSet = new Set(allSeqs);
  const seqParity = { source: srcSeqSet.size, db: dbSeqSet.size, onlySource: allSeqs.filter((s) => !dbSeqSet.has(s)).length, onlyDb: db.tradeSeqs.filter((s) => !srcSeqSet.has(s)).length };

  const calls = { forward: 0, reverse: 0 };
  let stoppedBy: string | null = null;
  const records: PlanRecord[] = [];
  for (const d of opts.districts) {
    const cpPath = path.join(OUT, 'districts', d, 'checkpoint.json');
    const prev = opts.resume ? readJson<Checkpoint>(cpPath) : null;
    const cp: Checkpoint = prev && prev.asOfYm === opts.asOfYm && prev.policy === GG_SEED_POLICY_VERSION ? prev : { asOfYm: opts.asOfYm, policy: GG_SEED_POLICY_VERSION, coords: {} };
    const before = { ...calls };
    let n = 0;
    for (const row of rows.filter((r) => r.district === d)) {
      let coord: CoordEvidence = NOT_ATTEMPTED_EVIDENCE;
      if (row.status === 'READY') {
        const cached = cp.coords[row.aptSeq];
        if (cached && TERMINAL.has(cached.status)) coord = cached;
        else if (opts.allowGeocode && !stoppedBy) {
          coord = await geocode(row, calls);
          cp.coords[row.aptSeq] = coord;
          if (coord.status === 'RATE_LIMITED') stoppedBy = `RATE_LIMITED at ${row.aptSeq}`;
          if (++n % 20 === 0) writeJson(cpPath, cp);
        }
      }
      records.push(buildPlanRecord(row, coord));
    }
    if (opts.allowGeocode) {
      writeJson(cpPath, cp);
      writeJson(path.join(OUT, 'districts', d, 'records.json'), records.filter((r) => r.district === d));
    }
    console.error(`${d} planned — forward ${calls.forward - before.forward} reverse ${calls.reverse - before.reverse}${stoppedBy ? ` STOPPED ${stoppedBy}` : ''}`);
  }
  return { rows, records, db, seqParity, rawRows, calls, stoppedBy, windowStart };
}

// ───────────────────────── dry-run ─────────────────────────

async function runDryRun(prisma: PrismaClient) {
  const asOfYm = arg('as-of') ?? '202609';
  const districts = (arg('district') ?? GYEONGGI_FIRST_BATCH.join(',')).split(',').filter(Boolean);
  for (const d of districts) if (!(GYEONGGI_FIRST_BATCH as readonly string[]).includes(d)) throw new Error(`첫 배치 밖 구: ${d}`);
  const guard = requireGuard();
  const { rows, records, db, seqParity, rawRows, calls, stoppedBy, windowStart } = await planDistricts(prisma, { districts, asOfYm, resume: flag('resume'), allowGeocode: true });

  const candidates = rows.filter((r) => r.status === 'READY' || r.status === 'REVIEW' || r.status === 'EXISTING_SKIPPED');
  const shared = sharedParcelGroups(candidates);
  const coordByParcel = new Map<string, Set<string>>();
  for (const r of records.filter((x) => x.fields?.latitude != null)) {
    const k = `${r.district}|${r.identity.umdCd}|${r.identity.jibun}`;
    coordByParcel.set(k, (coordByParcel.get(k) ?? new Set()).add(`${r.fields!.latitude},${r.fields!.longitude}`));
  }
  const coordKeyToParcels = new Map<string, Set<string>>();
  for (const [parcel, cs] of coordByParcel) for (const c of cs) coordKeyToParcels.set(c, (coordKeyToParcels.get(c) ?? new Set()).add(parcel));
  const sameCoordDifferentParcel = [...coordKeyToParcels.entries()].filter(([, ps]) => ps.size > 1).map(([c, ps]) => ({ coord: c, parcels: [...ps] }));
  const duplicates = findDuplicateAptSeqs(records);

  const count = (rs: readonly PlanRecord[], s: string) => rs.filter((r) => r.state === s).length;
  const perDistrict = districts.map((d) => {
    const rs = records.filter((r) => r.district === d);
    const cand = rs.filter((r) => r.state !== 'EXCLUDED_HISTORY_ONLY' && r.state !== 'SKIP_EXISTING');
    const sharedGroups = shared.filter((g) => g[0].startsWith(d));
    return {
      district: d, rawRows: rawRows[d], dbRows: db.trades.find((t) => t.lawd_cd === d)?.rows ?? 0,
      distinctAptSeq: rows.filter((r) => r.district === d).length,
      candidates: cand.length, READY: count(rs, 'READY'), GEOCODE_MISSING: count(rs, 'GEOCODE_MISSING'), REVIEW: count(rs, 'REVIEW'),
      UNRESOLVED: count(rs, 'UNRESOLVED'), SKIP_EXISTING: count(rs, 'SKIP_EXISTING'), EXCLUDED_HISTORY_ONLY: count(rs, 'EXCLUDED_HISTORY_ONLY'),
      geocodeRate: cand.length ? +(count(rs, 'READY') / cand.length * 100).toFixed(2) : null,
      sharedParcelGroups: sharedGroups.length, sharedParcelAptSeqs: sharedGroups.reduce((s, g) => s + g.length, 0),
      geocodeAttemptedOrCached: rs.filter((r) => r.coordinate.status !== 'NOT_ATTEMPTED').length,
      insertSet: insertSetHashes(rs),
    };
  });

  const planHash = buildPlanHash({ asOfYm, districts, records });
  const summary = {
    at: new Date().toISOString(), mode: 'DRY_RUN', policy: GG_SEED_POLICY_VERSION, asOfYm, windowStart, districts,
    writes: { insert: 0, update: 0, delete: 0 }, molitCalls: 0,
    kakaoCallsThisRun: { forward: calls.forward, reverse: calls.reverse, total: calls.forward + calls.reverse },
    stoppedBy, guard, seqParity,
    existingGyeonggiMasters: db.existing.length,
    duplicates, sameCoordDifferentParcel,
    totals: {
      TOTAL_CANDIDATES: records.filter((r) => r.state !== 'EXCLUDED_HISTORY_ONLY' && r.state !== 'SKIP_EXISTING').length,
      READY_WITH_COORDS: count(records, 'READY'), GEOCODE_MISSING: count(records, 'GEOCODE_MISSING'), REVIEW: count(records, 'REVIEW'),
      UNRESOLVED: count(records, 'UNRESOLVED'), SKIP_EXISTING: count(records, 'SKIP_EXISTING'), EXCLUDED_HISTORY_ONLY: count(records, 'EXCLUDED_HISTORY_ONLY'),
    },
    PLAN_HASH: planHash,
    insertSet: insertSetHashes(records),
    perDistrict,
    sharedParcelGroups: shared,
    nonReadyRecords: records.filter((r) => r.state !== 'READY' && r.state !== 'EXCLUDED_HISTORY_ONLY').map((r) => ({ aptSeq: r.aptSeq, state: r.state, reasons: r.reasons, name: r.identity.name, lot: `${r.identity.dong} ${r.identity.jibun}`, forward: r.coordinate.forwardSummary, reverse: r.coordinate.reverseLot })),
  };
  writeJson(path.join(OUT, 'plan.json'), { policy: GG_SEED_POLICY_VERSION, asOfYm, districts, PLAN_HASH: planHash, records });
  writeJson(path.join(OUT, 'summary.json'), summary);
  const { nonReadyRecords, sharedParcelGroups: _sg, perDistrict: pd, ...head } = summary;
  console.log(JSON.stringify({ ...head, perDistrict: pd.map(({ insertSet, ...p }) => ({ ...p, withCoords: insertSet.withCoords, withNull: insertSet.withNull })), nonReady: nonReadyRecords.length }, null, 1));
}

// ───────────────────────── apply (create-only) ─────────────────────────

/** 로컬 적용 기록에 이미 있는 aptSeq — 이 실행기가 넣은 것으로 출처가 분명한 master. */
function knownAppliedAptSeqs(): Set<string> {
  const s = new Set<string>();
  if (!fs.existsSync(APPLIED_DIR)) return s;
  for (const f of fs.readdirSync(APPLIED_DIR).filter((x) => x.endsWith('.json') && !x.includes('.rollback'))) {
    const a = readJson<GgAppliedArtifact>(path.join(APPLIED_DIR, f));
    for (const r of a?.inserted ?? []) s.add(r.aptSeq);
  }
  return s;
}

/**
 * apply. `preflight=true`면 apply와 **같은** 재계획·게이트를 돌리고 쓰기 직전에 멈춘다(쓰기 승인 불필요, write 0).
 */
async function runApply(prisma: PrismaClient, preflight = false) {
  const asOfYm = arg('as-of') ?? '202609';
  const districts = (arg('district') ?? '').split(',').filter(Boolean);
  const allowNullCoords = flag('allow-null-coords');
  const guard = requireGuard();
  // 쓰기 전에 읽기·쓰기 승인 둘 다 확인한다(fail-closed, 호스트는 출력하지 않는다).
  const { assertProductionDbAccessAllowed } = await import('../_prod-db-guard');
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'gyeonggi-master-seed.ts(apply read)');
  if (!preflight) assertProductionDbAccessAllowed('BACKFILL', 'gyeonggi-master-seed.ts(apply write)');

  const plan = await planDistricts(prisma, { districts, asOfYm, resume: true, allowGeocode: false });
  const inScope = plan.records.filter((r) => districts.includes(r.district));
  const creates = selectInsertSet(plan.records, districts, { allowNullCoords });
  const planHash = ggPlanHash(creates);
  const known = knownAppliedAptSeqs();
  const unexpectedExisting = plan.db.existing.filter((r) => !r.apt_seq || !known.has(r.apt_seq));
  const gate = evaluateGgApplyGate({
    applyFlag: preflight || flag('apply'),
    allowProdDbRead: process.env.ALLOW_PROD_DB_READ,
    allowProdDbWrite: preflight ? '1' : process.env.ALLOW_PROD_DB_WRITE,
    districts,
    expectInserts: intArg('expect-inserts'),
    plannedInserts: creates.length,
    expectPlanHash: arg('expect-plan-hash') ?? null,
    planHash,
    coordinatesSkipped: false,
    publicExposureGuarded: guard.guarded,
    reviewInScope: inScope.filter((r) => r.state === 'REVIEW').length,
    unresolvedInScope: inScope.filter((r) => r.state === 'UNRESOLVED').length,
    unexpectedExistingMasters: unexpectedExisting.length,
  });
  const dbHostKind = await hostKind();
  console.error(`apply target ${districts.join(',')} · planned inserts ${creates.length} · planHash ${planHash} · db ${dbHostKind} · allowNullCoords ${allowNullCoords}`);
  if (preflight) {
    const out = {
      at: new Date().toISOString(), mode: 'APPLY_PREFLIGHT', writes: 0, districts, allowNullCoords, dbHostKind,
      counts: Object.fromEntries(['READY', 'GEOCODE_MISSING', 'REVIEW', 'UNRESOLVED', 'SKIP_EXISTING', 'EXCLUDED_HISTORY_ONLY'].map((st) => [st, inScope.filter((r) => r.state === st).length])),
      candidates: inScope.filter((r) => r.state !== 'EXCLUDED_HISTORY_ONLY' && r.state !== 'SKIP_EXISTING').length,
      plannedInserts: creates.length, coordsNonNull: creates.filter((c) => c.latitude != null && c.longitude != null).length,
      planHash, gate, existingGyeonggiMasters: plan.db.existing.length, unexpectedExisting: unexpectedExisting.length,
      kakaoCalls: plan.calls.forward + plan.calls.reverse, guard,
    };
    writeJson(path.join(APPLIED_DIR, `preflight-${districts.join('_')}.json`), { ...out, aptSeqs: creates.map((c) => c.aptSeq) });
    console.log(JSON.stringify(out, null, 1));
    if (!gate.allowed) process.exitCode = 2;
    return;
  }
  if (!gate.allowed) {
    writeJson(path.join(APPLIED_DIR, `refused-${Date.now()}.json`), { at: new Date().toISOString(), districts, planHash, plannedInserts: creates.length, gate, unexpectedExisting });
    throw new Error(`APPLY_REFUSED: ${gate.reasons.join(', ')}`);
  }

  const district = districts[0];
  const runId = `gg-master-${district}-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}`;
  const preCountsBySido = await countsBySido(prisma);
  writeJson(path.join(APPLIED_DIR, `${runId}.intent.json`), { runId, district, planHash, expectInserts: creates.length, preCountsBySido, aptSeqs: creates.map((c) => c.aptSeq) });

  // create-only, 단일 트랜잭션: 하나라도 실패하면 전부 되돌리고 실패 aptSeq를 보고한다(부분 적재 없음).
  let inserted: GgInsertedRow[] = [];
  const failed: { aptSeq: string; error: string }[] = [];
  try {
    inserted = await prisma.$transaction(async (tx) => {
      const clash = await tx.apartmentMaster.findMany({ where: { aptSeq: { in: creates.map((c) => c.aptSeq) } }, select: { aptSeq: true } });
      if (clash.length) throw new Error(`EXISTING_BEFORE_INSERT:${clash.map((c) => c.aptSeq).join(',')}`);
      const out: GgInsertedRow[] = [];
      for (const data of creates) {
        if (data.sggCd !== district || !data.aptSeq.startsWith(`${district}-`)) throw new Error(`DISTRICT_GUARD:${data.aptSeq}`);
        try {
          const row = await tx.apartmentMaster.create({ data, select: { id: true, aptSeq: true, sggCd: true, createdAt: true, updatedAt: true } });
          out.push({ aptSeq: row.aptSeq!, id: row.id, sggCd: row.sggCd!, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });
        } catch (e: unknown) {
          failed.push({ aptSeq: data.aptSeq, error: String((e as { code?: string; message?: string })?.code ?? (e as Error)?.message ?? e).slice(0, 200) });
          throw e;
        }
      }
      return out;
    }, { timeout: 120_000, maxWait: 30_000 });
  } catch (e) {
    writeJson(path.join(APPLIED_DIR, `${runId}.failed.json`), { runId, district, planHash, failed, error: String((e as Error)?.message ?? e).slice(0, 300), note: '트랜잭션 전체 롤백 — 삽입 0' });
    throw new Error(`APPLY_FAILED(rolled back, inserted 0): ${failed.map((f) => f.aptSeq).join(',') || String((e as Error)?.message ?? e).slice(0, 200)}`);
  }

  const artifact = buildGgAppliedArtifact({
    runId, policy: GG_SEED_POLICY_VERSION, district, planHash, expectInserts: creates.length, dbHostKind, inserted, failed, preCountsBySido,
  });
  writeJson(path.join(APPLIED_DIR, `${runId}.json`), artifact);
  console.log(JSON.stringify({ mode: 'APPLIED', runId, district, inserted: inserted.length, planHash, artifact: path.relative(process.cwd(), path.join(APPLIED_DIR, `${runId}.json`)) }, null, 1));
  await runVerifyFor(prisma, artifact, flag('live'));
}

// ───────────────────────── verify (read-only) ─────────────────────────

async function liveChecks(artifact: GgAppliedArtifact) {
  const base = arg('base-url') ?? 'https://e-jip.com';
  const e = encodeURIComponent;
  const plan = readJson<{ records: PlanRecord[] }>(path.join(OUT, 'plan.json'));
  const names = (plan?.records ?? []).filter((r) => r.district === artifact.district && r.state === 'READY').slice(0, 3).map((r) => r.identity);
  let searchResults = 0;
  for (const n of names) {
    const j = await (await fetch(`${base}/api/search?q=${e(n.name)}`)).json() as { apartments: { lawdCd: string | null }[]; regions: { lawdCd: string }[] };
    searchResults += j.apartments.filter((a) => (a.lawdCd ?? '').startsWith('41')).length + j.regions.filter((r) => r.lawdCd.startsWith('41')).length;
  }
  const map = await (await fetch(`${base}/api/transactions?type=apt&lawdCd=${artifact.district}&months=12&fields=marker`)).json() as { regionUnsupported?: boolean; transactions: unknown[] };
  const d0 = names[0];
  const detail = d0 ? await (await fetch(`${base}/api/apt/${e(d0.name)}?lawdCd=${artifact.district}&dong=${e(d0.dong)}&period=12`)).json() as { regionUnsupported?: boolean } : { regionUnsupported: true };
  const sm = await (await fetch(`${base}/sitemap.xml`)).text();
  const sitemapGyeonggi = [...sm.matchAll(/<loc>([^<]*)/g)].map((m) => decodeURIComponent(m[1])).filter((u) => /41\d{3}|경기/.test(u)).length;
  return { searchResults, mapUnsupported: map.regionUnsupported === true && map.transactions.length === 0, detailUnsupported: detail.regionUnsupported === true, sitemapGyeonggi };
}

async function runVerifyFor(prisma: PrismaClient, artifact: GgAppliedArtifact, live: boolean) {
  const guard = computePublicExposureGuarded((c, axis) => isPublicRegionAllowed(c, axis));
  const planned = artifact.inserted.map((r) => r.aptSeq);
  const snap = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const districtRows = await tx.$queryRawUnsafe(`SELECT apt_seq, sgg_cd, latitude, longitude FROM apartment_masters WHERE sgg_cd = $1 OR apt_seq LIKE $2`, artifact.district, `${artifact.district}-%`) as { apt_seq: string | null; sgg_cd: string | null; latitude: number | null; longitude: number | null }[];
    const linked = await tx.$queryRawUnsafe(`SELECT DISTINCT apt_seq FROM apartment_trade_histories WHERE lawd_cd = $1 AND apt_seq = ANY($2)`, artifact.district, planned) as { apt_seq: string }[];
    return { districtRows, linked: new Set(linked.map((r) => r.apt_seq)) };
  });
  const post = await countsBySido(prisma);
  const result = evaluatePostApply({
    artifact, districtRows: snap.districtRows, postCountsBySido: post, tradeLinkedAptSeqs: snap.linked,
    publicExposureGuarded: guard.guarded, live: live ? await liveChecks(artifact) : null,
  });
  writeJson(path.join(APPLIED_DIR, `${artifact.runId}.verify.json`), { at: new Date().toISOString(), ...result });
  console.log(JSON.stringify({ mode: 'VERIFY', runId: artifact.runId, ...result }, null, 1));
  if (!result.pass) process.exitCode = 2;
}

async function runVerify(prisma: PrismaClient) {
  const { assertProductionDbAccessAllowed } = await import('../_prod-db-guard');
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'gyeonggi-master-seed.ts(verify)');
  const artifact = readJson<GgAppliedArtifact>(path.resolve(arg('verify')!));
  if (!artifact) throw new Error('적용 기록을 읽지 못했다');
  await runVerifyFor(prisma, artifact, flag('live'));
}

// ───────────────────────── rollback (실행하지 않은 경로 — 파일럿 되돌리기 전용) ─────────────────────────

async function runRollback(prisma: PrismaClient) {
  const { assertProductionDbAccessAllowed } = await import('../_prod-db-guard');
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'gyeonggi-master-seed.ts(rollback read)');
  assertProductionDbAccessAllowed('BACKFILL', 'gyeonggi-master-seed.ts(rollback write)');
  const file = path.resolve(arg('rollback')!);
  const artifact = readJson<GgAppliedArtifact>(file);
  if (!artifact) throw new Error('적용 기록을 읽지 못했다');
  const ids = artifact.inserted.map((r) => r.id);
  const dbRows = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    return tx.$queryRawUnsafe(
      `SELECT id, apt_seq, sgg_cd, to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at, to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at FROM apartment_masters WHERE id = ANY($1::int[])`, ids) as Promise<RollbackDbRow[]>;
  });
  const gate = evaluateRollbackGate({
    rollbackFlag: true, allowProdDbWrite: process.env.ALLOW_PROD_DB_WRITE, runIdArg: arg('run-id') ?? null,
    expectDeletes: intArg('expect-deletes'), artifact, dbRows,
  });
  if (!gate.allowed) throw new Error(`ROLLBACK_REFUSED: ${gate.reasons.join(', ')}`);
  const p = artifact.rollback.params;
  const deleted = await prisma.$transaction(async (tx) => {
    const n = await tx.$executeRawUnsafe(GG_ROLLBACK_SQL, p.ids, p.sggCd, p.from, p.to);
    if (n !== ids.length) throw new Error(`ROLLBACK_COUNT_MISMATCH:${n}!=${ids.length}(되돌림)`);
    return n;
  });
  writeJson(file.replace(/\.json$/, '.rollback.json'), { at: new Date().toISOString(), runId: artifact.runId, deleted, ids });
  console.log(JSON.stringify({ mode: 'ROLLED_BACK', runId: artifact.runId, deleted }, null, 1));
}

async function main() {
  const modes = ['apply', 'preflight', 'rollback', 'verify'].filter((m) => flag(m) || arg(m) != null);
  if (modes.length > 1) throw new Error(`모드는 하나만: ${modes.join(',')}`);
  if (modes[0] === 'apply' && process.argv.some((a) => a.startsWith('--resume'))) throw new Error('--apply는 --resume과 함께 쓰지 않는다(apply는 항상 checkpoint만 쓴다).');
  if (!modes.length) {
    const { assertProductionDbAccessAllowed } = await import('../_prod-db-guard');
    assertProductionDbAccessAllowed('DIAGNOSTIC', 'gyeonggi-master-seed.ts(dry-run read)');
  }
  const prisma = await prismaClient();
  try {
    if (modes[0] === 'apply') await runApply(prisma);
    else if (modes[0] === 'preflight') await runApply(prisma, true);
    else if (modes[0] === 'rollback') await runRollback(prisma);
    else if (modes[0] === 'verify') await runVerify(prisma);
    else await runDryRun(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
}
