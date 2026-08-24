/**
 * E-JIP SCORE V2 STEP 3.5 §15 — parking coverage(25.3%) 확대 가능성 실측
 * 조사(READY_SOURCE/RECOVERABLE/NEW_SOURCE/UNKNOWN). 새 ingestion 실행 없음,
 * 현재 schema/데이터 상태 확인만.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

async function main() {
  const { prisma } = await import('@/lib/prisma');
  const total = await prisma.apartmentMaster.count({ where: { aptSeq: { not: null } } });
  const parkingKnown = await prisma.apartmentMaster.count({ where: { parkingCount: { not: null }, totalHouseholds: { not: null } } });
  const registryAttempted = await prisma.apartmentMaster.count({ where: { mgmBldrgstPk: { not: null } } });
  const registryAttemptedNoParkingCount = await prisma.apartmentMaster.count({ where: { mgmBldrgstPk: { not: null }, parkingCount: null } });
  const noRegistryAttempt = await prisma.apartmentMaster.count({ where: { mgmBldrgstPk: null } });
  const noRegistryButHasHouseholds = await prisma.apartmentMaster.count({ where: { mgmBldrgstPk: null, totalHouseholds: { not: null } } });

  console.log('[§15] Parking coverage 확대 가능성 실측:');
  console.log(`  전체 = ${total}`);
  console.log(`  parking 확보(known) = ${parkingKnown}(${(100 * parkingKnown / total).toFixed(1)}%)`);
  console.log(`  registry 연결 시도됨(mgmBldrgstPk 존재) = ${registryAttempted}(${(100 * registryAttempted / total).toFixed(1)}%)`);
  console.log(`  registry 연결됐으나 parkingCount는 없음(= RECOVERABLE 후보, 건축물대장 재조회로 회복 가능성) = ${registryAttemptedNoParkingCount}`);
  console.log(`  registry 연결 시도 자체가 없음(mgmBldrgstPk null) = ${noRegistryAttempt}(${(100 * noRegistryAttempt / total).toFixed(1)}%)`);
  console.log(`    그 중 totalHouseholds는 있는 경우(주소/식별 정보는 있어 향후 registry 연결 시도 가능 = RECOVERABLE) = ${noRegistryButHasHouseholds}`);
  console.log(`    그 중 totalHouseholds도 없는 경우(식별정보 자체 부족 = NEW_SOURCE/UNKNOWN 필요) = ${noRegistryAttempt - noRegistryButHasHouseholds}`);

  console.log('\n분류:');
  console.log(`  READY_SOURCE(이미 확보, 추가 작업 불필요) = ${parkingKnown}건(${(100 * parkingKnown / total).toFixed(1)}%)`);
  console.log(`  RECOVERABLE(기존 건축물대장 API 재조회/registry 연결 시도로 회복 가능성 있음, 새 소스 불필요) = ${registryAttemptedNoParkingCount + noRegistryButHasHouseholds}건(${(100 * (registryAttemptedNoParkingCount + noRegistryButHasHouseholds) / total).toFixed(1)}%)`);
  console.log(`  NEW_SOURCE/UNKNOWN(식별정보 자체 부족, 최소 주소/registry 매칭부터 필요) = ${noRegistryAttempt - noRegistryButHasHouseholds}건(${(100 * (noRegistryAttempt - noRegistryButHasHouseholds) / total).toFixed(1)}%)`);
  console.log('\n결론: parking 데이터 자체가 "존재하지 않는" 것이 아니라 상당수가 registry 연결/재조회 시도로 회복 가능한 RECOVERABLE 범주 — 새 유료 API 도입 없이도 커버리지 개선 여지가 있다(단, 실제 재조회 실행은 이번 STEP 범위 밖).');

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
