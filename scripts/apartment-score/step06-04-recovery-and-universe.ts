// E-JIP SCORE V2 STEP 0.6 §19,20 — 저신뢰 데이터 복구 후보 분류 + apartment universe
// 유형 감사(확인 가능한 데이터만, 추정 classification 금지). READ-ONLY.
import { prisma } from '../../src/lib/prisma';
import { classify, type QualityInput } from './lib/peer-quality';

async function main() {
  const masters = await prisma.apartmentMaster.findMany({
    where: { aptSeq: { not: null } },
    select: {
      aptSeq: true, name: true, roadAddress: true, jibunAddress: true, mgmBldrgstPk: true,
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
    return { master: m, q: classify(input) };
  });

  const highRisk = results.filter((r) => r.q.coord === 'COORD_LOW' && !r.q.hasAddress && !r.q.registryLinked);
  console.log(`[§19] 고위험 1,725건(재현: ${highRisk.length}건) 복구 후보 분류\n`);

  // B. registry identity resolver 가능 — mgmBldrgstPk 있는데 totalHouseholds 없음(연결은 됐으나 추출 실패)
  const groupB = highRisk.filter((r) => r.master.mgmBldrgstPk != null);
  console.log(`B. registry identity resolver 가능(mgmBldrgstPk 연결됨, household 미추출): ${groupB.length}건`);

  // C. MOLIT 거래이력으로 identity 강화 가능 — transactionCount12m >= 1
  const groupC = highRisk.filter((r) => r.master.mgmBldrgstPk == null && txMap.get(r.master.aptSeq!)! >= 1);
  console.log(`C. MOLIT 거래이력(최근12개월)으로 identity 강화 가능: ${groupC.length}건`);

  // D. coordinate 재지오코딩 후보 — 주소가 아예 없어(D1) 키워드 검색만 가능했던 것과,
  //    이론상 주소가 있었을 가능성(다른 필드로 유추 불가, 확인 불가)을 구분하지 못함 —
  //    이 스키마에서는 "주소 없음=키워드 검색 필연"이므로 별도 재시도 여지가 낮은 그룹으로 분류.
  const groupD_noAddressAtAll = highRisk.filter((r) => r.master.roadAddress == null && r.master.jibunAddress == null && r.master.mgmBldrgstPk == null && txMap.get(r.master.aptSeq!)! === 0);
  console.log(`D/E. registry·주소·거래이력 전부 없음(재시도 근거 자체가 없음, manual review 대상): ${groupD_noAddressAtAll.length}건`);

  const accounted = new Set([...groupB, ...groupC, ...groupD_noAddressAtAll].map((r) => r.master.aptSeq));
  const remainder = highRisk.filter((r) => !accounted.has(r.master.aptSeq));
  console.log(`분류 안 된 나머지(중복/기타): ${remainder.length}건`);
  console.log(`합계 검증: ${groupB.length}+${groupC.length}+${groupD_noAddressAtAll.length}+${remainder.length} = ${groupB.length + groupC.length + groupD_noAddressAtAll.length + remainder.length} (전체 ${highRisk.length}건과 비교)`);

  // ---- §20 apartment universe 유형 감사 — 확인 가능한 데이터만 ----
  console.log(`\n${'='.repeat(78)}\n[§20] Apartment universe 유형 감사(추정 금지, 확인 가능한 필드만)\n${'='.repeat(78)}`);
  console.log('ApartmentMaster 스키마에 건물 유형 필드(아파트/오피스텔/주상복합/도시형생활주택 등) 자체가 없음 —');
  console.log('직접 유형 분류는 이 데이터로 불가능(확인됨, 추정하지 않음).');
  console.log('\n대신 확인 가능한 간접 신호(전부 raw 그대로, 유형 단정 아님):');
  const totalHouseholdsDist = { '1세대': 0, '2~9세대': 0, '10~99세대': 0, '100~499세대': 0, '500세대+': 0, '미확인': 0 };
  for (const r of results) {
    const h = r.master.totalHouseholds;
    if (h == null) totalHouseholdsDist['미확인']++;
    else if (h <= 1) totalHouseholdsDist['1세대']++;
    else if (h <= 9) totalHouseholdsDist['2~9세대']++;
    else if (h <= 99) totalHouseholdsDist['10~99세대']++;
    else if (h <= 499) totalHouseholdsDist['100~499세대']++;
    else totalHouseholdsDist['500세대+']++;
  }
  console.log('totalHouseholds(등록된 것만) 규모 분포:', JSON.stringify(totalHouseholdsDist, null, 1));
  console.log('\n(registry 미연결 항목은 세대수 자체가 없어 "소규모/대규모"조차 판정 불가 —');
  console.log(' 이름 패턴으로 유형을 추정하지 않는다, 확인 불가는 확인 불가로만 기록)');

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
