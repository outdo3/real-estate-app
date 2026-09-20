/**
 * BUILDING_LEDGER_UNKNOWN_SOURCE_TRUST_AUDIT_V1 — `basic_spec_source = UNKNOWN`으로 남은
 * 부산 master를 전수 감사한다 (STRICT READ ONLY).
 *
 * 배경: 앞선 census(2,714건)는 `BUILDINGHUB_TITLE` / `GENERAL_TITLE`만 대상이었다. UNKNOWN
 * 724건은 그 밖에 있었고, 상당수가 건축물대장 파생값을 이미 들고 있다. 같은 페이징 결함의
 * 영향을 받았을 수 있으므로 **현재 safe pager + 이미 확정된 field policy**로 다시 평가한다.
 *
 * 정책을 새로 만들지 않는다 — households는 POLICY B, parking은 자동 규칙 없음, FAR/BCR은
 * 다건 상이 시 판정 금지, roadAddress는 단일 값일 때만, 전부 기존 모듈을 그대로 호출한다.
 *
 * rate limit는 실패가 아니라 대기 신호다. 미해결 조회 실패가 1건이라도 남으면 **STOP** —
 * 못 읽은 필지를 "대상 아님"으로 처리하면 census가 조용히 축소된다.
 *
 * DB write 0 · 대장 GET만.
 *
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/audit-ledger-unknown-source-trust.ts [--interval=420]
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/audit-ledger-unknown-source-trust.ts --retry=tmp/unknown-source/raw.json
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { fetchAllLedgerPages } from '../src/lib/building-ledger-pager';
import { isResidentialRecord, decideRoadAddress, jibunToBunJi } from './busan-ledger-auto-safe-logic';
import { classifyParking, titleParking, valuePattern } from './audit-ledger-field-policy';
import { policyBOutcome } from './apply-busan-zero-household-policy-b';

const OUT = path.resolve(__dirname, '../tmp/unknown-source');
const cleanKey = () => encodeURIComponent(decodeURIComponent((process.env.DATA_GO_KR_API_KEY || '').trim().replace(/['"]/g, '')));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// ───────────────────────── provenance 복원 (추정은 추정이라고 적는다) ─────────────────────────

export type Provenance =
  | 'LEGACY_BUILDING_LEDGER_TITLE' | 'LEGACY_BUILDING_LEDGER_RECAP'
  | 'LIVE_HELPER_CACHE_DERIVED' | 'HISTORICAL_IMPORT' | 'MANUAL_OR_OTHER' | 'UNKNOWN_REMAINS';

/**
 * 저장된 값의 **모양**으로 출처를 복원한다. 확정이 아니라 분류다.
 *
 * 관찰된 구분:
 *   - `mgmBldrgstPk` 22자리 = 총괄표제부 계열, 9~10자리 = 표제부 계열
 *   - 총괄표제부 파생값만 갖는 필드: `main_building_count`(mainBldCnt) — 표제부에는 없다
 *   - 현재 backfill 경로는 FAR/BCR을 함께 채운다. PK는 있는데 FAR/BCR이 전혀 없으면
 *     지금 경로의 산출물이 아니다
 */
export function reconstructProvenance(m: {
  mgmBldrgstPk: string | null; mainBuildingCount: number | null;
  far: number | null; bcr: number | null; households: number | null; parking: number | null;
}): { provenance: Provenance; evidence: string } {
  const pk = (m.mgmBldrgstPk ?? '').trim();
  const pkLen = pk.length;
  if (pkLen >= 20) {
    return { provenance: 'LEGACY_BUILDING_LEDGER_RECAP', evidence: `mgmBldrgstPk ${pkLen}자리 = 총괄표제부 계열` };
  }
  if (pkLen >= 8) {
    // 표제부 계열 PK. 지금 backfill은 FAR/BCR을 함께 채우므로, 둘 다 없으면 구 경로다.
    const noRatios = m.far == null && m.bcr == null;
    return {
      provenance: 'LEGACY_BUILDING_LEDGER_TITLE',
      evidence: `mgmBldrgstPk ${pkLen}자리 = 표제부 계열${noRatios ? ' · FAR/BCR 없음 → 현재 backfill 경로의 산출물이 아님' : ''}`,
    };
  }
  if (m.mainBuildingCount != null) {
    return { provenance: 'LEGACY_BUILDING_LEDGER_RECAP', evidence: 'mainBuildingCount 보유 — 총괄표제부에만 있는 필드' };
  }
  if (m.households != null || m.parking != null || m.far != null || m.bcr != null) {
    return { provenance: 'HISTORICAL_IMPORT', evidence: 'PK 없이 대장성 값만 보유 — 출처 미기록 구 import' };
  }
  return { provenance: 'UNKNOWN_REMAINS', evidence: '복원 근거 없음' };
}

