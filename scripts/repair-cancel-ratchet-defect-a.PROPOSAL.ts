/**
 * CANCELLATION_RATCHET_DEFECT_A — REPAIR SCRIPT **제안본**. 아직 실행하지 않았다.
 *
 * ⚠ 이 파일은 승인 대기 상태다. 파일명에 `.PROPOSAL.`이 들어 있는 동안에는
 *   Production apply를 하지 않는다. 승인 후 파일명을 바꾸고 실행한다.
 *
 * 무엇을 하는가
 *   결함 A(취소 플래그 래칫)로 **원천보다 많이 취소된** 행을 정확히 그만큼만
 *   deal_canceled=false / cancel_date=NULL 로 되돌린다.
 *
 * 안전 설계
 *   1. 기본이 dry-run이다. apply는 `--apply` + `APPROVE_CANCEL_RATCHET_REPAIR=1` 둘 다 필요.
 *   2. **id 목록을 신뢰하지 않는다.** apply 시점에 대상 셀의 MOLIT 원천을 다시 읽어
 *      그룹 단위(순서 무관)로 재판정하고, 그때도 CONFIRMED_FALSE_CANCEL인 행만 쓴다.
 *      → 감사 시점과 apply 시점 사이에 원천이 바뀌었으면 그 그룹은 자동으로 제외된다.
 *   3. 원천 셀이 COMPLETE가 아니면(PARTIAL/INVALID) 그 셀 전체를 건너뛴다 —
 *      "읽지 못한 것"을 "취소가 아니다"로 해석하지 않는다.
 *   4. 예상 건수 assertion: `--expect=N`과 실제 대상 수가 다르면 **쓰기 전에 중단**한다.
 *   5. 각 UPDATE는 `id` + `deal_canceled = true` 를 동시에 WHERE에 건다 —
 *      이미 복구된 행은 0 rows affected가 되어 **idempotent**하다.
 *   6. 배치 단위 트랜잭션. 배치 안에서 예상과 다른 rows-affected가 나오면 롤백 후 중단.
 *   7. 스냅샷을 먼저 파일로 남기지 않으면 apply를 시작하지 않는다(롤백 자료).
 *   8. broad UPDATE 없음 — 항상 명시적 id IN (...) 이다.
 *
 * 실행(제안)
 *   dry-run:  ALLOW_PROD_DB_READ=1 npx tsx scripts/repair-cancel-ratchet-defect-a.ts --expect=21
 *   apply:    ALLOW_PROD_DB_READ=1 APPROVE_CANCEL_RATCHET_REPAIR=1 \
 *             npx tsx scripts/repair-cancel-ratchet-defect-a.ts --apply --expect=21 --batch=25
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
  occurrence_index: number; deal_canceled: boolean;
  cancel_date: string | null; registry_date: string | null;
  apt_name: string; apt_seq: string | null; updated_at: string;
}

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];

async function main() {
  const apply = process.argv.includes('--apply');
  const expect = Number(arg('expect') ?? NaN);
  const batchSize = Number(arg('batch') ?? 25);
  const snapshotPath = arg('snapshot') ?? path.resolve(__dirname, `../tmp/cancel-ratchet-repair-snapshot-${Date.now()}.json`);

  if (!Number.isFinite(expect)) throw new Error('--expect=N 은 필수다(건수 assertion).');
  if (apply && process.env.APPROVE_CANCEL_RATCHET_REPAIR !== '1') {
    throw new Error('apply에는 APPROVE_CANCEL_RATCHET_REPAIR=1 이 필요하다 — 승인 없이 쓰지 않는다.');
  }
  assertProductionDbAccessAllowed(apply ? 'BACKFILL' : 'DIAGNOSTIC', 'repair-cancel-ratchet-defect-a.ts');

  const { fetchSaleRegionMonth } = await import('./sale-molit-fetch');

  // ── 1. 후보 행 읽기(취소가 1건 이상인 다형제 그룹 전체) ────────────────────
  const dbRows = await prisma.$queryRawUnsafe<DbRow[]>(`
    WITH g AS (
      SELECT group_key, deal_amount, deal_date, floor,
             COUNT(*)::int AS siblings, COUNT(*) FILTER (WHERE deal_canceled)::int AS canceled
      FROM apartment_trade_histories GROUP BY 1,2,3,4
    )
    SELECT t.id, t.lawd_cd, t.deal_ymd, t.group_key, t.deal_amount,
           t.deal_date::text AS deal_date, t.floor, t.occurrence_index,
           t.deal_canceled, t.cancel_date, t.registry_date, t.apt_name, t.apt_seq,
           t.updated_at::text AS updated_at
    FROM apartment_trade_histories t
    JOIN g ON g.group_key = t.group_key AND g.deal_amount = t.deal_amount
          AND g.deal_date = t.deal_date AND g.floor IS NOT DISTINCT FROM t.floor
    WHERE g.siblings > 1 AND g.canceled > 0
    ORDER BY t.lawd_cd, t.deal_ymd, t.group_key, t.occurrence_index`);

  // ── 2. 대상 셀의 원천을 지금 다시 읽는다(페이지네이션 포함) ─────────────────
  const cells = [...new Set(dbRows.map((r) => `${r.lawd_cd}:${r.deal_ymd}`))].sort();
  const srcByCell = new Map<string, { ok: boolean; groups: Map<string, { siblings: number; canceled: number }> }>();
  for (const cell of cells) {
    const [lawdCd, dealYmd] = cell.split(':');
    const res = await fetchSaleRegionMonth(lawdCd, dealYmd);
    const groups = new Map<string, { siblings: number; canceled: number }>();
    const ok = res.status === 'COMPLETE' || res.status === 'EMPTY_VALID';
    if (ok) {
      const { rows } = normalizeMolitItemsToTradeRows(res.items as never, lawdCd, dealYmd);
      for (const r of rows) {
        const k = `${r.groupKeyStr}|${r.dealAmount}|${r.dealDate}|${r.floor}`;
        const e = groups.get(k) ?? { siblings: 0, canceled: 0 };
        e.siblings++;
        if (r.dealCanceled) e.canceled++;
        groups.set(k, e);
      }
    }
    srcByCell.set(cell, { ok, groups });
  }

  // ── 3. 그룹 단위 재판정 → repair 대상 확정 ────────────────────────────────
  const byGroup = new Map<string, DbRow[]>();
  for (const r of dbRows) {
    const k = `${r.lawd_cd}:${r.deal_ymd}|${r.group_key}|${r.deal_amount}|${r.deal_date}|${r.floor}`;
    (byGroup.get(k) ?? byGroup.set(k, []).get(k)!).push(r);
  }

  const targets: DbRow[] = [];
  const skipped: Record<string, number> = {};
  for (const [key, rows] of byGroup) {
    const cell = key.split('|')[0];
    const groupKey = key.slice(cell.length + 1);
    const src = srcByCell.get(cell)!;
    if (!src.ok) { skipped.SOURCE_UNAVAILABLE = (skipped.SOURCE_UNAVAILABLE ?? 0) + 1; continue; }
    const s = src.groups.get(groupKey);
    if (!s) { skipped.GROUP_ABSENT_IN_SOURCE = (skipped.GROUP_ABSENT_IN_SOURCE ?? 0) + 1; continue; }
    if (s.siblings !== rows.length) { skipped.SIBLING_COUNT_MISMATCH = (skipped.SIBLING_COUNT_MISMATCH ?? 0) + 1; continue; }
    const dbCanceled = rows.filter((r) => r.deal_canceled).length;
    if (s.canceled >= dbCanceled) { skipped.NO_EXCESS = (skipped.NO_EXCESS ?? 0) + 1; continue; }
    // 등기일자가 있는 행은 건드리지 않는다(취소 거래는 등기가 없다 — 전제가 깨진 행).
    const restorable = rows
      .filter((r) => r.deal_canceled && r.registry_date == null)
      .sort((a, b) => b.occurrence_index - a.occurrence_index || b.id - a.id);
    const excess = dbCanceled - s.canceled;
    if (restorable.length < excess) { skipped.REGISTRY_DATE_PRESENT = (skipped.REGISTRY_DATE_PRESENT ?? 0) + 1; continue; }
    targets.push(...restorable.slice(0, excess));
  }
  targets.sort((a, b) => a.id - b.id);

  console.log(JSON.stringify({
    mode: apply ? 'APPLY' : 'DRY-RUN',
    groupsExamined: byGroup.size, cellsFetched: cells.length,
    skipped, targetRowCount: targets.length, expect,
    targetIds: targets.map((t) => t.id),
  }, null, 2));

  // ── 4. 건수 assertion — 쓰기 전에 멈춘다 ──────────────────────────────────
  if (targets.length !== expect) {
    throw new Error(`ASSERTION FAILED: 대상 ${targets.length}행 ≠ expect ${expect}행. 쓰지 않고 중단한다.`);
  }
  if (!apply) { console.log('\nDRY-RUN 종료 — 아무것도 쓰지 않았다.'); return; }

  // ── 5. 스냅샷(롤백 자료)을 먼저 남긴다 ────────────────────────────────────
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fs.writeFileSync(snapshotPath, JSON.stringify({
    takenAt: new Date().toISOString(),
    note: 'CANCELLATION_RATCHET_DEFECT_A repair — 복구 전 원본 상태',
    rows: targets.map((t) => ({
      id: t.id, deal_canceled: t.deal_canceled, cancel_date: t.cancel_date,
      registry_date: t.registry_date, updated_at: t.updated_at,
      lawd_cd: t.lawd_cd, deal_ymd: t.deal_ymd, apt_name: t.apt_name, apt_seq: t.apt_seq,
      deal_date: t.deal_date, deal_amount: t.deal_amount, floor: t.floor, occurrence_index: t.occurrence_index,
    })),
  }, null, 2));
  console.log(`\n스냅샷 저장: ${snapshotPath} (${targets.length}행)`);

  // ── 6. 배치 UPDATE — 명시적 id + deal_canceled=true 조건(멱등) ─────────────
  let updated = 0;
  for (let i = 0; i < targets.length; i += batchSize) {
    const chunk = targets.slice(i, i + batchSize);
    const ids = chunk.map((c) => c.id);
    const n = await prisma.$transaction(async (tx) => {
      const res = await tx.apartmentTradeHistory.updateMany({
        where: { id: { in: ids }, dealCanceled: true, registryDate: null },
        data: { dealCanceled: false, cancelDate: null },
      });
      if (res.count !== ids.length) {
        throw new Error(`BATCH MISMATCH: 예상 ${ids.length} ≠ 실제 ${res.count} — 트랜잭션 롤백 후 중단`);
      }
      return res.count;
    });
    updated += n;
    console.log(`batch ${i / batchSize + 1}: ${n}행 복구 (누적 ${updated}/${targets.length})`);
  }
  console.log(`\n완료: ${updated}행 복구. 롤백 자료: ${snapshotPath}`);
}

main().catch((e) => { console.error(String(e?.message ?? e).replace(/serviceKey=[^&\s]*/gi, 'serviceKey=[redacted]')); process.exit(1); })
  .finally(() => prisma.$disconnect());
