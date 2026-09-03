/**
 * RECORD_HIGH_TRUST_V2 — CAPPED CELL RECOVERY DRY-RUN (READ ONLY, NO WRITES)
 *
 * 목적: 1000-row cap으로 누락된 23개 셀을 실제 복구하기 전에, 중복/identity/자연키
 * 위험을 전부 드러낸다. 이 스크립트는 **어떤 경우에도 DB에 쓰지 않는다** — prisma의
 * write 메서드를 아예 호출하지 않는다(아래 어디에도 create/update/upsert/delete 없음).
 *
 * 왜 bucket 분석인가(§4의 핵심):
 *   자연키는 (groupKeyStr, dealAmount, dealDate, floor, occurrenceIndex)이고
 *   occurrenceIndex는 **응답 배열 등장 순서**로 배정된다(trade-history-logic.ts:147-149).
 *   기존 DB는 1000건에서 잘린 응답으로 채워졌고, 지금은 전체 응답을 읽는다. 따라서
 *   "같은 거래에 같은 occurrenceIndex가 다시 배정되는가"가 중복 INSERT를 좌우한다.
 *   bucket = (groupKeyStr, dealAmount, dealDate, floor) 단위로 DB 개수와 source 개수를
 *   비교하면 이 성질을 직접 검증할 수 있다:
 *     - DB index가 0..n-1로 연속이고 nSrc >= nDb  -> 안전(뒤쪽 index만 신규 INSERT)
 *     - nDb > nSrc                                -> source보다 DB가 많음(설명 필요)
 *     - index가 불연속/중복                        -> 자연키 가정 붕괴
 *
 * 사용법:
 *   ALLOW_PROD_DB_READ=1 npx ts-node --transpile-only \
 *     --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js scripts/record-high-trust/capped-cell-recovery-dryrun.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { PrismaClient } from '@prisma/client';
import { XMLParser } from 'fast-xml-parser';
import { mapMolitItems } from '../../src/lib/api-molit';
import { normalizeMolitItemsToTradeRows, type TradeRowInput } from '../trade-history-logic';
import { fetchSaleRegionMonth } from '../sale-molit-fetch';
import { assertProductionDbAccessAllowed } from '../_prod-db-guard';

const prisma = new PrismaClient();

const ENDPOINT = 'http://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev';
const PAGE_SIZE = 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 감사(RECORD_HIGH_TRUST_V1)에서 DB row count가 정확히 1000이었던 셀. */
const CAPPED_CELLS: { lawdCd: string; dealYmd: string; segment: 'A' | 'B' }[] = [
  { lawdCd: '26320', dealYmd: '200611', segment: 'A' },
  { lawdCd: '26350', dealYmd: '200803', segment: 'A' },
  { lawdCd: '26350', dealYmd: '200908', segment: 'A' },
  { lawdCd: '26350', dealYmd: '201011', segment: 'A' },
  { lawdCd: '26350', dealYmd: '201409', segment: 'A' },
  { lawdCd: '26350', dealYmd: '201503', segment: 'A' },
  { lawdCd: '26350', dealYmd: '201504', segment: 'A' },
  { lawdCd: '26350', dealYmd: '201505', segment: 'A' },
  { lawdCd: '26350', dealYmd: '201506', segment: 'A' },
  { lawdCd: '26350', dealYmd: '201507', segment: 'A' },
  { lawdCd: '26350', dealYmd: '201510', segment: 'A' },
  { lawdCd: '26350', dealYmd: '201911', segment: 'A' },
  { lawdCd: '26230', dealYmd: '202006', segment: 'B' },
  { lawdCd: '26350', dealYmd: '202006', segment: 'B' },
  { lawdCd: '26350', dealYmd: '202007', segment: 'B' },
  { lawdCd: '26350', dealYmd: '202009', segment: 'B' },
  { lawdCd: '26260', dealYmd: '202010', segment: 'B' },
  { lawdCd: '26230', dealYmd: '202010', segment: 'B' },
  { lawdCd: '26350', dealYmd: '202010', segment: 'B' },
  { lawdCd: '26230', dealYmd: '202011', segment: 'B' },
  { lawdCd: '26320', dealYmd: '202011', segment: 'B' },
  { lawdCd: '26350', dealYmd: '202011', segment: 'B' },
  { lawdCd: '26380', dealYmd: '202011', segment: 'B' },
];

