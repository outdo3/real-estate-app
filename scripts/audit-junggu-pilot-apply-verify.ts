/**
 * SEOUL_JUNGGU_SALE_PRODUCTION_PILOT_APPLY_V1 — apply 전/후 Production 상태 스냅샷과
 * 원천↔DB 전수 parity (STRICT READ ONLY).
 *
 * `SET TRANSACTION READ ONLY` 안에서 SELECT/집계만. INSERT/UPDATE/DELETE 0.
 *
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/audit-junggu-pilot-apply-verify.ts --label=PRE
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/audit-junggu-pilot-apply-verify.ts --label=POST \
 *     --rowset=tmp/seoul-pilot-rowset/rowset-11140-202510-202609-<stamp>.json
 *
 * --rowset 을 주면 그 원천 행집합과 DB(중구)를 naturalKey 기준으로 **전수** 비교한다
 * (표본 아님): sourceOnly / dbOnly / 금액·거래일·층·occurrenceIndex·취소상태·aptSeq 불일치.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { PrismaClient } from '@prisma/client';
import { assertProductionDbAccessAllowed } from './_prod-db-guard';
import { naturalKeyOf } from './backfill-seoul-sale-logic';

const prisma = new PrismaClient();
const DISTRICT = '11140';

/** REPAIR_AUDIT_V1이 확정한 21행 + GATE_V1 §5의 신규 7그룹 형제 7행 = known false-cancel 28. */
const KNOWN21 = [940779, 940906, 949472, 949523, 949532, 949575, 949624, 949692,
  949727, 949910, 949929, 949991, 950026, 950082, 950183, 950194,
  950239, 950382, 950395, 950396, 950451];
const NEW7_SIBLINGS = [950598, 950570, 950590, 950664, 950722, 950723, 950736];
const KNOWN28 = [...KNOWN21, ...NEW7_SIBLINGS];

const G = `WITH g AS (
  SELECT group_key, deal_amount, deal_date, floor,
         COUNT(*)::int AS siblings, COUNT(*) FILTER (WHERE deal_canceled)::int AS canceled
  FROM apartment_trade_histories GROUP BY 1,2,3,4)`;

interface RowsetEntry {
  naturalKey: string; aptSeq: string | null; aptName: string; dong: string | null;
  dealDate: string; dealAmount: number; floor: number | null; occurrenceIndex: number;
  canceled: boolean; cancelDate: string | null; cell: string;
}

