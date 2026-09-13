/**
 * E-JIP MOLIT PARTIAL FAILURE REDUCTION V1 §2 — error_logs 부분 실패 분포 감사 (STRICT READ ONLY).
 *
 * write 0회. 외부 API 호출 0회. 집계는 최근 7일 창의 MOLIT 관련 로그만 읽는다.
 *
 * 실행:
 *   ALLOW_PROD_DB_READ=1 npx ts-node --compiler-options '{"module":"commonjs"}' \
 *     -r ./scripts/_register-paths.js scripts/audit-molit-partial-logs.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { PrismaClient } from '@prisma/client';
import { assertProductionDbAccessAllowed } from './_prod-db-guard';

const prisma = new PrismaClient();

const WINDOWS: Array<[string, number]> = [
  ['1h', 1 * 60 * 60 * 1000],
  ['24h', 24 * 60 * 60 * 1000],
  ['7d', 7 * 24 * 60 * 60 * 1000],
];

function bump(m: Map<string, number>, k: string, n = 1) {
  m.set(k, (m.get(k) || 0) + n);
}

function top(m: Map<string, number>, n = 15) {
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

async function main() {
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'audit-molit-partial-logs.ts');

  for (const [label, ms] of WINDOWS) {
    const since = new Date(Date.now() - ms);
    const rows = await prisma.errorLog.findMany({
      where: { createdAt: { gte: since }, message: { contains: 'MOLIT_PARTIAL' } },
      select: { message: true, url: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });

    const byRoute = new Map<string, number>();
    const byType = new Map<string, number>();
    const byLawd = new Map<string, number>();
    const byReason = new Map<string, number>();
    const byPeriod = new Map<string, number>();
    const ratioBuckets = new Map<string, number>();
    let totMonths = 0, totOk = 0, totFailed = 0;
    let rateLimited = 0;

    for (const r of rows) {
      const msg = r.message || '';
      const g = (re: RegExp) => (msg.match(re)?.[1] ?? '-');
      bump(byRoute, (r.url || '-').split('?')[0]);
      bump(byType, g(/type=(\S+)/));
      bump(byLawd, g(/lawdCd=(\S+)/));
      bump(byPeriod, g(/period=(\S+)/));

      const months = Number(g(/months=(\d+)/)) || 0;
      const ok = Number(g(/ok=(\d+)/)) || 0;
      const failed = Number(g(/failed=(\d+)/)) || 0;
      totMonths += months; totOk += ok; totFailed += failed;

      const ratio = months > 0 ? failed / months : 0;
      const b = ratio === 0 ? '0%' : ratio < 0.05 ? '<5%' : ratio < 0.2 ? '5-20%' : ratio < 0.5 ? '20-50%' : ratio < 0.9 ? '50-90%' : '>=90%';
      bump(ratioBuckets, b);

      const reason = (msg.match(/reason=(.*)$/)?.[1] ?? 'unknown').trim();
      const norm = /요청제한|LIMITED_NUMBER_OF_SERVICE_REQUESTS|초당/.test(reason)
        ? 'RATE_LIMIT(초당 서비스 요청제한 횟수 초과)'
        : /timeout|TimeoutError|aborted/i.test(reason) ? 'TIMEOUT'
        : /No items found/i.test(reason) ? 'NO_ITEMS_SHAPE'
        : reason.slice(0, 70);
      if (norm.startsWith('RATE_LIMIT')) rateLimited++;
      bump(byReason, norm);
    }

    console.log(`\n================ WINDOW ${label} ================`);
    console.log(`MOLIT_PARTIAL log rows: ${rows.length}`);
    if (rows.length === 0) continue;
    console.log(`months requested=${totMonths} ok=${totOk} failed=${totFailed} ` +
      `failRatio=${totMonths ? ((totFailed / totMonths) * 100).toFixed(1) : '0'}%`);
    console.log(`rate-limit-caused rows: ${rateLimited}/${rows.length} (${((rateLimited / rows.length) * 100).toFixed(1)}%)`);
    console.log('-- by route --'); for (const [k, v] of top(byRoute)) console.log(`   ${v}\t${k}`);
    console.log('-- by type --'); for (const [k, v] of top(byType)) console.log(`   ${v}\t${k}`);
    console.log('-- by period --'); for (const [k, v] of top(byPeriod)) console.log(`   ${v}\t${k}`);
    console.log('-- by lawdCd --'); for (const [k, v] of top(byLawd)) console.log(`   ${v}\t${k}`);
    console.log('-- by failure ratio bucket --'); for (const [k, v] of top(ratioBuckets)) console.log(`   ${v}\t${k}`);
    console.log('-- by reason --'); for (const [k, v] of top(byReason)) console.log(`   ${v}\t${k}`);

    if (label === '7d') {
      console.log('-- 5 most recent raw samples --');
      for (const r of rows.slice(0, 5)) console.log(`   [${r.createdAt.toISOString()}] ${r.message.slice(0, 260)}`);
    }
  }

  // 전체 고위험 오류 대비 MOLIT 비중
  const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const allErr = await prisma.errorLog.count({ where: { createdAt: { gte: since7 } } });
  const molitAny = await prisma.errorLog.count({
    where: { createdAt: { gte: since7 }, OR: [{ message: { contains: 'MOLIT' } }, { message: { contains: '요청제한' } }] },
  });
  console.log(`\n7d ALL error_logs=${allErr}  MOLIT-related=${molitAny} (${allErr ? ((molitAny / allErr) * 100).toFixed(1) : '0'}%)`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
