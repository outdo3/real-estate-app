/**
 * BUILDING_LEDGER_FIELD_POLICY_V1 — 필드별 authoritative source를 **실측 패턴으로** 확정하고,
 * 영향받은 부산 master를 필드 단위로 재분류한다 (STRICT READ ONLY).
 *
 * 앞 STEP(BUILDING_LEDGER_PAGINATION_FIX_V1)에서 확인된 것:
 *   - 표제부(getBrTitleInfo)는 **동 1개** 단위, 총괄표제부(getBrRecapTitleInfo)는 **단지 전체** 집계
 *   - 세대수는 동마다 제 값이지만, 주차는 단지 총량이 레코드마다 **반복**된다(합산하면 오류)
 * 이 스크립트는 그 관찰을 전수로 검증하고 필드마다 안전한 규칙이 있는지 판정한다.
 *
 * DB write 0 · 대장 GET만.
 *
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/audit-ledger-field-policy.ts [--interval=350]
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { fetchAllLedgerPages } from '../src/lib/building-ledger-pager';
import { isNumberedBuildingUnit } from '../src/lib/apt-building-info';

const OUT = path.resolve(__dirname, '../tmp/building-ledger-paging');
const cleanKey = () => encodeURIComponent(decodeURIComponent((process.env.DATA_GO_KR_API_KEY || '').trim().replace(/['"]/g, '')));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let calls = 0;

/** 주거 세대를 갖는 레코드인가 — **공식 주용도 코드명**으로만 판정한다(이름 추측 금지). */
export function isResidentialRecord(r: any): boolean {
  return String(r?.mainPurpsCdNm ?? '').trim() === '공동주택';
}

/** 표제부 4필드 합(옥내외 × 자주/기계식) — 기존 코드와 같은 정의. */
export function titleParking(r: any): number {
  return ['indrAutoUtcnt', 'indrMechUtcnt', 'oudrAutoUtcnt', 'oudrMechUtcnt']
    .reduce((s, k) => s + (Number(r?.[k]) || 0), 0);
}

export type ParkingPattern = 'SAME_REPEATED_TOTAL' | 'DONG_LEVEL_SUMMABLE' | 'MIXED' | 'ALL_ZERO' | 'SINGLE';

/**
 * 주차 패턴 판정. 0이 아닌 값들이 **전부 같으면** 단지 총량이 반복된 것(합산 금지).
 * 서로 다르면 동 단위 값일 가능성(합산 후보) — 단 섞여 있으면 MIXED로 두고 자동 판단하지 않는다.
 */
export function classifyParking(vals: number[]): ParkingPattern {
  if (vals.length <= 1) return 'SINGLE';
  const nz = vals.filter((v) => v > 0);
  if (nz.length === 0) return 'ALL_ZERO';
  const uniq = new Set(nz);
  if (uniq.size === 1) return nz.length === vals.length ? 'SAME_REPEATED_TOTAL' : 'MIXED';
  return 'DONG_LEVEL_SUMMABLE';
}

/** 값 집합이 전부 같은지 / 다른지 — FAR·BCR·승인일 판정용. */
export function valuePattern(vals: (string | number | null)[]): 'ALL_SAME' | 'DIVERGENT' | 'ALL_EMPTY' | 'SINGLE' {
  const v = vals.filter((x) => x !== null && x !== '' && x !== 0 && x !== '0');
  if (vals.length <= 1) return 'SINGLE';
  if (v.length === 0) return 'ALL_EMPTY';
  return new Set(v.map(String)).size === 1 ? 'ALL_SAME' : 'DIVERGENT';
}

