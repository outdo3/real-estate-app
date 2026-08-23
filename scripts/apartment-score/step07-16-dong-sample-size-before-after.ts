// E-JIP SCORE V2 STEP 0.7 §23 — 동(umdName) 단위 peer sample size(transport-류
// coordinate 기반 eligible count) BEFORE/AFTER_WITH_REGEOCODE_PROJECTED 비교.
// step06-03과 동일한 bucket 기준(n<5/10/20) 재사용. READ-ONLY.
import fs from 'fs';
import path from 'path';
import { prisma } from '../../src/lib/prisma';
import { classify, type QualityInput } from './lib/peer-quality';

function bucket(counts: number[]) {
  return { 'n<5': counts.filter((c) => c < 5).length, 'n<10': counts.filter((c) => c < 10).length, 'n<20': counts.filter((c) => c < 20).length, 'n>=20': counts.filter((c) => c >= 20).length, total: counts.length };
}

async function main() {
  const masters = await prisma.apartmentMaster.findMany({
    where: { aptSeq: { not: null } },
    select: {
      aptSeq: true, umdName: true, roadAddress: true, jibunAddress: true, mgmBldrgstPk: true,
      totalHouseholds: true, parkingCount: true, mainBuildingCount: true, buildYear: true,
      geocodeQuality: true, latitude: true, longitude: true,
    },
  });
  const market = await prisma.apartmentMarketFeature.findMany({ select: { aptSeq: true, transactionCount12m: true } });
  const txMap = new Map(market.map((m) => [m.aptSeq, m.transactionCount12m ?? 0]));
  const classified = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'output/step07-recovery-classification.json'), 'utf-8')) as any[];
  const highByAptSeq = new Map(classified.filter((r) => r.recovery.level === 'RECOVERY_HIGH').map((r) => [r.aptSeq, r]));

  const toInput = (m: (typeof masters)[number]): QualityInput => ({
    aptSeq: m.aptSeq!, roadAddress: m.roadAddress, jibunAddress: m.jibunAddress, mgmBldrgstPk: m.mgmBldrgstPk,
    totalHouseholds: m.totalHouseholds, parkingCount: m.parkingCount, mainBuildingCount: m.mainBuildingCount,
    buildYear: m.buildYear, geocodeQuality: m.geocodeQuality, latitude: m.latitude, longitude: m.longitude,
    transactionCount12m: txMap.get(m.aptSeq!) ?? 0,
  });

  const before = masters.map((m) => ({ ...classify(toInput(m)), umdName: m.umdName }));
  const after = masters.map((m) => {
    const rec = highByAptSeq.get(m.aptSeq!);
    const input = toInput(m);
    if (rec) {
      input.totalHouseholds = rec.probe.totalHouseholds ?? input.totalHouseholds;
      input.roadAddress = rec.probe.roadAddress ?? input.roadAddress;
      input.mgmBldrgstPk = rec.probe.mgmBldrgstPk ?? input.mgmBldrgstPk;
      input.geocodeQuality = 'exact'; // §11/§15 실측 검증(30/30 성공)에 근거한 투영
    }
    return { ...classify(input), umdName: m.umdName };
  });

  const dongs = [...new Set(masters.map((m) => m.umdName).filter(Boolean))] as string[];
  const beforeCounts = dongs.map((d) => before.filter((r) => r.umdName === d && r.transportPeerEligible).length);
  const afterCounts = dongs.map((d) => after.filter((r) => r.umdName === d && r.transportPeerEligible).length);

  console.log(`[§23] 동(umdName) 단위 transport-eligible(PEER_FULL+LIMITED, COORD_HIGH 기준) sample size — 부산 전체 ${dongs.length}개 동`);
  console.log('BEFORE:', JSON.stringify(bucket(beforeCounts)));
  console.log('AFTER_WITH_REGEOCODE_PROJECTED:', JSON.stringify(bucket(afterCounts)));
  const beforeSmall = beforeCounts.filter((c) => c < 5).length;
  const afterSmall = afterCounts.filter((c) => c < 5).length;
  console.log(`n<5 동 비율: ${(100 * beforeSmall / dongs.length).toFixed(1)}% → ${(100 * afterSmall / dongs.length).toFixed(1)}%`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
