/**
 * BUSAN_MASTER_COORDINATE_ENRICHMENT_APPLY_V1 — 부산 master의 **좌표만** 채운다.
 *
 * 승인 범위(사용자 승인 완료): 부산 **정확히 35행**의 `latitude` · `longitude` · `geocodeQuality`.
 * 그 밖의 어떤 컬럼도 건드리지 않는다(aptSeq·이름·주소·세대수·주차·대장·점수·createdAt 전부 불변).
 * 서울은 한 행도 건드리지 않는다.
 *
 * 안전장치(하나라도 어긋나면 쓰기 전에 멈춘다):
 *   1. 후보를 **현재 Production 상태에서 다시 만든다**(감사 결과를 그대로 믿지 않는다)
 *   2. 35개 전부 Kakao 정방향+역방향 **재검증** — 승인 규칙 그대로, 완화 없음
 *   3. 기존 좌표와 충돌 0 확인
 *   4. rollback artifact를 **쓰기 전에** 남긴다
 *   5. UPDATE는 `aptSeq` + `latitude IS NULL AND longitude IS NULL` 조건 — 그 사이 다른 경로가
 *      채운 행은 건드리지 않는다(blind bulk update 금지)
 *
 * 기본은 DRY RUN. 실제 쓰기는 `--apply` + `ALLOW_PROD_DB_WRITE=1` + `ALLOW_PROD_DB_READ=1` +
 * `--expect-rows=35`가 모두 맞을 때만.
 *
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/enrich-busan-master-coordinates.ts
 *   ALLOW_PROD_DB_READ=1 ALLOW_PROD_DB_WRITE=1 npx tsx scripts/enrich-busan-master-coordinates.ts --apply --expect-rows=35
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { matchExactLotFor, verifyReverseLotFor, parseLot } from './audit-master-coordinate-geocode-dryrun';

const OUT = path.resolve(__dirname, '../tmp/busan-coordinate-enrichment');

// Kakao REST(local API)는 **서버용 REST 키**를 쓴다. 클라이언트에 노출되는 JS 키
// (NEXT_PUBLIC_*)는 이 endpoint에서 401이고, 애초에 서버 호출에 쓸 값이 아니다.
// 값은 절대 출력하지 않는다 — 어떤 env 이름을 썼는지만 기록한다.
const KAKAO_KEY = process.env.KAKAO_CLIENT_ID || process.env.KAKAO_REST_API_KEY || '';
const KAKAO_KEY_ENV = process.env.KAKAO_CLIENT_ID ? 'KAKAO_CLIENT_ID'
  : process.env.KAKAO_REST_API_KEY ? 'KAKAO_REST_API_KEY' : '(none)';
const headers = { Authorization: `KakaoAK ${KAKAO_KEY}` };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let kakaoCalls = 0;

async function kakao(url: string): Promise<any | null> {
  for (let i = 0; i < 3; i++) {
    kakaoCalls++;
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
      if (res.status === 429) { await sleep(700 * (i + 1)); continue; }
      if (!res.ok) return null;
      return await res.json();
    } catch { if (i === 2) return null; await sleep(500); }
  }
  return null;
}

export interface Candidate {
  aptSeq: string; id: number; name: string; sigungu: string; dong: string; jibun: string;
}

/** 승인된 규칙 그대로 한 후보를 재검증한다. VERIFIED가 아니면 좌표를 만들지 않는다. */
export async function revalidate(c: Candidate) {
  const expected = { sidoPrefix: '부산', districtName: c.sigungu, dong: c.dong, jibun: c.jibun };
  const query = `부산 ${c.sigungu} ${c.dong} ${c.jibun}`;
  const f = await kakao(`https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(query)}&analyze_type=exact`);
  if (!f) return { ...c, query, verdict: 'ERROR' as const, detail: 'forward failed' };
  const docs = f?.documents ?? [];
  const fm = matchExactLotFor(docs, expected);
  if (fm.status !== 'EXACT') {
    return { ...c, query, verdict: 'REJECTED' as const, forwardStatus: fm.status, forwardHits: fm.hits, resultCount: docs.length };
  }
  await sleep(120);
  const r = await kakao(`https://dapi.kakao.com/v2/local/geo/coord2address.json?x=${fm.lng}&y=${fm.lat}`);
  if (!r) return { ...c, query, verdict: 'ERROR' as const, detail: 'reverse failed' };
  const doc = (r?.documents ?? [])[0] ?? null;
  const rv = verifyReverseLotFor(doc, expected);
  return {
    ...c, query, resultCount: docs.length, forwardStatus: 'EXACT' as const,
    lat: fm.lat!, lng: fm.lng!, forwardAddress: fm.address,
    reverseAddress: rv.reverseAddress, reverseReason: rv.reason,
    reverseDistrict: doc?.address?.region_2depth_name ?? null,
    reverseDong: doc?.address?.region_3depth_name ?? null,
    verdict: rv.status === 'VERIFIED' ? ('VERIFIED_EXACT' as const) : ('REJECTED' as const),
  };
}

