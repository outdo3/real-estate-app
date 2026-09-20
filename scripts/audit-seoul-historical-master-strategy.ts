/**
 * SEOUL_HISTORICAL_MASTER_MISSING_STRATEGY_V1 — MASTER_MISSING 2,424 aptSeq 전수 census (STRICT READ ONLY).
 *
 * 이미 수집해 둔 셀 원천(raw/*.json.gz)을 운영과 같은 정규화 경로로 다시 읽어 aptSeq별 프로필을
 * 만들고, 현재 master와의 관계를 **exact 증거로만** 분류한다.
 *
 * 금지(코드로 강제): substring · 유사도 · 같은 동 + 비슷한 이름 · first-match.
 * 허용되는 증거는 전부 MOLIT 원본 필드의 **완전 일치**뿐이다:
 *   LOT   sggCd|umdCd|bonbun|bubun      (법정 필지 — 원천 bonbun/bubun을 정수로 정규화)
 *   ROAD  roadNmSggCd|roadNmCd|roadNmBonbun|roadNmBubun (도로명주소 코드)
 *   NAME  aptNm 문자열 완전 일치 (**신호일 뿐 identity 증거가 아니다**)
 *
 * master의 road_address는 서울 6,843건 전부 비어 있으므로(건축물대장 미연동), master 쪽 ROAD 키도
 * 같은 원천에서 유도한다 — 양쪽이 같은 MOLIT 필드라 비교가 대칭이다.
 *
 * DB는 SELECT만(`SET TRANSACTION READ ONLY`). INSERT/UPDATE/DELETE 0. master 생성 0. 외부 API 0.
 *
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/audit-seoul-historical-master-strategy.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import * as zlib from 'zlib';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { mapMolitItems } from '../src/lib/api-molit';
import { normalizeMolitItemsToTradeRows } from './trade-history-logic';
import { FETCH_ORDER, OUT, monthRange, kstYm, preStartCells, type CellCheckpoint } from './audit-seoul-sale-backfill-plan';

const RAW = path.join(OUT, 'raw');
const CELLS = path.join(OUT, 'cells');

export interface SeqProfile {
  aptSeq: string;
  lawdCd: string;
  names: string[];
  dongs: string[];
  lots: string[];
  roads: string[];
  buildYears: number[];
  rows: number;
  active: number;
  canceled: number;
  firstDate: string;
  lastDate: string;
}

/** 원천 bonbun/bubun을 정수로 정규화한 법정 필지 키. 한 값이라도 비면 null(추측하지 않는다). */
export function lotKey(it: { sggCd?: string; umdCd?: string; bonbun?: string; bubun?: string }): string | null {
  const s = String(it.sggCd ?? '').trim();
  const u = String(it.umdCd ?? '').trim();
  const b = String(it.bonbun ?? '').trim();
  const j = String(it.bubun ?? '').trim();
  if (!s || !u || !b) return null;
  const bn = Number(b);
  const jn = j === '' ? 0 : Number(j);
  if (!Number.isFinite(bn) || !Number.isFinite(jn)) return null;
  return `${s}|${u}|${bn}|${jn}`;
}

/** 도로명주소 코드 키. 한 값이라도 비면 null. */
export function roadKey(it: { roadNmSggCd?: string; roadNmCd?: string; roadNmBonbun?: string; roadNmBubun?: string }): string | null {
  const s = String(it.roadNmSggCd ?? '').trim();
  const c = String(it.roadNmCd ?? '').trim();
  const b = String(it.roadNmBonbun ?? '').trim();
  const j = String(it.roadNmBubun ?? '').trim();
  if (!s || !c || !b) return null;
  const bn = Number(b);
  const jn = j === '' ? 0 : Number(j);
  if (!Number.isFinite(bn) || !Number.isFinite(jn) || bn === 0) return null;
  return `${s}|${c}|${bn}|${jn}`;
}

