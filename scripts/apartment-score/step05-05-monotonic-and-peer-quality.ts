// E-JIP SCORE V2 STEP 0.5 §8-9 — peer universe 품질 + monotonic distance sanity test. READ-ONLY.
import { prisma } from '../../src/lib/prisma';

async function main() {
  const dongs = ['서대신동2가', '서대신동3가', '동대신동1가', '동대신동2가', '동대신동3가'];
  const masters = await prisma.apartmentMaster.findMany({
    where: { sggCd: '26140', umdName: { in: dongs }, aptSeq: { not: null } },
    select: { aptSeq: true, name: true, umdName: true, totalHouseholds: true, geocodeQuality: true, roadAddress: true, jibunAddress: true },
  });
  const locs = await prisma.apartmentLocationFeature.findMany({ where: { aptSeq: { in: masters.map((m) => m.aptSeq!) } } });
  const rows = masters.map((m) => {
    const l = locs.find((x) => x.aptSeq === m.aptSeq);
    return { name: m.name, umdName: m.umdName, households: m.totalHouseholds, geo: m.geocodeQuality, dist: l?.nearestSubwayDistanceM ?? null, station: l?.nearestSubwayName ?? null };
  }).filter((r) => r.dist != null).sort((a, b) => a.dist! - b.dist!);

  console.log('[§9] 서대신동/동대신동 TOP 20(지하철 거리 오름차순, monotonic sanity)');
  rows.slice(0, 20).forEach((r, i) => console.log(`${i + 1}. ${r.dist}m | ${r.station} | ${r.name}(${r.umdName}) | households=${r.households ?? '없음(registry미연결)'} | geo=${r.geo}`));

  const thinInTop20 = rows.slice(0, 20).filter((r) => r.households == null).length;
  console.log(`\nTOP 20 중 registry 미연결(households=null): ${thinInTop20}/20`);

  // ---- §8 peer universe 정확성: 대신해모로/협성 각각의 LOCAL peer 전체 households 유무 비율 ----
  for (const [label, umdName] of [['대신해모로(서대신동2가)', '서대신동2가'], ['협성르네상스(서대신동3가)', '서대신동3가']] as const) {
    const inDong = masters.filter((m) => m.umdName === umdName);
    const withHouseholds = inDong.filter((m) => m.totalHouseholds != null).length;
    const normalizedGeo = inDong.filter((m) => m.geocodeQuality === 'normalized').length;
    const noAddress = inDong.filter((m) => m.roadAddress == null && m.jibunAddress == null).length;
    console.log(`\n[§8] ${label} LOCAL peer(동 전체) = ${inDong.length}건 | households 있음=${withHouseholds}(${(withHouseholds / inDong.length * 100).toFixed(0)}%) | geocode=normalized=${normalizedGeo}(${(normalizedGeo / inDong.length * 100).toFixed(0)}%) | 주소없음=${noAddress}(${(noAddress / inDong.length * 100).toFixed(0)}%)`);
  }

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
