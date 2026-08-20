/**
 * [BUSAN SCORE DATA V1 §7~§9] 부산 나머지 13개 구·군(중구는 이미 완료)의
 * ApartmentLocationFeature를 사용자 지정 순서로 구·군씩 순차 수집한다.
 *
 * 새 로직을 만들지 않는다 — collect-location-features.ts와 동일한
 * collectLocationFeature()/freshness-skip/upsert를 그대로 재사용하고, 여기서는
 * "여러 구를 순서대로 돈다"는 오케스트레이션만 추가한다. 구 하나가 끝날 때마다
 * 진행 상황을 로그로 남겨 중간에 중단돼도 그냥 재실행하면 이미 끝난 구/단지는
 * freshness-skip으로 자동 건너뛴다(§19 resume — 새 상태 파일 없이 기존 DB
 * validUntil 자체가 진행 상태다).
 *
 * 429가 한 구 안에서 연속 5회 이상 발생하면 그 구를 마치고 전체를 중단한다
 * (§20 "공격적 retry 금지, backoff 또는 STOP" — 무시하고 계속 밀어붙이지 않음).
 *
 * 사용법:
 *   npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js scripts/apartment-score/expand-busan-location-features.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { prisma } from '@/lib/prisma';
import { collectLocationFeature, type LocationFeatureTarget } from '@/lib/apartment-score/collectors/location';

const FRESHNESS_DAYS = 30;

// 사용자 지정 운영 순서(§8) — 품질/weight 우선순위 아님, 단순 실행 순서.
// 서구(26140)/해운대(26350)는 이미 완료라 제외, 중구(26110)는 검증 배치로 이미 완료.
const DISTRICT_ORDER: { label: string; sggCd: string }[] = [
  { label: '부산진구', sggCd: '26230' },
  { label: '동래구', sggCd: '26260' },
  { label: '연제구', sggCd: '26470' },
  { label: '남구', sggCd: '26290' },
  { label: '수영구', sggCd: '26500' },
  { label: '사하구', sggCd: '26380' },
  { label: '동구', sggCd: '26170' },
  { label: '영도구', sggCd: '26200' },
  { label: '북구', sggCd: '26320' },
  { label: '사상구', sggCd: '26530' },
  { label: '금정구', sggCd: '26410' },
  { label: '강서구', sggCd: '26440' },
  { label: '기장군', sggCd: '26710' },
];

async function resolveDistrictTargets(sggCd: string): Promise<LocationFeatureTarget[]> {
  const masters = await prisma.apartmentMaster.findMany({
    where: { sggCd, latitude: { not: null }, longitude: { not: null }, aptSeq: { not: null } },
    select: { aptSeq: true, latitude: true, longitude: true },
  });
  return masters.map((m) => ({ aptSeq: m.aptSeq as string, latitude: m.latitude as number, longitude: m.longitude as number }));
}

async function main() {
  const overallStart = Date.now();
  const overallSummary: Record<string, { total: number; collected: number; skippedFresh: number; success: number; partial: number; failed: number; consecutiveRateLimit: number }> = {};

  for (const district of DISTRICT_ORDER) {
    const districtStart = Date.now();
    const allTargets = await resolveDistrictTargets(district.sggCd);

    const now = new Date();
    const existing = await prisma.apartmentLocationFeature.findMany({
      where: { aptSeq: { in: allTargets.map((t) => t.aptSeq) }, validUntil: { gt: now } },
      select: { aptSeq: true },
    });
    const freshSet = new Set(existing.map((e) => e.aptSeq));
    const targets = allTargets.filter((t) => !freshSet.has(t.aptSeq));

    console.log(`\n=== [${district.label}] sggCd=${district.sggCd} — 대상 ${allTargets.length}건, fresh skip ${allTargets.length - targets.length}건, 이번 수집 ${targets.length}건 ===`);

    let success = 0;
    let partial = 0;
    let failed = 0;
    let consecutiveRateLimit = 0;
    let stopped = false;

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

        if (feature.qualityFlag === 'complete') success++;
        else partial++;

        const hadRateLimit = feature.failures.some((f) => f.errorCategory === 'rate_limited');
        consecutiveRateLimit = hadRateLimit ? consecutiveRateLimit + 1 : 0;
        if (consecutiveRateLimit >= 5) {
          console.error(`[STOP] ${district.label}: 연속 5회 rate_limited — 이 구를 중단하고 전체 실행을 멈춘다(공격적 재시도 금지, §20).`);
          stopped = true;
          break;
        }
      } catch (e: any) {
        failed++;
        console.error(`[FAIL] ${target.aptSeq}: ${e.message}`);
      }
    }

    const districtSec = ((Date.now() - districtStart) / 1000).toFixed(0);
    console.log(`[${district.label}] 완료(${districtSec}s): success=${success} partial=${partial} failed=${failed}`);
    overallSummary[district.label] = {
      total: allTargets.length,
      collected: targets.length,
      skippedFresh: allTargets.length - targets.length,
      success,
      partial,
      failed,
      consecutiveRateLimit,
    };

    if (stopped) {
      console.error('\n전체 실행 중단(rate limit). 재실행하면 이미 끝난 단지는 freshness-skip으로 건너뛰고 이어서 진행된다.');
      break;
    }
  }

  const totalSec = ((Date.now() - overallStart) / 1000).toFixed(0);
  console.log(`\n=== 전체 요약(${totalSec}s) ===`);
  console.log(JSON.stringify(overallSummary, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
