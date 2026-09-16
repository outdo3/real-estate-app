/**
 * CANCELLATION_RATCHET_DEFECT_A_REPAIR_AUDIT_V1 — PHASE 1 (DB, STRICT READ ONLY).
 *
 * 결함 A(취소 플래그 래칫)로 과다 취소됐을 가능성이 있는 행을 Production DB에서 식별한다.
 *
 * - 모든 쿼리는 `SET TRANSACTION READ ONLY` 트랜잭션 안에서 SELECT/집계만(write가 섞이면 DB가 거부).
 * - INSERT/UPDATE/DELETE/migration/schema 0. 외부 API 호출 0(PHASE 2가 원천 대조를 맡는다).
 * - occurrence 그룹 = (group_key, deal_amount, deal_date, floor) — trade-history-logic.ts의
 *   occurrenceGroupKey와 같은 정의. 이름/동 fuzzy 매칭 없음.
 *
 * 실행:
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/audit-cancel-ratchet-defect-a-phase1.ts > out.json
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { PrismaClient } from '@prisma/client';
import { assertProductionDbAccessAllowed } from './_prod-db-guard';

const prisma = new PrismaClient();

/** 형제 그룹 집계 CTE — 모든 쿼리가 공유하는 정의. */
const GROUPS = `
  WITH g AS (
    SELECT group_key, deal_amount, deal_date, floor,
           COUNT(*)::int AS siblings,
           COUNT(*) FILTER (WHERE deal_canceled)::int AS canceled,
           COUNT(*) FILTER (WHERE deal_canceled AND cancel_date IS NOT NULL)::int AS canceled_with_date,
           COUNT(DISTINCT cancel_date) FILTER (WHERE deal_canceled)::int AS distinct_cancel_dates,
           MIN(lawd_cd) AS lawd_cd, MIN(deal_ymd) AS deal_ymd
    FROM apartment_trade_histories
    GROUP BY 1,2,3,4
  )`;

