/**
 * ADMIN_DASHBOARD_DATA_TRUST_AUDIT_V1 — 관리자 대시보드 트래픽 지표가 실제 원천과
 * 일치하는지 검증한다 (STRICT READ ONLY).
 *
 * 핵심 질문: `startOfToday()`가 서버 로컬(=UTC) 자정을 쓰는데, 운영자는 KST로 본다.
 * 그 경계 차이가 "아침 150+ → 0 → 52"를 만들 수 있는지 원천으로 재현한다.
 *
 * DB SELECT만. INSERT/UPDATE/DELETE 0. 외부 API 0.
 *
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/audit-admin-dashboard-trust.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { PrismaClient } from '@prisma/client';
import { assertProductionDbAccessAllowed } from './_prod-db-guard';
import { ANALYTICS_EVENT_URL_PREFIX } from '../src/lib/analytics/events';

const prisma = new PrismaClient();
const EV = ANALYTICS_EVENT_URL_PREFIX + '%';

/** 라우트의 startOfToday() 재현 — 프로세스 로컬 자정. */
function startOfTodayLocal(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** UTC 자정. Vercel 함수는 TZ=UTC이므로 운영에서의 startOfToday()와 같다. */
function startOfTodayUtc(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}

/** KST(UTC+9) 자정을 UTC 순간으로. 운영자가 "오늘"이라고 부르는 경계. */
function startOfTodayKst(): Date {
  const n = new Date();
  const kstMs = n.getTime() + 9 * 3600_000;
  const k = new Date(kstMs);
  return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - 9 * 3600_000);
}

async function main() {
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'audit-admin-dashboard-trust.ts');
  const now = new Date();
  const out: Record<string, unknown> = {
    checkedAt: now.toISOString(),
    readOnly: true,
    writes: { insert: 0, update: 0, delete: 0 },
    processTimezoneOffsetMinutes: now.getTimezoneOffset(),
    boundaries: {
      startOfTodayLocal_processReproduction: startOfTodayLocal().toISOString(),
      startOfTodayUtc_productionEquivalent: startOfTodayUtc().toISOString(),
      startOfTodayKst_operatorExpectation: startOfTodayKst().toISOString(),
    },
  };

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '120s'");

    const utc = startOfTodayUtc();
    const kst = startOfTodayKst();

    // §5 — 대시보드가 쓰는 정의 그대로, 두 경계로 각각 계산.
    const metrics = async (since: Date) => {
      const pv = await tx.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(*) AS n FROM page_views
        WHERE created_at >= ${since} AND url NOT LIKE ${EV}`;
      const uv = await tx.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(DISTINCT session_id) AS n FROM page_views
        WHERE created_at >= ${since} AND url NOT LIKE ${EV}`;
      const ev = await tx.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(*) AS n FROM page_views
        WHERE created_at >= ${since} AND url LIKE ${EV}`;
      return { pageViews: Number(pv[0].n), uniqueSessions: Number(uv[0].n), analyticsEvents: Number(ev[0].n) };
    };

    out.byUtcDay_whatDashboardShows = await metrics(utc);
    out.byKstDay_whatOperatorExpects = await metrics(kst);

    // §6 — 오늘(KST) 시간대별 누적 재구성. 150 → 0 → 52가 경계로 설명되는지.
    out.hourlyKst = await tx.$queryRaw`
      SELECT to_char(created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:00') AS kst_hour,
             COUNT(*)::int AS page_views,
             COUNT(DISTINCT session_id)::int AS unique_sessions
      FROM page_views
      WHERE created_at >= ${new Date(kst.getTime() - 24 * 3600_000)} AND url NOT LIKE ${EV}
      GROUP BY 1 ORDER BY 1`;

    // UTC 경계 직전/직후 누적 — "0으로 리셋"이 실제로 일어나는지.
    out.cumulativeAcrossUtcRollover = await tx.$queryRaw`
      WITH b AS (SELECT ${utc}::timestamp AS utc_midnight)
      SELECT
        (SELECT COUNT(*) FROM page_views, b WHERE created_at >= b.utc_midnight - interval '24 hours'
           AND created_at < b.utc_midnight AND url NOT LIKE ${EV})::int AS pv_prev_utc_day,
        (SELECT COUNT(DISTINCT session_id) FROM page_views, b WHERE created_at >= b.utc_midnight - interval '24 hours'
           AND created_at < b.utc_midnight AND url NOT LIKE ${EV})::int AS uv_prev_utc_day,
        (SELECT COUNT(*) FROM page_views, b WHERE created_at >= b.utc_midnight AND url NOT LIKE ${EV})::int AS pv_this_utc_day,
        (SELECT COUNT(DISTINCT session_id) FROM page_views, b WHERE created_at >= b.utc_midnight AND url NOT LIKE ${EV})::int AS uv_this_utc_day`;

    // §14 — UV == PV가 "모두 1페이지씩"인지 확인. 세션별 페이지뷰 분포.
    out.sessionPageViewDistribution = await tx.$queryRaw`
      SELECT views_per_session, COUNT(*)::int AS sessions FROM (
        SELECT session_id, COUNT(*)::int AS views_per_session
        FROM page_views WHERE created_at >= ${utc} AND url NOT LIKE ${EV}
        GROUP BY session_id
      ) s GROUP BY 1 ORDER BY 1`;

    // §15 — 실시간 접속자 원천.
    out.activeSessions = await tx.$queryRaw`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE last_seen_at >= NOW() - interval '5 minutes')::int AS last_5min,
             COUNT(*) FILTER (WHERE last_seen_at >= NOW() - interval '10 minutes')::int AS last_10min,
             MAX(last_seen_at) AS newest
      FROM active_sessions`;

    // §16/§17 — 봇/자기 트래픽 판별 가능성. page_views에 어떤 컬럼이 있는지.
    out.pageViewColumns = await tx.$queryRaw`
      SELECT column_name, data_type, is_nullable FROM information_schema.columns
      WHERE table_name = 'page_views' ORDER BY ordinal_position`;

    // 회원/가입 지표도 같은 경계 문제를 공유하는지.
    out.users = await tx.$queryRaw`
      SELECT (SELECT COUNT(*) FROM users)::int AS total,
             (SELECT COUNT(*) FROM users WHERE created_at >= ${utc})::int AS new_by_utc_day,
             (SELECT COUNT(*) FROM users WHERE created_at >= ${kst})::int AS new_by_kst_day`;

    // §11 — 최근 24시간 admin 관련 오류 로그.
    out.recentErrors = await tx.$queryRaw`
      SELECT id, source, LEFT(message, 180) AS message, created_at
      FROM error_logs WHERE created_at >= NOW() - interval '24 hours'
      ORDER BY created_at DESC LIMIT 30`;
    out.errorCount24h = await tx.$queryRaw`
      SELECT COUNT(*)::int AS n FROM error_logs WHERE created_at >= NOW() - interval '24 hours'`;
  }, { timeout: 300_000 });

  console.log(JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? Number(v) : v), 2));
}

main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); }).finally(() => prisma.$disconnect());
