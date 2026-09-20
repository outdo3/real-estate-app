/**
 * SEOUL_SALE_FULL_HISTORY_MEASUREMENT_COMPLETION_V1 §7 — 서울 전체 이력 MASTER_MISSING census (STRICT READ ONLY).
 *
 * `audit-seoul-sale-backfill-plan.ts`가 수집해 둔 셀별 원천(raw/*.json.gz)을 운영과 같은 정규화
 * 경로로 다시 읽어 MASTER_MISSING aptSeq 전체 목록을 만들고, 왜 master에 없는지를 **관측 가능한
 * 신호로만** 분류한다. master를 만들지 않고, 이름·지번으로 거래를 다른 단지에 붙이지도 않는다.
 *
 *   A  CURRENT_MASTER          aptSeq가 지금 master에 있다(구 필터 밖 포함) — MASTER_MISSING이면 0이어야 한다
 *   B  HISTORICAL_ONLY         마지막 거래가 master seed 기준월 이전 — seed 창(최근 24개월) 밖이라 안 뽑혔다
 *   C  LOT_REUSED (신호)       B 중, 같은 (lawdCd, dong, jibun)에 master에 있는 **다른** aptSeq가 있다
 *                              — 재건축/개명 가능성을 **시사**하는 신호일 뿐, 동일 단지 판정이 아니다
 *   D  UNRESOLVED_RECENT       마지막 거래가 기준월 이후인데도 master에 없다 — seed의 실제 누락 후보
 *
 * DB는 SELECT만(`SET TRANSACTION READ ONLY`). INSERT/UPDATE/DELETE 0. 외부 API 호출 0.
 *
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/audit-seoul-master-missing-census.ts [--cutoff=2024-10-01]
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import * as zlib from 'zlib';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { mapMolitItems } from '../src/lib/api-molit';
import { normalizeMolitItemsToTradeRows } from './trade-history-logic';
import { FETCH_ORDER, OUT, monthRange, kstYm, preStartCells, classifyMaster, type CellCheckpoint } from './audit-seoul-sale-backfill-plan';

const RAW = path.join(OUT, 'raw');
const CELLS = path.join(OUT, 'cells');

export type MissingClass = 'A_CURRENT_MASTER' | 'B_HISTORICAL_ONLY' | 'C_LOT_REUSED' | 'D_UNRESOLVED_RECENT';

export interface MissingSeq {
  aptSeq: string;
  lawdCd: string;
  name: string;
  dong: string;
  jibun: string | null;
  rows: number;
  firstDate: string;
  lastDate: string;
}

/**
 * 관측 신호만으로 분류한다(순수 함수 — DB·네트워크 없음).
 * `masterAll`은 master에 있는 모든 aptSeq, `masterLots`는 master의 (lawdCd|dong|jibun) → aptSeq 집합.
 */
export function classifyMissing(
  m: MissingSeq,
  masterAll: ReadonlySet<string>,
  masterLots: ReadonlyMap<string, ReadonlySet<string>>,
  cutoff: string
): MissingClass {
  if (masterAll.has(m.aptSeq)) return 'A_CURRENT_MASTER';
  if (m.lastDate >= cutoff) return 'D_UNRESOLVED_RECENT';
  if (m.jibun) {
    const others = masterLots.get(`${m.lawdCd}|${m.dong}|${m.jibun}`);
    // 같은 필지에 master가 가진 **다른** aptSeq가 있으면 재건축/개명 신호로만 센다.
    if (others && [...others].some((s) => s !== m.aptSeq)) return 'C_LOT_REUSED';
  }
  return 'B_HISTORICAL_ONLY';
}

