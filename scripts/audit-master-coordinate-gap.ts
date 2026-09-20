/**
 * MASTER_COORDINATE_GAP_AUDIT_V1 — master 좌표 공백의 규모·원인·복구 가능성 census (STRICT READ ONLY).
 *
 * 지도는 거래를 `dong+name` 완전일치로 master에 붙인 뒤 그 master의 좌표를 쓴다. master는 있는데
 * 좌표가 없으면 marker가 만들어지지 않는다(MAP_TIER2_FALLBACK_REMOVAL_V1 이후에도 동일).
 * 이 스크립트는 좌표 없는 master가 몇 개이고, 현재 지도 창(최근 12개월)에서 몇 단지·몇 행이
 * marker를 잃는지, 그리고 **어떤 주소 증거로 복구가 가능한지**만 센다.
 *
 * 좌표를 만들지 않는다 · DB를 쓰지 않는다 · 추정 주소를 만들지 않는다.
 *
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/audit-master-coordinate-gap.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import * as zlib from 'zlib';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { mapMolitItems } from '../src/lib/api-molit';
import { normalizeMolitItemsToTradeRows } from './trade-history-logic';
import { FETCH_ORDER, OUT as SEOUL_CACHE, monthRange as seoulMonthRange, kstYm, type CellCheckpoint } from './audit-seoul-sale-backfill-plan';

const OUT = path.resolve(__dirname, '../tmp/master-coordinate-gap');

/**
 * 지도 창 거래의 출처는 지역마다 다르다 — 이것을 섞으면 서울 수치가 틀린다.
 *   부산: cronSync 지역이라 DB-first(`apartment_trade_histories`)
 *   서울: cronSync가 꺼져 있어 **live MOLIT** — DB에는 강남 파일럿 46행뿐이다.
 * 그래서 서울 창 영향은 이미 수집해 둔 원천 캐시(= live MOLIT이 돌려주는 것과 같은 행)로 센다.
 */
function seoulWindowTradesFromCache(fromDate: string): Map<string, { rows: number; lastDeal: string }> {
  const cells = (lawdCd: string): Record<string, CellCheckpoint> => {
    const p = path.join(SEOUL_CACHE, 'cells', `${lawdCd}.json`);
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
  };
  const fromYm = fromDate.slice(0, 4) + fromDate.slice(5, 7);
  const months = seoulMonthRange(fromYm, kstYm());
  const out = new Map<string, { rows: number; lastDeal: string }>();
  for (const d of FETCH_ORDER) {
    const cp = cells(d);
    for (const ym of months) {
      if (cp[ym]?.status !== 'COMPLETE') continue;
      const items = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(SEOUL_CACHE, 'raw', d, `${ym}.json.gz`))).toString('utf8'));
      const { rows } = normalizeMolitItemsToTradeRows(mapMolitItems(items, 'apt', d, ym) as any, d, ym);
      for (const r of rows) {
        if (r.dealCanceled) continue;
        if (r.dealDate < fromDate) continue;
        const k = `${d}|${r.dong}|${r.aptName}`;
        const e = out.get(k);
        if (!e) out.set(k, { rows: 1, lastDeal: r.dealDate });
        else { e.rows++; if (r.dealDate > e.lastDeal) e.lastDeal = r.dealDate; }
      }
    }
  }
  return out;
}

/** §8 주소 증거 수준. LEVEL 4·5는 자동 복구 후보에서 제외한다. */
export type AddressLevel = 'L1_ROAD_EXACT' | 'L2_LOT_EXACT' | 'L3_LEDGER_ADDRESS' | 'L4_NAME_DONG_ONLY' | 'L5_INSUFFICIENT';

export interface MasterRow {
  aptSeq: string | null; name: string; sido: string | null; sigungu: string | null; sggCd: string | null;
  umdName: string | null; umdCd: string | null; jibun: string | null;
  roadAddress: string | null; jibunAddress: string | null;
  latitude: number | null; longitude: number | null; geocodeQuality: string | null;
  mgmBldrgstPk: string | null; buildYear: number | null;
}

/** 본번/부번으로 파싱되는 지번만 LOT_EXACT로 본다. "50-7" · "844" 형식. */
export function parsableLot(jibun: string | null | undefined): boolean {
  return /^\d+(-\d+)?$/.test((jibun ?? '').trim());
}

/** 좌표가 한국 범위 밖이거나 0이면 무효로 본다(추정하지 않고 분리만). */
export function coordInvalid(lat: number | null, lng: number | null): boolean {
  if (lat == null || lng == null) return false; // 없음은 무효가 아니라 결측
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return true;
  if (lat === 0 || lng === 0) return true;
  return lat < 33 || lat > 39 || lng < 124 || lng > 132;
}

