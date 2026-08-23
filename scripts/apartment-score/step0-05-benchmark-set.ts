// E-JIP SCORE V2 STEP 0 §11 — 부산 대표단지 benchmark set(regression 용,
// "정답 순위"를 만들지 않는다 — 다양성 있는 표본 선정만). READ-ONLY.
import { prisma } from '../../src/lib/prisma';
import { calculateApartmentScore } from '../../src/lib/apartment-score/server/calculate';

interface Row {
  aptSeq: string; name: string; sigungu: string | null; umdName: string | null;
  buildYear: number | null; totalHouseholds: number | null; parkingCount: number | null;
  score: number | null; transport: number | null; parking: number | null; school: number | null;
  nearestSubwayDistanceM: number | null;
}

async function main() {
  const masters = await prisma.apartmentMaster.findMany({
    where: { aptSeq: { not: null }, sigungu: { not: null } },
    select: { aptSeq: true, name: true, sigungu: true, umdName: true, buildYear: true, totalHouseholds: true, parkingCount: true },
  });
  const locs = await prisma.apartmentLocationFeature.findMany({ select: { aptSeq: true, nearestSubwayDistanceM: true } });
  const locByAptSeq = new Map(locs.map((l) => [l.aptSeq, l.nearestSubwayDistanceM]));

  const districts = ['서구','해운대구','동래구','수영구','남구','부산진구','연제구','강서구','기장군'];
  const picks: Row[] = [];
  const seen = new Set<string>();

  async function scoreOf(aptSeq: string): Promise<Row | null> {
    const m = masters.find((x) => x.aptSeq === aptSeq);
    if (!m) return null;
    const r = await calculateApartmentScore(aptSeq);
    const cat = (key: string) => r.categories.find((c: any) => c.key === key)?.score ?? null;
    return {
      aptSeq, name: m.name, sigungu: m.sigungu, umdName: m.umdName, buildYear: m.buildYear,
      totalHouseholds: m.totalHouseholds, parkingCount: m.parkingCount, score: r.score,
      transport: cat('transport'), parking: cat('parking'), school: cat('schoolAccess'),
      nearestSubwayDistanceM: locByAptSeq.get(aptSeq) ?? null,
    };
  }

  function addPick(r: Row | null, tag: string) {
    if (!r || seen.has(r.aptSeq)) return;
    seen.add(r.aptSeq);
    picks.push(r);
    console.error(`  [${tag}] ${r.name}(${r.sigungu} ${r.umdName})`);
  }

  // 지역 분산: 각 구 1개씩(households 있는 것 우선)
  for (const d of districts) {
    const inDistrict = masters.filter((m) => m.sigungu === d);
    const withHouseholds = inDistrict.filter((m) => m.totalHouseholds != null);
    const target = (withHouseholds[0] ?? inDistrict[0])?.aptSeq;
    if (target) addPick(await scoreOf(target), `지역대표:${d}`);
  }

  // 신축 대단지(2020+, 500+세대) 3개
  const newLarge = masters.filter((m) => (m.buildYear ?? 0) >= 2020 && (m.totalHouseholds ?? 0) >= 500).slice(0, 3);
  for (const m of newLarge) addPick(await scoreOf(m.aptSeq!), '신축대단지');

  // 구축 대단지(2000-, 500+세대) 3개
  const oldLarge = masters.filter((m) => (m.buildYear ?? 9999) <= 2000 && (m.totalHouseholds ?? 0) >= 500).slice(0, 3);
  for (const m of oldLarge) addPick(await scoreOf(m.aptSeq!), '구축대단지');

  // 초역세권 후보(subway<=200m) 4개
  const nearSubway = masters.filter((m) => {
    const d = locByAptSeq.get(m.aptSeq!);
    return d != null && d <= 200;
  }).slice(0, 4);
  for (const m of nearSubway) addPick(await scoreOf(m.aptSeq!), '초역세권');

  // 비역세권(subway>=1500m, 반경밖) 3개
  const farSubway = masters.filter((m) => {
    const d = locByAptSeq.get(m.aptSeq!);
    return d != null && d >= 1500;
  }).slice(0, 3);
  for (const m of farSubway) addPick(await scoreOf(m.aptSeq!), '비역세권');

  // 대단지 중 households 상위 5개(고용량)
  const bigHouseholds = [...masters].filter((m) => m.totalHouseholds != null).sort((a, b) => b.totalHouseholds! - a.totalHouseholds!).slice(0, 5);
  for (const m of bigHouseholds) addPick(await scoreOf(m.aptSeq!), '고용량');

  // 재건축 후보(1990년 이전, households 확보된 것)
  const redevCandidates = masters.filter((m) => (m.buildYear ?? 9999) <= 1990 && m.totalHouseholds != null).slice(0, 4);
  for (const m of redevCandidates) addPick(await scoreOf(m.aptSeq!), '재건축후보');

  console.log(`\n총 ${picks.length}개 benchmark 단지 선정\n`);
  console.log('aptSeq | name | sigungu/umd | buildYear | households | score | T | P | S | subwayM');
  for (const r of picks) {
    console.log(`${r.aptSeq} | ${r.name} | ${r.sigungu}/${r.umdName} | ${r.buildYear ?? '?'} | ${r.totalHouseholds ?? '?'} | ${r.score ?? 'N/A'} | ${r.transport?.toFixed(0) ?? '-'} | ${r.parking?.toFixed(0) ?? '-'} | ${r.school?.toFixed(0) ?? '-'} | ${r.nearestSubwayDistanceM ?? '?'}`);
  }

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
