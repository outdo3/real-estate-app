// E-JIP SCORE V2 STEP 0 §9 — 3개 벤치마크 단지 full trace. READ-ONLY.
// calculateApartmentScore()를 그대로 호출(수정 없음) + raw feature/peer pool을
// 별도로 재조회해 왜 그 점수가 나왔는지 사람이 읽을 수 있게 출력한다.
import { prisma } from '../../src/lib/prisma';
import { calculateApartmentScore } from '../../src/lib/apartment-score/server/calculate';
import { resolvePeerPoolLevels, type PeerCandidate } from '../../src/lib/apartment-score/server/peer-groups';
import { rankFeature } from '../../src/lib/apartment-score/server/percentile';
import { FEATURE_DIRECTIONS } from '../../src/lib/apartment-score/server/config';

const TARGETS: Record<string, string> = {
  '대신해모로센트럴아파트': '26140-1356',
  '협성르네상스(서구)': '26140-51',
  '구덕금호': '26140-11',
};

async function main() {
  for (const [label, aptSeq] of Object.entries(TARGETS)) {
    console.log(`\n${'#'.repeat(78)}\n### ${label} (${aptSeq})\n${'#'.repeat(78)}`);

    const master = await prisma.apartmentMaster.findUnique({ where: { aptSeq }, select: {
      aptSeq: true, name: true, sido: true, sigungu: true, umdName: true, buildYear: true,
      totalHouseholds: true, parkingCount: true, mainBuildingCount: true, latitude: true, longitude: true,
    }});
    const loc = await prisma.apartmentLocationFeature.findUnique({ where: { aptSeq } });

    console.log('\n[RAW MASTER]', JSON.stringify(master, null, 1));
    console.log('\n[RAW LOCATION FEATURE]', JSON.stringify(loc, null, 1));
    if (master?.totalHouseholds && master?.parkingCount) {
      console.log(`\n[DERIVED] parkingPerHousehold = ${master.parkingCount}/${master.totalHouseholds} = ${(master.parkingCount / master.totalHouseholds).toFixed(3)}`);
    }

    // ---- peer pool 재구성(calculate.ts와 동일 입력) ----
    const cohort = await prisma.apartmentMaster.findMany({
      where: { sggCd: master?.sigungu ? undefined : undefined, aptSeq: { not: null } },
      select: { aptSeq: true, sggCd: true, umdName: true, buildYear: true },
    });
    // sggCd로 다시 필터(master.sggCd 직접 select 안 했으므로 재조회)
    const masterFull = await prisma.apartmentMaster.findUnique({ where: { aptSeq }, select: { sggCd: true } });
    const sameSggCd: PeerCandidate[] = cohort
      .filter((c): c is typeof c & { aptSeq: string } => c.aptSeq != null && c.sggCd === masterFull?.sggCd)
      .map((c) => ({ aptSeq: c.aptSeq, sggCd: c.sggCd, umdName: c.umdName, buildYear: c.buildYear }));

    const targetCandidate: PeerCandidate = {
      aptSeq,
      sggCd: masterFull?.sggCd ?? null,
      umdName: master?.umdName ?? null,
      buildYear: master?.buildYear ?? null,
    };

    const nonParkingLevels = resolvePeerPoolLevels(targetCandidate, sameSggCd, false);
    const parkingLevels = resolvePeerPoolLevels(targetCandidate, sameSggCd, true);

    console.log('\n[PEER POOL — non-parking(transport/living/complex/school), LOCAL=same umdName]');
    for (const lv of nonParkingLevels) console.log(`  ${lv.level}: tier=${lv.tier} size=${lv.aptSeqs.length}`);
    console.log('[PEER POOL — parking, LOCAL=same sggCd + buildYear decade band]');
    for (const lv of parkingLevels) console.log(`  ${lv.level}: tier=${lv.tier} size=${lv.aptSeqs.length}`);

    // ---- parking raw percentile 수동 재현(실제 채택된 첫 non-NOT_SCORED 레벨 사용) ----
    const parkingLevel = parkingLevels.find((l) => l.tier !== 'NOT_SCORED') ?? parkingLevels[parkingLevels.length - 1];
    const parkingPeerMasters = await prisma.apartmentMaster.findMany({
      where: { aptSeq: { in: parkingLevel.aptSeqs } },
      select: { aptSeq: true, parkingCount: true, totalHouseholds: true, buildYear: true },
    });
    const parkingRows = parkingPeerMasters.map((m) => ({
      aptSeq: m.aptSeq!,
      value: m.parkingCount != null && m.totalHouseholds != null && m.totalHouseholds > 0 ? m.parkingCount / m.totalHouseholds : null,
      isComplete: false,
    }));
    const parkingRanked = rankFeature(parkingRows, 'parkingPerHousehold', FEATURE_DIRECTIONS.parkingPerHousehold, false);
    const targetParkingRank = parkingRanked.get(aptSeq);
    const validRatios = parkingRows.filter((r) => r.value != null).map((r) => r.value as number).sort((a, b) => a - b);
    console.log(`\n[PARKING PEER DETAIL] level=${parkingLevel.level} n(valid ratio)=${validRatios.length}/${parkingLevel.aptSeqs.length}`);
    console.log('  peer ratio distribution(sorted):', validRatios.map((v) => v.toFixed(2)).join(', '));
    console.log('  target percentile:', JSON.stringify(targetParkingRank));

    // ---- transport raw percentile 수동 재현 ----
    const transportLevel = nonParkingLevels.find((l) => l.tier !== 'NOT_SCORED') ?? nonParkingLevels[nonParkingLevels.length - 1];
    const transportPeerLoc = await prisma.apartmentLocationFeature.findMany({ where: { aptSeq: { in: transportLevel.aptSeqs } } });
    for (const key of ['nearestSubwayDistanceM', 'subwayCount1000m', 'nearestBusStopDistanceM', 'busStopCount300m'] as const) {
      const rows = transportLevel.aptSeqs.map((s) => {
        const l = transportPeerLoc.find((x) => x.aptSeq === s);
        return { aptSeq: s, value: l ? (l[key] as number | null) : null, isComplete: l ? l.qualityFlag === 'complete' : false };
      });
      const ranked = rankFeature(rows, key, FEATURE_DIRECTIONS[key], key.includes('Distance'));
      const t = ranked.get(aptSeq);
      const valid = rows.filter((r) => r.value != null).map((r) => r.value as number).sort((a, b) => a - b);
      console.log(`\n[TRANSPORT SUBMETRIC] ${key} level=${transportLevel.level} n=${valid.length}/${transportLevel.aptSeqs.length}`);
      console.log('  target raw value:', rows.find((r) => r.aptSeq === aptSeq)?.value, '| percentile:', JSON.stringify(t));
      console.log('  peer distribution(sorted, first/last 5):', valid.slice(0, 5), '...', valid.slice(-5));
    }

    // ---- 공식 엔진 결과 ----
    const result = await calculateApartmentScore(aptSeq);
    console.log('\n[OFFICIAL calculateApartmentScore() RESULT]');
    console.log('status:', result.status, '| score:', result.score, '| coverage:', result.coverage, '| confidence:', result.confidence);
    for (const c of result.categories as any[]) {
      console.log(`  ${c.key}: status=${c.status} score=${c.score?.toFixed(2)} baseWeight=${c.baseWeight} peerLevel=${c.peerLevel} peerTier=${c.peerTier} peerSampleSize=${c.peerSampleSize} used=[${(c.usedSubMetrics ?? []).join(',')}] missing=[${(c.missingSubMetrics ?? []).join(',')}]`);
    }
  }

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
