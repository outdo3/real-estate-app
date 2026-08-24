/**
 * E-JIP SCORE V2 STEP 3 — 부산 전체(3,402) full shadow 계산 + weight/composition
 * 후보 비교 + anomaly/sensitivity 감사. READ-ONLY, DB write 없음.
 *
 * SCOPE 선언(§2 SAFE AUTONOMOUS MODE 재량): 전체 조합(transport 3 x complex 3 x
 * education 3 x living 3 x missing-strategy 3 x domain-weight 4 = 972가지)을
 * 전수 비교하지 않는다. 대신:
 *   1) BASELINE composition(STEP2 V2-A 계승: T1 70/30 + sentinel-aware subway,
 *      Complex=C-C, Education=E-A, Living=L-A, missing=M1)을 고정하고
 *   2) domain-weight 후보(W-A/B/C/D)만 그 위에서 바꿔가며 전체 분포/benchmark/
 *      district/cohort/Pareto/sensitivity를 전부 계산하고(§18이 요구하는
 *      "처음으로 4-domain 가중치 비교"의 본체),
 *   3) transport/complex/education/living/missing-strategy 후보는 각각의
 *      목적에 맞는 *타겟 감사*(subway compensation, parking fairness, 분포
 *      비교)만 별도로 수행한다.
 * 이렇게 범위를 좁힌 이유: 972개 조합의 전체 조합 폭발을 방지하고, 각 후보
 * 비교가 실제로 답하려는 질문(예: "T1 vs T3가 초역세권 역전을 얼마나 만드는가")에
 * 집중하기 위함이다.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { subwayDistanceScoreV3, busDistanceScore, busCountScore, ageScore, scaleScore, parkingScore, elementaryDistanceScore, livingCountScore, LIVING_CATEGORY_SPECS, type SubwayDataStatus } from './curves-v3';
import {
  T1_70_30, T2_75_25, T3_80_20,
  complexComposeCA, complexComposeCB, complexComposeCC,
  educationComposeEA, educationComposeEB, educationComposeEC,
  livingComposeLA, livingComposeLB, livingComposeLC,
  composeWithStrategy, composeTotalFromDomains, DOMAIN_WEIGHT_CANDIDATES,
  type MissingDataStrategy, type DomainWeights,
} from './composition-v3';
import type { LivingScores, CompositionResult } from '../score-v2-step2/composition';

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
  const denom = Math.sqrt(dx2 * dy2); return denom === 0 ? NaN : num / denom;
}
function spearman(xs: number[], ys: number[]): number {
  const n = xs.length;
  const rank = (arr: number[]) => { const idx = arr.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]); const r = new Array(n); idx.forEach(([, i], rankIdx) => { r[i] = rankIdx; }); return r; };
  return pearson(rank(xs), rank(ys));
}
function scoreBucket(scores: number[]) {
  const edges = [{ l: '<40', t: (v: number) => v < 40 }, { l: '40-49', t: (v: number) => v >= 40 && v < 50 }, { l: '50-59', t: (v: number) => v >= 50 && v < 60 }, { l: '60-69', t: (v: number) => v >= 60 && v < 70 }, { l: '70-79', t: (v: number) => v >= 70 && v < 80 }, { l: '80-89', t: (v: number) => v >= 80 && v < 90 }, { l: '90+', t: (v: number) => v >= 90 }];
  return edges.map((e) => ({ label: e.l, count: scores.filter(e.t).length, pct: scores.length ? +(100 * scores.filter(e.t).length / scores.length).toFixed(1) : 0 }));
}

async function main() {
  const { prisma } = await import('@/lib/prisma');
  const { classify } = await import('../apartment-score/lib/peer-quality');

  const masters = await prisma.apartmentMaster.findMany({ where: { aptSeq: { not: null } } });
  const locs = await prisma.apartmentLocationFeature.findMany();
  const locByAptSeq = new Map(locs.map((l) => [l.aptSeq, l]));
  const tx = await prisma.apartmentMarketFeature.findMany();
  const txMap = new Map(tx.map((t) => [t.aptSeq, t]));
  const kindergartens = await prisma.kindergarten.findMany({ where: { latitude: { not: null }, longitude: { not: null } }, select: { latitude: true, longitude: true } });

  const quality = new Map(masters.map((m) => [m.aptSeq!, classify({
    aptSeq: m.aptSeq!, roadAddress: m.roadAddress, jibunAddress: m.jibunAddress, mgmBldrgstPk: m.mgmBldrgstPk,
    totalHouseholds: m.totalHouseholds, parkingCount: m.parkingCount, mainBuildingCount: m.mainBuildingCount,
    buildYear: m.buildYear, geocodeQuality: m.geocodeQuality, latitude: m.latitude, longitude: m.longitude,
    transactionCount12m: txMap.get(m.aptSeq!)?.transactionCount12m ?? 0,
  })]));

  function nearestKgDist(lat: number | null, lng: number | null): number | null {
    if (lat == null || lng == null) return null;
    let best = Infinity;
    for (const k of kindergartens) { const dLat = (k.latitude! - lat) * 111000; const dLng = (k.longitude! - lng) * 88000; const d = Math.sqrt(dLat * dLat + dLng * dLng); if (d < best) best = d; }
    return best < Infinity ? best : null;
  }

  interface Row {
    aptSeq: string; name: string; sggCd: string | null; sigungu: string | null; umdName: string | null;
    subwayStatus: SubwayDataStatus; subwayRaw: number | null;
    busDist: number | null; busCount: number | null;
    age: number | null; households: number | null; parkingRatio: number | null;
    elemRaw: number | null; kgDist: number | null;
    livingRaw: { mart: number | null; convenience: number | null; pharmacy: number | null; hospital: number | null; park: number | null; daycare: number | null };
    eligible: boolean; // peerEligibility PEER_FULL/PEER_LIMITED(coordOk) -> Score 계산 후보
    marketPrice: number | null;
  }

  const rows: Row[] = masters.map((m) => {
    const q = quality.get(m.aptSeq!)!;
    const loc = locByAptSeq.get(m.aptSeq!);
    const coordOk = q.transportPeerEligible; // = coord==='COORD_HIGH'
    let subwayStatus: SubwayDataStatus;
    if (!coordOk) subwayStatus = 'COORD_INSUFFICIENT';
    else if (!loc) subwayStatus = 'MISSING';
    else if (loc.nearestSubwayDistanceM != null) subwayStatus = 'VALUE';
    else if (loc.qualityFlag === 'complete') subwayStatus = 'CONFIRMED_ABSENT';
    else subwayStatus = 'MISSING';

    const ratio = q.parkingPeerEligible ? (m.parkingCount as number) / (m.totalHouseholds as number) : null;
    const age = m.buildYear != null ? 2026 - m.buildYear : null;
    const kg = coordOk ? nearestKgDist(m.latitude, m.longitude) : null;

    return {
      aptSeq: m.aptSeq!, name: m.name, sggCd: m.sggCd, sigungu: m.sigungu, umdName: m.umdName,
      subwayStatus, subwayRaw: coordOk ? (loc?.nearestSubwayDistanceM ?? null) : null,
      busDist: coordOk ? (loc?.nearestBusStopDistanceM ?? null) : null, busCount: coordOk ? (loc?.busStopCount300m ?? null) : null,
      age, households: m.totalHouseholds, parkingRatio: ratio,
      elemRaw: coordOk ? (loc?.nearestElementaryDistanceM ?? null) : null, kgDist: kg,
      livingRaw: coordOk && loc ? { mart: loc.martCount1000m, convenience: loc.convenienceCount500m, pharmacy: loc.pharmacyCount500m, hospital: loc.hospitalCount1000m, park: loc.parkCount1000m, daycare: loc.daycareKindergartenCount500m } : { mart: null, convenience: null, pharmacy: null, hospital: null, park: null, daycare: null },
      eligible: q.peerEligibility === 'PEER_FULL' || q.peerEligibility === 'PEER_LIMITED',
      marketPrice: txMap.get(m.aptSeq!)?.medianPricePerM2_12m ?? null,
    };
  });

  // ---------------- factor scores(고정 curve, STEP2 추천 그대로) ----------------
  function factorScores(r: Row) {
    const subway = subwayDistanceScoreV3(r.subwayRaw, r.subwayStatus, 'A_PIECEWISE_LINEAR');
    const busD = r.busDist != null ? busDistanceScore(r.busDist) : null;
    const busC = r.busCount != null ? busCountScore(r.busCount) : null;
    const bus = busD != null && busC != null ? busD * 0.5 + busC * 0.5 : (busD ?? busC);
    const age = r.age != null ? ageScore(r.age, 'A_PIECEWISE') : null;
    const scale = scaleScore(r.households, 'C_PIECEWISE');
    const parking = parkingScore(r.parkingRatio, 'C_PIECEWISE');
    const elementary = r.elemRaw != null ? elementaryDistanceScore(r.elemRaw) : null;
    const kindergarten = r.kgDist != null ? elementaryDistanceScore(r.kgDist) : null;
    const living: LivingScores = {
      mart: r.livingRaw.mart != null ? livingCountScore(r.livingRaw.mart, LIVING_CATEGORY_SPECS[0].halfLife) : null,
      convenience: r.livingRaw.convenience != null ? livingCountScore(r.livingRaw.convenience, LIVING_CATEGORY_SPECS[1].halfLife) : null,
      pharmacy: r.livingRaw.pharmacy != null ? livingCountScore(r.livingRaw.pharmacy, LIVING_CATEGORY_SPECS[2].halfLife) : null,
      hospital: r.livingRaw.hospital != null ? livingCountScore(r.livingRaw.hospital, LIVING_CATEGORY_SPECS[3].halfLife) : null,
      park: r.livingRaw.park != null ? livingCountScore(r.livingRaw.park, LIVING_CATEGORY_SPECS[4].halfLife) : null,
      daycare: r.livingRaw.daycare != null ? livingCountScore(r.livingRaw.daycare, LIVING_CATEGORY_SPECS[5].halfLife) : null,
    };
    return { subway, bus, age, scale, parking, elementary, kindergarten, living };
  }

  const factorCache = new Map<string, ReturnType<typeof factorScores>>();
  for (const r of rows) factorCache.set(r.aptSeq, factorScores(r));

  // ---------------- BASELINE domain composition(M1, T1, C-C, E-A, L-A) ----------------
  function baselineDomains(r: Row) {
    const f = factorCache.get(r.aptSeq)!;
    const transport = T1_70_30(f.subway, f.bus, 'M1_BOUNDED_REDISTRIBUTION');
    const complex = complexComposeCC(f.age, f.scale, f.parking, 'M1_BOUNDED_REDISTRIBUTION');
    const education = educationComposeEA(f.elementary, f.kindergarten, 'M1_BOUNDED_REDISTRIBUTION');
    const living = livingComposeLA(f.living, 'M1_BOUNDED_REDISTRIBUTION');
    return { transport, complex, education, living };
  }
  const domainCache = new Map<string, ReturnType<typeof baselineDomains>>();
  for (const r of rows) domainCache.set(r.aptSeq, baselineDomains(r));

  // ================= §5-6 TRANSPORT composition comparison + compensation audit =================
  console.log('='.repeat(90)); console.log('[§5-6] TRANSPORT composition candidates + subway compensation audit'); console.log('='.repeat(90));
  const transportVariants: Record<string, (aptSeq: string) => CompositionResult> = {
    T1_70_30: (a) => { const f = factorCache.get(a)!; return T1_70_30(f.subway, f.bus, 'M1_BOUNDED_REDISTRIBUTION'); },
    T2_75_25: (a) => { const f = factorCache.get(a)!; return T2_75_25(f.subway, f.bus, 'M1_BOUNDED_REDISTRIBUTION'); },
    T3_80_20: (a) => { const f = factorCache.get(a)!; return T3_80_20(f.subway, f.bus, 'M1_BOUNDED_REDISTRIBUTION'); },
  };
  const eligibleRows = rows.filter((r) => r.eligible);
  for (const [label, fn] of Object.entries(transportVariants)) {
    const entries = eligibleRows.map((r) => ({ aptSeq: r.aptSeq, subwayRaw: r.subwayRaw, subwayStatus: r.subwayStatus, transport: fn(r.aptSeq).score })).filter((e) => e.transport != null && e.subwayRaw != null);
    function inversionCount(thNear: number, thFar: number) {
      const near = entries.filter((e) => e.subwayRaw! <= thNear);
      const far = entries.filter((e) => e.subwayRaw! >= thFar);
      let inv = 0;
      for (const n of near) for (const f of far) if (n.transport! < f.transport!) inv++;
      return { inv, nearN: near.length, farN: far.length, total: near.length * far.length };
    }
    const c200_500 = inversionCount(200, 500);
    const c300_800 = inversionCount(300, 800);
    const c500_1500 = inversionCount(500, 1500);
    console.log(`  ${label}: <=200vs>=500 inv=${c200_500.inv}/${c200_500.total}  <=300vs>=800 inv=${c300_800.inv}/${c300_800.total}  <=500vs>=1500 inv=${c500_1500.inv}/${c500_1500.total}`);
  }

  // ================= §8-9 COMPLEX composition + parking missing fairness =================
  console.log('\n' + '='.repeat(90)); console.log('[§8-9] COMPLEX composition candidates + parking missing fairness'); console.log('='.repeat(90));
  const complexVariants: Record<string, (a: string, strat: MissingDataStrategy) => CompositionResult> = {
    'C-A': (a, s) => { const f = factorCache.get(a)!; return complexComposeCA(f.age, f.scale, f.parking, s); },
    'C-B': (a, s) => { const f = factorCache.get(a)!; return complexComposeCB(f.age, f.scale, f.parking, s); },
    'C-C': (a, s) => { const f = factorCache.get(a)!; return complexComposeCC(f.age, f.scale, f.parking, s); },
  };
  for (const strategy of ['M1_BOUNDED_REDISTRIBUTION', 'M2_PARTIAL_FIXED_DENOMINATOR', 'M3_NEUTRAL_PRIOR'] as MissingDataStrategy[]) {
    console.log(`\n  --- missing-strategy=${strategy} ---`);
    for (const [label, fn] of Object.entries(complexVariants)) {
      const known = rows.filter((r) => r.eligible && r.parkingRatio != null);
      const missing = rows.filter((r) => r.eligible && r.parkingRatio == null && r.age != null); // age band 통제 위해 age 보유만
      const knownScores = known.map((r) => fn(r.aptSeq, strategy).score).filter((s): s is number => s != null);
      const missingScores = missing.map((r) => fn(r.aptSeq, strategy).score).filter((s): s is number => s != null);
      console.log(`    ${label}: KNOWN(n=${knownScores.length}) mean=${mean(knownScores).toFixed(1)} median=${median(knownScores).toFixed(1)}  |  MISSING(n=${missingScores.length}) mean=${mean(missingScores).toFixed(1)} median=${median(missingScores).toFixed(1)}  delta=${(mean(knownScores) - mean(missingScores)).toFixed(1)}`);
    }
  }
  // age-band controlled comparison(C-C, M1) - fairness가 age 차이로 인한 착시가 아님을 확인
  console.log('\n  age-band 통제 비교(C-C, M1) — KNOWN vs MISSING이 같은 age band 내에서도 비슷해야 fair:');
  const ageBands = [[0, 10], [11, 20], [21, 30], [31, 64]];
  for (const [lo, hi] of ageBands) {
    const inBand = rows.filter((r) => r.eligible && r.age != null && r.age >= lo && r.age <= hi);
    const known = inBand.filter((r) => r.parkingRatio != null).map((r) => complexComposeCC(factorCache.get(r.aptSeq)!.age, factorCache.get(r.aptSeq)!.scale, factorCache.get(r.aptSeq)!.parking, 'M1_BOUNDED_REDISTRIBUTION').score).filter((s): s is number => s != null);
    const miss = inBand.filter((r) => r.parkingRatio == null).map((r) => complexComposeCC(factorCache.get(r.aptSeq)!.age, factorCache.get(r.aptSeq)!.scale, factorCache.get(r.aptSeq)!.parking, 'M1_BOUNDED_REDISTRIBUTION').score).filter((s): s is number => s != null);
    console.log(`    age ${lo}-${hi}y: KNOWN(n=${known.length}) mean=${mean(known).toFixed(1)}  MISSING(n=${miss.length}) mean=${mean(miss).toFixed(1)}  delta=${(mean(known) - mean(miss)).toFixed(1)}`);
  }

  // ================= §13 EDUCATION composition comparison =================
  console.log('\n' + '='.repeat(90)); console.log('[§13] EDUCATION composition candidates'); console.log('='.repeat(90));
  const eduVariants: Record<string, (a: string) => CompositionResult> = {
    'E-A': (a) => { const f = factorCache.get(a)!; return educationComposeEA(f.elementary, f.kindergarten, 'M1_BOUNDED_REDISTRIBUTION'); },
    'E-B': (a) => { const f = factorCache.get(a)!; return educationComposeEB(f.elementary, f.kindergarten, 'M1_BOUNDED_REDISTRIBUTION'); },
    'E-C': (a) => { const f = factorCache.get(a)!; return educationComposeEC(f.elementary, 'M1_BOUNDED_REDISTRIBUTION'); },
  };
  for (const [label, fn] of Object.entries(eduVariants)) {
    const scores = eligibleRows.map((r) => fn(r.aptSeq).score).filter((s): s is number => s != null);
    console.log(`  ${label}: n=${scores.length} mean=${mean(scores).toFixed(1)} median=${median(scores).toFixed(1)} p10=${pct(scores, 10).toFixed(1)} p90=${pct(scores, 90).toFixed(1)}`);
  }

  // ================= §15-17 LIVING collector-cap audit + composition comparison =================
  console.log('\n' + '='.repeat(90)); console.log('[§15-17] LIVING collector-cap audit + composition candidates'); console.log('='.repeat(90));
  const hospitalVals = eligibleRows.map((r) => r.livingRaw.hospital).filter((v): v is number => v != null);
  const parkVals = eligibleRows.map((r) => r.livingRaw.park).filter((v): v is number => v != null);
  const hospitalCapped = hospitalVals.filter((v) => v >= 45).length;
  const parkCapped = parkVals.filter((v) => v >= 15).length;
  console.log(`  hospital(cap=45): capped(>=45) = ${hospitalCapped}/${hospitalVals.length}(${(100 * hospitalCapped / hospitalVals.length).toFixed(1)}%)`);
  console.log(`  park(cap=15): capped(>=15) = ${parkCapped}/${parkVals.length}(${(100 * parkCapped / parkVals.length).toFixed(1)}%)`);
  const martConvPairs = eligibleRows.filter((r) => r.livingRaw.mart != null && r.livingRaw.convenience != null);
  const martConv = pearson(martConvPairs.map((r) => r.livingRaw.mart as number), martConvPairs.map((r) => r.livingRaw.convenience as number));
  console.log(`  mart vs convenience correlation(재확인, n=${martConvPairs.length}) = ${martConv.toFixed(3)}`);
  const livingVariants: Record<string, (a: string) => CompositionResult> = {
    'L-A': (a) => { const f = factorCache.get(a)!; return livingComposeLA(f.living, 'M1_BOUNDED_REDISTRIBUTION'); },
    'L-B': (a) => { const f = factorCache.get(a)!; return livingComposeLB(f.living, 'M1_BOUNDED_REDISTRIBUTION'); },
    'L-C': (a) => { const f = factorCache.get(a)!; return livingComposeLC(f.living, 'M1_BOUNDED_REDISTRIBUTION'); },
  };
  for (const [label, fn] of Object.entries(livingVariants)) {
    const scores = eligibleRows.map((r) => fn(r.aptSeq).score).filter((s): s is number => s != null);
    console.log(`  ${label}: n=${scores.length} mean=${mean(scores).toFixed(1)} median=${median(scores).toFixed(1)}`);
  }

  // ================= §19 Domain correlation =================
  console.log('\n' + '='.repeat(90)); console.log('[§19] Domain correlation(baseline composition 기준)'); console.log('='.repeat(90));
  const domainScoresForCorr = eligibleRows.map((r) => { const d = domainCache.get(r.aptSeq)!; return { transport: d.transport.score, living: d.living.score, education: d.education.score, complex: d.complex.score, price: r.marketPrice }; });
  function corrPair(label: string, key1: keyof typeof domainScoresForCorr[0], key2: keyof typeof domainScoresForCorr[0]) {
    const pairs = domainScoresForCorr.filter((d) => d[key1] != null && d[key2] != null);
    const r = pearson(pairs.map((d) => d[key1] as number), pairs.map((d) => d[key2] as number));
    console.log(`  ${label}: r=${r.toFixed(3)}(n=${pairs.length})`);
  }
  corrPair('Transport <-> Living', 'transport', 'living');
  corrPair('Living <-> Education', 'living', 'education');
  corrPair('Transport <-> Complex', 'transport', 'complex');
  corrPair('Transport <-> price(display-only)', 'transport', 'price');
  corrPair('Living <-> price(display-only)', 'living', 'price');

  // ================= §20-21 Eligibility =================
  function eligibilityFor(r: Row, d: ReturnType<typeof baselineDomains>): 'SCORE_AVAILABLE' | 'LIMITED' | 'NOT_ENOUGH_DATA' {
    if (!r.eligible) return 'NOT_ENOUGH_DATA'; // identity/coord 자체가 DISPLAY_ONLY 이하
    const domainVals = [d.transport, d.living, d.education, d.complex];
    const totalWeight = 100; const presentWeight = domainVals.filter((x) => x.score != null).reduce((s, x) => s + 25, 0); // 4-domain 동일가중 가정한 최소 coverage 근사(baseline)
    const coverage = presentWeight / totalWeight;
    if (coverage >= 0.75) return 'SCORE_AVAILABLE';
    if (coverage >= 0.4) return 'LIMITED';
    return 'NOT_ENOUGH_DATA';
  }
  const eligibilityCounts: Record<string, number> = { SCORE_AVAILABLE: 0, LIMITED: 0, NOT_ENOUGH_DATA: 0 };
  for (const r of rows) eligibilityCounts[eligibilityFor(r, domainCache.get(r.aptSeq)!)]++;
  console.log('\n' + '='.repeat(90)); console.log('[§21] Score eligibility(부산 전체 3,402건)'); console.log('='.repeat(90));
  console.log(`  ${JSON.stringify(eligibilityCounts)}`);

  // ================= §18,22-29 Domain-weight candidates -> full distribution/district/cohort =================
  console.log('\n' + '='.repeat(90)); console.log('[§18,22] Domain weight candidates — 부산 전체 total score 분포'); console.log('='.repeat(90));
  interface TotalRow { aptSeq: string; total: number | null; eligibility: string }
  const totalsByWeight: Record<string, TotalRow[]> = {};
  for (const [wLabel, weights] of Object.entries(DOMAIN_WEIGHT_CANDIDATES)) {
    const totals: TotalRow[] = rows.map((r) => {
      const elig = eligibilityFor(r, domainCache.get(r.aptSeq)!);
      if (elig === 'NOT_ENOUGH_DATA') return { aptSeq: r.aptSeq, total: null, eligibility: elig };
      const d = domainCache.get(r.aptSeq)!;
      const t = composeTotalFromDomains({ transport: d.transport.score, living: d.living.score, education: d.education.score, complex: d.complex.score }, weights, 'M1_BOUNDED_REDISTRIBUTION');
      return { aptSeq: r.aptSeq, total: t.score, eligibility: elig };
    });
    totalsByWeight[wLabel] = totals;
    const scores = totals.map((t) => t.total).filter((s): s is number => s != null);
    console.log(`  ${wLabel}(${JSON.stringify(weights)}): n=${scores.length} mean=${mean(scores).toFixed(1)} median=${median(scores).toFixed(1)} p10=${pct(scores, 10).toFixed(1)} p90=${pct(scores, 90).toFixed(1)} min=${Math.min(...scores).toFixed(1)} max=${Math.max(...scores).toFixed(1)}`);
    console.log(`    buckets: ${JSON.stringify(scoreBucket(scores))}`);
  }

  // district(§24) for W-A only(대표)
  const baselineWeight = 'W-A_BALANCED';
  const baselineTotals = totalsByWeight[baselineWeight];
  const totalByAptSeq = new Map(baselineTotals.map((t) => [t.aptSeq, t.total]));
  console.log('\n' + '='.repeat(90)); console.log(`[§24] District(구·군) distribution — ${baselineWeight} 기준`); console.log('='.repeat(90));
  const byGu = new Map<string, number[]>();
  for (const r of rows) { const t = totalByAptSeq.get(r.aptSeq); if (t == null || !r.sggCd) continue; const gu = GU_BY_LAWDCD[r.sggCd] ?? r.sggCd; if (!byGu.has(gu)) byGu.set(gu, []); byGu.get(gu)!.push(t); }
  const guStats = [...byGu.entries()].map(([gu, vs]) => ({ gu, n: vs.length, mean: +mean(vs).toFixed(1), median: +median(vs).toFixed(1), p25: +pct(vs, 25).toFixed(1), p75: +pct(vs, 75).toFixed(1) })).sort((a, b) => a.mean - b.mean);
  console.log(JSON.stringify(guStats, null, 1));
  console.log(`  max/min ratio = ${(guStats[guStats.length - 1].mean / guStats[0].mean).toFixed(2)}x`);

  // cohort audits(§25-29)
  console.log('\n' + '='.repeat(90)); console.log('[§25-29] Cohort audits — ' + baselineWeight); console.log('='.repeat(90));
  function cohortAudit(label: string, bands: { l: string; test: (r: Row) => boolean }[], valueFn: (r: Row) => number | null) {
    console.log(`  --- ${label} ---`);
    for (const b of bands) {
      const inBand = rows.filter((r) => b.test(r));
      const totals = inBand.map((r) => totalByAptSeq.get(r.aptSeq)).filter((v): v is number => v != null);
      const complexVals = inBand.map((r) => domainCache.get(r.aptSeq)!.complex.score).filter((v): v is number => v != null);
      console.log(`    ${b.l}: n=${inBand.length} totalMean=${mean(totals).toFixed(1)} complexMean=${mean(complexVals).toFixed(1)}`);
    }
  }
  cohortAudit('Age cohort', [
    { l: '0-5', test: (r) => r.age != null && r.age <= 5 }, { l: '6-10', test: (r) => r.age != null && r.age >= 6 && r.age <= 10 },
    { l: '11-20', test: (r) => r.age != null && r.age >= 11 && r.age <= 20 }, { l: '21-30', test: (r) => r.age != null && r.age >= 21 && r.age <= 30 },
    { l: '31+', test: (r) => r.age != null && r.age >= 31 },
  ], (r) => r.age);
  cohortAudit('Scale cohort', [
    { l: '<100', test: (r) => r.households != null && r.households < 100 }, { l: '100-299', test: (r) => r.households != null && r.households >= 100 && r.households < 300 },
    { l: '300-499', test: (r) => r.households != null && r.households >= 300 && r.households < 500 }, { l: '500-999', test: (r) => r.households != null && r.households >= 500 && r.households < 1000 },
    { l: '1000+', test: (r) => r.households != null && r.households >= 1000 },
  ], (r) => r.households);

  console.log('  --- Subway cohort(transport factor monotonic check) ---');
  const subwayBands = [
    { l: '<=200(confirmed)', test: (r: Row) => r.subwayRaw != null && r.subwayRaw <= 200 },
    { l: '201-500', test: (r: Row) => r.subwayRaw != null && r.subwayRaw > 200 && r.subwayRaw <= 500 },
    { l: '501-800', test: (r: Row) => r.subwayRaw != null && r.subwayRaw > 500 && r.subwayRaw <= 800 },
    { l: '801-1500', test: (r: Row) => r.subwayRaw != null && r.subwayRaw > 800 },
    { l: 'confirmed-absent', test: (r: Row) => r.subwayStatus === 'CONFIRMED_ABSENT' },
  ];
  let prevMean = Infinity; let subwayMonotonicOk = true;
  for (const b of subwayBands) {
    const inBand = rows.filter((r) => b.test(r));
    const tScores = inBand.map((r) => domainCache.get(r.aptSeq)!.transport.score).filter((v): v is number => v != null);
    const m = mean(tScores);
    console.log(`    ${b.l}: n=${inBand.length} transportMean=${m.toFixed(1)}`);
    if (b.l !== 'confirmed-absent') { if (m > prevMean) subwayMonotonicOk = false; prevMean = m; }
  }
  console.log(`    band-mean monotonic(대역 평균 기준)? ${subwayMonotonicOk ? 'YES' : 'NO(버스 보상 등으로 일부 역전 가능 - 정상 범위인지 별도 판단)'}`);

  console.log('  --- Education cohort ---');
  const eduBands = [
    { l: '<=300', test: (r: Row) => r.elemRaw != null && r.elemRaw <= 300 }, { l: '301-500', test: (r: Row) => r.elemRaw != null && r.elemRaw > 300 && r.elemRaw <= 500 },
    { l: '501-800', test: (r: Row) => r.elemRaw != null && r.elemRaw > 500 && r.elemRaw <= 800 }, { l: '801-1200', test: (r: Row) => r.elemRaw != null && r.elemRaw > 800 },
  ];
  for (const b of eduBands) { const inBand = rows.filter((r) => b.test(r)); const eScores = inBand.map((r) => domainCache.get(r.aptSeq)!.education.score).filter((v): v is number => v != null); console.log(`    ${b.l}: n=${inBand.length} educationMean=${mean(eScores).toFixed(1)}`); }

  console.log('  --- Parking cohort(factor-level, known만) ---');
  const parkBands = [
    { l: '<0.8', test: (r: Row) => r.parkingRatio != null && r.parkingRatio < 0.8 }, { l: '0.8-0.99', test: (r: Row) => r.parkingRatio != null && r.parkingRatio >= 0.8 && r.parkingRatio < 1.0 },
    { l: '1.0-1.19', test: (r: Row) => r.parkingRatio != null && r.parkingRatio >= 1.0 && r.parkingRatio < 1.2 }, { l: '1.2-1.49', test: (r: Row) => r.parkingRatio != null && r.parkingRatio >= 1.2 && r.parkingRatio < 1.5 },
    { l: '1.5+', test: (r: Row) => r.parkingRatio != null && r.parkingRatio >= 1.5 },
  ];
  let prevP = -1; let parkingMonotonicViolation = 0;
  for (const b of parkBands) { const inBand = rows.filter((r) => b.test(r)); const pScores = inBand.map((r) => factorCache.get(r.aptSeq)!.parking).filter((v): v is number => v != null); const m = mean(pScores); console.log(`    ${b.l}: n=${inBand.length} parkingFactorMean=${m.toFixed(1)}`); if (m < prevP) parkingMonotonicViolation++; prevP = m; }
  console.log(`    monotonic violation(대역 평균) = ${parkingMonotonicViolation}`);

  const outDir = path.resolve(__dirname, '../../data/score-v2-step3');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // full-shadow.csv
  const csvHeader = 'aptSeq,name,sigungu,dong,identityQuality,coordQuality,eligibility,confidence_coverage,transport,living,education,complex,total_WA,total_WB,total_WC,total_WD';
  const csvLines = rows.map((r) => {
    const d = domainCache.get(r.aptSeq)!;
    const elig = eligibilityFor(r, d);
    const q = quality.get(r.aptSeq)!;
    const cov = ([d.transport, d.living, d.education, d.complex].filter((x) => x.score != null).length) / 4;
    const wa = totalsByWeight['W-A_BALANCED'].find((t) => t.aptSeq === r.aptSeq)?.total;
    const wb = totalsByWeight['W-B_LOCATION'].find((t) => t.aptSeq === r.aptSeq)?.total;
    const wc = totalsByWeight['W-C_RESIDENTIAL'].find((t) => t.aptSeq === r.aptSeq)?.total;
    const wd = totalsByWeight['W-D_DATA_QUALITY_AWARE'].find((t) => t.aptSeq === r.aptSeq)?.total;
    return [r.aptSeq, `"${r.name}"`, r.sigungu, r.umdName, q.identity, q.coord, elig, cov.toFixed(2), d.transport.score?.toFixed(1) ?? '', d.living.score?.toFixed(1) ?? '', d.education.score?.toFixed(1) ?? '', d.complex.score?.toFixed(1) ?? '', wa?.toFixed(1) ?? '', wb?.toFixed(1) ?? '', wc?.toFixed(1) ?? '', wd?.toFixed(1) ?? ''].join(',');
  });
  fs.writeFileSync(path.resolve(outDir, 'full-shadow.csv'), [csvHeader, ...csvLines].join('\n'));
  console.log('\n[saved] data/score-v2-step3/full-shadow.csv');

  // TOP50/BOTTOM50(W-A 기준)
  const withTotal = rows.map((r) => ({ r, total: totalByAptSeq.get(r.aptSeq) })).filter((x): x is { r: Row; total: number } => x.total != null);
  const sorted = [...withTotal].sort((a, b) => b.total - a.total);
  const top50 = sorted.slice(0, 50);
  const bottom50 = sorted.slice(-50).reverse();
  function toSanityCsv(list: typeof top50) {
    return list.map(({ r, total }) => { const d = domainCache.get(r.aptSeq)!; return [r.aptSeq, `"${r.name}"`, r.sigungu, total.toFixed(1), d.transport.score?.toFixed(1) ?? '', d.living.score?.toFixed(1) ?? '', d.education.score?.toFixed(1) ?? '', d.complex.score?.toFixed(1) ?? '', r.subwayRaw ?? '', r.age ?? '', r.households ?? '', r.parkingRatio?.toFixed(2) ?? ''].join(','); });
  }
  const sanityHeader = 'aptSeq,name,sigungu,total,transport,living,education,complex,subwayM,age,households,parkingRatio';
  fs.writeFileSync(path.resolve(outDir, 'top50.csv'), [sanityHeader, ...toSanityCsv(top50)].join('\n'));
  fs.writeFileSync(path.resolve(outDir, 'bottom50.csv'), [sanityHeader, ...toSanityCsv(bottom50)].join('\n'));
  console.log('[saved] top50.csv / bottom50.csv');
  console.log('\n[§23] TOP5 sample:'); top50.slice(0, 5).forEach(({ r, total }) => console.log(`  ${r.name}(${r.sigungu}) total=${total.toFixed(1)} subway=${r.subwayRaw}m age=${r.age}y households=${r.households} parking=${r.parkingRatio?.toFixed(2)}`));
  console.log('[§23] BOTTOM5 sample:'); bottom50.slice(0, 5).forEach(({ r, total }) => console.log(`  ${r.name}(${r.sigungu}) total=${total.toFixed(1)} subway=${r.subwayRaw}m age=${r.age}y households=${r.households} parking=${r.parkingRatio?.toFixed(2)}`));

  // ================= §38-39 Pareto dominance test =================
  console.log('\n' + '='.repeat(90)); console.log('[§38-39] Pareto dominance test(W-A, SCORE_AVAILABLE만)'); console.log('='.repeat(90));
  const paretoCandidates = rows.filter((r) => eligibilityFor(r, domainCache.get(r.aptSeq)!) !== 'NOT_ENOUGH_DATA').map((r) => { const d = domainCache.get(r.aptSeq)!; return { aptSeq: r.aptSeq, transport: d.transport.score, living: d.living.score, education: d.education.score, complex: d.complex.score, total: totalByAptSeq.get(r.aptSeq) }; }).filter((x) => x.transport != null && x.living != null && x.education != null && x.complex != null && x.total != null) as { aptSeq: string; transport: number; living: number; education: number; complex: number; total: number }[];
  let paretoViolations = 0; let paretoChecked = 0;
  for (let i = 0; i < paretoCandidates.length; i++) {
    for (let j = 0; j < paretoCandidates.length; j++) {
      if (i === j) continue;
      const a = paretoCandidates[i], b = paretoCandidates[j];
      const dominates = a.transport >= b.transport && a.living >= b.living && a.education >= b.education && a.complex >= b.complex && (a.transport > b.transport || a.living > b.living || a.education > b.education || a.complex > b.complex);
      if (dominates) { paretoChecked++; if (a.total <= b.total) paretoViolations++; }
    }
  }
  console.log(`  검사한 dominance 쌍 = ${paretoChecked}, violation(A가 B를 모든 도메인서 지배하는데 total은 낮거나 같음) = ${paretoViolations}`);

  await prisma.$disconnect();

  return { rows, domainCache, factorCache, totalsByWeight, eligibilityCounts, guStats, paretoViolations, paretoChecked };
}
main().then((r) => {
  const fs2 = require('fs'); const path2 = require('path');
  fs2.writeFileSync(path2.resolve(__dirname, '../../data/score-v2-step3/summary.json'), JSON.stringify({
    generatedAt: new Date().toISOString(), eligibilityCounts: r.eligibilityCounts, districtStats: r.guStats, paretoViolations: r.paretoViolations, paretoChecked: r.paretoChecked,
  }, null, 1));
  console.log('\n[saved] data/score-v2-step3/summary.json');
}).catch((e) => { console.error(e); process.exit(1); });
