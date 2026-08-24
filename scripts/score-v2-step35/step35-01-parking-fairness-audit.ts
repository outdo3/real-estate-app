/**
 * E-JIP SCORE V2 STEP 3.5 §2-5 — parking fairness gap 재현 + decomposition +
 * missingness(MNAR) audit + matched comparison. READ-ONLY, DB write 없음.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { loadBusanRows, baselineDomains, factorScores, type Row } from '../score-v2-step3/shared-loader';
import { composeTotalFromDomains, DOMAIN_WEIGHT_CANDIDATES } from '../score-v2-step3/composition-v3';

const GU_BY_LAWDCD: Record<string, string> = {
  '26110': '중구', '26140': '서구', '26170': '동구', '26200': '영도구', '26230': '부산진구',
  '26260': '동래구', '26290': '남구', '26320': '북구', '26350': '해운대구', '26380': '사하구',
  '26410': '금정구', '26440': '강서구', '26470': '연제구', '26500': '수영구', '26530': '사상구', '26710': '기장군',
};
function mean(xs: number[]): number { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN; }
function median(xs: number[]): number { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; }

function ageBand(age: number | null): string { if (age == null) return 'unknown'; if (age <= 10) return '0-10'; if (age <= 20) return '11-20'; if (age <= 30) return '21-30'; return '31+'; }
function hhBand(hh: number | null): string { if (hh == null) return 'unknown'; if (hh < 100) return '<100'; if (hh < 300) return '100-299'; if (hh < 500) return '300-499'; if (hh < 1000) return '500-999'; return '1000+'; }

async function main() {
  const { rows, prisma } = await loadBusanRows();
  const eligible = rows.filter((r) => r.eligible);
  const known = eligible.filter((r) => r.parkingRatio != null);
  const missing = eligible.filter((r) => r.parkingRatio == null);
  console.log(`[§2] eligible universe: KNOWN=${known.length} MISSING=${missing.length}`);

  function totalW(r: Row): number | null {
    const d = baselineDomains(r);
    const covered = [d.transport, d.living, d.education, d.complex].filter((x) => x.score != null).length;
    if (covered / 4 < 0.4) return null;
    return composeTotalFromDomains({ transport: d.transport.score, living: d.living.score, education: d.education.score, complex: d.complex.score }, DOMAIN_WEIGHT_CANDIDATES['W-A_BALANCED'], 'M1_BOUNDED_REDISTRIBUTION').score;
  }
  function complexScore(r: Row): number | null { return baselineDomains(r).complex.score; }

  const knownTotal = known.map(totalW).filter((v): v is number => v != null);
  const missingTotal = missing.map(totalW).filter((v): v is number => v != null);
  const knownComplex = known.map(complexScore).filter((v): v is number => v != null);
  const missingComplex = missing.map(complexScore).filter((v): v is number => v != null);
  console.log(`[§2] raw gap — total: known mean=${mean(knownTotal).toFixed(1)} median=${median(knownTotal).toFixed(1)} | missing mean=${mean(missingTotal).toFixed(1)} median=${median(missingTotal).toFixed(1)} | gap=${(mean(knownTotal) - mean(missingTotal)).toFixed(1)}`);
  console.log(`[§2] raw gap — complex: known mean=${mean(knownComplex).toFixed(1)} | missing mean=${mean(missingComplex).toFixed(1)} | gap=${(mean(knownComplex) - mean(missingComplex)).toFixed(1)}`);

  // ---------------- §3 Decomposition ----------------
  console.log('\n[§3] Decomposition — KNOWN vs MISSING 그룹의 다른 factor 분포 비교:');
  function summarize(label: string, list: Row[], accessor: (r: Row) => number | null) {
    const vals = list.map(accessor).filter((v): v is number => v != null);
    console.log(`  ${label}: n=${vals.length} mean=${mean(vals).toFixed(1)} median=${median(vals).toFixed(1)} coverage=${(100 * vals.length / list.length).toFixed(1)}%`);
  }
  summarize('KNOWN age', known, (r) => r.age);
  summarize('MISSING age', missing, (r) => r.age);
  summarize('KNOWN households', known, (r) => r.households);
  summarize('MISSING households', missing, (r) => r.households);
  summarize('KNOWN households(coverage 자체 비교)', known, (r) => r.households != null ? 1 : null);
  summarize('MISSING households(coverage 자체 비교)', missing, (r) => r.households != null ? 1 : null);

  function guDist(list: Row[]) { const m = new Map<string, number>(); for (const r of list) { const gu = GU_BY_LAWDCD[r.sggCd ?? ''] ?? 'unknown'; m.set(gu, (m.get(gu) ?? 0) + 1); } return Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1])); }
  console.log(`  KNOWN sigungu 분포: ${JSON.stringify(guDist(known))}`);
  console.log(`  MISSING sigungu 분포: ${JSON.stringify(guDist(missing))}`);

  const { classify } = await import('../apartment-score/lib/peer-quality');
  // registry linkage(=households 존재 여부 자체가 registryLinked의 핵심 근거, STEP0.6 peer-quality classify() 재사용 원칙)
  const knownIdentityHigh = known.filter((r) => r.identity === 'IDENTITY_HIGH').length;
  const missingIdentityHigh = missing.filter((r) => r.identity === 'IDENTITY_HIGH').length;
  console.log(`  KNOWN identity=IDENTITY_HIGH 비율 = ${(100 * knownIdentityHigh / known.length).toFixed(1)}%`);
  console.log(`  MISSING identity=IDENTITY_HIGH 비율 = ${(100 * missingIdentityHigh / missing.length).toFixed(1)}%`);

  // ---------------- §4 Missingness is not random audit ----------------
  console.log('\n[§4] Missingness 패턴(age/household cohort별 known-rate):');
  const ageBands = ['0-10', '11-20', '21-30', '31+'];
  const knownRateByAge: Record<string, number> = {};
  for (const b of ageBands) {
    const inBand = eligible.filter((r) => ageBand(r.age) === b);
    const knownInBand = inBand.filter((r) => r.parkingRatio != null).length;
    knownRateByAge[b] = inBand.length ? 100 * knownInBand / inBand.length : NaN;
    console.log(`  age ${b}: n=${inBand.length} known-rate=${knownRateByAge[b].toFixed(1)}%`);
  }
  const hhBands = ['<100', '100-299', '300-499', '500-999', '1000+'];
  const knownRateByHH: Record<string, number> = {};
  for (const b of hhBands) {
    const inBand = eligible.filter((r) => hhBand(r.households) === b);
    const knownInBand = inBand.filter((r) => r.parkingRatio != null).length;
    knownRateByHH[b] = inBand.length ? 100 * knownInBand / inBand.length : NaN;
    console.log(`  households ${b}: n=${inBand.length} known-rate=${knownRateByHH[b].toFixed(1)}%`);
  }
  const ageRange = Math.max(...Object.values(knownRateByAge).filter((v) => !isNaN(v))) - Math.min(...Object.values(knownRateByAge).filter((v) => !isNaN(v)));
  const hhRange = Math.max(...Object.values(knownRateByHH).filter((v) => !isNaN(v))) - Math.min(...Object.values(knownRateByHH).filter((v) => !isNaN(v)));
  console.log(`  age band known-rate range = ${ageRange.toFixed(1)}pp, household band known-rate range = ${hhRange.toFixed(1)}pp`);
  const classification = (ageRange > 30 || hhRange > 30) ? 'HIGHLY_STRUCTURED' : (ageRange > 10 || hhRange > 10) ? 'PARTIALLY_STRUCTURED' : 'MISSING_RANDOM';
  console.log(`  판정: ${classification}`);

  // ---------------- §5 Matched analysis ----------------
  console.log('\n[§5] Matched comparison(age-band x household-band x sigungu 동일 cell):');
  interface Cell { key: string; known: number[]; missing: number[] }
  const cells = new Map<string, Cell>();
  for (const r of eligible) {
    const gu = GU_BY_LAWDCD[r.sggCd ?? ''] ?? 'unknown';
    const key = `${ageBand(r.age)}|${hhBand(r.households)}|${gu}`;
    if (!cells.has(key)) cells.set(key, { key, known: [], missing: [] });
    const t = totalW(r);
    if (t == null) continue;
    if (r.parkingRatio != null) cells.get(key)!.known.push(t); else cells.get(key)!.missing.push(t);
  }
  const matchedCells = [...cells.values()].filter((c) => c.known.length >= 3 && c.missing.length >= 3);
  console.log(`  매칭 가능한 cell(양쪽 n>=3) = ${matchedCells.length}개`);
  const cellGaps = matchedCells.map((c) => mean(c.known) - mean(c.missing));
  console.log(`  cell별 gap 평균 = ${mean(cellGaps).toFixed(1)}pt (n=${matchedCells.length} cells), gap range = [${Math.min(...cellGaps).toFixed(1)}, ${Math.max(...cellGaps).toFixed(1)}]`);
  matchedCells.sort((a, b) => (mean(b.known) - mean(b.missing)) - (mean(a.known) - mean(a.missing)));
  console.log('  상위 5개 cell(가장 큰 gap):');
  matchedCells.slice(0, 5).forEach((c) => console.log(`    ${c.key}: known(n=${c.known.length})=${mean(c.known).toFixed(1)} missing(n=${c.missing.length})=${mean(c.missing).toFixed(1)} gap=${(mean(c.known) - mean(c.missing)).toFixed(1)}`));

  const outDir = path.resolve(__dirname, '../../data/score-v2-step35');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const csvRows = ['aptSeq,name,sigungu,ageBand,hhBand,parkingStatus,total_WA,complex'];
  for (const r of eligible) {
    csvRows.push([r.aptSeq, `"${r.name}"`, r.sigungu, ageBand(r.age), hhBand(r.households), r.parkingRatio != null ? 'KNOWN' : 'MISSING', totalW(r)?.toFixed(1) ?? '', complexScore(r)?.toFixed(1) ?? ''].join(','));
  }
  fs.writeFileSync(path.resolve(outDir, 'parking-fairness.csv'), csvRows.join('\n'));
  console.log('\n[saved] data/score-v2-step35/parking-fairness.csv');

  fs.writeFileSync(path.resolve(outDir, 'parking-missingness-audit.json'), JSON.stringify({
    generatedAt: new Date().toISOString(), knownCount: known.length, missingCount: missing.length,
    rawGapTotal: mean(knownTotal) - mean(missingTotal), rawGapComplex: mean(knownComplex) - mean(missingComplex),
    knownRateByAge, knownRateByHH, classification, matchedCellCount: matchedCells.length, matchedGapMean: mean(cellGaps),
  }, null, 1));
  console.log('[saved] data/score-v2-step35/parking-missingness-audit.json');

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
