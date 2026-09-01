/**
 * E-JIP SCORE V2 — PHASE 1.5 peer-group trust-gate analysis. READ-ONLY, no
 * writes, no schema changes, no production score change. Reuses the same
 * calculateApartmentScore() call Phase 1 used (V2's shadow result is what's
 * actually shown to users) across the full Busan universe, then:
 *   - confirms no housing-type field exists (schema-level fact, documented
 *     in the audit doc, not re-derived here)
 *   - builds a size-band-aware hierarchical peer model (sigungu x decade x
 *     size-band -> sigungu x decade -> Busan x decade -> Busan-wide) and
 *     compares it against Phase 1's plain P1 (sigungu x decade only)
 *   - sweeps MIN_SAMPLE thresholds (8/10/15/20) for coverage/fallback-rate
 *     sensitivity
 *   - re-measures price/buildYear/household bias for both P1 and the new
 *     hierarchical model
 *   - re-locates Phase 1's exact bottom-20 apartments in the new model to
 *     show how their peer definition/percentile changes
 *
 * 사용법:
 *   npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js scripts/apartment-score/ejip-score-v2-phase1_5-peer-analysis.ts <output.json>
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
  const rx = rank(xs);
  const ry = rank(ys);
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = rx[i] - mx, dy = ry[i] - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return { rho: denom === 0 ? null : num / denom, n };
}
function percentileRank(value: number, pool: number[]): number {
  const below = pool.filter((v) => v < value).length;
  const equal = pool.filter((v) => v === value).length;
  return Math.round(((below + equal / 2) / pool.length) * 1000) / 10;
}

interface Row {
  aptSeq: string; name: string; gu: string | null; dong: string | null;
  buildYear: number | null; totalHouseholds: number | null; pricePerM2: number | null; txCount12m: number | null;
  v2Score: number;
}

// Phase 1's exact bottom-20 aptSeqs (from score-v2-phase1-analysis.json residentBacklashSample.bottom20)
const PHASE1_BOTTOM_APTSEQS = [
  '26530-48', '26200-15', '26350-297', '26350-296', '26350-295', '26230-42',
  '26350-276', '26410-341', '26140-114', '26230-43',
];

async function main() {
  const outPath = process.argv[2] || path.resolve(__dirname, 'output', 'score-v2-phase1_5-peer-analysis.json');

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
  console.log(`\nV2 scoreable: ${rows.length}건`);

  const report: any = { generatedAt: new Date().toISOString(), scoredCount: rows.length };

  // ---- size bands (tertiles over households, among rows with a known household count) ----
  const householdsKnown = rows.filter((r) => r.totalHouseholds != null).map((r) => r.totalHouseholds!);
  const sizeT1 = pct(householdsKnown, 33) ?? 100;
  const sizeT2 = pct(householdsKnown, 67) ?? 400;
  report.sizeBandThresholds = { small: `<${sizeT1}`, mid: `${sizeT1}-${sizeT2}`, large: `>=${sizeT2}` };
  const sizeBand = (h: number | null): string => {
    if (h == null) return 'UNKNOWN';
    if (h < sizeT1) return 'small';
    if (h < sizeT2) return 'mid';
    return 'large';
  };
  const decadeOf = (y: number | null) => (y != null ? `${Math.floor(y / 10) * 10}s` : 'NA');

  // ---- P1: sigungu x decade (Phase 1's model) ----
  const p1Pools = new Map<string, number[]>();
  const p1Key = (r: Row) => `${r.gu || 'NA'}|${decadeOf(r.buildYear)}`;
  rows.forEach((r) => { const k = p1Key(r); (p1Pools.get(k) || p1Pools.set(k, []).get(k)!).push(r.v2Score); });

  // ---- Hierarchical size-aware model: L1 gu+decade+size -> L2 gu+decade -> L3 decade(Busan-wide) -> L4 all ----
  const l1Pools = new Map<string, number[]>();
  const l2Pools = new Map<string, number[]>();
  const l3Pools = new Map<string, number[]>();
  const l1Key = (r: Row) => `${r.gu || 'NA'}|${decadeOf(r.buildYear)}|${sizeBand(r.totalHouseholds)}`;
  const l2Key = (r: Row) => `${r.gu || 'NA'}|${decadeOf(r.buildYear)}`;
  const l3Key = (r: Row) => `${decadeOf(r.buildYear)}`;
  rows.forEach((r) => {
    (l1Pools.get(l1Key(r)) || l1Pools.set(l1Key(r), []).get(l1Key(r))!).push(r.v2Score);
    (l2Pools.get(l2Key(r)) || l2Pools.set(l2Key(r), []).get(l2Key(r))!).push(r.v2Score);
    (l3Pools.get(l3Key(r)) || l3Pools.set(l3Key(r), []).get(l3Key(r))!).push(r.v2Score);
  });
  const allScores = rows.map((r) => r.v2Score);

  function runModel(minSample: number) {
    const p1Percentile = new Map<string, number>();
    const hierPercentile = new Map<string, number>();
    const hierLevel = new Map<string, number>();
    const hierPoolSize = new Map<string, number>();
    let notAvailable = 0;
    rows.forEach((r) => {
      // P1
      const p1Pool = p1Pools.get(p1Key(r))!;
      const p1Effective = p1Pool.length >= minSample ? p1Pool : allScores;
      p1Percentile.set(r.aptSeq, percentileRank(r.v2Score, p1Effective));

      // Hierarchical
      const l1Pool = l1Pools.get(l1Key(r))!;
      const l2Pool = l2Pools.get(l2Key(r))!;
      const l3Pool = l3Pools.get(l3Key(r))!;
      let level: number, pool: number[];
      if (l1Pool.length >= minSample) { level = 1; pool = l1Pool; }
      else if (l2Pool.length >= minSample) { level = 2; pool = l2Pool; }
      else if (l3Pool.length >= minSample) { level = 3; pool = l3Pool; }
      else if (allScores.length >= minSample) { level = 4; pool = allScores; }
      else { level = 0; pool = []; notAvailable++; }
      if (level > 0) {
        hierPercentile.set(r.aptSeq, percentileRank(r.v2Score, pool));
        hierLevel.set(r.aptSeq, level);
        hierPoolSize.set(r.aptSeq, pool.length);
      }
    });

    const levelCounts: Record<string, number> = {};
    hierLevel.forEach((lv) => { levelCounts[`L${lv}`] = (levelCounts[`L${lv}`] || 0) + 1; });

    // bias re-test (hierarchical model, this minSample)
    const withPrice = rows.filter((r) => r.pricePerM2 != null && (r.txCount12m ?? 0) >= 1 && hierPercentile.has(r.aptSeq));
    const priceCorr = spearman(withPrice.map((r) => r.pricePerM2!), withPrice.map((r) => hierPercentile.get(r.aptSeq)!));
    const byBuildYear = rows.filter((r) => r.buildYear != null && hierPercentile.has(r.aptSeq));
    const buildYearCorr = spearman(byBuildYear.map((r) => r.buildYear!), byBuildYear.map((r) => hierPercentile.get(r.aptSeq)!));
    const byHouseholds = rows.filter((r) => r.totalHouseholds != null && hierPercentile.has(r.aptSeq));
    const householdsCorr = spearman(byHouseholds.map((r) => r.totalHouseholds!), byHouseholds.map((r) => hierPercentile.get(r.aptSeq)!));

    // P1 bias for the same minSample (for direct comparison)
    const p1PriceCorr = spearman(withPrice.map((r) => r.pricePerM2!), withPrice.map((r) => p1Percentile.get(r.aptSeq)!));
    const p1BuildYearCorr = spearman(byBuildYear.map((r) => r.buildYear!), byBuildYear.map((r) => p1Percentile.get(r.aptSeq)!));
    const p1HouseholdsCorr = spearman(byHouseholds.map((r) => r.totalHouseholds!), byHouseholds.map((r) => p1Percentile.get(r.aptSeq)!));

    return {
      minSample,
      p1: { poolSizing: distSummary([...p1Pools.values()].map((p) => p.length)), fallbackRate: Math.round((rows.filter((r) => p1Pools.get(p1Key(r))!.length < minSample).length / rows.length) * 1000) / 10, bias: { price: p1PriceCorr, buildYear: p1BuildYearCorr, households: p1HouseholdsCorr } },
      hierarchical: { levelCounts, levelCountsPct: Object.fromEntries(Object.entries(levelCounts).map(([k, v]) => [k, Math.round((v / rows.length) * 1000) / 10])), notAvailable, l1PoolSizing: distSummary([...l1Pools.values()].map((p) => p.length)), bias: { price: priceCorr, buildYear: buildYearCorr, households: householdsCorr } },
      rankingStability_P1_vs_Hier: spearman(rows.filter((r) => hierPercentile.has(r.aptSeq)).map((r) => p1Percentile.get(r.aptSeq)!), rows.filter((r) => hierPercentile.has(r.aptSeq)).map((r) => hierPercentile.get(r.aptSeq)!)),
    };
  }

  report.minSampleSweep = [8, 10, 15, 20].map((m) => runModel(m));

  // ---- detailed dump for MIN_SAMPLE=8 (Phase 1's recommendation) ----
  const detail8 = (() => {
    const minSample = 8;
    const p1Percentile = new Map<string, number>();
    const hierPercentile = new Map<string, { pct: number; level: number; poolSize: number; peerKey: string }>();
    rows.forEach((r) => {
      const p1Pool = p1Pools.get(p1Key(r))!;
      p1Percentile.set(r.aptSeq, percentileRank(r.v2Score, p1Pool.length >= minSample ? p1Pool : allScores));
      const l1Pool = l1Pools.get(l1Key(r))!;
      const l2Pool = l2Pools.get(l2Key(r))!;
      const l3Pool = l3Pools.get(l3Key(r))!;
      if (l1Pool.length >= minSample) hierPercentile.set(r.aptSeq, { pct: percentileRank(r.v2Score, l1Pool), level: 1, poolSize: l1Pool.length, peerKey: l1Key(r) });
      else if (l2Pool.length >= minSample) hierPercentile.set(r.aptSeq, { pct: percentileRank(r.v2Score, l2Pool), level: 2, poolSize: l2Pool.length, peerKey: l2Key(r) });
      else if (l3Pool.length >= minSample) hierPercentile.set(r.aptSeq, { pct: percentileRank(r.v2Score, l3Pool), level: 3, poolSize: l3Pool.length, peerKey: l3Key(r) });
      else hierPercentile.set(r.aptSeq, { pct: percentileRank(r.v2Score, allScores), level: 4, poolSize: allScores.length, peerKey: 'ALL' });
    });
    return { p1Percentile, hierPercentile };
  })();

  // Phase 1 bottom-20 tracking
  report.phase1BottomTracking = PHASE1_BOTTOM_APTSEQS.map((seq) => {
    const r = rows.find((x) => x.aptSeq === seq);
    if (!r) return { aptSeq: seq, note: 'not in V2-scoreable set (may have been NOT_ENOUGH_DATA)' };
    const p1 = detail8.p1Percentile.get(seq);
    const hier = detail8.hierPercentile.get(seq);
    return { aptSeq: seq, name: r.name, gu: r.gu, buildYear: r.buildYear, totalHouseholds: r.totalHouseholds, sizeBand: sizeBand(r.totalHouseholds), v2Score: r.v2Score, p1_percentile_gu_decade: p1, hier_percentile: hier?.pct, hier_level: hier?.level, hier_poolSize: hier?.poolSize, hier_peerKey: hier?.peerKey };
  });

  // Top/middle/bottom 20 with full peer detail (MIN_SAMPLE=8)
  const sortedByScore = [...rows].sort((a, b) => a.v2Score - b.v2Score);
  const pickSample = (arr: typeof sortedByScore, n: number) => arr.slice(0, n).map((r) => {
    const p1 = detail8.p1Percentile.get(r.aptSeq);
    const hier = detail8.hierPercentile.get(r.aptSeq);
    return { aptSeq: r.aptSeq, name: r.name, gu: r.gu, buildYear: r.buildYear, totalHouseholds: r.totalHouseholds, sizeBand: sizeBand(r.totalHouseholds), v2Score: r.v2Score, p1_percentile: p1, hier_percentile: hier?.pct, hier_level: hier?.level, hier_poolSize: hier?.poolSize, hier_peerKey: hier?.peerKey };
  });
  const midStart = Math.floor(sortedByScore.length / 2) - 10;
  report.sampleDetail_minSample8 = {
    bottom20: pickSample(sortedByScore, 20),
    middle20: pickSample(sortedByScore.slice(Math.max(0, midStart)), 20),
    top20: pickSample([...sortedByScore].reverse(), 20),
  };

  // ---- tiny-peer-group percentile sensitivity illustration ----
  const exactMinPools = [...l1Pools.entries()].filter(([, p]) => p.length === 8);
  report.tinyPoolSensitivityExamples = exactMinPools.slice(0, 5).map(([key, pool]) => {
    const sorted = [...pool].sort((a, b) => b - a);
    return { peerKey: key, poolSize: pool.length, sortedScoresDesc: sorted, rank1Percentile: percentileRank(sorted[0], pool), rank2Percentile: percentileRank(sorted[1], pool) };
  });
  report.l1PoolsAtExactlyMinSample = { count8: [...l1Pools.values()].filter((p) => p.length === 8).length, totalL1Groups: l1Pools.size };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\n저장 완료: ${outPath}`);
  console.log('\n=== SUMMARY (minSample=8) ===');
  console.log(JSON.stringify(report.minSampleSweep.find((m: any) => m.minSample === 8), null, 2));
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
