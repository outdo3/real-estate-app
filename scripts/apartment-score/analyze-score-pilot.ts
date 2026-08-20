/**
 * STEP SCORE S2C — 설계 근거 확보용 read-only 실측 분석(§26~30, §45~49의 사전 조사).
 * DB에 쓰지 않는다. ApartmentMaster/ApartmentLocationFeature/ApartmentMarketFeature를
 * 조회만 해서 서구·해운대 분포/상관관계/이상치를 실측한다.
 *
 * 사용법:
 *   npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js scripts/apartment-score/analyze-score-pilot.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { prisma } from '@/lib/prisma';

const REGIONS = [
  { label: '서구', lawdCd: '26140' },
  { label: '해운대', lawdCd: '26350' },
];

function pct(arr: number[], p: number): number | null {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))));
  return s[idx];
}

function median(arr: number[]): number | null {
  return pct(arr, 50);
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

function summarize(label: string, arr: number[]) {
  if (arr.length === 0) {
    console.log(`  ${label}: n=0`);
    return;
  }
  console.log(
    `  ${label}: n=${arr.length} min=${Math.min(...arr)} p10=${pct(arr, 10)} median=${median(arr)} p90=${pct(arr, 90)} max=${Math.max(...arr)}`
  );
}

async function main() {
  for (const region of REGIONS) {
    console.log(`\n========== ${region.label} (${region.lawdCd}) ==========`);

    const masters = await prisma.apartmentMaster.findMany({
      where: { sggCd: region.lawdCd, aptSeq: { not: null } },
      select: {
        aptSeq: true,
        umdName: true,
        buildYear: true,
        totalHouseholds: true,
        parkingCount: true,
      },
    });
    const aptSeqs = masters.map((m) => m.aptSeq!).filter(Boolean);

    const locFeatures = await prisma.apartmentLocationFeature.findMany({
      where: { aptSeq: { in: aptSeqs } },
    });
    const marketFeatures = await prisma.apartmentMarketFeature.findMany({
      where: { aptSeq: { in: aptSeqs } },
    });
    const marketByAptSeq = new Map(marketFeatures.map((m) => [m.aptSeq, m]));
    const masterByAptSeq = new Map(masters.map((m) => [m.aptSeq!, m]));

    console.log(`ApartmentMaster(eligible) n=${aptSeqs.length}, LocationFeature n=${locFeatures.length}, MarketFeature n=${marketFeatures.length}`);

    // --- Coverage & distributions for core location features ---
    const dist = (key: keyof (typeof locFeatures)[number]) =>
      locFeatures.map((f) => f[key]).filter((v): v is number => typeof v === 'number');

    summarize('nearestSubwayDistanceM (non-null only)', dist('nearestSubwayDistanceM'));
    console.log(`  nearestSubwayDistanceM null count: ${locFeatures.filter((f) => f.nearestSubwayDistanceM == null).length} / ${locFeatures.length}`);
    summarize('busStopCount300m', dist('busStopCount300m'));
    summarize('hospitalCount1000m', dist('hospitalCount1000m'));
    const hosp45 = locFeatures.filter((f) => f.hospitalCount1000m === 45).length;
    console.log(`  hospitalCount1000m == 45 (cap-hit): ${hosp45}/${locFeatures.length} (${((hosp45 / locFeatures.length) * 100).toFixed(1)}%)`);
    summarize('parkCount1000m', dist('parkCount1000m'));
    summarize('beachDistanceM', dist('beachDistanceM'));

    // --- Parking per household ---
    const parkingRatios: number[] = [];
    for (const m of masters) {
      if (m.parkingCount != null && m.totalHouseholds != null && m.totalHouseholds > 0) {
        parkingRatios.push(m.parkingCount / m.totalHouseholds);
      }
    }
    summarize('parkingPerHousehold', parkingRatios);
    const lowOutlier = parkingRatios.filter((r) => r < 0.3).length;
    const highOutlier = parkingRatios.filter((r) => r > 3).length;
    console.log(`  parkingPerHousehold <0.3: ${lowOutlier}, >3: ${highOutlier} (of n=${parkingRatios.length})`);

    // --- buildYear / households distribution ---
    summarize('buildYear', masters.map((m) => m.buildYear).filter((v): v is number => typeof v === 'number'));
    summarize('totalHouseholds', masters.map((m) => m.totalHouseholds).filter((v): v is number => typeof v === 'number'));

    // --- Market: transaction count distribution ---
    const txCounts = marketFeatures.map((m) => m.transactionCount12m).filter((v): v is number => typeof v === 'number');
    summarize('transactionCount12m', txCounts);
    const tx1 = txCounts.filter((c) => c === 1).length;
    const tx3plus = txCounts.filter((c) => c >= 3).length;
    console.log(`  transactionCount12m==1: ${tx1}/${txCounts.length} (${((tx1 / txCounts.length) * 100).toFixed(1)}%), >=3: ${tx3plus}/${txCounts.length} (${((tx3plus / txCounts.length) * 100).toFixed(1)}%)`);
    summarize('medianPricePerM2_12m', marketFeatures.map((m) => m.medianPricePerM2_12m).filter((v): v is number => typeof v === 'number'));

    // --- Correlations (min transactionCount12m >= 3 to avoid single-trade noise) ---
    const pairsBeach: { x: number; y: number }[] = [];
    const pairsSubway: { x: number; y: number }[] = [];
    for (const loc of locFeatures) {
      const mk = marketByAptSeq.get(loc.aptSeq);
      if (!mk || mk.medianPricePerM2_12m == null || (mk.transactionCount12m ?? 0) < 3) continue;
      if (loc.beachDistanceM != null) pairsBeach.push({ x: loc.beachDistanceM, y: mk.medianPricePerM2_12m });
      if (loc.nearestSubwayDistanceM != null) pairsSubway.push({ x: loc.nearestSubwayDistanceM, y: mk.medianPricePerM2_12m });
    }
    const beachCorr = spearman(pairsBeach.map((p) => p.x), pairsBeach.map((p) => p.y));
    const subwayCorr = spearman(pairsSubway.map((p) => p.x), pairsSubway.map((p) => p.y));
    console.log(`  Spearman(beachDistanceM, medianPricePerM2_12m) [tx>=3]: rho=${beachCorr.rho?.toFixed(3)} n=${beachCorr.n}`);
    console.log(`  Spearman(nearestSubwayDistanceM, medianPricePerM2_12m) [tx>=3]: rho=${subwayCorr.rho?.toFixed(3)} n=${subwayCorr.n}`);

    void masterByAptSeq; // referenced for future dong-level peer group sizing
  }

  // --- Cross-region peer-group sample sizing check (sigungu + buildYear band) ---
  console.log(`\n========== Peer group sizing check (sigungu + buildYear decade band) ==========`);
  for (const region of REGIONS) {
    const masters = await prisma.apartmentMaster.findMany({
      where: { sggCd: region.lawdCd, aptSeq: { not: null } },
      select: { aptSeq: true, buildYear: true, umdName: true },
    });
    const bands = new Map<string, number>();
    for (const m of masters) {
      if (m.buildYear == null) continue;
      const band = `${Math.floor(m.buildYear / 10) * 10}s`;
      bands.set(band, (bands.get(band) ?? 0) + 1);
    }
    console.log(`${region.label} buildYear decade bands:`, Object.fromEntries(bands));

    const dongCounts = new Map<string, number>();
    for (const m of masters) {
      if (!m.umdName) continue;
      dongCounts.set(m.umdName, (dongCounts.get(m.umdName) ?? 0) + 1);
    }
    const dongSizes = [...dongCounts.values()];
    console.log(`${region.label} dong count=${dongCounts.size}, dong sample sizes: min=${Math.min(...dongSizes)} median=${median(dongSizes)} max=${Math.max(...dongSizes)}`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
