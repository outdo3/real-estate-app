/**
 * ADMIN_OPS_P2024_CONNECTION_POOL_FIX_V1 §1 — /api/admin/ops의 DB 쿼리 그래프를
 * 실제로 재서 P2024가 어디서 나는지 증명한다 (STRICT READ ONLY).
 *
 * Vercel 조건을 그대로 재현하기 위해 **connection_limit=1**로 접속한다
 * (운영 env는 건드리지 않는다 — 이 프로세스의 접속 문자열에만 파라미터를 붙인다).
 *
 * DB SELECT만. INSERT/UPDATE/DELETE 0. 외부 API 0.
 *
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/audit-admin-ops-pool.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { PrismaClient } from '@prisma/client';
import { assertProductionDbAccessAllowed } from './_prod-db-guard';
import { getMolitLeafRegions } from '../src/lib/region/registry';

const BUSAN_16: string[] = getMolitLeafRegions('26').map((r) => r.lawdCd);

/** 운영과 같은 pool 조건(limit 1, timeout 10s)을 이 프로세스에만 적용한다. */
function pooledClient(limit: number, poolTimeout: number): PrismaClient {
  const url = new URL(process.env.DATABASE_URL as string);
  url.searchParams.set('connection_limit', String(limit));
  url.searchParams.set('pool_timeout', String(poolTimeout));
  return new PrismaClient({ datasources: { db: { url: url.toString() } } });
}

type Job = { name: string; run: (p: PrismaClient) => Promise<unknown> };

const TRADE_BLOCK: Job[] = [
  { name: '1 trade.count(busan16)', run: (p) => p.apartmentTradeHistory.count({ where: { lawdCd: { in: BUSAN_16 } } }) },
  { name: '2 trade.count(canceled)', run: (p) => p.apartmentTradeHistory.count({ where: { lawdCd: { in: BUSAN_16 }, dealCanceled: true } }) },
  { name: '3 trade.count(aptSeq null)', run: (p) => p.apartmentTradeHistory.count({ where: { lawdCd: { in: BUSAN_16 }, aptSeq: null } }) },
  { name: '4 trade.aggregate(max dealDate)', run: (p) => p.apartmentTradeHistory.aggregate({ where: { lawdCd: { in: BUSAN_16 } }, _max: { dealDate: true } }) },
  { name: '5 trade.groupBy(lawdCd)', run: (p) => p.apartmentTradeHistory.groupBy({ by: ['lawdCd'], where: { lawdCd: { in: BUSAN_16 } } }) },
  { name: '6 trade.count(sejong)', run: (p) => p.apartmentTradeHistory.count({ where: { lawdCd: '36110' } }) },
  { name: '7 rent.count(busan16)', run: (p) => p.apartmentRentHistory.count({ where: { lawdCd: { in: BUSAN_16 } } }) },
  { name: '8 rent.groupBy(lawdCd)', run: (p) => p.apartmentRentHistory.groupBy({ by: ['lawdCd'], where: { lawdCd: { in: BUSAN_16 } } }) },
  { name: '9 rent.aggregate(max dealDate)', run: (p) => p.apartmentRentHistory.aggregate({ where: { lawdCd: { in: BUSAN_16 } }, _max: { dealDate: true } }) },
];

const COVERAGE_BLOCK: Job[] = [
  { name: 'C1 coverage cells RENT', run: (p) => p.$queryRaw`SELECT status, COUNT(*) FROM sync_coverage_cells WHERE dataset = 'RENT' GROUP BY status` },
  { name: 'C2 coverage cells SALE', run: (p) => p.$queryRaw`SELECT status, COUNT(*) FROM sync_coverage_cells WHERE dataset = 'SALE' GROUP BY status` },
];

async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; ok: boolean; err?: string }> {
  const t = Date.now();
  try {
    await fn();
    return { ms: Date.now() - t, ok: true };
  } catch (e) {
    return { ms: Date.now() - t, ok: false, err: (e as Error).message.split('\n')[0].slice(0, 120) };
  }
}

