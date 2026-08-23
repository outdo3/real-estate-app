// E-JIP SCORE V2 STEP 0.7 §28 — 벤치마크 3건 외 회귀 표본 확장(각 유형 2-3건).
// sweep에 의존하지 않는 유형(clean HIGH/keyword-coordinate/no-market-history/
// registry-unlinked-but-valid)만 먼저 식별. "MOLIT-recovered HIGH"/"ambiguous
// same-name"은 step07-08 분류 완료 후 별도 확인. READ-ONLY.
import { prisma } from '../../src/lib/prisma';

async function main() {
  // clean HIGH: 이미 registry 연결 + 주소 + COORD_HIGH인 정상 케이스
  const cleanHigh = await prisma.apartmentMaster.findMany({
    where: { totalHouseholds: { gt: 0 }, roadAddress: { not: null }, geocodeQuality: 'exact' },
    select: { aptSeq: true, name: true, totalHouseholds: true },
    take: 3,
  });
  console.log('clean HIGH 표본:', JSON.stringify(cleanHigh, null, 1));

  // keyword-coordinate(COORD_LOW): geocodeQuality='normalized'
  const keywordCoord = await prisma.apartmentMaster.findMany({
    where: { geocodeQuality: 'normalized', totalHouseholds: { gt: 0 } }, // registry는 있으나 좌표만 keyword인 케이스(더 명확한 예시)
    select: { aptSeq: true, name: true, totalHouseholds: true, geocodeQuality: true },
    take: 3,
  });
  console.log('\nkeyword-coordinate(registry 있음, 좌표만 keyword) 표본:', JSON.stringify(keywordCoord, null, 1));

  // no-market-history: transactionCount12m = 0 (327건 group) — loadUniverse()의
  // noEvidence와 동일 조건(고위험 1,725건 中 mgmBldrgstPk 없고 거래이력도 0건).
  const { loadUniverse } = await import('./lib/step07-universe');
  const { noEvidence } = await loadUniverse();
  console.log('\nno-market-history(327건군) 표본:', JSON.stringify(noEvidence.slice(0, 3).map((r) => ({ aptSeq: r.aptSeq, name: r.aptName, dong: r.dong, jibun: r.jibun })), null, 1));

  // registry-unlinked-but-valid: 주소는 있으나(mgmBldrgstPk 있음) totalHouseholds 없음(80건, §1-3)
  const registryUnlinkedButValid = await prisma.apartmentMaster.findMany({
    where: { mgmBldrgstPk: { not: null }, totalHouseholds: null },
    select: { aptSeq: true, name: true, roadAddress: true, mgmBldrgstPk: true },
    take: 3,
  });
  console.log('\nregistry-unlinked-but-valid(mgmBldrgstPk 있으나 households 미확보, 80건군) 표본:', JSON.stringify(registryUnlinkedButValid, null, 1));

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
