// E-JIP SCORE V2 STEP 0.7-A §9 — rollback script.
// 사용법:
//   npx ts-node --transpile-only scripts/apartment-score/rollback-step07a-recovery.ts <manifest.json 경로>
//   기본값: dry-run(콘솔 diff만, DB write 없음)
//   --execute 플래그가 있어야 실제 rollback(DB write) 수행
// 원칙: snapshot을 읽음 / aptSeq exact match / dry-run default / row count 검증 /
// unknown·missing aptSeq 발생 시 STOP / blind update 금지(각 row를 현재 DB 값과
// 비교해 실제로 변경이 필요한 row만 update, 이미 snapshot과 동일하면 skip).
import fs from 'fs';
import path from 'path';

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  const manifestArg = args.find((a) => !a.startsWith('--'));
  if (!manifestArg) {
    console.error('사용법: rollback-step07a-recovery.ts <manifest.json 경로> [--execute]');
    process.exit(1);
  }
  const manifestPath = path.resolve(manifestArg);
  if (!fs.existsSync(manifestPath)) {
    console.error(`STOP: manifest 파일 없음: ${manifestPath}`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const jsonPath = path.resolve(path.dirname(manifestPath), '..', '..', manifest.jsonPath);
  if (!fs.existsSync(jsonPath)) {
    console.error(`STOP: snapshot json 파일 없음: ${jsonPath}`);
    process.exit(1);
  }

  const crypto = await import('crypto');
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(jsonPath)).digest('hex');
  if (sha256 !== manifest.sha256) {
    console.error(`STOP: snapshot 파일 SHA256 불일치(변조/손상 의심). manifest=${manifest.sha256} actual=${sha256}`);
    process.exit(1);
  }
  console.log(`snapshot 무결성 확인: SHA256 일치(${sha256.slice(0, 16)}...)`);

  const snapshotRows: any[] = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  if (snapshotRows.length !== manifest.rowCount) {
    console.error(`STOP: snapshot row count(${snapshotRows.length}) != manifest.rowCount(${manifest.rowCount})`);
    process.exit(1);
  }
  console.log(`snapshot rows: ${snapshotRows.length}건, mode=${execute ? 'EXECUTE' : 'DRY-RUN'}`);

  const { prisma } = await import('../../src/lib/prisma');

  const aptSeqs = snapshotRows.map((r) => r.aptSeq);
  const currentRows = await prisma.apartmentMaster.findMany({ where: { aptSeq: { in: aptSeqs } } });
  const currentByAptSeq = new Map(currentRows.map((r) => [r.aptSeq!, r]));

  const missing = aptSeqs.filter((s) => !currentByAptSeq.has(s));
  if (missing.length > 0) {
    console.error(`STOP: 현재 DB에 없는(삭제된) aptSeq ${missing.length}건 — rollback 대상 불명확, blind update 금지`);
    console.error(missing.slice(0, 20));
    process.exit(1);
  }

  const FIELDS = ['roadAddress', 'jibunAddress', 'totalHouseholds', 'mgmBldrgstPk'] as const;
  const plan: Array<{ aptSeq: string; changes: Record<string, { before: any; after: any }> }> = [];
  for (const snap of snapshotRows) {
    const cur = currentByAptSeq.get(snap.aptSeq)!;
    const changes: Record<string, { before: any; after: any }> = {};
    for (const f of FIELDS) {
      if ((cur as any)[f] !== snap[f]) changes[f] = { before: (cur as any)[f], after: snap[f] };
    }
    if (Object.keys(changes).length > 0) plan.push({ aptSeq: snap.aptSeq, changes });
  }

  console.log(`\nrollback 대상(현재값이 snapshot과 다른 row): ${plan.length}건 / 전체 ${snapshotRows.length}건`);
  console.log('샘플(최대 10):', JSON.stringify(plan.slice(0, 10), null, 1));

  if (!execute) {
    console.log('\nDRY-RUN 모드 — DB write 없음. 실제 적용하려면 --execute 플래그를 추가하세요.');
    await prisma.$disconnect();
    return;
  }

  console.log('\nEXECUTE 모드 — 실제 rollback 시작...');
  let updated = 0, failed = 0;
  const failedRows: any[] = [];
  for (const p of plan) {
    const snap = snapshotRows.find((s) => s.aptSeq === p.aptSeq)!;
    try {
      await prisma.apartmentMaster.update({
        where: { aptSeq: p.aptSeq },
        data: {
          roadAddress: snap.roadAddress,
          jibunAddress: snap.jibunAddress,
          totalHouseholds: snap.totalHouseholds,
          mgmBldrgstPk: snap.mgmBldrgstPk,
        },
      });
      updated++;
    } catch (e: any) {
      failed++;
      failedRows.push({ aptSeq: p.aptSeq, error: e.message });
    }
  }
  console.log(`\nrollback 완료: updated=${updated}, failed=${failed}, unchanged(이미 snapshot과 동일)=${snapshotRows.length - plan.length}`);
  if (failedRows.length > 0) console.log('failed rows:', JSON.stringify(failedRows, null, 1));

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