export function bucketOf(n: number): string {
  if (n <= 1) return '1';
  if (n <= 5) return '2-5';
  if (n <= 10) return '6-10';
  if (n <= 20) return '11-20';
  return '21+';
}

// ───────────────────────── 조회 ─────────────────────────

let apiCalls = 0, rateLimited = 0, backoffWaits = 0;

async function fetchLot(sgg: string, umd: string, bun: string, ji: string, intervalMs: number) {
  return fetchAllLedgerPages(async (pageNo, numOfRows) => {
    await sleep(intervalMs);
    apiCalls++;
    const url = `https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo?serviceKey=${cleanKey()}&sigunguCd=${sgg}&bjdongCd=${umd}&platGbCd=0&bun=${bun}&ji=${ji}&numOfRows=${numOfRows}&pageNo=${pageNo}&_type=json`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const text = await res.text();
      if (!res.ok || /LIMITED_NUMBER_OF_SERVICE_REQUESTS/.test(text)) {
        if (res.status === 429 || res.status === 503 || /LIMITED_NUMBER/.test(text)) { rateLimited++; return { kind: 'RATE_LIMITED', detail: `http=${res.status}` } as const; }
        return { kind: 'ERROR', detail: `http=${res.status}` } as const;
      }
      const j = JSON.parse(text);
      if (j?.response?.header?.resultCode && j.response.header.resultCode !== '00') return { kind: 'ERROR', detail: 'resultCode' } as const;
      const b = j?.response?.body; const raw = b?.items?.item;
      const items = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
      const t = Number(b?.totalCount);
      return { kind: 'OK', items, totalCount: Number.isFinite(t) ? t : items.length } as const;
    } catch (e) { return { kind: 'ERROR', detail: (e as Error)?.name ?? 'error' } as const; }
  });
}

async function fetchWithBackoff(sgg: string, umd: string, bun: string, ji: string, intervalMs: number) {
  let last = await fetchLot(sgg, umd, bun, ji, intervalMs);
  for (let i = 0; i < 5 && (last.status === 'RATE_LIMITED' || last.status === 'ERROR'); i++) {
    backoffWaits++; await sleep(2000 * (i + 1));
    last = await fetchLot(sgg, umd, bun, ji, intervalMs);
  }
  return last;
}

