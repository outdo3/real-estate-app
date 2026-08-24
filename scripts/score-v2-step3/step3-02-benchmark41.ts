/**
 * E-JIP SCORE V2 STEP 3 §30-32 — STEP2 41개 벤치마크 재선정 + baseline
 * composition + W-A/B/C/D 후보 적용 + 고정 3개 상세 trace + 대신해모vs협성
 * 자동 설명 초안. READ-ONLY.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { loadBusanRows, baselineDomains, type Row } from './shared-loader';
import { composeTotalFromDomains, DOMAIN_WEIGHT_CANDIDATES } from './composition-v3';

const CORE_BENCHMARKS = [
  { label: '대신해모로센트럴아파트', aptSeq: '26140-1356' },
  { label: '협성르네상스(서구)', aptSeq: '26140-51' },
  { label: '구덕금호', aptSeq: '26140-11' },
];

async function main() {
  const { rows, masterByAptSeq, prisma } = await loadBusanRows();
  const masters = [...masterByAptSeq.values()];
  const rowByAptSeq = new Map(rows.map((r) => [r.aptSeq, r]));

  // §30 STEP2와 동일 선정 로직 재사용(41개)
  const GU_LIST = ['중구', '서구', '동구', '영도구', '부산진구', '동래구', '남구', '북구', '해운대구', '사하구', '금정구', '강서구', '연제구', '수영구', '사상구', '기장군'];
  const picks: typeof masters = [];
  const seen = new Set<string>();
  function add(m: (typeof masters)[number] | undefined) { if (m && m.aptSeq && !seen.has(m.aptSeq)) { seen.add(m.aptSeq); picks.push(m); } }
  function livingSum(aptSeq: string): number { const r = rowByAptSeq.get(aptSeq); if (!r) return -1; return [r.livingRaw.mart, r.livingRaw.convenience, r.livingRaw.pharmacy, r.livingRaw.hospital, r.livingRaw.park, r.livingRaw.daycare].filter((v): v is number => v != null).reduce((a, b) => a + b, 0); }

  for (const gu of GU_LIST) { const inGu = masters.filter((m) => m.sigungu === gu && m.totalHouseholds != null); add(inGu[0] ?? masters.find((m) => m.sigungu === gu)); }
  masters.filter((m) => (m.buildYear ?? 0) >= 2020 && (m.totalHouseholds ?? 0) >= 500).slice(0, 3).forEach(add);
  masters.filter((m) => (m.buildYear ?? 9999) <= 1995 && (m.totalHouseholds ?? 0) >= 500).slice(0, 3).forEach(add);
  masters.filter((m) => { const r = rowByAptSeq.get(m.aptSeq!); return r?.subwayRaw != null && r.subwayRaw <= 150; }).slice(0, 3).forEach(add);
  masters.filter((m) => { const r = rowByAptSeq.get(m.aptSeq!); return r?.subwayRaw != null && r.subwayRaw >= 380 && r.subwayRaw <= 420; }).slice(0, 2).forEach(add);
  masters.filter((m) => { const r = rowByAptSeq.get(m.aptSeq!); return r?.eligible && (r.subwayStatus === 'CONFIRMED_ABSENT' || (r.subwayRaw != null && r.subwayRaw >= 900)); }).slice(0, 3).forEach(add);
  masters.filter((m) => { const r = rowByAptSeq.get(m.aptSeq!); return r?.parkingRatio != null && r.parkingRatio >= 1.6; }).slice(0, 3).forEach(add);
  masters.filter((m) => { const r = rowByAptSeq.get(m.aptSeq!); return r?.parkingRatio != null && r.parkingRatio <= 0.6; }).slice(0, 3).forEach(add);
  masters.filter((m) => { const r = rowByAptSeq.get(m.aptSeq!); return r?.elemRaw != null && r.elemRaw <= 150; }).slice(0, 2).forEach(add);
  masters.filter((m) => { const r = rowByAptSeq.get(m.aptSeq!); return r?.elemRaw != null && r.elemRaw >= 750; }).slice(0, 2).forEach(add);
  [...masters].filter((m) => rowByAptSeq.get(m.aptSeq!)?.eligible).sort((a, b) => livingSum(b.aptSeq!) - livingSum(a.aptSeq!)).slice(0, 2).forEach(add);
  [...masters].filter((m) => rowByAptSeq.get(m.aptSeq!)?.eligible && livingSum(m.aptSeq!) >= 0).sort((a, b) => livingSum(a.aptSeq!) - livingSum(b.aptSeq!)).slice(0, 2).forEach(add);
  masters.filter((m) => rowByAptSeq.get(m.aptSeq!)?.peerEligibility === 'PEER_FULL').slice(0, 2).forEach(add);
  masters.filter((m) => rowByAptSeq.get(m.aptSeq!)?.peerEligibility === 'DISPLAY_ONLY').slice(0, 2).forEach(add);
  CORE_BENCHMARKS.forEach((b) => add(masterByAptSeq.get(b.aptSeq)));
  console.log(`[§30] benchmark 확정 = ${picks.length}개`);

  function computeAll(r: Row) {
    const d = baselineDomains(r);
    const covered = [d.transport, d.living, d.education, d.complex].filter((x) => x.score != null).length;
    const eligibility = !r.eligible ? 'NOT_ENOUGH_DATA' : covered / 4 >= 0.75 ? 'SCORE_AVAILABLE' : covered / 4 >= 0.4 ? 'LIMITED' : 'NOT_ENOUGH_DATA';
    const totals: Record<string, number | null> = {};
    if (eligibility !== 'NOT_ENOUGH_DATA') {
      for (const [label, w] of Object.entries(DOMAIN_WEIGHT_CANDIDATES)) totals[label] = composeTotalFromDomains({ transport: d.transport.score, living: d.living.score, education: d.education.score, complex: d.complex.score }, w, 'M1_BOUNDED_REDISTRIBUTION').score;
    } else { for (const label of Object.keys(DOMAIN_WEIGHT_CANDIDATES)) totals[label] = null; }
    return { d, eligibility, coverage: covered / 4, totals };
  }

  const header = 'aptSeq,name,sigungu,dong,eligibility,coverage,transport,living,education,complex,total_WA,total_WB,total_WC,total_WD';
  const lines = picks.map((m) => {
    const r = rowByAptSeq.get(m.aptSeq!)!;
    const { d, eligibility, coverage, totals } = computeAll(r);
    return [m.aptSeq, `"${m.name}"`, m.sigungu, m.umdName, eligibility, coverage.toFixed(2), d.transport.score?.toFixed(1) ?? '', d.living.score?.toFixed(1) ?? '', d.education.score?.toFixed(1) ?? '', d.complex.score?.toFixed(1) ?? '', totals['W-A_BALANCED']?.toFixed(1) ?? '', totals['W-B_LOCATION']?.toFixed(1) ?? '', totals['W-C_RESIDENTIAL']?.toFixed(1) ?? '', totals['W-D_DATA_QUALITY_AWARE']?.toFixed(1) ?? ''].join(',');
  });
  const outDir = path.resolve(__dirname, '../../data/score-v2-step3');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.resolve(outDir, 'benchmark41.csv'), [header, ...lines].join('\n'));
  console.log('[saved] benchmark41.csv');
  lines.forEach((l) => console.log(`  ${l}`));

  // §31-32 고정 3개 상세 + 자동 설명
  console.log('\n[§31] 고정 3개 상세:');
  const details: Record<string, ReturnType<typeof computeAll> & { row: Row }> = {};
  for (const b of CORE_BENCHMARKS) {
    const r = rowByAptSeq.get(b.aptSeq)!;
    const result = computeAll(r);
    details[b.label] = { ...result, row: r };
    console.log(`\n  === ${b.label} ===`);
    console.log(`  raw: subway=${r.subwayRaw}m(${r.subwayStatus}) age=${r.age}y households=${r.households} parking=${r.parkingRatio?.toFixed(2) ?? 'N/A'} elementary=${r.elemRaw}m`);
    console.log(`  domains: transport=${result.d.transport.score?.toFixed(1)} living=${result.d.living.score?.toFixed(1)} education=${result.d.education.score?.toFixed(1)} complex=${result.d.complex.score?.toFixed(1)}`);
    console.log(`  eligibility=${result.eligibility} coverage=${result.coverage.toFixed(2)}`);
    console.log(`  totals: ${JSON.stringify(result.totals)}`);
  }

  console.log('\n[§32] 대신해모 vs 협성 자동 설명 초안:');
  const A = details['대신해모로센트럴아파트']; const B = details['협성르네상스(서구)'];
  const explanation: string[] = [];
  explanation.push(`Transport: 대신해모(${A.d.transport.score?.toFixed(1)}) ${A.d.transport.score! > B.d.transport.score! ? '>' : '<'} 협성(${B.d.transport.score?.toFixed(1)}) — 절대거리 기준 대신해모(${A.row.subwayRaw}m)가 협성(${B.row.subwayRaw}m)보다 지하철에 훨씬 가까운 것이 주 원인.`);
  explanation.push(`Complex: age는 대신해모(${A.row.age}y)가 협성(${B.row.age}y)보다 신축이라 유리, parking은 반대로 협성(${B.row.parkingRatio?.toFixed(2)})이 대신해모(${A.row.parkingRatio?.toFixed(2)})보다 우위 — 두 tradeoff가 상쇄되며 complex domain은 대신해모(${A.d.complex.score?.toFixed(1)}) vs 협성(${B.d.complex.score?.toFixed(1)}).`);
  explanation.push(`Education: 두 단지 모두 동일 공식 통학구역(대신초등학교) 배정 — "학교 수준" 차이가 아니라 물리적 접근성 차이(대신해모 ${A.row.elemRaw}m vs 협성 ${B.row.elemRaw}m)만으로 education 도메인 차이(${A.d.education.score?.toFixed(1)} vs ${B.d.education.score?.toFixed(1)})가 발생함.`);
  explanation.push(`Living: 대신해모(${A.d.living.score?.toFixed(1)}) vs 협성(${B.d.living.score?.toFixed(1)}) — 생활편의 수준은 비슷한 편.`);
  explanation.push(`Total(W-A 기준): 대신해모(${A.totals['W-A_BALANCED']?.toFixed(1)}) vs 협성(${B.totals['W-A_BALANCED']?.toFixed(1)}) — 최종 차이는 위 도메인별 raw fact 기반 tradeoff의 가중합 결과이며, "대신해모가 이겨야 한다"는 규칙을 강제하지 않았다.`);
  explanation.forEach((l) => console.log(`  - ${l}`));

  console.log('\n[§31-C] 구덕금호:');
  const C = details['구덕금호'];
  console.log(`  eligibility=${C.eligibility}(coverage=${C.coverage.toFixed(2)}) — Core 종합점수 미생성, NOT_ENOUGH_DATA 유지`);

  fs.writeFileSync(path.resolve(outDir, 'fixed3-detail.json'), JSON.stringify({ generatedAt: new Date().toISOString(), details, explanation }, null, 1));
  console.log('\n[saved] fixed3-detail.json');

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
