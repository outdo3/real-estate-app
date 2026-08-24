/**
 * E-JIP SCORE V2 STEP 3 §37,40-43 — counterexample mining(8패턴) + raw
 * sensitivity + weight sensitivity(±5%p) + rank stability(Spearman/overlap) +
 * confidence fairness. READ-ONLY.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { loadBusanRows, baselineDomains, factorScores, type Row } from './shared-loader';
import { subwayDistanceScoreV3, ageScore, scaleScore, parkingScore, elementaryDistanceScore } from './curves-v3';
import { T1_70_30, complexComposeCC, educationComposeEA, composeTotalFromDomains, DOMAIN_WEIGHT_CANDIDATES, type DomainWeights } from './composition-v3';

function mean(xs: number[]): number { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN; }
function pearson(xs: number[], ys: number[]): number {
  const n = xs.length; if (n < 2) return NaN;
  const mx = mean(xs), my = mean(ys); let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; num += dx * dy; dx2 += dx * dx; dy2 += dy * dy; }
  const denom = Math.sqrt(dx2 * dy2); return denom === 0 ? NaN : num / denom;
}
function spearman(xs: number[], ys: number[]): number {
  const n = xs.length;
  const rank = (arr: number[]) => { const idx = arr.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]); const r = new Array(n); idx.forEach(([, i], rankIdx) => { r[i] = rankIdx; }); return r; };
  return pearson(rank(xs), rank(ys));
}

async function main() {
  const { rows, prisma } = await loadBusanRows();

  function totalFor(r: Row, weights: DomainWeights) {
    const d = baselineDomains(r);
    const covered = [d.transport, d.living, d.education, d.complex].filter((x) => x.score != null).length;
    if (!r.eligible || covered / 4 < 0.4) return null;
    return composeTotalFromDomains({ transport: d.transport.score, living: d.living.score, education: d.education.score, complex: d.complex.score }, weights, 'M1_BOUNDED_REDISTRIBUTION').score;
  }

  // ================= §37 Counterexample mining(8 patterns) =================
  console.log('='.repeat(90)); console.log('[§37] Counterexample mining(8 patterns, 부산 전체)'); console.log('='.repeat(90));
  const domainAll = new Map(rows.map((r) => [r.aptSeq, baselineDomains(r)]));
  const factorAll = new Map(rows.map((r) => [r.aptSeq, factorScores(r)]));

  const patterns = {
    'subway<=200 but transport<50': rows.filter((r) => r.subwayRaw != null && r.subwayRaw <= 200 && (domainAll.get(r.aptSeq)!.transport.score ?? 100) < 50),
    'subway>=1500(N/A, capped at 999 - use confirmed-absent as proxy) but transport>80': rows.filter((r) => r.subwayStatus === 'CONFIRMED_ABSENT' && (domainAll.get(r.aptSeq)!.transport.score ?? 0) > 80),
    'parking>=1.5 but parkingFactor<70': rows.filter((r) => r.parkingRatio != null && r.parkingRatio >= 1.5 && (factorAll.get(r.aptSeq)!.parking ?? 100) < 70),
    'parking<0.8 but parkingFactor>70': rows.filter((r) => r.parkingRatio != null && r.parkingRatio < 0.8 && (factorAll.get(r.aptSeq)!.parking ?? 0) > 70),
    'age<=5 but ageFactor<75': rows.filter((r) => r.age != null && r.age <= 5 && (factorAll.get(r.aptSeq)!.age ?? 100) < 75),
    'age>=35 but ageFactor>60': rows.filter((r) => r.age != null && r.age >= 35 && (factorAll.get(r.aptSeq)!.age ?? 0) > 60),
    'households>=1000 but scaleFactor low(<60)': rows.filter((r) => r.households != null && r.households >= 1000 && (factorAll.get(r.aptSeq)!.scale ?? 100) < 60),
    'elementary<=300 but education domain low(<50)': rows.filter((r) => r.elemRaw != null && r.elemRaw <= 300 && (domainAll.get(r.aptSeq)!.education.score ?? 100) < 50),
  };
  const counterexampleRows: string[] = ['pattern,aptSeq,name,sigungu,detail'];
  for (const [label, list] of Object.entries(patterns)) {
    console.log(`  ${label}: ${list.length}건`);
    for (const r of list.slice(0, 20)) counterexampleRows.push(`"${label}",${r.aptSeq},"${r.name}",${r.sigungu},"subway=${r.subwayRaw} age=${r.age} households=${r.households} parking=${r.parkingRatio}"`);
  }
  const outDir = path.resolve(__dirname, '../../data/score-v2-step3');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.resolve(outDir, 'counterexamples.csv'), counterexampleRows.join('\n'));
  console.log('[saved] counterexamples.csv');

  // ================= §40 Raw sensitivity =================
  console.log('\n' + '='.repeat(90)); console.log('[§40] Raw sensitivity — 작은 변화가 total에 미치는 영향(전 universe)'); console.log('='.repeat(90));
  const eligible = rows.filter((r) => r.eligible);
  function perturbedTotal(r: Row, mut: (r: Row) => Row): number | null {
    return totalFor(mut(r), DOMAIN_WEIGHT_CANDIDATES['W-A_BALANCED']);
  }
  const perturbations: { label: string; mut: (r: Row) => Row }[] = [
    { label: 'subway ±20m', mut: (r) => ({ ...r, subwayRaw: r.subwayRaw != null ? r.subwayRaw + 20 : null }) },
    { label: 'parking ±0.05', mut: (r) => ({ ...r, parkingRatio: r.parkingRatio != null ? r.parkingRatio + 0.05 : null }) },
    { label: 'age ±1y', mut: (r) => ({ ...r, age: r.age != null ? r.age + 1 : null }) },
    { label: 'households ±50', mut: (r) => ({ ...r, households: r.households != null ? r.households + 50 : null }) },
    { label: 'elementary ±50m', mut: (r) => ({ ...r, elemRaw: r.elemRaw != null ? r.elemRaw + 50 : null }) },
  ];
  const sensitivitySummary: Record<string, unknown> = {};
  for (const p of perturbations) {
    const deltas: number[] = [];
    for (const r of eligible) {
      const base = totalFor(r, DOMAIN_WEIGHT_CANDIDATES['W-A_BALANCED']);
      const perturbed = perturbedTotal(r, p.mut);
      if (base != null && perturbed != null) deltas.push(Math.abs(perturbed - base));
    }
    const maxD = Math.max(...deltas); const meanD = mean(deltas);
    console.log(`  ${p.label}: n=${deltas.length} meanDelta=${meanD.toFixed(3)} maxDelta=${maxD.toFixed(3)}`);
    sensitivitySummary[p.label] = { n: deltas.length, meanDelta: meanD, maxDelta: maxD };
  }

  // ================= §41 Weight sensitivity(±5pp on W-A) =================
  console.log('\n' + '='.repeat(90)); console.log('[§41] Weight sensitivity — W-A 각 domain ±5%p'); console.log('='.repeat(90));
  const base = DOMAIN_WEIGHT_CANDIDATES['W-A_BALANCED'];
  const baseTotals = new Map(eligible.map((r) => [r.aptSeq, totalFor(r, base)]));
  const baseSorted = [...eligible].map((r) => ({ aptSeq: r.aptSeq, total: baseTotals.get(r.aptSeq) })).filter((x): x is { aptSeq: string; total: number } => x.total != null).sort((a, b) => b.total - a.total);
  const baseTop100 = new Set(baseSorted.slice(0, 100).map((x) => x.aptSeq));

  const weightSensitivityResults: Record<string, unknown> = {};
  for (const domain of ['transport', 'living', 'education', 'complex'] as const) {
    for (const delta of [5, -5]) {
      const perturbedWeights: DomainWeights = { ...base, [domain]: base[domain] + delta };
      const others = (['transport', 'living', 'education', 'complex'] as const).filter((d) => d !== domain);
      const scale = (100 - perturbedWeights[domain]) / others.reduce((s, d) => s + base[d], 0);
      for (const d of others) perturbedWeights[d] = base[d] * scale;
      const totals = eligible.map((r) => ({ aptSeq: r.aptSeq, total: totalFor(r, perturbedWeights) })).filter((x): x is { aptSeq: string; total: number } => x.total != null).sort((a, b) => b.total - a.total);
      const top100 = new Set(totals.slice(0, 100).map((x) => x.aptSeq));
      const overlap = [...top100].filter((a) => baseTop100.has(a)).length;
      const medianDeltaArr = totals.map((t) => { const b2 = baseTotals.get(t.aptSeq); return b2 != null ? Math.abs(t.total - b2) : null; }).filter((v): v is number => v != null).sort((a, b) => a - b);
      const medianDelta = medianDeltaArr[Math.floor(medianDeltaArr.length / 2)];
      const label = `${domain}${delta > 0 ? '+' : ''}${delta}pp`;
      console.log(`  ${label}: TOP100 overlap=${overlap}/100 medianDelta=${medianDelta.toFixed(2)}`);
      weightSensitivityResults[label] = { top100Overlap: overlap, medianDelta };
    }
  }

  // ================= §42 Rank stability across W-A/B/C/D =================
  console.log('\n' + '='.repeat(90)); console.log('[§42] Rank stability — W-A/B/C/D 후보 간'); console.log('='.repeat(90));
  const totalsByCandidate: Record<string, Map<string, number>> = {};
  for (const [label, w] of Object.entries(DOMAIN_WEIGHT_CANDIDATES)) {
    totalsByCandidate[label] = new Map(eligible.map((r) => [r.aptSeq, totalFor(r, w)]).filter((x): x is [string, number] => x[1] != null));
  }
  const labels = Object.keys(DOMAIN_WEIGHT_CANDIDATES);
  const rankStability: Record<string, unknown> = {};
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      const l1 = labels[i], l2 = labels[j];
      const common = [...totalsByCandidate[l1].keys()].filter((k) => totalsByCandidate[l2].has(k));
      const xs = common.map((k) => totalsByCandidate[l1].get(k)!); const ys = common.map((k) => totalsByCandidate[l2].get(k)!);
      const rho = spearman(xs, ys);
      const sorted1 = [...common].sort((a, b) => totalsByCandidate[l1].get(b)! - totalsByCandidate[l1].get(a)!).slice(0, 50);
      const sorted2 = [...common].sort((a, b) => totalsByCandidate[l2].get(b)! - totalsByCandidate[l2].get(a)!).slice(0, 50);
      const top50Overlap = sorted1.filter((a) => sorted2.includes(a)).length;
      console.log(`  ${l1} vs ${l2}: Spearman=${rho.toFixed(3)} TOP50overlap=${top50Overlap}/50`);
      rankStability[`${l1}_vs_${l2}`] = { spearman: rho, top50Overlap };
    }
  }

  // ================= §43 Confidence fairness =================
  console.log('\n' + '='.repeat(90)); console.log('[§43] Confidence fairness — LOW confidence가 TOP ranking에 과대표됐는지'); console.log('='.repeat(90));
  const { classify } = await import('../apartment-score/lib/peer-quality');
  const confByAptSeq = new Map<string, string>();
  for (const r of rows) {
    const d = baselineDomains(r);
    const covered = [d.transport, d.living, d.education, d.complex].filter((x) => x.score != null).length;
    confByAptSeq.set(r.aptSeq, covered / 4 >= 0.75 ? 'HIGH' : covered / 4 >= 0.4 ? 'MEDIUM' : 'LOW');
  }
  const top100Global = baseSorted.slice(0, 100);
  const top100ConfDist: Record<string, number> = {};
  for (const t of top100Global) { const c = confByAptSeq.get(t.aptSeq) ?? 'UNKNOWN'; top100ConfDist[c] = (top100ConfDist[c] ?? 0) + 1; }
  const overallConfDist: Record<string, number> = {};
  for (const r of eligible) { const c = confByAptSeq.get(r.aptSeq) ?? 'UNKNOWN'; overallConfDist[c] = (overallConfDist[c] ?? 0) + 1; }
  console.log(`  TOP100 confidence 분포: ${JSON.stringify(top100ConfDist)}`);
  console.log(`  전체(eligible) confidence 분포: ${JSON.stringify(overallConfDist)}`);
  console.log(`  LOW-confidence가 TOP100에서 과대표되는가? TOP100 LOW% = ${((top100ConfDist['LOW'] ?? 0) / 100 * 100).toFixed(1)}%, 전체 LOW% = ${((overallConfDist['LOW'] ?? 0) / eligible.length * 100).toFixed(1)}%`);

  // district-summary.csv(§24 재출력, csv 형태로 아카이브)
  const GU_BY_LAWDCD: Record<string, string> = { '26110': '중구', '26140': '서구', '26170': '동구', '26200': '영도구', '26230': '부산진구', '26260': '동래구', '26290': '남구', '26320': '북구', '26350': '해운대구', '26380': '사하구', '26410': '금정구', '26440': '강서구', '26470': '연제구', '26500': '수영구', '26530': '사상구', '26710': '기장군' };
  const byGu = new Map<string, number[]>();
  for (const r of eligible) { const t = baseTotals.get(r.aptSeq); if (t == null || !r.sggCd) continue; const gu = GU_BY_LAWDCD[r.sggCd] ?? r.sggCd; if (!byGu.has(gu)) byGu.set(gu, []); byGu.get(gu)!.push(t); }
  const districtCsv = ['gu,n,mean,median', ...[...byGu.entries()].map(([gu, vs]) => { const s = [...vs].sort((a, b) => a - b); return `${gu},${vs.length},${mean(vs).toFixed(1)},${s[Math.floor(s.length / 2)].toFixed(1)}`; })];
  fs.writeFileSync(path.resolve(outDir, 'district-summary.csv'), districtCsv.join('\n'));
  console.log('\n[saved] district-summary.csv');

  fs.writeFileSync(path.resolve(outDir, 'sensitivity-summary.json'), JSON.stringify({
    generatedAt: new Date().toISOString(), rawSensitivity: sensitivitySummary, weightSensitivity: weightSensitivityResults, rankStability,
    confidenceFairness: { top100ConfDist, overallConfDist },
  }, null, 1));
  console.log('[saved] sensitivity-summary.json');

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
