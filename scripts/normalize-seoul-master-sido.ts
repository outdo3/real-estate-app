/**
 * SEOUL_MASTER_SIDO_NORMALIZATION_V1 — 서울 ApartmentMaster의 sido를 registry 축약 표기로 맞춘다('서울특별시' → '서울').
 *
 * 기본은 DRY RUN(읽기만). 쓰기는 --apply + ALLOW_PROD_DB_WRITE=1(+ ALLOW_PROD_DB_READ=1) + --expect=<대상 행 수>가 모두 있을 때만.
 *   - 대상: sido = '서울특별시' AND sgg_cd LIKE '11%' (이중 조건). 다른 지역·다른 컬럼은 건드리지 않는다.
 *   - 쓰기 전에 대상 전 행 스냅샷(before.json)과 되돌림 템플릿을 먼저 파일로 남긴다(되돌림은 실행하지 않음).
 *   - UPDATE는 한 트랜잭션 안에서 실행하고, 영향 행 수가 기대값과 다르면 트랜잭션을 되돌린다.
 *   - raw SQL `SET sido = ...`만 — updated_at 등 다른 컬럼은 바뀌지 않는다.
 *
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/normalize-seoul-master-sido.ts
 *   (승인 시) ALLOW_PROD_DB_READ=1 ALLOW_PROD_DB_WRITE=1 npx tsx scripts/normalize-seoul-master-sido.ts --apply --expect=6843
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { getSido } from '../src/lib/region/registry';

export const FROM_SIDO = getSido('11')!.name; // '서울특별시'
export const TO_SIDO = getSido('11')!.shortName; // '서울'
export const SEOUL_PREFIX = '11';

export interface Baseline {
  seoulTotal: number;
  seoulFull: number;
  seoulShort: number;
  seoulUniqueAptSeq: number;
  busanTotal: number;
  targetRows: number;
  targetNonSeoul: number;
}

/** 적용 전 조건: 서울 전 행이 '서울특별시'이고, 대상 행 = 서울 행 = 기대값, 대상 중 서울 밖 0. */
export function checkBaseline(b: Baseline, expected: number, expectedBusan: number): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (b.seoulTotal !== expected) reasons.push(`SEOUL_TOTAL_${b.seoulTotal}_NE_${expected}`);
  if (b.seoulFull !== expected) reasons.push(`SEOUL_FULL_NAME_${b.seoulFull}_NE_${expected}`);
  if (b.seoulShort !== 0) reasons.push(`SEOUL_ALREADY_SHORT_${b.seoulShort}`);
  if (b.seoulUniqueAptSeq !== expected) reasons.push(`SEOUL_UNIQUE_APTSEQ_${b.seoulUniqueAptSeq}_NE_${expected}`);
  if (b.targetRows !== expected) reasons.push(`TARGET_${b.targetRows}_NE_${expected}`);
  if (b.targetNonSeoul !== 0) reasons.push(`TARGET_HAS_NON_SEOUL_${b.targetNonSeoul}`);
  if (b.busanTotal !== expectedBusan) reasons.push(`BUSAN_${b.busanTotal}_NE_${expectedBusan}`);
  return { ok: reasons.length === 0, reasons };
}

/** 트랜잭션 안에서 영향 행 수를 확인한다 — 다르면 throw해서 트랜잭션을 되돌린다. */
export function assertAffected(affected: number, expected: number): void {
  if (affected !== expected) throw new Error(`AFFECTED_ROWS_${affected}_NE_${expected} — 트랜잭션 되돌림`);
}

export function applyGates(argv: readonly string[], env: Record<string, string | undefined>): { apply: boolean; expected: number | null; reasons: string[] } {
  const apply = argv.includes('--apply');
  const exp = argv.find((a) => a.startsWith('--expect='))?.split('=')[1];
  const expected = exp && /^\d+$/.test(exp) ? Number(exp) : null;
  const reasons: string[] = [];
  if (apply) {
    if (env.ALLOW_PROD_DB_WRITE !== '1') reasons.push('ALLOW_PROD_DB_WRITE_NOT_1');
    if (expected == null) reasons.push('EXPECT_REQUIRED');
  }
  return { apply, expected, reasons };
}

/** 스냅샷 비교: sido 외 컬럼이 바뀐 행 수. */
export function diffSnapshots(before: readonly Record<string, unknown>[], after: readonly Record<string, unknown>[], allowed: readonly string[]) {
  const byId = new Map(after.map((r) => [r.id, r]));
  const unexpected: { id: unknown; field: string }[] = [];
  let missing = 0;
  for (const b of before) {
    const a = byId.get(b.id);
    if (!a) { missing++; continue; }
    for (const k of Object.keys(b)) if (!allowed.includes(k) && JSON.stringify(a[k]) !== JSON.stringify(b[k])) unexpected.push({ id: b.id, field: k });
  }
  return { missing, unexpected, extra: after.length - (before.length - missing) };
}

const OUT = path.resolve(__dirname, '../tmp/seoul-master-sido-normalization');
const COLS = `id, apt_seq, sgg_cd, sido, name, normalized_name, sigungu, umd_name, umd_cd, jibun, build_year, latitude, longitude, geocode_quality, created_at, updated_at`;
const BUSAN_FP = `md5(string_agg(apt_seq || ':' || COALESCE(sido,'-') || ':' || name || ':' || COALESCE(latitude::text,'-') || ':' || COALESCE(longitude::text,'-') || ':' || updated_at::text, ',' ORDER BY apt_seq))`;

