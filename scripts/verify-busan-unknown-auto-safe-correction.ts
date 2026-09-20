/**
 * BUSAN_UNKNOWN_AUTO_SAFE_CORRECTION_V1 §12·§15·§16 — 보정 후 **읽기 전용** 검증.
 *
 * dry-run artifact(targets에 쓰기 전 모든 컬럼 값이 들어 있다)를 기준선으로 삼아
 *   - 승인 2컬럼이 계획대로 정확히 바뀌었는가
 *   - `basic_spec_source`를 포함한 승인 밖 컬럼이 **전부 불변**인가
 *   - 미평가 48 · REVIEW 166이 그대로인가
 *   - UNKNOWN 집합의 **데이터 상태**를 다시 센다(라벨은 여전히 UNKNOWN이다 — 실패가 아니다)
 *   - 서울 / 매매 / 취소 baseline
 * 를 확인한다. DB write 0.
 *
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/verify-busan-unknown-auto-safe-correction.ts --dryrun=tmp/unknown-apply/dryrun-XXX.json
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { normalizeRoad } from './busan-ledger-auto-safe-logic';
import { isBlank } from './analyze-ledger-unknown-source-trust';

const num = (v: unknown) => (v == null ? null : Number(v));

async function main() {
  const file = process.argv.find((a) => a.startsWith('--dryrun='))?.split('=')[1];
  if (!file) throw new Error('--dryrun=<dryrun json> 필요');
  const { targets } = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')) as { targets: Record<string, any>[] };
  // 감사 원본에서 미평가 48건의 aptSeq를 가져온다(조용히 놓치지 않기 위해).
  const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../tmp/unknown-source/raw.json'), 'utf8'));
  const unevaluated: string[] = raw.rows.filter((r: any) => r.fetch !== 'COMPLETE' && r.fetch !== 'EMPTY').map((r: any) => r.aptSeq);

  const { PrismaClient } = await import('@prisma/client');
  const { assertProductionDbAccessAllowed } = await import('./_prod-db-guard');
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'verify-busan-unknown-auto-safe-correction.ts');
  const prisma = new PrismaClient();

  const seqs = targets.map((t) => t.aptSeq);
  const r = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const now = await tx.$queryRawUnsafe<Record<string, any>[]>(
      `SELECT apt_seq, name, total_households, parking_count, parking_per_household, main_building_count,
              use_approval_date, floor_area_ratio, building_coverage_ratio, road_address,
              basic_spec_source, mgm_bldrgst_pk, latitude, longitude
       FROM apartment_masters WHERE apt_seq = ANY($1::text[])`, seqs);
    const unev = await tx.$queryRawUnsafe<Record<string, any>[]>(
      `SELECT apt_seq, total_households, road_address, basic_spec_source
       FROM apartment_masters WHERE apt_seq = ANY($1::text[])`, unevaluated);
    // UNKNOWN 집합의 현재 데이터 상태
    const state = (await tx.$queryRawUnsafe<Record<string, any>[]>(
      `SELECT COUNT(*)::int AS unknown_total,
              COUNT(*) FILTER (WHERE total_households IS NOT NULL)::int AS has_households,
              COUNT(*) FILTER (WHERE road_address IS NOT NULL AND btrim(road_address) <> '')::int AS has_road,
              COUNT(*) FILTER (WHERE road_address IS NULL OR btrim(road_address) = '')::int AS missing_road,
              COUNT(*) FILTER (WHERE parking_count IS NOT NULL)::int AS has_parking,
              COUNT(*) FILTER (WHERE parking_per_household IS NOT NULL)::int AS has_pph
       FROM apartment_masters WHERE sgg_cd LIKE '26%' AND basic_spec_source = 'UNKNOWN'`))[0];
    const counts = (await tx.$queryRawUnsafe<Record<string, any>[]>(
      `SELECT (SELECT COUNT(*)::int FROM apartment_masters WHERE sgg_cd LIKE '26%') AS busan,
              (SELECT COUNT(*)::int FROM apartment_masters WHERE sgg_cd LIKE '11%') AS seoul,
              (SELECT COUNT(*)::int FROM apartment_masters WHERE sgg_cd LIKE '11%' AND latitude IS NOT NULL) AS seoul_coords,
              (SELECT COUNT(*)::int FROM apartment_masters WHERE sgg_cd LIKE '26%' AND basic_spec_source = 'UNKNOWN') AS busan_unknown,
              (SELECT COUNT(*)::int FROM apartment_trade_histories) AS trades,
              (SELECT COUNT(*)::int FROM apartment_trade_histories WHERE deal_canceled) AS canceled,
              (SELECT COUNT(*)::int FROM apartment_trade_histories WHERE lawd_cd LIKE '11%') AS seoul_sale`))[0];
    return { now, unev, state, counts };
  }, { timeout: 600_000 });
  await prisma.$disconnect();

  const bySeq = new Map(r.now.map((x) => [x.apt_seq, x]));
  const FORBIDDEN: [string, string][] = [
    ['keepParking', 'parking_count'], ['keepPph', 'parking_per_household'],
    ['keepFar', 'floor_area_ratio'], ['keepBcr', 'building_coverage_ratio'],
    ['keepBuildingCount', 'main_building_count'], ['keepApprovalDate', 'use_approval_date'],
    ['keepSource', 'basic_spec_source'], ['keepPk', 'mgm_bldrgst_pk'],
    ['keepLat', 'latitude'], ['keepLng', 'longitude'],
  ];
  const TEXT = new Set(['use_approval_date', 'basic_spec_source', 'mgm_bldrgst_pk']);

  const householdsChanged: any[] = [], roadChanged: any[] = [], unexpected: any[] = [], drift: any[] = [];
  for (const t of targets) {
    const n = bySeq.get(t.aptSeq);
    if (!n) { unexpected.push({ aptSeq: t.aptSeq, issue: 'master 사라짐' }); continue; }

    if (t.hAuto) {
      if (num(n.total_households) === t.newHouseholds) householdsChanged.push({ aptSeq: t.aptSeq, name: t.name, from: t.oldHouseholds, to: t.newHouseholds });
      else unexpected.push({ aptSeq: t.aptSeq, field: 'total_households', expected: t.newHouseholds, actual: num(n.total_households) });
    } else if (num(n.total_households) !== t.oldHouseholds) {
      unexpected.push({ aptSeq: t.aptSeq, field: 'total_households', issue: '대상이 아닌데 바뀜' });
    }

    if (t.rAuto) {
      if (normalizeRoad(n.road_address) === normalizeRoad(t.newRoadAddress)) roadChanged.push({ aptSeq: t.aptSeq, name: t.name, to: n.road_address });
      else unexpected.push({ aptSeq: t.aptSeq, field: 'road_address', expected: t.newRoadAddress, actual: n.road_address });
    } else if (normalizeRoad(n.road_address) !== normalizeRoad(t.oldRoadAddress)) {
      unexpected.push({ aptSeq: t.aptSeq, field: 'road_address', issue: '대상이 아닌데 바뀜' });
    }

    for (const [k, col] of FORBIDDEN) {
      const before = t[k] ?? null;
      const after = TEXT.has(col) ? (n[col] ?? null) : num(n[col]);
      const same = before == null && after == null ? true
        : typeof before === 'number' && typeof after === 'number' ? Math.abs(before - after) < 1e-9
        : String(before) === String(after);
      if (!same) drift.push({ aptSeq: t.aptSeq, field: col, before, after });
    }
  }

  // §15 UNKNOWN 데이터 상태 재집계 — 라벨이 UNKNOWN인 것은 실패가 아니다
  const rawBySeq = new Map(raw.rows.map((x: any) => [x.aptSeq, x]));
  let wrongHouseholdsRemaining = 0, missingRoadRemaining = 0;
  for (const [seq, x] of rawBySeq) {
    const src = x as any;
    if (src.fetch !== 'COMPLETE') continue;
    const n = bySeq.get(seq as string);
    const currentH = n ? num(n.total_households) : src.stored.households;
    if (src.safeHouseholds != null && currentH != null && currentH !== src.safeHouseholds) wrongHouseholdsRemaining++;
    const currentRoad = n ? n.road_address : src.stored.roadAddress;
    if (isBlank(currentRoad) && src.roadVerdict === 'AUTO_SAFE') missingRoadRemaining++;
  }

  const out = {
    at: new Date().toISOString(), readOnly: true, dbWrites: 0,
    householdsChanged: householdsChanged.length,
    roadAddressChanged: roadChanged.length,
    uniqueMastersTouched: new Set([...householdsChanged, ...roadChanged].map((x) => x.aptSeq)).size,
    unexpected, forbiddenDrift: drift, forbiddenFieldDrift: drift.length,
    basicSpecSourceChanged: drift.filter((d) => d.field === 'basic_spec_source').length,
    unevaluated48: { listed: unevaluated.length,
      touched: r.unev.filter((u) => seqs.includes(u.apt_seq)).length,
      allStillUnknown: r.unev.every((u) => u.basic_spec_source === 'UNKNOWN') },
    unknownDataState: r.state,
    remaining: { wrongHouseholds: wrongHouseholdsRemaining, missingRoadAddressAuto: missingRoadRemaining },
    counts: r.counts,
    topFixed: householdsChanged.slice(0, 12),
  };
  console.log(JSON.stringify(out, null, 2));
  const dir = path.dirname(path.resolve(file));
  fs.writeFileSync(path.join(dir, `verify-${new Date().toISOString().replace(/[:.]/g, '-')}.json`),
    JSON.stringify({ ...out, householdsChanged, roadChanged }, null, 2));
}

if (require.main === module) main().catch((e) => { console.error(String((e as Error)?.stack ?? e)); process.exit(1); });
