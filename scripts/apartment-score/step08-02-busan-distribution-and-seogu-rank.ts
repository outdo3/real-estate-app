/**
 * E-JIP SCORE V2 STEP 0.8 §7,8,9,10 — quality-filtered(transportPeerEligible) 부산 전체
 * nearest subway distance 절대 분포/percentile, 서구 전체 순위, 서대신/동대신 combined
 * dong 감사. READ-ONLY, production 미변경 — rankFeature는 production 함수 재사용.
 *
 * 사용법:
 *   npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js scripts/apartment-score/step08-02-busan-distribution-and-seogu-rank.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { loadBusanDataset, guNameForSggCd } from './lib/shadow-score';
import { rankFeature, type FeatureRow } from '@/lib/apartment-score/server/percentile';

const TARGETS = [
  { label: '대신해모로센트럴아파트', aptSeq: '26140-1356' },
  { label: '협성르네상스(서구)', aptSeq: '26140-51' },
];

function percentileOf(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return NaN;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.round((p / 100) * (sortedAsc.length - 1))));
  return sortedAsc[idx];
}

function busanRankPercentile(distance: number, population: { aptSeq: string; value: number }[]): { rank: number; total: number; percentile: number } {
  // "짧을수록 좋음" 방향 percentile: 나보다 먼(=더 나쁜) 것의 비율. rankFeature와
  // 동일 tie-aware 평균순위 방식을 그대로 적용(같은 알고리즘, 다른 모집단일 뿐).
  const rows: FeatureRow[] = population.map((p) => ({ aptSeq: p.aptSeq, value: p.value, isComplete: true }));
  // 대상이 population에 없으면 임시로 추가해 동일 tie-aware 계산에 포함시킨다.
  if (!rows.some((r) => r.value === distance)) rows.push({ aptSeq: '__PROBE__', value: distance, isComplete: true });
  const ranked = rankFeature(rows, 'nearestSubwayDistanceM', 'lowerIsBetter', true);
  const probeAptSeq = population.find((p) => p.value === distance)?.aptSeq ?? '__PROBE__';
  const r = ranked.get(probeAptSeq)!;
  const sorted = [...population].sort((a, b) => a.value - b.value);
  const rank = sorted.filter((p) => p.value <= distance).length;
  return { rank, total: sorted.length, percentile: r.percentile ?? NaN };
}

async function main() {
  const ds = await loadBusanDataset();

  const coordOk = ds.masters.filter((m) => ds.qualityByAptSeq.get(m.aptSeq)?.transportPeerEligible === true);
  const withDistance = coordOk
    .map((m) => ({ aptSeq: m.aptSeq, name: m.name, sggCd: m.sggCd, umdName: m.umdName, value: ds.locationByAptSeq.get(m.aptSeq)?.nearestSubwayDistanceM ?? null }))
    .filter((r): r is { aptSeq: string; name: string; sggCd: string | null; umdName: string | null; value: number } => r.value != null);
  const confirmedAbsent = coordOk.filter((m) => {
    const loc = ds.locationByAptSeq.get(m.aptSeq);
    return loc && loc.qualityFlag === 'complete' && loc.nearestSubwayDistanceM == null;
  }).length;

  console.log(`[§7] transportPeerEligible(coordOk) 부산 전체 = ${coordOk.length}건`);
  console.log(`  nearestSubwayDistanceM 실값 보유 = ${withDistance.length}건`);
  console.log(`  confirmed-absent(반경 내 지하철 없음, qualityFlag=complete+null) = ${confirmedAbsent}건`);
  console.log(`  (그 외 미수집/누락 = ${coordOk.length - withDistance.length - confirmedAbsent}건)`);

  const sortedValues = withDistance.map((r) => r.value).sort((a, b) => a - b);
  const pctPoints = [1, 5, 10, 25, 50, 75, 90, 95];
  console.log('\n[§7] Busan-wide nearestSubwayDistanceM 분포(quality-filtered, m):');
  console.log(`  min=${sortedValues[0]}`);
  for (const p of pctPoints) console.log(`  p${p}=${percentileOf(sortedValues, p)}`);
  console.log(`  max=${sortedValues[sortedValues.length - 1]}`);

  const buckets = [
    { label: '<=100m', test: (v: number) => v <= 100 },
    { label: '101~200m', test: (v: number) => v > 100 && v <= 200 },
    { label: '201~300m', test: (v: number) => v > 200 && v <= 300 },
    { label: '301~500m', test: (v: number) => v > 300 && v <= 500 },
    { label: '501~800m', test: (v: number) => v > 500 && v <= 800 },
    { label: '801~1200m', test: (v: number) => v > 800 && v <= 1200 },
    { label: '>1200m', test: (v: number) => v > 1200 },
  ];
  console.log('\n[§7] distance bucket counts:');
  for (const b of buckets) {
    const c = sortedValues.filter(b.test).length;
    console.log(`  ${b.label}: ${c} (${(100 * c / sortedValues.length).toFixed(1)}%)`);
  }

  // §8 Busan-wide / sigungu absolute percentile for the two benchmarks
  console.log('\n[§8] Busan-wide / SIGUNGU absolute percentile:');
  const busanResults: Record<string, unknown> = {};
  for (const t of TARGETS) {
    const m = ds.masterByAptSeq.get(t.aptSeq)!;
    const dist = ds.locationByAptSeq.get(t.aptSeq)?.nearestSubwayDistanceM ?? null;
    if (dist == null) { console.log(`  ${t.label}: distance null, skip`); continue; }
    const busan = busanRankPercentile(dist, withDistance);
    const sgu = withDistance.filter((r) => r.sggCd === m.sggCd);
    const sguRank = busanRankPercentile(dist, sgu);
    console.log(`  ${t.label} (${dist}m): BUSAN rank ${busan.rank}/${busan.total} percentile=${busan.percentile.toFixed(1)}  |  SIGUNGU(${guNameForSggCd(m.sggCd)}) rank ${sguRank.rank}/${sguRank.total} percentile=${sguRank.percentile.toFixed(1)}`);
    busanResults[t.label] = { aptSeq: t.aptSeq, distance: dist, busan, sigungu: sguRank };
  }

  // §9 서구 전체 transport-eligible 단지 순위(오름차순), TOP 30
  const seogu = withDistance.filter((r) => r.sggCd === '26140').sort((a, b) => a.value - b.value);
  console.log(`\n[§9] 서구 transport-eligible 전체 = ${seogu.length}건, TOP 30(지하철 거리 오름차순):`);
  seogu.slice(0, 30).forEach((r, i) => {
    const marker = TARGETS.some((t) => t.aptSeq === r.aptSeq) ? '  <== BENCHMARK' : '';
    console.log(`  ${i + 1}. ${r.value}m | ${r.name} | ${r.umdName}${marker}`);
  });
  for (const t of TARGETS) {
    const idx = seogu.findIndex((r) => r.aptSeq === t.aptSeq);
    console.log(`  ${t.label} 서구 전체 순위: ${idx + 1}/${seogu.length}`);
  }

  // §10 서대신동+동대신동 combined dong audit (실제 DB naming 확인)
  const relevantDongs = [...new Set(ds.masters.filter((m) => m.sggCd === '26140' && m.umdName && (m.umdName.startsWith('서대신동') || m.umdName.startsWith('동대신동'))).map((m) => m.umdName as string))].sort();
  console.log(`\n[§10] 서구 내 실제 DB umdName (서대신동/동대신동 계열): ${JSON.stringify(relevantDongs)}`);

  const combined = withDistance.filter((r) => r.sggCd === '26140' && r.umdName && relevantDongs.includes(r.umdName)).sort((a, b) => a.value - b.value);
  console.log(`\n[§10] 서대신동+동대신동 전체 combined transport-eligible = ${combined.length}건(지하철 거리 오름차순, READ-ONLY 비교용 — production peer rule 아님):`);
  combined.forEach((r, i) => {
    const marker = TARGETS.some((t) => t.aptSeq === r.aptSeq) ? '  <== BENCHMARK' : '';
    console.log(`  ${i + 1}. ${r.value}m | ${r.name} | ${r.umdName}${marker}`);
  });
  for (const t of TARGETS) {
    const idx = combined.findIndex((r) => r.aptSeq === t.aptSeq);
    console.log(`  ${t.label} combined(서대신+동대신) 순위: ${idx + 1}/${combined.length}`);
  }

  const outDir = path.resolve(__dirname, 'output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.resolve(outDir, 'step08-busan-distribution.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    coordOkCount: coordOk.length, withDistanceCount: withDistance.length, confirmedAbsent,
    distribution: { min: sortedValues[0], max: sortedValues[sortedValues.length - 1], percentiles: Object.fromEntries(pctPoints.map((p) => [`p${p}`, percentileOf(sortedValues, p)])) },
    buckets: buckets.map((b) => ({ label: b.label, count: sortedValues.filter(b.test).length })),
    busanResults,
    seoguTop30: seogu.slice(0, 30),
    seoguTotal: seogu.length,
    relevantDongs,
    combinedRanking: combined,
  }, null, 1));
  console.log('\n[saved] scripts/apartment-score/output/step08-busan-distribution.json');

  const { prisma } = await import('@/lib/prisma');
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
