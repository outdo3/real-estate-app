/**
 * OFFICETEL V1 STEP 5B — officetel_masters 좌표 최초 Production 적재.
 *
 * STEP 5A 감사(docs/development/OFFICETEL_V1_STEP5A_GEO_TRUST_AUDIT.md)가 확정한 계약을
 * **그대로** 실행한다. 새 규칙을 만들지 않는다.
 *
 * ── 좌표 계약 ────────────────────────────────────────────────────────────
 * provider : Kakao Local `search/address.json` (구조화 주소 지오코더)
 * 입력 우선 : 1) roadAddress 원문
 *            2) `부산광역시 {sigungu} {umdNm} {jibun}`
 * 검증 게이트: region1이 "부산" AND region2가 해당 sigungu (앞 2글자 비교)
 * 금지       : 건물명 지오코딩 / keyword.json(POI) / 최근접 후보 / 첫 결과 추측
 *
 * ── 신뢰 티어 ────────────────────────────────────────────────────────────
 * A VERIFIED : 도로명 단일 후보 + 게이트 통과 + 지번 교차검증 <= 50m
 * B STRONG   : 도로명 단일 후보 + 게이트 통과 + (교차 50~100m | 교차 불가) | 지번 단독 단일 후보
 * C REVIEW   : 교차 > 100m | 도로명 후보 2건 이상 | 지번 단독 다후보  -> **write 금지**
 * D UNRESOLVED: 신뢰할 결과 없음                                      -> **write 금지**
 *
 * ── write 계약 ───────────────────────────────────────────────────────────
 * - `--apply` 없으면 절대 쓰지 않는다(기본 dry-run)
 * - TIER A/B만, 승인 상한 5,048행을 넘으면 즉시 중단
 * - `latitude`/`longitude` 두 컬럼만. 다른 master 필드는 손대지 않는다
 * - where에 `latitude: null, longitude: null`을 함께 걸어 멱등 + 기존값 덮어쓰기 방지
 * - INSERT/DELETE/schema/index 변경 없음
 *
 * ── 좌표 의미론 ──────────────────────────────────────────────────────────
 * Kakao가 주는 것은 **필지/도로명 기준 좌표**이지 건물 중심이 아니다. 좌표를 실제로 공유하는
 * master는 감사 산출물에 `SITE_LEVEL_COORDINATE`로 표시한다 — **동(棟) 단위 정밀도를
 * 주장하지 않는다.** 이 판정은 지번이 아니라 **최종 좌표**를 기준으로 한다(§3.5 주석 참고).
 *
 * 실행:
 *   dry-run : npx ts-node --compiler-options '{"module":"commonjs"}' scripts/officetel/step5b-coordinate-backfill.ts
 *   apply   : ... step5b-coordinate-backfill.ts --apply
 *   옵션    : --no-resume (manifest 무시하고 전부 재조회)
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { prisma } from '../../src/lib/prisma';

const OUT_DIR = path.resolve(__dirname, '_officetel_master_results');
const MANIFEST = path.join(OUT_DIR, 'step5b-geocode-manifest.json');
const AUDIT = path.join(OUT_DIR, 'step5b-coordinate-audit.json');
const REPORT = path.join(OUT_DIR, 'step5b-report.json');

/** STEP 5A가 확정한 승인 상한. 이 값을 넘기면 즉시 중단한다. */
const APPROVED_MAX_WRITES = 5048;
const EXPECTED = { total: 5056, A: 5007, B: 41, C: 7, D: 1 };

const KEY = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY || '';
// 이 키는 JavaScript 키라 REST 호출 시 KA/Origin 헤더가 없으면 401이다
// (기존 scripts/apartment-score/recover-missing-geocodes.ts와 동일 관례).
const H = {
  Authorization: `KakaoAK ${KEY}`,
  KA: 'sdk/1.0 os/javascript origin/http%3A%2F%2Flocalhost%3A3000',
  Origin: 'http://localhost:3000',
};

const APPLY = process.argv.includes('--apply');
const RESUME = !process.argv.includes('--no-resume');
const DELAY = 120;
const CONCURRENCY = 3;
const WRITE_BATCH = 200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function haversine(a: Pt, b: Pt): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(6371000 * 2 * Math.asin(Math.sqrt(s)));
}

