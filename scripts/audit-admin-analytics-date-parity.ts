/**
 * ADMIN_ANALYTICS_DATE_PARITY_FIX_V1 §4 — 대시보드와 행동 분석의 "오늘"이 왜 다른 숫자를
 * 내는지 원천에서 재현한다 (STRICT READ ONLY).
 *
 * 사용자 관찰: 대시보드 301/302 vs 행동 분석 149/150 (같은 시각).
 *
 * 두 가지를 분리해서 잰다:
 *   1) date window  — KST 00:00~now  vs  UTC 00:00~now
 *   2) session 정의  — 이벤트 행 포함  vs  제외(url NOT LIKE '/__event__/%')
 *
 * DB SELECT만. INSERT/UPDATE/DELETE 0. 외부 API 0.
 *
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/audit-admin-analytics-date-parity.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { PrismaClient } from '@prisma/client';
import { assertProductionDbAccessAllowed } from './_prod-db-guard';
import { ANALYTICS_EVENT_URL_PREFIX } from '../src/lib/analytics/events';
import { startOfKstDay, startOfKstDaysAgo } from '../src/lib/kst-day';

const prisma = new PrismaClient();
const EV = ANALYTICS_EVENT_URL_PREFIX + '%';

/** 행동 분석 query.ts의 rangeStart('today') 재현 — 프로세스 로컬 자정(Vercel=UTC). */
function startOfLocalDay(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** UTC 자정 — Vercel 런타임(TZ=UTC)에서 위 함수가 실제로 내는 값. */
function startOfUtcDay(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}

interface Counts {
  sessionsAll: number;
  sessionsExEvents: number;
  pageViews: number;
  rowsAll: number;
}

async function countsSince(since: Date): Promise<Counts> {
  const rows = await prisma.$queryRaw<
    { sessions_all: bigint; sessions_ex: bigint; page_views: bigint; rows_all: bigint }[]
  >`
    SELECT
      COUNT(DISTINCT session_id) AS sessions_all,
      COUNT(DISTINCT session_id) FILTER (WHERE url NOT LIKE ${EV}) AS sessions_ex,
      COUNT(*) FILTER (WHERE url NOT LIKE ${EV}) AS page_views,
      COUNT(*) AS rows_all
    FROM page_views
    WHERE created_at >= ${since}
  `;
  const r = rows[0];
  return {
    sessionsAll: Number(r.sessions_all),
    sessionsExEvents: Number(r.sessions_ex),
    pageViews: Number(r.page_views),
    rowsAll: Number(r.rows_all),
  };
}

function fmt(d: Date): string {
  return `${d.toISOString()} (KST ${new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 19).replace('T', ' ')})`;
}

async function main() {
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'audit-admin-analytics-date-parity');

  const now = new Date();
  const kst = startOfKstDay(now);
  const utc = startOfUtcDay();
  const local = startOfLocalDay();

  console.log('=== ADMIN ANALYTICS DATE PARITY AUDIT (READ ONLY) ===');
  console.log(`now                : ${fmt(now)}`);
  console.log(`process TZ         : ${Intl.DateTimeFormat().resolvedOptions().timeZone} (offset ${-now.getTimezoneOffset()}m)`);
  console.log(`KST   day start    : ${fmt(kst)}`);
  console.log(`UTC   day start    : ${fmt(utc)}`);
  console.log(`LOCAL day start    : ${fmt(local)}   <- 이 머신의 TZ 기준(setHours). Vercel은 TZ=UTC라 위 UTC행과 같다`);
  console.log('');

  const [kstC, utcC] = await Promise.all([countsSince(kst), countsSince(utc)]);

  console.log('--- window별 원천 집계 ---');
  console.log('window | sessions(all rows) | sessions(ex events) | pageViews(ex events) | rows(all)');
  console.log(`KST    | ${kstC.sessionsAll} | ${kstC.sessionsExEvents} | ${kstC.pageViews} | ${kstC.rowsAll}`);
  console.log(`UTC    | ${utcC.sessionsAll} | ${utcC.sessionsExEvents} | ${utcC.pageViews} | ${utcC.rowsAll}`);
  console.log('');

  console.log('--- 각 화면이 지금 보여주는 값(코드 그대로 재현) ---');
  console.log(`대시보드   방문세션=${kstC.sessionsExEvents}  PV=${kstC.pageViews}   (KST, 이벤트 제외)`);
  console.log(`행동 분석  방문세션=${utcC.sessionsAll}  PV=${utcC.pageViews}   (LOCAL=UTC, 세션은 이벤트 포함)`);
  console.log('');
  console.log(`delta sessions = ${kstC.sessionsExEvents - utcC.sessionsAll}`);
  console.log(`delta pageViews = ${kstC.pageViews - utcC.pageViews}`);
  console.log('');

  console.log('--- 세션 정의만의 차이(같은 window 안에서) ---');
  console.log(`KST: all=${kstC.sessionsAll} vs exEvents=${kstC.sessionsExEvents} -> diff ${kstC.sessionsAll - kstC.sessionsExEvents}`);
  console.log(`UTC: all=${utcC.sessionsAll} vs exEvents=${utcC.sessionsExEvents} -> diff ${utcC.sessionsAll - utcC.sessionsExEvents}`);
  console.log('');

  // §9 — 수정된 두 코드 경로를 **각각 그대로** 돌려 delta를 재다. 같은 숫자를 두 번
  // 출력하는 것은 증명이 아니다 — 서로 다른 쿼리로 독립적으로 재서 비교한다.
  const fixedSince = startOfKstDay(now);

  // (A) 대시보드 경로: Prisma count + 자체 raw SQL (route.ts와 동일한 모양)
  const [dashPv, dashSessRows] = await Promise.all([
    prisma.pageView.count({ where: { createdAt: { gte: fixedSince }, url: { not: { startsWith: ANALYTICS_EVENT_URL_PREFIX } } } }),
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(DISTINCT session_id) AS count
      FROM page_views
      WHERE created_at >= ${fixedSince} AND url NOT LIKE ${EV}
    `,
  ]);
  const dashSessions = Number(dashSessRows[0]?.count ?? 0);

  // (B) 행동 분석 경로: query.ts의 combined SQL 모양 그대로(수정된 sessions 식 포함)
  const behRows = await prisma.$queryRaw<{ sessions: bigint; page_views: bigint }[]>`
    SELECT
      COUNT(DISTINCT session_id) FILTER (WHERE url NOT LIKE '/__event__/%') as sessions,
      COUNT(*) FILTER (WHERE url NOT LIKE '/__event__/%') as page_views
    FROM page_views
    WHERE created_at >= ${fixedSince}
  `;
  const behSessions = Number(behRows[0].sessions);
  const behPv = Number(behRows[0].page_views);

  console.log('--- FIX 후: 두 코드 경로를 각각 돌려 재측 (window = KST 00:00) ---');
  console.log(`대시보드(Prisma count + raw distinct)  방문세션=${dashSessions}  PV=${dashPv}`);
  console.log(`행동 분석(combined FILTER SQL)        방문세션=${behSessions}  PV=${behPv}`);
  console.log(`delta sessions = ${dashSessions - behSessions}`);
  console.log(`delta pageViews = ${dashPv - behPv}`);
  console.log('');

  // §7/§8 — 7일/30일 계약 비교: rolling 7×24h vs 오늘 포함 7 KST calendar day
  for (const days of [7, 30]) {
    const rolling = new Date(now.getTime() - days * 24 * 3600_000);
    const calendar = startOfKstDaysAgo(days - 1, now);
    const [rc, cc] = await Promise.all([countsSince(rolling), countsSince(calendar)]);
    console.log(`--- ${days}일 계약 ---`);
    console.log(`rolling  ${fmt(rolling)}  sessions(ex)=${rc.sessionsExEvents} PV=${rc.pageViews}`);
    console.log(`calendar ${fmt(calendar)}  sessions(ex)=${cc.sessionsExEvents} PV=${cc.pageViews}`);
    console.log('');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
