/**
 * MOLIT_QUOTA_SCALE_PROBE_V1 §14/§15 — Production 로그·커버리지 셀 read-only 감사.
 *
 * STRICT READ ONLY: `SET TRANSACTION READ ONLY` 트랜잭션 안에서 SELECT/집계만 실행한다
 * (write가 섞이면 DB가 거부). 행 materialization 없이 서버측 집계만 가져온다.
 * 외부 API 호출 0회.
 *
 * 실행:
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/audit-molit-quota-log-read.ts > out.json
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { PrismaClient } from '@prisma/client';
import { assertProductionDbAccessAllowed } from './_prod-db-guard';

const prisma = new PrismaClient();

const QUERIES: Array<{ key: string; sql: string }> = [
  // §14 — 최근 30일 MOLIT 관련 오류 유형별 집계.
  {
    key: 'error_logs_molit_30d',
    sql: `SELECT
            CASE
              WHEN message ~* '초당|요청제한|PER_SECOND|LIMITED_NUMBER' THEN 'RATE_LIMIT'
              WHEN message ~* 'timeout|timed out|aborted|TimeoutError' THEN 'TIMEOUT'
              WHEN message ~* '제한 해제 대기' THEN 'BREAKER_WAIT'
              WHEN message ~* 'SERVICE_KEY|서비스키|인증' THEN 'AUTH'
              WHEN message ~* 'API 에러|공공데이터|MOLIT' THEN 'MOLIT_OTHER'
              ELSE 'NON_MOLIT'
            END AS kind,
            COUNT(*)::int AS n,
            MAX(created_at) AS latest
          FROM error_logs
          WHERE created_at >= NOW() - INTERVAL '30 days'
          GROUP BY 1 ORDER BY n DESC`,
  },
  { key: 'error_logs_total_30d', sql: `SELECT COUNT(*)::int AS n, MIN(created_at) AS oldest, MAX(created_at) AS latest FROM error_logs WHERE created_at >= NOW() - INTERVAL '30 days'` },
  { key: 'error_logs_all_time', sql: `SELECT COUNT(*)::int AS n, MIN(created_at) AS oldest, MAX(created_at) AS latest FROM error_logs` },

  // §15 — 커버리지 셀 상태 분포(셀이 PARTIAL/INVALID를 실제로 보존하는지).
  { key: 'coverage_status_by_dataset', sql: `SELECT dataset, status, COUNT(*)::int AS n FROM sync_coverage_cells GROUP BY 1,2 ORDER BY 1,2` },
  { key: 'coverage_columns', sql: `SELECT column_name, data_type FROM information_schema.columns WHERE table_name='sync_coverage_cells' ORDER BY ordinal_position` },

  // §2/§15 — 정확히 1000행인 (lawdCd, dealYmd) 셀 = numOfRows 상한과 일치하는 조용한 truncation 직접 증거.
  {
    key: 'sale_cells_exactly_1000',
    sql: `SELECT COUNT(*)::int AS cells FROM (
            SELECT lawd_cd, deal_ymd, COUNT(*)::int AS n
            FROM apartment_trade_histories GROUP BY 1,2 HAVING COUNT(*) = 1000
          ) t`,
  },
  {
    key: 'sale_cells_size_buckets',
    sql: `SELECT CASE WHEN n = 1000 THEN 'EXACTLY_1000' WHEN n > 1000 THEN 'OVER_1000' WHEN n >= 900 THEN '900_999' ELSE 'UNDER_900' END AS bucket,
                 COUNT(*)::int AS cells, MAX(n)::int AS max_rows
          FROM (SELECT lawd_cd, deal_ymd, COUNT(*)::int AS n FROM apartment_trade_histories GROUP BY 1,2) t
          GROUP BY 1 ORDER BY 1`,
  },
  // 커버리지 셀에 기록된 source_total_count vs 실제 적재행 — 불일치가 남아 있는지.
  {
    key: 'coverage_total_vs_fetched_mismatch',
    sql: `SELECT dataset, status, COUNT(*)::int AS n
          FROM sync_coverage_cells
          WHERE source_total_count IS NOT NULL AND fetched_count IS NOT NULL AND fetched_count < source_total_count
          GROUP BY 1,2 ORDER BY 1,2`,
  },
  // 실제로 관측된 최대 source_total_count — 한 셀이 1페이지(1000)를 넘긴 적이 있는지.
  {
    key: 'coverage_max_source_total',
    sql: `SELECT dataset, MAX(source_total_count)::int AS max_total,
                 COUNT(*) FILTER (WHERE source_total_count > 1000)::int AS cells_over_1000
          FROM sync_coverage_cells GROUP BY 1 ORDER BY 1`,
  },
  // 렌트 쪽 셀 크기(전월세는 probe에서 1000 초과가 실제로 확인됨).
  {
    key: 'rent_cells_size_buckets',
    sql: `SELECT CASE WHEN n = 1000 THEN 'EXACTLY_1000' WHEN n > 1000 THEN 'OVER_1000' WHEN n >= 900 THEN '900_999' ELSE 'UNDER_900' END AS bucket,
                 COUNT(*)::int AS cells, MAX(n)::int AS max_rows
          FROM (SELECT lawd_cd, deal_ymd, COUNT(*)::int AS n FROM apartment_rent_histories GROUP BY 1,2) t
          GROUP BY 1 ORDER BY 1`,
  },
];

async function main() {
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'audit-molit-quota-log-read.ts');
  const out: Record<string, unknown> = { startedAt: new Date().toISOString() };

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '120s'");
    for (const q of QUERIES) {
      const t0 = Date.now();
      try {
        out[q.key] = { rows: await tx.$queryRawUnsafe(q.sql), ms: Date.now() - t0 };
      } catch (e: any) {
        out[q.key] = { error: String(e?.message ?? e).slice(0, 300), ms: Date.now() - t0 };
      }
    }
  }, { timeout: 180_000 });

  out.endedAt = new Date().toISOString();
  console.log(JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? Number(v) : v), 2));
}

main()
  .catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); })
  .finally(() => prisma.$disconnect());