/** master.jibun("55" 또는 "178-76")을 원천과 같은 정수쌍으로 정규화. 형식이 아니면 null. */
export function masterLotKey(m: { sggCd: string | null; umdCd: string | null; jibun: string | null }): string | null {
  if (!m.sggCd || !m.umdCd || !m.jibun) return null;
  const mm = /^(\d+)(?:-(\d+))?$/.exec(m.jibun.trim());
  if (!mm) return null;
  return `${m.sggCd}|${m.umdCd}|${Number(mm[1])}|${mm[2] ? Number(mm[2]) : 0}`;
}

export type Relationship = 'A_SAME_APTSEQ' | 'B_EXACT_LOT' | 'C_EXACT_ROAD' | 'D_NAME_ONLY_SIGNAL' | 'E_NO_RELATIONSHIP';

export type SameLotVerdict =
  | 'SAME_PHYSICAL_COMPLEX_STRONG_SIGNAL'
  | 'REDEVELOPMENT_SUCCESSOR_SIGNAL'
  | 'LOT_SHARED_MULTIPLE_COMPLEX'
  | 'UNRESOLVED';

/**
 * 같은 필지를 공유하는 (과거 aptSeq, 현재 master aptSeq) 한 쌍의 판정 — 날짜 순서와 완전 일치만 쓴다.
 *  - 거래 기간이 겹치면 두 단지가 동시에 존재한 것이다(재건축 승계가 아니다).
 *  - 겹치지 않고 master가 나중이며 준공년도가 더 새로우면 재건축 승계 **신호**.
 *  - 겹치지 않고 이름이 완전히 같으면 같은 물리 단지의 표기/코드 변경 **신호**.
 */
export function judgeSameLot(hist: SeqProfile, cur: SeqProfile): SameLotVerdict {
  const overlap = hist.firstDate <= cur.lastDate && cur.firstDate <= hist.lastDate;
  if (overlap) return 'LOT_SHARED_MULTIPLE_COMPLEX';
  const sameName = hist.names.some((n) => cur.names.includes(n));
  if (sameName) return 'SAME_PHYSICAL_COMPLEX_STRONG_SIGNAL';
  const hy = Math.max(...hist.buildYears, 0);
  const cy = Math.max(...cur.buildYears, 0);
  if (cur.firstDate > hist.lastDate && cy > hy && hy > 0 && cy > 0) return 'REDEVELOPMENT_SUCCESSOR_SIGNAL';
  return 'UNRESOLVED';
}

export function volumeBucket(n: number): string {
  if (n === 1) return '1';
  if (n <= 4) return '2-4';
  if (n <= 9) return '5-9';
  if (n <= 49) return '10-49';
  if (n <= 99) return '50-99';
  if (n <= 499) return '100-499';
  return '500+';
}

export function lastTradeBucket(d: string): string {
  const y = Number(d.slice(0, 4));
  if (y <= 2015) return '<=2015';
  if (y <= 2019) return '2016-2019';
  if (y <= 2022) return '2020-2022';
  return String(y);
}

