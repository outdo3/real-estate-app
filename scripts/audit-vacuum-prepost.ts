/**
 * PROD_VACUUM_ANALYZE_AUTOVACUUM_AUDIT_V1 — VACUUM 전/후를 같은 조건으로 재는 스크립트.
 *
 * 기본은 **READ ONLY**(SELECT / EXPLAIN ANALYZE / SHOW / pg_stat 조회).
 * `--vacuum` 인자를 준 경우에만 승인된 `VACUUM (ANALYZE) apartment_trade_histories`를
 * **정확히 한 번** 실행한다. VACUUM FULL / REINDEX / CLUSTER는 실행하지 않는다.
 *
 *   ALLOW_PROD_DB_READ=1  npx tsx scripts/audit-vacuum-prepost.ts            # 측정만
 *   ALLOW_PROD_DB_WRITE=1 npx tsx scripts/audit-vacuum-prepost.ts --vacuum   # 승인된 유지보수
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { PrismaClient } from '@prisma/client';
import { assertProductionDbAccessAllowed } from './_prod-db-guard';
import { getMolitLeafRegions } from '../src/lib/region/registry';

const BUSAN_16 = getMolitLeafRegions('26').map((r) => r.lawdCd);
const TABLE = 'apartment_trade_histories';
const DO_VACUUM = process.argv.includes('--vacuum');
const prisma = new PrismaClient();

const h = (t: string) => console.log(`\n--- ${t} ---`);
const num = (v: unknown) => Number(v as number).toLocaleString();

/** §2/§9 — 계측에서 병목으로 지목된 3개. 이름은 ops 라우트의 지표 키와 같다. */
const QUERIES: { key: string; sql: string; params: unknown[] }[] = [
  { key: 'busanTotal', sql: `SELECT COUNT(*) FROM ${TABLE} WHERE lawd_cd = ANY($1)`, params: [BUSAN_16] },
  { key: 'latestDealDate', sql: `SELECT MAX(deal_date) FROM ${TABLE} WHERE lawd_cd = ANY($1)`, params: [BUSAN_16] },
  { key: 'busanCovered', sql: `SELECT lawd_cd FROM ${TABLE} WHERE lawd_cd = ANY($1) GROUP BY lawd_cd`, params: [BUSAN_16] },
];

interface PlanFacts {
  key: string;
  scanType: string;
  heapFetches: number | null;
  buffersHit: number | null;
  buffersRead: number | null;
  planningMs: number | null;
  executionMs: number | null;
  raw: string;
}

async function explain(q: { key: string; sql: string; params: unknown[] }): Promise<PlanFacts> {
  const rows = await prisma.$queryRawUnsafe<Record<string, string>[]>(
    `EXPLAIN (ANALYZE, BUFFERS) ${q.sql}`,
    ...q.params
  );
  const raw = rows.map((r) => r['QUERY PLAN']).join('\n');
  const pick = (re: RegExp) => {
    const m = raw.match(re);
    return m ? Number(m[1]) : null;
  };
  const scan =
    raw.match(/(Parallel Index Only Scan|Index Only Scan|Parallel Index Scan|Index Scan|Bitmap Heap Scan|Parallel Seq Scan|Seq Scan)/)?.[1] ??
    'UNKNOWN';
  // Buffers 줄이 여러 개면 최상위(첫 줄)가 요청 전체의 합계다.
  return {
    key: q.key,
    scanType: scan,
    heapFetches: pick(/Heap Fetches: (\d+)/),
    buffersHit: pick(/Buffers: shared hit=(\d+)/),
    buffersRead: pick(/Buffers: shared hit=\d+ read=(\d+)/),
    planningMs: pick(/Planning Time: ([\d.]+) ms/),
    executionMs: pick(/Execution Time: ([\d.]+) ms/),
    raw,
  };
}

/** 같은 쿼리를 N회 돌려 median wall-clock을 낸다(플랜 외의 체감치). */
async function timeIt(q: { sql: string; params: unknown[] }, runs = 5): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = Date.now();
    await prisma.$queryRawUnsafe(q.sql, ...q.params);
    out.push(Date.now() - t);
  }
  return out;
}

