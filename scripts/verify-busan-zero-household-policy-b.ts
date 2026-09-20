/**
 * BUSAN_ZERO_HOUSEHOLD_POLICY_B_APPLY_V1 §10~§15 — 보정 후 **읽기 전용** 검증.
 *
 * dry-run artifact(targets에 쓰기 전 모든 컬럼 값이 들어 있다)를 기준선으로 삼아
 *   - 승인 2컬럼이 계획대로 정확히 바뀌었는가
 *   - `parking_count`를 포함한 승인 밖 컬럼이 **전부 불변**인가
 *   - 세대당 주차 이상치가 몇 건 내려왔는가(영향 214 전체 기준)
 *   - 캐시가 보정값을 가리는가
 *   - 서울 / 매매 / 취소 baseline이 그대로인가
 * 를 확인한다. DB write 0.
 *
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/verify-busan-zero-household-policy-b.ts --dryrun=tmp/zero-household-apply/dryrun-XXX.json
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

const num = (v: unknown) => (v == null ? null : Number(v));
const near = (a: number | null, b: number | null) => a != null && b != null && Math.abs(a - b) < 1e-6;

async function main() {
  const file = process.argv.find((a) => a.startsWith('--dryrun='))?.split('=')[1];
  if (!file) throw new Error('--dryrun=<dryrun json> 필요');
  const { targets } = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')) as { targets: Record<string, any>[] };

  const { PrismaClient } = await import('@prisma/client');
  const { assertProductionDbAccessAllowed } = await import('./_prod-db-guard');
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'verify-busan-zero-household-policy-b.ts');
  const prisma = new PrismaClient();

  const seqs = targets.map((t) => t.aptSeq);
  const affected: string[] = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../tmp/building-ledger-paging/field-policy.json'), 'utf8'),
  ).rows.filter((r: any) => r.aptSeq).map((r: any) => r.aptSeq);

  const r = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const now = await tx.$queryRawUnsafe<Record<string, any>[]>(
      `SELECT apt_seq, name, total_households, parking_count, parking_per_household, main_building_count,
              use_approval_date, floor_area_ratio, building_coverage_ratio, road_address, latitude, longitude
       FROM apartment_masters WHERE apt_seq = ANY($1::text[])`, seqs);
    // 영향 214 전체의 현재 비율(이상치 재계산용)
    const all = await tx.$queryRawUnsafe<Record<string, any>[]>(
      `SELECT apt_seq, name, total_households, parking_count, parking_per_household
       FROM apartment_masters WHERE apt_seq = ANY($1::text[])`, affected);
    // 보정 대상에 붙은 캐시 행(tier1 게이트 충족 여부 포함)
    const cache = await tx.$queryRawUnsafe<Record<string, any>[]>(
      `SELECT m.apt_seq, a.id, a.name, a.total_households AS c_h,
              (a.parking_count IS NOT NULL AND a.far IS NOT NULL AND a.bcr IS NOT NULL AND a.approval_date IS NOT NULL) AS gate
       FROM apartment_masters m
       JOIN apartments a ON a.lawd_cd = m.sgg_cd AND a.dong = m.umd_name AND a.jibun = m.jibun
       WHERE m.apt_seq = ANY($1::text[])`, seqs);
    const counts = (await tx.$queryRawUnsafe<Record<string, any>[]>(
      `SELECT (SELECT COUNT(*)::int FROM apartment_masters WHERE sgg_cd LIKE '26%') AS busan,
              (SELECT COUNT(*)::int FROM apartment_masters WHERE sgg_cd LIKE '11%') AS seoul,
              (SELECT COUNT(*)::int FROM apartment_masters WHERE sgg_cd LIKE '11%' AND latitude IS NOT NULL) AS seoul_coords,
              (SELECT COUNT(*)::int FROM apartment_masters WHERE sgg_cd LIKE '26%' AND basic_spec_source = 'UNKNOWN') AS busan_unknown,
              (SELECT COUNT(*)::int FROM apartment_trade_histories) AS trades,
              (SELECT COUNT(*)::int FROM apartment_trade_histories WHERE deal_canceled) AS canceled`))[0];
    return { now, all, cache, counts };
  }, { timeout: 600_000 });
  await prisma.$disconnect();

  const bySeq = new Map(r.now.map((x) => [x.apt_seq, x]));
  const FORBIDDEN: [string, string][] = [
    ['parkingCount', 'parking_count'], ['keepFar', 'floor_area_ratio'], ['keepBcr', 'building_coverage_ratio'],
    ['keepBuildingCount', 'main_building_count'], ['keepApprovalDate', 'use_approval_date'], ['keepRoadAddress', 'road_address'],
  ];

  const householdsChanged: any[] = [], ratioChanged: any[] = [], unexpected: any[] = [], drift: any[] = [];
  for (const t of targets) {
    const n = bySeq.get(t.aptSeq);
    if (!n) { unexpected.push({ aptSeq: t.aptSeq, issue: 'master 사라짐' }); continue; }
    if (num(n.total_households) === t.newHouseholds) householdsChanged.push({ aptSeq: t.aptSeq, name: t.name, from: t.oldHouseholds, to: t.newHouseholds });
    else unexpected.push({ aptSeq: t.aptSeq, field: 'total_households', expected: t.newHouseholds, actual: num(n.total_households) });

    if (t.oldPph != null && t.parkingCount != null) {
      if (near(num(n.parking_per_household), t.newPph)) ratioChanged.push({ aptSeq: t.aptSeq, from: t.oldPph, to: num(n.parking_per_household) });
      else unexpected.push({ aptSeq: t.aptSeq, field: 'parking_per_household', expected: t.newPph, actual: num(n.parking_per_household) });
    } else if (n.parking_per_household != null && t.oldPph == null) {
      unexpected.push({ aptSeq: t.aptSeq, field: 'parking_per_household', issue: 'null이어야 하는데 채워짐' });
    }

    for (const [k, col] of FORBIDDEN) {
      const before = t[k] ?? null;
      const after = col === 'use_approval_date' || col === 'road_address' ? (n[col] ?? null) : num(n[col]);
      const same = before == null && after == null ? true
        : typeof before === 'number' && typeof after === 'number' ? Math.abs(before - after) < 1e-9
        : String(before) === String(after);
      if (!same) drift.push({ aptSeq: t.aptSeq, field: col, before, after });
    }
  }

  // §11 이상치 — 영향 214 전체를 현재 DB 값으로 다시 계산
  const ratios = r.all.map((x) => {
    const h = num(x.total_households), p = num(x.parking_count);
    return { aptSeq: x.apt_seq, name: x.name, r: h && p && h > 0 ? p / h : null };
  });
  const over = (t: number) => ratios.filter((x) => x.r != null && x.r > t);
  // 저장된 파생비율이 두 값과 어긋나는 행(불변식 위반)
  const invariantBroken = r.all.filter((x) => x.parking_per_household != null && x.total_households && x.parking_count
    && Math.abs(Number(x.parking_per_household) - Number(x.parking_count) / Number(x.total_households)) > 0.005);

  const out = {
    at: new Date().toISOString(), readOnly: true, dbWrites: 0,
    householdsChanged: householdsChanged.length,
    parkingPerHouseholdChanged: ratioChanged.length,
    parkingCountChanged: drift.filter((d) => d.field === 'parking_count').length,
    unexpected, forbiddenDrift: drift, forbiddenFieldDrift: drift.length,
    hanbojangsanTouched: seqs.includes('26350-52'),
    anomalies: { over2: over(2).length, over5: over(5).length, over10: over(10).length,
      remaining: over(2).map((x) => ({ aptSeq: x.aptSeq, name: x.name, ratio: +x.r!.toFixed(2) })) },
    invariantBrokenIn214: invariantBroken.length,
    cache: { rowsOnTargets: r.cache.length, underTier1Gate: r.cache.filter((c) => c.gate).length,
      maskingRows: r.cache.filter((c) => c.gate && c.c_h != null).map((c) => ({ aptSeq: c.apt_seq, cacheHouseholds: Number(c.c_h) })) },
    counts: r.counts,
    topFixed: householdsChanged.slice(0, 10),
  };
  console.log(JSON.stringify(out, null, 2));
  const dir = path.dirname(path.resolve(file));
  fs.writeFileSync(path.join(dir, `verify-${new Date().toISOString().replace(/[:.]/g, '-')}.json`),
    JSON.stringify({ ...out, householdsChanged, ratioChanged }, null, 2));
}

if (require.main === module) main().catch((e) => { console.error(String((e as Error)?.stack ?? e)); process.exit(1); });