async function main() {
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'audit-admin-ops-pool');

  console.log('=== ADMIN OPS POOL AUDIT (READ ONLY) ===');
  console.log(`BUSAN_16 = ${BUSAN_16.length} codes\n`);

  // 표 크기 — 무거운지 먼저 사실로 확인한다.
  const meta = pooledClient(5, 20);
  const totalRows = await meta.apartmentTradeHistory.count();
  const rentRows = await meta.apartmentRentHistory.count();
  console.log(`apartment_trade_histories rows = ${totalRows.toLocaleString()}`);
  console.log(`apartment_rent_histories  rows = ${rentRows.toLocaleString()}\n`);
  await meta.$disconnect();

  // (A) 쿼리별 단독 latency — connection 경합 없이 순수 실행 시간.
  console.log('--- (A) 쿼리별 단독 latency (limit=5, 경합 없음) ---');
  const solo = pooledClient(5, 20);
  const soloTimes: Record<string, number> = {};
  for (const job of [...TRADE_BLOCK, ...COVERAGE_BLOCK]) {
    const r = await timed(() => job.run(solo));
    soloTimes[job.name] = r.ms;
    console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${String(r.ms).padStart(6)}ms  ${job.name}${r.err ? '  <- ' + r.err : ''}`);
  }
  const soloSum = Object.values(soloTimes).reduce((a, b) => a + b, 0);
  console.log(`순차 합계 = ${soloSum}ms\n`);
  await solo.$disconnect();

  // (B) 운영 재현 — connection_limit=1, pool_timeout=10s에서 9개를 Promise.all로.
  console.log('--- (B) 운영 재현: limit=1, pool_timeout=10s, Promise.all(9) ---');
  const prod = pooledClient(1, 10);
  const t0 = Date.now();
  const results = await Promise.allSettled(TRADE_BLOCK.map((j) => j.run(prod)));
  const blockMs = Date.now() - t0;
  const failed = results.filter((r) => r.status === 'rejected');
  console.log(`block latency = ${blockMs}ms, rejected = ${failed.length}/9`);
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'rejected') {
      const m = String((r.reason as Error).message).split('\n').filter(Boolean).slice(-1)[0] ?? '';
      console.log(`  REJECTED ${TRADE_BLOCK[i].name} -> ${m.slice(0, 140)}`);
    }
  }
  console.log('');
  await prod.$disconnect();

  // (C) 같은 조건에서 **순차** 실행 — 큐 경합이 사라지면 어떻게 되는가.
  console.log('--- (C) limit=1에서 순차 실행 ---');
  const seq = pooledClient(1, 10);
  const t1 = Date.now();
  let seqFail = 0;
  for (const job of TRADE_BLOCK) {
    const r = await timed(() => job.run(seq));
    if (!r.ok) seqFail++;
    console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${String(r.ms).padStart(6)}ms  ${job.name}${r.err ? '  <- ' + r.err : ''}`);
  }
  console.log(`순차 총 latency = ${Date.now() - t1}ms, 실패 ${seqFail}/9\n`);
  await seq.$disconnect();

  // (D) 통합 쿼리 후보 — trade 5개를 한 번의 스캔으로.
  console.log('--- (D) 통합 쿼리(FILTER 집계 1회 스캔) ---');
  const one = pooledClient(1, 10);
  const r = await timed(async () => {
    const rows = await one.$queryRaw<{ total: bigint; canceled: bigint; apt_seq_missing: bigint; districts: bigint; latest: Date | null }[]>`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE deal_canceled = true) AS canceled,
        COUNT(*) FILTER (WHERE apt_seq IS NULL) AS apt_seq_missing,
        COUNT(DISTINCT lawd_cd) AS districts,
        MAX(deal_date) AS latest
      FROM apartment_trade_histories
      WHERE lawd_cd = ANY(${BUSAN_16})
    `;
    console.log(`  결과: total=${rows[0].total} canceled=${rows[0].canceled} aptSeqMissing=${rows[0].apt_seq_missing} districts=${rows[0].districts} latest=${rows[0].latest?.toISOString().slice(0, 10)}`);
  });
  console.log(`${r.ok ? 'OK' : 'FAIL'} ${r.ms}ms (기존 5개 쿼리를 대체)${r.err ? '  <- ' + r.err : ''}`);

  const r2 = await timed(async () => {
    const rows = await one.$queryRaw<{ total: bigint; districts: bigint; latest: Date | null }[]>`
      SELECT COUNT(*) AS total, COUNT(DISTINCT lawd_cd) AS districts, MAX(deal_date) AS latest
      FROM apartment_rent_histories
      WHERE lawd_cd = ANY(${BUSAN_16})
    `;
    console.log(`  결과: rentTotal=${rows[0].total} districts=${rows[0].districts} latest=${rows[0].latest?.toISOString().slice(0, 10)}`);
  });
  console.log(`${r2.ok ? 'OK' : 'FAIL'} ${r2.ms}ms (기존 rent 3개 쿼리를 대체)${r2.err ? '  <- ' + r2.err : ''}`);
  await one.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