async function main() {
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'audit-junggu-pilot-apply-verify.ts');
  const get = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
  const label = get('label') ?? 'SNAPSHOT';
  const rowsetPath = get('rowset');
  const since = get('since');

  const out: Record<string, unknown> = {
    label, checkedAt: new Date().toISOString(), readOnly: true,
    writes: { insert: 0, update: 0, delete: 0 },
  };

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '300s'");

    // 전체 / 지역 census.
    out.totals = await tx.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS total_rows,
              COUNT(*) FILTER (WHERE NOT deal_canceled)::int AS active,
              COUNT(*) FILTER (WHERE deal_canceled)::int AS canceled,
              COUNT(DISTINCT lawd_cd)::int AS districts FROM apartment_trade_histories`);
    out.by_sido = await tx.$queryRawUnsafe(
      `SELECT LEFT(lawd_cd,2) AS sido, COUNT(*)::int AS n,
              COUNT(*) FILTER (WHERE deal_canceled)::int AS canceled
       FROM apartment_trade_histories GROUP BY 1 ORDER BY 1`);
    out.seoul_by_district = await tx.$queryRawUnsafe(
      `SELECT lawd_cd, COUNT(*)::int AS n,
              COUNT(*) FILTER (WHERE NOT deal_canceled)::int AS active,
              COUNT(*) FILTER (WHERE deal_canceled)::int AS canceled
       FROM apartment_trade_histories WHERE lawd_cd LIKE '11%' GROUP BY 1 ORDER BY 1`);
    out.junggu = await tx.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n,
              COUNT(*) FILTER (WHERE NOT deal_canceled)::int AS active,
              COUNT(*) FILTER (WHERE deal_canceled)::int AS canceled,
              COUNT(*) FILTER (WHERE apt_seq IS NULL)::int AS null_apt_seq,
              MIN(created_at) AS first_created, MAX(created_at) AS last_created
       FROM apartment_trade_histories WHERE lawd_cd = $1`, DISTRICT);

    // 자연키 중복 — 전역 및 중구.
    out.natural_key_duplicates_global = await tx.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM (SELECT group_key, deal_amount, deal_date, floor, occurrence_index
       FROM apartment_trade_histories GROUP BY 1,2,3,4,5 HAVING COUNT(*) > 1) d`);
    out.natural_key_duplicates_junggu = await tx.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM (SELECT group_key, deal_amount, deal_date, floor, occurrence_index
       FROM apartment_trade_histories WHERE lawd_cd = $1 GROUP BY 1,2,3,4,5 HAVING COUNT(*) > 1) d`, DISTRICT);

    // 취소 상한 census.
    out.upper_bound = await tx.$queryRawUnsafe(`${G}
      SELECT COUNT(*) FILTER (WHERE siblings > 1)::int AS multi_sibling_groups,
             COUNT(*) FILTER (WHERE siblings > 1 AND canceled = siblings)::int AS all_canceled_groups,
             COALESCE(SUM(siblings - 1) FILTER (WHERE siblings > 1 AND canceled = siblings), 0)::int AS suspect_upper_bound
      FROM g`);

    // known 28.
    out.known28 = await tx.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE deal_canceled)::int AS still_canceled,
              COUNT(*) FILTER (WHERE NOT deal_canceled)::int AS restored,
              MAX(updated_at) AS newest_update
       FROM apartment_trade_histories WHERE id IN (${KNOWN28.join(',')})`);

    // 중구 master exact integrity — apt_seq가 ApartmentMaster에 정확히 있는가.
    out.junggu_master_exact = await tx.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS rows_total,
              COUNT(*) FILTER (WHERE m.apt_seq IS NOT NULL)::int AS exact_master,
              COUNT(*) FILTER (WHERE m.apt_seq IS NULL)::int AS master_missing
       FROM apartment_trade_histories t
       LEFT JOIN apartment_masters m ON m.apt_seq = t.apt_seq
       WHERE t.lawd_cd = $1`, DISTRICT);

    if (since) {
      out.rows_created_since = await tx.$queryRawUnsafe(
        `SELECT lawd_cd, COUNT(*)::int AS n FROM apartment_trade_histories
         WHERE created_at > $1::timestamp GROUP BY 1 ORDER BY 1`, since);
      out.rows_updated_since = await tx.$queryRawUnsafe(
        `SELECT lawd_cd, COUNT(*)::int AS n FROM apartment_trade_histories
         WHERE updated_at > $1::timestamp AND created_at <= $1::timestamp GROUP BY 1 ORDER BY 1`, since);
    }
  }, { timeout: 900_000 });

  // 원천 ↔ DB 전수 parity.
  if (rowsetPath) {
    const art = JSON.parse(fs.readFileSync(rowsetPath, 'utf8')) as { rows: RowsetEntry[] };
    const src = new Map(art.rows.map((r) => [r.naturalKey, r]));
    const dbRows = await prisma.apartmentTradeHistory.findMany({
      where: { lawdCd: DISTRICT },
      select: { id: true, aptSeq: true, aptName: true, dong: true, groupKeyStr: true, dealAmount: true,
        dealDate: true, floor: true, occurrenceIndex: true, dealCanceled: true, cancelDate: true },
    });
    const db = new Map<string, (typeof dbRows)[number]>();
    for (const r of dbRows) {
      db.set(naturalKeyOf({
        groupKeyStr: r.groupKeyStr, dealAmount: r.dealAmount,
        dealDate: r.dealDate.toISOString().slice(0, 10), floor: r.floor, occurrenceIndex: r.occurrenceIndex,
      }), r);
    }
    const sourceOnly: string[] = [];
    const dbOnly: string[] = [];
    const mismatches: unknown[] = [];
    for (const [k, s] of src) {
      const d = db.get(k);
      if (!d) { sourceOnly.push(k); continue; }
      const diff: string[] = [];
      if (d.dealAmount !== s.dealAmount) diff.push(`dealAmount ${d.dealAmount}!=${s.dealAmount}`);
      if (d.dealDate.toISOString().slice(0, 10) !== s.dealDate) diff.push(`dealDate ${d.dealDate.toISOString().slice(0, 10)}!=${s.dealDate}`);
      if ((d.floor ?? null) !== (s.floor ?? null)) diff.push(`floor ${d.floor}!=${s.floor}`);
      if (d.occurrenceIndex !== s.occurrenceIndex) diff.push(`occurrenceIndex ${d.occurrenceIndex}!=${s.occurrenceIndex}`);
      if (d.dealCanceled !== s.canceled) diff.push(`canceled ${d.dealCanceled}!=${s.canceled}`);
      if ((d.aptSeq ?? null) !== (s.aptSeq ?? null)) diff.push(`aptSeq ${d.aptSeq}!=${s.aptSeq}`);
      if ((d.cancelDate ?? null) !== (s.cancelDate ?? null)) diff.push(`cancelDate ${d.cancelDate}!=${s.cancelDate}`);
      if (diff.length) mismatches.push({ naturalKey: k, id: d.id, apt: d.aptName, diff });
    }
    for (const k of db.keys()) if (!src.has(k)) dbOnly.push(k);
    out.parity = {
      rowsetFile: path.basename(rowsetPath),
      sourceRows: src.size, dbRows: db.size,
      sourceOnly: sourceOnly.length, dbOnly: dbOnly.length,
      fieldMismatches: mismatches.length,
      sourceOnlyKeys: sourceOnly.slice(0, 40), dbOnlyKeys: dbOnly.slice(0, 40),
      mismatchDetail: mismatches.slice(0, 40),
    };
  }

  console.log(JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? Number(v) : v), 2));
}

main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); }).finally(() => prisma.$disconnect());