async function tableState(label: string) {
  h(`${label} 테이블 상태`);
  const st = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT n_live_tup, n_dead_tup, n_mod_since_analyze, n_ins_since_vacuum,
           last_vacuum, last_autovacuum, last_analyze, last_autoanalyze,
           vacuum_count, autovacuum_count, analyze_count, autoanalyze_count
    FROM pg_stat_user_tables WHERE relname = ${TABLE}`;
  const s = st[0];
  console.log(`  live=${num(s.n_live_tup)} dead=${num(s.n_dead_tup)} mod_since_analyze=${num(s.n_mod_since_analyze)} ins_since_vacuum=${num(s.n_ins_since_vacuum)}`);
  console.log(`  last_vacuum      = ${s.last_vacuum ?? 'NULL'}`);
  console.log(`  last_autovacuum  = ${s.last_autovacuum ?? 'NULL'}`);
  console.log(`  last_analyze     = ${s.last_analyze ?? 'NULL'}`);
  console.log(`  last_autoanalyze = ${s.last_autoanalyze ?? 'NULL'}`);
  console.log(`  counts: vacuum=${s.vacuum_count} autovacuum=${s.autovacuum_count} analyze=${s.analyze_count} autoanalyze=${s.autoanalyze_count}`);

  // visibility map 커버리지 — heap fetch가 왜 생기는지의 직접 지표.
  try {
    const vm = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT relpages, reltuples::bigint AS reltuples, relallvisible
      FROM pg_class WHERE relname = ${TABLE}`;
    const v = vm[0];
    const pages = Number(v.relpages);
    const allVisible = Number(v.relallvisible);
    const pct = pages > 0 ? ((allVisible / pages) * 100).toFixed(2) : 'n/a';
    console.log(`  relpages=${num(pages)} relallvisible=${num(allVisible)} -> all-visible 비율 ${pct}%  <-- index-only scan이 heap을 건너뛸 수 있는 페이지 비율`);
  } catch (e) {
    console.log('  pg_class 조회 실패:', (e as Error).message.slice(0, 80));
  }
  return s;
}

/**
 * ops 라우트가 **실제로 부르는** Prisma 호출과 똑같은 모양으로 재다.
 * raw SQL과 Prisma가 다른 플랜을 낼 수 있어(aggregate/groupBy는 래핑이 다르다)
 * 비교 기준을 화면이 쓰는 경로로 맞춘다.
 */
async function measurePrismaPath(label: string, runs = 5) {
  h(`${label} Prisma 실호출 (ops와 동일, ${runs}회 median)`);
  const calls: { key: string; run: () => Promise<unknown> }[] = [
    { key: 'busanTotal', run: () => prisma.apartmentTradeHistory.count({ where: { lawdCd: { in: BUSAN_16 } } }) },
    { key: 'latestDealDate', run: () => prisma.apartmentTradeHistory.aggregate({ where: { lawdCd: { in: BUSAN_16 } }, _max: { dealDate: true } }) },
    { key: 'busanCovered', run: () => prisma.apartmentTradeHistory.groupBy({ by: ['lawdCd'], where: { lawdCd: { in: BUSAN_16 } } }) },
  ];
  const out: Record<string, number> = {};
  for (const c of calls) {
    const ts: number[] = [];
    for (let i = 0; i < runs; i++) {
      const t = Date.now();
      await c.run();
      ts.push(Date.now() - t);
    }
    const med = ts.slice().sort((a, b) => a - b)[Math.floor(runs / 2)];
    out[c.key] = med;
    console.log(`  ${c.key.padEnd(16)} ${ts.join(', ')}  -> median ${med}ms`);
  }
  return out;
}

async function measure(label: string) {
  h(`${label} 쿼리 플랜 (EXPLAIN ANALYZE, BUFFERS)`);
  const facts: PlanFacts[] = [];
  for (const q of QUERIES) {
    const f = await explain(q);
    facts.push(f);
    console.log(
      `  ${f.key.padEnd(16)} scan=${f.scanType.padEnd(24)} heapFetches=${f.heapFetches ?? '-'} buffers(hit/read)=${f.buffersHit ?? '-'}/${f.buffersRead ?? 0} plan=${f.planningMs}ms exec=${f.executionMs}ms`
    );
  }
  h(`${label} wall-clock (5회, median)`);
  const timings: Record<string, number[]> = {};
  for (const q of QUERIES) {
    const ts = await timeIt(q);
    timings[q.key] = ts;
    const med = ts.slice().sort((a, b) => a - b)[2];
    console.log(`  ${q.key.padEnd(16)} ${ts.join(', ')}  -> median ${med}ms`);
  }
  return { facts, timings };
}

