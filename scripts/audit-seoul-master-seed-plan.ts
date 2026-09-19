/**
 * SEOUL_MASTER_SEED_PLAN_V1 — 서울 ApartmentMaster seed 계획용 read-only probe.
 *
 * STRICT READ ONLY:
 *   - Production DB: `SET TRANSACTION READ ONLY` 안에서 집계 SELECT + 서울 파일럿 매매 46행만. INSERT/UPDATE/DELETE 0.
 *   - MOLIT(매매·전월세): GET만. 동시 1 · 최소 간격 350ms · pageNo/totalCount 검증(부분 셀은 PARTIAL로 기록).
 *   - 건축물대장·Kakao: 표본 enrichment probe만(저장 안 함). 건축물대장은 1.5s 간격(M4-B 실측 초당 제한).
 *   - serviceKey/API key는 출력하지 않는다(URL을 로그에 찍지 않는다).
 *   - 결과는 tmp/seoul-master-seed-plan/ 에만 쓴다(Production write 없음).
 *
 * 실행(단계별):
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/audit-seoul-master-seed-plan.ts db
 *   npx tsx scripts/audit-seoul-master-seed-plan.ts discover [sale|rent|both]
 *   npx tsx scripts/audit-seoul-master-seed-plan.ts history
 *   npx tsx scripts/audit-seoul-master-seed-plan.ts enrich [sampleSize]
 *   npx tsx scripts/audit-seoul-master-seed-plan.ts report
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { XMLParser } from 'fast-xml-parser';
import {
  aggregateCandidates,
  auditDuplicates,
  classifyCoordinate,
  classifyIdentity,
  quotaWindows,
  reconcilePilotRow,
  resolveCrossDistrict,
  buildDongCodeMap,
  resolveUmdCd,
  type PilotRow,
  type RawTradeItem,
  type SeedCandidate,
} from './seoul-master-seed-plan-logic';

const OUT = path.resolve(__dirname, '../tmp/seoul-master-seed-plan');
const RAW = path.join(OUT, 'raw');
fs.mkdirSync(RAW, { recursive: true });
const writeJson = (p: string, v: unknown) => fs.writeFileSync(p, JSON.stringify(v, null, 2));
const readJson = <T>(p: string): T => JSON.parse(fs.readFileSync(p, 'utf8')) as T;

export const SEOUL_DISTRICTS: { lawdCd: string; name: string }[] = [
  ['11110', '종로구'], ['11140', '중구'], ['11170', '용산구'], ['11200', '성동구'], ['11215', '광진구'],
  ['11230', '동대문구'], ['11260', '중랑구'], ['11290', '성북구'], ['11305', '강북구'], ['11320', '도봉구'],
  ['11350', '노원구'], ['11380', '은평구'], ['11410', '서대문구'], ['11440', '마포구'], ['11470', '양천구'],
  ['11500', '강서구'], ['11530', '구로구'], ['11545', '금천구'], ['11560', '영등포구'], ['11590', '동작구'],
  ['11620', '관악구'], ['11650', '서초구'], ['11680', '강남구'], ['11710', '송파구'], ['11740', '강동구'],
].map(([lawdCd, name]) => ({ lawdCd, name }));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const key = () => encodeURIComponent(decodeURIComponent((process.env.DATA_GO_KR_API_KEY || '').trim().replace(/['"]/g, '')));
// 원천 표기를 그대로 보존(코드·지번의 앞자리 0 손실 방지) — 숫자 변환하지 않는다.
const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false });

const ENDPOINTS = {
  SALE: 'http://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev',
  RENT: 'http://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent',
} as const;
type Dataset = keyof typeof ENDPOINTS;

let lastMolitAt = 0;
const callCount: Record<string, number> = { SALE: 0, RENT: 0, LEDGER: 0, KAKAO: 0 };

interface PageResult { ok: boolean; totalCount: number | null; items: RawTradeItem[]; error: string | null; rateLimited: boolean }

async function molitPage(ds: Dataset, lawdCd: string, ym: string, pageNo: number, numOfRows: number): Promise<PageResult> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const wait = lastMolitAt + 350 - Date.now();
    if (wait > 0) await sleep(wait);
    lastMolitAt = Date.now();
    callCount[ds]++;
    try {
      const res = await fetch(`${ENDPOINTS[ds]}?serviceKey=${key()}&LAWD_CD=${lawdCd}&DEAL_YMD=${ym}&pageNo=${pageNo}&numOfRows=${numOfRows}`, {
        headers: { Accept: 'application/xml, text/xml, */*' }, signal: AbortSignal.timeout(15000),
      });
      const text = await res.text();
      const rateLimited = res.status === 429 || /LIMITED_NUMBER_OF_SERVICE_REQUESTS|초당\s*서비스\s*요청\s*제한/.test(text);
      if (rateLimited) { await sleep(1000 * 2 ** attempt); continue; }
      const j = parser.parse(text);
      const code = j?.response?.header?.resultCode != null ? String(j.response.header.resultCode) : null;
      if (code !== '00' && code !== '000') return { ok: false, totalCount: null, items: [], error: `resultCode=${code ?? 'none'} http=${res.status}`, rateLimited: false };
      const body = j.response.body ?? {};
      const total = Number(body.totalCount);
      const raw = body.items?.item;
      const items = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
      return { ok: Number.isFinite(total), totalCount: Number.isFinite(total) ? total : null, items, error: null, rateLimited: false };
    } catch (e: any) {
      if (attempt === 4) return { ok: false, totalCount: null, items: [], error: `network:${e?.name ?? 'error'}`, rateLimited: false };
      await sleep(1000 * 2 ** attempt);
    }
  }
  return { ok: false, totalCount: null, items: [], error: 'rate_limited_exhausted', rateLimited: true };
}

