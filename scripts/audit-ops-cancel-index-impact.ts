/**
 * OPS_CANCEL_COUNT_INDEX_IMPACT_AUDIT_V1 — `@@index([lawdCd, dealCanceled])`가 실제로
 * 필요한지, 효과가 얼마나 될지, 운영에 안전하게 만들 수 있는지를 근거로 판단한다.
 *
 * **STRICT READ ONLY.** SELECT / EXPLAIN / EXPLAIN ANALYZE(SELECT 대상)만 실행한다.
 * CREATE INDEX 0 · DROP INDEX 0 · INSERT/UPDATE/DELETE 0 · migration 0.
 *
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/audit-ops-cancel-index-impact.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { PrismaClient } from '@prisma/client';
import { assertProductionDbAccessAllowed } from './_prod-db-guard';
import { getMolitLeafRegions } from '../src/lib/region/registry';

const BUSAN_16 = getMolitLeafRegions('26').map((r) => r.lawdCd);
const prisma = new PrismaClient();

const h = (t: string) => console.log(`\n--- ${t} ---`);

async function main() {
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'audit-ops-cancel-index-impact');
  console.log('=== OPS CANCEL COUNT INDEX IMPACT AUDIT (READ ONLY) ===');

  // ── §1 현재 인덱스 ──────────────────────────────────────────────────────────
  h('§1 apartment_trade_histories 실제 인덱스');
  const idx = await prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE tablename = 'apartment_trade_histories' ORDER BY indexname
  `;
  for (const i of idx) console.log(`  ${i.indexname}\n     ${i.indexdef.replace(/^CREATE (UNIQUE )?INDEX \S+ ON \S+ USING /, '')}`);

  // ── §5 크기 ────────────────────────────────────────────────────────────────
  h('§5 테이블 / 인덱스 크기');
  const sizes = await prisma.$queryRaw<{ name: string; bytes: bigint; pretty: string }[]>`
    SELECT 'TABLE (heap)' AS name, pg_relation_size('apartment_trade_histories') AS bytes,
           pg_size_pretty(pg_relation_size('apartment_trade_histories')) AS pretty
    UNION ALL
    SELECT 'TOTAL (heap+idx+toast)', pg_total_relation_size('apartment_trade_histories'),
           pg_size_pretty(pg_total_relation_size('apartment_trade_histories'))
    UNION ALL
    SELECT 'ALL INDEXES', pg_indexes_size('apartment_trade_histories'),
           pg_size_pretty(pg_indexes_size('apartment_trade_histories'))
  `;
  for (const s of sizes) console.log(`  ${s.name.padEnd(24)} ${s.pretty}`);

  const perIdx = await prisma.$queryRaw<{ indexrelname: string; pretty: string; bytes: bigint; scans: bigint }[]>`
    SELECT indexrelname, pg_size_pretty(pg_relation_size(indexrelid)) AS pretty,
           pg_relation_size(indexrelid) AS bytes, idx_scan AS scans
    FROM pg_stat_user_indexes WHERE relname = 'apartment_trade_histories'
    ORDER BY pg_relation_size(indexrelid) DESC
  `;
  console.log('  인덱스별 크기 / 누적 사용 횟수:');
  for (const i of perIdx) console.log(`    ${i.indexrelname.padEnd(62)} ${i.pretty.padStart(8)}  scans=${i.scans}`);

  const db = await prisma.$queryRaw<{ pretty: string }[]>`SELECT pg_size_pretty(pg_database_size(current_database())) AS pretty`;
  console.log(`  현재 DB 전체 크기: ${db[0].pretty}`);

  // ── §4 데이터 분포 / selectivity ───────────────────────────────────────────
  h('§4 데이터 분포');
  const dist = await prisma.$queryRaw<{ total: bigint; busan: bigint; canceled: bigint; busan_canceled: bigint; non_busan: bigint }[]>`
    SELECT COUNT(*) AS total,
           COUNT(*) FILTER (WHERE lawd_cd = ANY(${BUSAN_16})) AS busan,
           COUNT(*) FILTER (WHERE deal_canceled) AS canceled,
           COUNT(*) FILTER (WHERE lawd_cd = ANY(${BUSAN_16}) AND deal_canceled) AS busan_canceled,
           COUNT(*) FILTER (WHERE NOT (lawd_cd = ANY(${BUSAN_16}))) AS non_busan
    FROM apartment_trade_histories
  `;
  const d = dist[0];
  const pct = (a: bigint, b: bigint) => `${((Number(a) / Number(b)) * 100).toFixed(2)}%`;
  console.log(`  total            = ${Number(d.total).toLocaleString()}`);
  console.log(`  busan(16)        = ${Number(d.busan).toLocaleString()}  (${pct(d.busan, d.total)})`);
  console.log(`  non-busan        = ${Number(d.non_busan).toLocaleString()}  (${pct(d.non_busan, d.total)})`);
  console.log(`  deal_canceled T  = ${Number(d.canceled).toLocaleString()}  (${pct(d.canceled, d.total)})   <- selectivity`);
  console.log(`  busan & canceled = ${Number(d.busan_canceled).toLocaleString()}  (${pct(d.busan_canceled, d.total)})`);

  const byLawd = await prisma.$queryRaw<{ lawd_cd: string; c: bigint; canceled: bigint }[]>`
    SELECT lawd_cd, COUNT(*) AS c, COUNT(*) FILTER (WHERE deal_canceled) AS canceled
    FROM apartment_trade_histories GROUP BY lawd_cd ORDER BY COUNT(*) DESC LIMIT 20
  `;
  console.log('  lawd_cd별 상위 20 (rows / canceled):');
  for (const r of byLawd) console.log(`    ${r.lawd_cd}  ${String(Number(r.c).toLocaleString()).padStart(9)}  ${String(Number(r.canceled)).padStart(6)}`);
  console.log(`  distinct lawd_cd = ${(await prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(DISTINCT lawd_cd) n FROM apartment_trade_histories`)[0].n}`);

  // ── §3 쿼리 플랜 ───────────────────────────────────────────────────────────
  h('§3 EXPLAIN (ANALYZE, BUFFERS) — 문제의 쿼리 (READ ONLY)');
  const plan = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
    `EXPLAIN (ANALYZE, BUFFERS, VERBOSE) SELECT COUNT(*) FROM apartment_trade_histories WHERE lawd_cd = ANY($1) AND deal_canceled = true`,
    BUSAN_16
  );
  for (const row of plan) console.log(`  ${row['QUERY PLAN']}`);

  h('§3-b 비교: 같은 조건에서 deal_canceled 없이 (기존 인덱스가 얼마나 잘 도는가)');
  const plan2 = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
    `EXPLAIN (ANALYZE, BUFFERS) SELECT COUNT(*) FROM apartment_trade_histories WHERE lawd_cd = ANY($1)`,
    BUSAN_16
  );
  for (const row of plan2) console.log(`  ${row['QUERY PLAN']}`);

  // ── §9 인덱스 효과 추정 근거: hypopg가 있으면 가상 인덱스로 플랜을 본다 ────
  h('§9 hypopg(가상 인덱스) 사용 가능 여부');
  const hypo = await prisma.$queryRaw<{ name: string; installed: string | null }[]>`
    SELECT name, installed_version AS installed FROM pg_available_extensions WHERE name = 'hypopg'
  `;
  if (hypo.length === 0) console.log('  hypopg: 사용 불가(미제공) — 플랜 시뮬레이션 불가, ESTIMATE로만 보고');
  else console.log(`  hypopg: available, installed=${hypo[0].installed ?? '(미설치)'} — 설치는 schema 변경이라 이번 STEP 금지`);

  // 인덱스-온리 스캔의 하한선 근거: 취소 16k행만 훑는 비용이 어느 정도인지
  h('§9-b 참고: deal_canceled만으로 좁혔을 때의 비용(현재 인덱스로는 불가, 하한선 추정용)');
  const plan3 = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
    `EXPLAIN (ANALYZE, BUFFERS) SELECT COUNT(*) FROM apartment_trade_histories WHERE deal_canceled = true`
  );
  for (const row of plan3) console.log(`  ${row['QUERY PLAN']}`);

  // ── §6 write 빈도 근거 ─────────────────────────────────────────────────────
  h('§6 write 부하 근거 (최근 INSERT/UPDATE 량)');
  const stat = await prisma.$queryRaw<{ ins: bigint; upd: bigint; del: bigint; live: bigint; dead: bigint }[]>`
    SELECT n_tup_ins AS ins, n_tup_upd AS upd, n_tup_del AS del, n_live_tup AS live, n_dead_tup AS dead
    FROM pg_stat_user_tables WHERE relname = 'apartment_trade_histories'
  `;
  const st = stat[0];
  console.log(`  누적 INSERT=${Number(st.ins).toLocaleString()} UPDATE=${Number(st.upd).toLocaleString()} DELETE=${Number(st.del).toLocaleString()}`);
  console.log(`  live=${Number(st.live).toLocaleString()} dead=${Number(st.dead).toLocaleString()}`);
  const recent = await prisma.$queryRaw<{ d: string; c: bigint }[]>`
    SELECT to_char(created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS d, COUNT(*) AS c
    FROM apartment_trade_histories
    WHERE created_at >= NOW() - INTERVAL '10 days'
    GROUP BY 1 ORDER BY 1 DESC
  `;
  console.log('  최근 10일 INSERT(생성일 KST 기준):');
  for (const r of recent) console.log(`    ${r.d}  ${Number(r.c).toLocaleString()}`);

  // ── §8 온라인 인덱스 생성 가능성 근거 ──────────────────────────────────────
  h('§8 환경 근거');
  const ver = await prisma.$queryRaw<{ v: string }[]>`SELECT version() AS v`;
  console.log(`  ${ver[0].v.split(',')[0]}`);
  const rw = await prisma.$queryRaw<{ ro: string }[]>`SELECT current_setting('transaction_read_only') AS ro`;
  console.log(`  transaction_read_only = ${rw[0].ro}`);
  const locks = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*) n FROM pg_stat_activity
    WHERE state <> 'idle' AND pid <> pg_backend_pid()
  `;
  console.log(`  현재 활성 세션(비 idle) = ${locks[0].n}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
