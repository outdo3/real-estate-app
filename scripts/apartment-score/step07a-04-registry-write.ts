// E-JIP SCORE V2 STEP 0.7-A §11/§12 — registry identity/linkage write.
// 기본값: dry-run(요약만 출력, DB write 없음). --apply 플래그가 있어야 실제 write.
// 대상: output/step07a-write-plan.json(RECOVERY_HIGH-only, 1,235건 예상).
// 필드: roadAddress, jibunAddress, totalHouseholds, mgmBldrgstPk만(§26 승인 범위).
// precedence: 기존 값이 이미 non-null이면(=VERIFIED_EXISTING 또는 이미 이 write가
// 적용된 idempotent 재실행) 절대 덮어쓰지 않고 unchanged로 카운트.
// 매 row apply 직전 현재 DB 값을 재조회해 최종 방어선으로 재확인(레이스 컨디션 대비).
import fs from 'fs';
import path from 'path';

const PLAN_PATH = path.resolve(__dirname, 'output/step07a-write-plan.json');
const RESULT_PATH = path.resolve(__dirname, 'output/step07a-write-result.json');
const FAILED_PATH = path.resolve(__dirname, 'output/step07a-write-failed-rows.json');

async function main() {
  const apply = process.argv.includes('--apply');
  const { prisma } = await import('../../src/lib/prisma');

  const plan = JSON.parse(fs.readFileSync(PLAN_PATH, 'utf-8'));
  const writePlan: any[] = plan.writePlan;
  console.log(`write plan: ${writePlan.length}건, mode=${apply ? 'APPLY' : 'DRY-RUN'}`);

  let attempted = 0, updated = 0, unchanged = 0, failed = 0;
  const failedRows: any[] = [];
  const updatedRows: any[] = [];
  const unchangedRows: any[] = [];

  for (const w of writePlan) {
    attempted++;
    if (!apply) continue;

    try {
      // 최종 방어선: apply 직전 현재 DB 값 재확인(레이스 컨디션/이미 write된 상태 대비)
      const cur = await prisma.apartmentMaster.findUnique({
        where: { aptSeq: w.aptSeq },
        select: { roadAddress: true, jibunAddress: true, totalHouseholds: true, mgmBldrgstPk: true },
      });
      if (!cur) {
        failed++;
        failedRows.push({ aptSeq: w.aptSeq, error: 'row not found at apply time' });
        continue;
      }
      const alreadyWritten = cur.roadAddress != null || cur.jibunAddress != null || cur.totalHouseholds != null || cur.mgmBldrgstPk != null;
      if (alreadyWritten) {
        unchanged++;
        unchangedRows.push({ aptSeq: w.aptSeq, reason: 'already non-null at apply time (idempotent skip)' });
        continue;
      }

      await prisma.apartmentMaster.update({
        where: { aptSeq: w.aptSeq },
        data: {
          roadAddress: w.after.roadAddress,
          jibunAddress: w.after.jibunAddress,
          totalHouseholds: w.after.totalHouseholds,
          mgmBldrgstPk: w.after.mgmBldrgstPk,
        },
      });
      updated++;
      updatedRows.push({ aptSeq: w.aptSeq, aptName: w.aptName });
    } catch (e: any) {
      failed++;
      failedRows.push({ aptSeq: w.aptSeq, error: e.message });
    }
    if (attempted % 200 === 0) console.log(`[${attempted}/${writePlan.length}] updated=${updated} unchanged=${unchanged} failed=${failed}`);
  }

  if (!apply) {
    console.log(`\nDRY-RUN: 실제 적용 시 attempted=${writePlan.length}건 예정. 실제 적용하려면 --apply 플래그를 추가하세요.`);
    await prisma.$disconnect();
    return;
  }

  console.log(`\n=== WRITE RESULT ===`);
  console.log(JSON.stringify({ attempted, updated, unchanged, failed }, null, 1));

  fs.writeFileSync(RESULT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), attempted, updated, unchanged, failed, updatedRows, unchangedRows }, null, 1));
  if (failedRows.length > 0) {
    fs.writeFileSync(FAILED_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), failedRows }, null, 1));
    console.log(`FAILED_ROWS artifact 저장: ${FAILED_PATH} (재시도 가능, 재실행은 idempotent)`);
  }
  console.log(`결과 저장: ${RESULT_PATH}`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
