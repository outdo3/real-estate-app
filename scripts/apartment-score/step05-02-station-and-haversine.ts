// E-JIP SCORE V2 STEP 0.5 §5,10 — station identity + Haversine 재계산. READ-ONLY,
// 기존 collectors/kakao.ts 그대로 재사용(신규 API 의존성 없음).
import * as dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { point, distance as turfDistance } from '@turf/turf';
import { prisma } from '../../src/lib/prisma';
import { categorySearch } from '../../src/lib/apartment-score/collectors/kakao';

const TARGETS = [
  { label: '대신해모로센트럴아파트', aptSeq: '26140-1356' },
  { label: '협성르네상스(서구)', aptSeq: '26140-51' },
];

async function main() {
  console.log('='.repeat(78));
  console.log('[§5] 실시간 Kakao SW8(지하철) 검색 — 두 단지 각각 반경 1000m, sort=distance');
  console.log('='.repeat(78));

  for (const t of TARGETS) {
    const m = await prisma.apartmentMaster.findUnique({ where: { aptSeq: t.aptSeq }, select: { latitude: true, longitude: true, name: true } });
    if (!m?.latitude || !m?.longitude) continue;
    const res = await categorySearch('SW8', m.latitude, m.longitude, 1000);
    console.log(`\n${t.label} (${m.latitude},${m.longitude}) 기준 SW8 결과 ok=${res.ok} pageableCount=${res.pageableCount}`);
    for (const d of res.documents) {
      console.log(`  ${d.distance}m | ${d.place_name} | (${d.y},${d.x}) | id=${d.id}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  // ---- 7개 "더 가까운" peer 전부 + 두 target에 대해 Haversine 재계산 vs stored ----
  console.log(`\n${'='.repeat(78)}\n[§10] stored distance vs Turf Haversine 재계산\n${'='.repeat(78)}`);

  const aptSeqs = ['26140-1356', '26140-51', '26140-37', '26140-1081', '26140-159', '26140-1239', '26140-208', '26140-25', '26140-26'];
  const masters = await prisma.apartmentMaster.findMany({ where: { aptSeq: { in: aptSeqs } }, select: { aptSeq: true, name: true, latitude: true, longitude: true, geocodeQuality: true } });
  const locs = await prisma.apartmentLocationFeature.findMany({ where: { aptSeq: { in: aptSeqs } } });

  // 서대신역/동대신역 좌표를 실측 SW8 결과에서 채집(위에서 이미 찍힌 걸 재사용하기 위해 재조회)
  const dh = await prisma.apartmentMaster.findUnique({ where: { aptSeq: '26140-1356' }, select: { latitude: true, longitude: true } });
  const stationSearch = dh?.latitude && dh?.longitude ? await categorySearch('SW8', dh.latitude, dh.longitude, 1500) : null;
  const seodaesin = stationSearch?.documents.find((d) => d.place_name.includes('서대신'));
  const dongdaesin = stationSearch?.documents.find((d) => d.place_name.includes('동대신'));
  console.log('서대신역 좌표(실측):', seodaesin ? `${seodaesin.y},${seodaesin.x}` : 'NOT FOUND in 1500m');
  console.log('동대신역 좌표(실측):', dongdaesin ? `${dongdaesin.y},${dongdaesin.x}` : 'NOT FOUND in 1500m');

  for (const aptSeq of aptSeqs) {
    const m = masters.find((x) => x.aptSeq === aptSeq);
    const l = locs.find((x) => x.aptSeq === aptSeq);
    if (!m?.latitude || !m?.longitude) continue;
    const usedStation = l?.nearestSubwayName?.includes('서대신') ? seodaesin : l?.nearestSubwayName?.includes('동대신') ? dongdaesin : null;
    let recomputed: number | null = null;
    if (usedStation) {
      const from = point([m.longitude, m.latitude]);
      const to = point([Number(usedStation.x), Number(usedStation.y)]);
      recomputed = Math.round(turfDistance(from, to, { units: 'kilometers' }) * 1000);
    }
    const stored = l?.nearestSubwayDistanceM ?? null;
    const delta = recomputed != null && stored != null ? recomputed - stored : null;
    console.log(`${m.name}(${aptSeq}) geo=${m.geocodeQuality} station=${l?.nearestSubwayName} stored=${stored}m recomputed(같은 역 좌표 기준)=${recomputed}m delta=${delta}`);
  }

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
