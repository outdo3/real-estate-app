/**
 * TOP_COMPLEX_AGGREGATION_TRUST_AUDIT_V1 — "거래 많은 단지" 화면 vs 브리핑 집계 차이 감사 (STRICT READ ONLY).
 *
 * - DB: `SET TRANSACTION READ ONLY` 트랜잭션에서 SELECT만. INSERT/UPDATE/DELETE 0.
 * - MOLIT: 지정 기간이 걸친 부산 셀만 GET. 원천 XML의 **원본 필드**(동 번호·거래유형 등)를 본다 —
 *   DB에는 저장되지 않는 필드라, 같아 보이는 행이 실제로 다른 거래인지 가를 수 있는 유일한 근거다.
 * - 개인정보: 원천에 개인 식별 정보가 없고, 출력도 단지·동 번호·층·금액·날짜 수준만 한다.
 *
 * 화면 집계(현행): feed DB 행을 deal_date, id 순으로 읽고 → dedupeTrades(단지·면적·유형 + 금액·계약일·층, 첫 행 유지)
 *                  → 취소 제외 → 단지(aptSeq)별 개수.
 * 브리핑 집계(현행): 취소 제외한 DB 행 전부 → 단지(aptSeq)별 개수.
 *
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/audit-top-complex-aggregation.ts [from] [to] [focusAptSeq]
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { PrismaClient } from '@prisma/client';
import { assertProductionDbAccessAllowed } from './_prod-db-guard';
import { createMolitXmlParser } from '../src/lib/api-molit';
import { BUSAN_LAWDCD_16 } from '../src/lib/rent-verified-range';

const prisma = new PrismaClient();
const FROM = process.argv[2] ?? '2026-08-21';
const TO = process.argv[3] ?? '2026-09-19';
const FOCUS = process.argv[4] ?? '26380-2073';

interface Row {
  id: number; lawd_cd: string; deal_ymd: string; apt_seq: string | null; apt_name: string; dong: string;
  exclusive_area: string; deal_amount: number; deal_date: string; floor: number | null; occurrence_index: number;
  deal_canceled: boolean; cancel_date: string | null; registry_date: string | null;
  created_at: Date; source_fetched_at: Date;
}

// ── 원천(raw XML) ──────────────────────────────────────────────────────────
const ENDPOINT = 'http://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function url(lawdCd: string, ym: string, page: number): string {
  const key = (process.env.DATA_GO_KR_API_KEY ?? '').trim().replace(/['"]/g, '');
  return `${ENDPOINT}?serviceKey=${encodeURIComponent(decodeURIComponent(key))}&LAWD_CD=${lawdCd}&DEAL_YMD=${ym}&pageNo=${page}&numOfRows=1000`;
}
async function fetchRawCell(lawdCd: string, ym: string): Promise<{ ok: boolean; items: Record<string, unknown>[]; total: number | null }> {
  const parser = createMolitXmlParser();
  const items: Record<string, unknown>[] = [];
  let total: number | null = null;
  for (let page = 1; page <= 20; page++) {
    let body: any = null;
    for (let attempt = 0; attempt < 4 && !body; attempt++) {
      await sleep(400 + attempt * 800);
      try {
        const res = await fetch(url(lawdCd, ym, page), { signal: AbortSignal.timeout(15000) });
        const j = parser.parse(await res.text());
        const code = j.response?.header?.resultCode;
        if (code === '00' || code === 0 || code === '000') body = j.response.body;
      } catch { /* retry */ }
    }
    if (!body) return { ok: false, items, total };
    total = Number(body.totalCount);
    const it = body.items?.item;
    items.push(...(it ? (Array.isArray(it) ? it : [it]) : []));
    if (items.length >= total) break;
  }
  return { ok: total != null && items.length === total, items, total };
}
const s = (v: unknown) => (v == null ? '' : String(v).trim());
const srcDate = (it: Record<string, unknown>) => `${s(it.dealYear)}-${s(it.dealMonth).padStart(2, '0')}-${s(it.dealDay).padStart(2, '0')}`;
const srcAmount = (it: Record<string, unknown>) => Number(s(it.dealAmount).replace(/[,\s]/g, ''));
const srcCanceled = (it: Record<string, unknown>) => s(it.cdealType) === 'O';

