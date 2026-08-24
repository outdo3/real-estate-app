import { prisma } from '../../src/lib/prisma';
import { adaptToV2Input } from '../../src/lib/score-v2/adapter';
import { calculateScoreV2 } from '../../src/lib/score-v2/engine';

async function run() {
  const masters = await prisma.apartmentMaster.findMany({
    where: { sggCd: { startsWith: '26' } }, // Busan
  });
  const locations = await prisma.apartmentLocationFeature.findMany({
    where: { aptSeq: { in: masters.map(m => m.aptSeq!) } }
  });

  const locMap = new Map(locations.map(l => [l.aptSeq, l]));

  let availableBefore = 0;
  let notEnoughBefore = 0;
  let availableAfter = 0;
  let notEnoughAfter = 0;

  for (const m of masters) {
    if (!m.aptSeq || !m.sggCd) continue;
    
    const loc = locMap.get(m.aptSeq) ?? null;

    // Simulate BEFORE (identityEligible = loc != null)
    const eligibleBefore = loc != null;
    let statusBefore = 'NOT_ENOUGH_DATA';
    if (eligibleBefore) {
      const v2InputBefore = adaptToV2Input(m as any, loc as any);
      v2InputBefore.identityEligible = true; // Override to simulate before
      const resBefore = calculateScoreV2(v2InputBefore, 2026);
      statusBefore = resBefore.eligibility;
    }

    if (statusBefore === 'SCORE_AVAILABLE' || statusBefore === 'LIMITED') availableBefore++;
    else notEnoughBefore++;

    // AFTER (adapter logic)
    const v2InputAfter = adaptToV2Input(m as any, loc as any);
    const resAfter = calculateScoreV2(v2InputAfter, 2026);
    const statusAfter = resAfter.eligibility;

    if (statusAfter === 'SCORE_AVAILABLE' || statusAfter === 'LIMITED') availableAfter++;
    else notEnoughAfter++;
  }

  console.log(`BEFORE: SCORE_AVAILABLE (incl LIMITED) = ${availableBefore}, NOT_ENOUGH_DATA = ${notEnoughBefore}`);
  console.log(`AFTER : SCORE_AVAILABLE (incl LIMITED) = ${availableAfter}, NOT_ENOUGH_DATA = ${notEnoughAfter}`);
}

run().finally(() => prisma.$disconnect());
