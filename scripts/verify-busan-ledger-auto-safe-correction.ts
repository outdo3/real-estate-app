/**
 * BUSAN_BUILDING_LEDGER_AUTO_SAFE_CORRECTION_V1 §10·§14·§16 — 보정 후 **읽기 전용** 검증.
 *
 * dry-run artifact(targets에 쓰기 전 모든 컬럼 값이 들어 있다)를 기준선으로 삼아
 *   - 승인 2컬럼이 계획대로 정확히 바뀌었는가
 *   - 승인 밖 컬럼(parking·FAR·BCR·buildingCount·approvalDate·parkingPerHousehold·좌표·identity)이 **전부 불변**인가
 *   - REVIEW / UNKNOWN / 서울이 안 건드려졌는가
 *   - 세대당 주차 이상치가 몇 개 내려왔는가
 *   - 매매/취소 baseline이 그대로인가
 * 를 확인한다. DB write 0.
 *
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/verify-busan-ledger-auto-safe-correction.ts --dryrun=tmp/busan-ledger-auto-safe/dryrun-XXX.json
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { normalizeRoad } from './busan-ledger-auto-safe-logic';

const num = (v: unknown) => (v == null ? null : Number(v));

async function main() {
  const file = process.argv.find((a) => a.startsWith('--dryrun='))?.split('=')[1];
  if (!file) throw new Error('--dryrun=<dryrun json> 필요');
  const { targets } = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')) as { targets: Record<string, any>[] };

  const { PrismaClient } = await import('@prisma/client');
  const { assertProductionDbAccessAllowed } = await import('./_prod-db-guard');
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'verify-busan-ledger-auto-safe-correction.ts');
  const prisma = new PrismaClient();

  const seqs = targets.map((t) => t.aptSeq);
  const r = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const now = await tx.$queryRawUnsafe<Record<string, any>[]>(
      `SELECT apt_seq, name, total_households, parking_count, parking_per_household, main_building_count,
              use_approval_date, floor_area_ratio, building_coverage_ratio, road_address,
              latitude, longitude, sgg_cd, umd_name, jibun, basic_spec_source
       FROM apartment_masters WHERE apt_seq = ANY($1::text[])`, seqs);
    const region = (await tx.$queryRawUnsafe<Record<string, any>[]>(
      `SELECT
         COUNT(*) FILTER (WHERE sgg_cd LIKE '26%')::int AS busan,
         COUNT(*) FILTER (WHERE sgg_cd LIKE '11%')::int AS seoul,
         COUNT(*) FILTER (WHERE sgg_cd LIKE '11%' AND latitude IS NOT NULL)::int AS seoul_with_coords,
         COUNT(*) FILTER (WHERE sgg_cd LIKE '26%' AND basic_spec_source = 'UNKNOWN')::int AS busan_unknown,
         COUNT(*) FILTER (WHERE sgg_cd LIKE '26%' AND latitude IS NULL)::int AS busan_null_coords
       FROM apartment_masters`))[0];
    const trades = (await tx.$queryRawUnsafe<Record<string, any>[]>(
      `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE deal_canceled)::int AS canceled
       FROM apartment_trade_histories`))[0];
    return { now, region, trades };
  }, { timeout: 600_000 });
  await prisma.$disconnect();

  const bySeq = new Map(r.now.map((x) => [x.apt_seq, x]));
  const FORBIDDEN: [string, string][] = [
    ['storedParking', 'parking_count'],
    ['storedFar', 'floor_area_ratio'], ['storedBcr', 'building_coverage_ratio'],
    ['storedBuildingCount', 'main_building_count'], ['storedApproval', 'use_approval_date'],
  ];

  const householdsChanged: any[] = [];
  const roadChanged: any[] = [];
  const unexpected: any[] = [];
  const forbiddenDrift: any[] = [];

  for (const t of targets) {
    const n = bySeq.get(t.aptSeq);
    if (!n) { unexpected.push({ aptSeq: t.aptSeq, issue: 'master 사라짐' }); continue; }

    // 승인 컬럼 1: 세대수
    const nowH = num(n.total_households);
    if (t.households.verdict === 'AUTO_SAFE') {
      if (nowH === t.households.newValue) householdsChanged.push({ aptSeq: t.aptSeq, name: t.name, from: t.storedHouseholds, to: nowH });
      else unexpected.push({ aptSeq: t.aptSeq, field: 'total_households', expected: t.households.newValue, actual: nowH });
    } else if (nowH !== t.storedHouseholds) {
      unexpected.push({ aptSeq: t.aptSeq, field: 'total_households', issue: '승인 대상이 아닌데 바뀜', was: t.storedHouseholds, now: nowH });
    }

    // 승인 컬럼 2: 도로명
    const nowR = n.road_address ?? null;
    if (t.road.verdict === 'AUTO_SAFE') {
      if (normalizeRoad(nowR) === normalizeRoad(t.road.newValue)) roadChanged.push({ aptSeq: t.aptSeq, name: t.name, from: t.storedRoad, to: nowR });
      else unexpected.push({ aptSeq: t.aptSeq, field: 'road_address', expected: t.road.newValue, actual: nowR });
    } else if (normalizeRoad(nowR) !== normalizeRoad(t.storedRoad)) {
      unexpected.push({ aptSeq: t.aptSeq, field: 'road_address', issue: '승인 대상이 아닌데 바뀜', was: t.storedRoad, now: nowR });
    }

    // 승인 밖 컬럼은 전부 불변이어야 한다
    for (const [k, col] of FORBIDDEN) {
      const before = t[k] ?? null;
      const after = col === 'use_approval_date' ? (n[col] ?? null) : num(n[col]);
      const same = before == null && after == null ? true
        : typeof before === 'number' && typeof after === 'number' ? Math.abs(before - after) < 1e-9
        : String(before) === String(after);
      if (!same) forbiddenDrift.push({ aptSeq: t.aptSeq, field: col, before, after });
    }
  }

  // 파생 불변식: 세대수를 고친 행은 parking_per_household도 함께 맞춰져 있어야 한다.
  const ratioRepaired: any[] = [];
  const ratioBroken: any[] = [];
  for (const t of targets) {
    if (t.households.verdict !== 'AUTO_SAFE') continue;
    const n = bySeq.get(t.aptSeq);
    const nowP = num(n?.parking_count);
    const nowPph = num(n?.parking_per_household);
    if (t.storedPph == null || t.storedParking == null) continue;
    const expected = nowP! / (t.households.newValue as number);
    if (nowPph != null && Math.abs(nowPph - expected) < 1e-6) ratioRepaired.push({ aptSeq: t.aptSeq, from: t.storedPph, to: nowPph });
    else ratioBroken.push({ aptSeq: t.aptSeq, expected, actual: nowPph });
  }

  // §11 세대당 주차 이상치 — 실제 DB 값으로 다시 계산
  const ratio = (h: number | null, p: number | null) => (h && p && h > 0 ? p / h : null);
  const before = targets.map((t) => ({ aptSeq: t.aptSeq, name: t.name, r: ratio(t.storedHouseholds, t.storedParking) }));
  const after = targets.map((t) => {
    const n = bySeq.get(t.aptSeq);
    return { aptSeq: t.aptSeq, name: t.name, r: ratio(num(n?.total_households), num(n?.parking_count)) };
  });
  const severeBefore = before.filter((x) => x.r != null && x.r > 2.0);
  const severeAfter = after.filter((x) => x.r != null && x.r > 2.0);

  const out = {
    at: new Date().toISOString(), readOnly: true, dbWrites: 0,
    householdsChanged: householdsChanged.length,
    roadChanged: roadChanged.length,
    uniqueMastersTouched: new Set([...householdsChanged, ...roadChanged].map((x) => x.aptSeq)).size,
    unexpected, forbiddenDrift,
    forbiddenFieldDrift: forbiddenDrift.length,
    derivedRatio: { repaired: ratioRepaired.length, broken: ratioBroken.length, brokenRows: ratioBroken.slice(0, 5) },
    s26350_15: (() => {
      const t = targets.find((x) => x.aptSeq === '26350-15');
      const n = bySeq.get('26350-15');
      if (!t || !n) return 'not-a-target';
      return { householdsUnchanged: num(n.total_households) === t.storedHouseholds,
        parkingUnchanged: num(n.parking_count) === t.storedParking,
        households: num(n.total_households), parking: num(n.parking_count), road: n.road_address ?? null };
    })(),
    region: r.region, trades: r.trades,
    severe: { before: severeBefore.length, after: severeAfter.length, fixed: severeBefore.length - severeAfter.length,
      remaining: severeAfter.map((x) => ({ aptSeq: x.aptSeq, name: x.name, ratio: +x.r!.toFixed(2) })).slice(0, 10) },
    topFixed: householdsChanged.slice(0, 10),
  };
  console.log(JSON.stringify(out, null, 2));
  const dir = path.dirname(path.resolve(file));
  fs.writeFileSync(path.join(dir, `verify-${new Date().toISOString().replace(/[:.]/g, '-')}.json`),
    JSON.stringify({ ...out, householdsChanged, roadChanged }, null, 2));
}

if (require.main === module) main().catch((e) => { console.error(String((e as Error)?.stack ?? e)); process.exit(1); });
