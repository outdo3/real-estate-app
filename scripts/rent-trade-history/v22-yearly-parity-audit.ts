/**
 * PERFORMANCE_V2.2 §4/§5/§6 — /api/stats/yearly 의 전월세 소스를 DB로 바꿔도 되는지
 * 판정하기 위한 **원천 vs DB 파리티 감사**. STRICT READ ONLY (Production write 0).
 *
 * 판정 규칙은 새로 만들지 않고 기존 검증된 모듈을 그대로 호출한다:
 *   rent-molit-fetch.ts        fetchRentRegionMonth (pagination + completeness)
 *   rent-history-logic.ts      normalizeMolitRentItemsToRentRows (정규화/식별/전월세 판정)
 *
 * 비교 대상은 yearly 라우트가 실제로 계산하는 값과 같은 축이다:
 *   건수 / 전세 건수 / 월세 건수 / 최고·최저·평균 보증금
 *
 * 실행:
 *   npx ts-node --compiler-options '{"module":"commonjs"}' \
 *     scripts/rent-trade-history/v22-yearly-parity-audit.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { prisma } from '../../src/lib/prisma';
import { fetchRentRegionMonth } from './rent-molit-fetch';
import { normalizeMolitRentItemsToRentRows } from './rent-history-logic';

/** DB가 실제로 덮는 구간(manifest legacyBootstrap과 일치) 안팎을 모두 본다. */
const CELLS: { lawdCd: string; label: string; months: string[] }[] = [
  { lawdCd: '26140', label: '서구(소규모)', months: ['202312', '202408', '202501', '202608'] },
  { lawdCd: '26350', label: '해운대구(대규모)', months: ['202312', '202408', '202501', '202608'] },
  { lawdCd: '26230', label: '부산진구(최대)', months: ['202408', '202608'] },
  { lawdCd: '26110', label: '중구(거래 희소)', months: ['202408', '202608'] },
];

interface Agg { count: number; jeonse: number; wolse: number; maxDeposit: number | null; minDeposit: number | null; avgDeposit: number | null }

function aggregate(rows: { deposit: number; monthlyRent: number }[]): Agg {
  if (rows.length === 0) return { count: 0, jeonse: 0, wolse: 0, maxDeposit: null, minDeposit: null, avgDeposit: null };
  const deposits = rows.map((r) => r.deposit);
  return {
    count: rows.length,
    jeonse: rows.filter((r) => r.monthlyRent === 0).length,
    wolse: rows.filter((r) => r.monthlyRent > 0).length,
    maxDeposit: Math.max(...deposits),
    minDeposit: Math.min(...deposits),
    avgDeposit: Math.round(deposits.reduce((a, b) => a + b, 0) / deposits.length),
  };
}

const same = (a: Agg, b: Agg) =>
  a.count === b.count && a.jeonse === b.jeonse && a.wolse === b.wolse &&
  a.maxDeposit === b.maxDeposit && a.minDeposit === b.minDeposit && a.avgDeposit === b.avgDeposit;

async function main() {
  console.log('PERFORMANCE V2.2 — yearly 전월세 소스 파리티 감사 (READ ONLY)\n');

  // ── DB 보유 구간 재확인 ─────────────────────────────────────────────
  const [range] = await prisma.$queryRawUnsafe<{ min_ymd: string; max_ymd: string; months: number; rows: number }[]>(
    `SELECT MIN(deal_ymd) AS min_ymd, MAX(deal_ymd) AS max_ymd,
            COUNT(DISTINCT deal_ymd)::int AS months, COUNT(*)::int AS rows
       FROM apartment_rent_histories`);
  console.log(`  DB 보유 구간: ${range.min_ymd} ~ ${range.max_ymd} (${range.months}개월, ${range.rows.toLocaleString()}행)`);
  console.log(`  yearly 요구 : 201401 ~ 현재월 (약 153개월)\n`);

  const results: Record<string, unknown>[] = [];
  let compared = 0, exact = 0, mismatched = 0, dbMissing = 0;

  for (const cell of CELLS) {
    for (const ym of cell.months) {
      // 원천
      const fetched = await fetchRentRegionMonth(cell.lawdCd, ym);
      const { rows: srcRows, invalid } = normalizeMolitRentItemsToRentRows(fetched.items, cell.lawdCd, ym);
      const src = aggregate(srcRows);

      // DB
      const dbRows = await prisma.apartmentRentHistory.findMany({
        where: { lawdCd: cell.lawdCd, dealYmd: ym },
        select: { deposit: true, monthlyRent: true },
      });
      const db = aggregate(dbRows);

      const inDbRange = ym >= range.min_ymd && ym <= range.max_ymd;
      const match = same(src, db);
      compared++;
      if (!inDbRange && db.count === 0 && src.count > 0) dbMissing++;
      else if (match) exact++;
      else mismatched++;

      results.push({
        lawdCd: cell.lawdCd, label: cell.label, ym, inDbRange,
        fetchStatus: fetched.status, sourceTotalCount: fetched.totalCount, blocked: invalid.length,
        src, db, match,
        delta: { count: db.count - src.count, jeonse: db.jeonse - src.jeonse, wolse: db.wolse - src.wolse },
      });

      const flag = !inDbRange && db.count === 0 && src.count > 0 ? 'DB_MISSING(구간 밖)' : match ? 'MATCH' : '**MISMATCH**';
      console.log(
        `  ${cell.lawdCd} ${ym} ${cell.label.padEnd(14)} ` +
        `원천 ${String(src.count).padStart(4)}건(전세 ${String(src.jeonse).padStart(4)}/월세 ${String(src.wolse).padStart(4)}) | ` +
        `DB ${String(db.count).padStart(4)}건(${String(db.jeonse).padStart(4)}/${String(db.wolse).padStart(4)}) | ${flag}`
      );
    }
  }

  console.log(`\n  비교 셀 ${compared} · 완전일치 ${exact} · 불일치 ${mismatched} · DB 구간밖 결측 ${dbMissing}`);
  console.log(`\n${JSON.stringify({ dbRange: range, compared, exact, mismatched, dbMissing, results }, null, 1)}`);
}

main().catch((e) => { console.error('FAILED', e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());

// 다른 bare 스크립트와 top-level 식별자가 충돌하지 않도록 모듈로 만든다.
export {};
