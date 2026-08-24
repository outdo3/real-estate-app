/**
 * E-JIP SCORE V2 STEP 1.5 §6-10 — Score V2/School V2 통합 후 DB/identity/artifact
 * 호환성 READ-ONLY 검증. DB write 없음, artifact regenerate 없음.
 *
 * 사용법:
 *   npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js scripts/apartment-score/step15-01-integration-compat-check.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

async function main() {
  const { prisma } = await import('@/lib/prisma');

  // §7 DB current-state
  const [schoolTotal, kindergartenTotal, childcareTotal, schoolStatTotal, kindergartenStatTotal, educationSources] = await Promise.all([
    prisma.school.count(),
    prisma.kindergarten.count(),
    prisma.childcare.count(),
    prisma.schoolStat.count(),
    prisma.kindergartenStat.count(),
    prisma.educationSource.findMany({ select: { code: true, licenseCode: true, commercialUseAllowed: true } }),
  ]);
  console.log('[§7] DB current-state (READ-ONLY):');
  console.log(`  School = ${schoolTotal}`);
  console.log(`  Kindergarten = ${kindergartenTotal}`);
  console.log(`  Childcare = ${childcareTotal}`);
  console.log(`  SchoolStat = ${schoolStatTotal}`);
  console.log(`  KindergartenStat = ${kindergartenStatTotal}`);
  console.log(`  EducationSource = ${JSON.stringify(educationSources)}`);

  const byLevel = await prisma.school.groupBy({ by: ['schoolLevel'], _count: true });
  console.log(`  School taxonomy(schoolLevel groupBy) = ${JSON.stringify(byLevel)}`);

  // §8-9 Apartment <-> attendance-zone artifact compatibility
  const artifactPath = path.resolve(__dirname, '../../data/education/attendance-zone/busan-attendance-zone-20260320.json');
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf-8')) as {
    meta: { totalApartments: number; datasetVersion: string; sourceDate: string; generatedAt: string };
    apartments: { aptSeq: string; aptName: string; elementary: { status: string }; middle: { status: string } }[];
  };
  console.log(`\n[§9] attendance-zone artifact meta: ${JSON.stringify(artifact.meta)}`);
  console.log(`  artifact total = ${artifact.apartments.length}`);

  const statusCounts: Record<string, number> = {};
  for (const a of artifact.apartments) statusCounts[a.elementary.status] = (statusCounts[a.elementary.status] ?? 0) + 1;
  console.log(`  elementary status distribution = ${JSON.stringify(statusCounts)}`);
  const middleStatusCounts: Record<string, number> = {};
  for (const a of artifact.apartments) middleStatusCounts[a.middle.status] = (middleStatusCounts[a.middle.status] ?? 0) + 1;
  console.log(`  middle status distribution = ${JSON.stringify(middleStatusCounts)}`);

  // duplicate aptSeq within artifact
  const seen = new Map<string, number>();
  for (const a of artifact.apartments) seen.set(a.aptSeq, (seen.get(a.aptSeq) ?? 0) + 1);
  const duplicates = [...seen.entries()].filter(([, c]) => c > 1);
  console.log(`  duplicate aptSeq within artifact = ${duplicates.length}`);
  if (duplicates.length) console.log(`    sample: ${JSON.stringify(duplicates.slice(0, 5))}`);

  // §8 Apartment identity compatibility
  const masters = await prisma.apartmentMaster.findMany({ where: { aptSeq: { not: null } }, select: { aptSeq: true, name: true } });
  const masterByAptSeq = new Map(masters.map((m) => [m.aptSeq as string, m.name]));
  const artifactAptSeqs = new Set(artifact.apartments.map((a) => a.aptSeq));

  let matched = 0;
  let identityMismatch = 0;
  const mismatchSamples: { aptSeq: string; artifactName: string; masterName: string }[] = [];
  for (const a of artifact.apartments) {
    const masterName = masterByAptSeq.get(a.aptSeq);
    if (masterName != null) {
      matched++;
      if (masterName !== a.aptName) {
        identityMismatch++;
        if (mismatchSamples.length < 10) mismatchSamples.push({ aptSeq: a.aptSeq, artifactName: a.aptName, masterName });
      }
    }
  }
  const missingInMaster = artifact.apartments.filter((a) => !masterByAptSeq.has(a.aptSeq)).length;
  const missingInArtifact = masters.filter((m) => !artifactAptSeqs.has(m.aptSeq as string)).length;

  console.log('\n[§8] Apartment <-> attendance-zone artifact identity compatibility:');
  console.log(`  ApartmentMaster total(aptSeq not null) = ${masters.length}`);
  console.log(`  artifact aptSeq matched in ApartmentMaster = ${matched}`);
  console.log(`  artifact aptSeq NOT found in ApartmentMaster(missing) = ${missingInMaster}`);
  console.log(`  ApartmentMaster aptSeq NOT found in artifact(부산 외/신규 등) = ${missingInArtifact}`);
  console.log(`  duplicate aptSeq(artifact 내부) = ${duplicates.length}`);
  console.log(`  identity mismatch(같은 aptSeq인데 name이 다름) = ${identityMismatch}`);
  if (mismatchSamples.length) console.log(`    sample: ${JSON.stringify(mismatchSamples, null, 1)}`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