const QUERIES: Array<{ key: string; sql: string }> = [
  // ── 전체 규모 ────────────────────────────────────────────────────────────
  { key: 'table_totals', sql: `SELECT COUNT(*)::int AS rows, COUNT(*) FILTER (WHERE deal_canceled)::int AS canceled_rows, COUNT(DISTINCT lawd_cd)::int AS districts, MIN(deal_ymd) AS oldest, MAX(deal_ymd) AS newest FROM apartment_trade_histories` },

  { key: 'group_overview', sql: `${GROUPS}
    SELECT COUNT(*)::int AS all_groups,
           COUNT(*) FILTER (WHERE siblings > 1)::int AS multi_sibling_groups,
           COUNT(*) FILTER (WHERE siblings > 1 AND canceled = siblings)::int AS all_canceled_groups,
           COALESCE(SUM(siblings - 1) FILTER (WHERE siblings > 1 AND canceled = siblings), 0)::int AS suspect_rows_upper_bound
    FROM g` },

  // ── 핵심 판별 근거: 전원 취소 그룹의 cancel_date 패턴 ──────────────────────
  // 진짜 취소 2건이면 서로 다른 해제일을 가질 수 있다. 래칫으로 물든 형제는 같은 sync가
  // 같은 cancelDate를 복사해 넣었을 가능성이 크다 — 구분 신호로 쓸 수 있는지 먼저 본다.
  { key: 'all_canceled_group_cancel_date_pattern', sql: `${GROUPS}
    SELECT siblings,
           distinct_cancel_dates,
           COUNT(*)::int AS groups,
           SUM(siblings - 1)::int AS excess_rows
    FROM g WHERE siblings > 1 AND canceled = siblings
    GROUP BY 1,2 ORDER BY 1,2` },

  { key: 'all_canceled_groups_missing_cancel_date', sql: `${GROUPS}
    SELECT COUNT(*)::int AS groups, SUM(siblings - canceled_with_date)::int AS rows_canceled_without_date
    FROM g WHERE siblings > 1 AND canceled = siblings` },

  // ── 지역 / 기간 분포 ─────────────────────────────────────────────────────
  { key: 'suspect_by_district', sql: `${GROUPS}
    SELECT lawd_cd, COUNT(*)::int AS groups, SUM(siblings - 1)::int AS suspect_rows
    FROM g WHERE siblings > 1 AND canceled = siblings
    GROUP BY 1 ORDER BY suspect_rows DESC` },

  { key: 'suspect_by_year', sql: `
    WITH g AS (
      SELECT deal_year AS y, group_key, deal_amount, deal_date, floor,
             COUNT(*)::int AS siblings, COUNT(*) FILTER (WHERE deal_canceled)::int AS canceled
      FROM apartment_trade_histories GROUP BY 1,2,3,4,5
    )
    SELECT y, COUNT(*) FILTER (WHERE siblings > 1 AND canceled = siblings)::int AS groups,
           COALESCE(SUM(siblings - 1) FILTER (WHERE siblings > 1 AND canceled = siblings), 0)::int AS suspect_rows
    FROM g GROUP BY 1 ORDER BY 1 DESC` },

  // 최근 12개월 / 36개월 — repair 우선순위와 기능 영향 산정용.
  { key: 'suspect_by_recency', sql: `
    WITH g AS (
      SELECT group_key, deal_amount, deal_date, floor,
             COUNT(*)::int AS siblings, COUNT(*) FILTER (WHERE deal_canceled)::int AS canceled,
             MAX(deal_date) AS d
      FROM apartment_trade_histories GROUP BY 1,2,3,4
    )
    SELECT CASE WHEN d >= CURRENT_DATE - INTERVAL '12 months' THEN 'last_12m'
                WHEN d >= CURRENT_DATE - INTERVAL '36 months' THEN 'm13_36'
                ELSE 'older' END AS bucket,
           COUNT(*)::int AS groups, SUM(siblings - 1)::int AS suspect_rows
    FROM g WHERE siblings > 1 AND canceled = siblings
    GROUP BY 1 ORDER BY 1` },

  // ── 대조군: 취소와 유효가 공존하는 그룹(정상으로 보이는 상태) ──────────────
  { key: 'mixed_groups', sql: `${GROUPS}
    SELECT COUNT(*)::int AS groups, SUM(canceled)::int AS canceled_rows, SUM(siblings - canceled)::int AS active_rows
    FROM g WHERE siblings > 1 AND canceled > 0 AND canceled < siblings` },

  // ── PHASE 2 대상 셀 목록 규모 — 원천 대조에 필요한 MOLIT 요청 수 산정 ──────
  { key: 'suspect_cells', sql: `${GROUPS}
    SELECT COUNT(DISTINCT lawd_cd || ':' || deal_ymd)::int AS distinct_cells
    FROM g WHERE siblings > 1 AND canceled = siblings` },

  { key: 'suspect_cell_list', sql: `${GROUPS}
    SELECT lawd_cd, deal_ymd, COUNT(*)::int AS groups, SUM(siblings - 1)::int AS suspect_rows
    FROM g WHERE siblings > 1 AND canceled = siblings
    GROUP BY 1,2 ORDER BY deal_ymd DESC, lawd_cd` },

  // ── 실제 행 목록(수집: id + 식별 필드만, 개인정보 없음) ───────────────────
  { key: 'suspect_rows_detail', sql: `${GROUPS}
    SELECT t.id, t.lawd_cd, t.deal_ymd, t.apt_seq, t.apt_name, t.dong,
           t.deal_date::text AS deal_date, t.deal_amount, t.exclusive_area::text AS exclusive_area,
           t.floor, t.occurrence_index, t.deal_canceled, t.cancel_date, t.registry_date,
           t.group_key, g.siblings, g.canceled,
           t.created_at, t.updated_at, t.source_fetched_at
    FROM apartment_trade_histories t
    JOIN g ON g.group_key = t.group_key AND g.deal_amount = t.deal_amount
          AND g.deal_date = t.deal_date AND g.floor IS NOT DISTINCT FROM t.floor
    WHERE g.siblings > 1 AND g.canceled = g.siblings
    ORDER BY t.deal_date DESC, t.group_key, t.occurrence_index` },

  // ── 무결성 확인: 자연키 중복이 없는지(repair 대상 식별이 모호해지지 않도록) ──
  { key: 'natural_key_duplicates', sql: `
    SELECT COUNT(*)::int AS duplicate_natural_keys FROM (
      SELECT group_key, deal_amount, deal_date, floor, occurrence_index, COUNT(*)::int AS n
      FROM apartment_trade_histories GROUP BY 1,2,3,4,5 HAVING COUNT(*) > 1
    ) d` },
];

async function main() {
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'audit-cancel-ratchet-defect-a-phase1.ts');
  const out: Record<string, unknown> = { startedAt: new Date().toISOString(), readOnly: true };

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '180s'");
    for (const q of QUERIES) {
      const t0 = Date.now();
      try {
        out[q.key] = { rows: await tx.$queryRawUnsafe(q.sql), ms: Date.now() - t0 };
      } catch (e: any) {
        out[q.key] = { error: String(e?.message ?? e).slice(0, 300), ms: Date.now() - t0 };
      }
    }
  }, { timeout: 600_000 });

  out.endedAt = new Date().toISOString();
  console.log(JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? Number(v) : v), 2));
}

main()
  .catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); })
  .finally(() => prisma.$disconnect());