function nk(r: { groupKeyStr: string; dealAmount: number; dealDate: string; floor: number | null; occurrenceIndex: number }): string {
  return `${r.groupKeyStr}|${r.dealAmount}|${r.dealDate}|${r.floor}|${r.occurrenceIndex}`;
}
function bucketKey(r: { groupKeyStr: string; dealAmount: number; dealDate: string; floor: number | null }): string {
  return `${r.groupKeyStr}|${r.dealAmount}|${r.dealDate}|${r.floor}`;
}
/** 자연키와 무관하게 "현실의 같은 거래"로 볼 수 있는 물리적 서명. */
function physicalSig(r: { aptSeq: string | null; dealDate: string; dealAmount: number; floor: number | null; exclusiveArea: string | number }): string {
  return `${r.aptSeq ?? 'NOAPTSEQ'}|${r.dealDate}|${r.dealAmount}|${r.floor}|${String(r.exclusiveArea)}`;
}
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** §3 — 페이지를 따로 보관해 누락/중복을 페이지 단위로 직접 검사한다. */
async function fetchPagesSeparately(lawdCd: string, dealYmd: string) {
  const key = encodeURIComponent(decodeURIComponent((process.env.DATA_GO_KR_API_KEY || '').trim().replace(/['"]/g, '')));
  const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: true });
  const pages: any[][] = [];
  let totalCount: number | null = null;
  let pageNo = 1;
  for (;;) {
    const url = `${ENDPOINT}?serviceKey=${key}&LAWD_CD=${lawdCd}&DEAL_YMD=${dealYmd}&pageNo=${pageNo}&numOfRows=${PAGE_SIZE}`;
    const res = await fetch(url, { headers: { Accept: 'application/xml' }, signal: AbortSignal.timeout(20000) });
    const j = parser.parse(await res.text());
    if (totalCount === null) totalCount = Number(j.response?.body?.totalCount ?? NaN);
    const raw = j.response?.body?.items?.item;
    pages.push(raw ? (Array.isArray(raw) ? raw : [raw]) : []);
    const got = pages.reduce((a, p) => a + p.length, 0);
    if (!Number.isFinite(totalCount) || got >= (totalCount as number) || pages[pages.length - 1].length === 0) break;
    pageNo++;
    if (pageNo > 20) break;
    await sleep(350);
  }
  return { pages, totalCount: Number.isFinite(totalCount as number) ? (totalCount as number) : null };
}

async function main() {
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'record-high-trust/capped-cell-recovery-dryrun.ts');
  const t0 = Date.now();
  let apiCalls = 0;
  let dbRowsRead = 0;

  console.log('RECORD HIGH TRUST V2 — CAPPED CELL RECOVERY DRY-RUN (READ ONLY)\n');

  const cellReports: any[] = [];
  const allConflicts: any[] = [];
  const allAmbiguous: any[] = [];
  const allPhysicalDupes: any[] = [];

  for (const cell of CAPPED_CELLS) {
    const label = `${cell.lawdCd}/${cell.dealYmd}`;

    // --- source: 페이지 분리 fetch (§3 완전성 검증용)
    const { pages, totalCount } = await fetchPagesSeparately(cell.lawdCd, cell.dealYmd);
    apiCalls += pages.length;
    const fetched = pages.reduce((a, p) => a + p.length, 0);

    // 페이지 중복 검사: 어떤 두 페이지가 완전히 동일한 내용인가(pageNo 무시 버그 탐지)
    const pageSigs = pages.map((p) => JSON.stringify(p).slice(0, 4000));
    const pageDup = new Set(pageSigs).size !== pageSigs.length && pages.length > 1;

    // --- production fetcher 교차검증 (apply가 실제로 쓸 경로)
    const prod = await fetchSaleRegionMonth(cell.lawdCd, cell.dealYmd);
    apiCalls += prod.pagesFetched;

    const paginationOk = totalCount !== null && fetched === totalCount && !pageDup && prod.status === 'COMPLETE' && prod.collectedCount === totalCount;

    // --- 정규화(운영과 동일 로직)
    const items = mapMolitItems(pages.flat(), 'apt', cell.lawdCd, cell.dealYmd);
    const { rows: srcRows, invalid } = normalizeMolitItemsToTradeRows(items, cell.lawdCd, cell.dealYmd);

    // --- DB 기존 row
    const dbRows = await prisma.apartmentTradeHistory.findMany({
      where: { lawdCd: cell.lawdCd, dealYmd: cell.dealYmd, dealType: 'sale' },
      select: {
        id: true, groupKeyStr: true, dealAmount: true, dealDate: true, floor: true, occurrenceIndex: true,
        aptName: true, dong: true, aptSeq: true, exclusiveArea: true, dealCanceled: true,
      },
    });
    dbRowsRead += dbRows.length;

    const dbByNk = new Map<string, (typeof dbRows)[number]>();
    const dbByBucket = new Map<string, (typeof dbRows)[number][]>();
    const dbByPhys = new Map<string, (typeof dbRows)[number][]>();
    for (const d of dbRows) {
      const shaped = { ...d, dealDate: ymd(d.dealDate) };
      dbByNk.set(nk(shaped), d);
      const bk = bucketKey(shaped);
      (dbByBucket.get(bk) ?? dbByBucket.set(bk, []).get(bk)!).push(d);
      const ps = physicalSig({ ...shaped, exclusiveArea: d.exclusiveArea.toString() });
      (dbByPhys.get(ps) ?? dbByPhys.set(ps, []).get(ps)!).push(d);
    }

    // --- §4 분류
    let matchA = 0;
    const conflicts: any[] = [];
    const newCandidates: TradeRowInput[] = [];
    const blockedNoAptSeq: TradeRowInput[] = [];
    const physicalDupeRisk: any[] = [];

    const srcByBucket = new Map<string, TradeRowInput[]>();
    for (const s of srcRows) {
      const bk = bucketKey(s);
      (srcByBucket.get(bk) ?? srcByBucket.set(bk, []).get(bk)!).push(s);
    }

    for (const s of srcRows) {
      const hit = dbByNk.get(nk(s));
      if (hit) {
        matchA++;
        if (hit.aptName !== s.aptName || hit.dong !== s.dong) {
          conflicts.push({ cell: label, nk: nk(s), db: { aptName: hit.aptName, dong: hit.dong }, src: { aptName: s.aptName, dong: s.dong } });
        }
        continue;
      }
      // 신규 후보
      if (!s.aptSeq) { blockedNoAptSeq.push(s); continue; }
      // B: 자연키는 다른데 물리적으로 같은 거래가 이미 DB에 있는가?
      const phys = dbByPhys.get(physicalSig(s)) ?? [];
      const srcSamePhys = srcRows.filter((x) => physicalSig(x) === physicalSig(s)).length;
      if (phys.length > 0 && phys.length >= srcSamePhys) {
        physicalDupeRisk.push({
          cell: label, sig: physicalSig(s), dbCount: phys.length, srcCount: srcSamePhys,
          dbGroupKeys: [...new Set(phys.map((p) => p.groupKeyStr))], srcGroupKey: s.groupKeyStr,
        });
      }
      newCandidates.push(s);
    }

    // --- bucket 안정성 (occurrenceIndex)
    const ambiguous: any[] = [];
    for (const [bk, dbList] of dbByBucket) {
      const idxs = dbList.map((d) => d.occurrenceIndex).sort((a, b) => a - b);
      const contiguous = idxs.every((v, i) => v === i);
      const nSrc = (srcByBucket.get(bk) ?? []).length;
      if (!contiguous) ambiguous.push({ cell: label, bucket: bk, reason: 'DB occurrenceIndex 불연속/중복', idxs });
      else if (nSrc < dbList.length) ambiguous.push({ cell: label, bucket: bk, reason: 'source가 DB보다 적음', nDb: dbList.length, nSrc });
    }

    const canceledNew = newCandidates.filter((r) => r.dealCanceled).length;

    cellReports.push({
      cell: label, segment: cell.segment, dbCount: dbRows.length, totalCount, fetched,
      pages: pages.length, paginationOk, invalid: invalid.length,
      matchA, newCandidates: newCandidates.length, blockedNoAptSeq: blockedNoAptSeq.length,
      conflicts: conflicts.length, ambiguous: ambiguous.length, physicalDupeRisk: physicalDupeRisk.length,
      canceledNew,
    });
    allConflicts.push(...conflicts);
    allAmbiguous.push(...ambiguous);
    allPhysicalDupes.push(...physicalDupeRisk);

    console.log(
      `${label} [${cell.segment}] db=${String(dbRows.length).padStart(4)} src=${String(totalCount).padStart(4)} ` +
      `pages=${pages.length} pgOK=${paginationOk ? 'Y' : 'N'} A=${String(matchA).padStart(4)} ` +
      `NEW=${String(newCandidates.length).padStart(4)} noAptSeq=${blockedNoAptSeq.length} ` +
      `conflict=${conflicts.length} ambig=${ambiguous.length} physDup=${physicalDupeRisk.length} canceledNew=${canceledNew}`
    );
  }

  // ================= 요약 =================
  const sum = (f: (c: any) => number) => cellReports.reduce((a, c) => a + f(c), 0);
  console.log('\n================ SUMMARY ================');
  console.log('cells                    :', cellReports.length);
  console.log('DB rows in cells         :', sum((c) => c.dbCount));
  console.log('source rows (totalCount) :', sum((c) => c.totalCount ?? 0));
  console.log('confirmed missing        :', sum((c) => (c.totalCount ?? 0) - c.dbCount));
  console.log('pagination COMPLETE      :', cellReports.filter((c) => c.paginationOk).length, '/', cellReports.length);
  console.log('invalid(정규화 탈락)      :', sum((c) => c.invalid));
  console.log('A exact NK match         :', sum((c) => c.matchA));
  console.log('C clean INSERT candidates:', sum((c) => c.newCandidates));
  console.log('  of which canceled@src  :', sum((c) => c.canceledNew));
  console.log('BLOCKED (aptSeq null)    :', sum((c) => c.blockedNoAptSeq));
  console.log('D conflict (name/dong)   :', allConflicts.length);
  console.log('D ambiguous (bucket)     :', allAmbiguous.length);
  console.log('B physical dupe risk     :', allPhysicalDupes.length);

  if (allConflicts.length) { console.log('\n--- CONFLICTS ---'); allConflicts.slice(0, 20).forEach((c) => console.log(' ', JSON.stringify(c))); }
  if (allAmbiguous.length) { console.log('\n--- AMBIGUOUS ---'); allAmbiguous.slice(0, 20).forEach((c) => console.log(' ', JSON.stringify(c))); }
  if (allPhysicalDupes.length) { console.log('\n--- PHYSICAL DUPE RISK ---'); allPhysicalDupes.slice(0, 20).forEach((c) => console.log(' ', JSON.stringify(c))); }

  const clean = allConflicts.length === 0 && allAmbiguous.length === 0 && allPhysicalDupes.length === 0 &&
    cellReports.every((c) => c.paginationOk);
  console.log('\nVERDICT:', clean ? 'READY (clean)' : 'NEEDS_REVIEW');
  console.log(`runtime ${((Date.now() - t0) / 1000).toFixed(1)}s  apiCalls ${apiCalls}  dbRowsRead ${dbRowsRead}`);
  console.log('Production writes performed: 0 (this script has no write call)');

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
