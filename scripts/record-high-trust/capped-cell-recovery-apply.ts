/**
 * RECORD_HIGH_TRUST_V2 — CAPPED CELL RECOVERY APPLY (승인된 Production INSERT).
 *
 * 승인 범위(엄격):
 *   - apartment_trade_histories INSERT 최대 8,446행, 검증된 23개 셀에 한정
 *   - createMany({ skipDuplicates: true }) — 기존 안전 정책 재사용
 *   - 기존 row UPDATE / DELETE / schema / index / 다른 셀 backfill: 전부 금지
 *
 * 이 스크립트에는 update/upsert/delete 호출이 존재하지 않는다. 쓰기는 createMany 한 곳뿐이다.
 *
 * 안전 게이트: write 직전에 source를 다시 읽어 DRY-RUN과 같은 검증을 전부 수행하고,
 * 하나라도 어긋나면 **아무것도 쓰지 않고** 종료한다(전부-또는-전무).
 *
 * 사용법:
 *   ALLOW_PROD_DB_WRITE=1 npx ts-node --transpile-only \
 *     --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js scripts/record-high-trust/capped-cell-recovery-apply.ts --apply
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { PrismaClient, Prisma } from '@prisma/client';
import { mapMolitItems } from '../../src/lib/api-molit';
import { normalizeMolitItemsToTradeRows, type TradeRowInput } from '../trade-history-logic';
import { fetchSaleRegionMonth } from '../sale-molit-fetch';
import { assertProductionDbAccessAllowed } from '../_prod-db-guard';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const CHUNK_SIZE = 500;

/** 승인된 정확한 상한. 후보가 이보다 많으면 즉시 STOP. */
const APPROVED_MAX_INSERTS = 8446;

const CELLS: { lawdCd: string; dealYmd: string; segment: 'A' | 'B'; expectTotal: number }[] = [
  { lawdCd: '26320', dealYmd: '200611', segment: 'A', expectTotal: 1606 },
  { lawdCd: '26350', dealYmd: '200803', segment: 'A', expectTotal: 1031 },
  { lawdCd: '26350', dealYmd: '200908', segment: 'A', expectTotal: 1007 },
  { lawdCd: '26350', dealYmd: '201011', segment: 'A', expectTotal: 1029 },
  { lawdCd: '26350', dealYmd: '201409', segment: 'A', expectTotal: 1038 },
  { lawdCd: '26350', dealYmd: '201503', segment: 'A', expectTotal: 1275 },
  { lawdCd: '26350', dealYmd: '201504', segment: 'A', expectTotal: 1096 },
  { lawdCd: '26350', dealYmd: '201505', segment: 'A', expectTotal: 1013 },
  { lawdCd: '26350', dealYmd: '201506', segment: 'A', expectTotal: 1321 },
  { lawdCd: '26350', dealYmd: '201507', segment: 'A', expectTotal: 1269 },
  { lawdCd: '26350', dealYmd: '201510', segment: 'A', expectTotal: 1272 },
  { lawdCd: '26350', dealYmd: '201911', segment: 'A', expectTotal: 1891 },
  { lawdCd: '26230', dealYmd: '202006', segment: 'B', expectTotal: 1093 },
  { lawdCd: '26350', dealYmd: '202006', segment: 'B', expectTotal: 1924 },
  { lawdCd: '26350', dealYmd: '202007', segment: 'B', expectTotal: 1332 },
  { lawdCd: '26350', dealYmd: '202009', segment: 'B', expectTotal: 1154 },
  { lawdCd: '26260', dealYmd: '202010', segment: 'B', expectTotal: 1064 },
  { lawdCd: '26230', dealYmd: '202010', segment: 'B', expectTotal: 1419 },
  { lawdCd: '26350', dealYmd: '202010', segment: 'B', expectTotal: 2442 },
  { lawdCd: '26230', dealYmd: '202011', segment: 'B', expectTotal: 1633 },
  { lawdCd: '26320', dealYmd: '202011', segment: 'B', expectTotal: 1428 },
  { lawdCd: '26350', dealYmd: '202011', segment: 'B', expectTotal: 1657 },
  { lawdCd: '26380', dealYmd: '202011', segment: 'B', expectTotal: 1452 },
];

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const nk = (r: { groupKeyStr: string; dealAmount: number; dealDate: string; floor: number | null; occurrenceIndex: number }) =>
  `${r.groupKeyStr}|${r.dealAmount}|${r.dealDate}|${r.floor}|${r.occurrenceIndex}`;
const physicalSig = (r: { aptSeq: string | null; dealDate: string; dealAmount: number; floor: number | null; exclusiveArea: string | number }) =>
  `${r.aptSeq ?? 'NOAPTSEQ'}|${r.dealDate}|${r.dealAmount}|${r.floor}|${String(r.exclusiveArea)}`;

