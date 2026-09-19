/**
 * SEOUL_SALE_BACKFILL_PLAN_V1 — 서울 아파트 매매 전체 이력 backfill 계획용 read-only probe.
 *
 * STRICT READ ONLY:
 *   - MOLIT 매매(RTMSDataSvcAptTradeDev) GET만. 동시 1 · 최소 간격 350ms · pageNo/totalCount 검증.
 *   - 매 응답의 x-ratelimit-remaining을 읽어 **예약분(--reserve, 기본 2000) 아래로 내려가면 즉시 멈춘다** —
 *     같은 키를 쓰는 Production 라이브 조회·cron 몫을 남기기 위해서다. 셀 단위 checkpoint로 다음 창에서 이어간다.
 *   - 전체 원천 필드를 셀별 gzip으로만 저장(tmp/seoul-sale-backfill-plan/raw/). DB write 없음.
 *   - serviceKey는 출력하지 않는다.
 *
 * 실행:
 *   npx tsx scripts/audit-seoul-sale-backfill-plan.ts fetch [--reserve=2000] [--districts=11140,11680]
 *   npx tsx scripts/audit-seoul-sale-backfill-plan.ts status
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/audit-seoul-sale-backfill-plan.ts report
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import * as zlib from 'zlib';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { XMLParser } from 'fast-xml-parser';
import { fetchSaleCell, type PageFetcher, type PageOutcome } from './seed-seoul-apartment-master-logic';
import { mapMolitItems } from '../src/lib/api-molit';
import { normalizeMolitItemsToTradeRows, type TradeRowInput } from './trade-history-logic';

export const OUT = path.resolve(__dirname, '../tmp/seoul-sale-backfill-plan');
const RAW = path.join(OUT, 'raw');
const CELLS = path.join(OUT, 'cells');

/** 대표 구를 먼저(중구 → 강남 → 송파 → 노원 → 강동), 나머지는 코드 순. */
export const FETCH_ORDER = [
  '11140', '11680', '11710', '11350', '11740',
  '11110', '11170', '11200', '11215', '11230', '11260', '11290', '11305', '11320', '11380', '11410', '11440',
  '11470', '11500', '11530', '11545', '11560', '11590', '11620', '11650',
];

/** 2006-01 ~ 끝 달(포함), 오래된 달부터. */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(4));
  const ey = Number(to.slice(0, 4));
  const em = Number(to.slice(4));
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

export function kstYm(now = new Date()): string {
  const k = new Date(now.getTime() + 9 * 3600 * 1000);
  return `${k.getUTCFullYear()}${String(k.getUTCMonth() + 1).padStart(2, '0')}`;
}

