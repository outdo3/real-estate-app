/**
 * E-JIP SCORE V2 — PHASE 1 audit support script. READ-ONLY — no writes, no
 * schema changes. Runs calculateApartmentScore() (which internally also
 * computes calculateScoreV2 and attaches it as _shadowV2, exactly what
 * production actually shows users) across the full Busan apartment universe
 * that has ApartmentLocationFeature coverage, then:
 *   - computes V2 overallScore distribution stats (overall + per stratum)
 *   - checks price/build-year/household-count bias via Spearman correlation
 *   - computes two post-hoc alternative rankings from the SAME raw V2 domain
 *     scores already computed (no new formula implemented in production):
 *       Model B: Busan-wide percentile rank of V2 overallScore
 *       Model C: peer-group (sigungu + build-year decade) percentile rank
 *   - Spearman(Model A rank, Model B rank) and Spearman(Model A, Model C) for
 *     ranking-stability comparison
 *   - dumps bottom/middle/top 20 samples (by V2 overallScore) with per-domain
 *     breakdown for resident-backlash review
 *
 * 사용법:
 *   npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js scripts/apartment-score/ejip-score-v2-phase1-analysis.ts <output.json>
 */
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { prisma } from '@/lib/prisma';
import { calculateApartmentScore } from '@/lib/apartment-score/server/calculate';

const SIDO_VALUE = '부산';

const NAMED_REGIONS: Record<string, string> = {
  '해운대구': '26350',
  '서구': '26140',
  '동래구': '26260',
  '부산진구': '26230',
  '기장군': '26710',
};

function pct(arr: number[], p: number): number | null {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))));
  return s[idx];
}
function mean(arr: number[]): number | null {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
}
function std(arr: number[]): number | null {
  if (arr.length < 2) return null;
  const m = mean(arr)!;
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}
function distSummary(arr: number[]) {
  return {
    n: arr.length,
    min: arr.length ? Math.min(...arr) : null,
    p10: pct(arr, 10),
    p25: pct(arr, 25),
    median: pct(arr, 50),
    p75: pct(arr, 75),
    p90: pct(arr, 90),
    max: arr.length ? Math.max(...arr) : null,
    mean: mean(arr) != null ? Math.round(mean(arr)! * 10) / 10 : null,
    std: std(arr) != null ? Math.round(std(arr)! * 10) / 10 : null,
  };
}
// Spearman rank correlation, ties averaged.
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
  return Math.round(((below + equal / 2) / pool.length) * 1000) / 10; // 0-100, 1 decimal
}

interface Row {
  aptSeq: string;
  name: string;
  gu: string | null;
  dong: string | null;
  buildYear: number | null;
  totalHouseholds: number | null;
  pricePerM2: number | null; // medianPricePerM2_12m
  txCount12m: number | null;
  v2Status: string; // eligibility or 'NONE'
  v2Score: number | null;
  domains: { transport: number | null; living: number | null; education: number | null; complex: number | null };
}

