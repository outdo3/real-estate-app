/**
 * STEP SCORE S2B — ApartmentLocationFeature 실제 수집(Kakao + TAGO).
 * [BUSAN SCORE DATA V1 §7~§8] 서구/해운대 전용이던 mode에 임의 sggCd를 받는
 * 일반 모드를 추가해 부산 16개 구·군 전체로 확장한다 — 수집 로직/idempotency
 * (upsert)/resumability(freshness skip) 자체는 그대로 재사용, 새로 만들지 않는다.
 *
 * 대상: --mode=canary(서구 5 + 해운대 5) | seogu | haeundae | --sggCd=<코드>(임의 구·군)
 * 옵션:
 *   --dry-run  대상/예상 API 호출량만 출력하고 실제 호출/DB 쓰기 없음
 *   --force    fresh cache(validUntil > now)가 있어도 재수집
 *
 * 사용법:
 *   npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js scripts/apartment-score/collect-location-features.ts --sggCd=26230 --dry-run
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { prisma } from '@/lib/prisma';
import { collectLocationFeature, type LocationFeatureTarget } from '@/lib/apartment-score/collectors/location';

const FRESHNESS_DAYS = 30;
const KAKAO_CALLS_PER_APT = 9; // subway/mart/convenience/pharmacy/hospital/daycare/school/park/beach
const TAGO_CALLS_PER_APT = 1;

// canary — 서구 5 + 해운대 5, buildYear/입지 다양성 확보(§1 요구). 사전에 read-only
// 쿼리로 선정(구축/신축, 원도심/해안 dong 혼합) — 임의 지오코딩 없이 ApartmentMaster
// 실좌표 그대로 사용.
const CANARY_APT_SEQS = [
  '26140-15', // 문화, 동대신동3가, 1971 — 구축
  '26140-128', // 충무제1, 충무동2가, 1975 — 구축, 원도심
  '26140-51', // 협성르네상스, 서대신동3가, 2001 — 중축, 서대신역 인근
  '26140-1356', // 대신해모로센트럴아파트, 서대신동2가, 2022 — 신축
  '26140-1361', // e편한세상송도더퍼스트비치, 암남동, 2024 — 신축, 송도해수욕장 인근
  '26350-69', // 대림비치, 중동, 1977 — 구축, 해운대해수욕장 인근
  '26350-156', // 보훈, 반여동, 1979 — 구축, 내륙
  '26350-113', // 대림3, 좌동, 1997 — 중축, 마린시티 인근
  '26350-2408', // 쌍용더플래티넘해운대, 중동, 2022 — 신축, 해변 인근
  '26350-3370', // 드파인센텀, 반여동, 2024 — 신축, 내륙
];

async function resolveTargets(mode: string, sggCdArg: string | null): Promise<LocationFeatureTarget[]> {
  if (mode === 'canary') {
    const masters = await prisma.apartmentMaster.findMany({
      where: { aptSeq: { in: CANARY_APT_SEQS } },
      select: { aptSeq: true, latitude: true, longitude: true },
    });
    return masters
      .filter((m) => m.aptSeq && m.latitude != null && m.longitude != null)
      .map((m) => ({ aptSeq: m.aptSeq as string, latitude: m.latitude as number, longitude: m.longitude as number }));
  }

  // [BUSAN SCORE DATA V1 §7] --sggCd가 있으면 seogu/haeundae 외 임의 구·군도
  // 그대로 받는다 — coordinate가 있는 단지만 대상으로 하고(§11 "좌표 없는 단지는
  // 분리"), 좌표 없는 단지는 이 함수가 자연히 걸러 missing으로 남긴다(0/기본값
  // 대체 없음).
  const sggCd = sggCdArg ?? (mode === 'seogu' ? '26140' : mode === 'haeundae' ? '26350' : null);
  if (!sggCd) throw new Error(`unknown mode: ${mode} (또는 --sggCd=<코드> 지정 필요)`);

  const masters = await prisma.apartmentMaster.findMany({
    where: { sggCd, latitude: { not: null }, longitude: { not: null }, aptSeq: { not: null } },
    select: { aptSeq: true, latitude: true, longitude: true },
  });
  return masters.map((m) => ({ aptSeq: m.aptSeq as string, latitude: m.latitude as number, longitude: m.longitude as number }));
}

async function main() {
  const args = process.argv.slice(2);
  const sggCdArg = args.find((a) => a.startsWith('--sggCd='))?.split('=')[1] ?? null;
  const mode = (args.find((a) => a.startsWith('--mode='))?.split('=')[1]) ?? (sggCdArg ? 'sggCd' : 'canary');
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');

  const allTargets = await resolveTargets(mode, sggCdArg);

  // checkpoint — fresh(validUntil > now) 캐시가 있는 aptSeq는 --force 없으면 skip
  const now = new Date();
  let targets = allTargets;
  let skippedFresh = 0;
  if (!force) {
    const existing = await prisma.apartmentLocationFeature.findMany({
      where: { aptSeq: { in: allTargets.map((t) => t.aptSeq) }, validUntil: { gt: now } },
      select: { aptSeq: true },
    });
    const freshSet = new Set(existing.map((e) => e.aptSeq));
    targets = allTargets.filter((t) => !freshSet.has(t.aptSeq));
    skippedFresh = allTargets.length - targets.length;
  }

  console.log(`=== S2B Location Feature Collection — mode=${mode} ===`);
  console.log(`target apartments (region eligible): ${allTargets.length}`);
  console.log(`skipped (fresh cache, --force not set): ${skippedFresh}`);
  console.log(`to collect this run: ${targets.length}`);
  console.log(`estimated Kakao calls: ${targets.length * KAKAO_CALLS_PER_APT}`);
  console.log(`estimated TAGO calls: ${targets.length * TAGO_CALLS_PER_APT}`);

  if (dryRun) {
    console.log('--dry-run: no API calls, no DB writes.');
    return;
  }

  if (targets.length === 0) {
    console.log('No targets to collect (all fresh or empty set).');
    return;
  }

  const summary = {
    success: 0,
    partial: 0,
    failed: 0,
    failuresByCategory: {} as Record<string, number>,
    rateLimited: 0,
  };
  const samples: any[] = [];

  for (const target of targets) {
    try {
      const feature = await collectLocationFeature(target);
      const fetchedAt = new Date();
      const validUntil = new Date(fetchedAt.getTime() + FRESHNESS_DAYS * 24 * 60 * 60 * 1000);

      await prisma.apartmentLocationFeature.upsert({
        where: { aptSeq: feature.aptSeq },
        create: {
          aptSeq: feature.aptSeq,
          latitude: feature.latitude,
          longitude: feature.longitude,
          nearestSubwayDistanceM: feature.nearestSubwayDistanceM,
          nearestSubwayName: feature.nearestSubwayName,
          subwayCount1000m: feature.subwayCount1000m,
          nearestBusStopDistanceM: feature.nearestBusStopDistanceM,
          busStopCount300m: feature.busStopCount300m,
          martCount1000m: feature.martCount1000m,
          convenienceCount500m: feature.convenienceCount500m,
          pharmacyCount500m: feature.pharmacyCount500m,
          hospitalCount1000m: feature.hospitalCount1000m,
          parkCount1000m: feature.parkCount1000m,
          daycareKindergartenCount500m: feature.daycareKindergartenCount500m,
          nearestElementaryDistanceM: feature.nearestElementaryDistanceM,
          elementaryCount1000m: feature.elementaryCount1000m,
          beachDistanceM: feature.beachDistanceM,
          source: 'kakao_local_api',
          fetchedAt,
          validUntil,
          qualityFlag: feature.qualityFlag,
        },
        update: {
          latitude: feature.latitude,
          longitude: feature.longitude,
          nearestSubwayDistanceM: feature.nearestSubwayDistanceM,
          nearestSubwayName: feature.nearestSubwayName,
          subwayCount1000m: feature.subwayCount1000m,
          nearestBusStopDistanceM: feature.nearestBusStopDistanceM,
          busStopCount300m: feature.busStopCount300m,
          martCount1000m: feature.martCount1000m,
          convenienceCount500m: feature.convenienceCount500m,
          pharmacyCount500m: feature.pharmacyCount500m,
          hospitalCount1000m: feature.hospitalCount1000m,
          parkCount1000m: feature.parkCount1000m,
          daycareKindergartenCount500m: feature.daycareKindergartenCount500m,
          nearestElementaryDistanceM: feature.nearestElementaryDistanceM,
          elementaryCount1000m: feature.elementaryCount1000m,
          beachDistanceM: feature.beachDistanceM,
          fetchedAt,
          validUntil,
          qualityFlag: feature.qualityFlag,
        },
      });

      if (feature.qualityFlag === 'complete') summary.success++;
      else summary.partial++;
      for (const f of feature.failures) {
        summary.failuresByCategory[f.feature] = (summary.failuresByCategory[f.feature] ?? 0) + 1;
        if (f.errorCategory === 'rate_limited') summary.rateLimited++;
      }
      samples.push(feature);
      console.log(`[OK] ${feature.aptSeq} quality=${feature.qualityFlag} failures=${feature.failures.map((f) => f.feature).join(',') || 'none'}`);
    } catch (e: any) {
      summary.failed++;
      console.error(`[FAIL] ${target.aptSeq}: ${e.message}`);
    }
  }

  console.log('\n=== Summary ===');
  console.log(JSON.stringify(summary, null, 2));
  console.log('\n=== Samples ===');
  for (const s of samples) {
    console.log(JSON.stringify({
      aptSeq: s.aptSeq,
      nearestSubwayDistanceM: s.nearestSubwayDistanceM,
      nearestSubwayName: s.nearestSubwayName,
      subwayCount1000m: s.subwayCount1000m,
      nearestBusStopDistanceM: s.nearestBusStopDistanceM,
      busStopCount300m: s.busStopCount300m,
      martCount1000m: s.martCount1000m,
      convenienceCount500m: s.convenienceCount500m,
      pharmacyCount500m: s.pharmacyCount500m,
      hospitalCount1000m: s.hospitalCount1000m,
      parkCount1000m: s.parkCount1000m,
      daycareKindergartenCount500m: s.daycareKindergartenCount500m,
      nearestElementaryDistanceM: s.nearestElementaryDistanceM,
      elementaryCount1000m: s.elementaryCount1000m,
      beachDistanceM: s.beachDistanceM,
      qualityFlag: s.qualityFlag,
    }));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
