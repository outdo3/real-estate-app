/**
 * BUSAN SCORE DATA V1 — 최종 8건(non-OK) 정밀 점검용 스크립트.
 * production 로직(calculateApartmentScore, resolvePeerPoolLevels,
 * computeCategoryWithFallback)을 그대로 재사용해 read-only로 조회한다.
 * 결과 저장/변경 없음 — 감사 스크립트 관례(busan-coverage-audit.ts와 동일 원칙).
 *
 * [PEER FALLBACK HOTFIX] §18-A에서 발견된 8건(중구 대청동4가 4건, 기장군
 * 일광읍 이천리 4건)을 고정 목록으로 명시해, hotfix 적용 후에도 OK로
 * 바뀌었는지/어떤 peerLevel로 최종 계산됐는지 target-8 before/after를
 * 정확히 추적한다. 동시에 현재 시점 전체 non-OK 목록도 별도로 출력해
 * (hotfix 후 새로 생기거나 남아있는 케이스가 있는지) 회귀를 함께 확인한다.
 *
 * 사용법:
 *   npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js scripts/apartment-score/busan-final8-check.ts
 */
import { prisma } from '@/lib/prisma';
import { calculateApartmentScore, computeCategoryWithFallback } from '@/lib/apartment-score/server/calculate';
import { resolvePeerPoolLevels, type PeerCandidate } from '@/lib/apartment-score/server/peer-groups';
import { computeTransportCategory } from '@/lib/apartment-score/server/categories/transport';
import { computeLivingCategory } from '@/lib/apartment-score/server/categories/living';
import { computeParkingCategory } from '@/lib/apartment-score/server/categories/parking';
import { computeComplexCategory } from '@/lib/apartment-score/server/categories/complex';
import { computeSchoolAccessCategory } from '@/lib/apartment-score/server/categories/school-access';
import type { RawLocationFeature, RawMasterInfo } from '@/lib/apartment-score/server/types';

const SIDO_VALUE = '부산';

// §18-A 실측 재현 대상(중구 대청동4가 4건 + 기장군 일광읍 이천리 4건).
const TARGET_8 = [
  '26110-9', '26110-65', '26110-780', '26110-8',
  '26710-546', '26710-642', '26710-437', '26710-38',
];

