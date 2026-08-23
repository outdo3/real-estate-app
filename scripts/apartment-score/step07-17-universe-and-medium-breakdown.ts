// E-JIP SCORE V2 STEP 0.7 §20/§24/§25 — MEDIUM 세부 사유 분리 + universe validity
// 최종 분류(VALID_APARTMENT/VALID_SMALL_APARTMENT/MIXED_USE/NON_TARGET/UNKNOWN).
// READ-ONLY.
import fs from 'fs';
import path from 'path';

async function main() {
  const classified = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'output/step07-recovery-classification.json'), 'utf-8')) as any[];

  const mediums = classified.filter((c) => c.recovery.level === 'RECOVERY_MEDIUM');
  const nonResidential = mediums.filter((c) => c.recovery.universeFlag === 'MIXED_USE' || c.recovery.universeFlag === 'NON_TARGET');
  const noHouseholds = mediums.filter((c) => c.recovery.universeFlag === 'VALID_APARTMENT' && c.probe.totalHouseholds == null);
  console.log(`[§20] RECOVERY_MEDIUM(${mediums.length}건) 세부 사유:`);
  console.log(`  주용도 비-공동주택(MIXED_USE/NON_TARGET): ${nonResidential.length}건`);
  console.log(`  공동주택이나 세대수 필드 없음: ${noHouseholds.length}건`);

  // universe validity + 규모(VALID_SMALL_APARTMENT는 법정 기준 아닌 서술적 구분 —
  // "30세대 미만"을 이 STEP에서 관찰된 기준으로 명시, 법적 정의로 오인되지 않게 라벨링)
  const finalUniverse = { VALID_APARTMENT: 0, VALID_SMALL_APARTMENT: 0, MIXED_USE: 0, NON_TARGET: 0, UNKNOWN: 0 };
  for (const c of classified) {
    const flag = c.recovery.universeFlag;
    if (flag === 'VALID_APARTMENT') {
      const h = c.probe.totalHouseholds;
      if (h != null && h < 30) finalUniverse.VALID_SMALL_APARTMENT++;
      else finalUniverse.VALID_APARTMENT++;
    } else {
      finalUniverse[flag as keyof typeof finalUniverse]++;
    }
  }
  console.log('\n[§24/§25] universe validity 최종 분류(30세대 미만은 서술적 구분, 법정 기준 아님):');
  console.log(JSON.stringify(finalUniverse, null, 1));

  // RECOVERY level x universe validity 교차
  const cross: Record<string, Record<string, number>> = {};
  for (const c of classified) {
    const lvl = c.recovery.level;
    const uf = c.recovery.universeFlag;
    cross[lvl] = cross[lvl] ?? {};
    cross[lvl][uf] = (cross[lvl][uf] ?? 0) + 1;
  }
  console.log('\nRECOVERY level x universe validity 교차표:');
  console.log(JSON.stringify(cross, null, 1));

  // NON_TARGET/MIXED_USE 샘플(수동검토 참고용)
  const samples = classified.filter((c) => c.recovery.universeFlag === 'NON_TARGET').slice(0, 5);
  console.log('\nNON_TARGET 샘플:', JSON.stringify(samples.map((s: any) => ({ aptSeq: s.aptSeq, name: s.aptName, purpose: s.probe.mainPurpsCdNm, level: s.recovery.level })), null, 1));
}
main().catch((e) => { console.error(e); process.exit(1); });