async function main() {
  const outPath = process.argv[2] || path.resolve(__dirname, 'output', 'score-v2-phase1-analysis.json');

  const allMaster = await prisma.apartmentMaster.findMany({
    where: { sido: SIDO_VALUE, aptSeq: { not: null } },
    select: { aptSeq: true, name: true, sigungu: true, umdName: true, buildYear: true, totalHouseholds: true },
  });
  const locFeatures = await prisma.apartmentLocationFeature.findMany({ select: { aptSeq: true } });
  const locAptSeqs = new Set(locFeatures.map((r) => r.aptSeq));
  let targets = allMaster.filter((r) => locAptSeqs.has(r.aptSeq!));
  const limitArg = process.argv[3] ? parseInt(process.argv[3], 10) : null;
  if (limitArg) targets = targets.slice(0, limitArg);
  const marketFeatures = await prisma.apartmentMarketFeature.findMany({
    where: { aptSeq: { in: targets.map((t) => t.aptSeq!) } },
  });
  const marketByAptSeq = new Map(marketFeatures.map((m) => [m.aptSeq, m]));

  console.log(`대상(Busan, location-feature 보유): ${targets.length}건`);

  const rows: Row[] = [];
  let i = 0;
  for (const t of targets) {
    i++;
    if (i % 200 === 0) console.log(`  ...${i}/${targets.length}`);
    const r: any = await calculateApartmentScore(t.aptSeq!);
    const v2 = r._shadowV2;
    const mk = marketByAptSeq.get(t.aptSeq!);
    const domainScore = (key: string) => (v2?.domains?.[key]?.score != null ? Math.round(v2.domains[key].score) : null);
    rows.push({
      aptSeq: t.aptSeq!,
      name: t.name,
      gu: t.sigungu,
      dong: t.umdName,
      buildYear: t.buildYear,
      totalHouseholds: t.totalHouseholds,
      pricePerM2: mk?.medianPricePerM2_12m ?? null,
      txCount12m: mk?.transactionCount12m ?? null,
      v2Status: v2?.eligibility ?? (r.status === 'OK' ? 'V2_ABSENT' : r.status),
      v2Score: v2?.eligibility === 'NOT_ENOUGH_DATA' ? null : (v2?.overallScore != null ? Math.round(v2.overallScore) : null),
      domains: {
        transport: domainScore('transport'),
        living: domainScore('living'),
        education: domainScore('education'),
        complex: domainScore('complex'),
      },
    });
  }

  const scored = rows.filter((r) => r.v2Score != null) as (Row & { v2Score: number })[];
  console.log(`\n총 ${rows.length}건 중 V2 score 산정 가능: ${scored.length}건`);

  // ---- §8 Distribution: overall + named regions + build-era + complex-size + price-tier ----
  const report: any = { generatedAt: new Date().toISOString(), totalUniverse: rows.length, scoredCount: scored.length };
  report.distribution = { overall: distSummary(scored.map((r) => r.v2Score)) };

  for (const [label, lawdCd] of Object.entries(NAMED_REGIONS)) {
    const inRegion = scored.filter((r) => r.aptSeq.startsWith(lawdCd));
    report.distribution[label] = distSummary(inRegion.map((r) => r.v2Score));
  }

  const newBuild = scored.filter((r) => r.buildYear != null && r.buildYear >= 2015);
  const oldBuild = scored.filter((r) => r.buildYear != null && r.buildYear < 2000);
  report.distribution['신축(2015+)'] = distSummary(newBuild.map((r) => r.v2Score));
  report.distribution['구축(2000미만)'] = distSummary(oldBuild.map((r) => r.v2Score));

  const withHouseholds = scored.filter((r) => r.totalHouseholds != null);
  const householdsSorted = [...withHouseholds].sort((a, b) => (a.totalHouseholds! - b.totalHouseholds!));
  const largeThreshold = pct(householdsSorted.map((r) => r.totalHouseholds!), 75) ?? 1000;
  const smallThreshold = pct(householdsSorted.map((r) => r.totalHouseholds!), 25) ?? 200;
  const largeComplex = withHouseholds.filter((r) => r.totalHouseholds! >= largeThreshold);
  const smallComplex = withHouseholds.filter((r) => r.totalHouseholds! <= smallThreshold);
  report.distribution[`대단지(>=${largeThreshold}세대,p75)`] = distSummary(largeComplex.map((r) => r.v2Score));
  report.distribution[`소단지(<=${smallThreshold}세대,p25)`] = distSummary(smallComplex.map((r) => r.v2Score));

  const withPrice = scored.filter((r) => r.pricePerM2 != null && (r.txCount12m ?? 0) >= 1);
  const priceSorted = [...withPrice].sort((a, b) => a.pricePerM2! - b.pricePerM2!);
  const highPriceThreshold = pct(priceSorted.map((r) => r.pricePerM2!), 75) ?? 0;
  const lowPriceThreshold = pct(priceSorted.map((r) => r.pricePerM2!), 25) ?? 0;
  const highPrice = withPrice.filter((r) => r.pricePerM2! >= highPriceThreshold);
  const lowPrice = withPrice.filter((r) => r.pricePerM2! <= lowPriceThreshold);
  report.distribution[`고가(평당가 상위25%,>=${highPriceThreshold})`] = distSummary(highPrice.map((r) => r.v2Score));
  report.distribution[`중저가(평당가 하위25%,<=${lowPriceThreshold})`] = distSummary(lowPrice.map((r) => r.v2Score));

  // ---- §9/§13/§14/§15 Bias: Spearman correlations ----
  report.bias = {};
  const priceCorr = spearman(withPrice.map((r) => r.pricePerM2!), withPrice.map((r) => r.v2Score));
  report.bias.priceVsScore = { rho: priceCorr.rho, n: priceCorr.n, note: 'medianPricePerM2_12m vs V2 overallScore (tx>=1)' };

  const byBuildYear = scored.filter((r) => r.buildYear != null);
  const buildYearCorr = spearman(byBuildYear.map((r) => r.buildYear!), byBuildYear.map((r) => r.v2Score));
  report.bias.buildYearVsScore = { rho: buildYearCorr.rho, n: buildYearCorr.n };

  const byHouseholds = scored.filter((r) => r.totalHouseholds != null);
  const householdsCorr = spearman(byHouseholds.map((r) => r.totalHouseholds!), byHouseholds.map((r) => r.v2Score));
  report.bias.householdsVsScore = { rho: householdsCorr.rho, n: householdsCorr.n };

  // complex-domain vs households/buildYear (double counting check: complex domain
  // score itself is DERIVED from buildYear+households+parking, so a high correlation
  // here is expected/definitional, not a bug — but overallScore correlation matters)
  const complexScored = scored.filter((r) => r.domains.complex != null && r.totalHouseholds != null);
  const complexHouseholdsCorr = spearman(complexScored.map((r) => r.totalHouseholds!), complexScored.map((r) => r.domains.complex!));
  report.bias.householdsVsComplexDomain = { rho: complexHouseholdsCorr.rho, n: complexHouseholdsCorr.n, note: 'expected-high (definitional, not double counting by itself)' };

  const transportScored = scored.filter((r) => r.domains.transport != null);
  const transportOverallCorr = spearman(transportScored.map((r) => r.domains.transport!), transportScored.map((r) => r.v2Score));
  report.bias.transportDomainVsOverall = { rho: transportOverallCorr.rho, n: transportOverallCorr.n };
  const educationScored = scored.filter((r) => r.domains.education != null);
  const educationOverallCorr = spearman(educationScored.map((r) => r.domains.education!), educationScored.map((r) => r.v2Score));
  report.bias.educationDomainVsOverall = { rho: educationOverallCorr.rho, n: educationOverallCorr.n };
  const livingScored = scored.filter((r) => r.domains.living != null);
  const livingOverallCorr = spearman(livingScored.map((r) => r.domains.living!), livingScored.map((r) => r.v2Score));
  report.bias.livingDomainVsOverall = { rho: livingOverallCorr.rho, n: livingOverallCorr.n };
  const complexOverallCorr = spearman(complexScored.map((r) => r.domains.complex!), complexScored.map((r) => r.v2Score));
  report.bias.complexDomainVsOverall = { rho: complexOverallCorr.rho, n: complexOverallCorr.n };

  // "score clustering" check: what fraction fall in 60-70?
  const in6070 = scored.filter((r) => r.v2Score >= 60 && r.v2Score < 70).length;
  report.bias.clusterIn60to70Pct = Math.round((in6070 / scored.length) * 1000) / 10;

  // ---- Model B: Busan-wide percentile rank ----
  const allScores = scored.map((r) => r.v2Score);
  const modelB = new Map<string, number>();
  scored.forEach((r) => modelB.set(r.aptSeq, percentileRank(r.v2Score, allScores)));

  // ---- Model C: peer-group (sigungu + buildYear decade) percentile rank ----
  const peerPools = new Map<string, number[]>();
  const peerKey = (r: Row & { v2Score: number }) => `${r.gu || 'NA'}|${r.buildYear != null ? Math.floor(r.buildYear / 10) * 10 : 'NA'}`;
  scored.forEach((r) => {
    const k = peerKey(r);
    if (!peerPools.has(k)) peerPools.set(k, []);
    peerPools.get(k)!.push(r.v2Score);
  });
  const modelC = new Map<string, number>();
  const modelCPoolSize = new Map<string, number>();
  scored.forEach((r) => {
    const pool = peerPools.get(peerKey(r))!;
    modelCPoolSize.set(r.aptSeq, pool.length);
    // fall back to Busan-wide pool if peer pool too small (<8 samples)
    const effectivePool = pool.length >= 8 ? pool : allScores;
    modelC.set(r.aptSeq, percentileRank(r.v2Score, effectivePool));
  });

  // ---- §27 Ranking stability: Spearman(Model A raw score, Model B rank), (Model A, Model C rank) ----
  const modelARaw = scored.map((r) => r.v2Score);
  const modelBRank = scored.map((r) => modelB.get(r.aptSeq)!);
  const modelCRank = scored.map((r) => modelC.get(r.aptSeq)!);
  report.rankingStability = {
    'ModelA_vs_ModelB': spearman(modelARaw, modelBRank),
    'ModelA_vs_ModelC': spearman(modelARaw, modelCRank),
    'ModelB_vs_ModelC': spearman(modelBRank, modelCRank),
    note: 'Model A = current absolute V2 score; Model B = Busan-wide percentile of the SAME V2 score; Model C = sigungu+decade peer-group percentile of the SAME V2 score (post-hoc re-ranking only, no new formula run in production)',
  };
  // peer pool sizing stats for Model C feasibility
  const poolSizes = [...peerPools.values()].map((p) => p.length);
  report.modelCPeerPoolSizing = distSummary(poolSizes);
  report.modelCSmallPoolFallbackPct = Math.round((scored.filter((r) => modelCPoolSize.get(r.aptSeq)! < 8).length / scored.length) * 1000) / 10;

  // ---- §10 Resident backlash: bottom/middle/top 20 ----
  const sortedByScore = [...scored].sort((a, b) => a.v2Score - b.v2Score);
  const pickSample = (arr: typeof sortedByScore, n: number) =>
    arr.map((r) => ({
      aptSeq: r.aptSeq,
      name: r.name,
      gu: r.gu,
      dong: r.dong,
      buildYear: r.buildYear,
      totalHouseholds: r.totalHouseholds,
      pricePerM2: r.pricePerM2,
      v2Score: r.v2Score,
      modelB_percentile: modelB.get(r.aptSeq),
      modelC_percentile: modelC.get(r.aptSeq),
      domains: r.domains,
    })).slice(0, n);
  const midStart = Math.floor(sortedByScore.length / 2) - 10;
  report.residentBacklashSample = {
    bottom20: pickSample(sortedByScore, 20),
    middle20: pickSample(sortedByScore.slice(Math.max(0, midStart)), 20),
    top20: pickSample([...sortedByScore].reverse(), 20),
  };

  // ---- eligibility breakdown (missing-data severity across universe) ----
  const eligCounts: Record<string, number> = {};
  rows.forEach((r) => { eligCounts[r.v2Status] = (eligCounts[r.v2Status] || 0) + 1; });
  report.eligibilityBreakdown = eligCounts;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\n저장 완료: ${outPath}`);
  console.log('\n=== SUMMARY ===');
  console.log('eligibilityBreakdown:', report.eligibilityBreakdown);
  console.log('distribution.overall:', report.distribution.overall);
  console.log('bias:', report.bias);
  console.log('rankingStability:', report.rankingStability);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
