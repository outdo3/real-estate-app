/**
 * E-JIP SCORE V2 — PHASE 1.6 peer-sample semantics verification. READ-ONLY,
 * no writes, no schema/production-score change.
 *
 * Fixes a reporting bug found in Phase 1.5's script
 * (ejip-score-v2-phase1_5-peer-analysis.ts): its `l1PoolSizing` stat was
 * computed once, unconditionally, over ALL raw sigungu×decade×size-band
 * groups (291 groups, median 6) and reported identically under every
 * MIN_SAMPLE sweep entry — it never actually reflected which pools were
 * used for scoring at a given threshold. This script fixes that by ALWAYS
 * computing "pool size" / "comparison count" distributions only over
 * apartments actually assigned to a given level, never over the raw
 * unconditional group map.
 *
 * Terminology fixed for this script (see doc for full definitions):
 *   - poolSizeRaw(key)   = number of scoreable apartments sharing a peer key,
 *                          regardless of whether that group is ever used.
 *   - assignedLevel(apt) = 1/2/3/4/0(NOT_AVAILABLE), decided by walking
 *                          L1→L2→L3→L4 and picking the first level whose
 *                          poolSizeRaw >= MIN_SAMPLE.
 *   - comparisonCount(apt) = poolSizeRaw of the level actually assigned —
 *                          this is also the percentile denominator, and it
 *                          is SELF-INCLUDED (the apartment being scored is
 *                          one of the members of its own pool). This matches
 *                          percentileRank()'s actual `pool.length` divisor.
 *   - peerCountExcludingSelf = comparisonCount - 1 (a UI-display candidate).
 *
 * 사용법:
 *   npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js scripts/apartment-score/ejip-score-v2-phase1_6-verification.ts <output.json>
 */
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { prisma } from '@/lib/prisma';
import { calculateApartmentScore } from '@/lib/apartment-score/server/calculate';

const SIDO_VALUE = '부산';

function pct(arr: number[], p: number): number | null {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))));
  return s[idx];
}
function distSummary(arr: number[]) {
  return { n: arr.length, min: arr.length ? Math.min(...arr) : null, p10: pct(arr, 10), p25: pct(arr, 25), median: pct(arr, 50), p75: pct(arr, 75), p90: pct(arr, 90), max: arr.length ? Math.max(...arr) : null };
}
function spearman(xs: number[], ys: number[]): { rho: number | null; n: number } {
  const n = xs.length;
  if (n < 3) return { rho: null, n };
  const rank = (vals: number[]) => {
    const idx = vals.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
    const ranks = new Array(vals.length).fill(0);
    let i = 0;
    while (i < idx.length) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const avgRank = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) ranks[idx[k][1]] = avgRank;
      i = j + 1;
    }
    return ranks;
  };
  const rx = rank(xs); const ry = rank(ys);
  const mx = rx.reduce((a, b) => a + b, 0) / n; const my = ry.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) { const dx = rx[i] - mx, dy = ry[i] - my; num += dx * dy; dx2 += dx * dx; dy2 += dy * dy; }
  const denom = Math.sqrt(dx2 * dy2);
  return { rho: denom === 0 ? null : num / denom, n };
}
function percentileRank(value: number, pool: number[]): number {
  const below = pool.filter((v) => v < value).length;
  const equal = pool.filter((v) => v === value).length;
  return Math.round(((below + equal / 2) / pool.length) * 1000) / 10;
}
function confidenceTier(level: number, comparisonCount: number): 'HIGH' | 'MEDIUM' | 'LOW' | 'NOT_AVAILABLE' {
  if (level === 0) return 'NOT_AVAILABLE';
  if (level === 1 && comparisonCount >= 15) return 'HIGH';
  if (level === 1 || level === 2) return 'MEDIUM';
  return 'LOW'; // level 3/4
}