interface Pt { lat: number; lng: number }
interface GeoResult {
  count?: number; addressType?: string; matched?: string;
  region1?: string; region2?: string; pt?: Pt; error?: string;
}

async function addressJson(query: string): Promise<GeoResult> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(query)}&size=5`,
        { headers: H, signal: AbortSignal.timeout(8000) });
      if (res.status === 429) { await sleep(1200 * (attempt + 1)); continue; }
      if (!res.ok) return { error: `HTTP ${res.status}` };
      const data = await res.json();
      const docs = data.documents || [];
      const d = docs[0];
      if (!d) return { count: 0 };
      return {
        count: data.meta?.total_count ?? docs.length,
        addressType: d.address_type,
        matched: d.road_address?.address_name || d.address_name || '',
        region1: d.address?.region_1depth_name || d.road_address?.region_1depth_name || '',
        region2: d.address?.region_2depth_name || d.road_address?.region_2depth_name || '',
        pt: { lat: parseFloat(d.y), lng: parseFloat(d.x) },
      };
    } catch (e) {
      if (attempt === 2) return { error: (e as Error).message };
      await sleep(600 * (attempt + 1));
    }
  }
  return { error: 'retries exhausted' };
}

const reg2 = (a?: string, b?: string) => !!a && !!b && a.slice(0, 2) === b.slice(0, 2);

type Tier = 'A' | 'B' | 'C' | 'D';

/** STEP 5A와 문자 그대로 같은 판정. 여기서 규칙을 바꾸면 승인 범위가 달라진다. */
function classify(sigungu: string, road: GeoResult | null, jibun: GeoResult | null, distance: number | null): { tier: Tier; reason: string } {
  const roadOk = !!road && !road.error && (road.count ?? 0) > 0 && reg2(road.region1, '부산') && (!road.region2 || reg2(road.region2, sigungu));
  const jibunOk = !!jibun && !jibun.error && (jibun.count ?? 0) > 0 && reg2(jibun.region1, '부산') && (!jibun.region2 || reg2(jibun.region2, sigungu));
  const roadSingle = roadOk && road!.count === 1;

  if (!roadOk && !jibunOk) return { tier: 'D', reason: road?.error || jibun?.error || 'NO_TRUSTWORTHY_RESULT' };
  if (roadOk && jibunOk && distance != null && distance > 100) return { tier: 'C', reason: `CROSS_SOURCE_${distance}m` };
  if (roadOk && !roadSingle) return { tier: 'C', reason: `ROAD_MULTI_CANDIDATE_${road!.count}` };
  if (roadSingle && jibunOk && distance != null && distance <= 50) return { tier: 'A', reason: `ROAD_ADDR_XCHECK_${distance}m` };
  if (roadSingle && jibunOk && distance != null && distance <= 100) return { tier: 'B', reason: `ROAD_ADDR_XCHECK_${distance}m` };
  if (roadSingle) return { tier: 'B', reason: 'ROAD_ADDR_NO_XCHECK' };
  if (jibunOk && jibun!.count === 1) return { tier: 'B', reason: 'JIBUN_ONLY_SINGLE' };
  return { tier: 'C', reason: 'JIBUN_ONLY_MULTI' };
}

interface Rec {
  id: number; canonicalKey: string; name: string;
  sggCd: string; sigungu: string; umdNm: string; jibun: string; buildingDong: string | null; roadAddress: string | null;
  tier: Tier; reason: string; distance: number | null;
  query: string | null; matchedAddress: string | null; source: string | null;
  latitude: number | null; longitude: number | null;
  mastersAtAddress: number;
  coordinateSemantics: 'SITE_LEVEL_COORDINATE' | 'PARCEL_LEVEL_COORDINATE';
  applied?: boolean; notAppliedReason?: string;
}

async function main() {
  if (!KEY) throw new Error('ABORT: Kakao key not configured');
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`OFFICETEL V1 STEP 5B — coordinate backfill  [${APPLY ? 'APPLY' : 'DRY-RUN'}]  resume=${RESUME}\n`);

  // ── 0. baseline ─────────────────────────────────────────────────────
  const [base] = await prisma.$queryRawUnsafe<{ masters: number; with_lat: number; with_lng: number; half: number }[]>(
    `SELECT COUNT(*)::int AS masters, COUNT(latitude)::int AS with_lat, COUNT(longitude)::int AS with_lng,
            COUNT(*) FILTER (WHERE (latitude IS NULL) <> (longitude IS NULL))::int AS half
       FROM officetel_masters`);
  console.log(`  baseline: masters=${base.masters} lat=${base.with_lat} lng=${base.with_lng} half-populated=${base.half}`);
  if (base.masters !== EXPECTED.total) throw new Error(`ABORT: master 수가 감사값과 다르다 (${base.masters} vs ${EXPECTED.total})`);
  if (base.half > 0) throw new Error(`ABORT: 반쪽만 채워진 행 ${base.half}건 — 조사 필요`);

  const sgg = await prisma.$queryRawUnsafe<{ sgg_cd: string; sido: string; sigungu: string }[]>(
    `SELECT DISTINCT sgg_cd, sido, sigungu FROM apartment_masters WHERE sgg_cd IS NOT NULL AND sigungu IS NOT NULL`);
  const sggMap = new Map(sgg.map((r) => [r.sgg_cd, r]));

  const groups = await prisma.$queryRawUnsafe<{ sgg_cd: string; normalized_umd_nm: string; normalized_jibun: string; n: number }[]>(
    `SELECT sgg_cd, normalized_umd_nm, normalized_jibun, COUNT(*)::int AS n FROM officetel_masters GROUP BY 1,2,3`);
  const gMap = new Map(groups.map((g) => [`${g.sgg_cd}|${g.normalized_umd_nm}|${g.normalized_jibun}`, g.n]));

  const masters = await prisma.officetelMaster.findMany({
    select: { id: true, canonicalKey: true, officetelName: true, sggCd: true, umdNm: true, normalizedUmdNm: true,
              jibun: true, normalizedJibun: true, buildingDong: true, roadAddress: true, latitude: true, longitude: true },
    orderBy: { id: 'asc' },
  });

  // ── 1. geocode (resumable) ──────────────────────────────────────────
  let cache: Record<string, Rec> = {};
  if (RESUME && fs.existsSync(MANIFEST)) { try { cache = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch { cache = {}; } }
  const cached = Object.keys(cache).length;
  if (cached > 0) console.log(`  manifest resume: ${cached}건은 재조회하지 않는다`);

  const recs: Rec[] = [];
  let cursor = 0, calls = 0, processed = 0;
  const started = Date.now();

  async function worker() {
    while (cursor < masters.length) {
      const m = masters[cursor++];
      const hit = cache[String(m.id)];
      if (hit) { recs.push(hit); continue; }

      const reg = sggMap.get(m.sggCd) ?? { sido: '부산광역시', sigungu: '' };
      const jibunQuery = `${reg.sido} ${reg.sigungu} ${m.umdNm} ${m.jibun}`.trim();

      let road: GeoResult | null = null;
      const roadQ = (m.roadAddress ?? '').trim();
      if (roadQ) { road = await addressJson(roadQ); calls++; await sleep(DELAY); }
      const jibun = await addressJson(jibunQuery); calls++; await sleep(DELAY);

      const distance = road?.pt && jibun?.pt ? haversine(road.pt, jibun.pt) : null;
      const { tier, reason } = classify(reg.sigungu, road, jibun, distance);
      const useRoad = !!(road?.pt && (road.count ?? 0) > 0);
      const chosen = tier === 'D' ? null : (useRoad ? road!.pt! : jibun?.pt ?? null);
      const n = gMap.get(`${m.sggCd}|${m.normalizedUmdNm}|${m.normalizedJibun}`) ?? 1;

      const rec: Rec = {
        id: m.id, canonicalKey: m.canonicalKey, name: m.officetelName ?? '',
        sggCd: m.sggCd, sigungu: reg.sigungu, umdNm: m.umdNm, jibun: m.jibun,
        buildingDong: m.buildingDong, roadAddress: m.roadAddress,
        tier, reason, distance,
        query: chosen ? (useRoad ? roadQ : jibunQuery) : null,
        matchedAddress: chosen ? (useRoad ? road!.matched ?? null : jibun?.matched ?? null) : null,
        source: chosen ? (useRoad ? 'kakao:address.json:road' : 'kakao:address.json:jibun') : null,
        latitude: chosen?.lat ?? null, longitude: chosen?.lng ?? null,
        mastersAtAddress: n,
        // 실제 좌표가 확정된 뒤 아래에서 채운다(지번만으로 판단하면 틀린다 — §7 정정 참고).
        coordinateSemantics: 'PARCEL_LEVEL_COORDINATE',
      };
      cache[String(m.id)] = rec;
      recs.push(rec);
      processed++;
      if (processed % 250 === 0) {
        fs.writeFileSync(MANIFEST, JSON.stringify(cache));
        console.log(`  geocode ${recs.length}/${masters.length} calls=${calls} ${Math.round((Date.now() - started) / 1000)}s`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  fs.writeFileSync(MANIFEST, JSON.stringify(cache));
  recs.sort((a, b) => a.id - b.id);

  // ── 2. dry-run gate ─────────────────────────────────────────────────
  const byTier: Record<string, number> = {};
  for (const r of recs) byTier[r.tier] = (byTier[r.tier] ?? 0) + 1;
  const writable = recs.filter((r) => (r.tier === 'A' || r.tier === 'B') && r.latitude != null && r.longitude != null);
  // provider 오류(HTTP/timeout)와 "정상 응답인데 결과 0건"은 다른 사건이다. 섞지 않는다.
  const providerFailures = recs.filter((r) => /^(HTTP |retries exhausted)/.test(r.reason)).length;
  const noResultRows = recs.filter((r) => r.tier === 'D').length;

  console.log(`\n  tiers: A=${byTier.A ?? 0} B=${byTier.B ?? 0} C=${byTier.C ?? 0} D=${byTier.D ?? 0}  (감사값 A=${EXPECTED.A} B=${EXPECTED.B} C=${EXPECTED.C} D=${EXPECTED.D})`);
  console.log(`  auto-write 대상: ${writable.length} (승인 상한 ${APPROVED_MAX_WRITES})`);
  console.log(`  no-write(C/D): ${recs.length - writable.length}`);

  if (writable.length > APPROVED_MAX_WRITES) {
    throw new Error(`ABORT: auto-write 대상 ${writable.length} > 승인 상한 ${APPROVED_MAX_WRITES}`);
  }
  const badTier = writable.find((r) => r.tier !== 'A' && r.tier !== 'B');
  if (badTier) throw new Error(`ABORT: TIER ${badTier.tier} 가 write 대상에 포함됨 (id=${badTier.id})`);

  // ── 3. apply ────────────────────────────────────────────────────────
  let applied = 0, skippedAlready = 0;
  if (APPLY) {
    console.log('\n  applying...');
    for (let i = 0; i < writable.length; i += WRITE_BATCH) {
      const batch = writable.slice(i, i + WRITE_BATCH);
      const results = await prisma.$transaction(
        batch.map((r) =>
          prisma.officetelMaster.updateMany({
            // 낙관적 조건 — 이미 좌표가 있으면 0행이 되어 덮어쓰지 않는다(멱등).
            where: { id: r.id, latitude: null, longitude: null },
            data: { latitude: r.latitude as number, longitude: r.longitude as number },
          })
        )
      );
      results.forEach((res, k) => {
        if (res.count === 1) { batch[k].applied = true; applied++; }
        else { batch[k].applied = false; batch[k].notAppliedReason = 'ALREADY_HAS_COORDINATES_OR_MISSING'; skippedAlready++; }
      });
      if (applied > APPROVED_MAX_WRITES) throw new Error(`ABORT: 적용 건수가 승인 상한을 넘었다 (${applied})`);
      fs.writeFileSync(MANIFEST, JSON.stringify(cache));
      if ((i / WRITE_BATCH) % 5 === 0) console.log(`    ${Math.min(i + WRITE_BATCH, writable.length)}/${writable.length} applied=${applied}`);
    }
    console.log(`  applied=${applied} skipped(이미 값 있음)=${skippedAlready}`);
  }

  // ── 3.5 좌표 의미론 확정 (§7 정정) ──────────────────────────────────
  //
  // 처음에는 "같은 지번에 master가 2건 이상이면 SITE_LEVEL"로 판단했는데, 적용 후 실측에서
  // 그 규칙이 양방향으로 틀린다는 것을 확인했다:
  //   - 같은 지번이어도 **도로명이 다르면** Kakao가 동별로 다른 좌표를 준다(실측 4건:
  //     대연동 231-55 A/B동 16m, 보수동1가 11-5 101/102동 17m) -> 이들은 부지 대표가 아니다.
  //   - 지번이 달라도 **도로명이 같으면** 같은 좌표를 받는다(실측 4건: 암남동 73-6/73-7
  //     부광빌라, 연산동 578-4/578-21 창성골든빌) -> 이들은 지번이 달라도 부지 대표다.
  // 그래서 플래그는 주소가 아니라 **최종 좌표가 실제로 공유되는가**로 판정한다.
  const coordCount = new Map<string, number>();
  for (const r of recs) {
    if (r.latitude == null || r.longitude == null) continue;
    const k = `${r.latitude.toFixed(6)},${r.longitude.toFixed(6)}`;
    coordCount.set(k, (coordCount.get(k) ?? 0) + 1);
  }
  for (const r of recs) {
    if (r.latitude == null || r.longitude == null) continue;
    const k = `${r.latitude.toFixed(6)},${r.longitude.toFixed(6)}`;
    r.coordinateSemantics = (coordCount.get(k) ?? 1) > 1 ? 'SITE_LEVEL_COORDINATE' : 'PARCEL_LEVEL_COORDINATE';
  }

  // applied 상태는 모드가 아니라 **Production 실제 상태**에서 읽는다 — 재실행해도 산출물이
  // 거짓말하지 않게 한다.
  const live = await prisma.officetelMaster.findMany({ select: { id: true, latitude: true, longitude: true } });
  const liveSet = new Set(live.filter((l) => l.latitude != null && l.longitude != null).map((l) => l.id));
  for (const r of recs) {
    if (r.tier === 'C' || r.tier === 'D') { r.applied = false; r.notAppliedReason = `TIER_${r.tier}_NOT_APPROVED_FOR_AUTO_WRITE`; continue; }
    r.applied = liveSet.has(r.id);
    r.notAppliedReason = r.applied ? undefined : (APPLY ? 'UPDATE_MATCHED_0_ROWS' : 'DRY_RUN');
  }

  // ── 4. 산출물 ───────────────────────────────────────────────────────
  fs.writeFileSync(AUDIT, JSON.stringify({
    generatedAt: new Date().toISOString(), mode: APPLY ? 'apply' : 'dry-run',
    provider: 'kakao:address.json', approvedMaxWrites: APPROVED_MAX_WRITES,
    rows: recs,
  }, null, 1));

  const excluded = recs.filter((r) => r.tier === 'C' || r.tier === 'D')
    .map((r) => ({ id: r.id, name: r.name || `${r.umdNm} ${r.jibun} 오피스텔`, address: r.roadAddress ?? `${r.umdNm} ${r.jibun}`, tier: r.tier, reason: r.reason, distance: r.distance }));

  const report = {
    generatedAt: new Date().toISOString(), mode: APPLY ? 'apply' : 'dry-run',
    totalMasters: recs.length, byTier, writableCount: writable.length,
    approvedMaxWrites: APPROVED_MAX_WRITES, applied, skippedAlready,
    providerFailures, noResultRows,
    siteLevelCoordinateRows: recs.filter((r) => r.coordinateSemantics === 'SITE_LEVEL_COORDINATE').length,
    appliedInProduction: recs.filter((r) => r.applied).length,
    excluded,
    apiCalls: calls, runtimeSec: Math.round((Date.now() - started) / 1000),
  };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 1));
  console.log(`\n  audit  → ${AUDIT}`);
  console.log(`  report → ${REPORT}`);
  console.log(JSON.stringify({ byTier, writable: writable.length, applied, excluded: excluded.length }, null, 1));
}

main().catch((e) => { console.error('FAILED', e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
