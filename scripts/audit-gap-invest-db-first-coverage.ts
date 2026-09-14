/**
 * GAP_INVEST_BUSAN_DB_FIRST_V1 §2 — DB coverage 감사 (STRICT READ ONLY).
 *
 * write 0회 / 외부 API 호출 0회. 집계는 전부 서버측 GROUP BY로 수행한다
 * (SUPABASE_EGRESS_P0_FIX_V1 원칙 — raw row를 Node로 옮기지 않는다).
 *
 * 실행:
 *   ALLOW_PROD_DB_READ=1 npx tsx -r dotenv/config scripts/audit-gap-invest-db-first-coverage.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { PrismaClient } from '@prisma/client';
import { assertProductionDbAccessAllowed } from './_prod-db-guard';
import { BUSAN_LAWDCD_16, computeVerifiedRangeFromCoverage, LEGACY_BOOTSTRAP_FALLBACK } from '../src/lib/rent-verified-range';

const prisma = new PrismaClient();

function last12Months(now: Date): string[] {
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
}

async function main() {
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'audit-gap-invest-db-first-coverage');
  const now = new Date();
  const months = last12Months(now);
  console.log('# GAP INVEST DB-FIRST COVERAGE AUDIT');
  console.log('now(local):', now.toISOString(), 'months:', months.join(','));

  // 1) SALE row counts by (lawdCd, dealYmd)
  const saleRows = await prisma.$queryRaw<{ lawd_cd: string; ym: string; cnt: bigint; canceled: bigint }[]>`
    SELECT lawd_cd, to_char(deal_date, 'YYYYMM') as ym, COUNT(*) as cnt,
           COUNT(*) FILTER (WHERE deal_canceled) as canceled
    FROM apartment_trade_histories
    WHERE lawd_cd = ANY(${BUSAN_LAWDCD_16}) AND deal_type = 'sale'
      AND to_char(deal_date, 'YYYYMM') = ANY(${months})
    GROUP BY 1, 2
  `;
  // 2) RENT row counts
  const rentRows = await prisma.$queryRaw<{ lawd_cd: string; ym: string; cnt: bigint; jeonse: bigint }[]>`
    SELECT lawd_cd, deal_ymd as ym, COUNT(*) as cnt,
           COUNT(*) FILTER (WHERE deal_type = 'jeonse') as jeonse
    FROM apartment_rent_histories
    WHERE lawd_cd = ANY(${BUSAN_LAWDCD_16}) AND deal_ymd = ANY(${months})
    GROUP BY 1, 2
  `;
  // 3) coverage cells
  const cells = await prisma.syncCoverageCell.findMany({
    where: { lawdCd: { in: BUSAN_LAWDCD_16 }, dealYmd: { in: months } },
    select: { dataset: true, lawdCd: true, dealYmd: true, status: true, verifiedAt: true },
  });

  const saleByYm = new Map<string, { districts: Set<string>; cnt: number; canceled: number }>();
  for (const r of saleRows) {
    if (!saleByYm.has(r.ym)) saleByYm.set(r.ym, { districts: new Set(), cnt: 0, canceled: 0 });
    const b = saleByYm.get(r.ym)!;
    b.districts.add(r.lawd_cd); b.cnt += Number(r.cnt); b.canceled += Number(r.canceled);
  }
  const rentByYm = new Map<string, { districts: Set<string>; cnt: number; jeonse: number }>();
  for (const r of rentRows) {
    if (!rentByYm.has(r.ym)) rentByYm.set(r.ym, { districts: new Set(), cnt: 0, jeonse: 0 });
    const b = rentByYm.get(r.ym)!;
    b.districts.add(r.lawd_cd); b.cnt += Number(r.cnt); b.jeonse += Number(r.jeonse);
  }
  const cellByKey = new Map<string, string>();
  for (const c of cells) cellByKey.set(`${c.dataset}:${c.lawdCd}:${c.dealYmd}`, c.status);

  const statusFor = (ds: 'SALE' | 'RENT', ym: string) => {
    const counts: Record<string, number> = {};
    let missing = 0;
    for (const code of BUSAN_LAWDCD_16) {
      const s = cellByKey.get(`${ds}:${code}:${ym}`);
      if (!s) missing++;
      else counts[s] = (counts[s] || 0) + 1;
    }
    const parts = Object.entries(counts).map(([k, v]) => `${k}=${v}`);
    if (missing) parts.push(`NO_CELL=${missing}`);
    return parts.join(' ') || 'NO_CELL=16';
  };

  console.log('\n## PER-MONTH (16 districts expected)');
  console.log('ym      | saleDistricts saleRows saleCanceled | rentDistricts rentRows jeonseRows | SALE cells | RENT cells');
  for (const ym of months) {
    const s = saleByYm.get(ym); const r = rentByYm.get(ym);
    console.log(
      `${ym}  | ${String(s?.districts.size ?? 0).padStart(2)}/16 ${String(s?.cnt ?? 0).padStart(6)} ${String(s?.canceled ?? 0).padStart(5)}` +
      ` | ${String(r?.districts.size ?? 0).padStart(2)}/16 ${String(r?.cnt ?? 0).padStart(6)} ${String(r?.jeonse ?? 0).padStart(6)}` +
      ` | ${statusFor('SALE', ym)} | ${statusFor('RENT', ym)}`
    );
  }

  // 4) computed rent verified range (same rule the app uses)
  const allRentCells = await prisma.syncCoverageCell.findMany({
    where: { dataset: 'RENT', dealYmd: { gt: LEGACY_BOOTSTRAP_FALLBACK.to } },
    select: { lawdCd: true, dealYmd: true, status: true },
  });
  const map: Record<string, { status: string }> = {};
  for (const c of allRentCells) map[`${c.lawdCd}:${c.dealYmd}`] = { status: c.status };
  console.log('\n## RENT verified range (bootstrap fallback base):', JSON.stringify(computeVerifiedRangeFromCoverage(LEGACY_BOOTSTRAP_FALLBACK, map, BUSAN_LAWDCD_16, now)));
  console.log('   bootstrap fallback =', JSON.stringify(LEGACY_BOOTSTRAP_FALLBACK));

  // 5) latest deal dates
  const latest = await prisma.$queryRaw<{ src: string; maxd: Date | null }[]>`
    SELECT 'sale' as src, MAX(deal_date) as maxd FROM apartment_trade_histories WHERE lawd_cd = ANY(${BUSAN_LAWDCD_16})
    UNION ALL
    SELECT 'rent' as src, MAX(deal_date) as maxd FROM apartment_rent_histories WHERE lawd_cd = ANY(${BUSAN_LAWDCD_16})
  `;
  console.log('\n## LATEST deal_date:', latest.map((l) => `${l.src}=${l.maxd?.toISOString().slice(0, 10)}`).join(' '));
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