export interface CellCheckpoint { status: 'COMPLETE' | 'PARTIAL' | 'ERROR'; totalCount: number | null; collected: number; pages: number; errors: string[]; at: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const key = () => encodeURIComponent(decodeURIComponent((process.env.DATA_GO_KR_API_KEY || '').trim().replace(/['"]/g, '')));
const xml = new XMLParser({ ignoreAttributes: false, parseTagValue: false });
const ENDPOINT = 'http://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev';
let lastAt = 0;
export const quota = { remaining: null as number | null, calls: 0 };

/** 전체 원천 필드를 보존하는 페이지 fetcher. 제한·타임아웃·5xx만 제한 횟수 재시도. */
const fetchPage: PageFetcher = async (lawdCd, ym, pageNo, numOfRows) => {
  let last: PageOutcome = { kind: 'NETWORK', detail: 'not attempted' };
  for (let attempt = 0; attempt < 5; attempt++) {
    const wait = lastAt + 350 - Date.now();
    if (wait > 0) await sleep(wait);
    lastAt = Date.now();
    quota.calls++;
    let status = 0;
    let text = '';
    try {
      const res = await fetch(`${ENDPOINT}?serviceKey=${key()}&LAWD_CD=${lawdCd}&DEAL_YMD=${ym}&pageNo=${pageNo}&numOfRows=${numOfRows}`, {
        headers: { Accept: 'application/xml, text/xml, */*' }, signal: AbortSignal.timeout(20000),
      });
      status = res.status;
      const rem = Number(res.headers.get('x-ratelimit-remaining'));
      if (Number.isFinite(rem)) quota.remaining = rem;
      text = await res.text();
    } catch (e: any) {
      last = { kind: e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK', detail: e?.name ?? 'error' };
      if (attempt < 2) { await sleep(1000 * 2 ** attempt); continue; }
      return last;
    }
    if (status === 429 || /LIMITED_NUMBER_OF_SERVICE_REQUESTS|초당\s*서비스\s*요청\s*제한/.test(text)) {
      last = { kind: 'RATE_LIMITED', detail: `http=${status}` };
      if (attempt < 4) { await sleep(1000 * 2 ** attempt); continue; }
      return last;
    }
    if (status >= 500 && attempt < 2) { last = { kind: 'HTTP_ERROR', detail: `http=${status}` }; await sleep(1000 * 2 ** attempt); continue; }
    if (status !== 200) return { kind: 'HTTP_ERROR', detail: `http=${status}` };
    let j: any;
    try { j = xml.parse(text); } catch { return { kind: 'PARSE_ERROR', detail: 'xml' }; }
    const header = j?.response?.header;
    if (!header) return { kind: 'PARSE_ERROR', detail: 'no response.header' };
    const code = String(header.resultCode ?? '');
    if (code !== '00' && code !== '000') return { kind: 'RESULT_CODE', detail: `resultCode=${code}` };
    const total = Number(j.response.body?.totalCount);
    if (!Number.isFinite(total)) return { kind: 'PARSE_ERROR', detail: 'totalCount' };
    const raw = j.response.body?.items?.item;
    return { kind: 'OK', totalCount: total, items: raw ? (Array.isArray(raw) ? raw : [raw]) : [] };
  }
  return last;
};

function loadCells(lawdCd: string): Record<string, CellCheckpoint> {
  const p = path.join(CELLS, `${lawdCd}.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
}

async function phaseFetch(reserve: number, districts: string[], months: string[]) {
  fs.mkdirSync(RAW, { recursive: true });
  fs.mkdirSync(CELLS, { recursive: true });
  for (const d of districts) {
    const cells = loadCells(d);
    fs.mkdirSync(path.join(RAW, d), { recursive: true });
    let fetched = 0;
    for (const ym of months) {
      if (cells[ym]?.status === 'COMPLETE') continue;
      if (quota.remaining != null && quota.remaining <= reserve) {
        fs.writeFileSync(path.join(CELLS, `${d}.json`), JSON.stringify(cells));
        console.log(`RESERVE_STOP remaining=${quota.remaining} reserve=${reserve} at ${d}/${ym} calls=${quota.calls}`);
        return;
      }
      const c = await fetchSaleCell(fetchPage, d, ym);
      cells[ym] = { status: c.status, totalCount: c.totalCount, collected: c.collected, pages: c.pages, errors: c.errors, at: new Date().toISOString() };
      if (c.status === 'COMPLETE') fs.writeFileSync(path.join(RAW, d, `${ym}.json.gz`), zlib.gzipSync(JSON.stringify(c.items)));
      if (++fetched % 24 === 0) fs.writeFileSync(path.join(CELLS, `${d}.json`), JSON.stringify(cells));
    }
    fs.writeFileSync(path.join(CELLS, `${d}.json`), JSON.stringify(cells));
    const vals = Object.values(cells);
    console.log(`${d} cells=${vals.length}/${months.length} complete=${vals.filter((v) => v.status === 'COMPLETE').length} rows=${vals.reduce((s, v) => s + (v.totalCount ?? 0), 0)} remaining=${quota.remaining} calls=${quota.calls}`);
  }
}

async function phasePreStart() {
  // 2006-01 이전 달이 모든 구에서 0인지(공식 제공 시작 월 확인) — 구마다 1회.
  const rows: { lawdCd: string; ym: string; kind: string; totalCount: number | null }[] = [];
  for (const d of FETCH_ORDER) {
    const r = await fetchPage(d, '200512', 1, 1);
    rows.push({ lawdCd: d, ym: '200512', kind: r.kind, totalCount: r.kind === 'OK' ? r.totalCount : null });
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'pre-2006-probe.json'), JSON.stringify({ at: new Date().toISOString(), rows, calls: quota.calls, remaining: quota.remaining }, null, 2));
  console.log(JSON.stringify({ nonZero: rows.filter((r) => r.totalCount !== 0).length, errors: rows.filter((r) => r.kind !== 'OK').length, remaining: quota.remaining }));
}

/** early-probe(2005-07~12) 결과에서 행이 있던 (구, 달). 추정하지 않고 실측 파일만 읽는다. */
export function preStartCells(): { lawdCd: string; ym: string; total: number }[] {
  const out: { lawdCd: string; ym: string; total: number }[] = [];
  const f1 = path.join(OUT, 'early-probe-2005.json');
  const f2 = path.join(OUT, 'early-probe.json');
  const f3 = path.join(OUT, 'pre-2006-probe.json');
  if (fs.existsSync(f1)) for (const r of JSON.parse(fs.readFileSync(f1, 'utf8')).out) if (r.total > 0) out.push({ lawdCd: r.d, ym: r.ym, total: r.total });
  if (fs.existsSync(f2)) for (const r of JSON.parse(fs.readFileSync(f2, 'utf8')).out) if (r.total > 0) out.push({ lawdCd: r.d, ym: r.ym, total: r.total });
  if (fs.existsSync(f3)) for (const r of JSON.parse(fs.readFileSync(f3, 'utf8')).rows) if (r.totalCount > 0) out.push({ lawdCd: r.lawdCd, ym: r.ym, total: r.totalCount });
  return out.sort((a, b) => (a.lawdCd + a.ym).localeCompare(b.lawdCd + b.ym));
}

function phaseStatus(months: string[]) {
  let total = 0;
  for (const d of FETCH_ORDER) {
    const vals = Object.entries(loadCells(d));
    const complete = vals.filter(([, v]) => v.status === 'COMPLETE');
    total += complete.reduce((s, [, v]) => s + (v.totalCount ?? 0), 0);
    console.log(`${d} complete=${complete.length}/${months.length} notComplete=${vals.length - complete.length} rows=${complete.reduce((s, [, v]) => s + (v.totalCount ?? 0), 0)}`);
  }
  console.log(`TOTAL_ROWS_IN_COMPLETE_CELLS=${total}`);
}

// ───────────────────────── phase: report (read-only 분석) ─────────────────────────
// 운영과 같은 정규화 경로(mapMolitItems → normalizeMolitItemsToTradeRows)로 행을 만들고,
// 서울 master(aptSeq)·기존 서울 매매 46행을 READ ONLY로만 읽어 대조한다.


export type MasterClass = 'EXACT_MASTER' | 'MASTER_MISSING' | 'INVALID_APTSEQ' | 'REVIEW_REQUIRED';

/** 거래 → master 분류(aptSeq만 사용, 이름·지번 추정 없음). */
export function classifyMaster(row: Pick<TradeRowInput, 'aptSeq' | 'lawdCd'>, masters: ReadonlySet<string>): MasterClass {
  const seq = (row.aptSeq ?? '').trim();
  if (!/^\d{5}-\d+$/.test(seq) || !seq.startsWith('11')) return 'INVALID_APTSEQ';
  if (seq.slice(0, 5) !== row.lawdCd) return 'REVIEW_REQUIRED'; // 이웃 구 응답에 실린 행(구 오기재)
  return masters.has(seq) ? 'EXACT_MASTER' : 'MASTER_MISSING';
}

export const naturalKey = (r: Pick<TradeRowInput, 'groupKeyStr' | 'dealAmount' | 'dealDate' | 'floor' | 'occurrenceIndex'>) =>
  `${r.groupKeyStr}|${r.dealAmount}|${r.dealDate}|${r.floor}|${r.occurrenceIndex}`;
export const occurrenceGroup = (r: Pick<TradeRowInput, 'groupKeyStr' | 'dealAmount' | 'dealDate' | 'floor'>) =>
  `${r.groupKeyStr}|${r.dealAmount}|${r.dealDate}|${r.floor}`;

/** 같은 셀을 역순으로 정규화해도 그룹별 (건수, 취소 수)는 같고, 슬롯별 취소 위치만 달라질 수 있다. */
export function orderSensitivity(items: any[], lawdCd: string, ym: string) {
  const a = normalizeMolitItemsToTradeRows(mapMolitItems(items, 'apt', lawdCd, ym) as any, lawdCd, ym).rows;
  const b = normalizeMolitItemsToTradeRows(mapMolitItems([...items].reverse(), 'apt', lawdCd, ym) as any, lawdCd, ym).rows;
  const agg = (rows: TradeRowInput[]) => {
    const m = new Map<string, { n: number; c: number; slots: Map<number, boolean> }>();
    for (const r of rows) {
      const g = occurrenceGroup(r);
      const e = m.get(g) ?? { n: 0, c: 0, slots: new Map() };
      e.n++; if (r.dealCanceled) e.c++; e.slots.set(r.occurrenceIndex, r.dealCanceled);
      m.set(g, e);
    }
    return m;
  };
  const ma = agg(a);
  const mb = agg(b);
  let countsDiffer = 0;
  let slotDiffer = 0;
  for (const [g, x] of ma) {
    const y = mb.get(g);
    if (!y || y.n !== x.n || y.c !== x.c) { countsDiffer++; continue; }
    for (const [slot, canceled] of x.slots) if (y.slots.get(slot) !== canceled) { slotDiffer++; break; }
  }
  return { groups: ma.size, countsDiffer, slotDiffer };
}

async function phaseReport() {
  const { PrismaClient } = await import('@prisma/client');
  const { assertProductionDbAccessAllowed } = await import('./_prod-db-guard');
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'audit-seoul-sale-backfill-plan(report)');
  const prisma = new PrismaClient();
  const db = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const masters = await tx.$queryRawUnsafe<{ apt_seq: string }[]>(`SELECT apt_seq FROM apartment_masters WHERE sgg_cd LIKE '11%'`);
    const pilot = await tx.$queryRawUnsafe<any[]>(`SELECT id, apt_seq, lawd_cd, deal_ymd, group_key, deal_amount, deal_date::text AS deal_date, floor, occurrence_index, deal_canceled, cancel_date, registry_date, exclusive_area::text AS exclusive_area, apt_name
      FROM apartment_trade_histories WHERE lawd_cd LIKE '11%' ORDER BY id`);
    return { masters, pilot };
  }, { timeout: 120000 });
  await prisma.$disconnect();
  const masters = new Set(db.masters.map((m) => m.apt_seq));

  const months = monthRange('200601', kstYm());
  const early = preStartCells();
  const districtYear: Record<string, Record<string, any>> = {};
  const paging: any[] = [];
  const masterCounts: Record<string, number> = { EXACT_MASTER: 0, MASTER_MISSING: 0, INVALID_APTSEQ: 0, REVIEW_REQUIRED: 0 };
  const masterByDistrict: Record<string, Record<string, number>> = {};
  const missingSeqs = new Map<string, { rows: number; name: string; lastDate: string; lawdCd: string }>();
  const invalidReasons: Record<string, number> = {};
  const nkSeen = new Map<string, string>(); // naturalKey → cell
  const nkCollisions: { key: string; cells: string[] }[] = [];
  const crossDistrictRows: { lawdCd: string; ym: string; aptSeq: string; key: string }[] = [];
  let sameConditionGroups = 0;
  let sameConditionRows = 0;
  let exactDuplicateRows = 0;
  let mixedCancelGroups = 0;
  const order = { cells: 0, groups: 0, countsDiffer: 0, slotDiffer: 0 };
  const reviewSamples: any[] = [];
  const pilotSource = new Map<string, TradeRowInput>();
  const districtsMeasured: string[] = [];

  for (const d of FETCH_ORDER) {
    const cells = loadCells(d);
    const want = [...early.filter((c) => c.lawdCd === d).map((c) => c.ym), ...months];
    const complete = want.filter((ym) => cells[ym]?.status === 'COMPLETE');
    const districtDone = complete.length === want.length;
    if (!complete.length) continue;
    if (districtDone) districtsMeasured.push(d);
    masterByDistrict[d] = { EXACT_MASTER: 0, MASTER_MISSING: 0, INVALID_APTSEQ: 0, REVIEW_REQUIRED: 0 };
    for (const ym of complete) {
      const cp = cells[ym];
      paging.push({ lawdCd: d, ym, totalCount: cp.totalCount, collected: cp.collected, pages: cp.pages });
      const items = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(RAW, d, `${ym}.json.gz`))).toString('utf8'));
      const norm = normalizeMolitItemsToTradeRows(mapMolitItems(items, 'apt', d, ym) as any, d, ym);
      const y = ym.slice(0, 4);
      const dy = ((districtYear[d] ??= {})[y] ??= { source: 0, normalized: 0, invalid: 0, active: 0, canceled: 0, cells: 0, calls: 0 });
      dy.source += cp.totalCount ?? 0; dy.normalized += norm.rows.length; dy.invalid += norm.invalid.length; dy.cells++; dy.calls += Math.max(1, cp.pages);
      for (const inv of norm.invalid) invalidReasons[inv.reason] = (invalidReasons[inv.reason] ?? 0) + 1;
      // 정확 중복(원천 전체 필드가 같은 행)
      const rawSeen = new Set<string>();
      for (const it of items) { const k = JSON.stringify(it); if (rawSeen.has(k)) exactDuplicateRows++; else rawSeen.add(k); }
      const groups = new Map<string, { n: number; c: number }>();
      for (const r of norm.rows) {
        if (r.dealCanceled) dy.canceled++; else dy.active++;
        const mc = classifyMaster(r, masters);
        masterCounts[mc]++; masterByDistrict[d][mc]++;
        if (mc === 'MASTER_MISSING') {
          const e = missingSeqs.get(r.aptSeq!) ?? { rows: 0, name: r.aptName, lastDate: '', lawdCd: d };
          e.rows++; if (r.dealDate > e.lastDate) e.lastDate = r.dealDate; missingSeqs.set(r.aptSeq!, e);
        }
        if (mc === 'REVIEW_REQUIRED' || mc === 'INVALID_APTSEQ') { if (reviewSamples.length < 200) reviewSamples.push({ class: mc, lawdCd: d, ym, aptSeq: r.aptSeq, name: r.aptName, dong: r.dong, dealDate: r.dealDate }); }
        const nk = naturalKey(r);
        const prev = nkSeen.get(nk);
        if (prev) nkCollisions.push({ key: nk, cells: [prev, `${d}:${ym}`] }); else nkSeen.set(nk, `${d}:${ym}`);
        if (r.aptSeq && r.aptSeq.slice(0, 5) !== d) crossDistrictRows.push({ lawdCd: d, ym, aptSeq: r.aptSeq, key: nk });
        const g = occurrenceGroup(r);
        const e = groups.get(g) ?? { n: 0, c: 0 };
        e.n++; if (r.dealCanceled) e.c++; groups.set(g, e);
        if (d === '11680' && ym === '202608') pilotSource.set(nk, r);
      }
      for (const e of groups.values()) {
        if (e.n > 1) { sameConditionGroups++; sameConditionRows += e.n; }
        if (e.c > 0 && e.c < e.n) mixedCancelGroups++;
      }
      const os = orderSensitivity(items, d, ym);
      order.cells++; order.groups += os.groups; order.countsDiffer += os.countsDiffer; order.slotDiffer += os.slotDiffer;
    }
  }

  // 이웃 구 응답 행이 canonical 구 응답에도 같은 자연키로 있는가(중복 게재) — 아니면 그 구에만 있는 행
  const crossDup = crossDistrictRows.filter((x) => nkCollisions.some((c) => c.key === x.key)).length;

  // 기존 서울 매매 46행 대조(자연키 + 취소 상태)
  const pilotRec = db.pilot.map((p: any) => {
    const area = Number(p.exclusive_area);
    const nk = `${p.group_key}|${p.deal_amount}|${p.deal_date}|${p.floor}|${p.occurrence_index}`;
    const src = pilotSource.get(nk);
    const sameGroupRows = [...pilotSource.values()].filter((r) => occurrenceGroup(r) === `${p.group_key}|${p.deal_amount}|${p.deal_date}|${p.floor}`);
    return {
      id: p.id, aptSeq: p.apt_seq, name: p.apt_name, dealDate: p.deal_date, amount: p.deal_amount, area, floor: p.floor, occurrenceIndex: p.occurrence_index,
      dbCanceled: p.deal_canceled, match: src ? 'NATURAL_KEY_EXACT' : sameGroupRows.length ? 'GROUP_ONLY' : 'NOT_IN_SOURCE',
      srcCanceled: src ? src.dealCanceled : null, cancelStateSame: src ? src.dealCanceled === p.deal_canceled : null,
      master: masters.has(p.apt_seq) ? 'EXACT_MASTER' : 'MASTER_MISSING',
      sourceGroupSize: sameGroupRows.length, sourceGroupCanceled: sameGroupRows.filter((r) => r.dealCanceled).length,
    };
  });

  // 연도별 합계
  const years: Record<string, any> = {};
  for (const d of Object.keys(districtYear)) for (const [y, v] of Object.entries(districtYear[d])) {
    const t = (years[y] ??= { source: 0, normalized: 0, invalid: 0, active: 0, canceled: 0, cells: 0, calls: 0, districts: 0 });
    for (const k of ['source', 'normalized', 'invalid', 'active', 'canceled', 'cells', 'calls']) t[k] += (v as any)[k];
    t.districts++;
  }
  const totals = Object.values(years).reduce((a: any, v: any) => { for (const k of ['source', 'normalized', 'invalid', 'active', 'canceled', 'cells', 'calls']) a[k] = (a[k] ?? 0) + v[k]; return a; }, {});
  const written = { at: new Date().toISOString(), districtsMeasured, districtsPartial: Object.keys(districtYear).filter((d) => !districtsMeasured.includes(d)) };
  fs.writeFileSync(path.join(OUT, 'district-year-counts.json'), JSON.stringify({ ...written, years, districtYear }, null, 2));
  fs.writeFileSync(path.join(OUT, 'paging-audit.json'), JSON.stringify({ ...written, cells: paging.length, complete: paging.length, multiPage: paging.filter((p) => p.pages > 1).length,
    maxTotal: paging.reduce((m, p) => Math.max(m, p.totalCount ?? 0), 0), collectedEqTotal: paging.every((p) => p.collected === p.totalCount), biggest: [...paging].sort((a, b) => (b.totalCount ?? 0) - (a.totalCount ?? 0)).slice(0, 15) }, null, 2));
  const missingList = [...missingSeqs.entries()].map(([aptSeq, v]) => ({ aptSeq, ...v })).sort((a, b) => b.rows - a.rows);
  fs.writeFileSync(path.join(OUT, 'master-reconciliation.json'), JSON.stringify({ ...written, masterCounts, masterByDistrict,
    exactRate: masterCounts.EXACT_MASTER / Object.values(masterCounts).reduce((s, v) => s + v, 0),
    missingAptSeqs: missingList.length, missingLastDealBefore202410: missingList.filter((m) => m.lastDate < '2024-10-01').length, missingTop: missingList.slice(0, 50) }, null, 2));
  fs.writeFileSync(path.join(OUT, 'cancellation-audit.json'), JSON.stringify({ ...written, canceled: totals.canceled, active: totals.active,
    sameConditionGroups, sameConditionRows, mixedCancelGroups, orderSensitivity: order,
    note: '같은 셀을 역순으로 정규화: 그룹별 건수·취소 수는 불변(countsDiffer), 취소가 어느 occurrence 슬롯에 붙는지는 응답 순서에 따라 달라짐(slotDiffer) — 새 그룹 insert는 건수·취소 수만 정확하면 되고, 기존 그룹은 count 기반 reconcile을 쓴다.' }, null, 2));
  fs.writeFileSync(path.join(OUT, 'review-required.json'), JSON.stringify({ ...written, counts: { REVIEW_REQUIRED: masterCounts.REVIEW_REQUIRED, INVALID_APTSEQ: masterCounts.INVALID_APTSEQ },
    crossDistrictRows: crossDistrictRows.length, crossDistrictDuplicatedInHome: crossDup, naturalKeyCollisions: nkCollisions.length, collisionsSample: nkCollisions.slice(0, 30), invalidReasons, samples: reviewSamples }, null, 2));
  fs.writeFileSync(path.join(OUT, 'existing-46-reconcile.json'), JSON.stringify({ ...written, rows: pilotRec.length,
    byMatch: pilotRec.reduce((m: any, r: any) => ((m[r.match] = (m[r.match] ?? 0) + 1), m), {}), cancelStateSame: pilotRec.filter((r: any) => r.cancelStateSame).length,
    master: pilotRec.reduce((m: any, r: any) => ((m[r.master] = (m[r.master] ?? 0) + 1), m), {}), detail: pilotRec }, null, 2));
  const summary = { ...written, totals, exactDuplicateRows, masterCounts, invalidReasons, sameConditionGroups, sameConditionRows, mixedCancelGroups, order,
    crossDistrictRows: crossDistrictRows.length, crossDup, nkCollisions: nkCollisions.length, pilot: { rows: pilotRec.length, byMatch: pilotRec.reduce((m: any, r: any) => ((m[r.match] = (m[r.match] ?? 0) + 1), m), {}) } };
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
}

async function main() {
  const argv = process.argv.slice(2);
  const get = (k: string) => argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
  const reserve = Number(get('reserve') ?? 2000);
  const districts = get('districts')?.split(',') ?? FETCH_ORDER;
  const months = monthRange('200601', get('to') ?? kstYm());
  if (argv[0] === 'fetch') {
    // 2005년 하반기 소량 신고분(early-probe 결과에서 행이 있던 달만) + 2006-01 ~ 현재 달
    const early = preStartCells();
    for (const d of districts) {
      const extra = early.filter((c) => c.lawdCd === d).map((c) => c.ym);
      if (extra.length) await phaseFetch(reserve, [d], [...extra, ...months]);
      else await phaseFetch(reserve, [d], months);
      if (quota.remaining != null && quota.remaining <= reserve) break;
    }
    console.log(`FETCH_DONE calls=${quota.calls} remaining=${quota.remaining}`);
  }
  else if (argv[0] === 'prestart') await phasePreStart();
  else if (argv[0] === 'status') phaseStatus(months);
  else if (argv[0] === 'report') await phaseReport();
  else { console.error('usage: fetch|prestart|status'); process.exit(1); }
}

if (require.main === module) main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
