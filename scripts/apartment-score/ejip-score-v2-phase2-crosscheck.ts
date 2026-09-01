// EJIP_SCORE_V2_PHASE2 — QA §32 cross-check: verify the PHASE 2 production
// peer-context implementation (peer-context.ts's real buildPeerUniverse +
// getPeerContext) reproduces the PHASE 1.6 simulation's own recorded
// level/comparisonCount/peerCount/percentile/confidence for the same
// apartments, bit-for-bit. Read-only — no writes. Reports mismatch count,
// which must be 0 per the task's explicit requirement.
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), override: true });

import { prisma } from '@/lib/prisma';
import { getPeerContext } from '@/lib/apartment-score/peer-context';

const LEVEL_MAP: Record<number, string> = {
  1: 'SIGUNGU_DECADE_SIZE',
  2: 'SIGUNGU_DECADE',
  3: 'DECADE_BUSAN',
  4: 'BUSAN_ALL',
};

async function main() {
  const jsonPath = path.resolve(__dirname, 'output/score-v2-phase1_6-verification.json');
  const doc = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const samples: any[] = [
    ...doc.sampleAudit.bottom10,
    ...doc.sampleAudit.middle10,
    ...doc.sampleAudit.top10,
  ];

  console.log(`총 ${samples.length}개 샘플 cross-check 시작 (PHASE 1.6 sampleAudit: bottom10+middle10+top10)`);

  let mismatches = 0;
  const results: any[] = [];

  for (const s of samples) {
    const master = await prisma.apartmentMaster.findUnique({
      where: { aptSeq: s.aptSeq },
      select: { aptSeq: true, name: true, sigungu: true, umdName: true, buildYear: true, totalHouseholds: true },
    });
    if (!master) {
      results.push({ aptSeq: s.aptSeq, name: s.name, error: 'ApartmentMaster not found' });
      mismatches++;
      continue;
    }

    const ctx = await getPeerContext({
      aptSeq: master.aptSeq!,
      sigungu: master.sigungu,
      buildYear: master.buildYear,
      totalHouseholds: master.totalHouseholds,
      v2Score: s.v2Score,
    });

    const expectedLevel = LEVEL_MAP[s.level] ?? null;
    const checks = {
      level: ctx.level === expectedLevel,
      comparisonCount: ctx.comparisonCount === s.comparisonCount,
      peerCount: ctx.peerCount === s.peerCountExcludingSelf,
      percentile: ctx.percentile === s.percentile,
      confidence: ctx.confidence === s.confidence,
    };
    const allMatch = Object.values(checks).every(Boolean);
    if (!allMatch) mismatches++;

    results.push({
      aptSeq: s.aptSeq,
      name: s.name,
      match: allMatch,
      checks: allMatch ? undefined : checks,
      expected: allMatch ? undefined : { level: expectedLevel, comparisonCount: s.comparisonCount, peerCount: s.peerCountExcludingSelf, percentile: s.percentile, confidence: s.confidence },
      actual: allMatch ? undefined : { level: ctx.level, comparisonCount: ctx.comparisonCount, peerCount: ctx.peerCount, percentile: ctx.percentile, confidence: ctx.confidence },
    });
  }

  const outPath = path.resolve(__dirname, 'output/score-v2-phase2-crosscheck.json');
  fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), totalSamples: samples.length, mismatches, results }, null, 2));

  console.log(`총 샘플: ${samples.length}, mismatch: ${mismatches}`);
  if (mismatches > 0) {
    console.log('불일치 샘플:', JSON.stringify(results.filter((r) => !r.match), null, 2));
  }
  console.log(`결과 저장: ${outPath}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
