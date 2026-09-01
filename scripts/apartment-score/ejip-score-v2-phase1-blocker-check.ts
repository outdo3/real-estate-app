/**
 * E-JIP SCORE V2 — PHASE 1. Quantifies the BLOCKER found during code audit:
 * calculateApartmentScore() (src/lib/apartment-score/server/calculate.ts)
 * computes V2's shadow result unconditionally (line ~150), but its
 * INSUFFICIENT_DATA return path (V1's own coverage<0.6 gate) omits
 * `_shadowV2` from the returned object entirely — so a caller relying on
 * calculateApartmentScore() alone can never see a V2 result for apartments
 * where V1's unrelated peer-percentile coverage fails, even if V2 itself
 * would report SCORE_AVAILABLE or LIMITED.
 *
 * This script independently replicates just the V2 input path (adaptToV2Input
 * + calculateScoreV2) for every apartment where calculateApartmentScore()
 * returned a non-OK status, to measure how many are wrongly suppressed.
 * READ-ONLY.
 *
 * 사용법:
 *   npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js scripts/apartment-score/ejip-score-v2-phase1-blocker-check.ts
 */
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { prisma } from '@/lib/prisma';
import { calculateApartmentScore } from '@/lib/apartment-score/server/calculate';
import { calculateScoreV2 } from '@/lib/score-v2/engine';
import { adaptToV2Input } from '@/lib/score-v2/adapter';
import { getApartmentEducationZone } from '@/lib/education/attendance-zone';

const SIDO_VALUE = '부산';

async function main() {
  const allMaster = await prisma.apartmentMaster.findMany({
    where: { sido: SIDO_VALUE, aptSeq: { not: null } },
    select: {
      aptSeq: true, name: true, sigungu: true, umdName: true,
      buildYear: true, totalHouseholds: true, parkingCount: true,
      mainBuildingCount: true, geocodeQuality: true, sggCd: true,
    },
  });
  const locFeatures = await prisma.apartmentLocationFeature.findMany();
  const locAptSeqs = new Set(locFeatures.map((r) => r.aptSeq));
  const locByAptSeq = new Map(locFeatures.map((r) => [r.aptSeq, r]));
  let targets = allMaster.filter((r) => locAptSeqs.has(r.aptSeq!) && r.sggCd != null);
  const limitArg = process.argv[2] ? parseInt(process.argv[2], 10) : null;
  if (limitArg) targets = targets.slice(0, limitArg);

  console.log(`대상: ${targets.length}건 — V1 status(calculateApartmentScore) vs 독립 재계산 V2 eligibility 비교\n`);

  let checked = 0;
  let v1NonOk = 0;
  const suppressed: { aptSeq: string; name: string; v1Status: string; v1Coverage: number | null; v2Eligibility: string; v2Score: number | null }[] = [];
  const v1NonOkV2Breakdown: Record<string, number> = {};

  for (const t of targets) {
    checked++;
    if (checked % 500 === 0) console.log(`  ...${checked}/${targets.length}`);

    const v1 = await calculateApartmentScore(t.aptSeq!);
    if (v1.status === 'OK') continue; // only interested in the suppressed set
    v1NonOk++;

    // Independently replicate the exact same V2 input path calculate.ts uses.
    let v2EligibilityIndependent = 'ERROR';
    let v2ScoreIndependent: number | null = null;
    try {
      const eduZone = getApartmentEducationZone(t.aptSeq!);
      const attendanceZoneStatus = eduZone ? eduZone.elementary.status : 'NOT_AVAILABLE';
      const masterInput: any = { ...t };
      const v2Input = adaptToV2Input(masterInput, locByAptSeq.get(t.aptSeq!) ?? null, attendanceZoneStatus as any);
      const v2 = calculateScoreV2(v2Input, 2026);
      v2EligibilityIndependent = v2.eligibility;
      v2ScoreIndependent = v2.overallScore != null ? Math.round(v2.overallScore) : null;
    } catch (e: any) {
      v2EligibilityIndependent = `THROW:${e?.message || e}`;
    }

    v1NonOkV2Breakdown[v2EligibilityIndependent] = (v1NonOkV2Breakdown[v2EligibilityIndependent] || 0) + 1;

    if (v2EligibilityIndependent === 'SCORE_AVAILABLE' || v2EligibilityIndependent === 'LIMITED') {
      suppressed.push({
        aptSeq: t.aptSeq!,
        name: t.name,
        v1Status: v1.status,
        v1Coverage: v1.coverage,
        v2Eligibility: v2EligibilityIndependent,
        v2Score: v2ScoreIndependent,
      });
    }
  }

  console.log(`\n=== RESULT ===`);
  console.log(`V1(calculateApartmentScore) non-OK count: ${v1NonOk} / ${targets.length} (${((v1NonOk / targets.length) * 100).toFixed(1)}%)`);
  console.log(`Among those V1-non-OK apartments, independent V2 eligibility breakdown:`, v1NonOkV2Breakdown);
  console.log(`\n⚠️ SUPPRESSED (V1 blocks display, but V2 itself would show a real score): ${suppressed.length} apartments`);
  console.log(`This is ${((suppressed.length / targets.length) * 100).toFixed(1)}% of the entire Busan universe with location-feature coverage.`);
  console.log(`\nSample of suppressed apartments (up to 15):`);
  suppressed.slice(0, 15).forEach((s) => console.log(`  ${s.aptSeq} ${s.name} — V1=${s.v1Status}(cov=${s.v1Coverage?.toFixed(2)}) but V2=${s.v2Eligibility} score=${s.v2Score}`));

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
