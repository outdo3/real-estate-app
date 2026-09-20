/**
 * BUILDING_LEDGER_PAGINATION_FIX_V1 §8~§11 — 부산 기존 대장 데이터가 페이징 결함의 영향을
 * 얼마나 받았는지 **읽기 전용**으로 센다.
 *
 * 각 master의 지번을 **올바른 페이징(pageNo=1, numOfRows=100)** 으로 다시 조회해
 *   - 이 지번의 실제 레코드 수(totalCount)  ← 결함 규모의 핵심
 *   - 고친 뒤의 판정(decideGeneralTitle / decideTitleFallback, 선택 정책은 기존 그대로)
 *   - 그 판정으로 나올 값 vs **현재 저장된 값**의 필드별 차이
 * 를 기록한다.
 *
 * **데이터를 고치지 않는다** — DB write 0. 저장 값과 다르다고 해서 새 값이 자동으로 옳다고
 * 보지도 않는다(그 판단은 §10 정책 결정 대상).
 *
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/audit-busan-ledger-pagination-impact.ts [--limit=N] [--interval=400]
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { fetchAllLedgerPages } from '../src/lib/building-ledger-pager';
import { isNumberedBuildingUnit } from '../src/lib/apt-building-info';
import { decideGeneralTitle, decideTitleFallback, extractGeneralFields, LENIENT_POLICY } from './backfill-basic-data-logic';

const OUT = path.resolve(__dirname, '../tmp/building-ledger-paging');
const API_KEY = process.env.DATA_GO_KR_API_KEY || '';
const cleanKey = () => encodeURIComponent(decodeURIComponent(API_KEY.trim().replace(/['"]/g, '')));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let calls = 0;
let rateLimited = 0;

function jibunToBunJi(jibun: string): { bun: string; ji: string } | null {
  const m = /^(\d+)(?:-(\d+))?$/.exec((jibun ?? '').trim());
  if (!m) return null;
  return { bun: String(Number(m[1])).padStart(4, '0'), ji: String(m[2] ? Number(m[2]) : 0).padStart(4, '0') };
}

async function fetchLot(op: string, sgg: string, umd: string, bun: string, ji: string, intervalMs: number) {
  return fetchAllLedgerPages(async (pageNo, numOfRows) => {
    await sleep(intervalMs);
    calls++;
    const url = `https://apis.data.go.kr/1613000/BldRgstHubService/${op}?serviceKey=${cleanKey()}&sigunguCd=${sgg}&bjdongCd=${umd}&platGbCd=0&bun=${bun}&ji=${ji}&numOfRows=${numOfRows}&pageNo=${pageNo}&_type=json`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const text = await res.text();
      if (!res.ok || /LIMITED_NUMBER_OF_SERVICE_REQUESTS/.test(text)) {
        if (res.status === 429 || res.status === 503 || /LIMITED_NUMBER/.test(text)) { rateLimited++; return { kind: 'RATE_LIMITED', detail: `http=${res.status}` } as const; }
        return { kind: 'ERROR', detail: `http=${res.status}` } as const;
      }
      const json = JSON.parse(text);
      const header = json?.response?.header;
      if (header?.resultCode && header.resultCode !== '00') return { kind: 'ERROR', detail: `resultCode=${header.resultCode}` } as const;
      const body = json?.response?.body;
      const raw = body?.items?.item;
      const items = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
      const total = Number(body?.totalCount);
      return { kind: 'OK', items, totalCount: Number.isFinite(total) ? total : items.length } as const;
    } catch (e) { return { kind: 'ERROR', detail: (e as Error)?.name ?? 'error' } as const; }
  });
}

export function bucketOf(n: number): string {
  if (n <= 1) return '1';
  if (n <= 2) return '2';
  if (n <= 5) return '3-5';
  if (n <= 10) return '6-10';
  return '11+';
}

async function main() {
  const limit = Number(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? NaN);
  const interval = Number(process.argv.find((a) => a.startsWith('--interval='))?.split('=')[1] ?? 400);
  const { PrismaClient } = await import('@prisma/client');
  const { assertProductionDbAccessAllowed } = await import('./_prod-db-guard');
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'audit-busan-ledger-pagination-impact.ts');
  const prisma = new PrismaClient();

  const masters = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    return tx.$queryRawUnsafe<any[]>(
      `SELECT apt_seq, name, sgg_cd, umd_name, umd_cd, jibun, basic_spec_source,
              total_households, parking_count, main_building_count, use_approval_date,
              floor_area_ratio, building_coverage_ratio, road_address, mgm_bldrgst_pk
       FROM apartment_masters
       WHERE sgg_cd LIKE '26%' AND basic_spec_source IN ('BUILDINGHUB_TITLE','BUILDINGHUB_GENERAL_TITLE')
       ORDER BY apt_seq`);
  }, { timeout: 600_000 });
  await prisma.$disconnect();

  const targets = Number.isFinite(limit) ? masters.slice(0, limit) : masters;
  const results: any[] = [];

  for (const m of targets) {
    const bj = jibunToBunJi(String(m.jibun ?? ''));
    if (!bj || !m.umd_cd) { results.push({ aptSeq: m.apt_seq, name: m.name, source: m.basic_spec_source, verdict: 'NO_LOT_KEY' }); continue; }
    const isGeneral = m.basic_spec_source === 'BUILDINGHUB_GENERAL_TITLE';
    const op = isGeneral ? 'getBrRecapTitleInfo' : 'getBrTitleInfo';
    const paged = await fetchLot(op, m.sgg_cd, m.umd_cd, bj.bun, bj.ji, interval);

    const base = {
      aptSeq: m.apt_seq, name: m.name, sgg: m.sgg_cd, dong: m.umd_name, jibun: m.jibun,
      source: m.basic_spec_source, op, fetchStatus: paged.status, totalCount: paged.totalCount,
      pages: paged.pages, bucket: paged.totalCount != null ? bucketOf(paged.totalCount) : null,
      stored: { households: m.total_households, parking: m.parking_count, buildingCount: m.main_building_count,
        approvalDate: m.use_approval_date, far: m.floor_area_ratio, bcr: m.building_coverage_ratio,
        roadAddress: m.road_address, pk: m.mgm_bldrgst_pk },
    };
    if (paged.status !== 'COMPLETE') { results.push({ ...base, verdict: paged.status === 'EMPTY' ? 'SOURCE_EMPTY_NOW' : 'FETCH_' + paged.status }); continue; }

    const arr = paged.items as any[];
    const q = { sggCd: m.sgg_cd, umdCd: m.umd_cd, bun: bj.bun, ji: bj.ji };
    // 고친 뒤 판정 — 선택 정책은 기존 LENIENT 그대로, 입력만 완전한 집합이다.
    let newStatus: string;
    let newFields: Record<string, unknown> | null = null;
    if (isGeneral) {
      const d = decideGeneralTitle(arr, paged.totalCount, null, q as any, LENIENT_POLICY);
      newStatus = d.status;
      if (d.status === 'success' && d.record) newFields = extractGeneralFields(d.record, d.mgmBldrgstPk) as any;
    } else {
      newStatus = decideTitleFallback(arr, paged.totalCount, q as any, LENIENT_POLICY, isNumberedBuildingUnit);
    }

    // 필드별 비교(성공했을 때만). 새 값이 옳다고 단정하지 않는다 — 다르다는 사실만 센다.
    const diffs: string[] = [];
    if (newFields) {
      const cmp = (k: string, a: unknown, b: unknown) => { if ((a ?? null) !== (b ?? null)) diffs.push(k); };
      cmp('households', newFields.totalHouseholds, base.stored.households);
      cmp('parking', newFields.parkingCount, base.stored.parking);
      cmp('buildingCount', newFields.mainBuildingCount, base.stored.buildingCount);
      cmp('approvalDate', newFields.useApprovalDate, base.stored.approvalDate);
      cmp('far', newFields.floorAreaRatio, base.stored.far);
      cmp('bcr', newFields.buildingCoverageRatio, base.stored.bcr);
      cmp('roadAddress', newFields.roadAddress, base.stored.roadAddress);
      cmp('pk', newFields.mgmBldrgstPk, base.stored.pk);
    }

    const verdict =
      newStatus === 'success' ? (diffs.length ? 'VALUE_DIFF' : 'UNCHANGED')
      : (paged.totalCount ?? 0) > 1 ? 'NOW_WITHHELD_MULTI_RECORD'
      : 'NOW_WITHHELD_OTHER';
    results.push({ ...base, newStatus, newFields, diffs, verdict });
  }

  const tally = (key: (x: any) => string | null) => results.reduce((m: Record<string, number>, r) => {
    const k = key(r); if (k == null) return m; m[k] = (m[k] ?? 0) + 1; return m;
  }, {});
  const fieldDiffs: Record<string, number> = {};
  for (const r of results) for (const d of r.diffs ?? []) fieldDiffs[d] = (fieldDiffs[d] ?? 0) + 1;

  const multi = results.filter((r) => (r.totalCount ?? 0) > 1);
  const out = {
    at: new Date().toISOString(), readOnly: true, dbWrites: 0, calls, rateLimited,
    audited: results.length, ofTotal: masters.length,
    bySource: tally((r) => r.source),
    byVerdict: tally((r) => r.verdict),
    byRecordCountBucket: tally((r) => r.bucket),
    multiRecord: { count: multi.length, rate: results.length ? +(multi.length / results.length * 100).toFixed(2) : 0,
      rows: multi.length, maxRecords: results.reduce((m, r) => Math.max(m, r.totalCount ?? 0), 0) },
    fieldDiffs,
    topMulti: multi.sort((a, b) => (b.totalCount ?? 0) - (a.totalCount ?? 0)).slice(0, 25)
      .map((r) => ({ aptSeq: r.aptSeq, name: r.name, dong: r.dong, jibun: r.jibun, source: r.source, totalCount: r.totalCount, verdict: r.verdict, storedHouseholds: r.stored?.households })),
  };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'busan-impact.json'), JSON.stringify({ ...out, results }, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

if (require.main === module) main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