async function fetchLot(op: string, sgg: string, umd: string, bun: string, ji: string, interval: number) {
  return fetchAllLedgerPages(async (pageNo, numOfRows) => {
    await sleep(interval);
    calls++;
    const url = `https://apis.data.go.kr/1613000/BldRgstHubService/${op}?serviceKey=${cleanKey()}&sigunguCd=${sgg}&bjdongCd=${umd}&platGbCd=0&bun=${bun}&ji=${ji}&numOfRows=${numOfRows}&pageNo=${pageNo}&_type=json`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const text = await res.text();
      if (!res.ok) return { kind: res.status === 429 ? 'RATE_LIMITED' : 'ERROR', detail: `http=${res.status}` } as const;
      const j = JSON.parse(text);
      if (j?.response?.header?.resultCode && j.response.header.resultCode !== '00') return { kind: 'ERROR', detail: 'resultCode' } as const;
      const b = j?.response?.body; const raw = b?.items?.item;
      const items = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
      const t = Number(b?.totalCount);
      return { kind: 'OK', items, totalCount: Number.isFinite(t) ? t : items.length } as const;
    } catch { return { kind: 'ERROR', detail: 'err' } as const; }
  });
}

const bunJi = (j: string) => { const m = /^(\d+)(?:-(\d+))?$/.exec((j ?? '').trim()); return m ? { bun: String(Number(m[1])).padStart(4, '0'), ji: String(m[2] ? Number(m[2]) : 0).padStart(4, '0') } : null; };

