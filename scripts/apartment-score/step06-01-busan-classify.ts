// E-JIP SCORE V2 STEP 0.6 §2,11,12 — 부산 전체 ApartmentMaster에 peer-quality
// classifier 적용, Busan-wide + district-level 분포 출력. READ-ONLY.
import { prisma } from '../../src/lib/prisma';
import { classify, type QualityInput, type QualityResult } from './lib/peer-quality';

async function main() {
  const masters = await prisma.apartmentMaster.findMany({
    where: { aptSeq: { not: null } },
    select: {
      aptSeq: true, sigungu: true, roadAddress: true, jibunAddress: true, mgmBldrgstPk: true,
      totalHouseholds: true, parkingCount: true, mainBuildingCount: true, buildYear: true,
      geocodeQuality: true, latitude: true, longitude: true,
    },
  });
  const market = await prisma.apartmentMarketFeature.findMany({ select: { aptSeq: true, transactionCount12m: true } });
  const txByAptSeq = new Map(market.map((m) => [m.aptSeq, m.transactionCount12m ?? 0]));

  const results: (QualityResult & { sigungu: string | null })[] = masters.map((m) => {
    const input: QualityInput = {
      aptSeq: m.aptSeq!,
      roadAddress: m.roadAddress,
      jibunAddress: m.jibunAddress,
      mgmBldrgstPk: m.mgmBldrgstPk,
      totalHouseholds: m.totalHouseholds,
      parkingCount: m.parkingCount,
      mainBuildingCount: m.mainBuildingCount,
      buildYear: m.buildYear,
      geocodeQuality: m.geocodeQuality,
      latitude: m.latitude,
      longitude: m.longitude,
      transactionCount12m: txByAptSeq.get(m.aptSeq!) ?? 0,
    };
    return { ...classify(input), sigungu: m.sigungu };
  });

  console.log(`총 ${results.length}건 분류 완료(부산 ApartmentMaster, aptSeq 확보분)\n`);

  // ---- §2: STEP 0.5 고위험 1,725건 재현(정확한 condition 정의) ----
  console.log('='.repeat(78));
  console.log('[§2] STEP 0.5 "고위험 조합" 재현 — 정확한 조건별 count');
  console.log('='.repeat(78));
  const cond = {
    registryUnlinked: results.filter((r) => !r.registryLinked).length,
    addressMissing: results.filter((r) => !r.hasAddress).length,
    normalizedGeocode: results.filter((r) => r.coord === 'COORD_LOW').length,
    coordUnresolved: results.filter((r) => r.coord === 'COORD_UNRESOLVED').length,
    zeroMarketEvidence: results.filter((r) => r.marketEvidence === 'ZERO').length,
  };
  console.log('개별 조건(union 아님, 각자 전체 대비):', JSON.stringify(cond, null, 1));
  const highRisk = results.filter((r) => r.coord === 'COORD_LOW' && !r.hasAddress && !r.registryLinked);
  console.log(`\nSTEP 0.5 정의(normalized geocode AND 주소없음 AND registry미연결) 재현: ${highRisk.length}건 (${(highRisk.length / results.length * 100).toFixed(1)}%)`);
  const uniqueAptSeq = new Set(highRisk.map((r) => r.aptSeq));
  console.log(`unique aptSeq count(중복 없음 확인): ${uniqueAptSeq.size}`);

  // ---- §1 요약: identity/coord/registry/market 분포(부산 전체) ----
  console.log(`\n${'='.repeat(78)}\n[§1/§11] Busan-wide 분포\n${'='.repeat(78)}`);
  function dist<T extends string>(items: T[]) {
    const m = new Map<string, number>();
    for (const v of items) m.set(v, (m.get(v) ?? 0) + 1);
    return Object.fromEntries([...m.entries()].map(([k, v]) => [k, `${v}(${(v / items.length * 100).toFixed(1)}%)`]));
  }
  console.log('IDENTITY:', JSON.stringify(dist(results.map((r) => r.identity))));
  console.log('COORD:', JSON.stringify(dist(results.map((r) => r.coord))));
  console.log('registryLinked=true:', results.filter((r) => r.registryLinked).length, '| registryAttempted=true:', results.filter((r) => r.registryAttempted).length);
  console.log('MARKET_EVIDENCE:', JSON.stringify(dist(results.map((r) => r.marketEvidence))));
  console.log('PEER_ELIGIBILITY:', JSON.stringify(dist(results.map((r) => r.peerEligibility))));

  console.log('\n[§8 domain-specific eligible count]');
  console.log('transportPeerEligible:', results.filter((r) => r.transportPeerEligible).length);
  console.log('livePeerEligible:', results.filter((r) => r.livePeerEligible).length);
  console.log('schoolPeerEligible:', results.filter((r) => r.schoolPeerEligible).length);
  console.log('parkingPeerEligible:', results.filter((r) => r.parkingPeerEligible).length);
  console.log('complexPeerEligible:', results.filter((r) => r.complexPeerEligible).length);

  // ---- §12: 구·군별 coverage ----
  console.log(`\n${'='.repeat(78)}\n[§12] 구·군별 PEER_ELIGIBILITY 분포\n${'='.repeat(78)}`);
  const districts = [...new Set(results.map((r) => r.sigungu).filter(Boolean))] as string[];
  const districtRows: { d: string; total: number; full: number; limited: number; display: number; unresolved: number }[] = [];
  for (const d of districts.sort()) {
    const inD = results.filter((r) => r.sigungu === d);
    districtRows.push({
      d, total: inD.length,
      full: inD.filter((r) => r.peerEligibility === 'PEER_FULL').length,
      limited: inD.filter((r) => r.peerEligibility === 'PEER_LIMITED').length,
      display: inD.filter((r) => r.peerEligibility === 'DISPLAY_ONLY').length,
      unresolved: inD.filter((r) => r.peerEligibility === 'UNRESOLVED').length,
    });
  }
  for (const r of districtRows) {
    console.log(`${r.d.padEnd(6)}: total=${r.total} FULL=${r.full}(${(r.full / r.total * 100).toFixed(0)}%) LIMITED=${r.limited}(${(r.limited / r.total * 100).toFixed(0)}%) DISPLAY=${r.display}(${(r.display / r.total * 100).toFixed(0)}%) UNRESOLVED=${r.unresolved}(${(r.unresolved / r.total * 100).toFixed(0)}%)`);
  }
  const fullRatios = districtRows.map((r) => r.full / r.total);
  console.log(`\nPEER_FULL 비율 최소: ${(Math.min(...fullRatios) * 100).toFixed(1)}% (${districtRows.find((r) => r.full / r.total === Math.min(...fullRatios))?.d})`);
  console.log(`PEER_FULL 비율 최대: ${(Math.max(...fullRatios) * 100).toFixed(1)}% (${districtRows.find((r) => r.full / r.total === Math.max(...fullRatios))?.d})`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
