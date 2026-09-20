/**
 * SEOUL_PILOT_SOURCE_ROWSET_V1 — pilot 범위의 **원천 행 집합 자체**를 artifact로 남긴다.
 *
 * 왜 필요한가: 중구 pilot 원천이 944(2026-09-19) → 943(2026-09-21)으로 1행 줄었는데,
 * 앞선 측정이 **집계 수만** 저장해 어느 행이 사라졌는지 설명할 수 없었다. 수치만으로는
 * "원천이 움직였다"까지만 말할 수 있고 "무엇이 움직였는지"는 말할 수 없다.
 *
 * 그래서 자연키 단위 행 집합을 저장한다. 다음 측정에서 수가 달라지면 **행 단위 diff**가 된다.
 *
 * 저장 항목(§5): aptSeq · 자연키 · 거래일 · 금액 · 층 · occurrenceIndex · 취소 상태 · 원천 셀(월).
 *
 * 읽기 전용 — DB write 0, MOLIT GET만. cache 없이 fresh fetch한다.
 *
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/audit-seoul-pilot-source-rowset.ts --district=11140 --from=2025-10 --to=2026-09
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/audit-seoul-pilot-source-rowset.ts --district=11140 --from=2025-10 --to=2026-09 \
 *     --compare=tmp/seoul-pilot-rowset/rowset-<이전>.json
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { normalizeMolitItemsToTradeRows } from './trade-history-logic';
import { mapMolitItems } from '../src/lib/api-molit';
import { fetchSaleCell } from './seed-seoul-apartment-master-logic';
import { naturalKeyOf, parseYm } from './backfill-seoul-sale-logic';

const OUT = path.resolve(__dirname, '../tmp/seoul-pilot-rowset');

export interface RowsetEntry {
  naturalKey: string;
  aptSeq: string | null;
  aptName: string;
  dong: string | null;
  dealDate: string;
  dealAmount: number;
  floor: number | null;
  occurrenceIndex: number;
  canceled: boolean;
  cancelDate: string | null;
  cell: string;
}

/** 두 행 집합의 차이 — 자연키 기준. 수가 아니라 **무엇이** 달라졌는지 말한다. */
export function diffRowsets(prev: readonly RowsetEntry[], curr: readonly RowsetEntry[]) {
  const p = new Map(prev.map((r) => [r.naturalKey, r]));
  const c = new Map(curr.map((r) => [r.naturalKey, r]));
  const removed = prev.filter((r) => !c.has(r.naturalKey));
  const added = curr.filter((r) => !p.has(r.naturalKey));
  const cancelChanged = curr.filter((r) => {
    const before = p.get(r.naturalKey);
    return before != null && before.canceled !== r.canceled;
  }).map((r) => ({ naturalKey: r.naturalKey, aptName: r.aptName, from: !r.canceled, to: r.canceled }));
  return { removed, added, cancelChanged, prevCount: prev.length, currCount: curr.length };
}

function ymRange(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4)), m = Number(from.slice(4, 6));
  const ey = Number(to.slice(0, 4)), em = Number(to.slice(4, 6));
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

async function main() {
  const get = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
  const district = get('district');
  const from = parseYm(get('from') ?? '');
  const to = parseYm(get('to') ?? '');
  const compare = get('compare');
  if (!district || !from || !to) throw new Error('--district=11140 --from=YYYY-MM --to=YYYY-MM 필요');
  fs.mkdirSync(OUT, { recursive: true });

  // 운영 driver와 **같은** page fetcher를 쓴다 — 조회 계약을 복제하지 않는다.
  const { realFetchPage } = await import('./backfill-seoul-sale');
  const cells = ymRange(from, to);
  const rows: RowsetEntry[] = [];
  const cellStatus: Record<string, unknown>[] = [];
  let invalidTotal = 0;

  for (const ym of cells) {
    const fetched = await fetchSaleCell(realFetchPage, district, ym);
    cellStatus.push({
      ym, status: fetched.status, totalCount: fetched.totalCount,
      collected: fetched.collected, pages: fetched.pages, errors: fetched.errors,
    });
    if (fetched.status !== 'COMPLETE') continue;
    // 운영 driver와 **같은** 매핑+정규화를 그대로 쓴다 — 자연키를 여기서 다시 만들지 않는다.
    const normalized = normalizeMolitItemsToTradeRows(
      mapMolitItems(fetched.items as never[], 'apt', district, ym) as never[], district, ym);
    invalidTotal += normalized.invalid.length;
    for (const r of normalized.rows) {
      rows.push({
        naturalKey: naturalKeyOf({
          groupKeyStr: r.groupKeyStr, dealAmount: r.dealAmount,
          dealDate: typeof r.dealDate === 'string' ? r.dealDate : new Date(r.dealDate).toISOString().slice(0, 10),
          floor: r.floor, occurrenceIndex: r.occurrenceIndex,
        }),
        aptSeq: (r as { aptSeq?: string | null }).aptSeq ?? null,
        aptName: r.aptName,
        dong: (r as { dong?: string | null }).dong ?? null,
        dealDate: typeof r.dealDate === 'string' ? r.dealDate : new Date(r.dealDate).toISOString().slice(0, 10),
        dealAmount: r.dealAmount,
        floor: r.floor,
        occurrenceIndex: r.occurrenceIndex,
        canceled: !!r.dealCanceled,
        cancelDate: r.cancelDate ?? null,
        cell: ym,
      });
    }
  }

  const incomplete = cellStatus.filter((c) => c.status !== 'COMPLETE');
  const dupKeys = rows.length - new Set(rows.map((r) => r.naturalKey)).size;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const summary = {
    at: new Date().toISOString(), readOnly: true, dbWrites: 0,
    district, from, to, cells: cells.length,
    cellsComplete: cellStatus.filter((c) => c.status === 'COMPLETE').length,
    cellsIncomplete: incomplete.length,
    rows: rows.length,
    active: rows.filter((r) => !r.canceled).length,
    canceled: rows.filter((r) => r.canceled).length,
    duplicateNaturalKeysInSource: dupKeys,
    invalidRows: invalidTotal,
    byCell: cellStatus,
  };

  let diff: unknown = null;
  if (compare && fs.existsSync(compare)) {
    const prev = JSON.parse(fs.readFileSync(compare, 'utf8'));
    const d = diffRowsets(prev.rows as RowsetEntry[], rows);
    diff = {
      prevCount: d.prevCount, currCount: d.currCount,
      removed: d.removed.length, added: d.added.length, cancelChanged: d.cancelChanged.length,
      removedRows: d.removed, addedRows: d.added, cancelChangedRows: d.cancelChanged,
    };
  }

  const file = path.join(OUT, `rowset-${district}-${from}-${to}-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify({ ...summary, diff, rows }, null, 2));
  console.log(JSON.stringify({ ...summary, diff, artifact: file }, null, 2));
  if (incomplete.length) { console.error(`[STOP] 불완전 셀 ${incomplete.length}건`); process.exit(2); }
}

if (require.main === module) main().catch((e) => { console.error(String((e as Error)?.stack ?? e)); process.exit(1); });
