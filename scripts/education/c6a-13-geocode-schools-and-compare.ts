// 읽기 전용 — Kakao 좌표를 School 테이블에 쓰지 않는다(DB write 금지, 이번 STEP
// scope 밖). 순수히 nearest-vs-zone 비교용 메모리 캐시(scratchpad JSON)로만 사용.
import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });
import { readFileSync, writeFileSync, existsSync } from 'fs';
import * as turf from '@turf/turf';
import { PrismaClient } from '@prisma/client';

const SCRATCHPAD = 'C:/Users/123/AppData/Local/Temp/claude/D--anti2-aaa-real-estate-app/d12c257a-d49f-44c6-b1f1-1c67dc226310/scratchpad';
const CACHE_PATH = `${SCRATCHPAD}/c6a-school-geocode-cache.json`;
const RESULTS_PATH = `${SCRATCHPAD}/c6a-pipeline-results.json`;

const prisma = new PrismaClient();
const kakaoKey = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY;

async function geocodeSchool(schoolName: string): Promise<[number, number] | null> {
  if (!kakaoKey) return null;
  try {
    const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(schoolName + ' 부산')}`;
    const res = await fetch(url, {
      headers: { Authorization: `KakaoAK ${kakaoKey}`, KA: 'sdk/1.0 os/javascript origin/http%3A%2F%2Flocalhost%3A3000', Origin: 'http://localhost:3000' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.documents && data.documents.length > 0) {
      const doc = data.documents.find((d: any) => d.category_group_code === 'SC4') || data.documents[0];
      return [parseFloat(doc.x), parseFloat(doc.y)];
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function main() {
  const canonicalSchools = await prisma.school.findMany({
    where: { sigunguCode: { startsWith: '26' }, schoolLevel: '초등학교' },
    select: { id: true, schoolName: true, sigunguCode: true },
  });
  console.log('부산 초등학교(canonical) 수:', canonicalSchools.length);

  let cache: Record<string, [number, number] | null> = {};
  if (existsSync(CACHE_PATH)) cache = JSON.parse(readFileSync(CACHE_PATH, 'utf-8'));

  let fetched = 0;
  for (const s of canonicalSchools) {
    if (cache[s.schoolName] !== undefined) continue;
    const coords = await geocodeSchool(s.schoolName);
    cache[s.schoolName] = coords;
    fetched++;
    if (fetched % 20 === 0) {
      writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 1));
      console.log(`  geocoded ${fetched}...`);
    }
    await new Promise((r) => setTimeout(r, 80));
  }
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 1));
  const success = Object.values(cache).filter((v) => v !== null).length;
  console.log('geocode 완료:', Object.keys(cache).length, '성공:', success, '실패:', Object.keys(cache).length - success);

  // nearest-vs-zone 비교
  const pipelineData = JSON.parse(readFileSync(RESULTS_PATH, 'utf-8'));
  const apartments = await prisma.apartmentMaster.findMany({
    where: { sggCd: { startsWith: '26' }, latitude: { not: null }, longitude: { not: null } },
    select: { aptSeq: true, name: true, sigungu: true, umdName: true, latitude: true, longitude: true },
  });

  const schoolPoints = canonicalSchools
    .map((s) => ({ name: s.schoolName, coords: cache[s.schoolName] }))
    .filter((s): s is { name: string; coords: [number, number] } => !!s.coords);
  console.log('nearest 계산에 사용 가능한 학교 좌표 수:', schoolPoints.length);

  const byAptSeq = new Map(pipelineData.results.map((r: any) => [r.aptSeq, r]));
  const comparisons: any[] = [];
  let same = 0,
    different = 0,
    multipleZoneOptions = 0,
    noNearby = 0,
    noZone = 0;

  for (const apt of apartments) {
    const zoneRecord: any = byAptSeq.get(apt.aptSeq);
    if (!zoneRecord || zoneRecord.zones.length === 0) {
      noZone++;
      continue;
    }
    let nearest: { name: string; dist: number } | null = null;
    for (const sp of schoolPoints) {
      const d = turf.distance(turf.point([apt.longitude!, apt.latitude!]), turf.point(sp.coords), { units: 'meters' });
      if (!nearest || d < nearest.dist) nearest = { name: sp.name, dist: d };
    }
    if (!nearest) {
      noNearby++;
      continue;
    }

    const zoneSchoolNames: string[] = zoneRecord.zones.flatMap((z: any) => z.schools.map((s: any) => s.schoolName.replace('(휴교)', '')));
    const isMultiple = zoneSchoolNames.length > 1;
    const nearestMatches = zoneSchoolNames.some((n) => n === nearest!.name);

    if (isMultiple) multipleZoneOptions++;
    else if (nearestMatches) same++;
    else different++;

    comparisons.push({
      aptSeq: apt.aptSeq,
      aptName: apt.name,
      sigungu: apt.sigungu,
      nearestSchool: nearest.name,
      nearestDistM: Math.round(nearest.dist),
      zoneSchools: zoneSchoolNames,
      isMultiple,
      sameAsNearest: !isMultiple && nearestMatches,
    });
  }

  console.log('\n=== nearest vs zone 비교 집계 ===');
  console.log({ same, different, multipleZoneOptions, noNearby, noZone, total: comparisons.length });

  const diffSamples = comparisons.filter((c) => !c.isMultiple && !c.sameAsNearest).slice(0, 10);
  console.log('\n대표 DIFFERENT 사례 10개:', JSON.stringify(diffSamples, null, 1));

  writeFileSync(`${SCRATCHPAD}/c6a-nearest-vs-zone-comparison.json`, JSON.stringify({ same, different, multipleZoneOptions, noNearby, noZone, comparisons }, null, 1));

  await prisma.$disconnect();
}
main().catch(console.error);
