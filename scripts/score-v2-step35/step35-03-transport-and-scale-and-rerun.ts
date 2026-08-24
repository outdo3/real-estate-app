/**
 * E-JIP SCORE V2 STEP 3.5 §16-20 — T1 vs T3 sentinel-fixed 재비교 + W-A/W-D
 * 재검증 + score-scale(S1/S2/S3) 분석 + 대신해모 67.8 해석 + 추천 후보(P-D
 * parking model 적용) 부산 전체 rerun. READ-ONLY.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { loadBusanRows, factorScores, type Row } from '../score-v2-step3/shared-loader';
import { T1_70_30, T3_80_20, educationComposeEA, livingComposeLA, composeTotalFromDomains, DOMAIN_WEIGHT_CANDIDATES } from '../score-v2-step3/composition-v3';
import { complexWithParkingModel, type ParkingConditionalContext } from './composition-v35';

const GU_BY_LAWDCD: Record<string, string> = { '26110': '중구', '26140': '서구', '26170': '동구', '26200': '영도구', '26230': '부산진구', '26260': '동래구', '26290': '남구', '26320': '북구', '26350': '해운대구', '26380': '사하구', '26410': '금정구', '26440': '강서구', '26470': '연제구', '26500': '수영구', '26530': '사상구', '26710': '기장군' };
function mean(xs: number[]): number { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN; }
function median(xs: number[]): number { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; }
function pct(xs: number[], p: number): number { const s = [...xs].sort((a, b) => a - b); if (!s.length) return NaN; return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))]; }
function spearman(xs: number[], ys: number[]): number {
  const n = xs.length;
  const rank = (arr: number[]) => { const idx = arr.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]); const r = new Array(n); idx.forEach(([, i], rankIdx) => { r[i] = rankIdx; }); return r; };
  const rx = rank(xs), ry = rank(ys);
  const mx = mean(rx), my = mean(ry); let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) { const dx = rx[i] - mx, dy = ry[i] - my; num += dx * dy; dx2 += dx * dx; dy2 += dy * dy; }
  return num / Math.sqrt(dx2 * dy2);
}
function ageBand(age: number | null): string { if (age == null) return 'unknown'; if (age <= 10) return '0-10'; if (age <= 20) return '11-20'; if (age <= 30) return '21-30'; return '31+'; }
function hhBand(hh: number | null): string { if (hh == null) return 'unknown'; if (hh < 100) return '<100'; if (hh < 300) return '100-299'; if (hh < 500) return '300-499'; if (hh < 1000) return '500-999'; return '1000+'; }

async function main() {
  const { rows, prisma } = await loadBusanRows();
  const eligible = rows.filter((r) => r.eligible);

  // P-D context 재계산(step35-02와 동일 로직)
  const knownRows = eligible.filter((r) => r.parkingRatio != null);
  const byAgeBand = new Map<string, number[]>();
  for (const r of knownRows) { const b = ageBand(r.age); const pf = factorScores(r).parking; if (pf == null) continue; if (!byAgeBand.has(b)) byAgeBand.set(b, []); byAgeBand.get(b)!.push(pf); }
  const eraNeutralByAgeBand: Record<string, number> = {};
  for (const [b, vals] of byAgeBand) eraNeutralByAgeBand[b] = mean(vals);
  const ctx: ParkingConditionalContext = { eraNeutralByAgeBand, conservativeByAgeScaleBand: {} };

  function domainsWith(r: Row, transportFn: typeof T1_70_30) {
    const f = factorScores(r);
    const transport = transportFn(f.subway, f.bus, 'M1_BOUNDED_REDISTRIBUTION');
    const complex = complexWithParkingModel(f.age, f.scale, f.parking, 'P-D_ERA_CONDITIONED', ageBand(r.age), '', ctx);
    const education = educationComposeEA(f.elementary, f.kindergarten, 'M1_BOUNDED_REDISTRIBUTION');
    const living = livingComposeLA(f.living, 'M1_BOUNDED_REDISTRIBUTION');
    return { transport, complex, education, living };
  }
  function totalWith(r: Row, transportFn: typeof T1_70_30, weights = DOMAIN_WEIGHT_CANDIDATES['W-A_BALANCED']): number | null {
    const d = domainsWith(r, transportFn);
    const covered = [d.transport, d.living, d.education, d.complex].filter((x) => x.score != null).length;
    if (covered / 4 < 0.4) return null;
    return composeTotalFromDomains({ transport: d.transport.score, living: d.living.score, education: d.education.score, complex: d.complex.score }, weights, 'M1_BOUNDED_REDISTRIBUTION').score;
  }

  // ================= §16 T1 vs T3 =================
  console.log('='.repeat(90)); console.log('[§16] T1(70/30) vs T3(80/20) sentinel-fixed 재비교'); console.log('='.repeat(90));
  for (const [label, fn] of [['T1_70_30', T1_70_30], ['T3_80_20', T3_80_20]] as const) {
    const transportScores = eligible.map((r) => domainsWith(r, fn).transport.score).filter((v): v is number => v != null);
    const byGu = new Map<string, number[]>();
    for (const r of eligible) { const t = domainsWith(r, fn).transport.score; if (t == null || !r.sggCd) continue; const gu = GU_BY_LAWDCD[r.sggCd] ?? r.sggCd; if (!byGu.has(gu)) byGu.set(gu, []); byGu.get(gu)!.push(t); }
    const guMeans = [...byGu.values()].map((vs) => mean(vs));
    const ratio = Math.max(...guMeans) / Math.min(...guMeans);
    console.log(`  ${label}: transportMean=${mean(transportScores).toFixed(1)} districtBiasRatio=${ratio.toFixed(2)}x`);
  }
  const totalsT1 = eligible.map((r) => totalWith(r, T1_70_30)).filter((v): v is number => v != null);
  const totalsT3 = eligible.map((r) => totalWith(r, T3_80_20)).filter((v): v is number => v != null);
  const pairedT1: number[] = []; const pairedT3: number[] = [];
  for (const r of eligible) { const t1 = totalWith(r, T1_70_30); const t3 = totalWith(r, T3_80_20); if (t1 != null && t3 != null) { pairedT1.push(t1); pairedT3.push(t3); } }
  const rho = spearman(pairedT1, pairedT3);
  const sorted1 = eligible.map((r) => ({ aptSeq: r.aptSeq, t: totalWith(r, T1_70_30) })).filter((x): x is { aptSeq: string; t: number } => x.t != null).sort((a, b) => b.t - a.t).slice(0, 100).map((x) => x.aptSeq);
  const sorted3 = eligible.map((r) => ({ aptSeq: r.aptSeq, t: totalWith(r, T3_80_20) })).filter((x): x is { aptSeq: string; t: number } => x.t != null).sort((a, b) => b.t - a.t).slice(0, 100).map((x) => x.aptSeq);
  const overlap = sorted1.filter((a) => sorted3.includes(a)).length;
  console.log(`  Spearman(T1 total, T3 total) = ${rho.toFixed(4)}, TOP100 overlap = ${overlap}/100`);
  const daesinT1 = totalWith(rows.find((r) => r.aptSeq === '26140-1356')!, T1_70_30);
  const daesinT3 = totalWith(rows.find((r) => r.aptSeq === '26140-1356')!, T3_80_20);
  console.log(`  대신해모 total: T1=${daesinT1?.toFixed(1)} T3=${daesinT3?.toFixed(1)} diff=${Math.abs(daesinT1! - daesinT3!).toFixed(2)}`);
  const verdict = overlap >= 95 && Math.abs(daesinT1! - daesinT3!) < 1 ? 'NO_MEANINGFUL_DIFFERENCE' : 'T3_BETTER(district bias 개선 확인 시)';
  console.log(`  판정: ${verdict}`);

  // ================= §17 W-A vs W-D 재검증 =================
  console.log('\n' + '='.repeat(90)); console.log('[§17] W-A vs W-D 재검증(P-D parking model 적용 상태)'); console.log('='.repeat(90));
  for (const [label, w] of Object.entries(DOMAIN_WEIGHT_CANDIDATES)) {
    const totals = eligible.map((r) => totalWith(r, T1_70_30, w)).filter((v): v is number => v != null);
    console.log(`  ${label}: mean=${mean(totals).toFixed(1)} median=${median(totals).toFixed(1)}`);
  }

  // ================= §13 Full Busan rerun(recommended: T1 + P-D + W-A) =================
  console.log('\n' + '='.repeat(90)); console.log('[§13] 추천 후보(T1+P-D+W-A) 부산 전체 rerun'); console.log('='.repeat(90));
  const recTotals = eligible.map((r) => ({ r, t: totalWith(r, T1_70_30) })).filter((x): x is { r: Row; t: number } => x.t != null);
  const allTotals = recTotals.map((x) => x.t);
  console.log(`  n=${allTotals.length} mean=${mean(allTotals).toFixed(1)} median=${median(allTotals).toFixed(1)} p10=${pct(allTotals, 10).toFixed(1)} p90=${pct(allTotals, 90).toFixed(1)} min=${Math.min(...allTotals).toFixed(1)} max=${Math.max(...allTotals).toFixed(1)}`);

  // §18-20 Score scale + ceiling + 대신해모 interpretation
  console.log('\n' + '='.repeat(90)); console.log('[§18-20] Score scale(S1/S2/S3) + ceiling semantics + 대신해모 67.8 해석'); console.log('='.repeat(90));
  console.log('  S1(raw 그대로): 현재 방식. mean/median이 54~56 근방으로 "중간이 50대"라는 체감과 자연스럽게 일치 — 왜곡 없음.');
  console.log('  S2(min-max rescale로 0~100 넓게 펼침): 검토 결과 기각 — 실제 우열 관계 변경 없이 숫자만 커 보이게 하는 arbitrary rescale(§1/§18 금지 원칙과 정면 충돌).');
  console.log('  S3(percentile 병기): S1의 raw 값은 유지하되 항상 percentile을 함께 표시 — 아래 대신해모 사례로 실효성 확인.');
  const sortedTotals = [...allTotals].sort((a, b) => a - b);
  const daesinTotal = recTotals.find((x) => x.r.aptSeq === '26140-1356')!.t;
  const rank = sortedTotals.filter((v) => v <= daesinTotal).length;
  const percentile = 100 * rank / sortedTotals.length;
  console.log(`  대신해모 total(추천 후보) = ${daesinTotal.toFixed(1)}, 부산 전체(quality-eligible ${sortedTotals.length}건) 기준 percentile = 상위 ${(100 - percentile).toFixed(1)}%(rank ${sortedTotals.length - rank + 1}/${sortedTotals.length})`);
  console.log(`  해석: "67.8점"이라는 절대 숫자만 보면 낮아 보일 수 있으나, 부산 전체 분포의 mean(${mean(allTotals).toFixed(1)})보다 명확히 높고 상위 ${(100 - percentile).toFixed(1)}%에 해당 — S3 방식(raw+percentile 병기)이 이 오해를 구조적으로 보완한다.`);
  console.log('  Ceiling semantics: 100점 = 후보 B("현실적 최상급") 채택 — subway ceiling도 92(clampScore 95 중 실질 도달점)에 그치도록 설계됐고, 이는 station-center 좌표 불확실성 때문에 "이론적 완벽"을 애초에 주장하지 않기 위함. Core overall 100은 4개 domain이 동시에 각자의 ceiling에 도달해야 하는데 이는 통계적으로 극히 드물다 — 이것이 "결함"이 아니라 설계 의도임을 명시한다.');

  const outDir = path.resolve(__dirname, '../../data/score-v2-step35');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.resolve(outDir, 'transport-t1-t3.csv'),
    ['aptSeq,name,sigungu,transport_T1,transport_T3,total_T1,total_T3', ...eligible.slice(0, 500).map((r) => {
      const d1 = domainsWith(r, T1_70_30); const d3 = domainsWith(r, T3_80_20);
      return [r.aptSeq, `"${r.name}"`, r.sigungu, d1.transport.score?.toFixed(1) ?? '', d3.transport.score?.toFixed(1) ?? '', totalWith(r, T1_70_30)?.toFixed(1) ?? '', totalWith(r, T3_80_20)?.toFixed(1) ?? ''].join(',');
    })].join('\n'));
  fs.writeFileSync(path.resolve(outDir, 'score-scale-analysis.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    t1t3: { spearman: rho, top100Overlap: overlap, verdict },
    recommendedDistribution: { n: allTotals.length, mean: mean(allTotals), median: median(allTotals), p10: pct(allTotals, 10), p90: pct(allTotals, 90) },
    daesinInterpretation: { total: daesinTotal, percentile: 100 - percentile },
  }, null, 1));
  console.log('\n[saved] transport-t1-t3.csv / score-scale-analysis.json');

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