export function addressLevel(m: Pick<MasterRow, 'roadAddress' | 'jibunAddress' | 'umdName' | 'jibun' | 'name'>): AddressLevel {
  if (m.roadAddress && m.roadAddress.trim()) return 'L1_ROAD_EXACT';
  if (m.umdName && parsableLot(m.jibun)) return 'L2_LOT_EXACT';
  if (m.jibunAddress && m.jibunAddress.trim()) return 'L3_LEDGER_ADDRESS';
  if (m.umdName && m.name) return 'L4_NAME_DONG_ONLY';
  return 'L5_INSUFFICIENT';
}

/** §11 복구 분류 — 주소 증거와 기존 geocode 결과만으로. 좌표를 만들지 않는다. */
export type RecoveryClass = 'CANDIDATE_EXACT_LOT' | 'PREVIOUSLY_REJECTED_STRICT' | 'NO_SOURCE' | 'LEDGER_BLOCKED';

export function recoveryClass(m: Pick<MasterRow, 'geocodeQuality' | 'roadAddress' | 'jibunAddress' | 'umdName' | 'jibun' | 'name'>): RecoveryClass {
  const lvl = addressLevel(m);
  if (lvl === 'L4_NAME_DONG_ONLY' || lvl === 'L5_INSUFFICIENT') return 'NO_SOURCE';
  // 이미 strict forward+reverse를 돌려 거부된 건(seed가 'failed'로 기록)은 같은 주소로 재시도해도 같은 결과다.
  if (m.geocodeQuality === 'failed') return 'PREVIOUSLY_REJECTED_STRICT';
  return 'CANDIDATE_EXACT_LOT';
}

