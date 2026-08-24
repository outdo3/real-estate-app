// E-JIP SCORE V2 STEP 0.7-A §13/§14/§15/§16 — re-geocode candidate 생성 + dry-run.
// production apartment_master_seed.ts:geocode()를 그대로 import해서 재사용한다(코드
// 변경 없음, export/require.main 가드만 추가 — §11.2 실측 검증된 cascade 그대로).
// 이 스크립트는 READ-ONLY(Kakao API는 조회만, DB write 없음).
import fs from 'fs';
import path from 'path';
import { classifyDistanceBucket, isRegeocodeSafe, resolveDuplicateCoordinateGroup } from './lib/step07a-write-guards';

const PLAN_PATH = path.resolve(__dirname, 'output/step07a-write-plan.json');
const OUT_PATH = path.resolve(__dirname, 'output/step07a-regeocode-dryrun.json');
const EXPECTED_SIDO = '부산광역시';

// 부산 16개 구·군(STEP 0.7 §2/§16에서 이미 실측 확인된 고정 목록 재사용, 새로 만들지 않음)
const BUSAN_GU_BY_LAWDCD: Record<string, string> = {
  '26110': '중구', '26140': '서구', '26170': '동구', '26200': '영도구',
  '26230': '부산진구', '26260': '동래구', '26290': '남구', '26320': '북구',
  '26350': '해운대구', '26380': '사하구', '26410': '금정구', '26440': '강서구',
  '26470': '연제구', '26500': '수영구', '26530': '사상구', '26710': '기장군',
};

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

