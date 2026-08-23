// E-JIP SCORE V2 STEP 0.7-A §12 — registry write 직후 검증(read-only).
import fs from 'fs';
import path from 'path';

const PLAN_PATH = path.resolve(__dirname, 'output/step07a-write-plan.json');
const RESULT_PATH = path.resolve(__dirname, 'output/step07a-write-result.json');

async function main() {
  const { prisma } = await import('../../src/lib/prisma');

  const plan = JSON.parse(fs.readFileSync(PLAN_PATH, 'utf-8'));
  const result = JSON.parse(fs.readFileSync(RESULT_PATH, 'utf-8'));
  const writePlan: any[] = plan.writePlan;

  console.log('=== write result ===', JSON.stringify({ attempted: result.attempted, updated: result.updated, unchanged: result.unchanged, failed: result.failed }, null, 1));
  console.log(`expected updated == ${writePlan.length}: actual=${result.updated}, match=${result.updated === writePlan.length}`);

  const aptSeqs = writePlan.map((w) => w.aptSeq);
  const rows = await prisma.apartmentMaster.findMany({ where: { aptSeq: { in: aptSeqs } } });

  // duplicate aptSeq 확인(DB unique 제약이 있으나 이중 확인)
  const seqCounts = new Map<string, number>();
  for (const r of rows) seqCounts.set(r.aptSeq!, (seqCounts.get(r.aptSeq!) ?? 0) + 1);
  const dupes = [...seqCounts.entries()].filter(([, c]) => c > 1);
  console.log(`\nduplicate aptSeq: ${dupes.length}건`, dupes.slice(0, 10));

  // cross-lawdCd change 확인(sggCd는 이번 write 대상 필드가 아님 — 변경 자체가 없어야 함)
  const byAptSeq = new Map(rows.map((r) => [r.aptSeq!, r]));
  let crossRegion = 0;
  let leakageNonHigh = 0;
  let missingWrite = 0;
  for (const w of writePlan) {
    const r = byAptSeq.get(w.aptSeq);
    if (!r) { missingWrite++; continue; }
    if (r.sggCd !== w.lawdCd) crossRegion++;
    // HIGH-only 대상이었는지 재확인(원본 write plan 자체가 HIGH filter를 통과했으므로
    // leakage는 "write plan 생성 로직 버그"가 있을 때만 발생 — 방어적 재확인)
    const wasWritten = r.roadAddress === w.after.roadAddress && r.jibunAddress === w.after.jibunAddress
      && r.totalHouseholds === w.after.totalHouseholds && r.mgmBldrgstPk === w.after.mgmBldrgstPk;
    if (!wasWritten) leakageNonHigh++;
  }
  console.log(`cross-lawdCd change(예상 0): ${crossRegion}건`);
  console.log(`missing(DB에서 못 찾음, 예상 0): ${missingWrite}건`);
  console.log(`값 불일치(write가 실제로 반영 안 된 row, 예상 0): ${leakageNonHigh}건`);

  // identity collision(동일 normalizedName+lawdCd+jibun 중복 신규 발생 여부) — write는 jibun을
  // 바꾸지 않으므로 이론상 발생 불가하나 방어적으로 재확인
  const allMasters = await prisma.apartmentMaster.findMany({
    where: { sggCd: { in: [...new Set(writePlan.map((w) => w.lawdCd))] } },
    select: { aptSeq: true, normalizedName: true, sggCd: true, jibun: true },
  });
  const key = (m: any) => `${m.normalizedName}::${m.sggCd}::${m.jibun}`;
  const groups = new Map<string, string[]>();
  for (const m of allMasters) {
    const k = key(m);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(m.aptSeq!);
  }
  const wrongMergeCandidates = [...groups.entries()].filter(([, seqs]) => seqs.length > 1);
  console.log(`\nidentity collision(동일 name+lawdCd+jibun, 서로 다른 aptSeq) 후보: ${wrongMergeCandidates.length}건`);
  if (wrongMergeCandidates.length > 0) console.log(JSON.stringify(wrongMergeCandidates.slice(0, 10), null, 1));

  const summary = {
    expectedUpdated: writePlan.length,
    actualUpdated: result.updated,
    unchangedCount: result.unchanged,
    failedCount: result.failed,
    duplicateAptSeq: dupes.length,
    crossRegionChange: crossRegion,
    missingAfterWrite: missingWrite,
    valueMismatch: leakageNonHigh,
    wrongMergeCount: wrongMergeCandidates.length,
    PASS: dupes.length === 0 && crossRegion === 0 && missingWrite === 0 && leakageNonHigh === 0 && wrongMergeCandidates.length === 0 && result.updated === writePlan.length,
  };
  console.log('\n=== POST-WRITE VERIFY SUMMARY ===');
  console.log(JSON.stringify(summary, null, 1));

  fs.writeFileSync(path.resolve(__dirname, 'output/step07a-post-write-verify.json'), JSON.stringify({ generatedAt: new Date().toISOString(), ...summary }, null, 1));

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
