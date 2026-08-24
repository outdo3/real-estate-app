// E-JIP SCORE V2 STEP 0.6 §9,10,21-23 — filtered peer 재분석 simulation. READ-ONLY,
// production score 미변경. 3개 benchmark(대신해모로/협성르네상스/구덕금호) 전부 trace.
import { prisma } from '../../src/lib/prisma';
import { classify, type QualityInput } from './lib/peer-quality';

const TARGETS: Record<string, string> = {
  '대신해모로센트럴아파트': '26140-1356',
  '협성르네상스(서구)': '26140-51',
  '구덕금호': '26140-11',
};

async function classifyAll(aptSeqs: string[]) {
  const masters = await prisma.apartmentMaster.findMany({
    where: { aptSeq: { in: aptSeqs } },
    select: {
      aptSeq: true, name: true, umdName: true, roadAddress: true, jibunAddress: true, mgmBldrgstPk: true,
      totalHouseholds: true, parkingCount: true, mainBuildingCount: true, buildYear: true,
      geocodeQuality: true, latitude: true, longitude: true,
    },
  });
  const market = await prisma.apartmentMarketFeature.findMany({ where: { aptSeq: { in: aptSeqs } }, select: { aptSeq: true, transactionCount12m: true } });
  const txMap = new Map(market.map((m) => [m.aptSeq, m.transactionCount12m ?? 0]));
  const locs = await prisma.apartmentLocationFeature.findMany({ where: { aptSeq: { in: aptSeqs } } });

  return masters.map((m) => {
    const input: QualityInput = {
      aptSeq: m.aptSeq!, roadAddress: m.roadAddress, jibunAddress: m.jibunAddress, mgmBldrgstPk: m.mgmBldrgstPk,
      totalHouseholds: m.totalHouseholds, parkingCount: m.parkingCount, mainBuildingCount: m.mainBuildingCount,
      buildYear: m.buildYear, geocodeQuality: m.geocodeQuality, latitude: m.latitude, longitude: m.longitude,
      transactionCount12m: txMap.get(m.aptSeq!) ?? 0,
    };
    const q = classify(input);
    const loc = locs.find((l) => l.aptSeq === m.aptSeq);
    return { name: m.name, umdName: m.umdName, ...q, nearestSubwayDistanceM: loc?.nearestSubwayDistanceM ?? null, nearestSubwayName: loc?.nearestSubwayName ?? null };
  });
}

async function main() {
  for (const [label, aptSeq] of Object.entries(TARGETS)) {
    console.log(`\n${'='.repeat(78)}\n### ${label} (${aptSeq})\n${'='.repeat(78)}`);
    const target = await prisma.apartmentMaster.findUnique({ where: { aptSeq }, select: { sggCd: true, umdName: true } });
    if (!target) { console.log('NOT FOUND'); continue; }

    const oldPeerMasters = await prisma.apartmentMaster.findMany({
      where: { sggCd: target.sggCd, umdName: target.umdName, aptSeq: { not: null } },
      select: { aptSeq: true },
    });
    const oldPeerAptSeqs = oldPeerMasters.map((m) => m.aptSeq!);
    const classified = await classifyAll(oldPeerAptSeqs);

    const oldPeerWithDistance = classified.filter((c) => c.nearestSubwayDistanceM != null);
    const filteredPeers = oldPeerWithDistance.filter((c) => c.transportPeerEligible);

    console.log(`기존 LOCAL peer(동일 umdName, subway distance 보유) count: ${oldPeerWithDistance.length}`);
    console.log(`transportPeerEligible(COORD_HIGH)로 필터링 후 count: ${filteredPeers.length}`);

    const targetRow = classified.find((c) => c.aptSeq === aptSeq);
    console.log(`대상 단지 자신: coord=${targetRow?.coord} identity=${targetRow?.identity} peerEligibility=${targetRow?.peerEligibility} subwayDist=${targetRow?.nearestSubwayDistanceM}`);

    const oldSorted = [...oldPeerWithDistance].sort((a, b) => a.nearestSubwayDistanceM! - b.nearestSubwayDistanceM!);
    const oldRank = oldSorted.findIndex((c) => c.aptSeq === aptSeq) + 1;
    const filteredSorted = [...filteredPeers].sort((a, b) => a.nearestSubwayDistanceM! - b.nearestSubwayDistanceM!);
    const filteredRank = filteredSorted.findIndex((c) => c.aptSeq === aptSeq) + 1;

    console.log(`기존 순위(전체 peer 중, 지하철 거리 오름차순): ${oldRank}/${oldSorted.length}`);
    console.log(`필터링 후 순위(PEER_FULL/LIMITED만, 즉 COORD_HIGH만): ${filteredRank}/${filteredSorted.length}`);

    console.log(`\nTOP 10(필터링 후, COORD_HIGH만):`);
    filteredSorted.slice(0, 10).forEach((c, i) => {
      console.log(`  ${i + 1}. ${c.nearestSubwayDistanceM}m | ${c.nearestSubwayName} | ${c.name} | identity=${c.identity} peerEligibility=${c.peerEligibility}${c.aptSeq === aptSeq ? '  <== 대상' : ''}`);
    });

    console.log(`\n제외된 peer(기존엔 포함, 필터링 후 제외 — DISPLAY_ONLY/UNRESOLVED):`);
    const excluded = oldPeerWithDistance.filter((c) => !c.transportPeerEligible && c.nearestSubwayDistanceM! < (targetRow?.nearestSubwayDistanceM ?? Infinity));
    console.log(`  대상보다 가까웠던 것 중 제외된 것: ${excluded.length}건`);
    excluded.forEach((c) => console.log(`    ${c.nearestSubwayDistanceM}m | ${c.name} | coord=${c.coord} peerEligibility=${c.peerEligibility}`));
  }

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
