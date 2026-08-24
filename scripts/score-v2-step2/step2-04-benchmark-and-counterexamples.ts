/**
 * E-JIP SCORE V2 STEP 2 §39-43,47-48 — benchmark 확장(28→30~50) + 대신해모/협성/
 * 구덕금호 factor-level candidate scores + monotonic dominance check + expert
 * sanity cases + counterexample search. READ-ONLY, 숫자 이집점수 미생성(factor/
 * domain candidate score만, §40-41 "아직 최종 이집점수 금지" 그대로 준수).
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { subwayDistanceScore, busDistanceScore, busCountScore, ageScore, scaleScore, parkingScore, elementaryDistanceScore, livingCountScore, LIVING_CATEGORY_SPECS } from './curves';
import { transportComposeT1, complexComposeC3, educationComposeEA, livingComposeL1, type LivingScores } from './composition';

const CORE_BENCHMARKS = [
  { label: '대신해모로센트럴아파트', aptSeq: '26140-1356' },
  { label: '협성르네상스(서구)', aptSeq: '26140-51' },
  { label: '구덕금호', aptSeq: '26140-11' },
];

async function main() {
  const { prisma } = await import('@/lib/prisma');
  const { classify } = await import('../apartment-score/lib/peer-quality');

  const masters = await prisma.apartmentMaster.findMany({ where: { aptSeq: { not: null } } });
  const locs = await prisma.apartmentLocationFeature.findMany();
  const locByAptSeq = new Map(locs.map((l) => [l.aptSeq, l]));
  const tx = await prisma.apartmentMarketFeature.findMany({ select: { aptSeq: true, transactionCount12m: true } });
  const txMap = new Map(tx.map((t) => [t.aptSeq, t.transactionCount12m ?? 0]));
  const masterByAptSeq = new Map(masters.map((m) => [m.aptSeq!, m]));

  const quality = new Map(masters.map((m) => [m.aptSeq!, classify({
    aptSeq: m.aptSeq!, roadAddress: m.roadAddress, jibunAddress: m.jibunAddress, mgmBldrgstPk: m.mgmBldrgstPk,
    totalHouseholds: m.totalHouseholds, parkingCount: m.parkingCount, mainBuildingCount: m.mainBuildingCount,
    buildYear: m.buildYear, geocodeQuality: m.geocodeQuality, latitude: m.latitude, longitude: m.longitude,
    transactionCount12m: txMap.get(m.aptSeq!) ?? 0,
  })]));

  const GU_BY_LAWDCD: Record<string, string> = {
    '26110': '중구', '26140': '서구', '26170': '동구', '26200': '영도구', '26230': '부산진구',
    '26260': '동래구', '26290': '남구', '26320': '북구', '26350': '해운대구', '26380': '사하구',
    '26410': '금정구', '26440': '강서구', '26470': '연제구', '26500': '수영구', '26530': '사상구', '26710': '기장군',
  };

  function livingSum(aptSeq: string): number {
    const l = locByAptSeq.get(aptSeq); if (!l) return -1;
    return [l.martCount1000m, l.convenienceCount500m, l.pharmacyCount500m, l.hospitalCount1000m, l.parkCount1000m, l.daycareKindergartenCount500m].filter((v): v is number => v != null).reduce((a, b) => a + b, 0);
  }

  // ---------------- §39 Benchmark expansion(28 -> 30~50) ----------------
  const picks: typeof masters = [];
  const seen = new Set<string>();
  function add(m: (typeof masters)[number] | undefined, tag: string) { if (m && m.aptSeq && !seen.has(m.aptSeq)) { seen.add(m.aptSeq); picks.push(m); console.log(`  [${tag}] ${m.name}(${m.sigungu}/${m.umdName})`); } }

  console.log('[§39] benchmark 확장 선정:');
  for (const gu of Object.values(GU_BY_LAWDCD)) {
    const inGu = masters.filter((m) => m.sigungu === gu && m.totalHouseholds != null);
    add(inGu[0] ?? masters.find((m) => m.sigungu === gu), `지역대표:${gu}`);
  }
  masters.filter((m) => (m.buildYear ?? 0) >= 2020 && (m.totalHouseholds ?? 0) >= 500).slice(0, 3).forEach((m) => add(m, 'NEW_LARGE'));
  masters.filter((m) => (m.buildYear ?? 9999) <= 1995 && (m.totalHouseholds ?? 0) >= 500).slice(0, 3).forEach((m) => add(m, 'OLD_LARGE'));
  masters.filter((m) => { const d = locByAptSeq.get(m.aptSeq!)?.nearestSubwayDistanceM; return d != null && d <= 150 && quality.get(m.aptSeq!)?.transportPeerEligible; }).slice(0, 3).forEach((m) => add(m, 'ULTRA_SUBWAY'));
  masters.filter((m) => { const d = locByAptSeq.get(m.aptSeq!)?.nearestSubwayDistanceM; return d != null && d >= 380 && d <= 420; }).slice(0, 2).forEach((m) => add(m, 'MID_SUBWAY'));
  masters.filter((m) => { const l = locByAptSeq.get(m.aptSeq!); return quality.get(m.aptSeq!)?.transportPeerEligible && l && (l.nearestSubwayDistanceM == null || l.nearestSubwayDistanceM >= 900); }).slice(0, 3).forEach((m) => add(m, 'NON_SUBWAY'));
  masters.filter((m) => quality.get(m.aptSeq!)?.parkingPeerEligible && (m.parkingCount as number) / (m.totalHouseholds as number) >= 1.6).slice(0, 3).forEach((m) => add(m, 'HIGH_PARKING'));
  masters.filter((m) => quality.get(m.aptSeq!)?.parkingPeerEligible && (m.parkingCount as number) / (m.totalHouseholds as number) <= 0.6).slice(0, 3).forEach((m) => add(m, 'LOW_PARKING'));
  masters.filter((m) => { const d = locByAptSeq.get(m.aptSeq!)?.nearestElementaryDistanceM; return d != null && d <= 150; }).slice(0, 2).forEach((m) => add(m, 'ELEMENTARY_CLOSE'));
  masters.filter((m) => { const d = locByAptSeq.get(m.aptSeq!)?.nearestElementaryDistanceM; return d != null && d >= 750; }).slice(0, 2).forEach((m) => add(m, 'ELEMENTARY_FAR'));
  [...masters].filter((m) => quality.get(m.aptSeq!)?.transportPeerEligible).sort((a, b) => livingSum(b.aptSeq!) - livingSum(a.aptSeq!)).slice(0, 2).forEach((m) => add(m, 'LIVING_DENSE'));
  [...masters].filter((m) => quality.get(m.aptSeq!)?.transportPeerEligible && livingSum(m.aptSeq!) >= 0).sort((a, b) => livingSum(a.aptSeq!) - livingSum(b.aptSeq!)).slice(0, 2).forEach((m) => add(m, 'LIVING_SPARSE'));
  masters.filter((m) => quality.get(m.aptSeq!)?.peerEligibility === 'PEER_FULL').slice(0, 2).forEach((m) => add(m, 'HIGH_CONFIDENCE'));
  masters.filter((m) => quality.get(m.aptSeq!)?.peerEligibility === 'DISPLAY_ONLY').slice(0, 2).forEach((m) => add(m, 'LOW_CONFIDENCE'));
  CORE_BENCHMARKS.forEach((b) => add(masterByAptSeq.get(b.aptSeq), 'CORE_FIXED'));
  console.log(`\n총 ${picks.length}개 benchmark 확정(목표 30~50)`);

  // ---------------- factor/domain candidate score per benchmark ----------------
  function computeFactorScores(m: (typeof masters)[number]) {
    const q = quality.get(m.aptSeq!)!;
    const loc = locByAptSeq.get(m.aptSeq!);
    const transportOk = q.transportPeerEligible;
    const subwayRaw = transportOk ? (loc?.nearestSubwayDistanceM ?? null) : null;
    const subway = subwayRaw != null ? subwayDistanceScore(subwayRaw, 'A_PIECEWISE_LINEAR') : null;
    const busDistRaw = transportOk ? (loc?.nearestBusStopDistanceM ?? null) : null;
    const busCountRaw = transportOk ? (loc?.busStopCount300m ?? null) : null;
    const busD = busDistRaw != null ? busDistanceScore(busDistRaw) : null;
    const busC = busCountRaw != null ? busCountScore(busCountRaw) : null;
    const bus = busD != null && busC != null ? busD * 0.5 + busC * 0.5 : (busD ?? busC);
    const transport = transportComposeT1(subway, bus);

    const age = m.buildYear != null ? 2026 - m.buildYear : null;
    const ageSc = age != null ? ageScore(age, 'A_PIECEWISE') : null;
    const scaleSc = scaleScore(m.totalHouseholds, 'C_PIECEWISE');
    const ratio = q.parkingPeerEligible ? (m.parkingCount as number) / (m.totalHouseholds as number) : null;
    const parkingSc = parkingScore(ratio, 'C_PIECEWISE');
    const complex = complexComposeC3(ageSc, scaleSc, parkingSc);

    const elemRaw = transportOk ? (loc?.nearestElementaryDistanceM ?? null) : null;
    const elemSc = elemRaw != null ? elementaryDistanceScore(elemRaw) : null;
    const education = educationComposeEA(elemSc, null);

    const livingScores: LivingScores = transportOk && loc ? {
      mart: loc.martCount1000m != null ? livingCountScore(loc.martCount1000m, LIVING_CATEGORY_SPECS[0].halfLife) : null,
      convenience: loc.convenienceCount500m != null ? livingCountScore(loc.convenienceCount500m, LIVING_CATEGORY_SPECS[1].halfLife) : null,
      pharmacy: loc.pharmacyCount500m != null ? livingCountScore(loc.pharmacyCount500m, LIVING_CATEGORY_SPECS[2].halfLife) : null,
      hospital: loc.hospitalCount1000m != null ? livingCountScore(loc.hospitalCount1000m, LIVING_CATEGORY_SPECS[3].halfLife) : null,
      park: null, daycare: null,
    } : { mart: null, convenience: null, pharmacy: null, hospital: null, park: null, daycare: null };
    const living = livingComposeL1(livingScores);

    return { raw: { subwayRaw, age, households: m.totalHouseholds, parkingRatio: ratio, elemRaw }, factors: { subway, bus, age: ageSc, scale: scaleSc, parking: parkingSc, elementary: elemSc }, domains: { transport, complex, education, living }, quality: q };
  }

  console.log('\n[§40-41] 대신해모/협성 factor-level candidate scores(MODEL V2-A 곡선 기준, 숫자 이집점수 아님):');
  for (const b of CORE_BENCHMARKS) {
    const m = masterByAptSeq.get(b.aptSeq); if (!m) continue;
    const r = computeFactorScores(m);
    console.log(`\n  ${b.label}(${b.aptSeq})`);
    console.log(`    raw: ${JSON.stringify(r.raw)}`);
    console.log(`    factors: subway=${r.factors.subway?.toFixed(1)} bus=${r.factors.bus?.toFixed(1)} age=${r.factors.age?.toFixed(1)} scale=${r.factors.scale?.toFixed(1)} parking=${r.factors.parking?.toFixed(1)} elementary=${r.factors.elementary?.toFixed(1)}`);
    console.log(`    domains: transport=${r.domains.transport.score?.toFixed(1)}(cov${r.domains.transport.coverage.toFixed(2)}) complex=${r.domains.complex.score?.toFixed(1)}(cov${r.domains.complex.coverage.toFixed(2)}) education=${r.domains.education.score?.toFixed(1)} living=${r.domains.living.score?.toFixed(1)}`);
    console.log(`    quality: ${JSON.stringify(r.quality)}`);
  }

  // ---------------- §42 Dominance check ----------------
  const daesin = computeFactorScores(masterByAptSeq.get('26140-1356')!);
  const hyeongseong = computeFactorScores(masterByAptSeq.get('26140-51')!);
  console.log('\n[§42] Dominance check(raw fact 기준 monotonicity, curve 반영 후):');
  console.log(`  subway: 대신해모(${daesin.factors.subway?.toFixed(1)}) > 협성(${hyeongseong.factors.subway?.toFixed(1)})? ${(daesin.factors.subway! > hyeongseong.factors.subway!) ? 'PASS' : 'FAIL'}`);
  console.log(`  parking: 협성(${hyeongseong.factors.parking?.toFixed(1)}) > 대신해모(${daesin.factors.parking?.toFixed(1)})? ${(hyeongseong.factors.parking! > daesin.factors.parking!) ? 'PASS' : 'FAIL'}`);
  console.log(`  age: 대신해모(${daesin.factors.age?.toFixed(1)}) > 협성(${hyeongseong.factors.age?.toFixed(1)})? ${(daesin.factors.age! > hyeongseong.factors.age!) ? 'PASS' : 'FAIL'}`);
  console.log(`  scale: 대신해모(${daesin.factors.scale?.toFixed(1)}) > 협성(${hyeongseong.factors.scale?.toFixed(1)})? ${(daesin.factors.scale! > hyeongseong.factors.scale!) ? 'PASS' : 'FAIL'}`);

  // ---------------- §43 구덕금호 handling ----------------
  const gdkh = computeFactorScores(masterByAptSeq.get('26140-11')!);
  console.log(`\n[§43] 구덕금호: peerEligibility=${gdkh.quality.peerEligibility}, identity=${gdkh.quality.identity}, coord=${gdkh.quality.coord}`);
  console.log(`  factor-level scores는 계산 가능하나(subway=${gdkh.factors.subway?.toFixed(1)} age=${gdkh.factors.age?.toFixed(1)}), Core overall score는 생성하지 않음(NOT_ENOUGH_DATA 유지, STEP1.5 정책 그대로) — transport/living/education 관련 raw 자체가 coordOk=false라 subway/elementary/living factor는 애초에 null.`);

  // ---------------- §47-48 Expert sanity / counterexample search(전체 universe) ----------------
  console.log('\n[§47] Expert sanity cases(전 universe, MODEL V2-A 도메인 기준):');
  const allComputed = masters.map((m) => ({ m, r: computeFactorScores(m) }));
  const sanity = {
    ultraSubwayLowTransport: allComputed.filter((x) => x.r.raw.subwayRaw != null && x.r.raw.subwayRaw <= 150 && (x.r.domains.transport.score ?? 100) < 50).length,
    highParkingLowParking: allComputed.filter((x) => x.r.raw.parkingRatio != null && x.r.raw.parkingRatio >= 1.5 && (x.r.factors.parking ?? 100) < 50).length,
    newAgeLowAge: allComputed.filter((x) => x.r.raw.age != null && x.r.raw.age <= 5 && (x.r.factors.age ?? 100) < 50).length,
    largeScaleLowScale: allComputed.filter((x) => x.r.raw.households != null && x.r.raw.households >= 1000 && (x.r.factors.scale ?? 100) < 50).length,
    closeSchoolLowEducation: allComputed.filter((x) => x.r.raw.elemRaw != null && x.r.raw.elemRaw <= 300 && (x.r.domains.education.score ?? 100) < 50).length,
  };
  console.log(`  ${JSON.stringify(sanity, null, 1)}`);
  console.log('  (참고: parking/age/scale은 단일변수 순수함수라 factor-level 모순은 구조적으로 0건이어야 정상 — 0이 아니면 curve 버그)');
  console.log('  (transport/education은 domain 합성이라 bus/kindergarten 등 다른 factor가 나쁘면 domain이 50 밑으로 갈 수 있음 — 이건 버그가 아니라 정상적인 tradeoff, §48 counterexample에서 별도 분석)');

  console.log('\n[§48] Counterexample: ultraSubwayLowTransport 실제 사례(있다면) 상세:');
  const ultraLowCases = allComputed.filter((x) => x.r.raw.subwayRaw != null && x.r.raw.subwayRaw <= 150 && (x.r.domains.transport.score ?? 100) < 50);
  for (const c of ultraLowCases.slice(0, 5)) {
    console.log(`  ${c.m.name}: subway=${c.r.raw.subwayRaw}m(factor=${c.r.factors.subway?.toFixed(1)}) bus=${c.r.factors.bus?.toFixed(1)} transport domain=${c.r.domains.transport.score?.toFixed(1)}`);
  }

  const outDir = path.resolve(__dirname, '../../data/score-v2-step2');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.resolve(outDir, 'benchmark-factor-scores.json'), JSON.stringify({
    generatedAt: new Date().toISOString(), benchmarkCount: picks.length,
    benchmarks: picks.map((m) => ({ aptSeq: m.aptSeq, name: m.name, sigungu: m.sigungu, umdName: m.umdName, ...computeFactorScores(m) })),
    coreBenchmarks: { 대신해모: daesin, 협성: hyeongseong, 구덕금호: gdkh },
    sanity, ultraLowCasesCount: ultraLowCases.length,
  }, null, 1));
  console.log('\n[saved] data/score-v2-step2/benchmark-factor-scores.json');

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