function die(msg: string): never {
  console.error(`\n[STOP] ${msg}\n`);
  process.exit(1);
}

async function main() {
  const apply = process.argv.includes('--apply');
  const expectRows = Number(process.argv.find((a) => a.startsWith('--expect-rows='))?.split('=')[1] ?? NaN);
  const { PrismaClient } = await import('@prisma/client');
  const { assertProductionDbAccessAllowed } = await import('./_prod-db-guard');
  assertProductionDbAccessAllowed(apply ? 'BACKFILL' : 'DIAGNOSTIC', 'enrich-busan-master-coordinates.ts');
  if (KAKAO_KEY_ENV === '(none)') die('서버용 Kakao REST 키가 없다(KAKAO_CLIENT_ID / KAKAO_REST_API_KEY).');
  const prisma = new PrismaClient();
  fs.mkdirSync(OUT, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  // ── §3 후보 재생성: 감사 결과가 아니라 **현재 Production 상태**에서 ──
  const nullCoord = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    return tx.$queryRawUnsafe<any[]>(
      `SELECT id, apt_seq, name, sigungu, umd_name, jibun, latitude, longitude, geocode_quality
       FROM apartment_masters
       WHERE sgg_cd LIKE '26%' AND latitude IS NULL AND longitude IS NULL
       ORDER BY apt_seq`);
  }, { timeout: 300_000 });

  const candidates: Candidate[] = nullCoord
    .filter((m) => m.apt_seq && m.sigungu && m.umd_name && parseLot(m.jibun))
    .map((m) => ({ aptSeq: m.apt_seq, id: m.id, name: m.name, sigungu: m.sigungu, dong: m.umd_name, jibun: String(m.jibun) }));

  console.log(`[REBUILD] 부산 좌표 없음 ${nullCoord.length}행 · 정확 필지 있는 후보 ${candidates.length}`);

  // ── §4 재검증 ──
  const checked: any[] = [];
  for (const c of candidates) { checked.push(await revalidate(c)); await sleep(120); }
  const verified = checked.filter((r) => r.verdict === 'VERIFIED_EXACT');
  const rejected = checked.filter((r) => r.verdict !== 'VERIFIED_EXACT');
  console.log(`[REVALIDATE] VERIFIED_EXACT ${verified.length} · 그 밖 ${rejected.length} (Kakao ${kakaoCalls}회)`);
  fs.writeFileSync(path.join(OUT, `revalidation-${stamp}.json`), JSON.stringify({ at: new Date().toISOString(), kakaoKeyEnv: KAKAO_KEY_ENV, kakaoCalls, checked }, null, 2));

  if (!Number.isFinite(expectRows) && apply) die('--expect-rows=<n>이 필요하다.');
  if (apply && verified.length !== expectRows) die(`승인 행 수 불일치: VERIFIED ${verified.length} ≠ --expect-rows ${expectRows}. 쓰지 않는다.`);

  // ── §5 좌표 충돌 ──
  const existing = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    return tx.$queryRawUnsafe<any[]>(
      `SELECT apt_seq, name, umd_name, jibun, latitude, longitude FROM apartment_masters WHERE latitude IS NOT NULL`);
  }, { timeout: 300_000 });
  const ckey = (lat: number, lng: number) => `${lat.toFixed(6)}|${lng.toFixed(6)}`;
  const byCoord = new Map<string, any[]>();
  for (const m of existing) (byCoord.get(ckey(m.latitude, m.longitude)) ?? byCoord.set(ckey(m.latitude, m.longitude), []).get(ckey(m.latitude, m.longitude))!).push(m);
  const collisions = verified.flatMap((v) => (byCoord.get(ckey(v.lat, v.lng)) ?? []).map((m) => ({
    candidate: v.aptSeq, candidateLot: `${v.dong} ${v.jibun}`, existing: m.apt_seq, existingLot: `${m.umd_name} ${m.jibun}`,
    sameLot: m.umd_name === v.dong && String(m.jibun) === String(v.jibun),
  })));
  console.log(`[COLLISION] 기존 좌표와 완전 일치 ${collisions.length}건`);
  if (collisions.some((c) => !c.sameLot)) die(`같은 필지 증거 없는 좌표 충돌 ${collisions.filter((c) => !c.sameLot).length}건 — 쓰지 않는다.`);

  // ── §6 rollback artifact (쓰기 **전에**) ──
  const rollback = verified.map((v) => ({
    id: v.id, aptSeq: v.aptSeq, name: v.name,
    oldLatitude: null as number | null, oldLongitude: null as number | null,
    oldGeocodeQuality: nullCoord.find((m) => m.apt_seq === v.aptSeq)?.geocode_quality ?? null,
    newLatitude: v.lat, newLongitude: v.lng, newGeocodeQuality: 'exact',
  }));
  const rollbackFile = path.join(OUT, `rollback-${stamp}.json`);
  fs.writeFileSync(rollbackFile, JSON.stringify({
    at: new Date().toISOString(), note: '되돌리려면 아래 aptSeq들의 latitude/longitude를 NULL로, geocodeQuality를 oldGeocodeQuality로 되돌린다.',
    sql: `UPDATE apartment_masters SET latitude = NULL, longitude = NULL, geocode_quality = NULL WHERE apt_seq IN (${rollback.map((r) => `'${r.aptSeq}'`).join(', ')});`,
    rows: rollback,
  }, null, 2));
  console.log(`[ROLLBACK] ${rollbackFile}`);

  // ── §7 dry-run 요약 ──
  const before = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    return (await tx.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::int AS masters, COUNT(latitude)::int AS with_coords,
              COUNT(*) FILTER (WHERE latitude IS NULL)::int AS null_coords
       FROM apartment_masters WHERE sgg_cd LIKE '26%'`))[0];
  }, { timeout: 300_000 });
  const plan = {
    targetRows: verified.length, latitudeUpdates: verified.length, longitudeUpdates: verified.length,
    geocodeQualityUpdates: verified.length, otherFieldChanges: 0,
    busanBefore: before, expectedAfter: { masters: before.masters, with_coords: before.with_coords + verified.length, null_coords: before.null_coords - verified.length },
  };
  console.log('[PLAN]', JSON.stringify(plan));

  if (!apply) {
    fs.writeFileSync(path.join(OUT, `dryrun-${stamp}.json`), JSON.stringify({ plan, verified, rejected }, null, 2));
    console.log('[DRY RUN] 쓰기 0 — --apply 없이 종료');
    await prisma.$disconnect();
    return;
  }

  // ── §8 UPDATE — 승인 컬럼 3개만, 행마다 latitude/longitude가 여전히 NULL일 때만 ──
  const applied: any[] = [];
  await prisma.$transaction(async (tx) => {
    for (const v of verified) {
      const n = await tx.$executeRawUnsafe(
        `UPDATE apartment_masters SET latitude = $1, longitude = $2, geocode_quality = 'exact'
         WHERE apt_seq = $3 AND latitude IS NULL AND longitude IS NULL`,
        v.lat, v.lng, v.aptSeq);
      applied.push({ aptSeq: v.aptSeq, name: v.name, updated: n, lat: v.lat, lng: v.lng });
    }
  }, { timeout: 300_000 });
  const updatedTotal = applied.reduce((s, a) => s + a.updated, 0);
  console.log(`[APPLIED] UPDATE 영향 행 ${updatedTotal} (대상 ${verified.length})`);

  // ── §9 사후 검증 ──
  const after = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const busan = (await tx.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::int AS masters, COUNT(latitude)::int AS with_coords,
              COUNT(*) FILTER (WHERE latitude IS NULL)::int AS null_coords
       FROM apartment_masters WHERE sgg_cd LIKE '26%'`))[0];
    const seoul = (await tx.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::int AS masters, COUNT(latitude)::int AS with_coords,
              COUNT(*) FILTER (WHERE latitude IS NULL)::int AS null_coords
       FROM apartment_masters WHERE sgg_cd LIKE '11%'`))[0];
    const targets = await tx.$queryRawUnsafe<any[]>(
      `SELECT apt_seq, latitude, longitude, geocode_quality FROM apartment_masters WHERE apt_seq = ANY($1::text[])`,
      verified.map((v) => v.aptSeq));
    const invalid = targets.filter((t) => t.latitude == null || t.longitude == null || t.latitude < 33 || t.latitude > 39 || t.longitude < 124 || t.longitude > 132);
    return { busan, seoul, targetsFilled: targets.filter((t) => t.latitude != null).length, invalid: invalid.length, badQuality: targets.filter((t) => t.geocode_quality !== 'exact').length };
  }, { timeout: 300_000 });
  console.log('[VERIFY]', JSON.stringify(after));
  fs.writeFileSync(path.join(OUT, `applied-${stamp}.json`), JSON.stringify({ at: new Date().toISOString(), plan, updatedTotal, applied, after, rollbackFile }, null, 2));
  await prisma.$disconnect();
}

if (require.main === module) main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
