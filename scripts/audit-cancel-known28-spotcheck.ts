/**
 * CANCELLATION_CRON_VALIDATION_AFTER_INSERT_PATH_FIX_V1 §4 — 확정 28행 중 cron 범위 밖 셀에
 * 있는 행을 개별 원천 대조한다 (READ ONLY).
 *
 * MOLIT GET + DB SELECT만. INSERT/UPDATE/DELETE 0.
 *
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/audit-cancel-known28-spotcheck.ts <id> [<id> ...]
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

async function main() {
  const { assertProductionDbAccessAllowed } = await import('./_prod-db-guard');
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'audit-cancel-known28-spotcheck.ts');
  const { prisma } = await import('../src/lib/prisma');
  const { fetchSaleRegionMonth } = await import('./sale-molit-fetch');
  const { normalizeMolitItemsToTradeRows } = await import('./trade-history-logic');

  const ids = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n));
  const targets = await prisma.apartmentTradeHistory.findMany({
    where: { id: { in: ids } },
    select: { id: true, lawdCd: true, dealYmd: true, aptName: true, dong: true, groupKeyStr: true,
      dealAmount: true, dealDate: true, floor: true, occurrenceIndex: true, dealCanceled: true,
      cancelDate: true, createdAt: true, updatedAt: true, sourceFetchedAt: true },
  });

  const gk = (r: { groupKeyStr: string; dealAmount: number; dealDate: string; floor: number | null }) =>
    `${r.groupKeyStr}|${r.dealAmount}|${r.dealDate}|${r.floor}`;

  const out: unknown[] = [];
  for (const t of targets) {
    const fr = await fetchSaleRegionMonth(t.lawdCd, t.dealYmd);
    if (fr.status !== 'COMPLETE' && fr.status !== 'EMPTY_VALID') {
      out.push({ id: t.id, cell: `${t.lawdCd}:${t.dealYmd}`, fetchStatus: fr.status, verdict: 'FETCH_NOT_COMPLETE' });
      continue;
    }
    const { rows } = normalizeMolitItemsToTradeRows(fr.items, t.lawdCd, t.dealYmd);
    const key = gk({ groupKeyStr: t.groupKeyStr, dealAmount: t.dealAmount, dealDate: t.dealDate.toISOString().slice(0, 10), floor: t.floor });
    const src = rows.filter((r) => gk(r) === key);
    const dbRows = await prisma.apartmentTradeHistory.findMany({
      where: { lawdCd: t.lawdCd, dealYmd: t.dealYmd, groupKeyStr: t.groupKeyStr, dealAmount: t.dealAmount, dealDate: t.dealDate, floor: t.floor },
      select: { id: true, occurrenceIndex: true, dealCanceled: true, cancelDate: true, createdAt: true, updatedAt: true, sourceFetchedAt: true },
      orderBy: { occurrenceIndex: 'asc' },
    });
    const srcCanceled = src.filter((r) => r.dealCanceled).length;
    const dbCanceled = dbRows.filter((r) => r.dealCanceled).length;
    out.push({
      id: t.id, cell: `${t.lawdCd}:${t.dealYmd}`, apt: t.aptName, dong: t.dong,
      dealAmount: t.dealAmount, dealDate: t.dealDate.toISOString().slice(0, 10), floor: t.floor,
      src: `${srcCanceled}/${src.length}`, db: `${dbCanceled}/${dbRows.length}`,
      overCancel: src.length === dbRows.length && dbCanceled > srcCanceled,
      underCancel: src.length === dbRows.length && dbCanceled < srcCanceled,
      siblingMismatch: src.length !== dbRows.length,
      dbRows,
    });
  }
  console.log(JSON.stringify(out, null, 2));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
