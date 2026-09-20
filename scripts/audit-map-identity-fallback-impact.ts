/**
 * MAP_IDENTITY_FALLBACK_IMPACT_AUDIT_V1 — 지도 marker identity fallback의 실제 노출 규모 측정 (STRICT READ ONLY).
 *
 * 운영 지도 경로를 코드 그대로 재현한다(추정 없음):
 *   1) /api/transactions?type=apt&months=12&dong=all&lawdCd=NNNNN
 *      → DB-first 적격이면 fetchApt12MonthsFromDb = queryTrades({lawdCd, from: now-12개월})
 *        (dealType='sale', dealCanceled=false, take 없음)
 *   2) getMasterCoords(lawdCd) → buildMasterCoordIndex
 *   3) 행마다 resolveApartmentCoords(index, dong, name, aptNamesMatch, fuzzyCache)
 *        tier-1: `dong|name` 완전일치 / tier-2: 같은 dong 안에서 aptNamesMatch
 *   4) map/page.tsx: lat/lng 없으면 **행을 버린다**, 취소 건너뛴다,
 *      `dong|name` 키로 단지당 최신 1건만 남겨 marker를 만든다
 *
 * marker 판정(추측 금지 — canonical aptSeq 비교로만 확정):
 *   EXACT           tier-1 일치
 *   FALLBACK_SELF   tier-2 일치 + 거래 aptSeq == master aptSeq   (표기 차이, 정당)
 *   FALLBACK_WRONG  tier-2 일치 + 거래 aptSeq != master aptSeq   (**확정 오귀속**)
 *   FALLBACK_UNKNOWN tier-2 일치 + 거래 aptSeq 없음              (증명 불가 — UNKNOWN)
 *   DROPPED         tier-1·2 모두 실패 → 좌표 없음 → marker 안 만들어짐
 *
 * DB는 SELECT만. INSERT/UPDATE/DELETE 0. runtime 파일 수정 0. 외부 API 0.
 *
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/audit-map-identity-fallback-impact.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import * as zlib from 'zlib';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { buildMasterCoordIndex, resolveApartmentCoords, type MasterCoordRow } from '../src/lib/map-marker-coords';
import { aptNamesMatch } from '../src/lib/apt-name-match';
import { mapMolitItems } from '../src/lib/api-molit';
import { normalizeMolitItemsToTradeRows } from './trade-history-logic';
import { FETCH_ORDER, OUT, monthRange, kstYm, type CellCheckpoint } from './audit-seoul-sale-backfill-plan';

const RAW = path.join(OUT, 'raw');
const CELLS = path.join(OUT, 'cells');

export type MarkerClass = 'EXACT' | 'FALLBACK_SELF' | 'FALLBACK_WRONG' | 'FALLBACK_UNKNOWN' | 'DROPPED_NO_MATCH' | 'DROPPED_NO_COORDS';

export interface TradeLike { aptSeq: string | null; dong: string; name: string; dealDate?: string }

/** 운영 판정을 그대로 쓴 한 행의 분류. index.exact 히트 여부로 tier-1/tier-2를 가른다. */
export function classifyRow(
  index: ReturnType<typeof buildMasterCoordIndex>,
  t: TradeLike,
  fuzzyCache: Map<string, MasterCoordRow | null>
): { cls: MarkerClass; resolvedAptSeq: string | null } {
  const tier1 = index.exact.get(`${t.dong}|${t.name}`) ?? null;
  const r = resolveApartmentCoords(index, t.dong, t.name, aptNamesMatch, fuzzyCache);
  const hasCoords = r.lat != null && r.lng != null;
  // 좌표가 없으면 marker가 안 생긴다. 원인은 둘로 갈린다 — master를 아예 못 찾았거나(master 공백),
  // 찾았는데 그 master에 좌표가 없거나(좌표 공백). identity 문제는 전자뿐이다.
  if (!hasCoords) return { cls: r.aptSeq ? 'DROPPED_NO_COORDS' : 'DROPPED_NO_MATCH', resolvedAptSeq: r.aptSeq };
  if (tier1) return { cls: 'EXACT', resolvedAptSeq: r.aptSeq };
  if (!t.aptSeq) return { cls: 'FALLBACK_UNKNOWN', resolvedAptSeq: r.aptSeq };
  return { cls: r.aptSeq === t.aptSeq ? 'FALLBACK_SELF' : 'FALLBACK_WRONG', resolvedAptSeq: r.aptSeq };
}

