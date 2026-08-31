/**
 * MASTER_MISSING_REPAIR_V1 — 사용자 승인 범위: RECENT_MASTER_MISSING_16_AUDIT_V1이
 * READY_FOR_MASTER_CREATE로 확정한 16건만 ApartmentMaster에 신규 생성한다.
 *
 * 절대 원칙:
 *  - `--apply` 없이는 DB에 절대 쓰지 않는다(기본은 dry-run).
 *  - INSERT만 한다 — 기존 row는 절대 UPDATE하지 않는다(중복이면 skip).
 *  - candidate 파일의 16건 외에는 어떤 row도 만들지 않는다(masterCreateReadiness
 *    필터로 강제).
 *  - secondary metadata(totalHouseholds/좌표/parking/FAR·BCR/approvalDate 등)는
 *    전혀 채우지 않는다 — 공식 근거 없이 null로 남긴다(scripts/repair-recent-missing-
 *    masters-logic.ts의 buildMasterRowPlan 참고).
 *  - 새 aptSeq를 만들지 않는다 — candidate의 MOLIT aptSeq를 그대로 쓴다.
 *
 * 사용법:
 *   npx ts-node --compiler-options '{"module":"commonjs"}' \
 *     scripts/repair-recent-missing-masters.ts            # dry-run(기본)
 *   npx ts-node --compiler-options '{"module":"commonjs"}' \
 *     scripts/repair-recent-missing-masters.ts --apply     # 실제 반영
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { prisma } from '../src/lib/prisma';
import { buildAllPlans, type RepairCandidate } from './repair-recent-missing-masters-logic';

const CANDIDATE_FILE = path.resolve(__dirname, '../data/master-integrity/recent-master-missing-16-v1.json');

async function main() {
  const apply = process.argv.includes('--apply');

  const file = JSON.parse(fs.readFileSync(CANDIDATE_FILE, 'utf-8'));
  const allCandidates: RepairCandidate[] = file.rows;
  const readyCandidates = allCandidates.filter((c) => c.masterCreateReadiness === 'READY_FOR_MASTER_CREATE');

  console.log(`candidate file: ${CANDIDATE_FILE}`);
  console.log(`전체 candidate: ${allCandidates.length}, READY_FOR_MASTER_CREATE: ${readyCandidates.length}`);

  // §7 DUPLICATE SAFETY — 실행 직전 실제 DB에서 aptSeq 중복 여부 재확인(파일 생성
  // 시점 이후 다른 작업이 같은 aptSeq를 만들었을 가능성 배제).
  const candidateAptSeqs = allCandidates.map((c) => c.aptSeq);
  const existing = await prisma.apartmentMaster.findMany({
    where: { aptSeq: { in: candidateAptSeqs } },
    select: { aptSeq: true },
  });
  const existingAptSeqs = new Set(existing.map((e) => e.aptSeq!));

  const plans = buildAllPlans(allCandidates, existingAptSeqs);

  const willInsert = plans.filter((p) => p.action === 'INSERT');
  const willSkipDuplicate = plans.filter((p) => p.action === 'SKIP_DUPLICATE');
  const willReject = plans.filter((p) => p.action === 'REJECT_MISSING_FIELD');
  const willSkipNotReady = plans.filter((p) => p.action === 'SKIP_NOT_READY');

  console.log(`\n=== PLAN (${apply ? 'APPLY' : 'DRY-RUN'}) ===`);
  console.log(`will insert: ${willInsert.length}`);
  console.log(`duplicate(skip): ${willSkipDuplicate.length}`);
  console.log(`invalid(reject): ${willReject.length}`);
  console.log(`not-ready(skip): ${willSkipNotReady.length}`);

  for (const p of plans) {
    console.log(`  ${p.aptSeq}: ${p.action} — ${p.reason}`);
  }

  if (!apply) {
    console.log('\n[DRY-RUN] DB write 없음. --apply로 실제 반영.');
    await prisma.$disconnect();
    return;
  }

  if (willInsert.length === 0) {
    console.log('\n[APPLY] insert 대상 0건 — 종료.');
    await prisma.$disconnect();
    return;
  }

  console.log(`\n=== APPLYING ${willInsert.length}건 ===`);
  const results: { aptSeq: string; id: number; name: string; lawdCd: string; dong: string; jibun: string }[] = [];
  const failures: { aptSeq: string; error: string }[] = [];

  for (const plan of willInsert) {
    const data = plan.data!;
    try {
      const created = await prisma.apartmentMaster.create({ data });
      results.push({ aptSeq: created.aptSeq!, id: created.id, name: created.name, lawdCd: created.sggCd!, dong: created.umdName!, jibun: created.jibun! });
      console.log(`  CREATED id=${created.id} aptSeq=${created.aptSeq} name="${created.name}" (${created.sggCd}/${created.umdName}/${created.jibun})`);
    } catch (e: any) {
      failures.push({ aptSeq: plan.aptSeq, error: e?.message || String(e) });
      console.error(`  [ERROR] aptSeq=${plan.aptSeq}: ${e?.message || e}`);
    }
  }

  console.log(`\n=== RESULT ===`);
  console.log(`inserted: ${results.length}, failed: ${failures.length}`);

  const resultsDir = path.resolve(__dirname, '_repair_recent_missing_masters_results');
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(
    path.join(resultsDir, `apply-${new Date().toISOString().replace(/[:.]/g, '-')}.json`),
    JSON.stringify({ inserted: results, failed: failures, skippedDuplicate: willSkipDuplicate.map((p) => p.aptSeq), rejected: willReject }, null, 2)
  );

  await prisma.$disconnect();
}

main()
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error('FATAL:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