async function main() {
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'audit-top-complex-aggregation.ts');
  let rows: Row[] = [];
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '120s'");
    rows = await tx.$queryRawUnsafe<Row[]>(`
      SELECT id, lawd_cd, deal_ymd, apt_seq, apt_name, dong, exclusive_area::text, deal_amount, deal_date::text AS deal_date,
             floor, occurrence_index, deal_canceled, cancel_date, registry_date, created_at, source_fetched_at
      FROM apartment_trade_histories
      WHERE lawd_cd = ANY($1) AND deal_type = 'sale' AND deal_date BETWEEN $2::date AND $3::date
      ORDER BY deal_date, id`, [...BUSAN_LAWDCD_16], FROM, TO);
  }, { timeout: 300_000 });

  // ── 두 집계 재현 ─────────────────────────────────────────────────────────
  const tradeKey = (r: Row) => `${r.apt_seq ?? `nd:${r.apt_name}|${r.dong}`}|${Number(r.exclusive_area)}|${r.deal_amount}|${r.deal_date}|${r.floor}`;
  const complexKey = (r: Row) => r.apt_seq ?? `nd:${r.apt_name}|${r.dong}`;
  const reportCount = new Map<string, number>();
  for (const r of rows) if (!r.deal_canceled) reportCount.set(complexKey(r), (reportCount.get(complexKey(r)) ?? 0) + 1);
  const firstByKey = new Map<string, Row>();
  for (const r of rows) if (!firstByKey.has(tradeKey(r))) firstByKey.set(tradeKey(r), r); // ORDER BY deal_date, id → 첫 행
  const screenCount = new Map<string, number>();
  for (const r of firstByKey.values()) if (!r.deal_canceled) screenCount.set(complexKey(r), (screenCount.get(complexKey(r)) ?? 0) + 1);
  // 참고: 취소를 먼저 빼고 dedupe했다면
  const firstActive = new Map<string, Row>();
  for (const r of rows) if (!r.deal_canceled && !firstActive.has(tradeKey(r))) firstActive.set(tradeKey(r), r);
  const activeDedupCount = new Map<string, number>();
  for (const r of firstActive.values()) activeDedupCount.set(complexKey(r), (activeDedupCount.get(complexKey(r)) ?? 0) + 1);

  const names = new Map(rows.map((r) => [complexKey(r), `${r.apt_name}(${r.dong})`]));
  const complexes = [...reportCount.keys()].map((k) => ({
    key: k, name: names.get(k), report: reportCount.get(k) ?? 0, screen: screenCount.get(k) ?? 0, activeDedup: activeDedupCount.get(k) ?? 0,
  }));
  const top20 = [...complexes].sort((a, b) => b.report - a.report).slice(0, 20);
  const mismatched = complexes.filter((c) => c.report !== c.screen);
  const totals = {
    period: `${FROM}~${TO}`, rows: rows.length, activeRows: rows.filter((r) => !r.deal_canceled).length,
    complexes: complexes.length, mismatchedComplexes: mismatched.length,
    reportTotal: [...reportCount.values()].reduce((a, b) => a + b, 0), screenTotal: [...screenCount.values()].reduce((a, b) => a + b, 0),
    activeDedupTotal: [...activeDedupCount.values()].reduce((a, b) => a + b, 0),
    // 화면 경로가 취소 행을 먼저 잡아 유효 거래까지 0으로 만든 그룹 수
    groupsLostByCancelFirst: [...firstByKey.values()].filter((r) => r.deal_canceled && rows.some((x) => tradeKey(x) === tradeKey(r) && !x.deal_canceled)).length,
  };

  // ── 같아 보이는 그룹(키 동일, 2행 이상) — 원천으로 분류 ─────────────────
  const byKey = new Map<string, Row[]>();
  for (const r of rows) (byKey.get(tradeKey(r)) ?? byKey.set(tradeKey(r), []).get(tradeKey(r))!).push(r);
  const multi = [...byKey.entries()].filter(([, v]) => v.length > 1);
  // 기간이 걸친 부산 전 셀을 읽는다 — 원천 유효 거래 수(정답 후보)를 단지별로 세기 위해서다.
  const months: string[] = [];
  for (let d = new Date(`${FROM.slice(0, 7)}-01T00:00:00Z`); d <= new Date(`${TO}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1)) {
    months.push(d.toISOString().slice(0, 7).replace('-', ''));
  }
  const cells = BUSAN_LAWDCD_16.flatMap((l) => months.map((m) => `${l}:${m}`));
  const srcByCell = new Map<string, { ok: boolean; items: Record<string, unknown>[] }>();
  for (const c of cells) {
    const [l, ym] = c.split(':');
    srcByCell.set(c, await fetchRawCell(l, ym));
  }

  // ── 원천 기준 정답: 기간 안, 취소 아닌 원천 기록 수(단지별) ─────────────
  const srcValid = new Map<string, number>();
  let srcRowsInWindow = 0;
  let srcNoAptSeq = 0;
  for (const [c, src] of srcByCell) {
    for (const it of src.items) {
      const d = srcDate(it);
      if (d < FROM || d > TO) continue;
      srcRowsInWindow++;
      if (srcCanceled(it)) continue;
      if (!s(it.aptSeq)) { srcNoAptSeq++; continue; }
      srcValid.set(s(it.aptSeq), (srcValid.get(s(it.aptSeq)) ?? 0) + 1);
    }
    void c;
  }
  const allKeys = new Set([...reportCount.keys(), ...srcValid.keys()]);
  const truth = { cellsRead: cells.length, cellsIncomplete: [...srcByCell.values()].filter((x) => !x.ok).length, srcRowsInWindow, srcValidTotal: [...srcValid.values()].reduce((a, b) => a + b, 0), srcValidNoAptSeq: srcNoAptSeq,
    reportExact: 0, screenExact: 0, reportAbsErr: 0, screenAbsErr: 0, reportOver: 0, reportUnder: 0, screenOver: 0, screenUnder: 0 };
  const truthDiff: unknown[] = [];
  for (const k of allKeys) {
    if (k.startsWith('nd:')) continue;
    const t = srcValid.get(k) ?? 0;
    const rep = reportCount.get(k) ?? 0;
    const scr = screenCount.get(k) ?? 0;
    if (rep === t) truth.reportExact++; else { truth.reportAbsErr += Math.abs(rep - t); if (rep > t) truth.reportOver++; else truth.reportUnder++; }
    if (scr === t) truth.screenExact++; else { truth.screenAbsErr += Math.abs(scr - t); if (scr > t) truth.screenOver++; else truth.screenUnder++; }
    if (rep !== t || scr !== t) {
      const dbRows = rows.filter((r) => r.apt_seq === k);
      truthDiff.push({ aptSeq: k, name: names.get(k) ?? null, source: t, report: rep, screen: scr, dbActive: dbRows.filter((r) => !r.deal_canceled).length, dbCanceled: dbRows.filter((r) => r.deal_canceled).length,
        newestCreated: dbRows.length ? dbRows.map((r) => r.created_at.toISOString()).sort().pop() : null });
    }
  }

  const classCount: Record<string, number> = {};
  const classRows: Record<string, number> = {};
  const groupDetail: unknown[] = [];
  for (const [k, v] of multi) {
    const r0 = v[0];
    const src = srcByCell.get(`${r0.lawd_cd}:${r0.deal_ymd}`);
    const srcRows = (src?.items ?? []).filter((it) =>
      s(it.aptSeq) === (r0.apt_seq ?? '') && Number(s(it.excluUseAr)) === Number(r0.exclusive_area) &&
      srcAmount(it) === r0.deal_amount && srcDate(it) === r0.deal_date && Number(s(it.floor)) === r0.floor);
    const dbCanceled = v.filter((x) => x.deal_canceled).length;
    const srcCanceledN = srcRows.filter(srcCanceled).length;
    const aptDongs = srcRows.map((it) => s(it.aptDong));
    const distinctDong = new Set(aptDongs).size;
    // 원천 행을 완전히 같은 필드 묶음으로 본다(개인 식별 필드 없음).
    const fp = (it: Record<string, unknown>) => JSON.stringify([s(it.aptDong), s(it.cdealType), s(it.cdealDay), s(it.rgstDate), s(it.dealingGbn), s(it.slerGbn), s(it.buyerGbn), s(it.estateAgentSggNm)]);
    const distinctFp = new Set(srcRows.map(fp)).size;
    let cls: string;
    if (!src?.ok) cls = 'E_AMBIGUOUS(source_incomplete)';
    else if (v.length > srcRows.length) cls = 'A_CONFIRMED_DUPLICATE(db_rows>source_rows)';
    else if (srcCanceledN > 0 && srcCanceledN < srcRows.length) cls = 'C/D_CANCEL_SIBLING_OR_REREGISTRATION';
    else if (srcCanceledN === srcRows.length) cls = 'C_ALL_CANCELED';
    else if (distinctDong === srcRows.length) cls = 'B_LEGITIMATE_MULTIPLE(distinct_building)';
    else if (distinctFp > 1) cls = 'B_LEGITIMATE_MULTIPLE(distinct_source_fields)';
    else cls = 'E_AMBIGUOUS(identical_source_records)';
    classCount[cls] = (classCount[cls] ?? 0) + 1;
    classRows[cls] = (classRows[cls] ?? 0) + v.length;
    groupDetail.push({
      complex: `${r0.apt_name}`, aptSeq: r0.apt_seq, area: Number(r0.exclusive_area), amount: r0.deal_amount, date: r0.deal_date, floor: r0.floor,
      dbRows: v.length, dbCanceled, srcRows: srcRows.length, srcCanceled: srcCanceledN, srcBuildings: aptDongs.join(','),
      srcDealing: [...new Set(srcRows.map((it) => s(it.dealingGbn)))].join(','), distinctSrcRecords: distinctFp,
      occ: v.map((x) => x.occurrence_index).join(','), cls,
      srcRegistry: srcRows.map((it) => s(it.rgstDate) || '-').join(','), dbCreated: [...new Set(v.map((x) => x.created_at.toISOString().slice(0, 16)))].join(','),
      screenKeeps: v[0].deal_canceled ? 'CANCELED_FIRST(→0)' : 'active',
    });
  }

  // ── 대표 사례 상세 ─────────────────────────────────────────────────────
  const focusRows = rows.filter((r) => r.apt_seq === FOCUS).map((r) => ({
    id: r.id, lawdCd: r.lawd_cd, date: r.deal_date, amount: r.deal_amount, area: Number(r.exclusive_area), floor: r.floor,
    occ: r.occurrence_index, canceled: r.deal_canceled, cancelDate: r.cancel_date, registryDate: r.registry_date,
    created: r.created_at.toISOString(), sourceFetched: r.source_fetched_at.toISOString(),
  }));
  const focusCell = focusRows.length ? `${rows.find((r) => r.apt_seq === FOCUS)!.lawd_cd}:${rows.find((r) => r.apt_seq === FOCUS)!.deal_ymd}` : null;
  let focusSource: unknown = null;
  if (focusCell) {
    const src = srcByCell.get(focusCell) ?? (await fetchRawCell(focusCell.split(':')[0], focusCell.split(':')[1]));
    const items = src.items.filter((it) => s(it.aptSeq) === FOCUS && srcDate(it) >= FROM && srcDate(it) <= TO);
    focusSource = {
      cellComplete: src.ok, sourceRows: items.length, canceled: items.filter(srcCanceled).length,
      fieldsAvailable: items[0] ? Object.keys(items[0]).sort() : [],
      rows: items.map((it) => ({ date: srcDate(it), amount: srcAmount(it), area: Number(s(it.excluUseAr)), floor: Number(s(it.floor)), building: s(it.aptDong), dealing: s(it.dealingGbn), seller: s(it.slerGbn), buyer: s(it.buyerGbn), cdeal: s(it.cdealType), rgst: s(it.rgstDate) }))
        .sort((a, b) => a.floor - b.floor || a.amount - b.amount || a.building.localeCompare(b.building)),
    };
  }

  console.log(JSON.stringify({ totals, truth, truthDiff, top20, mismatched, classCount, classRows, groupDetail, focus: { aptSeq: FOCUS, dbRows: focusRows, source: focusSource } }, null, 2));
}

main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); }).finally(() => prisma.$disconnect());
