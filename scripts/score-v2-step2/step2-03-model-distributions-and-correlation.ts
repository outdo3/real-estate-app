/**
 * E-JIP SCORE V2 STEP 2 §36,44,45,46 — 3개 MODEL 후보(V2-A/B/C)를 부산 전체
 * 3,402건에 적용한 domain/factor 분포, factor간 correlation, 구·군별 bias 분석.
 * READ-ONLY, DB write 없음. curves.ts/composition.ts 순수 함수만 사용.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import {
  subwayDistanceScore, busDistanceScore, busCountScore, ageScore, scaleScore, parkingScore,
  elementaryDistanceScore, livingCountScore, LIVING_CATEGORY_SPECS,
} from './curves';
import {
  transportComposeT1, transportComposeT2, transportComposeT3,
  complexComposeC1, complexComposeC2, complexComposeC3,
  educationComposeEA, educationComposeEB, educationComposeEC,
  livingComposeL1, livingComposeL2, livingComposeL3,
  type LivingScores,
} from './composition';

const GU_BY_LAWDCD: Record<string, string> = {
  '26110': '중구', '26140': '서구', '26170': '동구', '26200': '영도구', '26230': '부산진구',
  '26260': '동래구', '26290': '남구', '26320': '북구', '26350': '해운대구', '26380': '사하구',
  '26410': '금정구', '26440': '강서구', '26470': '연제구', '26500': '수영구', '26530': '사상구', '26710': '기장군',
};

function mean(xs: number[]): number { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN; }
function median(xs: number[]): number { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; }
function pct(xs: number[], p: number): number { const s = [...xs].sort((a, b) => a - b); if (!s.length) return NaN; return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))]; }
function pearson(xs: number[], ys: number[]): number {
  const n = xs.length; if (n < 2) return NaN;
  const mx = mean(xs), my = mean(ys); let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; num += dx * dy; dx2 += dx * dx; dy2 += dy * dy; }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? NaN : num / denom;
}
function bucketDist(scores: number[]) {
  const edges = [{ l: '0-19', t: (v: number) => v < 20 }, { l: '20-39', t: (v: number) => v >= 20 && v < 40 }, { l: '40-59', t: (v: number) => v >= 40 && v < 60 }, { l: '60-79', t: (v: number) => v >= 60 && v < 80 }, { l: '80-89', t: (v: number) => v >= 80 && v < 90 }, { l: '90-100', t: (v: number) => v >= 90 }];
  return edges.map((e) => ({ label: e.l, count: scores.filter(e.t).length, pct: scores.length ? +(100 * scores.filter(e.t).length / scores.length).toFixed(1) : 0 }));
}

async function main() {
  const { prisma } = await import('@/lib/prisma');
  const { classify } = await import('../apartment-score/lib/peer-quality');

  const masters = await prisma.apartmentMaster.findMany({ where: { aptSeq: { not: null } } });
  const locs = await prisma.apartmentLocationFeature.findMany();
  const locByAptSeq = new Map(locs.map((l) => [l.aptSeq, l]));
  const tx = await prisma.apartmentMarketFeature.findMany({ select: { aptSeq: true, transactionCount12m: true } });
  const txMap = new Map(tx.map((t) => [t.aptSeq, t.transactionCount12m ?? 0]));
  const kindergartens = await prisma.kindergarten.findMany({ where: { latitude: { not: null }, longitude: { not: null } }, select: { latitude: true, longitude: true } });

  const quality = new Map(masters.map((m) => [m.aptSeq!, classify({
    aptSeq: m.aptSeq!, roadAddress: m.roadAddress, jibunAddress: m.jibunAddress, mgmBldrgstPk: m.mgmBldrgstPk,
    totalHouseholds: m.totalHouseholds, parkingCount: m.parkingCount, mainBuildingCount: m.mainBuildingCount,
    buildYear: m.buildYear, geocodeQuality: m.geocodeQuality, latitude: m.latitude, longitude: m.longitude,
    transactionCount12m: txMap.get(m.aptSeq!) ?? 0,
  })]));

  function nearestKgDist(lat: number | null, lng: number | null): number | null {
    if (lat == null || lng == null) return null;
    let best = Infinity;
    for (const k of kindergartens) {
      const dLat = (k.latitude! - lat) * 111000; const dLng = (k.longitude! - lng) * 88000;
      const d = Math.sqrt(dLat * dLat + dLng * dLng);
      if (d < best) best = d;
    }
    return best < Infinity ? best : null;
  }

  interface Row {
    aptSeq: string; sggCd: string | null;
    subwayA: number | null; subwayB: number | null; subwayD: number | null;
    bus: number | null;
    ageA: number | null; ageB: number | null; ageC: number | null;
    scaleA: number | null; scaleB: number | null; scaleC: number | null;
    parkingA: number | null; parkingB: number | null; parkingC: number | null;
    elementary: number | null; kindergarten: number | null;
    living: LivingScores;
    rawAge: number | null; rawHouseholds: number | null; rawParking: number | null; rawSubway: number | null;
    rawLivingSum: number;
  }

  const rows: Row[] = masters.map((m) => {
    const q = quality.get(m.aptSeq!)!;
    const loc = locByAptSeq.get(m.aptSeq!);
    const transportOk = q.transportPeerEligible;
    const subwayRaw = transportOk ? (loc?.nearestSubwayDistanceM ?? null) : null;
    const busDistRaw = transportOk ? (loc?.nearestBusStopDistanceM ?? null) : null;
    const busCountRaw = transportOk ? (loc?.busStopCount300m ?? null) : null;
    const busD = busDistRaw != null ? busDistanceScore(busDistRaw) : null;
    const busC = busCountRaw != null ? busCountScore(busCountRaw) : null;
    const busCombined = busD != null && busC != null ? busD * 0.5 + busC * 0.5 : (busD ?? busC);

    const age = m.buildYear != null ? 2026 - m.buildYear : null;
    const ratio = q.parkingPeerEligible ? (m.parkingCount as number) / (m.totalHouseholds as number) : null;
    const elemRaw = transportOk ? (loc?.nearestElementaryDistanceM ?? null) : null;
    const kgDist = transportOk ? nearestKgDist(m.latitude, m.longitude) : null;

    const livingRaw = transportOk && loc ? {
      mart: loc.martCount1000m, convenience: loc.convenienceCount500m, pharmacy: loc.pharmacyCount500m,
      hospital: loc.hospitalCount1000m, park: loc.parkCount1000m, daycare: loc.daycareKindergartenCount500m,
    } : { mart: null, convenience: null, pharmacy: null, hospital: null, park: null, daycare: null };
    const livingScores: LivingScores = {
      mart: livingRaw.mart != null ? livingCountScore(livingRaw.mart, LIVING_CATEGORY_SPECS[0].halfLife) : null,
      convenience: livingRaw.convenience != null ? livingCountScore(livingRaw.convenience, LIVING_CATEGORY_SPECS[1].halfLife) : null,
      pharmacy: livingRaw.pharmacy != null ? livingCountScore(livingRaw.pharmacy, LIVING_CATEGORY_SPECS[2].halfLife) : null,
      hospital: livingRaw.hospital != null ? livingCountScore(livingRaw.hospital, LIVING_CATEGORY_SPECS[3].halfLife) : null,
      park: livingRaw.park != null ? livingCountScore(livingRaw.park, LIVING_CATEGORY_SPECS[4].halfLife) : null,
      daycare: livingRaw.daycare != null ? livingCountScore(livingRaw.daycare, LIVING_CATEGORY_SPECS[5].halfLife) : null,
    };
    const rawLivingSum = [livingRaw.mart, livingRaw.convenience, livingRaw.pharmacy, livingRaw.hospital, livingRaw.park, livingRaw.daycare].filter((v): v is number => v != null).reduce((a, b) => a + b, 0);

    return {
      aptSeq: m.aptSeq!, sggCd: m.sggCd,
      subwayA: subwayRaw != null ? subwayDistanceScore(subwayRaw, 'A_PIECEWISE_LINEAR') : null,
      subwayB: subwayRaw != null ? subwayDistanceScore(subwayRaw, 'B_LOGISTIC') : null,
      subwayD: subwayRaw != null ? subwayDistanceScore(subwayRaw, 'D_MANUAL_ANCHORED_SATURATION') : null,
      bus: busCombined,
      ageA: age != null ? ageScore(age, 'A_PIECEWISE') : null,
      ageB: age != null ? ageScore(age, 'B_SLOW_DECAY_SATURATION') : null,
      ageC: age != null ? ageScore(age, 'C_LIFECYCLE_BANDS') : null,
      scaleA: scaleScore(m.totalHouseholds, 'A_LOG_NORMALIZED'),
      scaleB: scaleScore(m.totalHouseholds, 'B_LOGISTIC'),
      scaleC: scaleScore(m.totalHouseholds, 'C_PIECEWISE'),
      parkingA: parkingScore(ratio, 'A_LOGISTIC_MID1_SCALE022'),
      parkingB: parkingScore(ratio, 'B_LOGISTIC_WIDE'),
      parkingC: parkingScore(ratio, 'C_PIECEWISE'),
      elementary: elemRaw != null ? elementaryDistanceScore(elemRaw) : null,
      kindergarten: kgDist != null ? elementaryDistanceScore(kgDist) : null, // 동일 곡선족 재사용(§26 kindergarten 전용 곡선 별도 설계 안 함, 거리 semantics 동일)
      living: livingScores,
      rawAge: age, rawHouseholds: m.totalHouseholds, rawParking: ratio, rawSubway: subwayRaw,
      rawLivingSum,
    };
  });

  // ---------------- MODEL definitions ----------------
  function modelA(r: Row) {
    const transport = transportComposeT1(r.subwayA, r.bus);
    const complex = complexComposeC3(r.ageA, r.scaleC, r.parkingC);
    const education = educationComposeEA(r.elementary, r.kindergarten);
    const living = livingComposeL1(r.living);
    return { transport, complex, education, living };
  }
  function modelB(r: Row) {
    const transport = transportComposeT2(r.subwayB, r.bus);
    const complex = complexComposeC2(r.ageB, r.scaleB, r.parkingA);
    const education = educationComposeEB(r.elementary, r.kindergarten);
    const living = livingComposeL2(r.living);
    return { transport, complex, education, living };
  }
  function modelC(r: Row) {
    const transport = transportComposeT3(r.subwayD, r.bus);
    const complex = complexComposeC1(r.ageC, r.scaleA, r.parkingC);
    const education = educationComposeEC(r.elementary);
    const living = livingComposeL3(r.living);
    return { transport, complex, education, living };
  }

  const models = { 'V2-A': modelA, 'V2-B': modelB, 'V2-C': modelC } as const;
  console.log('='.repeat(90));
  console.log('[§44-45] MODEL별 domain score 분포(부산 전체, 도메인별 score != null인 것만)');
  console.log('='.repeat(90));
  const domainDistOutput: Record<string, unknown> = {};
  for (const [name, fn] of Object.entries(models)) {
    const computed = rows.map((r) => fn(r));
    const domainKeys = ['transport', 'complex', 'education', 'living'] as const;
    console.log(`\n--- MODEL ${name} ---`);
    const perDomain: Record<string, unknown> = {};
    for (const dk of domainKeys) {
      const scores = computed.map((c) => c[dk].score).filter((s): s is number => s != null);
      const stat = { n: scores.length, mean: +mean(scores).toFixed(1), median: +median(scores).toFixed(1), p10: +pct(scores, 10).toFixed(1), p90: +pct(scores, 90).toFixed(1) };
      const buckets = bucketDist(scores);
      console.log(`  ${dk}: ${JSON.stringify(stat)}`);
      console.log(`    buckets: ${JSON.stringify(buckets)}`);
      perDomain[dk] = { stat, buckets };
    }
    domainDistOutput[name] = perDomain;
  }

  // ---------------- §46 District bias ----------------
  console.log('\n' + '='.repeat(90));
  console.log('[§46] District bias — MODEL별 transport domain 구·군 평균/중앙값');
  console.log('='.repeat(90));
  const districtBiasOutput: Record<string, unknown> = {};
  for (const [name, fn] of Object.entries(models)) {
    const computed = rows.map((r) => ({ sggCd: r.sggCd, transport: fn(r).transport.score }));
    const byGu = new Map<string, number[]>();
    for (const c of computed) { if (c.transport == null || !c.sggCd) continue; const gu = GU_BY_LAWDCD[c.sggCd] ?? c.sggCd; if (!byGu.has(gu)) byGu.set(gu, []); byGu.get(gu)!.push(c.transport); }
    const guStats = [...byGu.entries()].map(([gu, vs]) => ({ gu, n: vs.length, mean: +mean(vs).toFixed(1), median: +median(vs).toFixed(1), p25: +pct(vs, 25).toFixed(1), p75: +pct(vs, 75).toFixed(1) })).sort((a, b) => a.mean - b.mean);
    console.log(`  MODEL ${name}: min=${guStats[0].gu}(${guStats[0].mean}) max=${guStats[guStats.length - 1].gu}(${guStats[guStats.length - 1].mean}) ratio=${(guStats[guStats.length - 1].mean / guStats[0].mean).toFixed(2)}x`);
    districtBiasOutput[name] = guStats;
  }

  // ---------------- §36 Correlation / duplication audit ----------------
  console.log('\n' + '='.repeat(90));
  console.log('[§36] Correlation / duplication audit(raw fact 기준, 결측 제외 pairwise)');
  console.log('='.repeat(90));
  function pairCorr(label: string, xs: (number | null)[], ys: (number | null)[]) {
    const pairs = xs.map((x, i) => [x, ys[i]]).filter((p): p is [number, number] => p[0] != null && p[1] != null);
    const r = pearson(pairs.map((p) => p[0]), pairs.map((p) => p[1]));
    console.log(`  ${label}: r=${r.toFixed(3)} (n=${pairs.length})`);
    return { label, r, n: pairs.length };
  }
  const correlations = [
    pairCorr('age vs parking(ratio)', rows.map((r) => r.rawAge), rows.map((r) => r.rawParking)),
    pairCorr('age vs households', rows.map((r) => r.rawAge), rows.map((r) => r.rawHouseholds)),
    pairCorr('households vs parking(ratio)', rows.map((r) => r.rawHouseholds), rows.map((r) => r.rawParking)),
    pairCorr('subway distance vs living POI합계(부호주의: subway는 낮을수록 좋음)', rows.map((r) => r.rawSubway), rows.map((r) => r.rawLivingSum)),
    pairCorr('mart vs convenience(living 내부)', rows.map((r) => r.living.mart), rows.map((r) => r.living.convenience)),
    pairCorr('convenience vs pharmacy(living 내부)', rows.map((r) => r.living.convenience), rows.map((r) => r.living.pharmacy)),
    pairCorr('education(elementary) vs living POI합계', rows.map((r) => r.elementary), rows.map((r) => r.rawLivingSum)),
    pairCorr('kindergarten distance-score vs elementary distance-score(중복 위험)', rows.map((r) => r.kindergarten), rows.map((r) => r.elementary)),
  ];

  const outDir = path.resolve(__dirname, '../../data/score-v2-step2');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.resolve(outDir, 'domain-candidate-scores.json'), JSON.stringify({ generatedAt: new Date().toISOString(), domainDistOutput, districtBiasOutput, correlations }, null, 1));
  console.log('\n[saved] data/score-v2-step2/domain-candidate-scores.json');

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
