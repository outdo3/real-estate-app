/**
 * BUSAN SCORE DATA V1.1 — geocodeQuality='failed' 335건 복구.
 *
 * [원인 진단, 실측] 기존 `apartment_master_seed.ts`의 geocode()는 road/jibun
 * 주소까지도 전부 `search/keyword.json`(POI 키워드 검색)으로만 조회한다.
 * 대상 단지(26350-2360)를 정확한 KA/Origin 헤더로 다시 호출해보니
 * keyword.json도 지금은 정상 응답한다 — 즉 처음 batch 실행 시점의 일시적
 * 실패(rate limit/timeout/네트워크 등, G번 원인)였을 가능성이 높다.
 * 다만 재발 방지와 정확도를 위해 이번 복구는 **Kakao 공식 주소
 * geocoder(`search/address.json`)를 최우선으로** 쓴다 — 실측 비교 결과
 * (docs/development/BUSAN-SCORE-DATA-V1.1-geocoding-recovery.md §2 참고)
 * keyword.json으로 순수 아파트 이름만 검색하면 완전히 다른 지역(예:
 * "스카이맨션" → 경기 부천시 결과)이 잡히는 실제 오매칭을 확인했다 —
 * address.json은 구조화된 주소 자체를 지오코딩해 이런 위험이 없다.
 *
 * 우선순위(주소 기반 우선, 이름 단독 최후):
 *   1. address.json(roadAddress)         — 있으면
 *   2. address.json(jibunAddress)        — 있으면
 *   3. address.json(sido+sigungu+dong+jibun 조합) — road/jibunAddress 둘 다 없을 때
 *   4. keyword.json(roadAddress)         — 기존 1순위, address.json 실패 시 폴백
 *   5. keyword.json(jibunAddress)        — 기존 2순위
 *   6. keyword.json(`${dong} ${name}`)   — 기존 3순위, 이름 단독 최후 수단
 *
 * 검증(모든 후보 공통): region_1depth_name(또는 파싱된 첫 토큰)이
 * "부산"과 일치 + region_2depth_name(또는 파싱된 두번째 토큰)이 해당
 * 단지의 sigungu와 일치해야 ACCEPT. 하나라도 불일치하면 그 후보는
 * 버리고 다음 후보로 — 전부 실패하면 AMBIGUOUS/NO_RESULT로 분류하고
 * 좌표를 만들지 않는다.
 *
 * 사용법:
 *   npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js scripts/apartment-score/recover-missing-geocodes.ts --dry-run
 *
 * 옵션:
 *   --dry-run     Kakao 호출은 하되 DB write 없음
 *   --limit=N     처음 N건만 처리(디버그용)
 *   --aptSeq=X    특정 aptSeq 1건만 처리
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { prisma } from '@/lib/prisma';

const KAKAO_KEY = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY || '';
const kakaoHeaders = {
  Authorization: `KakaoAK ${KAKAO_KEY}`,
  KA: 'sdk/1.0 os/javascript origin/http%3A%2F%2Flocalhost%3A3000',
  Origin: 'http://localhost:3000',
};
const REQUEST_DELAY_MS = 150; // 기존 apartment-score 관례(Kakao 페이싱)와 동일
const CONCURRENCY = 3;

type Target = {
  aptSeq: string;
  name: string;
  sido: string;
  sigungu: string;
  umdName: string | null;
  jibun: string | null;
  roadAddress: string | null;
  jibunAddress: string | null;
};

type CandidateResult = { lat: number; lng: number; region1: string; region2: string; matchedAddr: string; method: string; quality: 'exact' | 'normalized' } | null;

type Outcome =
  | { kind: 'RECOVERABLE'; lat: number; lng: number; quality: 'exact' | 'normalized'; matchedAddr: string; method: string }
  | { kind: 'AMBIGUOUS'; reason: string }
  | { kind: 'NO_RESULT' }
  | { kind: 'API_ERROR'; message: string };

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function tryAddressJson(query: string, method: string): Promise<CandidateResult> {
  const url = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: kakaoHeaders, signal: AbortSignal.timeout(5000) });
  if (!res.ok) return null;
  const data = await res.json();
  const doc = data.documents?.[0];
  if (!doc) return null;
  const region1 = doc.address?.region_1depth_name || '';
  const region2 = doc.address?.region_2depth_name || '';
  return {
    lat: parseFloat(doc.y),
    lng: parseFloat(doc.x),
    region1,
    region2,
    matchedAddr: doc.road_address?.address_name || doc.address_name || '',
    method,
    quality: 'exact',
  };
}

async function tryKeywordJson(query: string, method: string): Promise<CandidateResult> {
  const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: kakaoHeaders, signal: AbortSignal.timeout(5000) });
  if (!res.ok) return null;
  const data = await res.json();
  const doc = data.documents?.[0];
  if (!doc) return null;
  const addr = doc.road_address_name || doc.address_name || '';
  const tokens = addr.split(/\s+/);
  return {
    lat: parseFloat(doc.y),
    lng: parseFloat(doc.x),
    region1: tokens[0] || '',
    region2: tokens[1] || '',
    matchedAddr: addr,
    method,
    quality: 'normalized',
  };
}

// "부산광역시"/"부산" 등 표기 차이를 흡수하기 위해 앞 2글자만 비교(기존
// apartment_master_seed.ts의 includes() 상호포함 검증보다 엄격 — 시군구까지
// 검사하는 이번 STEP 요구사항, §6 안전성 gate).
function regionMatches(actual: string, expected: string): boolean {
  if (!actual || !expected) return false;
  return actual.slice(0, 2) === expected.slice(0, 2);
}

async function geocodeOne(target: Target): Promise<Outcome> {
  const candidates: { fn: () => Promise<CandidateResult>; label: string }[] = [];

  if (target.roadAddress) candidates.push({ fn: () => tryAddressJson(target.roadAddress!, 'address.json:road'), label: 'address.json:road' });
  if (target.jibunAddress) candidates.push({ fn: () => tryAddressJson(target.jibunAddress!.replace(/번지$/, ''), 'address.json:jibun'), label: 'address.json:jibun' });
  if (!target.roadAddress && !target.jibunAddress && target.umdName && target.jibun) {
    const constructed = `${target.sido} ${target.sigungu} ${target.umdName} ${target.jibun}`;
    candidates.push({ fn: () => tryAddressJson(constructed, 'address.json:constructed'), label: 'address.json:constructed' });
  }
  if (target.roadAddress) candidates.push({ fn: () => tryKeywordJson(target.roadAddress!, 'keyword.json:road'), label: 'keyword.json:road' });
  if (target.jibunAddress) candidates.push({ fn: () => tryKeywordJson(target.jibunAddress!, 'keyword.json:jibun'), label: 'keyword.json:jibun' });
  if (target.umdName) candidates.push({ fn: () => tryKeywordJson(`${target.umdName} ${target.name}`, 'keyword.json:dong+name'), label: 'keyword.json:dong+name' });

  let sawAnyResult = false;
  let lastRejectReason = '';
  for (const c of candidates) {
    let r: CandidateResult;
    try {
      r = await c.fn();
    } catch (e: any) {
      return { kind: 'API_ERROR', message: `${c.label}: ${e.message}` };
    }
    if (!r) continue;
    sawAnyResult = true;
    if (!regionMatches(r.region1, target.sido)) {
      lastRejectReason = `${c.label}: region1(${r.region1}) != sido(${target.sido})`;
      continue;
    }
    if (r.region2 && !regionMatches(r.region2, target.sigungu)) {
      lastRejectReason = `${c.label}: region2(${r.region2}) != sigungu(${target.sigungu})`;
      continue;
    }
    return { kind: 'RECOVERABLE', lat: r.lat, lng: r.lng, quality: r.quality, matchedAddr: r.matchedAddr, method: c.label };
  }
  if (sawAnyResult) return { kind: 'AMBIGUOUS', reason: lastRejectReason || 'all candidates rejected' };
  return { kind: 'NO_RESULT' };
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await fn(items[idx]);
      await sleep(REQUEST_DELAY_MS);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1];
  const limit = limitArg ? parseInt(limitArg, 10) : undefined;
  const aptSeqArg = args.find((a) => a.startsWith('--aptSeq='))?.split('=')[1];

  if (!KAKAO_KEY) {
    console.error('BLOCKER: NEXT_PUBLIC_KAKAO_MAP_API_KEY not set.');
    process.exitCode = 1;
    return;
  }

  const where: any = { sido: '부산', geocodeQuality: 'failed' };
  if (aptSeqArg) where.aptSeq = aptSeqArg;
  let targets = await prisma.apartmentMaster.findMany({
    where,
    select: { aptSeq: true, name: true, sido: true, sigungu: true, umdName: true, jibun: true, roadAddress: true, jibunAddress: true },
  });
  targets = targets.filter((t) => t.aptSeq) as Target[];
  if (limit) targets = targets.slice(0, limit);

  console.log(`=== Geocoding Recovery — targets: ${targets.length}, dry-run: ${dryRun} ===`);

  const results = await mapWithConcurrency(targets as Target[], CONCURRENCY, async (t) => ({ target: t, outcome: await geocodeOne(t) }));

  const summary = { RECOVERABLE: 0, AMBIGUOUS: 0, NO_RESULT: 0, API_ERROR: 0 };
  const recoverable: { aptSeq: string; name: string; lat: number; lng: number; quality: string; matchedAddr: string; method: string }[] = [];
  const unresolved: { aptSeq: string; name: string; sigungu: string; reason: string }[] = [];

  for (const { target, outcome } of results) {
    summary[outcome.kind]++;
    if (outcome.kind === 'RECOVERABLE') {
      recoverable.push({ aptSeq: target.aptSeq, name: target.name, lat: outcome.lat, lng: outcome.lng, quality: outcome.quality, matchedAddr: outcome.matchedAddr, method: outcome.method });
    } else {
      const reason = outcome.kind === 'AMBIGUOUS' ? outcome.reason : outcome.kind === 'API_ERROR' ? outcome.message : 'no geocoding result from any candidate';
      unresolved.push({ aptSeq: target.aptSeq, name: target.name, sigungu: target.sigungu, reason: `${outcome.kind}: ${reason}` });
    }
  }

  // 좌표 충돌 안전 gate(§6) — 복구 후보 좌표가 "이미 존재하는 다른 aptSeq"의
  // 좌표와 정확히 겹치면(반올림 6자리 기준) 서로 다른 두 단지가 같은
  // 좌표로 잡혔다는 뜻 — apartment_master_seed.ts의 dedup 원칙과 동일하게
  // 그 건은 write하지 않고 unresolved로 내린다.
  const existingCoords = await prisma.apartmentMaster.findMany({
    where: { latitude: { not: null } },
    select: { aptSeq: true, latitude: true, longitude: true },
  });
  const coordKey = (lat: number, lng: number) => `${lat.toFixed(6)},${lng.toFixed(6)}`;
  const existingCoordMap = new Map<string, string>();
  existingCoords.forEach((r) => existingCoordMap.set(coordKey(r.latitude!, r.longitude!), r.aptSeq!));

  const finalRecoverable: typeof recoverable = [];
  for (const r of recoverable) {
    const key = coordKey(r.lat, r.lng);
    const collidesWith = existingCoordMap.get(key);
    if (collidesWith && collidesWith !== r.aptSeq) {
      unresolved.push({ aptSeq: r.aptSeq, name: r.name, sigungu: '', reason: `COORDINATE_COLLISION with existing aptSeq ${collidesWith}` });
      summary.RECOVERABLE--;
      summary.AMBIGUOUS++;
      continue;
    }
    finalRecoverable.push(r);
  }

  console.log('\n=== Summary ===');
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nFinal recoverable (post-collision-check): ${finalRecoverable.length}`);
  console.log('\n=== Sample recoverable (first 10) ===');
  finalRecoverable.slice(0, 10).forEach((r) => console.log(`${r.aptSeq} | ${r.name} | ${r.method} | ${r.quality} | (${r.lat}, ${r.lng}) | ${r.matchedAddr}`));

  console.log(`\n=== Unresolved (${unresolved.length}) ===`);
  unresolved.forEach((u) => console.log(`${u.aptSeq} | ${u.name} | ${u.sigungu} | ${u.reason}`));

  if (dryRun) {
    console.log('\n--dry-run: no DB writes.');
    await prisma.$disconnect();
    return;
  }

  let written = 0;
  for (const r of finalRecoverable) {
    await prisma.apartmentMaster.update({
      where: { aptSeq: r.aptSeq },
      data: { latitude: r.lat, longitude: r.lng, geocodeQuality: r.quality },
    });
    written++;
  }
  console.log(`\nWrote ${written} ApartmentMaster rows.`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
