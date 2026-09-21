/**
 * ADMIN_DASHBOARD_CONNECTION_POOL_SAFETY_V1 §1/§7 — /api/admin/dashboard의 쿼리 그래프를
 * 실제로 재고, ops에서 확인된 P2024 구조가 여기에도 있는지 증명한다 (STRICT READ ONLY).
 *
 * Vercel 조건 재현: connection_limit=1 (운영 env는 건드리지 않고 이 프로세스에만 적용).
 *
 * DB SELECT만. INSERT/UPDATE/DELETE 0. 외부 API 0(pipeline health는 제외하고 잰다).
 *
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/audit-admin-dashboard-pool.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { PrismaClient } from '@prisma/client';
import { assertProductionDbAccessAllowed } from './_prod-db-guard';
import { ANALYTICS_EVENT_URL_PREFIX } from '../src/lib/analytics/events';
import { startOfKstDay, startOfKstDaysAgo } from '../src/lib/kst-day';

const EV = ANALYTICS_EVENT_URL_PREFIX + '%';

function pooled(limit: number, poolTimeout: number): PrismaClient {
  const url = new URL(process.env.DATABASE_URL as string);
  url.searchParams.set('connection_limit', String(limit));
  url.searchParams.set('pool_timeout', String(poolTimeout));
  return new PrismaClient({ datasources: { db: { url: url.toString() } } });
}

const today = startOfKstDay();
const sevenDaysAgo = startOfKstDaysAgo(6);
const thirtyDaysAgo = startOfKstDaysAgo(29);
const onlineThreshold = new Date(Date.now() - 5 * 60 * 1000);

/** 라우트의 Promise.all 안에 있는 14개 DB 쿼리를 순서 그대로. */
function jobs(p: PrismaClient): { key: string; run: () => Promise<unknown> }[] {
  return [
    { key: '1 todayPageViews', run: () => p.pageView.count({ where: { createdAt: { gte: today }, url: { not: { startsWith: ANALYTICS_EVENT_URL_PREFIX } } } }) },
    { key: '2 todayVisitSessions', run: () => p.$queryRaw`SELECT COUNT(DISTINCT session_id) AS count FROM page_views WHERE created_at >= ${today} AND url NOT LIKE ${EV}` },
    { key: '3 onlineSessions', run: () => p.activeSession.count({ where: { lastSeenAt: { gte: onlineThreshold } } }) },
    { key: '4 onlineAptGroups', run: () => p.activeSession.groupBy({ by: ['currentAptName'], where: { lastSeenAt: { gte: onlineThreshold }, currentAptName: { not: null } }, _count: { currentAptName: true }, orderBy: { _count: { currentAptName: 'desc' } }, take: 10 }) },
    { key: '5 popular30d', run: () => p.pageView.groupBy({ by: ['aptName'], where: { createdAt: { gte: thirtyDaysAgo }, aptName: { not: null }, url: { not: { startsWith: ANALYTICS_EVENT_URL_PREFIX } } }, _count: { aptName: true }, orderBy: { _count: { aptName: 'desc' } }, take: 10 }) },
    { key: '6 todayNewUsers', run: () => p.user.count({ where: { createdAt: { gte: today } } }) },
    { key: '7 totalUsers', run: () => p.user.count() },
    { key: '8 recentSearches', run: () => p.searchLog.groupBy({ by: ['query'], where: { createdAt: { gte: sevenDaysAgo } }, _count: { query: true }, orderBy: { _count: { query: 'desc' } }, take: 10 }) },
    { key: '9 todayNewPosts', run: () => p.post.count({ where: { createdAt: { gte: today } } }) },
    { key: '10 todayNewComments', run: () => p.comment.count({ where: { createdAt: { gte: today } } }) },
    { key: '11 recentPosts', run: () => p.post.findMany({ orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, title: true, aptName: true, createdAt: true, author: { select: { name: true } } } }) },
    { key: '12 unresolvedReports', run: () => p.report.count({ where: { resolved: false } }) },
    { key: '13 recentErrors', run: () => p.errorLog.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }) },
    { key: '14 eventCounts', run: () => p.pageView.groupBy({ by: ['url'], where: { createdAt: { gte: sevenDaysAgo }, url: { startsWith: ANALYTICS_EVENT_URL_PREFIX } }, _count: { url: true }, orderBy: { _count: { url: 'desc' } } }) },
  ];
}

