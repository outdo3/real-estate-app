// E-JIP SCORE V2 STEP 0.7 §16 — step07-06 sweep 결과(JSON)에 resolver(§4)를 적용해
// RECOVERY_HIGH/MEDIUM/REVIEW/FAILED 분류 + 집계. READ-ONLY, DB write 없음.
import fs from 'fs';
import path from 'path';
import { prisma } from '../../src/lib/prisma';
import { classifyRecovery } from './lib/step07-recovery-resolver';
import type { RegistryProbeResult } from './lib/step07-registry-probe';

const SWEEP_PATH = path.resolve(__dirname, 'output/step07-registry-sweep.json');
const OUT_PATH = path.resolve(__dirname, 'output/step07-recovery-classification.json');

async function main() {
  const raw = fs.readFileSync(SWEEP_PATH, 'utf-8');
  const rows: Array<any & { probe: RegistryProbeResult }> = JSON.parse(raw);
  console.log(`sweep 결과 로드: ${rows.length}건`);

  const classified = rows.map((r) => ({
    ...r,
    recovery: classifyRecovery({ aptSeq: r.aptSeq, aptName: r.aptName, buildYear: r.builtYear, probe: r.probe }),
  }));

  const byLevel: Record<string, number> = {};
  for (const c of classified) byLevel[c.recovery.level] = (byLevel[c.recovery.level] ?? 0) + 1;
  console.log('\n[§16] RECOVERY 등급 분포(전수):', JSON.stringify(byLevel, null, 1));
  for (const [k, v] of Object.entries(byLevel)) {
    console.log(`  ${k}: ${v}건 (${(100 * v / classified.length).toFixed(1)}%)`);
  }

  const byUniverse: Record<string, number> = {};
  for (const c of classified) byUniverse[c.recovery.universeFlag] = (byUniverse[c.recovery.universeFlag] ?? 0) + 1;
  console.log('\nuniverse validity 분포:', JSON.stringify(byUniverse, null, 1));

  const byNameMatch: Record<string, number> = {};
  for (const c of classified) byNameMatch[c.recovery.nameMatch] = (byNameMatch[c.recovery.nameMatch] ?? 0) + 1;
  console.log('name 비교 분포(비차단 정보용):', JSON.stringify(byNameMatch, null, 1));

  const highCount = classified.filter((c) => c.recovery.level === 'RECOVERY_HIGH').length;
  const highNameMismatch = classified.filter((c) => c.recovery.level === 'RECOVERY_HIGH' && (c.recovery.nameMatch === 'mismatch' || c.recovery.nameMatch === 'superset')).length;
  console.log(`\nRECOVERY_HIGH 중 이름 표기 차이가 있었던 비율: ${highNameMismatch}/${highCount} (${highCount ? (100 * highNameMismatch / highCount).toFixed(1) : 0}%) — 주소 단독으로도 대다수 회복 가능함을 뒷받침`);

  // 구·군(lawdCd)별 RECOVERY_HIGH 비율
  const byLawd = new Map<string, { total: number; high: number }>();
  for (const c of classified) {
    const key = c.lawdCd ?? 'null';
    if (!byLawd.has(key)) byLawd.set(key, { total: 0, high: 0 });
    const e = byLawd.get(key)!;
    e.total++;
    if (c.recovery.level === 'RECOVERY_HIGH') e.high++;
  }
  console.log('\n구·군별 RECOVERY_HIGH 비율:');
  for (const [k, v] of [...byLawd.entries()].sort((a, b) => b[1].total - a[1].total)) {
    console.log(`  ${k}: ${v.high}/${v.total} (${(100 * v.high / v.total).toFixed(1)}%)`);
  }

  // REVIEW 원인 분포(§17 adversarial case별 집계)
  const reviewReasons: Record<string, number> = {};
  for (const c of classified.filter((c) => c.recovery.level === 'RECOVERY_REVIEW')) {
    const key = c.recovery.reasons[0]?.split(' —')[0] ?? c.recovery.reasons[0] ?? 'unknown';
    reviewReasons[key] = (reviewReasons[key] ?? 0) + 1;
  }
  console.log('\nRECOVERY_REVIEW 사유 분포:', JSON.stringify(reviewReasons, null, 1));

  fs.writeFileSync(OUT_PATH, JSON.stringify(classified, null, 1));
  console.log(`\n결과 저장: ${OUT_PATH}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