interface CellResult { lawdCd: string; ym: string; dataset: Dataset; status: 'COMPLETE' | 'PARTIAL' | 'FAILED'; totalCount: number | null; collected: number; pages: number; error: string | null }

async function fetchCell(ds: Dataset, lawdCd: string, ym: string): Promise<{ cell: CellResult; items: RawTradeItem[] }> {
  const first = await molitPage(ds, lawdCd, ym, 1, 1000);
  if (!first.ok || first.totalCount == null) {
    return { cell: { lawdCd, ym, dataset: ds, status: 'FAILED', totalCount: null, collected: 0, pages: 0, error: first.error }, items: [] };
  }
  let items = first.items;
  let pages = 1;
  let error: string | null = null;
  for (let p = 2; p <= Math.ceil(first.totalCount / 1000); p++) {
    const r = await molitPage(ds, lawdCd, ym, p, 1000);
    if (!r.ok) { error = r.error; break; }
    items = items.concat(r.items);
    pages++;
  }
  const status = items.length === first.totalCount ? 'COMPLETE' : 'PARTIAL';
  return { cell: { lawdCd, ym, dataset: ds, status, totalCount: first.totalCount, collected: items.length, pages, error }, items };
}

/** KST 기준 이번 달 포함 최근 n개월(YYYYMM, 최신 먼저) — M4-B와 같은 24개월 창. */
function monthsBackKst(n: number, now = new Date()): string[] {
  const kst = new Date(now.getTime() + 9 * 3600 * 1000);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

// ───────────────────────── phase: db ─────────────────────────
async function phaseDb() {
  const { assertProductionDbAccessAllowed } = await import('./_prod-db-guard');
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'audit-seoul-master-seed-plan');
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  const out: Record<string, unknown> = {};
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '60s'");
    const q = async (label: string, sql: string) => {
      const rows: any[] = await tx.$queryRawUnsafe(sql);
      out[label] = JSON.parse(JSON.stringify(rows, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)));
    };
    await q('master', `SELECT COUNT(*) FILTER (WHERE sgg_cd LIKE '11%') AS seoul_sgg, COUNT(*) FILTER (WHERE apt_seq LIKE '11%') AS seoul_aptseq,
      COUNT(*) FILTER (WHERE sgg_cd LIKE '26%') AS busan, COUNT(*) FILTER (WHERE sgg_cd LIKE '41%') AS gyeonggi, COUNT(*) AS total FROM apartment_masters`);
    await q('busanSharedCoords', `SELECT COUNT(*) AS points, COALESCE(SUM(n),0) AS complexes FROM (SELECT COUNT(*) n FROM apartment_masters
      WHERE latitude IS NOT NULL GROUP BY round(latitude::numeric, 6), round(longitude::numeric, 6) HAVING COUNT(*) > 1) g`);
    await q('sale', `SELECT COUNT(*) AS rows, COUNT(*) FILTER (WHERE deal_canceled) AS canceled, MIN(deal_date) AS min_date, MAX(deal_date) AS max_date,
      COUNT(DISTINCT lawd_cd) AS lawd_cds, COUNT(DISTINCT apt_seq) AS apt_seqs, COUNT(*) FILTER (WHERE apt_seq IS NULL) AS null_aptseq
      FROM apartment_trade_histories WHERE lawd_cd LIKE '11%'`);
    await q('saleByLawd', `SELECT lawd_cd, COUNT(*) AS rows FROM apartment_trade_histories WHERE lawd_cd LIKE '11%' GROUP BY 1 ORDER BY 1`);
    await q('salePilotRows', `SELECT apt_seq AS "aptSeq", lawd_cd AS "lawdCd", apt_name AS "aptName", dong, jibun, deal_date AS "dealDate", deal_canceled AS "dealCanceled"
      FROM apartment_trade_histories WHERE lawd_cd LIKE '11%' ORDER BY deal_date, id`);
    await q('rent', `SELECT COUNT(*) AS rows, COUNT(DISTINCT apt_seq) AS apt_seqs FROM apartment_rent_histories WHERE lawd_cd LIKE '11%'`);
    await q('coverageCells', `SELECT dataset, COUNT(*) AS cells FROM sync_coverage_cells WHERE lawd_cd LIKE '11%' GROUP BY 1`);
    await q('presales', `SELECT COUNT(*) AS rows FROM presales WHERE location_address LIKE '서울%'`);
    await q('redevelopment', `SELECT COUNT(*) AS rows FROM redevelopment_projects WHERE sido LIKE '서울%'`);
    await q('schools', `SELECT COUNT(*) AS rows FROM schools WHERE sido_code = '11'`);
    await q('locationFeatures', `SELECT COUNT(*) AS rows FROM apartment_location_features WHERE apt_seq LIKE '11%'`);
    await q('marketFeatures', `SELECT COUNT(*) AS rows FROM apartment_market_features WHERE apt_seq LIKE '11%'`);
    await q('officetelMasters', `SELECT COUNT(*) AS rows FROM officetel_masters WHERE sgg_cd LIKE '11%'`);
    await q('legacyApartments', `SELECT COUNT(*) AS rows FROM apartments WHERE lawd_cd LIKE '11%'`);
  }, { timeout: 120000 });
  await prisma.$disconnect();
  writeJson(path.join(RAW, 'db-baseline.json'), { at: new Date().toISOString(), readOnly: true, ...out });
  console.log(JSON.stringify(out, null, 2));
}

