// E-JIP SCORE V2 STEP 0.7-A §20-25 — 실제 DB post-write 상태로 STEP 0.6 peer-quality
// 모델을 재계산(read-only). BEFORE 수치는 STEP 0.7 §18-23 문서에 이미 확정 기록된
// 값(같은 날 동일 DB에서 나온 실측)을 그대로 인용 — 다시 계산할 필요 없이 여기서는
// AFTER(post-write 실측)만 새로 만든다.
import fs from 'fs';
import path from 'path';

const BUSAN_GU_BY_LAWDCD: Record<string, string> = {
  '26110': '중구', '26140': '서구', '26170': '동구', '26200': '영도구',
  '26230': '부산진구', '26260': '동래구', '26290': '남구', '26320': '북구',
  '26350': '해운대구', '26380': '사하구', '26410': '금정구', '26440': '강서구',
  '26470': '연제구', '26500': '수영구', '26530': '사상구', '26710': '기장군',
};

async function main() {
  const { prisma } = await import('../../src/lib/prisma');
  const { classify } = await import('./lib/peer-quality');

  const masters = await prisma.apartmentMaster.findMany({
    where: { aptSeq: { not: null } },
    select: {
      aptSeq: true, name: true, sggCd: true, umdName: true, roadAddress: true, jibunAddress: true, mgmBldrgstPk: true,
      totalHouseholds: true, parkingCount: true, mainBuildingCount: true, buildYear: true,
      geocodeQuality: true, latitude: true, longitude: true,
    },
  });
  const market = await prisma.apartmentMarketFeature.findMany({ select: { aptSeq: true, transactionCount12m: true } });
  const txMap = new Map(market.map((m) => [m.aptSeq, m.transactionCount12m ?? 0]));

  const results = masters.map((m) => classify({
    aptSeq: m.aptSeq!, roadAddress: m.roadAddress, jibunAddress: m.jibunAddress, mgmBldrgstPk: m.mgmBldrgstPk,
    totalHouseholds: m.totalHouseholds, parkingCount: m.parkingCount, mainBuildingCount: m.mainBuildingCount,
    buildYear: m.buildYear, geocodeQuality: m.geocodeQuality, latitude: m.latitude, longitude: m.longitude,
    transactionCount12m: txMap.get(m.aptSeq!) ?? 0,
  }));

  const byPeer: Record<string, number> = {};
  for (const r of results) byPeer[r.peerEligibility] = (byPeer[r.peerEligibility] ?? 0) + 1;
  const total = results.length;
  console.log(`전체: ${total}건`);
  console.log('\n[§20] AFTER(post-write 실측) peer eligibility:');
  for (const [k, v] of Object.entries(byPeer)) console.log(`  ${k}: ${v} (${(100 * v / total).toFixed(1)}%)`);

  const domainEligible = {
    transport: results.filter((r) => r.transportPeerEligible).length,
    life: results.filter((r) => r.livePeerEligible).length,
    school: results.filter((r) => r.schoolPeerEligible).length,
    parking: results.filter((r) => r.parkingPeerEligible).length,
    complex: results.filter((r) => r.complexPeerEligible).length,
  };
  console.log('\n[§22] AFTER domain eligibility:', JSON.stringify(domainEligible, null, 1));

  // §23 구·군별 PEER_FULL%
  const masterByAptSeq = new Map(masters.map((m) => [m.aptSeq!, m]));
  const byGu = new Map<string, { total: number; full: number; coordHigh: number; registryLinked: number }>();
  for (const r of results) {
    const m = masterByAptSeq.get(r.aptSeq)!;
    const gu = BUSAN_GU_BY_LAWDCD[m.sggCd ?? ''] ?? m.sggCd ?? 'unknown';
    if (!byGu.has(gu)) byGu.set(gu, { total: 0, full: 0, coordHigh: 0, registryLinked: 0 });
    const e = byGu.get(gu)!;
    e.total++;
    if (r.peerEligibility === 'PEER_FULL') e.full++;
    if (r.coord === 'COORD_HIGH') e.coordHigh++;
    if (r.registryLinked) e.registryLinked++;
  }
  console.log('\n[§23] 구·군별 PEER_FULL% (AFTER):');
  const guRows = [...byGu.entries()].map(([gu, e]) => ({ gu, total: e.total, fullPct: 100 * e.full / e.total, coordHighPct: 100 * e.coordHigh / e.total, registryLinkedPct: 100 * e.registryLinked / e.total }));
  guRows.sort((a, b) => a.fullPct - b.fullPct);
  for (const g of guRows) console.log(`  ${g.gu}: FULL ${g.fullPct.toFixed(1)}% / coordHigh ${g.coordHighPct.toFixed(1)}% / registryLinked ${g.registryLinkedPct.toFixed(1)}% (n=${g.total})`);
  const fullPcts = guRows.map((g) => g.fullPct);
  const min = Math.min(...fullPcts), max = Math.max(...fullPcts);
  const sorted = [...fullPcts].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  console.log(`\nmin=${min.toFixed(1)}% max=${max.toFixed(1)}% median=${median.toFixed(1)}% ratio=${(max / min).toFixed(2)}x`);

  // §24 동(dong) 단위 transport-eligible(COORD_HIGH) peer sample size
  const dongCount = new Map<string, number>();
  for (const r of results) {
    if (r.coord !== 'COORD_HIGH') continue;
    const m = masterByAptSeq.get(r.aptSeq)!;
    const key = `${m.sggCd}::${m.umdName}`;
    dongCount.set(key, (dongCount.get(key) ?? 0) + 1);
  }
  const dongCounts = [...dongCount.values()];
  const buckets = {
    total: dongCounts.length,
    under5: dongCounts.filter((n) => n < 5).length,
    under10: dongCounts.filter((n) => n < 10).length,
    under20: dongCounts.filter((n) => n < 20).length,
    atLeast20: dongCounts.filter((n) => n >= 20).length,
  };
  console.log('\n[§24] 동 단위 COORD_HIGH peer sample size(AFTER):', JSON.stringify(buckets, null, 1));
  console.log(`  n<5: ${(100 * buckets.under5 / buckets.total).toFixed(1)}%  n<10: ${(100 * buckets.under10 / buckets.total).toFixed(1)}%  n<20: ${(100 * buckets.under20 / buckets.total).toFixed(1)}%  n>=20: ${(100 * buckets.atLeast20 / buckets.total).toFixed(1)}%`);

  fs.writeFileSync(path.resolve(__dirname, 'output/step07a-post-write-peer-quality.json'), JSON.stringify({
    generatedAt: new Date().toISOString(), total, byPeer, domainEligible, guRows, districtFullMin: min, districtFullMax: max, districtFullMedian: median, districtFullRatio: max / min, dongBuckets: buckets,
  }, null, 1));

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