async function main() {
  const { prisma } = await import('../../src/lib/prisma');
  const { geocode } = await import('../apartment_master_seed');

  const plan = JSON.parse(fs.readFileSync(PLAN_PATH, 'utf-8'));
  const writePlan: any[] = plan.writePlan;
  console.log(`registry write 완료된 후보: ${writePlan.length}건`);

  // §13: 현재 DB(registry write 반영된 상태) 기준 재조회
  const aptSeqs = writePlan.map((w) => w.aptSeq);
  const rows = await prisma.apartmentMaster.findMany({
    where: { aptSeq: { in: aptSeqs } },
    select: { aptSeq: true, name: true, sggCd: true, umdName: true, roadAddress: true, jibunAddress: true, latitude: true, longitude: true, geocodeQuality: true },
  });
  console.log(`DB 조회: ${rows.length}건`);

  const classification = { NEEDS_REGEOCODE: [] as any[], KEEP_EXISTING_HIGH: [] as any[], NO_VALID_ADDRESS: [] as any[] };
  for (const r of rows) {
    if (r.geocodeQuality === 'exact') { classification.KEEP_EXISTING_HIGH.push(r); continue; }
    if (r.roadAddress == null && r.jibunAddress == null) { classification.NO_VALID_ADDRESS.push(r); continue; }
    classification.NEEDS_REGEOCODE.push(r);
  }
  console.log('\n분류:', Object.fromEntries(Object.entries(classification).map(([k, v]) => [k, v.length])));

  console.log(`\n[LIVE GEOCODE] ${classification.NEEDS_REGEOCODE.length}건, production geocode() cascade, concurrency=4...`);
  const startedAt = Date.now();
  let done = 0;
  const results = await mapWithConcurrency(classification.NEEDS_REGEOCODE, 4, async (r) => {
    const geo = await geocode(EXPECTED_SIDO, r.roadAddress, r.jibunAddress, r.umdName ?? '', r.name);
    done++;
    if (done % 100 === 0) console.log(`  [${done}/${classification.NEEDS_REGEOCODE.length}] ${((Date.now() - startedAt) / 60000).toFixed(1)}분 경과`);

    const expectedGu = BUSAN_GU_BY_LAWDCD[r.sggCd ?? ''] ?? null;
    const regionCheck = geo.matchedAddr && expectedGu ? geo.matchedAddr.includes(expectedGu) : (geo.lat == null ? null : false);
    const distanceDeltaM = (r.latitude != null && r.longitude != null && geo.lat != null && geo.lng != null)
      ? haversineM(r.latitude, r.longitude, geo.lat, geo.lng) : null;

    return {
      aptSeq: r.aptSeq, aptName: r.name, sggCd: r.sggCd, expectedGu,
      addressUsed: geo.status === 'exact' ? (r.roadAddress ?? r.jibunAddress) : (geo.status === 'normalized' ? `${r.umdName} ${r.name}` : null),
      oldLatLng: r.latitude != null ? { lat: r.latitude, lng: r.longitude } : null,
      newLatLng: geo.lat != null && geo.lng != null ? { lat: geo.lat, lng: geo.lng } : null,
      oldQuality: r.geocodeQuality,
      newStatus: geo.status,
      matchedAddr: geo.matchedAddr,
      distanceDeltaM,
      regionCheck,
    };
  });

  fs.writeFileSync(path.resolve(__dirname, 'output/step07a-regeocode-raw.json'), JSON.stringify(results, null, 1));

  // §16 sanity gates 분류
  const buckets = { under100m: 0, under300m: 0, under1km: 0, over1km: 0, noOldCoord: 0 };
  const regionMismatch = results.filter((r) => r.regionCheck === false);
  const geocodeFailed = results.filter((r) => r.newLatLng == null);
  const geocodeSuccess = results.filter((r) => r.newLatLng != null);
  for (const r of results) buckets[classifyDistanceBucket(r.distanceDeltaM)]++;

  // duplicate suspicious coordinate(같은 좌표를 2개 이상 aptSeq가 새로 받는 경우,
  // lib/step07a-write-guards.ts:resolveDuplicateCoordinateGroup 재사용 — production
  // deduplicateCoordinates()와 동일한 원칙: exact가 정확히 1개면 그것만 신뢰, 아니면 그룹 전체 보류)
  const coordGroups = new Map<string, typeof results>();
  for (const r of geocodeSuccess) {
    const nll = r.newLatLng;
    if (!nll) continue;
    const key = `${nll.lat.toFixed(6)},${nll.lng.toFixed(6)}`;
    if (!coordGroups.has(key)) coordGroups.set(key, []);
    coordGroups.get(key)!.push(r);
  }
  const dupSet = new Set<string>();
  for (const [, group] of coordGroups.entries()) {
    if (group.length < 2) continue;
    for (const seq of resolveDuplicateCoordinateGroup(group)) dupSet.add(seq);
  }
  const duplicateSuspicious = [...dupSet];

  // 안전 SAFE 후보(lib/step07a-write-guards.ts:isRegeocodeSafe 재사용)
  const safe = geocodeSuccess.filter((r) => isRegeocodeSafe({ newLatLng: r.newLatLng, regionCheck: r.regionCheck, distanceDeltaM: r.distanceDeltaM, isDuplicateSuspicious: dupSet.has(r.aptSeq) }));
  const unsafe = results.filter((r) => !safe.includes(r));

  console.log('\n=== RE-GEOCODE DRY-RUN SUMMARY ===');
  console.log(JSON.stringify({
    NEEDS_REGEOCODE: classification.NEEDS_REGEOCODE.length,
    KEEP_EXISTING_HIGH: classification.KEEP_EXISTING_HIGH.length,
    NO_VALID_ADDRESS: classification.NO_VALID_ADDRESS.length,
    geocodeSuccess: geocodeSuccess.length,
    geocodeFailed: geocodeFailed.length,
    regionMismatch: regionMismatch.length,
    duplicateSuspicious: duplicateSuspicious.length,
    distanceBuckets: buckets,
    SAFE_WRITE_CANDIDATES: safe.length,
    UNSAFE_EXCLUDED: unsafe.length,
  }, null, 1));

  if (regionMismatch.length > 0) console.log('\nregion mismatch 샘플(최대 10):', JSON.stringify(regionMismatch.slice(0, 10), null, 1));
  if (buckets.over1km > 0) console.log('\n>1km 이동 샘플(최대 10):', JSON.stringify(results.filter((r) => r.distanceDeltaM != null && r.distanceDeltaM >= 1000).slice(0, 10), null, 1));
  if (duplicateSuspicious.length > 0) console.log('\nduplicate suspicious aptSeq(최대 20):', duplicateSuspicious.slice(0, 20));
  if (geocodeFailed.length > 0) console.log('\ngeocode 실패 샘플(최대 10):', JSON.stringify(geocodeFailed.slice(0, 10), null, 1));

  fs.writeFileSync(OUT_PATH, JSON.stringify({
    generatedAt: new Date().toISOString(), classification: { NO_VALID_ADDRESS: classification.NO_VALID_ADDRESS, KEEP_EXISTING_HIGH_COUNT: classification.KEEP_EXISTING_HIGH.length },
    buckets, regionMismatch, duplicateSuspicious, safeAptSeqs: safe.map((r) => r.aptSeq), unsafeAptSeqs: unsafe.map((r) => r.aptSeq), results,
  }, null, 1));
  console.log(`\n결과 저장: ${OUT_PATH}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