function loadCells(lawdCd: string): Record<string, CellCheckpoint> {
  const p = path.join(CELLS, `${lawdCd}.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
}

const add = <T>(arr: T[], v: T) => { if (v != null && !arr.includes(v)) arr.push(v); };

async function main() {
  const { PrismaClient } = await import('@prisma/client');
  const { assertProductionDbAccessAllowed } = await import('./_prod-db-guard');
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'audit-seoul-historical-master-strategy.ts');
  const prisma = new PrismaClient();
  const masters = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    return tx.$queryRawUnsafe<{ apt_seq: string; name: string; sgg_cd: string | null; umd_cd: string | null; umd_name: string | null; jibun: string | null; build_year: number | null; road_address: string | null }[]>(
      `SELECT apt_seq, name, sgg_cd, umd_cd, umd_name, jibun, build_year, road_address
       FROM apartment_masters WHERE apt_seq IS NOT NULL AND sgg_cd LIKE '11%'`);
  }, { timeout: 180_000 });
  await prisma.$disconnect();

  const masterSet = new Set(masters.map((m) => m.apt_seq));
  const masterByLot = new Map<string, string[]>();
  let masterWithRoadAddress = 0;
  for (const m of masters) {
    if (m.road_address) masterWithRoadAddress++;
    const k = masterLotKey({ sggCd: m.sgg_cd, umdCd: m.umd_cd, jibun: m.jibun });
    if (k) (masterByLot.get(k) ?? masterByLot.set(k, []).get(k)!).push(m.apt_seq);
  }

  // ── 원천 전수 프로필 (master 유무와 무관하게 모든 aptSeq) ──
  const months = monthRange('200601', kstYm());
  const early = preStartCells();
  const prof = new Map<string, SeqProfile>();
  for (const d of FETCH_ORDER) {
    const cells = loadCells(d);
    const want = [...early.filter((c) => c.lawdCd === d).map((c) => c.ym), ...months];
    for (const ym of want.filter((y) => cells[y]?.status === 'COMPLETE')) {
      const items: any[] = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(RAW, d, `${ym}.json.gz`))).toString('utf8'));
      const { rows } = normalizeMolitItemsToTradeRows(mapMolitItems(items, 'apt', d, ym) as any, d, ym);
      // 정규화 행과 원천 아이템을 같은 순서로 대응시키지 않고, aptSeq 단위 집계만 한다.
      for (const r of rows) {
        const seq = (r.aptSeq ?? '').trim();
        if (!seq) continue;
        let p = prof.get(seq);
        if (!p) { p = { aptSeq: seq, lawdCd: r.lawdCd, names: [], dongs: [], lots: [], roads: [], buildYears: [], rows: 0, active: 0, canceled: 0, firstDate: r.dealDate, lastDate: r.dealDate }; prof.set(seq, p); }
        p.rows++;
        if (r.dealCanceled) p.canceled++; else p.active++;
        add(p.names, r.aptName); add(p.dongs, r.dong);
        if (r.buildYear != null) add(p.buildYears, r.buildYear);
        if (r.dealDate < p.firstDate) p.firstDate = r.dealDate;
        if (r.dealDate > p.lastDate) p.lastDate = r.dealDate;
      }
      for (const it of items) {
        const seq = String(it.aptSeq ?? '').trim();
        const p = prof.get(seq);
        if (!p) continue;
        const lk = lotKey(it); if (lk) add(p.lots, lk);
        const rk = roadKey(it); if (rk) add(p.roads, rk);
      }
    }
  }

  // 원천에서 유도한 master 쪽 키(양쪽 대칭 비교용)
  const masterLotFromSource = new Map<string, string[]>();
  const masterRoadFromSource = new Map<string, string[]>();
  const masterNameExact = new Map<string, string[]>();
  for (const [seq, p] of prof) {
    if (!masterSet.has(seq)) continue;
    for (const l of p.lots) (masterLotFromSource.get(l) ?? masterLotFromSource.set(l, []).get(l)!).push(seq);
    for (const r of p.roads) (masterRoadFromSource.get(r) ?? masterRoadFromSource.set(r, []).get(r)!).push(seq);
    for (const n of p.names) (masterNameExact.get(`${p.lawdCd}|${n}`) ?? masterNameExact.set(`${p.lawdCd}|${n}`, []).get(`${p.lawdCd}|${n}`)!).push(seq);
  }

  // ── 분류 ──
  const missing = [...prof.values()].filter((p) => !masterSet.has(p.aptSeq));
  const results = missing.map((p) => {
    const lotHits = [...new Set(p.lots.flatMap((l) => [...(masterLotFromSource.get(l) ?? []), ...(masterByLot.get(l) ?? [])]))].filter((s) => s !== p.aptSeq);
    const roadHits = [...new Set(p.roads.flatMap((r) => masterRoadFromSource.get(r) ?? []))].filter((s) => s !== p.aptSeq);
    const nameHits = [...new Set(p.names.flatMap((n) => masterNameExact.get(`${p.lawdCd}|${n}`) ?? []))].filter((s) => s !== p.aptSeq);
    const rel: Relationship = masterSet.has(p.aptSeq) ? 'A_SAME_APTSEQ'
      : lotHits.length ? 'B_EXACT_LOT'
      : roadHits.length ? 'C_EXACT_ROAD'
      : nameHits.length ? 'D_NAME_ONLY_SIGNAL'
      : 'E_NO_RELATIONSHIP';
    return { ...p, rel, lotHits, roadHits, nameHits,
      volumeBucket: volumeBucket(p.rows), lastTradeBucket: lastTradeBucket(p.lastDate) };
  });

  const tally = <T extends string>(items: { rows: number }[], keyOf: (x: any) => T) => {
    const m: Record<string, { aptSeqs: number; rows: number }> = {};
    for (const it of items) { const k = keyOf(it); const e = (m[k] ??= { aptSeqs: 0, rows: 0 }); e.aptSeqs++; e.rows += it.rows; }
    return m;
  };

  // ── 같은 필지 쌍 상세 ──
  const sameLotPairs: unknown[] = [];
  for (const r of results.filter((x) => x.rel === 'B_EXACT_LOT')) {
    for (const cur of r.lotHits) {
      const c = prof.get(cur);
      if (!c) { sameLotPairs.push({ historical: r.aptSeq, current: cur, verdict: 'UNRESOLVED', note: 'current master has no source trades in range' }); continue; }
      sameLotPairs.push({
        historical: r.aptSeq, historicalName: r.names.join(' / '), historicalRows: r.rows,
        historicalFirst: r.firstDate, historicalLast: r.lastDate, historicalBuildYear: Math.max(...r.buildYears, 0),
        current: cur, currentName: c.names.join(' / '), currentRows: c.rows,
        currentFirst: c.firstDate, currentLast: c.lastDate, currentBuildYear: Math.max(...c.buildYears, 0),
        lawdCd: r.lawdCd, dong: r.dongs.join('/'), lots: r.lots,
        verdict: judgeSameLot(r, c),
      });
    }
  }

  const out = {
    at: new Date().toISOString(), readOnly: true, apiCalls: 0, masterCreated: 0,
    baseline: {
      masterSeoul: masters.length, masterWithRoadAddress,
      sourceAptSeqTotal: prof.size, missingAptSeqs: missing.length,
      missingRows: missing.reduce((s, p) => s + p.rows, 0),
      missingActive: missing.reduce((s, p) => s + p.active, 0),
      missingCanceled: missing.reduce((s, p) => s + p.canceled, 0),
    },
    relationship: tally(results, (x) => x.rel),
    volume: tally(results, (x) => x.volumeBucket),
    lastTrade: tally(results, (x) => x.lastTradeBucket),
    lastTradeByYear: tally(results, (x: any) => x.lastDate.slice(0, 4)),
    byDistrict: tally(results, (x: any) => x.lawdCd),
    sameLot: {
      historicalAptSeqs: results.filter((x) => x.rel === 'B_EXACT_LOT').length,
      rows: results.filter((x) => x.rel === 'B_EXACT_LOT').reduce((s, x) => s + x.rows, 0),
      pairs: sameLotPairs.length,
      verdicts: (sameLotPairs as any[]).reduce((m: any, p: any) => ((m[p.verdict] = (m[p.verdict] ?? 0) + 1), m), {}),
    },
    topMissing: [...results].sort((a, b) => b.rows - a.rows).slice(0, 30)
      .map((r) => ({ aptSeq: r.aptSeq, name: r.names.join(' / '), rows: r.rows, active: r.active, canceled: r.canceled, first: r.firstDate, last: r.lastDate, rel: r.rel, lotHits: r.lotHits })),
    sameLotPairs,
  };
  fs.writeFileSync(path.join(OUT, 'historical-master-strategy.json'), JSON.stringify({ ...out, all: results }, null, 2));
  console.log(JSON.stringify({ ...out, sameLotPairs: sameLotPairs.length, topMissing: out.topMissing.length }, null, 2));
}

if (require.main === module) main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
