/**
 * E-JIP SCORE V2 STEP 3.5 §6-14 — P-A~E parking missing 모델 비교 + integrity
 * checks + benchmark regression + 추천. READ-ONLY.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { loadBusanRows, factorScores, type Row } from '../score-v2-step3/shared-loader';
import { subwayDistanceScoreV3, busDistanceScore, busCountScore, ageScore, elementaryDistanceScore, livingCountScore, LIVING_CATEGORY_SPECS } from '../score-v2-step3/curves-v3';
import { T1_70_30, educationComposeEA, livingComposeLA, composeTotalFromDomains, DOMAIN_WEIGHT_CANDIDATES } from '../score-v2-step3/composition-v3';
import { complexWithParkingModel, type ParkingModelId, type ParkingConditionalContext } from './composition-v35';
import type { LivingScores } from '../score-v2-step2/composition';

const GU_BY_LAWDCD: Record<string, string> = { '26110': '중구', '26140': '서구', '26170': '동구', '26200': '영도구', '26230': '부산진구', '26260': '동래구', '26290': '남구', '26320': '북구', '26350': '해운대구', '26380': '사하구', '26410': '금정구', '26440': '강서구', '26470': '연제구', '26500': '수영구', '26530': '사상구', '26710': '기장군' };
function mean(xs: number[]): number { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN; }
function median(xs: number[]): number { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; }
function pct(xs: number[], p: number): number { const s = [...xs].sort((a, b) => a - b); if (!s.length) return NaN; return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))]; }
function ageBand(age: number | null): string { if (age == null) return 'unknown'; if (age <= 10) return '0-10'; if (age <= 20) return '11-20'; if (age <= 30) return '21-30'; return '31+'; }
function hhBand(hh: number | null): string { if (hh == null) return 'unknown'; if (hh < 100) return '<100'; if (hh < 300) return '100-299'; if (hh < 500) return '300-499'; if (hh < 1000) return '500-999'; return '1000+'; }

async function main() {
  const { rows, prisma } = await loadBusanRows();
  const eligible = rows.filter((r) => r.eligible);

  // ---------------- Context 사전계산(KNOWN 모집단에서만, §6 M3 해부 겸 §7 P-D/E 준비) ----------------
  const knownRows = eligible.filter((r) => r.parkingRatio != null);
  const parkingFactorOf = (r: Row) => { const f = factorScores(r); return f.parking; };
  const byAgeBand = new Map<string, number[]>();
  for (const r of knownRows) { const b = ageBand(r.age); const pf = parkingFactorOf(r); if (pf == null) continue; if (!byAgeBand.has(b)) byAgeBand.set(b, []); byAgeBand.get(b)!.push(pf); }
  const eraNeutralByAgeBand: Record<string, number> = {};
  for (const [b, vals] of byAgeBand) eraNeutralByAgeBand[b] = mean(vals);
  console.log('[§6] M3 해부 — 현재 global neutral=50 vs KNOWN 모집단 age-band 평균 parking factor score:');
  console.log(`  ${JSON.stringify(eraNeutralByAgeBand)}`);
  console.log('  -> "50"이라는 값이 실제 KNOWN 분포의 평균과 얼마나 다른지 확인: age band별 실제 평균이 50과 최대 몇 점 차이나는지 =', Math.max(...Object.values(eraNeutralByAgeBand).map((v) => Math.abs(v - 50))).toFixed(1), 'pt');

  const byAgeScaleBand = new Map<string, number[]>();
  for (const r of knownRows) { const key = `${ageBand(r.age)}|${hhBand(r.households)}`; const pf = parkingFactorOf(r); if (pf == null) continue; if (!byAgeScaleBand.has(key)) byAgeScaleBand.set(key, []); byAgeScaleBand.get(key)!.push(pf); }
  const conservativeByAgeScaleBand: Record<string, number> = {};
  for (const [key, vals] of byAgeScaleBand) if (vals.length >= 3) conservativeByAgeScaleBand[key] = pct(vals, 25);
  const ctx: ParkingConditionalContext = { eraNeutralByAgeBand, conservativeByAgeScaleBand };

  // ---------------- factor/domain 계산(transport/education/living 고정, complex만 5모델) ----------------
  function fixedDomains(r: Row) {
    const f = factorScores(r);
    const transport = T1_70_30(f.subway, f.bus, 'M1_BOUNDED_REDISTRIBUTION');
    const education = educationComposeEA(f.elementary, f.kindergarten, 'M1_BOUNDED_REDISTRIBUTION');
    const living = livingComposeLA(f.living, 'M1_BOUNDED_REDISTRIBUTION');
    return { transport, education, living, factors: f };
  }
  const MODELS: ParkingModelId[] = ['P-A_M3_GLOBAL_NEUTRAL', 'P-B_M1_BOUNDED_REDIST', 'P-C_M2_PARTIAL_FIXED', 'P-D_ERA_CONDITIONED', 'P-E_SCALE_ERA_CONSERVATIVE'];
  function complexUnder(r: Row, model: ParkingModelId) {
    const f = factorScores(r);
    return complexWithParkingModel(f.age, f.scale, f.parking, model, ageBand(r.age), `${ageBand(r.age)}|${hhBand(r.households)}`, ctx);
  }
  function totalUnder(r: Row, model: ParkingModelId): number | null {
    const d = fixedDomains(r);
    const complex = complexUnder(r, model);
    const covered = [d.transport, d.living, d.education, complex].filter((x) => x.score != null).length;
    if (covered / 4 < 0.4) return null;
    return composeTotalFromDomains({ transport: d.transport.score, living: d.living.score, education: d.education.score, complex: complex.score }, DOMAIN_WEIGHT_CANDIDATES['W-A_BALANCED'], 'M1_BOUNDED_REDISTRIBUTION').score;
  }

  // ---------------- §9 Fairness metrics per model ----------------
  console.log('\n' + '='.repeat(90)); console.log('[§9] P-A~E fairness metrics(overall / age-controlled / age+scale-controlled / district-controlled)'); console.log('='.repeat(90));
  const known = eligible.filter((r) => r.parkingRatio != null);
  const missing = eligible.filter((r) => r.parkingRatio == null);
  const fairnessResults: Record<string, unknown> = {};
  for (const model of MODELS) {
    const knownTotals = known.map((r) => totalUnder(r, model)).filter((v): v is number => v != null);
    const missingTotals = missing.map((r) => totalUnder(r, model)).filter((v): v is number => v != null);
    const overallGap = mean(knownTotals) - mean(missingTotals);

    // age-controlled
    const ageGaps: number[] = [];
    for (const b of ['0-10', '11-20', '21-30', '31+']) {
      const k = known.filter((r) => ageBand(r.age) === b).map((r) => totalUnder(r, model)).filter((v): v is number => v != null);
      const m = missing.filter((r) => ageBand(r.age) === b).map((r) => totalUnder(r, model)).filter((v): v is number => v != null);
      if (k.length >= 3 && m.length >= 3) ageGaps.push(mean(k) - mean(m));
    }
    // age+scale matched cells(§5와 동일 방법론)
    const cells = new Map<string, { known: number[]; missing: number[] }>();
    for (const r of eligible) {
      const key = `${ageBand(r.age)}|${hhBand(r.households)}|${GU_BY_LAWDCD[r.sggCd ?? ''] ?? 'unknown'}`;
      if (!cells.has(key)) cells.set(key, { known: [], missing: [] });
      const t = totalUnder(r, model); if (t == null) continue;
      if (r.parkingRatio != null) cells.get(key)!.known.push(t); else cells.get(key)!.missing.push(t);
    }
    const matched = [...cells.values()].filter((c) => c.known.length >= 3 && c.missing.length >= 3);
    const matchedGap = mean(matched.map((c) => mean(c.known) - mean(c.missing)));

    console.log(`  ${model}: overallGap=${overallGap.toFixed(1)} ageControlledGapMean=${mean(ageGaps).toFixed(1)} matchedGap(age+scale+district)=${matchedGap.toFixed(1)}`);
    fairnessResults[model] = { overallGap, ageControlledGapMean: mean(ageGaps), matchedGap, matchedCellCount: matched.length };
  }

  // ---------------- §10 Complex integrity(monotonic) ----------------
  console.log('\n' + '='.repeat(90)); console.log('[§10] Complex integrity — age/scale/parking-known monotonicity per model'); console.log('='.repeat(90));
  const { parkingScore } = await import('../score-v2-step3/curves-v3');
  for (const model of MODELS) {
    const p07 = parkingScore(0.7, 'C_PIECEWISE')!, p10 = parkingScore(1.0, 'C_PIECEWISE')!, p158 = parkingScore(1.58, 'C_PIECEWISE')!;
    const c07 = complexWithParkingModel(20, 60, p07, model, ageBand(20), `${ageBand(20)}|${hhBand(400)}`, ctx);
    const c10 = complexWithParkingModel(20, 60, p10, model, ageBand(20), `${ageBand(20)}|${hhBand(400)}`, ctx);
    const c158 = complexWithParkingModel(20, 60, p158, model, ageBand(20), `${ageBand(20)}|${hhBand(400)}`, ctx);
    const monotonic = c158.score! > c10.score! && c10.score! > c07.score!;
    console.log(`  ${model}: parking known 0.7(${c07.score!.toFixed(1)}) < 1.0(${c10.score!.toFixed(1)}) < 1.58(${c158.score!.toFixed(1)}) ${monotonic ? 'PASS' : 'FAIL'}`);
  }

  // ---------------- §11 대신해모/협성 regression ----------------
  console.log('\n' + '='.repeat(90)); console.log('[§11] 대신해모/협성 regression — parking known이므로 모델 변경 무관해야 함'); console.log('='.repeat(90));
  const daesin = rows.find((r) => r.aptSeq === '26140-1356')!;
  const hyeongseong = rows.find((r) => r.aptSeq === '26140-51')!;
  for (const [label, r] of [['대신해모', daesin], ['협성', hyeongseong]] as const) {
    const scores = MODELS.map((m) => complexUnder(r, m).score);
    const allSame = scores.every((s) => Math.abs(s! - scores[0]!) < 0.01);
    console.log(`  ${label}(parking=${r.parkingRatio}): complex per model = ${scores.map((s) => s!.toFixed(2)).join(', ')} -> ${allSame ? 'UNCHANGED(PASS)' : 'CHANGED(FAIL — parking known인데 모델별로 달라짐)'}`);
  }

  // ---------------- §12 Missing cohort benchmark regression(10개) ----------------
  console.log('\n' + '='.repeat(90)); console.log('[§12] Missing-parking benchmark 10개 — P-A~E Complex/Overall 비교'); console.log('='.repeat(90));
  const missingBenchmarks = missing.filter((r) => r.age != null && r.households != null).sort((a, b) => (b.households ?? 0) - (a.households ?? 0)).slice(0, 10);
  const benchmarkRows: string[] = ['aptSeq,name,sigungu,age,households,' + MODELS.map((m) => `complex_${m}`).join(',') + ',' + MODELS.map((m) => `total_${m}`).join(',')];
  for (const r of missingBenchmarks) {
    const complexVals = MODELS.map((m) => complexUnder(r, m).score);
    const totalVals = MODELS.map((m) => totalUnder(r, m));
    console.log(`  ${r.name}(${r.sigungu}, age${r.age} hh${r.households}): complex=${complexVals.map((v) => v?.toFixed(1)).join('/')}  total=${totalVals.map((v) => v?.toFixed(1)).join('/')}`);
    benchmarkRows.push([r.aptSeq, `"${r.name}"`, r.sigungu, r.age, r.households, ...complexVals.map((v) => v?.toFixed(1) ?? ''), ...totalVals.map((v) => v?.toFixed(1) ?? '')].join(','));
  }

  const outDir = path.resolve(__dirname, '../../data/score-v2-step35');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.resolve(outDir, 'parking-model-comparison.csv'), benchmarkRows.join('\n'));
  fs.writeFileSync(path.resolve(outDir, 'parking-fairness-by-model.json'), JSON.stringify({ generatedAt: new Date().toISOString(), eraNeutralByAgeBand, fairnessResults }, null, 1));
  console.log('\n[saved] parking-model-comparison.csv / parking-fairness-by-model.json');

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
