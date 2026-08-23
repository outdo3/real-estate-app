// E-JIP SCORE V2 STEP 0.5 §1-4,6-9 — transport raw data truth audit. READ-ONLY.
import { prisma } from '../../src/lib/prisma';
import { resolvePeerPoolLevels, type PeerCandidate } from '../../src/lib/apartment-score/server/peer-groups';
import { rankFeature } from '../../src/lib/apartment-score/server/percentile';
import { FEATURE_DIRECTIONS } from '../../src/lib/apartment-score/server/config';
import { calculateApartmentScore } from '../../src/lib/apartment-score/server/calculate';

const TARGETS: Record<string, string> = {
  '대신해모로센트럴아파트': '26140-1356',
  '협성르네상스(서구)': '26140-51',
};

async function identity(aptSeq: string) {
  const m = await prisma.apartmentMaster.findUnique({
    where: { aptSeq },
    select: {
      aptSeq: true, name: true, normalizedName: true, sido: true, sigungu: true, sggCd: true,
      umdName: true, umdCd: true, jibun: true, roadAddress: true, jibunAddress: true,
      latitude: true, longitude: true, geocodeQuality: true, buildYear: true, totalHouseholds: true,
    },
  });
  const loc = await prisma.apartmentLocationFeature.findUnique({ where: { aptSeq } });
  return { m, loc };
}

