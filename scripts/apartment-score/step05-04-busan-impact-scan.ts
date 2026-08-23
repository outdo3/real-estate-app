// E-JIP SCORE V2 STEP 0.5 §13 — 부산 전역 영향범위 추정. READ-ONLY.
import { prisma } from '../../src/lib/prisma';

async function main() {
  const all = await prisma.apartmentMaster.findMany({
    where: { aptSeq: { not: null }, latitude: { not: null } },
    select: { aptSeq: true, geocodeQuality: true, totalHouseholds: true, roadAddress: true, jibunAddress: true, latitude: true, longitude: true },
  });
  console.log('부산 좌표 확보 ApartmentMaster:', all.length);
  console.log('geocodeQuality=normalized:', all.filter((m) => m.geocodeQuality === 'normalized').length,
    `(${(all.filter((m) => m.geocodeQuality === 'normalized').length / all.length * 100).toFixed(1)}%)`);
  console.log('geocodeQuality=exact:', all.filter((m) => m.geocodeQuality === 'exact').length);
  console.log('registry-thin(roadAddress+jibunAddress 둘 다 null):', all.filter((m) => m.roadAddress == null && m.jibunAddress == null).length,
    `(${(all.filter((m) => m.roadAddress == null && m.jibunAddress == null).length / all.length * 100).toFixed(1)}%)`);
  console.log('totalHouseholds null(건축물대장 미연결):', all.filter((m) => m.totalHouseholds == null).length,
    `(${(all.filter((m) => m.totalHouseholds == null).length / all.length * 100).toFixed(1)}%)`);

  // normalized + registry-thin 교집합(가장 위험한 조합)
  const risky = all.filter((m) => m.geocodeQuality === 'normalized' && m.roadAddress == null && m.jibunAddress == null && m.totalHouseholds == null);
  console.log('\n[고위험 조합] normalized geocode + 주소없음 + 건축물대장 미연결:', risky.length, `(${(risky.length / all.length * 100).toFixed(1)}%)`);

  // 좌표 중복(부산 전체)
  const coordCounts = new Map<string, number>();
  for (const m of all) {
    if (m.latitude == null || m.longitude == null) continue;
    const key = `${m.latitude.toFixed(6)},${m.longitude.toFixed(6)}`;
    coordCounts.set(key, (coordCounts.get(key) ?? 0) + 1);
  }
  const dupeGroups = [...coordCounts.values()].filter((c) => c > 1);
  console.log('\n부산 전체 좌표 중복 그룹:', dupeGroups.length, '건, 중복에 포함된 총 row 수:', dupeGroups.reduce((a, b) => a + b, 0));

  // subway distance 0~5m(비현실적 의심)
  const locs = await prisma.apartmentLocationFeature.findMany({ select: { aptSeq: true, nearestSubwayDistanceM: true } });
  const nearZero = locs.filter((l) => l.nearestSubwayDistanceM != null && l.nearestSubwayDistanceM <= 5);
  console.log('\nnearestSubwayDistanceM <= 5m(비현실적 의심):', nearZero.length, JSON.stringify(nearZero.slice(0, 10)));

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