interface CellPlan {
  lawdCd: string; dealYmd: string; segment: 'A' | 'B';
  dbCount: number; totalCount: number | null; status: string;
  candidates: TradeRowInput[];
  problems: string[];
  canceledAtSource: number;
}

async function planCell(c: (typeof CELLS)[number]): Promise<CellPlan> {
  const problems: string[] = [];
  const fetched = await fetchSaleRegionMonth(c.lawdCd, c.dealYmd);

  if (fetched.status !== 'COMPLETE') problems.push(`pagination status=${fetched.status}`);
  if (fetched.totalCount === null) problems.push('totalCount null');
  else {
    if (fetched.collectedCount !== fetched.totalCount) problems.push(`collected(${fetched.collectedCount}) != totalCount(${fetched.totalCount})`);
    if (Math.abs(fetched.totalCount - c.expectTotal) > 0) problems.push(`totalCount 변동: DRY-RUN ${c.expectTotal} -> 현재 ${fetched.totalCount}`);
  }

  const { rows: srcRows, invalid } = normalizeMolitItemsToTradeRows(fetched.items, c.lawdCd, c.dealYmd);
  if (invalid.length) problems.push(`invalid rows=${invalid.length}`);

  const dbRows = await prisma.apartmentTradeHistory.findMany({
    where: { lawdCd: c.lawdCd, dealYmd: c.dealYmd, dealType: 'sale' },
    select: { groupKeyStr: true, dealAmount: true, dealDate: true, floor: true, occurrenceIndex: true, aptName: true, dong: true, aptSeq: true, exclusiveArea: true },
  });

  const dbByNk = new Set<string>();
  const dbByPhys = new Map<string, number>();
  for (const d of dbRows) {
    const shaped = { ...d, dealDate: ymd(d.dealDate) };
    dbByNk.add(nk(shaped));
    const ps = physicalSig({ ...shaped, exclusiveArea: d.exclusiveArea.toString() });
    dbByPhys.set(ps, (dbByPhys.get(ps) ?? 0) + 1);
  }
  const dbByNkFull = new Map(dbRows.map((d) => [nk({ ...d, dealDate: ymd(d.dealDate) }), d]));

  const srcPhysCount = new Map<string, number>();
  for (const s of srcRows) srcPhysCount.set(physicalSig(s), (srcPhysCount.get(physicalSig(s)) ?? 0) + 1);

  const candidates: TradeRowInput[] = [];
  let matched = 0;
  for (const s of srcRows) {
    const hit = dbByNkFull.get(nk(s));
    if (hit) {
      matched++;
      if (hit.aptName !== s.aptName || hit.dong !== s.dong) problems.push(`conflict name/dong @ ${nk(s)}`);
      continue;
    }
    if (!s.aptSeq) { problems.push(`aptSeq null candidate @ ${nk(s)}`); continue; }
    if (s.lawdCd !== c.lawdCd) { problems.push(`lawdCd mismatch @ ${nk(s)}`); continue; }
    const dbPhys = dbByPhys.get(physicalSig(s)) ?? 0;
    if (dbPhys > 0 && dbPhys >= (srcPhysCount.get(physicalSig(s)) ?? 0)) problems.push(`physical dupe risk @ ${physicalSig(s)}`);
    candidates.push(s);
  }
  if (matched !== dbRows.length) problems.push(`DB ${dbRows.length}행 중 ${dbRows.length - matched}행이 source와 자연키 불일치`);

  return {
    lawdCd: c.lawdCd, dealYmd: c.dealYmd, segment: c.segment,
    dbCount: dbRows.length, totalCount: fetched.totalCount, status: fetched.status,
    candidates, problems, canceledAtSource: candidates.filter((r) => r.dealCanceled).length,
  };
}