const isP2024 = (e: unknown) => /P2024|connection pool/i.test(String((e as Error)?.message ?? ''));

async function main() {
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'audit-admin-dashboard-pool');

  console.log('=== ADMIN DASHBOARD POOL AUDIT (READ ONLY) ===');
  const meta = pooled(5, 20);
  console.log(`page_views rows      = ${(await meta.pageView.count()).toLocaleString()}`);
  console.log(`active_sessions rows = ${(await meta.activeSession.count()).toLocaleString()}`);
  console.log(`search_logs rows     = ${(await meta.searchLog.count()).toLocaleString()}`);
  console.log(`error_logs rows      = ${(await meta.errorLog.count()).toLocaleString()}`);
  await meta.$disconnect();
  console.log('');

  // (A) 쿼리별 단독 latency — 어디에 시간이 있는지.
  console.log('--- (A) 쿼리별 단독 latency (limit=5) ---');
  const solo = pooled(5, 20);
  let sum = 0;
  for (const j of jobs(solo)) {
    const t = Date.now();
    let note = 'OK  ';
    try {
      await j.run();
    } catch (e) {
      note = 'FAIL';
      console.log(`     ${(e as Error).message.split('\n')[0].slice(0, 100)}`);
    }
    const ms = Date.now() - t;
    sum += ms;
    console.log(`${note} ${String(ms).padStart(6)}ms  ${j.key}`);
  }
  console.log(`순차 합계 = ${sum}ms\n`);
  await solo.$disconnect();

  // (B) 운영 재현 — limit=1에서 14개를 Promise.all로(현재 라우트 구조).
  console.log('--- (B) 현재 구조 재현: limit=1, pool_timeout=10s, Promise.all(14) ---');
  const par = pooled(1, 10);
  const t0 = Date.now();
  const res = await Promise.allSettled(jobs(par).map((j) => j.run()));
  const rejected = res.filter((r) => r.status === 'rejected');
  console.log(`latency=${Date.now() - t0}ms rejected=${rejected.length}/14 P2024=${rejected.filter((r) => isP2024((r as PromiseRejectedResult).reason)).length}`);
  await par.$disconnect();
  console.log('');

  // (C) 같은 pool에서 **순차** — ops에서 검증된 구조.
  console.log('--- (C) 순차 실행: limit=1, pool_timeout=10s ---');
  const seq = pooled(1, 10);
  const t1 = Date.now();
  let fail = 0;
  for (const j of jobs(seq)) {
    try {
      await j.run();
    } catch {
      fail++;
    }
  }
  console.log(`latency=${Date.now() - t1}ms failed=${fail}/14\n`);
  await seq.$disconnect();

  // (D) 짧은 pool_timeout으로 구조적 취약성을 드러낸다(ops와 동일한 증명 방식).
  console.log('--- (D) pool_timeout=2s에서 구조 비교 (동일 작업량) ---');
  const a = pooled(1, 2);
  const ta = Date.now();
  const ra = await Promise.allSettled(jobs(a).map((j) => j.run()));
  const rej = ra.filter((r) => r.status === 'rejected');
  console.log(`Promise.all : latency=${Date.now() - ta}ms rejected=${rej.length}/14 P2024=${rej.filter((r) => isP2024((r as PromiseRejectedResult).reason)).length}`);
  await a.$disconnect();

  const b = pooled(1, 2);
  const tb = Date.now();
  let bf = 0;
  for (const j of jobs(b)) {
    try {
      await j.run();
    } catch {
      bf++;
    }
  }
  console.log(`순차        : latency=${Date.now() - tb}ms failed=${bf}/14`);
  await b.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