async function main() {
  const gates = applyGates(process.argv.slice(2), process.env as Record<string, string | undefined>);
  const { assertProductionDbAccessAllowed } = await import('./_prod-db-guard');
  assertProductionDbAccessAllowed(gates.apply ? 'BACKFILL' : 'DIAGNOSTIC', 'normalize-seoul-master-sido');
  if (gates.reasons.length) { console.error(`[APPLY 거부] ${gates.reasons.join(', ')}`); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  const json = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? Number(x) : x)));

  const read = () => prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const [b] = await tx.$queryRawUnsafe<any[]>(`SELECT
      COUNT(*) FILTER (WHERE sgg_cd LIKE '11%')::int AS "seoulTotal",
      COUNT(*) FILTER (WHERE sgg_cd LIKE '11%' AND sido = $1)::int AS "seoulFull",
      COUNT(*) FILTER (WHERE sgg_cd LIKE '11%' AND sido = $2)::int AS "seoulShort",
      COUNT(DISTINCT apt_seq) FILTER (WHERE sgg_cd LIKE '11%')::int AS "seoulUniqueAptSeq",
      COUNT(*) FILTER (WHERE sgg_cd LIKE '26%')::int AS "busanTotal",
      COUNT(*) FILTER (WHERE sido = $1 AND sgg_cd LIKE '11%')::int AS "targetRows",
      COUNT(*) FILTER (WHERE sido = $1 AND sgg_cd NOT LIKE '11%')::int AS "targetNonSeoul",
      COUNT(latitude) FILTER (WHERE sgg_cd LIKE '11%')::int AS "seoulCoordNonNull",
      COUNT(*) FILTER (WHERE sgg_cd LIKE '11%' AND latitude IS NULL)::int AS "seoulCoordNull",
      COUNT(*)::int AS total
      FROM apartment_masters`, FROM_SIDO, TO_SIDO);
    const [busan] = await tx.$queryRawUnsafe<any[]>(`SELECT ${BUSAN_FP} AS fp, MAX(updated_at) AS max_updated, array_agg(DISTINCT sido) AS sidos, COUNT(*) FILTER (WHERE latitude IS NULL)::int AS null_coords FROM apartment_masters WHERE sgg_cd LIKE '26%'`);
    const rows = await tx.$queryRawUnsafe<any[]>(`SELECT ${COLS} FROM apartment_masters WHERE sgg_cd LIKE '11%' ORDER BY id`);
    return json({ baseline: b, busan, rows });
  }, { timeout: 120000 });

  const before = await read();
  const check = checkBaseline(before.baseline, gates.expected ?? before.baseline.seoulTotal, 3438);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(OUT, `before-${stamp}.json`), JSON.stringify({ at: new Date().toISOString(), baseline: before.baseline, busan: before.busan, rows: before.rows }, null, 2));
  fs.writeFileSync(path.join(OUT, `rollback-${stamp}.json`), JSON.stringify({
    note: '실행하지 않은 되돌림 템플릿 — 스냅샷 id 목록 + 서울 구 코드 + 현재 값 3중 조건.',
    sql: `UPDATE apartment_masters SET sido = '${FROM_SIDO}' WHERE id = ANY($1::int[]) AND sgg_cd LIKE '11%' AND sido = '${TO_SIDO}'`,
    ids: before.rows.map((r: any) => r.id), expectedRows: before.rows.length,
  }, null, 2));
  console.log(JSON.stringify({ baseline: before.baseline, busan: { ...before.busan }, snapshotRows: before.rows.length, check }));
  if (!gates.apply) { console.log('[DRY RUN] 쓰기 없음'); await prisma.$disconnect(); return; }
  if (!check.ok) { console.error(`[STOP] baseline 불일치: ${check.reasons.join(', ')}`); await prisma.$disconnect(); process.exit(2); }

  const t0 = Date.now();
  const affected = await prisma.$transaction(async (tx) => {
    const n = await tx.$executeRawUnsafe(`UPDATE apartment_masters SET sido = $1 WHERE sido = $2 AND sgg_cd LIKE '11%'`, TO_SIDO, FROM_SIDO);
    assertAffected(n, gates.expected!);
    return n;
  }, { timeout: 120000 });
  const ms = Date.now() - t0;

  const after = await read();
  const diff = diffSnapshots(before.rows, after.rows, ['sido']);
  const result = {
    at: new Date().toISOString(), affected, ms, before: before.baseline, after: after.baseline,
    busanBefore: before.busan, busanAfter: after.busan, busanUnchanged: JSON.stringify(before.busan) === JSON.stringify(after.busan),
    rowDiff: { missing: diff.missing, extra: diff.extra, unexpectedFieldChanges: diff.unexpected.length, examples: diff.unexpected.slice(0, 10) },
    updatedAtChanged: diffSnapshots(before.rows, after.rows, ['sido']).unexpected.filter((u) => u.field === 'updated_at').length,
  };
  fs.writeFileSync(path.join(OUT, `applied-${stamp}.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  await prisma.$disconnect();
}

if (require.main === module) main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
