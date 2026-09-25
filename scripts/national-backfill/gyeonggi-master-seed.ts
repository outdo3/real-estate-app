/**
 * GYEONGGI_MASTER_SEEDING_DRYRUN_V1 — 경기 첫 배치 8구 ApartmentMaster seed **dry-run 전용** 실행기.
 *
 * 이 파일에는 DB 쓰기 경로가 없다(create/update/delete 0). apply는 별도 STEP·별도 승인으로 추가한다.
 *   원천   : tmp/national-backfill/districts/<구>/raw — 이미 적재·검증된 매매 전체 이력(MOLIT 호출 0)
 *   DB     : Production READ ONLY(SET TRANSACTION READ ONLY) — 거래 aptSeq 대조 · 기존 master 확인
 *   좌표   : Kakao 주소 검색 → 필지 단일 일치 → 역지오코딩 필지 일치(서울 seed와 같은 클라이언트·헤더·간격·429 처리)
 *   산출물 : tmp/gyeonggi-master-seed/ — plan.json · summary.json · districts/<구>/checkpoint.json
 *
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/national-backfill/gyeonggi-master-seed.ts [--district=41111,41113] [--resume] [--as-of=202609]
 *
 * --resume: checkpoint의 **종결** 좌표(VERIFIED·NO_MATCH·CROSS_REGION·AMBIGUOUS·REVERSE_*)는 다시 묻지 않는다.
 * ERROR·RATE_LIMITED·NOT_ATTEMPTED만 다시 묻는다. 창(as-of)이 다르면 checkpoint를 쓰지 않는다.
 */
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { aggregateCandidates, type RawTradeItem, type SeedCandidate } from '../seoul-master-seed-plan-logic';
import { realReverseGeocode, realSearchAddress } from '../seed-seoul-apartment-master';
import { isPublicRegionAllowed, isSidoPubliclyHidden } from '../../src/lib/region/enablement';
import {
  buildPlanHash,
  buildPlanRecord,
  classifyForward,
  classifyGgCandidates,
  computePublicExposureGuarded,
  findDuplicateAptSeqs,
  ggAddressQuery,
  ggVerifyReverseLot,
  GG_SEED_POLICY_VERSION,
  GYEONGGI_FIRST_BATCH,
  insertSetHashes,
  NOT_ATTEMPTED_EVIDENCE,
  sharedParcelGroups,
  summarizeLot,
  TERMINAL,
  tierAWindowStart,
  type CoordEvidence,
  type GgSeedRow,
  type PlanRecord,
} from './gyeonggi-master-seed-logic';

const RAW_ROOT = path.resolve(__dirname, '../../tmp/national-backfill/districts');
const OUT = path.resolve(__dirname, '../../tmp/gyeonggi-master-seed');

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const flag = (name: string) => process.argv.includes(`--${name}`);

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

async function readDb(districts: readonly string[], aptSeqs: readonly string[]) {
  const { assertProductionDbAccessAllowed } = await import('../_prod-db-guard');
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'gyeonggi-master-seed.ts(dry-run read)');
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      const trades = await tx.$queryRawUnsafe(
        `SELECT lawd_cd, count(*)::int AS rows, count(DISTINCT apt_seq)::int AS apt_seqs FROM apartment_trade_histories WHERE lawd_cd = ANY($1) GROUP BY lawd_cd`, districts) as { lawd_cd: string; rows: number; apt_seqs: number }[];
      const tradeSeqs = await tx.$queryRawUnsafe(
        `SELECT DISTINCT apt_seq FROM apartment_trade_histories WHERE lawd_cd = ANY($1) AND apt_seq IS NOT NULL`, districts) as { apt_seq: string }[];
      const existing = await tx.$queryRawUnsafe(
        `SELECT apt_seq, sgg_cd FROM apartment_masters WHERE apt_seq = ANY($1) OR sgg_cd LIKE '41%' OR apt_seq LIKE '41%'`, aptSeqs) as { apt_seq: string | null; sgg_cd: string | null }[];
      return { trades, tradeSeqs: tradeSeqs.map((r) => r.apt_seq), existing };
    }, { timeout: 180_000 });
  } finally {
    await prisma.$disconnect();
  }
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

