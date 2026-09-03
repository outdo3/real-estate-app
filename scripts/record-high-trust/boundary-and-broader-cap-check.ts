/**
 * RECORD_HIGH_TRUST_V2 — §5 1000-row 경계 집중 검증 + §9 broader hidden-cap 표본조사.
 * READ ONLY. DB write 호출 없음.
 *
 * §5가 필요한 이유: dry-run이 "23,000행 전부 자연키 일치"라는 완벽한 결과를 냈다.
 * 그 결과가 진짜인지(= 기존 1000행이 source의 앞 1000개와 **순서까지** 같은지),
 * 아니면 우연히 집계만 맞은 것인지를 position 단위로 직접 확인한다.
 *
 * 사용법:
 *   ALLOW_PROD_DB_READ=1 npx ts-node --transpile-only \
 *     --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js scripts/record-high-trust/boundary-and-broader-cap-check.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { PrismaClient } from '@prisma/client';
import { XMLParser } from 'fast-xml-parser';
import { mapMolitItems } from '../../src/lib/api-molit';
import { normalizeMolitItemsToTradeRows } from '../trade-history-logic';
import { assertProductionDbAccessAllowed } from '../_prod-db-guard';

const prisma = new PrismaClient();
const ENDPOINT = 'http://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const KEY = () => encodeURIComponent(decodeURIComponent((process.env.DATA_GO_KR_API_KEY || '').trim().replace(/['"]/g, '')));
const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: true });

function nk(r: { groupKeyStr: string; dealAmount: number; dealDate: string; floor: number | null; occurrenceIndex: number }) {
  return `${r.groupKeyStr}|${r.dealAmount}|${r.dealDate}|${r.floor}|${r.occurrenceIndex}`;
}

async function totalCountOnly(lawdCd: string, dealYmd: string): Promise<number | null> {
  try {
    const url = `${ENDPOINT}?serviceKey=${KEY()}&LAWD_CD=${lawdCd}&DEAL_YMD=${dealYmd}&pageNo=1&numOfRows=1`;
    const res = await fetch(url, { headers: { Accept: 'application/xml' }, signal: AbortSignal.timeout(20000) });
    const j = parser.parse(await res.text());
    const tc = Number(j.response?.body?.totalCount ?? NaN);
    return Number.isFinite(tc) ? tc : null;
  } catch { return null; }
}

async function fetchAllRaw(lawdCd: string, dealYmd: string): Promise<any[]> {
  const out: any[] = [];
  let total: number | null = null;
  for (let page = 1; page <= 20; page++) {
    const url = `${ENDPOINT}?serviceKey=${KEY()}&LAWD_CD=${lawdCd}&DEAL_YMD=${dealYmd}&pageNo=${page}&numOfRows=1000`;
    const res = await fetch(url, { headers: { Accept: 'application/xml' }, signal: AbortSignal.timeout(20000) });
    const j = parser.parse(await res.text());
    if (total === null) total = Number(j.response?.body?.totalCount ?? NaN);
    const raw = j.response?.body?.items?.item;
    const arr = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
    out.push(...arr);
    if (!Number.isFinite(total as number) || out.length >= (total as number) || arr.length === 0) break;
    await sleep(350);
  }
  return out;
}

async function boundaryCheck(cells: { lawdCd: string; dealYmd: string }[]) {
  console.log('=== §5 1000-ROW BOUNDARY CHECK (position 단위) ===\n');
  for (const c of cells) {
    const label = `${c.lawdCd}/${c.dealYmd}`;
    const rawItems = await fetchAllRaw(c.lawdCd, c.dealYmd);
    const items = mapMolitItems(rawItems, 'apt', c.lawdCd, c.dealYmd);
    const { rows } = normalizeMolitItemsToTradeRows(items, c.lawdCd, c.dealYmd);

    const dbRows = await prisma.apartmentTradeHistory.findMany({
      where: { lawdCd: c.lawdCd, dealYmd: c.dealYmd, dealType: 'sale' },
      select: { groupKeyStr: true, dealAmount: true, dealDate: true, floor: true, occurrenceIndex: true },
    });
    const dbSet = new Set(dbRows.map((d) => nk({ ...d, dealDate: ymd(d.dealDate) })));

    // source를 응답 순서대로 훑으며, 각 position이 DB에 있는지 표시한다.
    const inDb = rows.map((r) => dbSet.has(nk(r)));
    const firstMissIdx = inDb.indexOf(false);
    const lastHitIdx = inDb.lastIndexOf(true);
    const prefixClean = firstMissIdx === dbRows.length && lastHitIdx === dbRows.length - 1;

    // 경계 앞뒤 표본
    const around = [997, 998, 999, 1000, 1001, 1002].filter((i) => i < rows.length)
      .map((i) => `${i}:${inDb[i] ? 'DB' : '--'}`).join(' ');

    console.log(
      `${label}  srcRows=${rows.length} dbRows=${dbRows.length}\n` +
      `   첫 unmatched position = ${firstMissIdx}   마지막 matched position = ${lastHitIdx}\n` +
      `   경계 표본 [pos:상태] ${around}\n` +
      `   => 앞 ${dbRows.length}개가 정확히 DB, 그 뒤 전부 신규: ${prefixClean ? 'YES (순서까지 동일)' : 'NO — 순서 불안정!'}\n`
    );
  }
}

async function broaderCapCheck() {
  console.log('=== §9 BROADER HIDDEN-CAP CHECK (표본조사) ===\n');
  const B = ['26110','26140','26170','26200','26230','26260','26290','26320','26350','26380','26410','26440','26470','26500','26530','26710'];
  const inL = "'" + B.join("','") + "'";
  const cells: { lawd_cd: string; deal_ymd: string; n: number }[] = await prisma.$queryRawUnsafe(
    `SELECT lawd_cd, deal_ymd, count(*)::int n FROM apartment_trade_histories
     WHERE lawd_cd IN (${inL}) AND deal_type='sale' GROUP BY 1,2 ORDER BY n DESC`
  );
  const notCapped = cells.filter((c) => c.n !== 1000);
  console.log(`부산 sale 셀 총 ${cells.length}개 (1000 정확히인 23개 제외 시 ${notCapped.length}개)`);

  // 표본: DB count 상위 120개(cap에 가장 가까운 쪽) + 무작위 80개
  const top = notCapped.slice(0, 120);
  const rest = notCapped.slice(120);
  const rnd: typeof rest = [];
  for (let i = 0; i < 80 && rest.length; i++) rnd.push(rest.splice(Math.floor(Math.random() * rest.length), 1)[0]);
  const sample = [...top, ...rnd];
  console.log(`표본 ${sample.length}개 (상위 ${top.length} + 무작위 ${rnd.length}) — totalCount만 조회\n`);

  const short: { cell: string; db: number; src: number; missing: number }[] = [];
  let checked = 0, apiCalls = 0;
  for (const c of sample) {
    const tc = await totalCountOnly(c.lawd_cd, c.deal_ymd);
    apiCalls++; checked++;
    if (tc !== null && tc > c.n) short.push({ cell: `${c.lawd_cd}/${c.deal_ymd}`, db: c.n, src: tc, missing: tc - c.n });
    await sleep(120);
  }

  short.sort((a, b) => b.missing - a.missing);
  console.log(`검사 ${checked}개 중 source > DB 인 셀: ${short.length}개 (${(short.length / checked * 100).toFixed(1)}%)`);
  console.log(`표본 내 누락 합계: ${short.reduce((a, s) => a + s.missing, 0)}행`);
  const nearCap = short.filter((s) => s.db >= 900 && s.db < 1000);
  console.log(`그중 DB가 900~999인 "숨은 cap 의심" 셀: ${nearCap.length}개`);
  console.log('\n상위 20개:');
  short.slice(0, 20).forEach((s) => console.log(`  ${s.cell}  db=${String(s.db).padStart(4)} src=${String(s.src).padStart(4)} missing=${String(s.missing).padStart(4)}`));

  const dist = { '1-5': 0, '6-20': 0, '21-100': 0, '100+': 0 };
  for (const s of short) {
    if (s.missing <= 5) dist['1-5']++; else if (s.missing <= 20) dist['6-20']++;
    else if (s.missing <= 100) dist['21-100']++; else dist['100+']++;
  }
  console.log('\n누락 규모 분포:', JSON.stringify(dist));
  console.log(`API calls: ${apiCalls}`);
  return { checked, short: short.length, totalMissing: short.reduce((a, s) => a + s.missing, 0), totalCells: cells.length, dist, nearCap: nearCap.length };
}

async function main() {
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'record-high-trust/boundary-and-broader-cap-check.ts');
  const t0 = Date.now();
  await boundaryCheck([
    { lawdCd: '26350', dealYmd: '202010' }, // worst: 1442 missing, 3 pages
    { lawdCd: '26320', dealYmd: '200611' }, // A구간 최대
    { lawdCd: '26350', dealYmd: '200908' }, // 최소 누락(7)
  ]);
  const b = await broaderCapCheck();
  console.log(`\nruntime ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log('Production writes performed: 0');
  await prisma.$disconnect();
  return b;
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