async function main() {
  const interval = Number(process.argv.find((a) => a.startsWith('--interval='))?.split('=')[1] ?? 350);
  const { PrismaClient } = await import('@prisma/client');
  const { assertProductionDbAccessAllowed } = await import('./_prod-db-guard');
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'audit-ledger-field-policy.ts');
  const prisma = new PrismaClient();

  const prev = JSON.parse(fs.readFileSync(path.join(OUT, 'busan-impact.json'), 'utf8'));
  const affected = prev.results.filter((r: any) => r.verdict === 'NOW_WITHHELD_MULTI_RECORD' || r.verdict === 'NOW_WITHHELD_OTHER');

  const stored = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const m = await tx.$queryRawUnsafe<any[]>(
      `SELECT apt_seq, name, sgg_cd, umd_name, umd_cd, jibun, basic_spec_source,
              total_households, parking_count, main_building_count, use_approval_date,
              floor_area_ratio, building_coverage_ratio, road_address, mgm_bldrgst_pk
       FROM apartment_masters WHERE apt_seq = ANY($1::text[])`, affected.map((a: any) => a.aptSeq));
    // §11 캐시 겹침
    const cache = await tx.$queryRawUnsafe<any[]>(
      `SELECT lawd_cd, dong, jibun, total_households, parking_count, far, bcr, approval_date FROM apartments WHERE lawd_cd IS NOT NULL`);
    return { m, cache };
  }, { timeout: 300_000 });
  await prisma.$disconnect();
  const bySeq = new Map(stored.m.map((x) => [x.apt_seq, x]));
  const cacheKey = new Set(stored.cache.map((c) => `${c.lawd_cd}|${c.dong}|${c.jibun}`));

  const rows: any[] = [];
  for (const a of affected) {
    const m = bySeq.get(a.aptSeq);
    if (!m) continue;
    const bj = bunJi(String(m.jibun ?? ''));
    if (!bj || !m.umd_cd) continue;
    const paged = await fetchLot('getBrTitleInfo', m.sgg_cd, m.umd_cd, bj.bun, bj.ji, interval);
    if (paged.status !== 'COMPLETE') { rows.push({ aptSeq: m.apt_seq, name: m.name, fetch: paged.status }); continue; }
    const recs = paged.items as any[];
    const res = recs.filter(isResidentialRecord);
    const parkVals = recs.map(titleParking);
    const resParkVals = res.map(titleParking);

    rows.push({
      aptSeq: m.apt_seq, name: m.name, sgg: m.sgg_cd, dong: m.umd_name, jibun: m.jibun,
      verdict: a.verdict, records: recs.length,
      purposes: recs.reduce((acc: Record<string, number>, r) => ((acc[String(r.mainPurpsCdNm ?? '(none)')] = (acc[String(r.mainPurpsCdNm ?? '(none)')] ?? 0) + 1), acc), {}),
      residentialRecords: res.length,
      householdsSumAll: recs.reduce((s, r) => s + (Number(r.hhldCnt) || 0), 0),
      householdsSumResidential: res.reduce((s, r) => s + (Number(r.hhldCnt) || 0), 0),
      residentialWithZeroHouseholds: res.filter((r) => (Number(r.hhldCnt) || 0) === 0).length,
      recordHouseholds: recs.map((r) => Number(r.hhldCnt) || 0),
      residentialHouseholds: res.map((r) => Number(r.hhldCnt) || 0),
      parkingPattern: classifyParking(resParkVals.length ? resParkVals : parkVals),
      parkingDistinctNonZero: [...new Set(parkVals.filter((v) => v > 0))],
      farPattern: valuePattern(recs.map((r) => (Number(r.vlRat) || 0) || null)),
      bcrPattern: valuePattern(recs.map((r) => (Number(r.bcRat) || 0) || null)),
      approvalPattern: valuePattern(recs.map((r) => String(r.useAprDay ?? '') || null)),
      roadAddresses: [...new Set(recs.map((r) => String(r.newPlatPlc ?? '').trim()).filter(Boolean))],
      numberedDongs: recs.filter((r) => isNumberedBuildingUnit(r.dongNm)).length,
      stored: { households: m.total_households, parking: m.parking_count, buildingCount: m.main_building_count,
        approvalDate: m.use_approval_date, far: m.floor_area_ratio, bcr: m.building_coverage_ratio, roadAddress: m.road_address, pk: m.mgm_bldrgst_pk },
      inApartmentCache: cacheKey.has(`${m.sgg_cd}|${m.umd_name}|${m.jibun}`),
      source: m.basic_spec_source,
    });
  }

  const tally = (f: (r: any) => string | null) => rows.reduce((acc: Record<string, number>, r) => { const k = f(r); if (k == null) return acc; acc[k] = (acc[k] ?? 0) + 1; return acc; }, {});
  const out = {
    at: new Date().toISOString(), readOnly: true, dbWrites: 0, calls,
    audited: rows.length, ofAffected: affected.length,
    parkingPatterns: tally((r) => r.parkingPattern ?? null),
    farPatterns: tally((r) => r.farPattern ?? null),
    bcrPatterns: tally((r) => r.bcrPattern ?? null),
    approvalPatterns: tally((r) => r.approvalPattern ?? null),
    roadAddressCount: tally((r) => (r.roadAddresses ? String(r.roadAddresses.length) : null)),
    purposeUniverse: rows.reduce((acc: Record<string, number>, r) => { for (const [k, v] of Object.entries(r.purposes ?? {})) acc[k] = (acc[k] ?? 0) + (v as number); return acc; }, {}),
    storedHouseholdsVsSums: {
      storedEqualsResidentialSum: rows.filter((r) => r.stored?.households != null && r.stored.households === r.householdsSumResidential).length,
      // 저장값이 **개별 동 한 곳의 값**과 같은가 — 잘림으로 한 동 값이 단지 값이 된 흔적.
      storedEqualsSomeSingleRecord: rows.filter((r) => r.stored?.households != null && (r.recordHouseholds ?? []).includes(r.stored.households) && r.stored.households !== r.householdsSumResidential).length,
      storedDiffersFromResidentialSum: rows.filter((r) => r.stored?.households != null && r.stored.households !== r.householdsSumResidential).length,
      storedNull: rows.filter((r) => r.stored?.households == null).length,
    },
    inApartmentCache: rows.filter((r) => r.inApartmentCache).length,
    rows,
  };
  fs.writeFileSync(path.join(OUT, 'field-policy.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ ...out, rows: rows.length }, null, 2));
}

if (require.main === module) main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
