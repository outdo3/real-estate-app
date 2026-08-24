/**
 * E-JIP SCORE V2 STEP 0.8 §2,13-23,26-29 — 부산 전체 production vs quality-filtered
 * SHADOW score 배치 계산 + benchmark(§19) + inversion(§20-21) + peer sample size(§22) +
 * DONG/SIGUNGU model 비교(§23) + parking/school/complex/life 도메인 audit(§26-29).
 * READ-ONLY, DB write 없음. production calculateApartmentScore()는 §2 검증에서만
 * 실제로 호출(diff=0 확인용)하고, 나머지는 이미 로드한 in-memory dataset으로
 * computeScoreForTarget()(= production 함수 재사용, peer 후보만 교체)을 반복 호출한다.
 *
 * 사용법:
 *   npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js scripts/apartment-score/step08-03-shadow-full-run.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import {
  loadBusanDataset, computeScoreForTarget, getCategory, guNameForSggCd, buildTransportDecomposer, countCrossInversions,
  type BusanDataset, type MasterRow, type ScoreOutcome,
} from './lib/shadow-score';
import { resolvePeerPoolLevels, type PeerCandidate } from '@/lib/apartment-score/server/peer-groups';

// §21 표본 검증용: 특정 target의 실제 transport LOCAL/SIGUNGU/REGION_WIDE fallback
// peer pool을 computeScoreForTarget과 동일한 규칙(resolvePeerPoolLevels, coordOk 필터)으로
// 재구성한다 — "그냥 sigungu 전체"가 아니라 실제로 채택된 레벨의 peer 집합이어야
// decomposeTransport 합계가 보고된 score와 정확히 일치한다.
function actualTransportPeerPool(target: MasterRow, ds: BusanDataset): string[] {
  const cohort = ds.cohortsBySggCd.get(target.sggCd ?? '') ?? [];
  const coordOk: PeerCandidate[] = cohort
    .filter((m) => ds.qualityByAptSeq.get(m.aptSeq)?.transportPeerEligible === true)
    .map((m) => ({ aptSeq: m.aptSeq, sggCd: m.sggCd, umdName: m.umdName, buildYear: m.buildYear }));
  const targetCandidate: PeerCandidate = { aptSeq: target.aptSeq, sggCd: target.sggCd, umdName: target.umdName, buildYear: target.buildYear };
  const levels = resolvePeerPoolLevels(targetCandidate, coordOk, false);
  // computeCategoryWithFallback과 동일하게 첫 NOT_SCORED가 아닌 레벨을 채택(§21 표본은
  // 이미 SCORED임을 알고 있으므로 levels[0]이 NOT_SCORED면 다음으로 넘어간다).
  const chosen = levels.find((l) => l.tier !== 'NOT_SCORED') ?? levels[levels.length - 1];
  return chosen.aptSeqs;
}

const CORE_BENCHMARKS = [
  { label: '대신해모로센트럴아파트', aptSeq: '26140-1356' },
  { label: '협성르네상스(서구)', aptSeq: '26140-51' },
  { label: '구덕금호', aptSeq: '26140-11' },
];

function mean(xs: number[]): number { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN; }
function median(xs: number[]): number { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; }
function pct(xs: number[], p: number): number { const s = [...xs].sort((a, b) => a - b); if (!s.length) return NaN; return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))]; }
function pearson(xs: number[], ys: number[]): number {
  const n = xs.length; if (n === 0) return NaN;
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; num += dx * dy; dx2 += dx * dx; dy2 += dy * dy; }
  return num / Math.sqrt(dx2 * dy2);
}

interface Row {
  aptSeq: string; name: string; sggCd: string | null; umdName: string | null;
  prod: ScoreOutcome; shadow: ScoreOutcome;
}

async function main() {
  const ds = await loadBusanDataset();
  const decomposeTransport = await buildTransportDecomposer();
  const { calculateApartmentScore } = await import('@/lib/apartment-score/server/calculate');

  // ---------------- §2: production formula 100% 일치 검증 ----------------
  console.log('='.repeat(90));
  console.log('[§2] production V1 재현 검증: computeScoreForTarget(mode=PRODUCTION) vs 실제 calculateApartmentScore()');
  console.log('='.repeat(90));
  const verifyTargets = [...CORE_BENCHMARKS.map((b) => b.aptSeq), ...ds.masters.slice(0, 15).map((m) => m.aptSeq)];
  let mismatches = 0;
  for (const aptSeq of verifyTargets) {
    const m = ds.masterByAptSeq.get(aptSeq);
    if (!m || !m.sggCd) continue;
    const cohort = ds.cohortsBySggCd.get(m.sggCd) ?? [];
    const mine = computeScoreForTarget(m, cohort, ds, 'PRODUCTION');
    const real = await calculateApartmentScore(aptSeq);
    const realScore = real.status === 'OK' ? real.score : null;
    const match = mine.score === realScore && (mine.status === 'OK') === (real.status === 'OK');
    if (!match) { mismatches++; console.log(`  MISMATCH ${aptSeq}: mine=${mine.score}(${mine.status}) real=${realScore}(${real.status})`); }
  }
  console.log(`검증 대상 ${verifyTargets.length}건 중 불일치 ${mismatches}건 (0이어야 함 — production formula 완전 재사용 확인)`);

  // ---------------- §13-15: 부산 전체 production vs shadow 배치 ----------------
  console.log('\n[§13-15] 부산 전체 production vs shadow 배치 계산 중...');
  const rows: Row[] = [];
  for (const m of ds.masters) {
    if (!m.sggCd) continue;
    const cohort = ds.cohortsBySggCd.get(m.sggCd) ?? [];
    const prod = computeScoreForTarget(m, cohort, ds, 'PRODUCTION');
    const shadow = computeScoreForTarget(m, cohort, ds, 'SHADOW_FILTERED');
    rows.push({ aptSeq: m.aptSeq, name: m.name, sggCd: m.sggCd, umdName: m.umdName, prod, shadow });
  }
  console.log(`총 ${rows.length}건 계산 완료.`);

  // transport delta
  const transportDeltas = rows
    .map((r) => ({ r, p: getCategory(r.prod, 'transport')?.score ?? null, s: getCategory(r.shadow, 'transport')?.score ?? null }))
    .filter((x): x is { r: Row; p: number; s: number } => x.p != null && x.s != null)
    .map((x) => ({ ...x, delta: x.s - x.p }));
  const tDeltaVals = transportDeltas.map((x) => x.delta);
  console.log('\n[§14] transport shadow impact (n=' + tDeltaVals.length + '):');
  console.log(`  mean=${mean(tDeltaVals).toFixed(2)} median=${median(tDeltaVals).toFixed(2)} p10=${pct(tDeltaVals, 10).toFixed(2)} p90=${pct(tDeltaVals, 90).toFixed(2)}`);
  console.log(`  max+=${Math.max(...tDeltaVals).toFixed(2)} max-=${Math.min(...tDeltaVals).toFixed(2)}`);
  const tAbs = tDeltaVals.map(Math.abs);
  console.log(`  |delta|>=20: ${tAbs.filter((d) => d >= 20).length}  >=10: ${tAbs.filter((d) => d >= 10).length}  >=5: ${tAbs.filter((d) => d >= 5).length}  <5: ${tAbs.filter((d) => d < 5).length}`);

  // total delta
  const totalDeltas = rows
    .filter((r) => r.prod.score != null && r.shadow.score != null)
    .map((r) => ({ r, delta: (r.shadow.score as number) - (r.prod.score as number) }));
  const totDeltaVals = totalDeltas.map((x) => x.delta);
  console.log(`\n[§15] total score shadow impact (n=${totDeltaVals.length}, 양쪽 다 OK인 것만):`);
  console.log(`  mean=${mean(totDeltaVals).toFixed(2)} median=${median(totDeltaVals).toFixed(2)}`);
  const totAbs = totDeltaVals.map(Math.abs);
  console.log(`  |delta| 0: ${totAbs.filter((d) => d === 0).length}  1~4: ${totAbs.filter((d) => d >= 1 && d <= 4).length}  5~9: ${totAbs.filter((d) => d >= 5 && d <= 9).length}  >=10: ${totAbs.filter((d) => d >= 10).length}  (누적 >=5: ${totAbs.filter((d) => d >= 5).length})`);
  const prodOkCount = rows.filter((r) => r.prod.status === 'OK').length;
  const shadowOkCount = rows.filter((r) => r.shadow.status === 'OK').length;
  console.log(`  production OK=${prodOkCount}건, shadow OK=${shadowOkCount}건 (${prodOkCount - shadowOkCount}건이 quality-filter로 INSUFFICIENT_DATA 전환)`);

  // rank change
  const withBoth = rows.filter((r) => r.prod.score != null && r.shadow.score != null) as (Row & { prod: { score: number } })[];
  const byProd = [...withBoth].sort((a, b) => (b.prod.score as number) - (a.prod.score as number));
  const byShadow = [...withBoth].sort((a, b) => (b.shadow.score as number) - (a.shadow.score as number));
  const prodRank = new Map(byProd.map((r, i) => [r.aptSeq, i + 1]));
  const shadowRank = new Map(byShadow.map((r, i) => [r.aptSeq, i + 1]));
  const rankShifts = withBoth.map((r) => Math.abs((prodRank.get(r.aptSeq) ?? 0) - (shadowRank.get(r.aptSeq) ?? 0)));
  console.log(`\n[§15] 순위 변화(부산 전체 total score 순위, n=${withBoth.length}): mean shift=${mean(rankShifts).toFixed(1)} median=${median(rankShifts)} p90=${pct(rankShifts, 90)} max=${Math.max(...rankShifts)}`);
  console.log(`  100계단 이상 이동: ${rankShifts.filter((s) => s >= 100).length}건, 50계단 이상: ${rankShifts.filter((s) => s >= 50).length}건`);

  // ---------------- §16-17: 대신해모/협성 shadow ----------------
  console.log('\n[§16-17] 핵심 벤치마크 current(production)/shadow:');
  const benchmarkDetails: Record<string, unknown> = {};
  for (const b of CORE_BENCHMARKS) {
    const row = rows.find((r) => r.aptSeq === b.aptSeq);
    if (!row) { console.log(`  ${b.label}: NOT FOUND in batch`); continue; }
    const pT = getCategory(row.prod, 'transport');
    const sT = getCategory(row.shadow, 'transport');
    console.log(`  ${b.label} (${b.aptSeq})`);
    console.log(`    total: production=${row.prod.score ?? row.prod.status} shadow=${row.shadow.score ?? row.shadow.status} delta=${row.prod.score != null && row.shadow.score != null ? (row.shadow.score - row.prod.score) : 'N/A'}`);
    console.log(`    transport: production=${pT?.score?.toFixed(1) ?? pT?.status} (peer=${pT?.peerLevel}/${pT?.peerSampleSize}) shadow=${sT?.score?.toFixed(1) ?? sT?.status} (peer=${sT?.peerLevel}/${sT?.peerSampleSize})`);
    for (const key of ['living', 'parking', 'complex', 'schoolAccess'] as const) {
      const pc = getCategory(row.prod, key); const sc = getCategory(row.shadow, key);
      console.log(`    ${key}: production=${pc?.score?.toFixed(1) ?? pc?.status} shadow=${sc?.score?.toFixed(1) ?? sc?.status}`);
    }
    benchmarkDetails[b.label] = { aptSeq: b.aptSeq, prod: row.prod, shadow: row.shadow, quality: ds.qualityByAptSeq.get(b.aptSeq) };
  }

  // ---------------- §18: 구덕금호 negative case ----------------
  console.log('\n[§18] 구덕금호 SHADOW 처리:');
  const gdkh = rows.find((r) => r.aptSeq === '26140-11');
  const gdkhQ = ds.qualityByAptSeq.get('26140-11');
  console.log(`  quality: identity=${gdkhQ?.identity} coord=${gdkhQ?.coord} peerEligibility=${gdkhQ?.peerEligibility}`);
  console.log(`  domain eligibility: transport=${gdkhQ?.transportPeerEligible} parking=${gdkhQ?.parkingPeerEligible} complex=${gdkhQ?.complexPeerEligible}`);
  console.log(`  production: total=${gdkh?.prod.score ?? gdkh?.prod.status} coverage=${gdkh?.prod.coverage.toFixed(2)}`);
  console.log(`  shadow: total=${gdkh?.shadow.score ?? gdkh?.shadow.status} coverage=${gdkh?.shadow.coverage.toFixed(2)}`);
  if (gdkh) gdkh.shadow.categories.forEach((c) => console.log(`    shadow.${c.key}: status=${c.status} score=${c.score?.toFixed(1) ?? 'null'} peer=${c.peerLevel}/${c.peerSampleSize}`));

  // ---------------- §19: benchmark 24~30개 재사용(STEP0 §11 선정 로직 재사용) ----------------
  console.log('\n[§19] STEP0 benchmark set 재사용 + production/shadow 비교:');
  const districts = ['서구', '해운대구', '동래구', '수영구', '남구', '부산진구', '연제구', '강서구', '기장군'];
  const picks: MasterRow[] = [];
  const seen = new Set<string>();
  function addPick(m: MasterRow | undefined) { if (m && !seen.has(m.aptSeq)) { seen.add(m.aptSeq); picks.push(m); } }
  for (const d of districts) {
    const inDistrict = ds.masters.filter((m) => m.sigungu === d);
    const withHouseholds = inDistrict.filter((m) => m.totalHouseholds != null);
    addPick(withHouseholds[0] ?? inDistrict[0]);
  }
  ds.masters.filter((m) => (m.buildYear ?? 0) >= 2020 && (m.totalHouseholds ?? 0) >= 500).slice(0, 3).forEach(addPick);
  ds.masters.filter((m) => (m.buildYear ?? 9999) <= 2000 && (m.totalHouseholds ?? 0) >= 500).slice(0, 3).forEach(addPick);
  ds.masters.filter((m) => { const d = ds.locationByAptSeq.get(m.aptSeq)?.nearestSubwayDistanceM; return d != null && d <= 200; }).slice(0, 4).forEach(addPick);
  ds.masters.filter((m) => { const d = ds.locationByAptSeq.get(m.aptSeq)?.nearestSubwayDistanceM; return d != null && d >= 1500; }).slice(0, 3).forEach(addPick);
  [...ds.masters].filter((m) => m.totalHouseholds != null).sort((a, b) => (b.totalHouseholds as number) - (a.totalHouseholds as number)).slice(0, 5).forEach(addPick);
  ds.masters.filter((m) => (m.buildYear ?? 9999) <= 1990 && m.totalHouseholds != null).slice(0, 4).forEach(addPick);
  CORE_BENCHMARKS.forEach((b) => addPick(ds.masterByAptSeq.get(b.aptSeq)));
  console.log(`  총 ${picks.length}개 benchmark 단지 (STEP0 §11 선정 로직 + STEP0.8 핵심 3개)`);

  const benchmarkRows = picks.map((m) => {
    const row = rows.find((r) => r.aptSeq === m.aptSeq)!;
    const pT = getCategory(row.prod, 'transport'); const sT = getCategory(row.shadow, 'transport');
    const dist = ds.locationByAptSeq.get(m.aptSeq)?.nearestSubwayDistanceM ?? null;
    return {
      aptSeq: m.aptSeq, name: m.name, sigungu: m.sigungu, umdName: m.umdName,
      prodTotal: row.prod.score, shadowTotal: row.shadow.score,
      prodTransport: pT?.score ?? null, shadowTransport: sT?.score ?? null,
      peerLevel: sT?.peerLevel ?? null, peerSampleSize: sT?.peerSampleSize ?? null,
      nearestSubwayDistanceM: dist,
    };
  });
  benchmarkRows.forEach((r) => {
    console.log(`  ${r.aptSeq} | ${r.name} | ${r.sigungu}/${r.umdName} | prodTotal=${r.prodTotal ?? 'N/A'} shadowTotal=${r.shadowTotal ?? 'N/A'} | prodT=${r.prodTransport?.toFixed(0) ?? '-'} shadowT=${r.shadowTransport?.toFixed(0) ?? '-'} | peer=${r.peerLevel}/${r.peerSampleSize} | subwayM=${r.nearestSubwayDistanceM ?? '?'}`);
  });

  // ---------------- §20: suspicious transport inversion (cross-population) ----------------
  console.log('\n[§20] transport 지하철거리 vs shadow transport score cross-population inversion:');
  const transportEntries = rows
    .map((r) => ({ aptSeq: r.aptSeq, raw: ds.locationByAptSeq.get(r.aptSeq)?.nearestSubwayDistanceM ?? null, score: getCategory(r.shadow, 'transport')?.score ?? null }))
    .filter((x): x is { aptSeq: string; raw: number; score: number } => x.raw != null && x.score != null);
  console.log(`  cross-population 비교 모집단(shadow transport SCORED/PARTIAL + 실거리 보유) = ${transportEntries.length}건`);
  const transportInversions = countCrossInversions(transportEntries, 'lowerIsBetter', [200, 300, 500]);
  transportInversions.forEach((r) => console.log(`  distance gap >= ${r.threshold}m: inversion ${r.count}건 / 비교대상쌍 ${r.totalPairsChecked}쌍 (${(100 * r.count / r.totalPairsChecked).toFixed(3)}%)`));

  // ---------------- §21: component dominance sample ----------------
  console.log('\n[§21] component dominance 표본(지하철 100~200m인데 500~800m보다 낮은 사례):');
  const near = transportEntries.filter((e) => e.raw >= 100 && e.raw <= 200);
  const far = transportEntries.filter((e) => e.raw >= 500 && e.raw <= 800);
  const dominanceCases: { near: typeof near[0]; far: typeof far[0] }[] = [];
  for (const n of near) { for (const f of far) { if (n.score < f.score) dominanceCases.push({ near: n, far: f }); } }
  console.log(`  near(100~200m) n=${near.length}, far(500~800m) n=${far.length}, 역전 쌍 = ${dominanceCases.length}`);
  // 다양성 확보: near 후보를 무작위 셔플 없이 aptSeq 기준 균등 간격 샘플링해 특정
  // 단지(예: 대신해모) 하나로 표본이 쏠리지 않게 한다.
  const shuffledPairs = dominanceCases.filter((_, idx) => idx % Math.max(1, Math.floor(dominanceCases.length / 20)) === 0);
  const sampleCases = shuffledPairs.slice(0, 5);
  for (const c of sampleCases) {
    const nm = ds.masterByAptSeq.get(c.near.aptSeq)!; const fm = ds.masterByAptSeq.get(c.far.aptSeq)!;
    const nPool = actualTransportPeerPool(nm, ds);
    const nDecomp = decomposeTransport(c.near.aptSeq, nPool, ds.locationByAptSeq);
    const fPool = actualTransportPeerPool(fm, ds);
    const fDecomp = decomposeTransport(c.far.aptSeq, fPool, ds.locationByAptSeq);
    console.log(`  NEAR ${nm?.name}(${c.near.raw}m) score=${c.near.score.toFixed(1)} peerN=${nPool.length} [subway=${nDecomp.subwayComponent.toFixed(1)} bus=${nDecomp.busComponent.toFixed(1)} sum=${nDecomp.finalTransport.toFixed(1)}]  vs  FAR ${fm?.name}(${c.far.raw}m) score=${c.far.score.toFixed(1)} peerN=${fPool.length} [subway=${fDecomp.subwayComponent.toFixed(1)} bus=${fDecomp.busComponent.toFixed(1)} sum=${fDecomp.finalTransport.toFixed(1)}]`);
  }
  // 대신해모 자신도 별도로 정확히 재확인(§16-17과 동일 수치가 나와야 함).
  const daesinM = ds.masterByAptSeq.get('26140-1356');
  if (daesinM) {
    const pool = actualTransportPeerPool(daesinM, ds);
    const d = decomposeTransport('26140-1356', pool, ds.locationByAptSeq);
    console.log(`  [검증] 대신해모로센트럴 peerN=${pool.length} subway=${d.subwayComponent.toFixed(2)} bus=${d.busComponent.toFixed(2)} sum=${d.finalTransport.toFixed(2)} (§16-17 shadow transport=63.2와 일치해야 함)`);
  }

  // ---------------- §22: peer sample size impact ----------------
  console.log('\n[§22] peer sample size impact (shadow transport LOCAL/SIGUNGU 카테고리 결과 기준):');
  const sampleBuckets = [{ label: 'n<10', test: (n: number) => n < 10 }, { label: '10~19', test: (n: number) => n >= 10 && n < 20 }, { label: '20~29', test: (n: number) => n >= 20 && n < 30 }, { label: '30+', test: (n: number) => n >= 30 }];
  const scoredTransport = rows.map((r) => getCategory(r.shadow, 'transport')).filter((c): c is NonNullable<typeof c> => !!c && c.score != null);
  for (const b of sampleBuckets) {
    const inBucket = scoredTransport.filter((c) => b.test(c.peerSampleSize));
    const scores = inBucket.map((c) => c.score as number);
    const extreme = scores.filter((s) => s <= 10 || s >= 90).length;
    const variance = scores.length ? mean(scores.map((s) => (s - mean(scores)) ** 2)) : NaN;
    console.log(`  ${b.label}: n=${inBucket.length}  scoreVariance=${variance.toFixed(1)}  extreme(<=10 or >=90)=${extreme}건(${inBucket.length ? (100 * extreme / inBucket.length).toFixed(1) : '0'}%)`);
  }

  // ---------------- §23: DONG vs SIGUNGU shadow model ----------------
  console.log('\n[§23] DONG(R1, 현재 shadow) vs SIGUNGU-only(R2) transport model 비교:');
  const r2Rows = rows.map((r) => {
    const m = ds.masterByAptSeq.get(r.aptSeq)!;
    const cohort = ds.cohortsBySggCd.get(m.sggCd ?? '') ?? [];
    const coordOk = cohort.filter((c) => ds.qualityByAptSeq.get(c.aptSeq)?.transportPeerEligible).map((c) => c.aptSeq);
    const tier = coordOk.length >= 10 ? 'HIGH' : coordOk.length >= 5 ? 'MEDIUM' : 'NOT_SCORED';
    if (tier === 'NOT_SCORED') return { aptSeq: r.aptSeq, score: null as number | null, sggCd: m.sggCd };
    const decomp = decomposeTransport(r.aptSeq, coordOk, ds.locationByAptSeq);
    const included = decomp.parts.some((p) => p.included);
    return { aptSeq: r.aptSeq, score: included ? decomp.finalTransport : null, sggCd: m.sggCd };
  });
  const r1Scores = scoredTransport.map((c) => c.score as number);
  const r2Scores = r2Rows.filter((r) => r.score != null).map((r) => r.score as number);
  console.log(`  R1(DONG) coverage=${scoredTransport.length}/${rows.length}  R2(SIGUNGU) coverage=${r2Rows.filter((r) => r.score != null).length}/${rows.length}`);
  console.log(`  R1 mean=${mean(r1Scores).toFixed(1)} stdev~=${Math.sqrt(mean(r1Scores.map((s) => (s - mean(r1Scores)) ** 2))).toFixed(1)}  R2 mean=${mean(r2Scores).toFixed(1)} stdev~=${Math.sqrt(mean(r2Scores.map((s) => (s - mean(r2Scores)) ** 2))).toFixed(1)}`);
  // district bias: gu별 평균 transport score 스프레드(R1 vs R2)
  function guSpread(entries: { sggCd: string | null; score: number | null }[]) {
    const byGu = new Map<string, number[]>();
    for (const e of entries) { if (e.score == null || !e.sggCd) continue; const gu = guNameForSggCd(e.sggCd); if (!byGu.has(gu)) byGu.set(gu, []); byGu.get(gu)!.push(e.score); }
    const means = [...byGu.entries()].map(([gu, arr]) => ({ gu, mean: mean(arr), n: arr.length }));
    const vals = means.map((m) => m.mean);
    return { min: Math.min(...vals), max: Math.max(...vals), ratio: Math.max(...vals) / Math.min(...vals), byGu: means };
  }
  const r1ForSpread = rows.map((r) => ({ sggCd: r.sggCd, score: getCategory(r.shadow, 'transport')?.score ?? null }));
  const r1Spread = guSpread(r1ForSpread);
  const r2Spread = guSpread(r2Rows);
  console.log(`  구별 평균 transport score 스프레드: R1 min=${r1Spread.min.toFixed(1)} max=${r1Spread.max.toFixed(1)} ratio=${r1Spread.ratio.toFixed(2)}x  |  R2 min=${r2Spread.min.toFixed(1)} max=${r2Spread.max.toFixed(1)} ratio=${r2Spread.ratio.toFixed(2)}x`);
  const r2Inversions = countCrossInversions(
    r2Rows.map((r) => ({ aptSeq: r.aptSeq, raw: ds.locationByAptSeq.get(r.aptSeq)?.nearestSubwayDistanceM ?? null, score: r.score })).filter((x): x is { aptSeq: string; raw: number; score: number } => x.raw != null && x.score != null),
    'lowerIsBetter', [300]
  );
  console.log(`  distance gap>=300m 기준 inversion: R1=${transportInversions.find((x) => x.threshold === 300)?.count} vs R2=${r2Inversions[0].count}`);

  // ---------------- §26: parking cross-peer audit ----------------
  console.log('\n[§26] parking cross-peer audit:');
  const parkingEligibleCount = ds.masters.filter((m) => ds.qualityByAptSeq.get(m.aptSeq)?.parkingPeerEligible).length;
  console.log(`  parkingPeerEligible = ${parkingEligibleCount}/${ds.masters.length} (${(100 * parkingEligibleCount / ds.masters.length).toFixed(1)}%)`);
  const parkingCats = rows.map((r) => getCategory(r.shadow, 'parking')).filter((c): c is NonNullable<typeof c> => !!c);
  const parkingSampleBuckets = sampleBuckets.map((b) => ({ label: b.label, n: parkingCats.filter((c) => b.test(c.peerSampleSize)).length }));
  console.log(`  shadow parking peer sample size 분포: ${JSON.stringify(parkingSampleBuckets)}`);
  const parkingEntries = rows.map((r) => {
    const m = ds.masterByAptSeq.get(r.aptSeq)!;
    const ratio = m.parkingCount != null && m.totalHouseholds != null && m.totalHouseholds > 0 ? m.parkingCount / m.totalHouseholds : null;
    const score = getCategory(r.shadow, 'parking')?.score ?? null;
    return ratio != null && score != null ? { aptSeq: r.aptSeq, raw: ratio, score } : null;
  }).filter((x): x is { aptSeq: string; raw: number; score: number } => x != null);
  const parkingInversions = countCrossInversions(parkingEntries, 'higherIsBetter', [0.3, 0.5]);
  parkingInversions.forEach((r) => console.log(`  ratio gap >= ${r.threshold}: inversion ${r.count}건 / ${r.totalPairsChecked}쌍`));

  // ---------------- §27: school cross-peer audit ----------------
  console.log('\n[§27] school cross-peer audit:');
  const schoolEntries = rows
    .map((r) => ({ aptSeq: r.aptSeq, raw: ds.locationByAptSeq.get(r.aptSeq)?.nearestElementaryDistanceM ?? null, score: getCategory(r.shadow, 'schoolAccess')?.score ?? null }))
    .filter((x): x is { aptSeq: string; raw: number; score: number } => x.raw != null && x.score != null);
  const schoolInversions = countCrossInversions(schoolEntries, 'lowerIsBetter', [200, 300]);
  schoolInversions.forEach((r) => console.log(`  elementary distance gap >= ${r.threshold}m: inversion ${r.count}건 / ${r.totalPairsChecked}쌍`));

  // ---------------- §28: complex domain audit ----------------
  console.log('\n[§28] complex domain audit (buildYear correlation):');
  const complexEntries = rows.map((r) => {
    const m = ds.masterByAptSeq.get(r.aptSeq)!;
    return { buildYear: m.buildYear, prodScore: getCategory(r.prod, 'complex')?.score ?? null, shadowScore: getCategory(r.shadow, 'complex')?.score ?? null };
  }).filter((x) => x.buildYear != null);
  const prodPairs = complexEntries.filter((x) => x.prodScore != null);
  const shadowPairs = complexEntries.filter((x) => x.shadowScore != null);
  console.log(`  buildYear vs production complex score correlation: r=${pearson(prodPairs.map((x) => x.buildYear as number), prodPairs.map((x) => x.prodScore as number)).toFixed(3)} (n=${prodPairs.length})`);
  console.log(`  buildYear vs shadow(complexPeerEligible-filtered) complex score correlation: r=${pearson(shadowPairs.map((x) => x.buildYear as number), shadowPairs.map((x) => x.shadowScore as number)).toFixed(3)} (n=${shadowPairs.length})`);

  // ---------------- §29: life domain audit ----------------
  console.log('\n[§29] life domain cross-peer audit (POI 합계 higher-is-better):');
  const lifeEntries = rows.map((r) => {
    const loc = ds.locationByAptSeq.get(r.aptSeq);
    if (!loc) return null;
    const poiSum = [loc.martCount1000m, loc.convenienceCount500m, loc.pharmacyCount500m, loc.hospitalCount1000m, loc.parkCount1000m, loc.daycareKindergartenCount500m]
      .filter((v): v is number => v != null).reduce((a, b) => a + b, 0);
    const score = getCategory(r.shadow, 'living')?.score ?? null;
    return score != null ? { aptSeq: r.aptSeq, raw: poiSum, score } : null;
  }).filter((x): x is { aptSeq: string; raw: number; score: number } => x != null);
  const lifeInversions = countCrossInversions(lifeEntries, 'higherIsBetter', [5, 10]);
  lifeInversions.forEach((r) => console.log(`  POI합계 gap >= ${r.threshold}: inversion ${r.count}건 / ${r.totalPairsChecked}쌍`));

  // ---------------- save artifact ----------------
  const outDir = path.resolve(__dirname, 'output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.resolve(outDir, 'step08-shadow-score-comparison.csv'),
    'aptSeq,name,sggCd,umdName,prodTotal,shadowTotal,prodTransport,shadowTransport\n' +
    rows.map((r) => `${r.aptSeq},"${r.name}",${r.sggCd},${r.umdName},${r.prod.score ?? ''},${r.shadow.score ?? ''},${getCategory(r.prod, 'transport')?.score?.toFixed(2) ?? ''},${getCategory(r.shadow, 'transport')?.score?.toFixed(2) ?? ''}`).join('\n')
  );
  fs.writeFileSync(path.resolve(outDir, 'step08-inversion-cases.json'), JSON.stringify({ transportInversions, schoolInversions, parkingInversions, lifeInversions, dominanceSampleCount: dominanceCases.length }, null, 1));
  fs.writeFileSync(path.resolve(outDir, 'step08-summary.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    verifyMismatches: mismatches, verifyTotal: verifyTargets.length,
    transportDelta: { n: tDeltaVals.length, mean: mean(tDeltaVals), median: median(tDeltaVals), p10: pct(tDeltaVals, 10), p90: pct(tDeltaVals, 90), ge20: tAbs.filter((d) => d >= 20).length, ge10: tAbs.filter((d) => d >= 10).length, ge5: tAbs.filter((d) => d >= 5).length, lt5: tAbs.filter((d) => d < 5).length },
    totalDelta: { n: totDeltaVals.length, mean: mean(totDeltaVals), median: median(totDeltaVals), eq0: totAbs.filter((d) => d === 0).length, b1to4: totAbs.filter((d) => d >= 1 && d <= 4).length, b5to9: totAbs.filter((d) => d >= 5 && d <= 9).length, ge10: totAbs.filter((d) => d >= 10).length, prodOkCount, shadowOkCount },
    rankShift: { mean: mean(rankShifts), median: median(rankShifts), p90: pct(rankShifts, 90), max: Math.max(...rankShifts) },
    benchmarkDetails, benchmarkRows,
    gdkhShadow: gdkh ? { prod: gdkh.prod, shadow: gdkh.shadow, quality: gdkhQ } : null,
    domainR1R2: { r1Spread, r2Spread, r1Coverage: scoredTransport.length, r2Coverage: r2Rows.filter((r) => r.score != null).length },
    parkingEligibleCount, parkingSampleBuckets,
    complexCorrelation: { production: pearson(prodPairs.map((x) => x.buildYear as number), prodPairs.map((x) => x.prodScore as number)), shadow: pearson(shadowPairs.map((x) => x.buildYear as number), shadowPairs.map((x) => x.shadowScore as number)) },
  }, null, 1));
  console.log('\n[saved] step08-shadow-score-comparison.csv / step08-inversion-cases.json / step08-summary.json');

  const { prisma } = await import('@/lib/prisma');
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