async function main() {
  const { PrismaClient } = await import('@prisma/client');
  const { assertProductionDbAccessAllowed } = await import('./_prod-db-guard');
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'audit-master-coordinate-gap.ts');
  const prisma = new PrismaClient();

  const from = new Date(); from.setMonth(from.getMonth() - 12);
  const fromDate = from.toISOString().slice(0, 10);

  const { masters, winTrades } = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const masters = await tx.$queryRawUnsafe<any[]>(
      `SELECT apt_seq, name, sido, sigungu, sgg_cd, umd_name, umd_cd, jibun, road_address, jibun_address,
              latitude, longitude, geocode_quality, mgm_bldrgst_pk, build_year
       FROM apartment_masters WHERE sgg_cd IS NOT NULL`);
    // 지도와 같은 조건: sale · 취소 제외 · 최근 12개월
    const winTrades = await tx.$queryRawUnsafe<any[]>(
      `SELECT lawd_cd, dong, apt_name, COUNT(*)::int AS rows, MAX(deal_date)::text AS last_deal
       FROM apartment_trade_histories
       WHERE deal_type = 'sale' AND deal_canceled = false AND deal_date >= $1::date
       GROUP BY 1,2,3`, fromDate);
    return { masters, winTrades };
  }, { timeout: 600_000 });
  await prisma.$disconnect();

  const rows: MasterRow[] = masters.map((m) => ({
    aptSeq: m.apt_seq, name: m.name, sido: m.sido, sigungu: m.sigungu, sggCd: m.sgg_cd,
    umdName: m.umd_name, umdCd: m.umd_cd, jibun: m.jibun, roadAddress: m.road_address, jibunAddress: m.jibun_address,
    latitude: m.latitude, longitude: m.longitude, geocodeQuality: m.geocode_quality,
    mgmBldrgstPk: m.mgm_bldrgst_pk, buildYear: m.build_year,
  }));

  // 거래 쪽 키: 지도와 같은 `dong|name`(구 단위로 분리)
  // 부산은 DB, 서울은 캐시된 원천(live MOLIT과 같은 행) — 위 함수 주석 참고.
  const tradeByKey = new Map<string, { rows: number; lastDeal: string }>();
  for (const t of winTrades) {
    if (!String(t.lawd_cd).startsWith('11')) tradeByKey.set(`${t.lawd_cd}|${t.dong}|${t.apt_name}`, { rows: t.rows, lastDeal: t.last_deal });
  }
  const seoulWindow = seoulWindowTradesFromCache(fromDate);
  for (const [k, v] of seoulWindow) tradeByKey.set(k, v);
  const seoulDbRows = winTrades.filter((t) => String(t.lawd_cd).startsWith('11')).reduce((s2, t) => s2 + t.rows, 0);

  const regionOf = (sggCd: string | null) => (sggCd ?? '').startsWith('11') ? 'SEOUL' : (sggCd ?? '').startsWith('26') ? 'BUSAN' : 'OTHER';

  const baseline: Record<string, any> = {};
  const districtAgg: Record<string, Record<string, any>> = { SEOUL: {}, BUSAN: {} };
  const gapRows: any[] = [];

  for (const m of rows) {
    const region = regionOf(m.sggCd);
    if (region === 'OTHER') continue;
    const b = (baseline[region] ??= { total: 0, bothPresent: 0, latMissing: 0, lngMissing: 0, bothMissing: 0, invalid: 0, byQuality: {} as Record<string, number> });
    b.total++;
    b.byQuality[m.geocodeQuality ?? '(null)'] = (b.byQuality[m.geocodeQuality ?? '(null)'] ?? 0) + 1;
    const noLat = m.latitude == null, noLng = m.longitude == null;
    if (coordInvalid(m.latitude, m.longitude)) b.invalid++;
    if (!noLat && !noLng) b.bothPresent++;
    if (noLat && noLng) b.bothMissing++;
    else { if (noLat) b.latMissing++; if (noLng) b.lngMissing++; }

    const d = (districtAgg[region][m.sggCd!] ??= { total: 0, noCoord: 0, affectedComplexes: 0, affectedRows: 0 });
    d.total++;
    if (noLat || noLng) {
      d.noCoord++;
      const hit = tradeByKey.get(`${m.sggCd}|${m.umdName}|${m.name}`);
      if (hit) { d.affectedComplexes++; d.affectedRows += hit.rows; }
      gapRows.push({
        region, aptSeq: m.aptSeq, name: m.name, sggCd: m.sggCd, sigungu: m.sigungu, dong: m.umdName, umdCd: m.umdCd,
        jibun: m.jibun, roadAddress: m.roadAddress, jibunAddress: m.jibunAddress,
        geocodeQuality: m.geocodeQuality, mgmBldrgstPk: m.mgmBldrgstPk, buildYear: m.buildYear,
        addressLevel: addressLevel(m), recovery: recoveryClass(m),
        windowRows: hit?.rows ?? 0, lastDeal: hit?.lastDeal ?? null, inWindow: !!hit,
      });
    }
  }

  const tally = (list: any[], key: (x: any) => string) => list.reduce((acc: Record<string, { masters: number; inWindow: number; rows: number }>, x) => {
    const k = key(x); const e = (acc[k] ??= { masters: 0, inWindow: 0, rows: 0 });
    e.masters++; if (x.inWindow) e.inWindow++; e.rows += x.windowRows; return acc;
  }, {});

  const perRegion = (region: string) => {
    const list = gapRows.filter((g) => g.region === region);
    return {
      noCoordMasters: list.length,
      affectedComplexesInWindow: list.filter((g) => g.inWindow).length,
      affectedRowsInWindow: list.reduce((s, g) => s + g.windowRows, 0),
      byAddressLevel: tally(list, (x) => x.addressLevel),
      byRecovery: tally(list, (x) => x.recovery),
      byGeocodeQuality: tally(list, (x) => x.geocodeQuality ?? '(null)'),
      topAffected: list.filter((g) => g.inWindow).sort((a, b) => b.windowRows - a.windowRows || (b.lastDeal ?? '').localeCompare(a.lastDeal ?? ''))
        .slice(0, 30).map((g) => ({ aptSeq: g.aptSeq, name: g.name, sigungu: g.sigungu, dong: g.dong, jibun: g.jibun, windowRows: g.windowRows, lastDeal: g.lastDeal, addressLevel: g.addressLevel, recovery: g.recovery })),
    };
  };

  const out = {
    at: new Date().toISOString(), readOnly: true, dbWrites: 0, coordinatesChanged: 0,
    mapWindow: {
      from: fromDate, rule: 'sale · dealCanceled=false · 최근 12개월 · dong|name 완전일치',
      busanSource: 'DB-first (apartment_trade_histories) — cronSync 지역',
      seoulSource: 'live MOLIT과 같은 행(수집해 둔 원천 캐시) — 서울 cronSync OFF라 DB에는 강남 파일럿뿐',
      seoulDbRowsInWindow: seoulDbRows,
      seoulCacheComplexesInWindow: seoulWindow.size,
    },
    baseline,
    seoul: perRegion('SEOUL'),
    busan: perRegion('BUSAN'),
    districts: {
      SEOUL: Object.entries(districtAgg.SEOUL).map(([sggCd, v]: any) => ({ sggCd, ...v, lossPct: v.total ? +(v.noCoord / v.total * 100).toFixed(2) : 0 })).sort((a, b) => b.noCoord - a.noCoord),
      BUSAN: Object.entries(districtAgg.BUSAN).map(([sggCd, v]: any) => ({ sggCd, ...v, lossPct: v.total ? +(v.noCoord / v.total * 100).toFixed(2) : 0 })).sort((a, b) => b.noCoord - a.noCoord),
    },
  };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'coordinate-gap.json'), JSON.stringify({ ...out, gapRows }, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

if (require.main === module) main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