async function main() {
  const idByLabel: Record<string, { m: any; loc: any }> = {};
  for (const [label, aptSeq] of Object.entries(TARGETS)) {
    const r = await identity(aptSeq);
    idByLabel[label] = r;
    console.log(`\n${'='.repeat(78)}\n[§1] IDENTITY — ${label} (${aptSeq})\n${'='.repeat(78)}`);
    console.log(JSON.stringify(r.m, null, 1));
    console.log('\n[§2] RAW LOCATION FEATURE(subway 관련)');
    console.log(JSON.stringify({
      nearestSubwayDistanceM: r.loc?.nearestSubwayDistanceM,
      nearestSubwayName: r.loc?.nearestSubwayName,
      subwayCount1000m: r.loc?.subwayCount1000m,
      source: r.loc?.source,
      sourceVersion: r.loc?.sourceVersion,
      fetchedAt: r.loc?.fetchedAt,
      validUntil: r.loc?.validUntil,
      qualityFlag: r.loc?.qualityFlag,
    }, null, 1));
  }

  // ---- 대신해모로 LOCAL peer(같은 동) 전체 + subway distance 오름차순 ----
  const target = idByLabel['대신해모로센트럴아파트'];
  const targetAptSeq = TARGETS['대신해모로센트럴아파트'];
  const cohort = await prisma.apartmentMaster.findMany({
    where: { sggCd: target.m.sggCd, aptSeq: { not: null } },
    select: { aptSeq: true, sggCd: true, umdName: true, buildYear: true },
  });
  const candidates: PeerCandidate[] = cohort
    .filter((c): c is typeof c & { aptSeq: string } => c.aptSeq != null)
    .map((c) => ({ aptSeq: c.aptSeq, sggCd: c.sggCd, umdName: c.umdName, buildYear: c.buildYear }));
  const targetCandidate: PeerCandidate = { aptSeq: targetAptSeq, sggCd: target.m.sggCd, umdName: target.m.umdName, buildYear: target.m.buildYear };
  const levels = resolvePeerPoolLevels(targetCandidate, candidates, false);
  const localLevel = levels[0];
  console.log(`\n${'='.repeat(78)}\n[§3/§8] 대신해모로 LOCAL peer pool (동=${target.m.umdName}) — level=${localLevel.level} tier=${localLevel.tier} size=${localLevel.aptSeqs.length}\n${'='.repeat(78)}`);

  const peerMasters = await prisma.apartmentMaster.findMany({
    where: { aptSeq: { in: localLevel.aptSeqs } },
    select: { aptSeq: true, name: true, roadAddress: true, jibunAddress: true, latitude: true, longitude: true, geocodeQuality: true, totalHouseholds: true, buildYear: true },
  });
  const peerLocs = await prisma.apartmentLocationFeature.findMany({ where: { aptSeq: { in: localLevel.aptSeqs } } });

  const rows = localLevel.aptSeqs.map((s) => {
    const m = peerMasters.find((x) => x.aptSeq === s);
    const l = peerLocs.find((x) => x.aptSeq === s);
    return { aptSeq: s, name: m?.name, address: m?.roadAddress || m?.jibunAddress, lat: m?.latitude, lng: m?.longitude, geocodeQuality: m?.geocodeQuality, buildYear: m?.buildYear, households: m?.totalHouseholds, subwayDist: l?.nearestSubwayDistanceM ?? null, stationName: l?.nearestSubwayName ?? null };
  }).sort((a, b) => (a.subwayDist ?? 99999) - (b.subwayDist ?? 99999));

  console.log('전체 peer(오름차순, subway distance):');
  for (const r of rows) {
    console.log(`  ${r.subwayDist ?? '?'}m | ${r.stationName ?? '?'} | ${r.name}(${r.aptSeq}) | geo=${r.geocodeQuality} | (${r.lat},${r.lng}) | ${r.buildYear}년 ${r.households ?? '?'}세대 | ${r.address}`);
  }

  console.log(`\n[§3] 대신해모로(140m)보다 가깝다고 판정된 peer 전부:`);
  const closer = rows.filter((r) => r.subwayDist != null && r.subwayDist < 140);
  console.log(`총 ${closer.length}건`);
  for (const r of closer) console.log('  ', JSON.stringify(r));

  // ---- 좌표 중복/이상값 sanity check ----
  console.log(`\n[§4] 좌표 sanity check(전체 LOCAL peer 대상)`);
  const coordCounts = new Map<string, string[]>();
  for (const r of rows) {
    if (r.lat == null || r.lng == null) continue;
    const key = `${r.lat.toFixed(6)},${r.lng.toFixed(6)}`;
    (coordCounts.get(key) ?? coordCounts.set(key, []).get(key)!).push(r.name ?? r.aptSeq);
  }
  const dupes = [...coordCounts.entries()].filter(([, names]) => names.length > 1);
  console.log('중복 좌표 그룹:', dupes.length, JSON.stringify(dupes));
  const nearZero = rows.filter((r) => r.subwayDist != null && r.subwayDist <= 20);
  console.log('subwayDist <= 20m(비현실적 의심):', nearZero.length, JSON.stringify(nearZero.map((r) => ({ name: r.name, subwayDist: r.subwayDist }))));

  // ---- 협성 쪽도 LOCAL peer + component 분해용 ----
  const target2 = idByLabel['협성르네상스(서구)'];
  const targetAptSeq2 = TARGETS['협성르네상스(서구)'];
  const targetCandidate2: PeerCandidate = { aptSeq: targetAptSeq2, sggCd: target2.m.sggCd, umdName: target2.m.umdName, buildYear: target2.m.buildYear };
  const levels2 = resolvePeerPoolLevels(targetCandidate2, candidates, false);
  const localLevel2 = levels2[0];
  console.log(`\n${'='.repeat(78)}\n[§6/§8] 협성르네상스 LOCAL peer pool (동=${target2.m.umdName}) — level=${localLevel2.level} tier=${localLevel2.tier} size=${localLevel2.aptSeqs.length}\n${'='.repeat(78)}`);

  // ---- transport 4개 sub-metric 전부 side-by-side ----
  for (const [label, aptSeq, level] of [
    ['대신해모로', targetAptSeq, localLevel],
    ['협성르네상스', targetAptSeq2, localLevel2],
  ] as const) {
    console.log(`\n[§6/§7] ${label} transport component 분해 (peer n=${level.aptSeqs.length})`);
    const locs = await prisma.apartmentLocationFeature.findMany({ where: { aptSeq: { in: level.aptSeqs } } });
    for (const key of ['nearestSubwayDistanceM', 'subwayCount1000m', 'nearestBusStopDistanceM', 'busStopCount300m'] as const) {
      const featRows = level.aptSeqs.map((s) => {
        const l = locs.find((x) => x.aptSeq === s);
        return { aptSeq: s, value: l ? (l[key] as number | null) : null, isComplete: l ? l.qualityFlag === 'complete' : false };
      });
      const ranked = rankFeature(featRows, key, FEATURE_DIRECTIONS[key], key.includes('Distance'));
      const t = ranked.get(aptSeq);
      const raw = featRows.find((r) => r.aptSeq === aptSeq)?.value;
      console.log(`  ${key}: raw=${raw} percentile=${t?.percentile?.toFixed(1)} score-contribution≈${t?.percentile != null ? (5 + t.percentile / 100 * 90).toFixed(1) : 'N/A'}`);
    }
  }

  console.log(`\n${'='.repeat(78)}\n[OFFICIAL RESULT 재확인]\n${'='.repeat(78)}`);
  for (const [label, aptSeq] of Object.entries(TARGETS)) {
    const r = await calculateApartmentScore(aptSeq);
    const t = r.categories.find((c: any) => c.key === 'transport');
    console.log(`${label}: total=${r.score} transport=${(t as any)?.score}`);
  }

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