async function main() {
  const asOfYm = arg('as-of') ?? '202609';
  const districts = (arg('district') ?? GYEONGGI_FIRST_BATCH.join(',')).split(',').filter(Boolean);
  const resume = flag('resume');
  if (process.argv.includes('--apply')) throw new Error('이 실행기는 dry-run 전용이다(apply 경로 없음 — 별도 승인 STEP).');
  for (const d of districts) if (!(GYEONGGI_FIRST_BATCH as readonly string[]).includes(d)) throw new Error(`첫 배치 밖 구: ${d}`);

  // STEP 1 — 공개 노출 가드. 닫혀 있지 않으면 계획도 만들지 않는다.
  const guard = computePublicExposureGuarded((c, axis) => isPublicRegionAllowed(c, axis));
  const selectorHidden = isSidoPubliclyHidden('41');
  if (!guard.guarded || !selectorHidden) {
    writeJson(path.join(OUT, 'summary.json'), { at: new Date().toISOString(), verdict: 'HOLD', guard, selectorHidden });
    throw new Error(`PUBLIC_EXPOSURE_NOT_GUARDED: ${guard.openAxes.join(',')} selectorHidden=${selectorHidden}`);
  }

  // STEP 2 — 후보(8구 전부의 응답으로 identity를 판정해야 이웃 구 오기재를 잡는다).
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
  const db = await readDb(GYEONGGI_FIRST_BATCH, allSeqs);
  const existingSeqs = new Set(db.existing.map((r) => r.apt_seq).filter((s): s is string => !!s));
  const windowStart = tierAWindowStart(asOfYm);
  const rows = classifyGgCandidates({ entriesByAptSeq: entries, districts: GYEONGGI_FIRST_BATCH, existingAptSeqs: existingSeqs, windowStart })
    .filter((r) => districts.includes(r.district));

  // 원천 ↔ DB aptSeq 집합 대조(다르면 계획을 믿지 않는다).
  const dbSeqSet = new Set(db.tradeSeqs);
  const srcSeqSet = new Set(allSeqs);
  const seqParity = { source: srcSeqSet.size, db: dbSeqSet.size, onlySource: allSeqs.filter((s) => !dbSeqSet.has(s)), onlyDb: db.tradeSeqs.filter((s) => !srcSeqSet.has(s)) };

  // STEP 5·6·10 — 좌표(구 단위 checkpoint, RATE_LIMITED면 즉시 중단).
  const calls = { forward: 0, reverse: 0 };
  let stoppedBy: string | null = null;
  const records: PlanRecord[] = [];
  for (const d of districts) {
    const cpPath = path.join(OUT, 'districts', d, 'checkpoint.json');
    const prev = resume ? readJson<Checkpoint>(cpPath) : null;
    const cp: Checkpoint = prev && prev.asOfYm === asOfYm && prev.policy === GG_SEED_POLICY_VERSION ? prev : { asOfYm, policy: GG_SEED_POLICY_VERSION, coords: {} };
    const before = { ...calls };
    let n = 0;
    for (const row of rows.filter((r) => r.district === d)) {
      let coord: CoordEvidence = NOT_ATTEMPTED_EVIDENCE;
      if (row.status === 'READY') {
        const cached = cp.coords[row.aptSeq];
        if (cached && TERMINAL.has(cached.status)) coord = cached;
        else if (!stoppedBy) {
          coord = await geocode(row, calls);
          cp.coords[row.aptSeq] = coord;
          if (coord.status === 'RATE_LIMITED') stoppedBy = `RATE_LIMITED at ${row.aptSeq}`;
          if (++n % 20 === 0) writeJson(cpPath, cp);
        }
      }
      records.push(buildPlanRecord(row, coord));
    }
    writeJson(cpPath, cp);
    const dr = records.filter((r) => r.district === d);
    writeJson(path.join(OUT, 'districts', d, 'records.json'), dr);
    console.error(`${d} done — forward ${calls.forward - before.forward} reverse ${calls.reverse - before.reverse}${stoppedBy ? ` STOPPED ${stoppedBy}` : ''}`);
  }

  // STEP 7·16 — 같은 필지, 중복, 기존 master.
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
    const geoAttempted = rs.filter((r) => r.coordinate.status !== 'NOT_ATTEMPTED').length;
    const sharedGroups = shared.filter((g) => g[0].startsWith(d));
    const hashes = insertSetHashes(rs);
    return {
      district: d, rawRows: rawRows[d], dbRows: db.trades.find((t) => t.lawd_cd === d)?.rows ?? 0,
      distinctAptSeq: rows.filter((r) => r.district === d).length,
      candidates: cand.length, READY: count(rs, 'READY'), GEOCODE_MISSING: count(rs, 'GEOCODE_MISSING'), REVIEW: count(rs, 'REVIEW'),
      UNRESOLVED: count(rs, 'UNRESOLVED'), SKIP_EXISTING: count(rs, 'SKIP_EXISTING'), EXCLUDED_HISTORY_ONLY: count(rs, 'EXCLUDED_HISTORY_ONLY'),
      geocodeRate: cand.length ? +(count(rs, 'READY') / cand.length * 100).toFixed(2) : null,
      sharedParcelGroups: sharedGroups.length, sharedParcelAptSeqs: sharedGroups.reduce((s, g) => s + g.length, 0),
      geocodeAttemptedOrCached: geoAttempted,
      insertSet: hashes,
    };
  });

  const planHash = buildPlanHash({ asOfYm, districts, records });
  const allHashes = insertSetHashes(records);
  const summary = {
    at: new Date().toISOString(), mode: 'DRY_RUN', policy: GG_SEED_POLICY_VERSION, asOfYm, windowStart, districts,
    writes: { insert: 0, update: 0, delete: 0 }, molitCalls: 0,
    kakaoCallsThisRun: { forward: calls.forward, reverse: calls.reverse, total: calls.forward + calls.reverse },
    stoppedBy,
    guard: { ...guard, selectorHidden },
    seqParity: { ...seqParity, onlySource: seqParity.onlySource.length, onlyDb: seqParity.onlyDb.length },
    existingGyeonggiMasters: db.existing.length,
    duplicates, sameCoordDifferentParcel,
    totals: {
      TOTAL_CANDIDATES: records.filter((r) => r.state !== 'EXCLUDED_HISTORY_ONLY' && r.state !== 'SKIP_EXISTING').length,
      READY_WITH_COORDS: count(records, 'READY'), GEOCODE_MISSING: count(records, 'GEOCODE_MISSING'), REVIEW: count(records, 'REVIEW'),
      UNRESOLVED: count(records, 'UNRESOLVED'), SKIP_EXISTING: count(records, 'SKIP_EXISTING'), EXCLUDED_HISTORY_ONLY: count(records, 'EXCLUDED_HISTORY_ONLY'),
    },
    PLAN_HASH: planHash,
    insertSet: allHashes,
    perDistrict,
    sharedParcelGroups: shared,
    nonReadyRecords: records.filter((r) => r.state !== 'READY' && r.state !== 'EXCLUDED_HISTORY_ONLY').map((r) => ({ aptSeq: r.aptSeq, state: r.state, reasons: r.reasons, name: r.identity.name, lot: `${r.identity.dong} ${r.identity.jibun}`, forward: r.coordinate.forwardSummary, reverse: r.coordinate.reverseLot })),
  };
  writeJson(path.join(OUT, 'plan.json'), { policy: GG_SEED_POLICY_VERSION, asOfYm, districts, PLAN_HASH: planHash, records });
  writeJson(path.join(OUT, 'summary.json'), summary);
  const { nonReadyRecords, sharedParcelGroups: _sg, perDistrict: pd, ...head } = summary;
  console.log(JSON.stringify({ ...head, perDistrict: pd.map(({ insertSet, ...p }) => ({ ...p, withCoords: insertSet.withCoords, withNull: insertSet.withNull })), nonReady: nonReadyRecords.length }, null, 1));
}

main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