interface Row {
  aptSeq: string; name: string; gu: string | null; dong: string | null;
  buildYear: number | null; totalHouseholds: number | null; pricePerM2: number | null; txCount12m: number | null;
  v2Score: number;
}

async function main() {
  const outPath = process.argv[2] || path.resolve(__dirname, 'output', 'score-v2-phase1_6-verification.json');
  const allMaster = await prisma.apartmentMaster.findMany({
    where: { sido: SIDO_VALUE, aptSeq: { not: null } },
    select: { aptSeq: true, name: true, sigungu: true, umdName: true, buildYear: true, totalHouseholds: true },
  });
  const locFeatures = await prisma.apartmentLocationFeature.findMany({ select: { aptSeq: true } });
  const locAptSeqs = new Set(locFeatures.map((r) => r.aptSeq));
  let targets = allMaster.filter((r) => locAptSeqs.has(r.aptSeq!));
  const limitArg = process.argv[3] ? parseInt(process.argv[3], 10) : null;
  if (limitArg) targets = targets.slice(0, limitArg);
  const marketFeatures = await prisma.apartmentMarketFeature.findMany({ where: { aptSeq: { in: targets.map((t) => t.aptSeq!) } } });
  const marketByAptSeq = new Map(marketFeatures.map((m) => [m.aptSeq, m]));

  console.log(`대상: ${targets.length}건`);
  const rows: Row[] = [];
  let i = 0;
  for (const t of targets) {
    i++;
    if (i % 400 === 0) console.log(`  ...${i}/${targets.length}`);
    const r: any = await calculateApartmentScore(t.aptSeq!);
    const v2 = r._shadowV2;
    if (!v2 || v2.eligibility === 'NOT_ENOUGH_DATA' || v2.overallScore == null) continue;
    const mk = marketByAptSeq.get(t.aptSeq!);
    rows.push({
      aptSeq: t.aptSeq!, name: t.name, gu: t.sigungu, dong: t.umdName,
      buildYear: t.buildYear, totalHouseholds: t.totalHouseholds,
      pricePerM2: mk?.medianPricePerM2_12m ?? null, txCount12m: mk?.transactionCount12m ?? null,
      v2Score: Math.round(v2.overallScore),
    });
  }
  console.log(`\nV2 scoreable: ${rows.length}건 (SCOREABLE_POOL_SIZE — pools below are built only from this set)`);

  const report: any = { generatedAt: new Date().toISOString(), scoreablePoolSize: rows.length };

  // ═══ §8 SIZE BANDS — record exact thresholds actually used (data-driven tertiles, same method as Phase 1.5) ═══
  const householdsKnown = rows.filter((r) => r.totalHouseholds != null).map((r) => r.totalHouseholds!);
  const sizeT1 = pct(householdsKnown, 33) ?? 100;
  const sizeT2 = pct(householdsKnown, 67) ?? 400;
  const sizeBandTertile = (h: number | null): string => (h == null ? 'UNKNOWN' : h < sizeT1 ? 'small' : h < sizeT2 ? 'mid' : 'large');
  report.sizeBandDefinition_tertile = {
    small: { lower: 0, upper: sizeT1 - 1, count: rows.filter((r) => r.totalHouseholds != null && r.totalHouseholds < sizeT1).length },
    mid: { lower: sizeT1, upper: sizeT2 - 1, count: rows.filter((r) => r.totalHouseholds != null && r.totalHouseholds >= sizeT1 && r.totalHouseholds < sizeT2).length },
    large: { lower: sizeT2, upper: null, count: rows.filter((r) => r.totalHouseholds != null && r.totalHouseholds >= sizeT2).length },
    unknown: { count: rows.filter((r) => r.totalHouseholds == null).length },
  };

  const decadeOf = (y: number | null) => (y != null ? `${Math.floor(y / 10) * 10}s` : 'NA');

  // generic hierarchical-model runner, parameterized by the size-band function, so we can compare
  // the recommended tertile bands against 2 alternatives without duplicating logic (§9).
  function buildModel(sizeBandFn: (h: number | null) => string) {
    const l1Pools = new Map<string, number[]>();
    const l2Pools = new Map<string, number[]>();
    const l3Pools = new Map<string, number[]>();
    const allScores = rows.map((r) => r.v2Score);
    const l1Key = (r: Row) => `${r.gu || 'NA'}|${decadeOf(r.buildYear)}|${sizeBandFn(r.totalHouseholds)}`;
    const l2Key = (r: Row) => `${r.gu || 'NA'}|${decadeOf(r.buildYear)}`;
    const l3Key = (r: Row) => `${decadeOf(r.buildYear)}`;
    rows.forEach((r) => {
      const k1 = l1Key(r); (l1Pools.get(k1) || l1Pools.set(k1, []).get(k1)!).push(r.v2Score);
      const k2 = l2Key(r); (l2Pools.get(k2) || l2Pools.set(k2, []).get(k2)!).push(r.v2Score);
      const k3 = l3Key(r); (l3Pools.get(k3) || l3Pools.set(k3, []).get(k3)!).push(r.v2Score);
    });

    function runAt(minSample: number) {
      const perApt = new Map<string, { level: number; comparisonCount: number; percentile: number | null; peerKey: string }>();
      rows.forEach((r) => {
        const l1Pool = l1Pools.get(l1Key(r))!;
        const l2Pool = l2Pools.get(l2Key(r))!;
        const l3Pool = l3Pools.get(l3Key(r))!;
        let level: number, pool: number[], peerKey: string;
        if (l1Pool.length >= minSample) { level = 1; pool = l1Pool; peerKey = l1Key(r); }
        else if (l2Pool.length >= minSample) { level = 2; pool = l2Pool; peerKey = l2Key(r); }
        else if (l3Pool.length >= minSample) { level = 3; pool = l3Pool; peerKey = l3Key(r); }
        else if (allScores.length >= minSample) { level = 4; pool = allScores; peerKey = 'BUSAN_ALL'; }
        else { level = 0; pool = []; peerKey = 'NOT_AVAILABLE'; }
        perApt.set(r.aptSeq, { level, comparisonCount: pool.length, percentile: level > 0 ? percentileRank(r.v2Score, pool) : null, peerKey });
      });

      // CORRECTED aggregate: distribution of comparisonCount, filtered to apartments actually AT that level.
      const byLevel = (lv: number) => rows.filter((r) => perApt.get(r.aptSeq)!.level === lv).map((r) => perApt.get(r.aptSeq)!.comparisonCount);
      const levelCounts: Record<string, number> = {};
      perApt.forEach((v) => { levelCounts[`L${v.level}`] = (levelCounts[`L${v.level}`] || 0) + 1; });

      const denomBuckets = { lt5: 0, lt8: 0, b8_9: 0, b10_14: 0, b15_19: 0, ge20: 0 };
      perApt.forEach((v) => {
        if (v.level === 0) return;
        const c = v.comparisonCount;
        if (c < 5) denomBuckets.lt5++;
        else if (c < 8) denomBuckets.lt8++;
        else if (c <= 9) denomBuckets.b8_9++;
        else if (c <= 14) denomBuckets.b10_14++;
        else if (c <= 19) denomBuckets.b15_19++;
        else denomBuckets.ge20++;
      });

      const withPrice = rows.filter((r) => r.pricePerM2 != null && (r.txCount12m ?? 0) >= 1 && perApt.get(r.aptSeq)!.percentile != null);
      const priceCorr = spearman(withPrice.map((r) => r.pricePerM2!), withPrice.map((r) => perApt.get(r.aptSeq)!.percentile!));
      const byBuildYear = rows.filter((r) => r.buildYear != null && perApt.get(r.aptSeq)!.percentile != null);
      const buildYearCorr = spearman(byBuildYear.map((r) => r.buildYear!), byBuildYear.map((r) => perApt.get(r.aptSeq)!.percentile!));
      const byHouseholds = rows.filter((r) => r.totalHouseholds != null && perApt.get(r.aptSeq)!.percentile != null);
      const householdsCorr = spearman(byHouseholds.map((r) => r.totalHouseholds!), byHouseholds.map((r) => perApt.get(r.aptSeq)!.percentile!));

      return {
        minSample,
        levelCounts,
        levelCountsPct: Object.fromEntries(Object.entries(levelCounts).map(([k, v]) => [k, Math.round((v / rows.length) * 1000) / 10])),
        // CORRECTED: comparisonCount distribution PER ASSIGNED LEVEL (never the raw unconditional map).
        comparisonCountByLevel: { L1: distSummary(byLevel(1)), L2: distSummary(byLevel(2)), L3: distSummary(byLevel(3)), L4: distSummary(byLevel(4)) },
        denominatorBuckets: denomBuckets,
        bias: { price: priceCorr, buildYear: buildYearCorr, households: householdsCorr },
        perApt, // kept in-memory only for sample audit below, not serialized directly
      };
    }

    return { l1Pools, l2Pools, l3Pools, runAt };
  }

  // ═══ §3/§4/§7 — corrected MIN_SAMPLE sweep for the RECOMMENDED (tertile) size bands ═══
  const tertileModel = buildModel(sizeBandTertile);
  const sweepResults = [8, 10, 15, 20].map((m) => tertileModel.runAt(m));
  report.correctedMinSampleSweep = sweepResults.map((r) => ({ minSample: r.minSample, levelCounts: r.levelCounts, levelCountsPct: r.levelCountsPct, comparisonCountByLevel: r.comparisonCountByLevel, denominatorBuckets: r.denominatorBuckets, bias: r.bias }));

  // proof artifact: also keep the OLD (buggy) unconditional stat side-by-side for the doc to show the contrast directly.
  report.oldBuggyStat_forComparison = {
    note: 'This is Phase 1.5\'s original l1PoolSizing computation — unconditional over ALL raw L1 groups, identical regardless of minSample. Kept here only to prove the contrast against correctedMinSampleSweep above.',
    rawL1GroupSizeDistribution_allGroups: distSummary([...tertileModel.l1Pools.values()].map((p) => p.length)),
  };

  // ═══ §9 — size-band boundary sensitivity: 2 alternatives ═══
  // Alt 1: quartile-based 4 bands (xs/small/mid/large via p25/p50/p75)
  const q1 = pct(householdsKnown, 25) ?? 60;
  const q2 = pct(householdsKnown, 50) ?? 150;
  const q3 = pct(householdsKnown, 75) ?? 350;
  const sizeBandQuartile = (h: number | null): string => (h == null ? 'UNKNOWN' : h < q1 ? 'xs' : h < q2 ? 'small' : h < q3 ? 'mid' : 'large');
  // Alt 2: fixed round-number bands (a PM-intuitive, non-data-driven scheme)
  const sizeBandFixed = (h: number | null): string => (h == null ? 'UNKNOWN' : h < 100 ? 'small' : h < 500 ? 'mid' : 'large');

  const quartileModel = buildModel(sizeBandQuartile);
  const fixedModel = buildModel(sizeBandFixed);
  const MS = 8;
  const quartileAt8 = quartileModel.runAt(MS);
  const fixedAt8 = fixedModel.runAt(MS);
  const tertileAt8 = sweepResults.find((r) => r.minSample === MS)!;

  function rankStabilityBetween(modelA: ReturnType<typeof buildModel>, modelB: ReturnType<typeof buildModel>) {
    const a = modelA.runAt(MS); const b = modelB.runAt(MS);
    const common = rows.filter((r) => a.perApt.get(r.aptSeq)!.percentile != null && b.perApt.get(r.aptSeq)!.percentile != null);
    return spearman(common.map((r) => a.perApt.get(r.aptSeq)!.percentile!), common.map((r) => b.perApt.get(r.aptSeq)!.percentile!));
  }

  report.sizeBandSensitivity = {
    tertile_recommended: { thresholds: { t1: sizeT1, t2: sizeT2 }, levelCountsPct: tertileAt8.levelCountsPct, bias: tertileAt8.bias },
    alt1_quartile: { thresholds: { q1, q2, q3 }, levelCountsPct: quartileAt8.levelCountsPct, bias: quartileAt8.bias },
    alt2_fixedRoundNumbers: { thresholds: { t1: 100, t2: 500 }, levelCountsPct: fixedAt8.levelCountsPct, bias: fixedAt8.bias },
    rankingStability_tertile_vs_quartile: rankStabilityBetween(tertileModel, quartileModel),
    rankingStability_tertile_vs_fixed: rankStabilityBetween(tertileModel, fixedModel),
  };

  // ═══ §10 — boundary fairness: apartments straddling the tertile thresholds (50, 221) ═══
  const boundarySamples = rows
    .filter((r) => r.totalHouseholds != null && ((r.totalHouseholds >= sizeT1 - 10 && r.totalHouseholds <= sizeT1 + 10) || (r.totalHouseholds >= sizeT2 - 15 && r.totalHouseholds <= sizeT2 + 15)))
    .slice(0, 20);
  const finalRun = tertileModel.runAt(8);
  report.boundaryFairnessSample = boundarySamples.map((r) => {
    const info = finalRun.perApt.get(r.aptSeq)!;
    return { aptSeq: r.aptSeq, name: r.name, gu: r.gu, totalHouseholds: r.totalHouseholds, sizeBand: sizeBandTertile(r.totalHouseholds), buildYear: r.buildYear, v2Score: r.v2Score, level: info.level, comparisonCount: info.comparisonCount, percentile: info.percentile, peerKey: info.peerKey, confidence: confidenceTier(info.level, info.comparisonCount) };
  });

  // ═══ §17 — full sample audit: top10/middle10/bottom10 + boundary already above ═══
  const sortedByScore = [...rows].sort((a, b) => a.v2Score - b.v2Score);
  const withDetail = (r: Row) => {
    const info = finalRun.perApt.get(r.aptSeq)!;
    return { aptSeq: r.aptSeq, name: r.name, gu: r.gu, totalHouseholds: r.totalHouseholds, sizeBand: sizeBandTertile(r.totalHouseholds), buildYear: r.buildYear, v2Score: r.v2Score, level: info.level, comparisonCount: info.comparisonCount, peerCountExcludingSelf: info.comparisonCount - 1, percentile: info.percentile, peerKey: info.peerKey, confidence: confidenceTier(info.level, info.comparisonCount) };
  };
  report.sampleAudit = {
    bottom10: sortedByScore.slice(0, 10).map(withDetail),
    middle10: sortedByScore.slice(Math.floor(sortedByScore.length / 2) - 5, Math.floor(sortedByScore.length / 2) + 5).map(withDetail),
    top10: [...sortedByScore].reverse().slice(0, 10).map(withDetail),
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\n저장 완료: ${outPath}`);
  console.log('\n=== PROOF: old buggy stat (unconditional) ===', JSON.stringify(report.oldBuggyStat_forComparison.rawL1GroupSizeDistribution_allGroups));
  console.log('\n=== CORRECTED comparisonCountByLevel @ minSample=8 ===', JSON.stringify(report.correctedMinSampleSweep.find((s: any) => s.minSample === 8).comparisonCountByLevel));
  console.log('\n=== denominatorBuckets @ minSample=8 ===', JSON.stringify(report.correctedMinSampleSweep.find((s: any) => s.minSample === 8).denominatorBuckets));
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
