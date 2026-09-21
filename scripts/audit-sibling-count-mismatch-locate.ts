/**
 * SIBLING_COUNT_MISMATCH_SINGLE_GROUP_AUDIT_V1 — repair 스캔이 `SIBLING_COUNT_MISMATCH`로
 * 제외한 그룹의 **정체를 특정**한다 (STRICT READ ONLY).
 *
 * `repair-cancel-ratchet-defect-a.ts`는 건수만 찍고 identity를 남기지 않았다. 그래서 같은
 * 후보 집합·같은 판정 기준을 그대로 쓰되, **skip된 그룹을 전부 펼쳐서** 출력한다.
 * 판정 기준을 복제하지 않기 위해 원천 읽기·정규화는 운영 모듈을 그대로 호출한다.
 *
 * DB write 0. MOLIT GET만.
 *
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/audit-sibling-count-mismatch-locate.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { PrismaClient } from '@prisma/client';
import { assertProductionDbAccessAllowed } from './_prod-db-guard';
import { normalizeMolitItemsToTradeRows } from './trade-history-logic';

const prisma = new PrismaClient();

interface DbRow {
  id: number; lawd_cd: string; deal_ymd: string; group_key: string;
  deal_amount: number; deal_date: string; floor: number | null;
  occurrence_index: number; deal_canceled: boolean; cancel_date: string | null;
  registry_date: string | null; apt_name: string; apt_seq: string | null;
  dong: string | null; created_at: string; updated_at: string; source_fetched_at: string | null;
}

async function main() {
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'audit-sibling-count-mismatch-locate.ts');
  const { fetchSaleRegionMonth } = await import('./sale-molit-fetch');

  // repair script와 **같은** 후보 집합: 형제>1 이고 취소가 1건 이상인 그룹의 전 행.
  const dbRows = await prisma.$queryRawUnsafe<DbRow[]>(`
    WITH g AS (
      SELECT group_key, deal_amount, deal_date, floor,
             COUNT(*)::int AS siblings, COUNT(*) FILTER (WHERE deal_canceled)::int AS canceled
      FROM apartment_trade_histories GROUP BY 1,2,3,4
    )
    SELECT t.id, t.lawd_cd, t.deal_ymd, t.group_key, t.deal_amount,
           t.deal_date::text AS deal_date, t.floor, t.occurrence_index,
           t.deal_canceled, t.cancel_date, t.registry_date, t.apt_name, t.apt_seq, t.dong,
           t.created_at::text AS created_at, t.updated_at::text AS updated_at,
           t.source_fetched_at::text AS source_fetched_at
    FROM apartment_trade_histories t
    JOIN g ON g.group_key = t.group_key AND g.deal_amount = t.deal_amount
          AND g.deal_date = t.deal_date AND g.floor IS NOT DISTINCT FROM t.floor
    WHERE g.siblings > 1 AND g.canceled > 0
    ORDER BY t.lawd_cd, t.deal_ymd, t.group_key, t.occurrence_index`);

  const cells = [...new Set(dbRows.map((r) => `${r.lawd_cd}:${r.deal_ymd}`))].sort();
  const srcByCell = new Map<string, {
    ok: boolean; status: string; totalCount: number | null;
    groups: Map<string, { siblings: number; canceled: number }>;
  }>();
  let fetched = 0;
  for (const cell of cells) {
    const [lawdCd, dealYmd] = cell.split(':');
    const res = await fetchSaleRegionMonth(lawdCd, dealYmd);
    const ok = res.status === 'COMPLETE' || res.status === 'EMPTY_VALID';
    const groups = new Map<string, { siblings: number; canceled: number }>();
    if (ok) {
      const { rows } = normalizeMolitItemsToTradeRows(res.items as never, lawdCd, dealYmd);
      for (const r of rows) {
        const k = `${r.groupKeyStr}|${r.dealAmount}|${r.dealDate}|${r.floor}`;
        const e = groups.get(k) ?? { siblings: 0, canceled: 0 };
        e.siblings++; if (r.dealCanceled) e.canceled++;
        groups.set(k, e);
      }
    }
    srcByCell.set(cell, {
      ok, status: res.status,
      totalCount: (res as { totalCount?: number | null }).totalCount ?? null,
      groups,
    });
    if (++fetched % 100 === 0) process.stderr.write(`  fetched ${fetched}/${cells.length} cells\n`);
  }

  const byGroup = new Map<string, DbRow[]>();
  for (const r of dbRows) {
    const k = `${r.lawd_cd}:${r.deal_ymd}|${r.group_key}|${r.deal_amount}|${r.deal_date}|${r.floor}`;
    (byGroup.get(k) ?? byGroup.set(k, []).get(k)!).push(r);
  }

  const counts: Record<string, number> = {};
  const skippedDetail: unknown[] = [];
  let targetRows = 0;
  for (const [key, rows] of byGroup) {
    const cell = key.split('|')[0];
    const groupKey = key.slice(cell.length + 1);
    const src = srcByCell.get(cell)!;
    const dbCanceled = rows.filter((r) => r.deal_canceled).length;
    const s = src.ok ? src.groups.get(groupKey) : undefined;

    let reason: string | null = null;
    if (!src.ok) reason = 'SOURCE_UNAVAILABLE';
    else if (!s) reason = 'GROUP_ABSENT_IN_SOURCE';
    else if (s.siblings !== rows.length) reason = 'SIBLING_COUNT_MISMATCH';
    else if (s.canceled >= dbCanceled) reason = 'NO_EXCESS';

    if (reason) {
      counts[reason] = (counts[reason] ?? 0) + 1;
      // NO_EXCESS는 정상 상태라 7,958건이다 — 펼치지 않는다.
      if (reason !== 'NO_EXCESS') {
        skippedDetail.push({
          reason, cell, groupKey,
          lawdCd: rows[0].lawd_cd, dealYmd: rows[0].deal_ymd,
          aptName: rows[0].apt_name, dong: rows[0].dong, aptSeq: rows[0].apt_seq,
          dealAmount: rows[0].deal_amount, dealDate: rows[0].deal_date, floor: rows[0].floor,
          dbSiblings: rows.length, dbCanceled,
          srcSiblings: s?.siblings ?? null, srcCanceled: s?.canceled ?? null,
          cellStatus: src.status, cellTotalCount: src.totalCount,
          dbRows: rows.map((r) => ({
            id: r.id, occIdx: r.occurrence_index, canceled: r.deal_canceled,
            cancelDate: r.cancel_date, registryDate: r.registry_date, aptSeq: r.apt_seq,
            createdAt: r.created_at, updatedAt: r.updated_at, sourceFetchedAt: r.source_fetched_at,
          })),
        });
      }
    } else {
      const restorable = rows.filter((r) => r.deal_canceled && r.registry_date == null);
      const excess = dbCanceled - s!.canceled;
      if (restorable.length < excess) {
        counts.REGISTRY_DATE_PRESENT = (counts.REGISTRY_DATE_PRESENT ?? 0) + 1;
      } else targetRows += excess;
    }
  }

  const out = {
    checkedAt: new Date().toISOString(), readOnly: true,
    writes: { insert: 0, update: 0, delete: 0 },
    groupsExamined: byGroup.size, cellsFetched: cells.length,
    counts, targetRowsNow: targetRows,
    cellsNotOk: [...srcByCell.entries()].filter(([, v]) => !v.ok).map(([k, v]) => ({ cell: k, status: v.status })),
    skippedDetail,
  };
  const outDir = path.resolve(__dirname, '../tmp/sibling-count-mismatch');
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `locate-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ ...out, artifact: file }, (_k, v) => (typeof v === 'bigint' ? Number(v) : v), 2));
}

main().catch((e) => { console.error(String(e?.stack ?? e).replace(/serviceKey=[^&\s]*/gi, 'serviceKey=[redacted]')); process.exit(1); })
  .finally(() => prisma.$disconnect());
