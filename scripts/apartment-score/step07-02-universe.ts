// E-JIP SCORE V2 STEP 0.7 §1 — 고위험 1,725건 + MOLIT 복구후보 1,398건 재현,
// 전체 row 구조 출력(요청 필드: aptSeq/aptName/lawdCd/dong/jibun/roadAddress/
// lat/lng/coordinateQuality/registryLinked/households/builtYear/transactionCount).
// READ-ONLY.
import { prisma } from '../../src/lib/prisma';
import { loadUniverse } from './lib/step07-universe';

async function main() {
  const { all, highRisk, molitCandidates, noEvidence } = await loadUniverse();

  console.log(`ApartmentMaster 전체(aptSeq 있는 것): ${all.length}건`);
  console.log(`고위험 1,725건 재현: ${highRisk.length}건 (기대값 1,725와 비교)`);
  console.log(`MOLIT 복구후보(§19 C그룹) 재현: ${molitCandidates.length}건 (기대값 1,398와 비교)`);
  console.log(`증거 없음(327건 대응) 재현: ${noEvidence.length}건`);
  console.log(`합계 검증: ${molitCandidates.length} + ${noEvidence.length} = ${molitCandidates.length + noEvidence.length} (고위험 ${highRisk.length}건과 비교)`);

  console.log('\n샘플(MOLIT 복구후보 첫 5건, 전체 필드):');
  molitCandidates.slice(0, 5).forEach((r) => console.log(JSON.stringify(r, null, 1)));

  console.log('\n샘플(증거 없음 327건군 첫 3건, 전체 필드):');
  noEvidence.slice(0, 3).forEach((r) => console.log(JSON.stringify(r, null, 1)));

  // lawdCd(구·군)별 분포 — §29 district coverage 이후 단계에서 재사용
  const byLawd = new Map<string, number>();
  for (const r of molitCandidates) {
    const key = r.lawdCd ?? 'null';
    byLawd.set(key, (byLawd.get(key) ?? 0) + 1);
  }
  console.log('\nMOLIT 복구후보 lawdCd별 분포:');
  for (const [k, v] of [...byLawd.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}건`);
  }

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
