/**
 * E-JIP SCORE V2 STEP 3 §3 — confirmed-absent subway sentinel 문제 재현 및
 * 4-state 분리(A missing / B confirmed-absent / C coordinate-insufficient /
 * D collector-failure) 실측. READ-ONLY.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

async function main() {
  const { prisma } = await import('@/lib/prisma');
  const { classify } = await import('../apartment-score/lib/peer-quality');

  const masters = await prisma.apartmentMaster.findMany({ where: { aptSeq: { not: null } } });
  const locs = await prisma.apartmentLocationFeature.findMany();
  const locByAptSeq = new Map(locs.map((l) => [l.aptSeq, l]));
  const tx = await prisma.apartmentMarketFeature.findMany({ select: { aptSeq: true, transactionCount12m: true } });
  const txMap = new Map(tx.map((t) => [t.aptSeq, t.transactionCount12m ?? 0]));

  let A_missingRow = 0, B_confirmedAbsent = 0, C_coordInsufficient = 0, D_collectorFailure = 0, HAS_VALUE = 0;
  for (const m of masters) {
    const q = classify({
      aptSeq: m.aptSeq!, roadAddress: m.roadAddress, jibunAddress: m.jibunAddress, mgmBldrgstPk: m.mgmBldrgstPk,
      totalHouseholds: m.totalHouseholds, parkingCount: m.parkingCount, mainBuildingCount: m.mainBuildingCount,
      buildYear: m.buildYear, geocodeQuality: m.geocodeQuality, latitude: m.latitude, longitude: m.longitude,
      transactionCount12m: txMap.get(m.aptSeq!) ?? 0,
    });
    if (q.coord !== 'COORD_HIGH') { C_coordInsufficient++; continue; } // 좌표 자체가 신뢰 불가 -> 애초에 검색 의미 없음
    const loc = locByAptSeq.get(m.aptSeq!);
    if (!loc) { A_missingRow++; continue; } // feature row 자체가 없음 = 수집 안 됨
    if (loc.nearestSubwayDistanceM != null) { HAS_VALUE++; continue; }
    if (loc.qualityFlag === 'complete') { B_confirmedAbsent++; continue; } // 검색했고 반경 내 없음이 확인됨
    D_collectorFailure++; // qualityFlag='partial' 등 - 수집 자체가 실패
  }

  console.log('[§3] 4-state 분리 실측(부산 3,402건 기준):');
  console.log(`  HAS_VALUE(실제 거리값 보유) = ${HAS_VALUE}`);
  console.log(`  B. confirmed-absent(검색함, qualityFlag=complete, 반경내 없음 확인) = ${B_confirmedAbsent}`);
  console.log(`  D. collector-failure(feature row 있으나 qualityFlag!=complete, 값 없음) = ${D_collectorFailure}`);
  console.log(`  A. missing row(ApartmentLocationFeature row 자체 없음, coord는 신뢰 가능) = ${A_missingRow}`);
  console.log(`  C. coordinate-insufficient(coord != COORD_HIGH, 검색 자체 무의미) = ${C_coordInsufficient}`);
  console.log(`  합계 확인: ${HAS_VALUE + B_confirmedAbsent + D_collectorFailure + A_missingRow + C_coordInsufficient} (전체 ${masters.length}건과 일치해야 함)`);

  console.log('\n[현재 V1 percentile.ts 처리 방식 재확인] treatCompleteNullAsWorst=true인 경우:');
  console.log('  qualityFlag=complete + null(B) -> sentinel 값(관측 최댓값보다 나쁨)으로 랭킹에 포함 (올바름)');
  console.log('  qualityFlag!=complete + null(D) -> 랭킹에서 완전히 제외(재분배 대상) (올바름 - 결측과 확인된 부재를 구분)');
  console.log('\n[STEP2 curves.ts의 문제] subwayDistanceScore(distanceM: number|null, ...)는 B와 D/A를 구분하지 않고');
  console.log('  둘 다 인자로 null만 받으면 동일하게 처리(호출부에서 null만 넘기면 정보 손실) — 이번 STEP에서 qualityFlag를 인자로 받는 sentinel-aware 버전으로 교체한다.');

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
