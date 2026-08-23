// E-JIP SCORE V2 STEP 0.6 §13-15 — quality filtering 이후 peer sample-size 분포.
// READ-ONLY, 여러 domain(transport-류/parking/complex) 각각 동/구/부산 단위로 확인.
import { prisma } from '../../src/lib/prisma';
import { classify, type QualityInput } from './lib/peer-quality';

async function main() {
  const masters = await prisma.apartmentMaster.findMany({
    where: { aptSeq: { not: null } },
    select: {
      aptSeq: true, sigungu: true, umdName: true, roadAddress: true, jibunAddress: true, mgmBldrgstPk: true,
      totalHouseholds: true, parkingCount: true, mainBuildingCount: true, buildYear: true,
      geocodeQuality: true, latitude: true, longitude: true,
    },
  });
  const market = await prisma.apartmentMarketFeature.findMany({ select: { aptSeq: true, transactionCount12m: true } });
  const txMap = new Map(market.map((m) => [m.aptSeq, m.transactionCount12m ?? 0]));

  const results = masters.map((m) => {
    const input: QualityInput = {
      aptSeq: m.aptSeq!, roadAddress: m.roadAddress, jibunAddress: m.jibunAddress, mgmBldrgstPk: m.mgmBldrgstPk,
      totalHouseholds: m.totalHouseholds, parkingCount: m.parkingCount, mainBuildingCount: m.mainBuildingCount,
      buildYear: m.buildYear, geocodeQuality: m.geocodeQuality, latitude: m.latitude, longitude: m.longitude,
      transactionCount12m: txMap.get(m.aptSeq!) ?? 0,
    };
    return { ...classify(input), sigungu: m.sigungu, umdName: m.umdName };
  });

  function bucket(counts: number[]) {
    return { 'n<5': counts.filter((c) => c < 5).length, 'n<10': counts.filter((c) => c < 10).length, 'n<20': counts.filter((c) => c < 20).length, 'n>=20': counts.filter((c) => c >= 20).length, total: counts.length };
  }

  // ---- dong 단위 sample size(transport-류: coordinate 기반) ----
  const dongs = [...new Set(results.map((r) => r.umdName).filter(Boolean))] as string[];
  const transportEligibleByDong = dongs.map((d) => results.filter((r) => r.umdName === d && r.transportPeerEligible).length);
  const parkingEligibleByDong = dongs.map((d) => results.filter((r) => r.umdName === d && r.parkingPeerEligible).length);
  const complexEligibleByDong = dongs.map((d) => results.filter((r) => r.umdName === d && r.complexPeerEligible).length);

  console.log(`[§13] 동(umdName) 단위 candidate sample size 분포(부산 전체 ${dongs.length}개 동)`);
  console.log('transport(coordinate 기반) eligible count/동:', JSON.stringify(bucket(transportEligibleByDong)));
  console.log('parking(registry 기반) eligible count/동:', JSON.stringify(bucket(parkingEligibleByDong)));
  console.log('complex(buildYear 기반) eligible count/동:', JSON.stringify(bucket(complexEligibleByDong)));

  // ---- sigungu 단위 ----
  const sigungus = [...new Set(results.map((r) => r.sigungu).filter(Boolean))] as string[];
  const transportEligibleBySggu = sigungus.map((s) => results.filter((r) => r.sigungu === s && r.transportPeerEligible).length);
  const parkingEligibleBySggu = sigungus.map((s) => results.filter((r) => r.sigungu === s && r.parkingPeerEligible).length);

  console.log(`\n[§13] 구·군(sigungu) 단위 candidate sample size 분포(${sigungus.length}개 구·군)`);
  console.log('transport eligible count/구:', JSON.stringify(bucket(transportEligibleBySggu)));
  console.log('parking eligible count/구:', JSON.stringify(bucket(parkingEligibleBySggu)));
  console.log('구별 최소 transport eligible:', Math.min(...transportEligibleBySggu), '| 최소 parking eligible:', Math.min(...parkingEligibleBySggu));

  // ---- parking을 §11 decade-band까지 적용하면 얼마나 더 줄어드는지(기존 로직 재현) ----
  console.log(`\n[§13/§15] parking peer: sigungu만 vs sigungu+buildYear decade band(기존 방식) 비교`);
  const decadeBand = (y: number | null) => (y == null ? null : Math.floor(y / 10) * 10);
  for (const s of sigungus.slice(0, 5)) {
    const inSggu = results.filter((r) => r.sigungu === s && r.parkingPeerEligible);
    const masterBy = new Map(masters.filter((m) => inSggu.some((r) => r.aptSeq === m.aptSeq)).map((m) => [m.aptSeq, m.buildYear]));
    const decadeCounts = new Map<number, number>();
    for (const r of inSggu) {
      const y = masterBy.get(r.aptSeq);
      const d = decadeBand(y ?? null);
      if (d != null) decadeCounts.set(d, (decadeCounts.get(d) ?? 0) + 1);
    }
    console.log(`  ${s}: sigungu 전체 parking-eligible=${inSggu.length}, decade-band별=${JSON.stringify(Object.fromEntries(decadeCounts))}`);
  }

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