async function main() {
  const interval = Number(process.argv.find((a) => a.startsWith('--interval='))?.split('=')[1] ?? 420);
  const retry = process.argv.find((a) => a.startsWith('--retry='))?.split('=')[1];
  fs.mkdirSync(OUT, { recursive: true });

  const { PrismaClient } = await import('@prisma/client');
  const { assertProductionDbAccessAllowed } = await import('./_prod-db-guard');
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'audit-ledger-unknown-source-trust.ts');
  const prisma = new PrismaClient();

  const db = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const masters = await tx.$queryRawUnsafe<Record<string, any>[]>(
      `SELECT apt_seq, name, sgg_cd, umd_name, umd_cd, jibun, basic_spec_source,
              total_households, parking_count, parking_per_household, main_building_count,
              use_approval_date, floor_area_ratio, building_coverage_ratio, road_address,
              mgm_bldrgst_pk, latitude, longitude, created_at, updated_at
       FROM apartment_masters
       WHERE sgg_cd LIKE '26%' AND basic_spec_source = 'UNKNOWN'
       ORDER BY apt_seq`);
    const cache = await tx.$queryRawUnsafe<Record<string, any>[]>(
      `SELECT lawd_cd, dong, jibun, total_households,
              (parking_count IS NOT NULL AND far IS NOT NULL AND bcr IS NOT NULL AND approval_date IS NOT NULL) AS gate
       FROM apartments WHERE lawd_cd IS NOT NULL`);
    return { masters, cache };
  }, { timeout: 600_000 });
  console.log(`[DB] 부산 UNKNOWN master ${db.masters.length} · apartments 캐시 ${db.cache.length}`);
  await prisma.$disconnect();

  const cacheByKey = new Map(db.cache.map((c) => [`${c.lawd_cd}|${c.dong}|${c.jibun}`, c]));

  let rows: Record<string, any>[] = [];
  let failures: string[] = [];
  let scanned = 0;

  let pool = db.masters;
  if (retry && fs.existsSync(retry)) {
    const prev = JSON.parse(fs.readFileSync(retry, 'utf8'));
    const failed = new Set<string>(prev.failures ?? []);
    pool = db.masters.filter((m) => failed.has(m.apt_seq));
    rows = prev.rows; scanned = prev.scanned; apiCalls = prev.apiCalls;
    console.log(`[RETRY] ${retry} — 조회실패 ${pool.length}건만 재조회(기존 rows ${rows.length})`);
  }

  for (const m of pool) {
    scanned++;
    if (scanned % 100 === 0) console.log(`  ...${scanned} (calls=${apiCalls}, rows=${rows.length}, 실패 ${failures.length})`);
    const stored = {
      households: m.total_households == null ? null : Number(m.total_households),
      parking: m.parking_count == null ? null : Number(m.parking_count),
      pph: m.parking_per_household == null ? null : Number(m.parking_per_household),
      far: m.floor_area_ratio == null ? null : Number(m.floor_area_ratio),
      bcr: m.building_coverage_ratio == null ? null : Number(m.building_coverage_ratio),
      approvalDate: m.use_approval_date ?? null,
      roadAddress: m.road_address ?? null,
      buildingCount: m.main_building_count == null ? null : Number(m.main_building_count),
      mgmBldrgstPk: m.mgm_bldrgst_pk ?? null,
      hasCoords: m.latitude != null && m.longitude != null,
    };
    const prov = reconstructProvenance({
      mgmBldrgstPk: stored.mgmBldrgstPk, mainBuildingCount: stored.buildingCount,
      far: stored.far, bcr: stored.bcr, households: stored.households, parking: stored.parking,
    });
    const ck = `${m.sgg_cd}|${m.umd_name}|${m.jibun}`;
    const c = cacheByKey.get(ck);
    const base = {
      aptSeq: m.apt_seq, name: m.name, sgg: m.sgg_cd, dong: m.umd_name, jibun: m.jibun,
      createdAt: m.created_at, updatedAt: m.updated_at,
      stored, provenance: prov.provenance, provenanceEvidence: prov.evidence,
      inCache: !!c, cacheTier1: !!c && !!c.gate,
      cacheHouseholds: c?.total_households == null ? null : Number(c.total_households),
    };

    const bj = jibunToBunJi(String(m.jibun ?? ''));
    if (!bj || !m.umd_cd) { rows = rows.filter((r) => r.aptSeq !== m.apt_seq); rows.push({ ...base, fetch: 'NO_LOT_KEY' }); continue; }
    const paged = await fetchWithBackoff(m.sgg_cd, m.umd_cd, bj.bun, bj.ji, interval);
    failures = failures.filter((f) => f !== m.apt_seq);
    rows = rows.filter((r) => r.aptSeq !== m.apt_seq);

    if (paged.status === 'EMPTY') { rows.push({ ...base, fetch: 'EMPTY', totalCount: 0 }); continue; }
    if (paged.status !== 'COMPLETE') { failures.push(m.apt_seq); rows.push({ ...base, fetch: paged.status }); continue; }

    const recs = paged.items as Record<string, unknown>[];
    const residential = recs.filter(isResidentialRecord);
    const zeros = residential.filter((r) => num(r.hhldCnt) === 0);
    const b = policyBOutcome(recs);
    const road = decideRoadAddress(recs, stored.roadAddress);
    const parkVals = recs.map(titleParking);
    const resParkVals = residential.map(titleParking);

    rows.push({
      ...base, fetch: 'COMPLETE', totalCount: paged.totalCount, bucket: bucketOf(paged.totalCount ?? 0),
      records: recs.length, residentialRecords: residential.length, zeroHouseholdRecords: zeros.length,
      safeHouseholds: b.newHouseholds, householdsBlocked: b.blocked, zerosExcluded: b.excluded,
      recordHouseholds: recs.map((r) => num(r.hhldCnt)),
      roadVerdict: road.verdict, roadNew: road.newValue,
      roadDistinct: [...new Set(recs.map((r) => String(r.newPlatPlc ?? '').trim()).filter(Boolean))].length,
      parkingPattern: classifyParking(resParkVals.length ? resParkVals : parkVals),
      parkingDistinctNonZero: [...new Set(parkVals.filter((v) => v > 0))],
      farPattern: valuePattern(recs.map((r) => (Number(r.vlRat) || 0) || null)),
      bcrPattern: valuePattern(recs.map((r) => (Number(r.bcRat) || 0) || null)),
      approvalPattern: valuePattern(recs.map((r) => String(r.useAprDay ?? '') || null)),
      approvalDistinct: [...new Set(recs.map((r) => String(r.useAprDay ?? '').trim()).filter(Boolean))],
    });
  }

  fs.writeFileSync(path.join(OUT, 'raw.json'), JSON.stringify({
    at: new Date().toISOString(), readOnly: true, dbWrites: 0,
    scanned, apiCalls, rateLimited, backoffWaits, failures, rows,
  }, null, 2));
  console.log(JSON.stringify({ scanned, apiCalls, rateLimited, backoffWaits, unresolvedFetchFailures: failures.length, rows: rows.length }, null, 2));
  if (failures.length) { console.error(`[STOP] 조회 실패 ${failures.length}건 미해결 — --retry로 재조회 필요`); process.exit(2); }
}

if (require.main === module) main().catch((e) => { console.error(String((e as Error)?.stack ?? e)); process.exit(1); });