// ───────────────────────── phase: discover ─────────────────────────
async function phaseDiscover(which: 'sale' | 'rent' | 'both') {
  const months = monthsBackKst(24);
  const datasets: Dataset[] = which === 'both' ? ['SALE', 'RENT'] : [which.toUpperCase() as Dataset];
  for (const ds of datasets) {
    const cellsPath = path.join(RAW, `${ds.toLowerCase()}-cells.json`);
    const done: CellResult[] = fs.existsSync(cellsPath) ? readJson<CellResult[]>(cellsPath) : [];
    for (const d of SEOUL_DISTRICTS) {
      const itemsPath = path.join(RAW, `${ds.toLowerCase()}-${d.lawdCd}.json`);
      if (fs.existsSync(itemsPath) && done.filter((c) => c.lawdCd === d.lawdCd && c.status === 'COMPLETE').length === months.length) continue; // 구 단위 checkpoint
      const kept: RawTradeItem[] = [];
      const cells: CellResult[] = [];
      for (const ym of months) {
        const { cell, items } = await fetchCell(ds, d.lawdCd, ym);
        cells.push(cell);
        for (const it of items as any[]) {
          kept.push({
            aptSeq: it.aptSeq, aptNm: it.aptNm, umdNm: it.umdNm, umdCd: it.umdCd, jibun: it.jibun, sggCd: it.sggCd,
            buildYear: it.buildYear, roadNm: it.roadNm, roadNmBonbun: it.roadNmBonbun, roadNmBubun: it.roadNmBubun,
            dealYear: it.dealYear, dealMonth: it.dealMonth, dealDay: it.dealDay,
          });
        }
      }
      writeJson(itemsPath, kept);
      const others = done.filter((c) => c.lawdCd !== d.lawdCd);
      done.length = 0;
      done.push(...others, ...cells);
      writeJson(cellsPath, done);
      const bad = cells.filter((c) => c.status !== 'COMPLETE').length;
      console.log(`${ds} ${d.lawdCd} ${d.name} rows=${kept.length} cells=${cells.length} notComplete=${bad} calls=${callCount[ds]}`);
    }
  }
  writeJson(path.join(RAW, `discover-calls-${which}.json`), { at: new Date().toISOString(), months: [months[months.length - 1], months[0]], calls: callCount });
}

// ───────────────────────── phase: history (totalCount만) ─────────────────────────
async function phaseHistory() {
  const years = [2006, 2010, 2014, 2018, 2022];
  const rows: { lawdCd: string; ym: string; dataset: Dataset; totalCount: number | null; error: string | null }[] = [];
  for (const ds of ['SALE', 'RENT'] as Dataset[]) {
    for (const y of years) {
      if (ds === 'RENT' && y < 2011) continue; // 전월세 신고 자료는 2011년부터
      for (const d of SEOUL_DISTRICTS) {
        const r = await molitPage(ds, d.lawdCd, `${y}06`, 1, 1);
        rows.push({ lawdCd: d.lawdCd, ym: `${y}06`, dataset: ds, totalCount: r.totalCount, error: r.error });
      }
      console.log(`history ${ds} ${y}06 done calls=${callCount[ds]}`);
    }
  }
  writeJson(path.join(RAW, 'history-samples.json'), { at: new Date().toISOString(), note: '각 연도 6월 1개월 totalCount만(numOfRows=1).', rows, calls: callCount });
}

// ───────────────────────── phase: enrich (표본, 저장 없음) ─────────────────────────
const kakaoHeaders = () => ({
  Authorization: `KakaoAK ${process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY || ''}`,
  KA: 'sdk/1.0 os/javascript origin/http%3A%2F%2Flocalhost%3A3000',
  Origin: 'http://localhost:3000',
});
let lastLedgerAt = 0;