async function autovacuumConfig() {
  h('§4 autovacuum 전역 설정 (읽기만)');
  const keys = [
    'autovacuum',
    'autovacuum_vacuum_threshold',
    'autovacuum_vacuum_scale_factor',
    'autovacuum_vacuum_insert_threshold',
    'autovacuum_vacuum_insert_scale_factor',
    'autovacuum_analyze_threshold',
    'autovacuum_analyze_scale_factor',
    'autovacuum_naptime',
    'autovacuum_max_workers',
    'autovacuum_vacuum_cost_delay',
    'autovacuum_vacuum_cost_limit',
    'track_counts',
  ];
  const rows = await prisma.$queryRaw<Record<string, string>[]>`
    SELECT name, setting, unit, source FROM pg_settings WHERE name = ANY(${keys})  ORDER BY name`;
  for (const r of rows) console.log(`  ${String(r.name).padEnd(42)} = ${r.setting}${r.unit ?? ''}   (source: ${r.source})`);

  h('§4 테이블 개별 override (reloptions)');
  const rel = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT reloptions FROM pg_class WHERE relname = ${TABLE}`;
  console.log(`  reloptions = ${rel[0]?.reloptions ? JSON.stringify(rel[0].reloptions) : 'NULL (개별 override 없음)'}`);

  // 임계치 계산 — 왜 안 돌았는지 숫자로 본다.
  const st = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT n_live_tup, n_dead_tup, n_mod_since_analyze FROM pg_stat_user_tables WHERE relname = ${TABLE}`;
  const live = Number(st[0].n_live_tup);
  const dead = Number(st[0].n_dead_tup);
  const mod = Number(st[0].n_mod_since_analyze);
  const get = (n: string) => Number(rows.find((r) => r.name === n)?.setting ?? 0);
  const vacThreshold = get('autovacuum_vacuum_threshold') + get('autovacuum_vacuum_scale_factor') * live;
  const anaThreshold = get('autovacuum_analyze_threshold') + get('autovacuum_analyze_scale_factor') * live;
  console.log(`\n  VACUUM 발동 임계치 = ${get('autovacuum_vacuum_threshold')} + ${get('autovacuum_vacuum_scale_factor')} × ${num(live)} = ${num(Math.round(vacThreshold))}`);
  console.log(`    현재 dead_tup = ${num(dead)}  ->  ${dead >= vacThreshold ? '임계치 도달(돌았어야 함)' : '**임계치 미도달 — 이것이 안 돈 이유**'}`);
  console.log(`  ANALYZE 발동 임계치 = ${get('autovacuum_analyze_threshold')} + ${get('autovacuum_analyze_scale_factor')} × ${num(live)} = ${num(Math.round(anaThreshold))}`);
  console.log(`    현재 mod_since_analyze = ${num(mod)}  ->  ${mod >= anaThreshold ? '임계치 도달' : '임계치 미도달'}`);
}

async function blockers() {
  h('§6 VACUUM 전 blocker 확인');
  const act = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT pid, state, wait_event_type, wait_event,
           EXTRACT(EPOCH FROM (now() - xact_start))::int AS xact_age_s,
           EXTRACT(EPOCH FROM (now() - query_start))::int AS query_age_s,
           left(query, 60) AS q
    FROM pg_stat_activity
    WHERE pid <> pg_backend_pid() AND datname = current_database()
    ORDER BY xact_start NULLS LAST`;
  console.log(`  다른 세션 ${act.length}개`);
  for (const a of act) {
    console.log(`    pid=${a.pid} state=${a.state} xactAge=${a.xact_age_s ?? '-'}s queryAge=${a.query_age_s ?? '-'}s wait=${a.wait_event_type ?? '-'}/${a.wait_event ?? '-'} :: ${String(a.q ?? '').replace(/\s+/g, ' ')}`);
  }
  const long = act.filter((a) => Number(a.xact_age_s ?? 0) > 60);
  console.log(`  60초 넘는 트랜잭션: ${long.length}개 ${long.length ? '<-- VACUUM이 dead tuple을 회수하지 못할 수 있다' : '(없음)'}`);

  const locks = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT count(*) AS n FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
    WHERE c.relname = ${TABLE} AND NOT l.granted`;
  console.log(`  대상 테이블에 대기 중(ungranted) lock: ${locks[0].n}개`);
  return long.length;
}

async function main() {
  assertProductionDbAccessAllowed(DO_VACUUM ? 'OPERATIONAL' : 'DIAGNOSTIC', 'audit-vacuum-prepost');
  console.log(`=== VACUUM PRE/POST AUDIT ${DO_VACUUM ? '(VACUUM 실행 모드)' : '(READ ONLY)'} ===`);
  console.log(`UTC ${new Date().toISOString()} | KST ${new Date(Date.now() + 9 * 3600_000).toISOString().replace('T', ' ').slice(0, 19)}`);

  await tableState(DO_VACUUM ? 'BEFORE' : '현재');
  await autovacuumConfig();
  const longTx = await blockers();
  await measure(DO_VACUUM ? 'BEFORE' : '현재');
  await measurePrismaPath(DO_VACUUM ? 'BEFORE' : '현재');

  if (!DO_VACUUM) {
    console.log('\n(측정 전용 실행 — VACUUM은 하지 않았다. 실행하려면 --vacuum)');
    return;
  }

  if (longTx > 0) {
    console.log('\n!! 60초 넘는 트랜잭션이 있어 STOP한다(임의 terminate 금지).');
    process.exitCode = 1;
    return;
  }

  h('§7 승인된 유지보수 실행 — VACUUM (ANALYZE) 1회');
  const t0 = Date.now();
  await prisma.$executeRawUnsafe(`VACUUM (ANALYZE) ${TABLE}`);
  const durationMs = Date.now() - t0;
  console.log(`  완료: ${durationMs}ms (${(durationMs / 1000).toFixed(1)}초)`);

  await tableState('AFTER');
  await measure('AFTER');
  await measurePrismaPath('AFTER');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
