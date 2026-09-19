/**
 * CANCELLATION_PREVENTION_CRON_VALIDATION_GATE_V1 — cron이 건드린 셀의 원천 대조 census (READ ONLY).
 *
 * 범위: 배포 이후 cron이 검증한 SALE 셀 + 부산 16개 구의 현재월 셀. 전체 1,118셀을 다시 읽지 않는다.
 * MOLIT GET + DB SELECT만 한다. INSERT/UPDATE/DELETE 0, sync core 호출 0.
 * 그룹(자연키 − occurrenceIndex)마다 원천/DB의 취소 수·형제 수를 비교해
 * OVER_CANCEL(과다 취소) / UNDER_CANCEL(진짜 취소 누락) / 형제 수 불일치로 분류한다.
 *
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/audit-cancel-prevention-cron-census.ts [deployIsoUtc] [currentYm]
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

const DEPLOY = new Date(process.argv[2] ?? '2026-09-16T03:35:00Z');
const CURRENT_YM = process.argv[3] ?? '202609';
const KNOWN21 = new Set([940779, 940906, 949472, 949523, 949532, 949575, 949624, 949692, 949727, 949910, 949929, 949991, 950026, 950082, 950183, 950194, 950239, 950382, 950395, 950396, 950451]);

async function main() {
  const { assertProductionDbAccessAllowed } = await import('./_prod-db-guard');
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'audit-cancel-prevention-cron-census.ts');
  const { prisma } = await import('../src/lib/prisma');
  const { fetchSaleRegionMonth } = await import('./sale-molit-fetch');
  const { normalizeMolitItemsToTradeRows } = await import('./trade-history-logic');
  const { BUSAN_LAWDCD_16 } = await import('../src/lib/rent-verified-range');

  const touched = await prisma.syncCoverageCell.findMany({ where: { dataset: 'SALE', verifiedAt: { gt: DEPLOY } }, select: { lawdCd: true, dealYmd: true, runId: true } });
  const cells = new Map<string, string>(touched.map((c) => [`${c.lawdCd}:${c.dealYmd}`, c.runId]));
  for (const l of BUSAN_LAWDCD_16) if (!cells.has(`${l}:${CURRENT_YM}`)) cells.set(`${l}:${CURRENT_YM}`, 'current-month(no coverage row)');

  const gk = (r: { groupKeyStr: string; dealAmount: number; dealDate: string; floor: number | null }) => `${r.groupKeyStr}|${r.dealAmount}|${r.dealDate}|${r.floor}`;
  const findings: Record<string, unknown[]> = { OVER_CANCEL: [], UNDER_CANCEL: [], DB_MORE_SIBLINGS: [], SRC_MORE_SIBLINGS: [] };
  const fetchIssues: unknown[] = [];
  let scanned = 0;
  for (const [cell, runId] of [...cells.entries()].sort()) {
    const [lawdCd, dealYmd] = cell.split(':');
    const fr = await fetchSaleRegionMonth(lawdCd, dealYmd);
    if (fr.status !== 'COMPLETE' && fr.status !== 'EMPTY_VALID') { fetchIssues.push({ cell, status: fr.status, total: fr.totalCount, fetched: fr.collectedCount }); continue; }
    scanned++;
    const { rows } = normalizeMolitItemsToTradeRows(fr.items, lawdCd, dealYmd);
    const src = new Map<string, { c: number; t: number }>();
    for (const r of rows) { const k = gk(r); const v = src.get(k) ?? { c: 0, t: 0 }; v.t++; if (r.dealCanceled) v.c++; src.set(k, v); }
    const dbRows = await prisma.apartmentTradeHistory.findMany({ where: { lawdCd, dealYmd }, select: { id: true, groupKeyStr: true, dealAmount: true, dealDate: true, floor: true, dealCanceled: true, createdAt: true, updatedAt: true, aptName: true } });
    const db = new Map<string, { c: number; t: number; ids: number[]; changedSinceDeploy: boolean; apt: string }>();
    for (const r of dbRows) {
      const k = gk({ ...r, dealDate: r.dealDate.toISOString().slice(0, 10) });
      const v = db.get(k) ?? { c: 0, t: 0, ids: [], changedSinceDeploy: false, apt: r.aptName };
      v.t++; if (r.dealCanceled) v.c++; v.ids.push(r.id);
      if (r.createdAt > DEPLOY || r.updatedAt > DEPLOY) v.changedSinceDeploy = true;
      db.set(k, v);
    }
    for (const k of new Set([...src.keys(), ...db.keys()])) {
      const s = src.get(k) ?? { c: 0, t: 0 }; const d = db.get(k) ?? { c: 0, t: 0, ids: [], changedSinceDeploy: false, apt: '' };
      const rec = { cell, runId, key: k, apt: d.apt, src: `${s.c}/${s.t}`, db: `${d.c}/${d.t}`, ids: d.ids, known21: d.ids.some((id) => KNOWN21.has(id)), changedSinceDeploy: d.changedSinceDeploy };
      if (s.t === d.t) {
        if (d.c > s.c) findings.OVER_CANCEL.push(rec);
        else if (d.c < s.c) findings.UNDER_CANCEL.push(rec);
      } else if (d.t > s.t) findings.DB_MORE_SIBLINGS.push(rec);
      else findings.SRC_MORE_SIBLINGS.push(rec);
    }
  }
  const summary = Object.fromEntries(Object.entries(findings).map(([k, v]) => [k, v.length]));
  console.log(JSON.stringify({ cellsInScope: cells.size, scanned, fetchIssues, summary, findings }, null, 2));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