async function dumpAptSeq(aptSeq: string) {
  const m = await prisma.apartmentMaster.findUnique({
    where: { aptSeq },
    select: { aptSeq: true, name: true, sido: true, sigungu: true, umdName: true, sggCd: true, buildYear: true, latitude: true, longitude: true },
  });
  if (!m) {
    console.log(`  [경고] aptSeq=${aptSeq} ApartmentMaster에 없음`);
    return;
  }
  const r = await calculateApartmentScore(aptSeq);
  const loc = await prisma.apartmentLocationFeature.findUnique({ where: { aptSeq } });
  const mkt = await prisma.apartmentMarketFeature.findUnique({ where: { aptSeq } });

  console.log(`--- aptSeq=${aptSeq} ---`);
  console.log(`  aptName: ${m.name}`);
  console.log(`  sido/sigungu/dong: ${m.sido} / ${m.sigungu} / ${m.umdName}`);
  console.log(`  coordinate(master): lat=${m.latitude}, lng=${m.longitude}`);
  console.log(`  status: ${r.status}, score: ${r.score}, coverage: ${r.coverage}, preparingReason: ${r.preparingReason}`);
  console.log(`  feature cache 존재: ${loc ? 'YES' : 'NO'}${loc ? ` (qualityFlag=${loc.qualityFlag})` : ''}`);
  console.log(`  market feature 존재: ${mkt ? 'YES' : 'NO'}${mkt ? ` (transactionCount12m=${mkt.transactionCount12m})` : ''}`);
  console.log(`  explained categories(공개 응답): ${r.categories.map((c) => `${c.key}=${c.score}`).join(', ')}`);

  // ---- fallback-aware raw CategoryResult: calculate.ts와 동일한 오케스트레이션 재사용 ----
  const cohortMasterRows = await prisma.apartmentMaster.findMany({
    where: { sggCd: m.sggCd, aptSeq: { not: null } },
    select: { aptSeq: true, sggCd: true, sigungu: true, umdName: true, buildYear: true, totalHouseholds: true, parkingCount: true, mainBuildingCount: true },
  });
  const cohortAptSeqs = cohortMasterRows.map((c) => c.aptSeq!).filter(Boolean);
  const cohortLocRows = await prisma.apartmentLocationFeature.findMany({ where: { aptSeq: { in: cohortAptSeqs } } });
  const cohortLocByAptSeq = new Map<string, RawLocationFeature>(cohortLocRows.map((row) => [row.aptSeq, row as RawLocationFeature]));
  const cohortMasterByAptSeq = new Map<string, RawMasterInfo>(
    cohortMasterRows.map((c) => [c.aptSeq!, { aptSeq: c.aptSeq!, sggCd: c.sggCd, sigungu: c.sigungu, umdName: c.umdName, buildYear: c.buildYear, totalHouseholds: c.totalHouseholds, parkingCount: c.parkingCount, mainBuildingCount: c.mainBuildingCount }])
  );
  const peerCandidates: PeerCandidate[] = cohortMasterRows.map((c) => ({ aptSeq: c.aptSeq!, sggCd: c.sggCd, umdName: c.umdName, buildYear: c.buildYear }));
  const targetCandidate: PeerCandidate = { aptSeq: m.aptSeq!, sggCd: m.sggCd, umdName: m.umdName, buildYear: m.buildYear };

  const nonParkingLevels = resolvePeerPoolLevels(targetCandidate, peerCandidates, false);
  const parkingLevels = resolvePeerPoolLevels(targetCandidate, peerCandidates, true);
  console.log(`  cohort(같은 sggCd=${m.sggCd}) 총원: ${cohortMasterRows.length}건, location feature 보유: ${cohortLocRows.length}건`);
  console.log(`  시도 순서(non-parking): ${nonParkingLevels.map((l) => `${l.level}(n=${l.aptSeqs.length},tier=${l.tier})`).join(' → ')}`);
  console.log(`  시도 순서(parking): ${parkingLevels.map((l) => `${l.level}(n=${l.aptSeqs.length},tier=${l.tier})`).join(' → ')}`);

  const rawCategories = [
    computeCategoryWithFallback(computeTransportCategory, m.aptSeq!, nonParkingLevels, cohortLocByAptSeq),
    computeCategoryWithFallback(computeLivingCategory, m.aptSeq!, nonParkingLevels, cohortLocByAptSeq),
    computeCategoryWithFallback(computeParkingCategory, m.aptSeq!, parkingLevels, cohortMasterByAptSeq),
    computeCategoryWithFallback(computeComplexCategory, m.aptSeq!, nonParkingLevels, cohortMasterByAptSeq),
    computeCategoryWithFallback(computeSchoolAccessCategory, m.aptSeq!, nonParkingLevels, cohortLocByAptSeq),
  ];
  console.log(`  raw CategoryResult(최종 채택 레벨 포함):`);
  rawCategories.forEach((c) => {
    console.log(`    ${c.key}: status=${c.status}, score=${c.score?.toFixed(2)}, peerLevel=${c.peerLevel}, peerTier=${c.peerTier}, peerSampleSize=${c.peerSampleSize}`);
  });
  console.log('');
}

async function main() {
  console.log(`=== TARGET 8(§18-A 실측 재현 대상) 재검증 ===\n`);
  for (const aptSeq of TARGET_8) {
    await dumpAptSeq(aptSeq);
  }

  console.log(`\n=== 현재 시점 전체 non-OK 재조사(hotfix 후 잔존/신규 여부 확인) ===\n`);
  const allMaster = await prisma.apartmentMaster.findMany({
    where: { sido: SIDO_VALUE, aptSeq: { not: null } },
    select: { aptSeq: true, name: true, sigungu: true, umdName: true },
  });
  const locFeatures = await prisma.apartmentLocationFeature.findMany({ select: { aptSeq: true } });
  const locAptSeqs = new Set(locFeatures.map((r) => r.aptSeq));
  const targets = allMaster.filter((r) => locAptSeqs.has(r.aptSeq!));
  console.log(`전체 location feature 보유 단지: ${targets.length}건`);

  const nonOk: { aptSeq: string; name: string; gu: string | null; dong: string | null; status: string; preparingReason: string | null }[] = [];
  for (const t of targets) {
    const r = await calculateApartmentScore(t.aptSeq!);
    if (r.status !== 'OK') {
      nonOk.push({ aptSeq: t.aptSeq!, name: t.name, gu: t.sigungu, dong: t.umdName, status: r.status, preparingReason: r.preparingReason });
    }
  }
  console.log(`non-OK 건수: ${nonOk.length}`);
  nonOk.forEach((o) => console.log(`  ${o.aptSeq} ${o.name}(${o.gu}/${o.dong}) status=${o.status} reason=${o.preparingReason}`));

  const byReason: Record<string, number> = {};
  nonOk.forEach((o) => {
    const key = o.preparingReason ?? '(null)';
    byReason[key] = (byReason[key] ?? 0) + 1;
  });
  console.log('\n=== 요약 ===');
  console.log(`OK: ${targets.length - nonOk.length}건 / non-OK: ${nonOk.length}건 (전체 ${targets.length}건 중)`);
  Object.entries(byReason).forEach(([k, v]) => console.log(`  ${k}: ${v}건`));
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
