// E-JIP SCORE V2 STEP 0.7-A §8 — immutable snapshot(write 직전).
// 입력: output/step07a-write-plan.json의 writePlan(1,235건 예상).
// ApartmentMaster의 전체 mutable column을 스냅샷(schema에 실제 존재하는 필드만,
// FAR/BCR 등 이 모델에 없는 필드는 포함하지 않는다 — 다른 테이블 소관).
// 출력: data/recovery-snapshots/score-v2-step07a-before-YYYYMMDD-HHMMSS.json(+csv) + SHA256.
// row count가 write candidate count와 다르면 STOP.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const PLAN_PATH = path.resolve(__dirname, 'output/step07a-write-plan.json');
const SNAPSHOT_DIR = path.resolve(__dirname, '../../data/recovery-snapshots');

function csvEscape(v: any): string {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  const { prisma } = await import('../../src/lib/prisma');

  const plan = JSON.parse(fs.readFileSync(PLAN_PATH, 'utf-8'));
  const writePlan: any[] = plan.writePlan;
  const aptSeqs: string[] = writePlan.map((w) => w.aptSeq);
  console.log(`write candidate: ${aptSeqs.length}건`);

  const rows = await prisma.apartmentMaster.findMany({
    where: { aptSeq: { in: aptSeqs } },
  });
  console.log(`DB 조회: ${rows.length}건`);

  if (rows.length !== aptSeqs.length) {
    console.error(`STOP: snapshot row count(${rows.length}) != write candidate count(${aptSeqs.length})`);
    const found = new Set(rows.map((r) => r.aptSeq));
    const missing = aptSeqs.filter((s) => !found.has(s));
    console.error('missing aptSeq:', missing);
    process.exit(1);
  }

  const ts = new Date();
  const stamp = ts.toISOString().replace(/[-:T]/g, '').slice(0, 15); // YYYYMMDD-HHMMSS 근사
  const stampFormatted = `${stamp.slice(0, 8)}-${stamp.slice(8, 14)}`;

  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const jsonPath = path.join(SNAPSHOT_DIR, `score-v2-step07a-before-${stampFormatted}.json`);
  const csvPath = path.join(SNAPSHOT_DIR, `score-v2-step07a-before-${stampFormatted}.csv`);

  // Prisma Date -> ISO string으로 직렬화(원본 필드 그대로, 임의 가공 없음)
  const serializable = rows.map((r) => ({
    ...r,
    createdAt: r.createdAt?.toISOString() ?? null,
    updatedAt: r.updatedAt?.toISOString() ?? null,
  }));
  fs.writeFileSync(jsonPath, JSON.stringify(serializable, null, 1));

  const columns = Object.keys(serializable[0]);
  const csvLines = [columns.join(',')];
  for (const r of serializable) csvLines.push(columns.map((c) => csvEscape((r as any)[c])).join(','));
  fs.writeFileSync(csvPath, csvLines.join('\n'));

  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(jsonPath)).digest('hex');
  const manifest = {
    generatedAt: ts.toISOString(),
    branch: 'score-v2-step07a-safe-recovery-write',
    step: 'STEP 0.7-A',
    rowCount: rows.length,
    writeCandidateCount: aptSeqs.length,
    matches: rows.length === aptSeqs.length,
    jsonPath: path.relative(path.resolve(__dirname, '../..'), jsonPath),
    csvPath: path.relative(path.resolve(__dirname, '../..'), csvPath),
    sha256,
    aptSeqs,
  };
  const manifestPath = path.join(SNAPSHOT_DIR, `score-v2-step07a-before-${stampFormatted}.manifest.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));

  console.log(`\n스냅샷 저장: ${jsonPath}`);
  console.log(`CSV 저장: ${csvPath}`);
  console.log(`manifest 저장: ${manifestPath}`);
  console.log(`SHA256: ${sha256}`);
  console.log(`row count 일치: ${manifest.matches}`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
