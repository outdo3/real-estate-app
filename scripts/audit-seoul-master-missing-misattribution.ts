/**
 * SEOUL_HISTORICAL_MASTER_MISSING_STRATEGY_V1 §7 — master 없는 거래가 제품에서 **다른 단지로
 * 잘못 귀속되는지**를 실제 운영 함수로 검증한다 (STRICT READ ONLY).
 *
 * (MAP_TIER2_FALLBACK_REMOVAL_V1 이후: 아래 2순위 규칙은 운영에서 제거됐다. 이 스크립트는
 *  당시 측정을 재현할 수 있도록 `legacyResolveAptSeq()`로 그 규칙을 감사용으로만 되살린다.)
 *
 * 지도(`/api/transactions`)는 거래의 (dong, name)을 `resolveApartmentCoords()`로 master에
 * 연결한다. 1순위는 dong+name 완전일치, 2순위는 **같은 법정동 안에서 `aptNamesMatch()`**
 * (양방향 부분포함 + 차수 가드). 2순위가 과거 단지를 현재 다른 단지에 붙이면 그 거래는
 * 다른 단지의 aptSeq·좌표를 갖게 된다 — 이것이 오귀속이다.
 *
 * 여기서는 **운영 코드를 그대로 import해서** 실제 master 목록과 실제 과거 단지 이름으로
 * 돌려 본다. 추정하지 않고 실행 결과만 센다. 부산(이미 출시된 지역)도 같이 돌려 현재
 * Production에서 이미 일어나고 있는지 확인한다.
 *
 * DB는 SELECT만. INSERT/UPDATE/DELETE 0. master 생성 0. 외부 API 0.
 *
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/audit-seoul-master-missing-misattribution.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { buildMasterCoordIndex, type MasterCoordRow } from '../src/lib/map-marker-coords';
import { legacyResolveAptSeq, buildLegacyDongIndex } from './audit-map-identity-fallback-impact';
import { OUT } from './audit-seoul-sale-backfill-plan';

interface Missing { aptSeq: string; lawdCd: string; names: string[]; dongs: string[]; rows: number }

async function main() {
  const { PrismaClient } = await import('@prisma/client');
  const { assertProductionDbAccessAllowed } = await import('./_prod-db-guard');
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'audit-seoul-master-missing-misattribution.ts');
  const prisma = new PrismaClient();

  const masters = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    return tx.$queryRawUnsafe<{ apt_seq: string | null; name: string; umd_name: string | null; sgg_cd: string | null; build_year: number | null; latitude: number | null; longitude: number | null }[]>(
      `SELECT apt_seq, name, umd_name, sgg_cd, build_year, latitude, longitude FROM apartment_masters`);
  }, { timeout: 180_000 });

  // 부산 현황(이미 출시된 지역)에서 master 없는 거래의 (dong, name)을 실제로 읽는다.
  const busanMissing = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    return tx.$queryRawUnsafe<{ apt_seq: string; lawd_cd: string; dong: string; apt_name: string; rows: number }[]>(
      `SELECT t.apt_seq, t.lawd_cd, t.dong, t.apt_name, COUNT(*)::int AS rows
       FROM apartment_trade_histories t
       LEFT JOIN apartment_masters m ON m.apt_seq = t.apt_seq
       WHERE t.lawd_cd LIKE '26%' AND m.apt_seq IS NULL AND t.apt_seq IS NOT NULL
       GROUP BY 1,2,3,4`);
  }, { timeout: 300_000 });
  await prisma.$disconnect();

  const byDistrict = new Map<string, MasterCoordRow[]>();
  for (const m of masters) {
    if (!m.sgg_cd) continue;
    (byDistrict.get(m.sgg_cd) ?? byDistrict.set(m.sgg_cd, []).get(m.sgg_cd)!)
      .push({ name: m.name, umdName: m.umd_name, aptSeq: m.apt_seq, buildYear: m.build_year, latitude: m.latitude, longitude: m.longitude });
  }
  const indexCache = new Map<string, { index: ReturnType<typeof buildMasterCoordIndex>; byDong: Map<string, MasterCoordRow[]> }>();
  const indexFor = (lawdCd: string) => {
    let i = indexCache.get(lawdCd);
    if (!i) {
      const ms = byDistrict.get(lawdCd) ?? [];
      i = { index: buildMasterCoordIndex(ms), byDong: buildLegacyDongIndex(ms) };
      indexCache.set(lawdCd, i);
    }
    return i;
  };

  /** 한 (구, 동, 이름, 자기 aptSeq) 조합이 운영 규칙에서 어디로 붙는지. */
  function probe(lawdCd: string, dong: string, name: string, ownSeq: string) {
    const { index, byDong } = indexFor(lawdCd);
    const { master } = legacyResolveAptSeq(index, byDong, dong, name);
    const coords = !!master && Number.isFinite(master.latitude) && Number.isFinite(master.longitude);
    if (!master || !master.aptSeq) return { verdict: 'NO_MATCH' as const, to: null as string | null, coords: false };
    if (master.aptSeq === ownSeq) return { verdict: 'SELF' as const, to: master.aptSeq, coords };
    return { verdict: 'MISATTRIBUTED' as const, to: master.aptSeq, coords };
  }

  // ── 서울: 이번 측정의 MASTER_MISSING 전수 ──
  const hist = JSON.parse(fs.readFileSync(path.join(OUT, 'historical-master-strategy.json'), 'utf8'));
  const seoulMissing: Missing[] = hist.all;
  const seoul = { NO_MATCH: 0, SELF: 0, MISATTRIBUTED: 0 } as Record<string, number>;
  const seoulRows = { NO_MATCH: 0, SELF: 0, MISATTRIBUTED: 0 } as Record<string, number>;
  const seoulCases: unknown[] = [];
  for (const m of seoulMissing) {
    // 한 aptSeq가 여러 (동, 이름) 표기를 가질 수 있어 가장 흔한 조합 하나로 대표한다.
    const dong = m.dongs[0] ?? '';
    for (const name of m.names) {
      const p = probe(m.lawdCd, dong, name, m.aptSeq);
      seoul[p.verdict]++; seoulRows[p.verdict] += m.rows;
      if (p.verdict === 'MISATTRIBUTED') {
        const target = masters.find((x) => x.apt_seq === p.to);
        seoulCases.push({ aptSeq: m.aptSeq, lawdCd: m.lawdCd, dong, name, rows: m.rows, to: p.to, toName: target?.name, toBuildYear: target?.build_year, gotCoords: p.coords });
      }
      break; // 대표 표기 1개만
    }
  }

  // ── 부산: 현재 Production에서 이미 일어나고 있는가 ──
  const busan = { NO_MATCH: 0, SELF: 0, MISATTRIBUTED: 0 } as Record<string, number>;
  const busanRows = { NO_MATCH: 0, SELF: 0, MISATTRIBUTED: 0 } as Record<string, number>;
  const busanCases: unknown[] = [];
  for (const b of busanMissing) {
    const p = probe(b.lawd_cd, b.dong, b.apt_name, b.apt_seq);
    busan[p.verdict]++; busanRows[p.verdict] += b.rows;
    if (p.verdict === 'MISATTRIBUTED') {
      const target = masters.find((x) => x.apt_seq === p.to);
      busanCases.push({ aptSeq: b.apt_seq, lawdCd: b.lawd_cd, dong: b.dong, name: b.apt_name, rows: b.rows, to: p.to, toName: target?.name, gotCoords: p.coords });
    }
  }

  const out = {
    at: new Date().toISOString(), readOnly: true, apiCalls: 0, masterCreated: 0,
    method: 'MAP_TIER2_FALLBACK_REMOVAL_V1로 제거된 2순위 규칙(legacyResolveAptSeq)을 감사용으로 재현해 실제 master/이름으로 실행 — 현재 운영 경로에는 이 규칙이 없다',
    seoul: { aptSeqsProbed: seoulMissing.length, byVerdict: seoul, rowsByVerdict: seoulRows,
      misattributedRows: seoulRows.MISATTRIBUTED, cases: seoulCases.slice(0, 40), caseCount: seoulCases.length },
    busanToday: { pairsProbed: busanMissing.length, byVerdict: busan, rowsByVerdict: busanRows,
      misattributedRows: busanRows.MISATTRIBUTED, cases: busanCases.slice(0, 40), caseCount: busanCases.length },
  };
  fs.writeFileSync(path.join(OUT, 'master-missing-misattribution.json'), JSON.stringify({ ...out, seoulCasesAll: seoulCases, busanCasesAll: busanCases }, null, 2));
  console.log(JSON.stringify({ ...out, seoul: { ...out.seoul, cases: out.seoul.cases.length }, busanToday: { ...out.busanToday, cases: out.busanToday.cases.length } }, null, 2));
}

if (require.main === module) main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