function loadCells(lawdCd: string): Record<string, CellCheckpoint> {
  const p = path.join(CELLS, `${lawdCd}.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
}

async function main() {
  const cutoff = process.argv.find((a) => a.startsWith('--cutoff='))?.split('=')[1] ?? '2024-10-01';
  const { PrismaClient } = await import('@prisma/client');
  const { assertProductionDbAccessAllowed } = await import('./_prod-db-guard');
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'audit-seoul-master-missing-census.ts');
  const prisma = new PrismaClient();

  const db = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const all = await tx.$queryRawUnsafe<{ apt_seq: string; sgg_cd: string | null; umd_name: string | null; jibun: string | null }[]>(
      `SELECT apt_seq, sgg_cd, umd_name, jibun FROM apartment_masters WHERE apt_seq IS NOT NULL`);
    const seoul = await tx.$queryRawUnsafe<{ n: number }[]>(
      `SELECT COUNT(*)::int AS n FROM apartment_masters WHERE sgg_cd LIKE '11%'`);
    return { all, seoulCount: seoul[0].n };
  }, { timeout: 180_000 });
  await prisma.$disconnect();

  const masterAll = new Set(db.all.map((m) => m.apt_seq));
  const masterSeoul = new Set(db.all.filter((m) => (m.sgg_cd ?? '').startsWith('11')).map((m) => m.apt_seq));
  const masterLots = new Map<string, Set<string>>();
  for (const m of db.all) {
    if (!m.sgg_cd || !m.umd_name || !m.jibun) continue;
    const k = `${m.sgg_cd}|${m.umd_name}|${m.jibun}`;
    (masterLots.get(k) ?? masterLots.set(k, new Set()).get(k)!).add(m.apt_seq);
  }

  const months = monthRange('200601', kstYm());
  const early = preStartCells();
  const missing = new Map<string, MissingSeq>();
  const districtsMeasured: string[] = [];
  const districtsPartial: string[] = [];
  let sourceRows = 0;
  const byDistrict: Record<string, { exact: number; missing: number; review: number; invalid: number }> = {};

  for (const d of FETCH_ORDER) {
    const cells = loadCells(d);
    const want = [...early.filter((c) => c.lawdCd === d).map((c) => c.ym), ...months];
    const complete = want.filter((ym) => cells[ym]?.status === 'COMPLETE');
    if (!complete.length) { districtsPartial.push(d); continue; }
    (complete.length === want.length ? districtsMeasured : districtsPartial).push(d);
    byDistrict[d] = { exact: 0, missing: 0, review: 0, invalid: 0 };
    for (const ym of complete) {
      const items = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(RAW, d, `${ym}.json.gz`))).toString('utf8'));
      const { rows } = normalizeMolitItemsToTradeRows(mapMolitItems(items, 'apt', d, ym) as any, d, ym);
      sourceRows += rows.length;
      for (const r of rows) {
        const cls = classifyMaster(r, masterSeoul);
        if (cls === 'EXACT_MASTER') byDistrict[d].exact++;
        else if (cls === 'REVIEW_REQUIRED') byDistrict[d].review++;
        else if (cls === 'INVALID_APTSEQ') byDistrict[d].invalid++;
        else {
          byDistrict[d].missing++;
          const seq = (r.aptSeq ?? '').trim();
          const cur = missing.get(seq);
          if (!cur) missing.set(seq, { aptSeq: seq, lawdCd: r.lawdCd, name: r.aptName, dong: r.dong, jibun: r.jibun, rows: 1, firstDate: r.dealDate, lastDate: r.dealDate });
          else {
            cur.rows++;
            if (r.dealDate < cur.firstDate) cur.firstDate = r.dealDate;
            if (r.dealDate > cur.lastDate) { cur.lastDate = r.dealDate; cur.name = r.aptName; }
          }
        }
      }
    }
  }

  const list = [...missing.values()].map((m) => ({ ...m, cls: classifyMissing(m, masterAll, masterLots, cutoff) }));
  const counts: Record<string, { aptSeqs: number; rows: number }> = {};
  for (const m of list) {
    const c = (counts[m.cls] ??= { aptSeqs: 0, rows: 0 });
    c.aptSeqs++; c.rows += m.rows;
  }
  const totalMissingRows = list.reduce((s, m) => s + m.rows, 0);
  const out = {
    at: new Date().toISOString(), cutoff, readOnly: true,
    masterSeoul: db.seoulCount, masterAllAptSeq: masterAll.size,
    districtsMeasured: districtsMeasured.length, districtsPartial,
    sourceRows, totalMissingAptSeqs: list.length, totalMissingRows,
    counts,
    byDistrict,
    top: [...list].sort((a, b) => b.rows - a.rows).slice(0, 40),
    dRecent: list.filter((m) => m.cls === 'D_UNRESOLVED_RECENT').sort((a, b) => b.rows - a.rows).slice(0, 40),
  };
  fs.writeFileSync(path.join(OUT, 'master-missing-census.json'), JSON.stringify({ ...out, all: list }, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

if (require.main === module) main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
