/**
 * E-JIP SCORE V2 STEP 2 §4-5,8,12,14,16,19,22,26,29-30 — 부산 전체(3,402) raw
 * fact 분포 실측. READ-ONLY, DB write 없음. curve 설계(§6 등)는 이 분포를
 * 근거로만 한다 — 추정/가정 금지.
 *
 * 사용법:
 *   npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js scripts/score-v2-step2/step2-01-data-distributions.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

function pctl(sortedAsc: number[], p: number): number {
  if (!sortedAsc.length) return NaN;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.round((p / 100) * (sortedAsc.length - 1))));
  return sortedAsc[idx];
}

function distStats(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  return {
    count: s.length,
    min: s[0], p1: pctl(s, 1), p5: pctl(s, 5), p10: pctl(s, 10), p25: pctl(s, 25),
    median: pctl(s, 50), p75: pctl(s, 75), p90: pctl(s, 90), p95: pctl(s, 95), p99: pctl(s, 99), max: s[s.length - 1],
  };
}

function buckets(values: number[], edges: { label: string; test: (v: number) => boolean }[]) {
  return edges.map((e) => ({ label: e.label, count: values.filter(e.test).length, pct: values.length ? (100 * values.filter(e.test).length / values.length) : 0 }));
}

async function main() {
  const { prisma } = await import('@/lib/prisma');
  const { classify } = await import('../apartment-score/lib/peer-quality');

  const masters = await prisma.apartmentMaster.findMany({
    where: { aptSeq: { not: null } },
    select: {
      aptSeq: true, sggCd: true, sigungu: true, umdName: true, buildYear: true, totalHouseholds: true,
      parkingCount: true, mainBuildingCount: true, roadAddress: true, jibunAddress: true, mgmBldrgstPk: true,
      geocodeQuality: true, latitude: true, longitude: true,
    },
  });
  const locs = await prisma.apartmentLocationFeature.findMany();
  const locByAptSeq = new Map(locs.map((l) => [l.aptSeq, l]));
  const tx = await prisma.apartmentMarketFeature.findMany({ select: { aptSeq: true, transactionCount12m: true } });
  const txMap = new Map(tx.map((t) => [t.aptSeq, t.transactionCount12m ?? 0]));

  const quality = masters.map((m) => classify({
    aptSeq: m.aptSeq!, roadAddress: m.roadAddress, jibunAddress: m.jibunAddress, mgmBldrgstPk: m.mgmBldrgstPk,
    totalHouseholds: m.totalHouseholds, parkingCount: m.parkingCount, mainBuildingCount: m.mainBuildingCount,
    buildYear: m.buildYear, geocodeQuality: m.geocodeQuality, latitude: m.latitude, longitude: m.longitude,
    transactionCount12m: txMap.get(m.aptSeq!) ?? 0,
  }));
  const qualityByAptSeq = new Map(quality.map((q) => [q.aptSeq, q]));

  console.log(`[§4] ApartmentMaster total = ${masters.length}`);
  const eligCounts = {
    transportPeerEligible: quality.filter((q) => q.transportPeerEligible).length,
    parkingPeerEligible: quality.filter((q) => q.parkingPeerEligible).length,
    complexPeerEligible: quality.filter((q) => q.complexPeerEligible).length,
    PEER_FULL: quality.filter((q) => q.peerEligibility === 'PEER_FULL').length,
    DISPLAY_ONLY: quality.filter((q) => q.peerEligibility === 'DISPLAY_ONLY').length,
  };
  console.log(`  domain eligibility(quality-filtered): ${JSON.stringify(eligCounts)}`);

  // ---------------- §5 TRANSPORT — subway ----------------
  const coordOk = masters.filter((m) => qualityByAptSeq.get(m.aptSeq!)?.transportPeerEligible);
  const subwayVals = coordOk.map((m) => locByAptSeq.get(m.aptSeq!)?.nearestSubwayDistanceM).filter((v): v is number => v != null);
  const confirmedAbsentSubway = coordOk.filter((m) => { const l = locByAptSeq.get(m.aptSeq!); return l && l.qualityFlag === 'complete' && l.nearestSubwayDistanceM == null; }).length;
  console.log(`\n[§5] TRANSPORT subway(quality-filtered coordOk=${coordOk.length}): 실값=${subwayVals.length}, confirmed-absent=${confirmedAbsentSubway}, 기타 미수집=${coordOk.length - subwayVals.length - confirmedAbsentSubway}`);
  console.log(`  distribution(m): ${JSON.stringify(distStats(subwayVals))}`);
  const subwayBuckets = buckets(subwayVals, [
    { label: '0-100m', test: (v) => v <= 100 }, { label: '101-200m', test: (v) => v > 100 && v <= 200 },
    { label: '201-300m', test: (v) => v > 200 && v <= 300 }, { label: '301-500m', test: (v) => v > 300 && v <= 500 },
    { label: '501-700m', test: (v) => v > 500 && v <= 700 }, { label: '701-1000m', test: (v) => v > 700 && v <= 1000 },
    { label: '1001-1500m', test: (v) => v > 1000 && v <= 1500 }, { label: '1501-2000m', test: (v) => v > 1500 && v <= 2000 },
    { label: '>2000m', test: (v) => v > 2000 },
  ]);
  console.log(`  buckets: ${JSON.stringify(subwayBuckets)}`);
  const subwayCountVals = coordOk.map((m) => locByAptSeq.get(m.aptSeq!)?.subwayCount1000m).filter((v): v is number => v != null);
  console.log(`  subwayCount1000m distribution: ${JSON.stringify(distStats(subwayCountVals))}`);

  // 구별 참고분포(Core 입력 아님, 참고용만)
  const byGu = new Map<string, number[]>();
  for (const m of coordOk) { const v = locByAptSeq.get(m.aptSeq!)?.nearestSubwayDistanceM; if (v == null) continue; const gu = m.sigungu ?? 'unknown'; if (!byGu.has(gu)) byGu.set(gu, []); byGu.get(gu)!.push(v); }
  console.log(`  구별 median 참고(Core 미사용): ${JSON.stringify([...byGu.entries()].map(([gu, vs]) => ({ gu, n: vs.length, median: pctl([...vs].sort((a,b)=>a-b), 50) })))}`);

  // ---------------- §8 TRANSPORT — bus ----------------
  const busDistVals = coordOk.map((m) => locByAptSeq.get(m.aptSeq!)?.nearestBusStopDistanceM).filter((v): v is number => v != null);
  const busCountVals = coordOk.map((m) => locByAptSeq.get(m.aptSeq!)?.busStopCount300m).filter((v): v is number => v != null);
  console.log(`\n[§8] BUS raw features(코드 확인: nearestBusStopDistanceM, busStopCount300m만 persist됨 — route count는 live TAGO 조회만 있고 미저장):`);
  console.log(`  nearestBusStopDistanceM: ${JSON.stringify(distStats(busDistVals))}`);
  console.log(`  busStopCount300m: ${JSON.stringify(distStats(busCountVals))}`);

  // ---------------- §12 COMPLEX — age ----------------
  const withBuildYear = masters.filter((m) => m.buildYear != null);
  const currentYear = 2026;
  const ageVals = withBuildYear.map((m) => currentYear - (m.buildYear as number));
  console.log(`\n[§12] COMPLEX age(buildYear 보유=${withBuildYear.length}/${masters.length}):`);
  console.log(`  age distribution(년): ${JSON.stringify(distStats(ageVals))}`);
  const ageBuckets = buckets(ageVals, [
    { label: '0-5', test: (v) => v >= 0 && v <= 5 }, { label: '6-10', test: (v) => v >= 6 && v <= 10 },
    { label: '11-15', test: (v) => v >= 11 && v <= 15 }, { label: '16-20', test: (v) => v >= 16 && v <= 20 },
    { label: '21-25', test: (v) => v >= 21 && v <= 25 }, { label: '26-30', test: (v) => v >= 26 && v <= 30 },
    { label: '31-35', test: (v) => v >= 31 && v <= 35 }, { label: '36+', test: (v) => v >= 36 },
  ]);
  console.log(`  buckets: ${JSON.stringify(ageBuckets)}`);

  // ---------------- §14 COMPLEX — households ----------------
  const withHouseholds = masters.filter((m) => m.totalHouseholds != null).map((m) => m.totalHouseholds as number);
  console.log(`\n[§14] COMPLEX households(보유=${withHouseholds.length}/${masters.length}):`);
  console.log(`  distribution: ${JSON.stringify(distStats(withHouseholds))}`);
  const hhBuckets = buckets(withHouseholds, [
    { label: '<50', test: (v) => v < 50 }, { label: '50-99', test: (v) => v >= 50 && v < 100 },
    { label: '100-199', test: (v) => v >= 100 && v < 200 }, { label: '200-299', test: (v) => v >= 200 && v < 300 },
    { label: '300-499', test: (v) => v >= 300 && v < 500 }, { label: '500-699', test: (v) => v >= 500 && v < 700 },
    { label: '700-999', test: (v) => v >= 700 && v < 1000 }, { label: '1000-1499', test: (v) => v >= 1000 && v < 1500 },
    { label: '1500-1999', test: (v) => v >= 1500 && v < 2000 }, { label: '2000+', test: (v) => v >= 2000 },
  ]);
  console.log(`  buckets: ${JSON.stringify(hhBuckets)}`);

  // ---------------- §16 COMPLEX — parking ----------------
  const parkingEligible = masters.filter((m) => qualityByAptSeq.get(m.aptSeq!)?.parkingPeerEligible);
  const ratios = parkingEligible.map((m) => (m.parkingCount as number) / (m.totalHouseholds as number));
  console.log(`\n[§16] COMPLEX parking(parkingPeerEligible=${parkingEligible.length}/${masters.length} = ${(100 * parkingEligible.length / masters.length).toFixed(1)}%, STEP1.5/STEP0.8 25.3%와 비교):`);
  console.log(`  ratio distribution: ${JSON.stringify(distStats(ratios))}`);
  const ratioBuckets = buckets(ratios, [
    { label: '<0.5', test: (v) => v < 0.5 }, { label: '0.5-0.69', test: (v) => v >= 0.5 && v < 0.7 },
    { label: '0.7-0.89', test: (v) => v >= 0.7 && v < 0.9 }, { label: '0.9-0.99', test: (v) => v >= 0.9 && v < 1.0 },
    { label: '1.0-1.09', test: (v) => v >= 1.0 && v < 1.1 }, { label: '1.1-1.19', test: (v) => v >= 1.1 && v < 1.2 },
    { label: '1.2-1.39', test: (v) => v >= 1.2 && v < 1.4 }, { label: '1.4-1.59', test: (v) => v >= 1.4 && v < 1.6 },
    { label: '1.6-1.99', test: (v) => v >= 1.6 && v < 2.0 }, { label: '2.0+', test: (v) => v >= 2.0 },
  ]);
  console.log(`  buckets: ${JSON.stringify(ratioBuckets)}`);

  // ---------------- §19 FAR/BCR recheck ----------------
  const apartmentLegacy = await prisma.apartment.findMany({ select: { far: true, bcr: true } });
  const farCount = apartmentLegacy.filter((a) => a.far != null).length;
  console.log(`\n[§19] FAR/BCR recheck: ApartmentMaster(${masters.length}건)에는 컬럼 자체 없음(0%). legacy Apartment 테이블 = ${apartmentLegacy.length}건 중 far non-null ${farCount}건 — STEP1과 동일하게 제외 확정.`);

  // ---------------- §22/§26 EDUCATION — elementary(Kakao POI) + kindergarten(DB, real coords) ----------------
  const elemVals = coordOk.map((m) => locByAptSeq.get(m.aptSeq!)?.nearestElementaryDistanceM).filter((v): v is number => v != null);
  console.log(`\n[§22] EDUCATION elementary distance(Kakao POI, coordOk=${coordOk.length} 중 실값=${elemVals.length}):`);
  console.log(`  distribution: ${JSON.stringify(distStats(elemVals))}`);
  const elemBuckets = buckets(elemVals, [
    { label: '<=200m', test: (v) => v <= 200 }, { label: '201-300m', test: (v) => v > 200 && v <= 300 },
    { label: '301-500m', test: (v) => v > 300 && v <= 500 }, { label: '501-700m', test: (v) => v > 500 && v <= 700 },
    { label: '701-1000m', test: (v) => v > 700 && v <= 1000 }, { label: '1001-1500m', test: (v) => v > 1000 && v <= 1500 },
    { label: '>1500m', test: (v) => v > 1500 },
  ]);
  console.log(`  buckets: ${JSON.stringify(elemBuckets)}`);

  // 공식 통학구역 artifact: 거리 필드 자체가 없음(School.lat/lng 0% coverage) — 사실 확인
  const schoolCoordCount = await prisma.school.count({ where: { latitude: { not: null }, longitude: { not: null } } });
  console.log(`  [중요] School.latitude/longitude 보유 = ${schoolCoordCount}건 — "공식 통학구역 학교까지 거리"는 계산 불가(좌표 0%), 통학구역은 categorical(배정 여부/school identity)로만 사용 가능`);

  const kindergartens = await prisma.kindergarten.findMany({ where: { latitude: { not: null }, longitude: { not: null } }, select: { latitude: true, longitude: true } });
  console.log(`\n[§26] EDUCATION kindergarten(DB 실좌표 ${kindergartens.length}건, coverage 100%로 실거리 계산 가능):`);
  const kgNearest: number[] = [];
  for (const m of coordOk) {
    if (m.latitude == null || m.longitude == null) continue;
    let best = Infinity;
    for (const k of kindergartens) {
      const dLat = (k.latitude! - m.latitude) * 111000;
      const dLng = (k.longitude! - m.longitude) * 88000;
      const d = Math.sqrt(dLat * dLat + dLng * dLng);
      if (d < best) best = d;
    }
    if (best < Infinity) kgNearest.push(Math.round(best));
  }
  console.log(`  근사 최근접 유치원 거리(하버사인 대신 평면근사, n=${kgNearest.length}): ${JSON.stringify(distStats(kgNearest))}`);
  const within500 = kgNearest.filter((d) => d <= 500).length;
  const within1000 = kgNearest.filter((d) => d <= 1000).length;
  console.log(`  within 500m = ${within500}(${(100 * within500 / kgNearest.length).toFixed(1)}%), within 1000m = ${within1000}(${(100 * within1000 / kgNearest.length).toFixed(1)}%)`);

  // ---------------- §29-30 LIVING raw categories ----------------
  const livingCats: { key: keyof NonNullable<ReturnType<typeof locByAptSeq.get>>; label: string; radius: string }[] = [
    { key: 'martCount1000m', label: '마트', radius: '1000m' },
    { key: 'convenienceCount500m', label: '편의점', radius: '500m' },
    { key: 'pharmacyCount500m', label: '약국', radius: '500m' },
    { key: 'hospitalCount1000m', label: '병원', radius: '1000m' },
    { key: 'parkCount1000m', label: '공원', radius: '1000m' },
    { key: 'daycareKindergartenCount500m', label: '어린이집/유치원(Kakao)', radius: '500m' },
  ];
  console.log(`\n[§29-30] LIVING raw categories(실제 코드 기준 — V1 config.ts LIVING_SUBWEIGHTS와 동일 6개, 코드에 이 이상 세분화 없음: medical/shopping/culture 별도 컬럼 없음):`);
  for (const cat of livingCats) {
    const vals = coordOk.map((m) => locByAptSeq.get(m.aptSeq!)?.[cat.key] as number | null).filter((v): v is number => v != null);
    console.log(`  ${cat.label}(반경 ${cat.radius}): n=${vals.length} ${JSON.stringify(distStats(vals))}`);
  }

  // beach(environment display-only reference)
  const beachVals = coordOk.map((m) => locByAptSeq.get(m.aptSeq!)?.beachDistanceM).filter((v): v is number => v != null);
  console.log(`\n[참고] beachDistanceM(Environment, LIMITED/DISPLAY_ONLY): n=${beachVals.length} ${JSON.stringify(distStats(beachVals))}`);

  const outDir = path.resolve(__dirname, '../../data/score-v2-step2');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.resolve(outDir, 'factor-distributions.json'), JSON.stringify({
    generatedAt: new Date().toISOString(), totalApartments: masters.length, eligCounts,
    subway: { stats: distStats(subwayVals), buckets: subwayBuckets, countStats: distStats(subwayCountVals) },
    bus: { distStats: distStats(busDistVals), countStats: distStats(busCountVals) },
    age: { stats: distStats(ageVals), buckets: ageBuckets },
    households: { stats: distStats(withHouseholds), buckets: hhBuckets },
    parking: { eligibleCount: parkingEligible.length, coveragePct: 100 * parkingEligible.length / masters.length, stats: distStats(ratios), buckets: ratioBuckets },
    farBcr: { apartmentMasterCoverage: 0, legacyTableCount: apartmentLegacy.length, legacyFarNonNull: farCount },
    elementary: { stats: distStats(elemVals), buckets: elemBuckets, schoolCoordCount },
    kindergarten: { stats: distStats(kgNearest), within500, within1000, totalWithCoords: kindergartens.length },
    living: Object.fromEntries(livingCats.map((cat) => [cat.key, distStats(coordOk.map((m) => locByAptSeq.get(m.aptSeq!)?.[cat.key] as number | null).filter((v): v is number => v != null))])),
    beach: { stats: distStats(beachVals) },
  }, null, 1));
  console.log('\n[saved] data/score-v2-step2/factor-distributions.json');

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
