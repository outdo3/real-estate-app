// E-JIP SCORE V2 STEP 0.7-A §19 — re-geocode write 직후 검증(read-only).
import fs from 'fs';
import path from 'path';

async function main() {
  const { prisma } = await import('../../src/lib/prisma');

  const dryrun = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'output/step07a-regeocode-dryrun.json'), 'utf-8'));
  const writeResult = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'output/step07a-regeocode-write-result.json'), 'utf-8'));

  const safeAptSeqs: string[] = dryrun.safeAptSeqs;
  const unsafeAptSeqs: string[] = dryrun.unsafeAptSeqs;

  const rows = await prisma.apartmentMaster.findMany({
    where: { aptSeq: { in: [...safeAptSeqs, ...unsafeAptSeqs] } },
    select: { aptSeq: true, sggCd: true, latitude: true, longitude: true, geocodeQuality: true },
  });
  const byAptSeq = new Map(rows.map((r) => [r.aptSeq!, r]));

  // unsafe(=skipped) 후보들이 실제로 DB에서 변경되지 않았는지 확인(제외 로직이 실제로 지켜졌는지)
  const unsafeResultsByAptSeq = new Map(dryrun.results.map((r: any) => [r.aptSeq, r]));
  let unsafeLeaked = 0;
  for (const seq of unsafeAptSeqs) {
    const cur = byAptSeq.get(seq);
    const dr = unsafeResultsByAptSeq.get(seq) as any;
    if (cur && dr?.newLatLng && cur.latitude === dr.newLatLng.lat && cur.longitude === dr.newLatLng.lng && dr.oldLatLng?.lat !== dr.newLatLng.lat) {
      unsafeLeaked++;
    }
  }

  // duplicate suspicious coordinate 사후 검증(전체 DB 기준, write 이후 새 충돌이 생기지 않았는지)
  const allCoordRows = await prisma.apartmentMaster.findMany({ where: { latitude: { not: null } }, select: { aptSeq: true, latitude: true, longitude: true, geocodeQuality: true } });
  const coordGroups = new Map<string, typeof allCoordRows>();
  for (const r of allCoordRows) {
    const key = `${r.latitude!.toFixed(6)},${r.longitude!.toFixed(6)}`;
    if (!coordGroups.has(key)) coordGroups.set(key, []);
    coordGroups.get(key)!.push(r);
  }
  let newDuplicateGroupsInvolvingWrittenRows = 0;
  const writtenSet = new Set(writeResult.updatedRows.map((r: any) => r.aptSeq));
  for (const [, group] of coordGroups.entries()) {
    if (group.length < 2) continue;
    const exactMembers = group.filter((g) => g.geocodeQuality === 'exact');
    if (exactMembers.length === 1) continue; // production 정책상 안전(단일 exact만 신뢰)
    if (group.some((g) => writtenSet.has(g.aptSeq!))) newDuplicateGroupsInvolvingWrittenRows++;
  }

  const buckets = dryrun.buckets;
  const summary = {
    candidateCount: safeAptSeqs.length + unsafeAptSeqs.length,
    geocodeSuccess: dryrun.results.filter((r: any) => r.newLatLng != null).length,
    written: writeResult.updated,
    skippedUnsafe: unsafeAptSeqs.length,
    skippedAlreadyExact: writeResult.unchanged,
    failed: writeResult.failed,
    regionMismatch: dryrun.regionMismatch.length,
    duplicateSuspiciousAtDryrun: dryrun.duplicateSuspicious.length,
    over100m: buckets.under300m + buckets.under1km + buckets.over1km,
    over300m: buckets.under1km + buckets.over1km,
    over1km: buckets.over1km,
    unsafeLeakedIntoDb: unsafeLeaked,
    newAmbiguousDuplicateGroupsPostWrite: newDuplicateGroupsInvolvingWrittenRows,
    PASS: unsafeLeaked === 0 && writeResult.failed === 0 && newDuplicateGroupsInvolvingWrittenRows === 0,
  };

  console.log('=== RE-GEOCODE POST-WRITE VERIFY ===');
  console.log(JSON.stringify(summary, null, 1));

  fs.writeFileSync(path.resolve(__dirname, 'output/step07a-regeocode-post-verify.json'), JSON.stringify({ generatedAt: new Date().toISOString(), ...summary }, null, 1));

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