interface Agg { rows: number; markers: number }
const blank = (): Record<MarkerClass, Agg> => ({
  EXACT: { rows: 0, markers: 0 }, FALLBACK_SELF: { rows: 0, markers: 0 },
  FALLBACK_WRONG: { rows: 0, markers: 0 }, FALLBACK_UNKNOWN: { rows: 0, markers: 0 },
  DROPPED_NO_MATCH: { rows: 0, markers: 0 }, DROPPED_NO_COORDS: { rows: 0, markers: 0 },
});

/** map/page.tsx와 같은 규칙으로 행 목록을 marker 목록으로 접는다(dong|name, 최신 1건). */
function foldToMarkers<T extends TradeLike>(rows: T[]): Map<string, T> {
  const byComplex = new Map<string, T>();
  for (const r of rows) if (!byComplex.has(`${r.dong}|${r.name}`)) byComplex.set(`${r.dong}|${r.name}`, r);
  return byComplex;
}

function loadCells(lawdCd: string): Record<string, CellCheckpoint> {
  const p = path.join(CELLS, `${lawdCd}.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
}

async function main() {
  const { PrismaClient } = await import('@prisma/client');
  const { assertProductionDbAccessAllowed } = await import('./_prod-db-guard');
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'audit-map-identity-fallback-impact.ts');
  const prisma = new PrismaClient();

  // 운영과 같은 12개월 창
  const from = new Date(); from.setMonth(from.getMonth() - 12);
  const fromYm = `${from.getFullYear()}${String(from.getMonth() + 1).padStart(2, '0')}`;

  const { masters, busanRows } = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const masters = await tx.$queryRawUnsafe<any[]>(
      `SELECT apt_seq, name, umd_name, sgg_cd, build_year, latitude, longitude FROM apartment_masters`);
    // fetchApt12MonthsFromDb와 같은 조건: dealType sale · dealCanceled=false · 12개월
    const busanRows = await tx.$queryRawUnsafe<any[]>(
      `SELECT lawd_cd, apt_seq, dong, apt_name, deal_date::text AS deal_date
       FROM apartment_trade_histories
       WHERE lawd_cd LIKE '26%' AND deal_type = 'sale' AND deal_canceled = false
         AND deal_date >= $1::date
       ORDER BY deal_date DESC, id DESC`, from.toISOString().slice(0, 10));
    return { masters, busanRows };
  }, { timeout: 600_000 });
  await prisma.$disconnect();

  const byDistrict = new Map<string, MasterCoordRow[]>();
  for (const m of masters) {
    if (!m.sgg_cd) continue;
    (byDistrict.get(m.sgg_cd) ?? byDistrict.set(m.sgg_cd, []).get(m.sgg_cd)!)
      .push({ name: m.name, umdName: m.umd_name, aptSeq: m.apt_seq, buildYear: m.build_year, latitude: m.latitude, longitude: m.longitude });
  }
  const nameOf = new Map(masters.map((m) => [m.apt_seq, m.name]));

  /** 한 지역(구)의 행 묶음을 운영 파이프라인대로 돌린다. */
  function runDistrict(lawdCd: string, rows: TradeLike[]) {
    const index = buildMasterCoordIndex(byDistrict.get(lawdCd) ?? []);
    const fuzzyCache = new Map<string, MasterCoordRow | null>();
    const agg = blank();
    const markerCls = new Map<string, MarkerClass>();
    const wrongCases: unknown[] = [];
    const wrongRowsByKey = new Map<string, number>();

    for (const r of rows) {
      const { cls, resolvedAptSeq } = classifyRow(index, r, fuzzyCache);
      agg[cls].rows++;
      const key = `${r.dong}|${r.name}`;
      if (!markerCls.has(key)) markerCls.set(key, cls);
      if (cls === 'FALLBACK_WRONG') {
        wrongRowsByKey.set(key, (wrongRowsByKey.get(key) ?? 0) + 1);
        if (!wrongCases.some((c: any) => c.key === key)) {
          wrongCases.push({ key, lawdCd, dong: r.dong, name: r.name, aptSeq: r.aptSeq,
            resolvedAptSeq, resolvedName: nameOf.get(resolvedAptSeq ?? '') ?? null });
        }
      }
    }
    // marker 단위 — DROPPED_*는 marker가 되지 않는다.
    const markers = foldToMarkers(rows);
    for (const [key] of markers) {
      const c = markerCls.get(key);
      if (c) agg[c].markers++;
    }
    const rendered = agg.EXACT.markers + agg.FALLBACK_SELF.markers + agg.FALLBACK_WRONG.markers + agg.FALLBACK_UNKNOWN.markers;
    for (const c of wrongCases as any[]) c.rows = wrongRowsByKey.get(c.key) ?? 0;
    return { lawdCd, agg, rendered, inputRows: rows.length, complexKeys: markers.size, wrongCases };
  }

  // ── 부산: 현재 Production ──
  const busanByDistrict = new Map<string, TradeLike[]>();
  for (const r of busanRows) {
    (busanByDistrict.get(r.lawd_cd) ?? busanByDistrict.set(r.lawd_cd, []).get(r.lawd_cd)!)
      .push({ aptSeq: r.apt_seq, dong: r.dong, name: r.apt_name });
  }
  const busan = [...busanByDistrict.keys()].sort().map((d) => runDistrict(d, busanByDistrict.get(d)!));

  // ── 서울: 캐시된 원천으로 같은 12개월 창 시뮬레이션 (DB INSERT 0) ──
  const months = monthRange(fromYm, kstYm());
  const seoulByDistrict = new Map<string, TradeLike[]>();
  let seoulCellsMissing = 0;
  for (const d of FETCH_ORDER) {
    const cells = loadCells(d);
    const list: TradeLike[] = [];
    for (const ym of months) {
      if (cells[ym]?.status !== 'COMPLETE') { seoulCellsMissing++; continue; }
      const items = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(RAW, d, `${ym}.json.gz`))).toString('utf8'));
      const { rows } = normalizeMolitItemsToTradeRows(mapMolitItems(items, 'apt', d, ym) as any, d, ym);
      for (const r of rows) {
        if (r.dealCanceled) continue; // 운영 DB 경로와 같은 조건
        if (r.dealDate < from.toISOString().slice(0, 10)) continue;
        list.push({ aptSeq: r.aptSeq, dong: r.dong, name: r.aptName, dealDate: r.dealDate });
      }
    }
    // route.ts와 같이 계약일 최신순 — map/page.tsx가 키별 첫 행을 대표로 쓰기 때문.
    list.sort((a, b) => (b.dealDate ?? '').localeCompare(a.dealDate ?? ''));
    seoulByDistrict.set(d, list);
  }
  const seoul = FETCH_ORDER.map((d) => runDistrict(d, seoulByDistrict.get(d) ?? []));

  const sum = (list: ReturnType<typeof runDistrict>[]) => {
    const agg = blank(); let rendered = 0, inputRows = 0;
    for (const r of list) {
      for (const k of Object.keys(agg) as MarkerClass[]) { agg[k].rows += r.agg[k].rows; agg[k].markers += r.agg[k].markers; }
      rendered += r.rendered; inputRows += r.inputRows;
    }
    const fallbackMarkers = agg.FALLBACK_SELF.markers + agg.FALLBACK_WRONG.markers + agg.FALLBACK_UNKNOWN.markers;
    return { inputRows, rendered, exactMarkers: agg.EXACT.markers, fallbackMarkers,
      fallbackSharePct: rendered ? +(fallbackMarkers / rendered * 100).toFixed(2) : 0,
      wrongMarkers: agg.FALLBACK_WRONG.markers,
      wrongSharePct: rendered ? +(agg.FALLBACK_WRONG.markers / rendered * 100).toFixed(2) : 0,
      unknownMarkers: agg.FALLBACK_UNKNOWN.markers, selfMarkers: agg.FALLBACK_SELF.markers,
      droppedNoMatchRows: agg.DROPPED_NO_MATCH.rows, droppedNoMatchComplexes: agg.DROPPED_NO_MATCH.markers,
      droppedNoCoordsRows: agg.DROPPED_NO_COORDS.rows, droppedNoCoordsComplexes: agg.DROPPED_NO_COORDS.markers,
      exactOnlyMarkers: agg.EXACT.markers, removedMarkers: fallbackMarkers,
      removalRatePct: rendered ? +(fallbackMarkers / rendered * 100).toFixed(2) : 0, byClass: agg };
  };

  const out = {
    at: new Date().toISOString(), readOnly: true, apiCalls: 0, runtimeChanged: 0,
    mapPath: {
      shape: 'type=apt & months=12 & loadMore=0 & dong=all',
      window: `${from.toISOString().slice(0, 10)} ~ today (12 months)`,
      busanSource: 'DB-first (isTradeDbFirstLawdCd) — dealType=sale, dealCanceled=false, no row cap',
      seoulSourceToday: 'live MOLIT (cronSync off) — 같은 12개월 창, 같은 좌표 결합 단계를 통과',
      dedupe: 'dong|name, 단지당 최신 1건', dropRule: '좌표 없으면 marker 미생성',
      perRequestScope: '한 번에 lawdCd 1개(지도 중심 역지오코딩)',
      boundsCulling: '없음 — zoom은 individual/grouped 렌더 모드만 바꾼다(markerDensityMode)',
    },
    busanCurrent: { ...sum(busan), districts: busan.map((b) => ({ lawdCd: b.lawdCd, inputRows: b.inputRows, rendered: b.rendered, exact: b.agg.EXACT.markers, fallback: b.agg.FALLBACK_SELF.markers + b.agg.FALLBACK_WRONG.markers + b.agg.FALLBACK_UNKNOWN.markers, wrong: b.agg.FALLBACK_WRONG.markers, droppedNoMatch: b.agg.DROPPED_NO_MATCH.markers, droppedNoCoords: b.agg.DROPPED_NO_COORDS.markers })) },
    seoulSimulated: { cellsMissing: seoulCellsMissing, ...sum(seoul), districts: seoul.map((b) => ({ lawdCd: b.lawdCd, inputRows: b.inputRows, rendered: b.rendered, exact: b.agg.EXACT.markers, fallback: b.agg.FALLBACK_SELF.markers + b.agg.FALLBACK_WRONG.markers + b.agg.FALLBACK_UNKNOWN.markers, wrong: b.agg.FALLBACK_WRONG.markers, droppedNoMatch: b.agg.DROPPED_NO_MATCH.markers, droppedNoCoords: b.agg.DROPPED_NO_COORDS.markers })) },
    busanWrongCases: busan.flatMap((b) => b.wrongCases),
    seoulWrongCases: seoul.flatMap((b) => b.wrongCases),
  };
  fs.writeFileSync(path.join(OUT, 'map-identity-fallback-impact.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ ...out, busanWrongCases: out.busanWrongCases.length, seoulWrongCases: out.seoulWrongCases.length,
    busanCurrent: { ...out.busanCurrent, districts: out.busanCurrent.districts.length },
    seoulSimulated: { ...out.seoulSimulated, districts: out.seoulSimulated.districts.length } }, null, 2));
}

if (require.main === module) main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
