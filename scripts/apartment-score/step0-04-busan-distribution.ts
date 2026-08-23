// E-JIP SCORE V2 STEP 0 §21-24 — 부산 전역 Score/subscore distribution +
// district bias + simple correlation. READ-ONLY, calculateApartmentScore() 재사용.
import { prisma } from '../../src/lib/prisma';
import { calculateApartmentScore } from '../../src/lib/apartment-score/server/calculate';

interface Row {
  aptSeq: string; sigungu: string | null; buildYear: number | null;
  totalHouseholds: number | null; parkingCount: number | null;
  score: number | null; transport: number | null; living: number | null;
  parking: number | null; complex: number | null; school: number | null;
}

function stats(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { n: values.length, mean: +mean.toFixed(1), median: +median.toFixed(1), p10: pct(10), p25: pct(25), p75: pct(75), p90: pct(90), min: sorted[0], max: sorted[sorted.length - 1] };
}

// 단순 Pearson correlation, x/y 둘 다 non-null인 쌍만.
function correlation(pairs: [number, number][]): number | null {
  if (pairs.length < 3) return null;
  const n = pairs.length;
  const mx = pairs.reduce((s, [x]) => s + x, 0) / n;
  const my = pairs.reduce((s, [, y]) => s + y, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (const [x, y] of pairs) { const dx = x - mx, dy = y - my; num += dx * dy; dx2 += dx * dx; dy2 += dy * dy; }
  if (dx2 === 0 || dy2 === 0) return null;
  return +(num / Math.sqrt(dx2 * dy2)).toFixed(3);
}

async function main() {
  const all = await prisma.apartmentMaster.findMany({
    where: { aptSeq: { not: null } },
    select: { aptSeq: true, sigungu: true, buildYear: true, totalHouseholds: true, parkingCount: true },
  });
  console.error(`부산 ApartmentMaster: ${all.length}건. Score 계산 중(오래 걸림)...`);

  const rows: Row[] = [];
  let i = 0;
  for (const apt of all) {
    i++;
    if (i % 200 === 0) console.error(`  ${i}/${all.length}...`);
    const r = await calculateApartmentScore(apt.aptSeq!);
    const cat = (key: string) => r.categories.find((c: any) => c.key === key)?.score ?? null;
    rows.push({
      aptSeq: apt.aptSeq!, sigungu: apt.sigungu, buildYear: apt.buildYear,
      totalHouseholds: apt.totalHouseholds, parkingCount: apt.parkingCount,
      score: r.score, transport: cat('transport'), living: cat('living'),
      parking: cat('parking'), complex: cat('complex'), school: cat('schoolAccess'),
    });
  }

  const ok = rows.filter((r) => r.score != null);
  console.log(`\n=== 전체 ===`);
  console.log(`OK: ${ok.length} / ${rows.length}`);

  console.log('\n=== TOTAL SCORE distribution(부산 전체) ===');
  console.log(JSON.stringify(stats(ok.map((r) => r.score!))));

  for (const [label, key] of [['transport', 'transport'], ['living', 'living'], ['parking', 'parking'], ['complex', 'complex'], ['school', 'school']] as const) {
    const vals = ok.map((r) => (r as any)[key]).filter((v): v is number => v != null);
    const s = stats(vals);
    const below10 = vals.filter((v) => v <= 10).length;
    const above90 = vals.filter((v) => v >= 90).length;
    console.log(`\n=== ${label} subscore distribution (n=${vals.length}/${ok.length}, coverage=${(vals.length / ok.length * 100).toFixed(1)}%) ===`);
    console.log(JSON.stringify(s), `| <=10점: ${below10}건(${(below10 / vals.length * 100).toFixed(1)}%) | >=90점: ${above90}건(${(above90 / vals.length * 100).toFixed(1)}%)`);
  }

  console.log('\n=== 구·군별 TOTAL SCORE ===');
  const districts = [...new Set(ok.map((r) => r.sigungu).filter(Boolean))] as string[];
  for (const d of districts.sort()) {
    const vals = ok.filter((r) => r.sigungu === d).map((r) => r.score!);
    console.log(`${d.padEnd(6)}: ${JSON.stringify(stats(vals))}`);
  }

  console.log('\n=== correlation(단순 Pearson, n>=3인 것만) ===');
  const buildYearPairs = ok.filter((r) => r.buildYear != null).map((r) => [r.buildYear!, r.score!] as [number, number]);
  console.log('buildYear vs totalScore:', correlation(buildYearPairs), `(n=${buildYearPairs.length})`);
  const householdsPairs = ok.filter((r) => r.totalHouseholds != null).map((r) => [r.totalHouseholds!, r.score!] as [number, number]);
  console.log('totalHouseholds vs totalScore:', correlation(householdsPairs), `(n=${householdsPairs.length})`);
  const buildYearComplexPairs = ok.filter((r) => r.buildYear != null && r.complex != null).map((r) => [r.buildYear!, r.complex!] as [number, number]);
  console.log('buildYear vs complexScore:', correlation(buildYearComplexPairs), `(n=${buildYearComplexPairs.length})`);
  const parkingRatioPairs = ok.filter((r) => r.parkingCount != null && r.totalHouseholds && r.parking != null)
    .map((r) => [r.parkingCount! / r.totalHouseholds!, r.parking!] as [number, number]);
  console.log('parkingPerHousehold(raw) vs parkingScore:', correlation(parkingRatioPairs), `(n=${parkingRatioPairs.length})`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