async function ledgerProbe(c: SeedCandidate): Promise<{ status: string; records: number; roadAddress: string | null; jibunAddress: string | null; households: number | null }> {
  const m = /^(\d+)(?:-(\d+))?$/.exec(c.jibun.replace(/^산\s*/, ''));
  if (!m || !c.umdCd) return { status: 'NO_JIBUN_PARSE', records: 0, roadAddress: null, jibunAddress: null, households: null };
  const bun = m[1].padStart(4, '0');
  const ji = (m[2] ?? '0').padStart(4, '0');
  for (let attempt = 0; attempt < 3; attempt++) {
    const wait = lastLedgerAt + 1500 - Date.now();
    if (wait > 0) await sleep(wait);
    lastLedgerAt = Date.now();
    callCount.LEDGER++;
    try {
      const res = await fetch(`https://apis.data.go.kr/1613000/BldRgstHubService/getBrRecapTitleInfo?serviceKey=${key()}&sigunguCd=${c.lawdCd}&bjdongCd=${c.umdCd}&platGbCd=0&bun=${bun}&ji=${ji}&numOfRows=5&_type=json`, { signal: AbortSignal.timeout(15000) });
      if (res.status === 429 || res.status === 503) { await sleep(30000); continue; }
      const text = await res.text();
      let j: any;
      try { j = JSON.parse(text); } catch { return { status: 'PARSE_ERROR', records: 0, roadAddress: null, jibunAddress: null, households: null }; }
      const raw = j?.response?.body?.items?.item;
      const items = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
      if (!items.length) return { status: 'NOT_FOUND', records: 0, roadAddress: null, jibunAddress: null, households: null };
      const first = items[0];
      const hh = Number(first.hhldCnt);
      return {
        status: items.length === 1 ? 'SUCCESS' : 'MULTIPLE', records: items.length,
        roadAddress: first.newPlatPlc ? String(first.newPlatPlc).trim() : null, jibunAddress: first.platPlc ? String(first.platPlc).trim() : null,
        households: Number.isFinite(hh) && hh > 0 ? hh : null,
      };
    } catch {
      await sleep(2000);
    }
  }
  return { status: 'API_ERROR', records: 0, roadAddress: null, jibunAddress: null, households: null };
}