async function main() {
  assertProductionDbAccessAllowed(APPLY ? 'BACKFILL' : 'DIAGNOSTIC', 'record-high-trust/capped-cell-recovery-apply.ts');
  const t0 = Date.now();
  console.log(`RECORD HIGH TRUST V2 — CAPPED CELL RECOVERY ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);

  // ---------- §1 PRE-APPLY REVALIDATION ----------
  console.log('=== §1 PRE-APPLY REVALIDATION (write 전 source 재확인) ===');
  const plans: CellPlan[] = [];
  for (const c of CELLS) {
    const p = await planCell(c);
    plans.push(p);
    console.log(
      `${p.lawdCd}/${p.dealYmd} [${p.segment}] db=${String(p.dbCount).padStart(4)} src=${String(p.totalCount).padStart(4)} ` +
      `${p.status} candidates=${String(p.candidates.length).padStart(4)} canceled@src=${String(p.canceledAtSource).padStart(3)} ` +
      `problems=${p.problems.length}`
    );
    if (p.problems.length) p.problems.slice(0, 5).forEach((x) => console.log(`     ! ${x}`));
  }

  const totalDb = plans.reduce((a, p) => a + p.dbCount, 0);
  const totalSrc = plans.reduce((a, p) => a + (p.totalCount ?? 0), 0);
  const totalCand = plans.reduce((a, p) => a + p.candidates.length, 0);
  const totalProblems = plans.reduce((a, p) => a + p.problems.length, 0);
  const totalCanceled = plans.reduce((a, p) => a + p.canceledAtSource, 0);

  console.log('\n--- revalidation summary ---');
  console.log('pre-apply DB rows in 23 cells :', totalDb, '(기대 23,000)');
  console.log('pre-apply source rows         :', totalSrc, '(기대 31,446)');
  console.log('insert candidates             :', totalCand, '(기대 8,446)');
  console.log('canceled-at-source candidates :', totalCanceled, '(기대 629)');
  console.log('problems                      :', totalProblems);

  // ---------- 안전 게이트 ----------
  const gateFailures: string[] = [];
  if (totalProblems > 0) gateFailures.push(`검증 문제 ${totalProblems}건`);
  if (totalCand > APPROVED_MAX_INSERTS) gateFailures.push(`후보 ${totalCand} > 승인 상한 ${APPROVED_MAX_INSERTS}`);
  if (totalDb !== 23000) gateFailures.push(`DB rows ${totalDb} != 23000`);
  if (totalSrc !== 31446) gateFailures.push(`source rows ${totalSrc} != 31446`);
  if (totalCand !== 8446) gateFailures.push(`candidates ${totalCand} != 8446`);

  if (gateFailures.length) {
    console.log('\n*** STOP — 승인 조건과 다릅니다. 아무것도 쓰지 않았습니다. ***');
    gateFailures.forEach((f) => console.log('  -', f));
    await prisma.$disconnect();
    process.exit(2);
  }
  console.log('GATE PASS — 승인 범위와 정확히 일치.');

  if (!APPLY) {
    console.log('\n(--apply 없음: 여기서 종료. Production write 0건)');
    await prisma.$disconnect();
    return;
  }

  // ---------- §2 APPLY (INSERT ONLY) ----------
  console.log('\n=== §2 APPLY (INSERT ONLY) ===');
  let inserted = 0;
  for (const p of plans) {
    let cellInserted = 0;
    for (let i = 0; i < p.candidates.length; i += CHUNK_SIZE) {
      const chunk = p.candidates.slice(i, i + CHUNK_SIZE);
      const res = await prisma.apartmentTradeHistory.createMany({
        data: chunk.map((row) => ({
          source: 'MOLIT_APT_TRADE',
          lawdCd: row.lawdCd,
          dealYmd: row.dealYmd,
          aptSeq: row.aptSeq,
          identityKey: row.identityKey,
          dealType: row.dealType,
          groupKeyStr: row.groupKeyStr,
          aptName: row.aptName,
          dong: row.dong,
          jibun: row.jibun,
          exclusiveArea: new Prisma.Decimal(row.exclusiveArea),
          dealAmount: row.dealAmount,
          dealYear: row.dealYear,
          dealMonth: row.dealMonth,
          dealDay: row.dealDay,
          dealDate: new Date(`${row.dealDate}T00:00:00.000Z`),
          floor: row.floor,
          buildYear: row.buildYear,
          dealCanceled: row.dealCanceled,
          cancelDate: row.cancelDate,
          registryDate: row.registryDate,
          occurrenceIndex: row.occurrenceIndex,
          rawUid: row.rawUid,
          sourceFetchedAt: new Date(),
        })),
        skipDuplicates: true,
      });
      cellInserted += res.count;
    }
    inserted += cellInserted;
    console.log(`${p.lawdCd}/${p.dealYmd} inserted=${cellInserted} / candidates=${p.candidates.length}`);
  }
  console.log('\nTOTAL INSERTED:', inserted);

  // ---------- §3 POST-APPLY EXACT VERIFICATION ----------
  console.log('\n=== §3 POST-APPLY VERIFICATION (23 cells 전수) ===');
  let pass = 0;
  for (const p of plans) {
    const after = await prisma.apartmentTradeHistory.count({ where: { lawdCd: p.lawdCd, dealYmd: p.dealYmd, dealType: 'sale' } });
    const ok = after === p.totalCount;
    if (ok) pass++;
    console.log(`${p.lawdCd}/${p.dealYmd} after=${String(after).padStart(4)} totalCount=${String(p.totalCount).padStart(4)} ${ok ? 'PASS' : 'FAIL'}`);
  }
  console.log(`\n${pass}/23 PASS`);

  console.log(`\nruntime ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