async function kakaoCoord(query: string): Promise<{ addr: string; lat: number; lng: number } | null> {
  callCount.KAKAO++;
  try {
    const res = await fetch(`https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(query)}`, { headers: kakaoHeaders(), signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const doc = (await res.json()).documents?.[0];
    return doc ? { addr: doc.road_address_name || doc.address_name || '', lat: Number(doc.y), lng: Number(doc.x) } : null;
  } catch {
    return null;
  }
}

function loadCandidates(): { byDistrict: Map<string, SeedCandidate[]>; all: SeedCandidate[]; statsByDistrict: Record<string, unknown> } {
  const byDistrict = new Map<string, SeedCandidate[]>();
  const statsByDistrict: Record<string, unknown> = {};
  for (const d of SEOUL_DISTRICTS) {
    const items: { item: RawTradeItem; source: 'SALE' | 'RENT' }[] = [];
    for (const ds of ['SALE', 'RENT'] as const) {
      const p = path.join(RAW, `${ds.toLowerCase()}-${d.lawdCd}.json`);
      if (fs.existsSync(p)) for (const it of readJson<RawTradeItem[]>(p)) items.push({ item: it, source: ds });
    }
    const saleOnly = aggregateCandidates(d.lawdCd, items.filter((x) => x.source === 'SALE'));
    const union = aggregateCandidates(d.lawdCd, items);
    byDistrict.set(d.lawdCd, union.candidates);
    statsByDistrict[d.lawdCd] = { sale: { ...saleOnly.stats, distinctAptSeq: saleOnly.candidates.length }, union: { ...union.stats, distinctAptSeq: union.candidates.length } };
  }
  return { byDistrict, all: [...byDistrict.values()].flat(), statsByDistrict };
}

async function phaseEnrich(sampleSize: number) {
  // report 단계가 만든 최종 tier를 쓴다(tier A: 매매 discovery, tier B: 전월세 전용 + umdCd 보강).
  const finals = readJson<(SeedCandidate & { tier: string })[]>(path.join(RAW, 'final-candidates.json'));
  const perDistrict = Math.max(1, Math.round(sampleSize / SEOUL_DISTRICTS.length));
  const results: unknown[] = [];
  // 결정적 표본: aptSeq 순으로 균등 간격(거래 많은 단지로 치우치지 않게)
  const pick = <T>(list: T[], n: number) => {
    const step = Math.max(1, Math.floor(list.length / Math.max(1, n)));
    return list.filter((_, i) => i % step === 0).slice(0, n);
  };
  for (const d of SEOUL_DISTRICTS) {
    const inD = finals.filter((f) => f.lawdCd === d.lawdCd);
    const nB = perDistrict >= 2 ? 1 : 0;
    const sample = [
      ...pick(inD.filter((f) => f.tier === 'TIER_A_SALE'), perDistrict - nB),
      ...pick(inD.filter((f) => f.tier === 'TIER_B_RENT_ONLY'), nB),
    ];
    for (const c of sample) {
      const ledger = await ledgerProbe(c);
      const tries: { kind: 'ADDRESS' | 'KEYWORD'; source: string; query: string }[] = [];
      if (c.roadAddress) tries.push({ kind: 'ADDRESS', source: 'MOLIT_ROAD', query: `서울 ${d.name} ${c.roadAddress}` });
      if (ledger.roadAddress) tries.push({ kind: 'ADDRESS', source: 'LEDGER_ROAD', query: ledger.roadAddress });
      if (ledger.jibunAddress) tries.push({ kind: 'ADDRESS', source: 'LEDGER_JIBUN', query: ledger.jibunAddress });
      tries.push({ kind: 'ADDRESS', source: 'MOLIT_JIBUN', query: `서울 ${d.name} ${c.umdNm} ${c.jibun}` });
      tries.push({ kind: 'KEYWORD', source: 'KEYWORD', query: `${c.umdNm} ${c.name}` });
      let coord: { verdict: string; source: string | null; addr: string | null; lat: number | null; lng: number | null } = { verdict: 'NO_RESULT', source: null, addr: null, lat: null, lng: null };
      const perSource: Record<string, string> = {};
      for (const t of tries) {
        const r = await kakaoCoord(t.query);
        const v = classifyCoordinate({ queryKind: r ? t.kind : null, resultAddr: r?.addr ?? null, expectedSidoShort: '서울', expectedSigungu: d.name });
        perSource[t.source] = v;
        if (coord.verdict !== 'ACCEPT_EXACT' && (v === 'ACCEPT_EXACT' || (v === 'WEAK_KEYWORD' && coord.verdict === 'NO_RESULT'))) {
          coord = { verdict: v, source: t.source, addr: r!.addr, lat: r!.lat, lng: r!.lng };
        }
      }
      results.push({ tier: c.tier, aptSeq: c.aptSeq, lawdCd: c.lawdCd, name: c.name, umdNm: c.umdNm, jibun: c.jibun, molitRoad: c.roadAddress, ledger, coord, perSource });
    }
    console.log(`enrich ${d.lawdCd} ${d.name} sample=${sample.length} ledgerCalls=${callCount.LEDGER} kakaoCalls=${callCount.KAKAO}`);
  }
  writeJson(path.join(RAW, 'enrich-sample.json'), { at: new Date().toISOString(), note: '표본 probe, 저장 없음', results, calls: callCount });
}

// ───────────────────────── phase: report ─────────────────────────
function phaseReport() {
  const months = monthsBackKst(24);
  const { byDistrict, all, statsByDistrict } = loadCandidates();
  const saleCells = fs.existsSync(path.join(RAW, 'sale-cells.json')) ? readJson<CellResult[]>(path.join(RAW, 'sale-cells.json')) : [];
  const rentCells = fs.existsSync(path.join(RAW, 'rent-cells.json')) ? readJson<CellResult[]>(path.join(RAW, 'rent-cells.json')) : [];
  const verdicts = all.map((c) => ({ c, v: classifyIdentity(c) }));

  // 최종 tier(aptSeq 단위 1행): 여러 구 응답 정리 → 전월세 전용 umdCd 보강(매매 원천 대응이 하나일 때만) → 식별 판정
  const bySeqEntries = new Map<string, SeedCandidate[]>();
  for (const c of all) bySeqEntries.set(c.aptSeq, [...(bySeqEntries.get(c.aptSeq) ?? []), c]);
  const dongMap = buildDongCodeMap(all.filter((c) => c.sources.includes('SALE')));
  type Tier = 'TIER_A_SALE' | 'TIER_B_RENT_ONLY' | 'REVIEW_REQUIRED';
  const finals: { c: SeedCandidate; tier: Tier; reasons: string[]; flags: string[]; crossDistrict: string; umdCdSource: 'SALE_SOURCE' | 'SALE_DONG_MAP' | null }[] = [];
  for (const [, entries] of bySeqEntries) {
    // 한 aptSeq의 매매·전월세 행은 같은 구 파일 안에서 이미 합쳐졌다. 여러 구에 걸친 경우만 정리.
    const cross = resolveCrossDistrict(entries);
    if (!cross.canonical) {
      finals.push({ c: entries[0], tier: 'REVIEW_REQUIRED', reasons: ['CROSS_DISTRICT_CONFLICT'], flags: [], crossDistrict: cross.kind, umdCdSource: null });
      continue;
    }
    const base = cross.canonical;
    // 다른 구 응답에 실린 행의 sggCd는 그 조회 구 값이라 canonical 판정에서 제외(표기가 같음을 위에서 확인)
    const merged: SeedCandidate = { ...base, sggCds: [base.lawdCd], sources: [...new Set(entries.flatMap((e) => e.sources))] };
    const umd = resolveUmdCd(merged, dongMap);
    const umdCdSource = merged.umdCd ? 'SALE_SOURCE' : umd ? 'SALE_DONG_MAP' : null;
    const withUmd: SeedCandidate = umd && !merged.umdCd ? { ...merged, umdCd: umd, umdCds: [umd] } : merged;
    const v = classifyIdentity(withUmd);
    const tier: Tier = v.verdict !== 'SEED_READY' ? 'REVIEW_REQUIRED' : withUmd.sources.includes('SALE') ? 'TIER_A_SALE' : 'TIER_B_RENT_ONLY';
    finals.push({ c: withUmd, tier, reasons: v.reasons, flags: v.flags, crossDistrict: cross.kind, umdCdSource });
  }
  const tierCount = (t: Tier, lawdCd?: string) => finals.filter((f) => f.tier === t && (!lawdCd || f.c.lawdCd === lawdCd)).length;

  // district-counts
  const districtCounts = SEOUL_DISTRICTS.map((d) => {
    const list = byDistrict.get(d.lawdCd) ?? [];
    const v = verdicts.filter((x) => x.c.lawdCd === d.lawdCd);
    const sc = saleCells.filter((c) => c.lawdCd === d.lawdCd);
    const rc = rentCells.filter((c) => c.lawdCd === d.lawdCd);
    return {
      lawdCd: d.lawdCd, name: d.name,
      ...(statsByDistrict[d.lawdCd] as object),
      unionCandidates: list.length,
      final: { tierA: tierCount('TIER_A_SALE', d.lawdCd), tierB: tierCount('TIER_B_RENT_ONLY', d.lawdCd), review: tierCount('REVIEW_REQUIRED', d.lawdCd) },
      seedReady: v.filter((x) => x.v.verdict === 'SEED_READY').length,
      reviewRequired: v.filter((x) => x.v.verdict === 'REVIEW_REQUIRED').length,
      rentOnly: v.filter((x) => x.v.flags.includes('RENT_ONLY')).length,
      saleCells: { total: sc.length, complete: sc.filter((c) => c.status === 'COMPLETE').length, multiPage: sc.filter((c) => c.pages > 1).length, maxTotal: Math.max(0, ...sc.map((c) => c.totalCount ?? 0)), rows: sc.reduce((s, c) => s + (c.totalCount ?? 0), 0), calls: sc.reduce((s, c) => s + Math.max(1, c.pages), 0) },
      rentCells: { total: rc.length, complete: rc.filter((c) => c.status === 'COMPLETE').length, multiPage: rc.filter((c) => c.pages > 1).length, maxTotal: Math.max(0, ...rc.map((c) => c.totalCount ?? 0)), rows: rc.reduce((s, c) => s + (c.totalCount ?? 0), 0), calls: rc.reduce((s, c) => s + Math.max(1, c.pages), 0) },
    };
  });
  writeJson(path.join(OUT, 'district-counts.json'), { window: { from: months[months.length - 1], to: months[0], months: 24 }, districts: districtCounts });

  // duplicate / identity
  const dup = auditDuplicates(all);
  writeJson(path.join(OUT, 'duplicate-audit.json'), {
    counts: {
      aptSeqAcrossDistricts: dup.aptSeqAcrossDistricts.length,
      sameNameDifferentAptSeq: { groups: dup.sameNameDifferentAptSeq.length, aptSeqs: dup.sameNameDifferentAptSeq.reduce((s, g) => s + g.aptSeqs.length, 0) },
      sameJibunDifferentAptSeq: { groups: dup.sameJibunDifferentAptSeq.length, aptSeqs: dup.sameJibunDifferentAptSeq.reduce((s, g) => s + g.aptSeqs.length, 0) },
      sameRoadDifferentAptSeq: { groups: dup.sameRoadDifferentAptSeq.length, aptSeqs: dup.sameRoadDifferentAptSeq.reduce((s, g) => s + g.aptSeqs.length, 0) },
      nameAliases: dup.nameAliases.length,
    },
    rule: 'aptSeq 단위로만 행을 만든다. 이름·지번·도로명 공유 그룹은 merge하지 않고, 같은 필지 그룹은 건축물대장 값·좌표를 서로 복사하지 않는다(enrich REVIEW).',
    ...dup,
  });
  const reasonCounts: Record<string, number> = {};
  const flagCounts: Record<string, number> = {};
  for (const f of finals) {
    for (const r of f.reasons) reasonCounts[r] = (reasonCounts[r] ?? 0) + 1;
    for (const fl of f.flags) flagCounts[fl] = (flagCounts[fl] ?? 0) + 1;
  }
  const saleSeqs = new Set(finals.filter((f) => f.c.sources.includes('SALE')).map((f) => f.c.aptSeq));
  writeJson(path.join(OUT, 'identity-audit.json'), {
    distinctAptSeq: finals.length,
    saleDiscovered: saleSeqs.size,
    rentOnly: finals.length - saleSeqs.size,
    tiers: { TIER_A_SALE: tierCount('TIER_A_SALE'), TIER_B_RENT_ONLY: tierCount('TIER_B_RENT_ONLY'), REVIEW_REQUIRED: tierCount('REVIEW_REQUIRED') },
    crossDistrict: finals.filter((f) => f.crossDistrict !== 'SINGLE').map((f) => ({ aptSeq: f.c.aptSeq, kind: f.crossDistrict, canonicalLawdCd: f.c.lawdCd, reportedIn: bySeqEntries.get(f.c.aptSeq)!.map((e) => e.lawdCd) })),
    umdCdSource: { SALE_SOURCE: finals.filter((f) => f.umdCdSource === 'SALE_SOURCE').length, SALE_DONG_MAP: finals.filter((f) => f.umdCdSource === 'SALE_DONG_MAP').length, NONE: finals.filter((f) => f.umdCdSource == null).length },
    dongCodeMap: { pairs: dongMap.size, ambiguous: [...dongMap.values()].filter((x) => x.size > 1).length },
    nullAptSeqRows: { sale: Object.values(statsByDistrict).reduce((s: number, x: any) => s + x.sale.nullAptSeq, 0), union: Object.values(statsByDistrict).reduce((s: number, x: any) => s + x.union.nullAptSeq, 0) },
    foreignSggRows: Object.values(statsByDistrict).reduce((s: number, x: any) => s + x.union.foreignSggRows, 0),
    aptSeqFormat: { malformed: finals.filter((f) => !/^\d{5}-\d+$/.test(f.c.aptSeq)).length, nonSeoulPrefix: finals.filter((f) => !f.c.aptSeq.startsWith('11')).length },
    // 원천 aptNm이 지번·상가·빌딩 표기인 단지(주상복합 등). identity는 정상(aptSeq) — 이름을 바꾸지 않고 표시 정책 검토 대상으로만 센다.
    nameLooksNonResidential: Object.fromEntries((['TIER_A_SALE', 'TIER_B_RENT_ONLY', 'REVIEW_REQUIRED'] as const).map((t) => [t, finals.filter((f) => f.tier === t && /^\(|필지|상가|빌딩/.test(f.c.name)).length])),
    lowActivity: { tierA_tradeCountLe1: finals.filter((f) => f.tier === 'TIER_A_SALE' && f.c.tradeCount <= 1).length, tierB_tradeCountLe3: finals.filter((f) => f.tier === 'TIER_B_RENT_ONLY' && f.c.tradeCount <= 3).length },
    reasonCounts, flagCounts,
  });
  writeJson(path.join(OUT, 'review-required.json'), finals.filter((f) => f.tier === 'REVIEW_REQUIRED').map((f) => ({
    aptSeq: f.c.aptSeq, lawdCd: f.c.lawdCd, name: f.c.name, umdNm: f.c.umdNm, jibun: f.c.jibun, sources: f.c.sources, reasons: f.reasons,
    note: f.reasons.includes('MISSING_UMD') ? '전월세 원천에 umdCd 없음 + 같은 구 매매 원천에 그 법정동 대응 없음 → 공식 법정동코드 확인 전 자동 seed 금지' : null,
  })));
  writeJson(path.join(RAW, 'final-candidates.json'), finals.map((f) => ({ tier: f.tier, umdCdSource: f.umdCdSource, ...f.c })));

  // existing sale reconcile
  const dbPath = path.join(RAW, 'db-baseline.json');
  const db = fs.existsSync(dbPath) ? readJson<any>(dbPath) : null;
  const bySeq = new Map(all.map((c) => [c.aptSeq, c]));
  const pilot = (db?.salePilotRows ?? []) as (PilotRow & { dealDate: string })[];
  const rec = pilot.map((r) => ({ aptSeq: r.aptSeq, lawdCd: r.lawdCd, aptName: r.aptName, dong: r.dong, jibun: r.jibun, dealDate: r.dealDate, ...reconcilePilotRow(r, bySeq) }));
  writeJson(path.join(OUT, 'existing-sale-reconcile.json'), {
    rows: rec.length,
    byMatch: rec.reduce((m: Record<string, number>, r) => ((m[r.match] = (m[r.match] ?? 0) + 1), m), {}),
    distinctAptSeq: new Set(rec.map((r) => r.aptSeq)).size,
    direction: 'MASTER(원천 discovery) → 거래 매핑. 거래 행으로 master를 만들지 않는다.',
    detail: rec,
  });

  // coordinate plan
  const enrichPath = path.join(RAW, 'enrich-sample.json');
  const enrich = fs.existsSync(enrichPath) ? readJson<any>(enrichPath) : { results: [] };
  const er = enrich.results as any[];
  const pct = (n: number) => (er.length ? Math.round((n / er.length) * 1000) / 10 : null);
  const coordCount = (v: string) => er.filter((x) => x.coord.verdict === v).length;
  const bySource = (src: string) => er.filter((x) => x.perSource[src] === 'ACCEPT_EXACT').length;
  const sharedCoord = new Map<string, string[]>();
  for (const x of er.filter((x) => x.coord.lat != null && x.coord.verdict === 'ACCEPT_EXACT')) {
    const k = `${x.coord.lat.toFixed(6)},${x.coord.lng.toFixed(6)}`;
    sharedCoord.set(k, [...(sharedCoord.get(k) ?? []), x.aptSeq]);
  }
  writeJson(path.join(OUT, 'coordinate-plan.json'), {
    sample: er.length,
    officialCoordinateInSource: { molitTrade: false, molitRent: false, aptBasisInfoV5: false, buildingLedger: false },
    verdicts: { ACCEPT_EXACT: coordCount('ACCEPT_EXACT'), WEAK_KEYWORD: coordCount('WEAK_KEYWORD'), REJECT_REGION: coordCount('REJECT_REGION'), NO_RESULT: coordCount('NO_RESULT') },
    acceptExactPct: pct(coordCount('ACCEPT_EXACT')),
    acceptExactBySource: { MOLIT_ROAD: bySource('MOLIT_ROAD'), LEDGER_ROAD: bySource('LEDGER_ROAD'), LEDGER_JIBUN: bySource('LEDGER_JIBUN'), MOLIT_JIBUN: bySource('MOLIT_JIBUN') },
    sharedExactCoordinateGroups: [...sharedCoord.values()].filter((g) => g.length > 1),
    ledger: {
      SUCCESS: er.filter((x) => x.ledger.status === 'SUCCESS').length, MULTIPLE: er.filter((x) => x.ledger.status === 'MULTIPLE').length,
      NOT_FOUND: er.filter((x) => x.ledger.status === 'NOT_FOUND').length, API_ERROR: er.filter((x) => x.ledger.status === 'API_ERROR').length,
      other: er.filter((x) => !['SUCCESS', 'MULTIPLE', 'NOT_FOUND', 'API_ERROR'].includes(x.ledger.status)).length,
      withHouseholds: er.filter((x) => x.ledger.households != null).length,
    },
    policy: [
      '원천 좌표 없음(MOLIT·K-apt V5·건축물대장 모두 위경도 필드 없음) → Kakao 주소 검색만 사용',
      '우선순위: MOLIT 원천 도로명 → 건축물대장 도로명 → 건축물대장 지번 → MOLIT 지번. 결과 주소의 시도=서울·구=해당 구일 때만 ACCEPT_EXACT',
      '"{동} {단지명}" 키워드 결과(첫 검색 결과)는 seed에 저장하지 않는다 → REVIEW (부산 M4-B의 normalized보다 엄격)',
      '같은 좌표를 공유하는 서로 다른 aptSeq는 batch 안에서만 판정해 null 처리(부산 행을 건드리는 전역 dedupe 금지)',
      '동 중심·인근 단지 좌표 대체 금지',
    ],
    detail: er,
  });

  // expected scale + quota
  const saleCalls = districtCounts.reduce((s, d) => s + d.saleCells.calls, 0);
  const rentCalls = districtCounts.reduce((s, d) => s + d.rentCells.calls, 0);
  const saleRows24 = districtCounts.reduce((s, d) => s + d.saleCells.rows, 0);
  const rentRows24 = districtCounts.reduce((s, d) => s + d.rentCells.rows, 0);
  const histPath = path.join(RAW, 'history-samples.json');
  const hist = fs.existsSync(histPath) ? readJson<any>(histPath) : { rows: [] };
  const histByYear: Record<string, { sale: number; rent: number }> = {};
  for (const r of hist.rows as any[]) {
    const y = r.ym.slice(0, 4);
    histByYear[y] ??= { sale: 0, rent: 0 };
    if (r.totalCount != null) histByYear[y][r.dataset === 'SALE' ? 'sale' : 'rent'] += r.totalCount;
  }
  writeJson(path.join(OUT, 'seed-plan-summary.json'), {
    at: new Date().toISOString(),
    window: { from: months[months.length - 1], to: months[0] },
    master: { distinctAptSeq: finals.length, tierA_sale: tierCount('TIER_A_SALE'), tierB_rentOnly: tierCount('TIER_B_RENT_ONLY'), reviewRequired: tierCount('REVIEW_REQUIRED') },
    molit24m: {
      sale: { rows: saleRows24, cells: saleCells.length, complete: saleCells.filter((c) => c.status === 'COMPLETE').length, multiPageCells: saleCells.filter((c) => c.pages > 1).length, calls: saleCalls },
      rent: { rows: rentRows24, cells: rentCells.length, complete: rentCells.filter((c) => c.status === 'COMPLETE').length, multiPageCells: rentCells.filter((c) => c.pages > 1).length, calls: rentCalls },
    },
    historyJuneSamples: histByYear,
    enrichCallsPerCandidate: { ledgerMax: 1, kakaoMax: 5 },
    quotaWindows: {
      discovery24m: { sale: quotaWindows(saleCalls), rent: quotaWindows(rentCalls) },
      ledgerForAllCandidates: { calls: finals.length, windows: quotaWindows(finals.length) },
    },
    probeCalls: { discover: fs.existsSync(path.join(RAW, 'discover-calls-both.json')) ? readJson<any>(path.join(RAW, 'discover-calls-both.json')).calls : null, history: hist.calls ?? null, enrich: enrich.calls ?? null },
    productionWrites: { insert: 0, update: 0, delete: 0, migration: 0, schemaChange: 0, statsEnable: 0, seoEnable: 0 },
  });
  console.log(fs.readFileSync(path.join(OUT, 'seed-plan-summary.json'), 'utf8'));
}

async function main() {
  const [phase, arg] = process.argv.slice(2);
  if (phase === 'db') await phaseDb();
  else if (phase === 'discover') await phaseDiscover((arg as 'sale' | 'rent' | 'both') ?? 'both');
  else if (phase === 'history') await phaseHistory();
  else if (phase === 'enrich') await phaseEnrich(Number(arg ?? 100));
  else if (phase === 'report') phaseReport();
  else {
    console.error('usage: audit-seoul-master-seed-plan.ts db|discover [sale|rent|both]|history|enrich [n]|report');
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e?.message ?? e);
    process.exit(1);
  });
}
