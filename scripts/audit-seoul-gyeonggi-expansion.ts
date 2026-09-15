/**
 * SEOUL_GYEONGGI_EXPANSION_DATA_AUDIT_V1 — 서울/경기 확장 데이터 준비도 감사 (STRICT READ ONLY).
 *
 * - 모든 쿼리는 `SET TRANSACTION READ ONLY` 트랜잭션 안에서 SELECT/EXPLAIN만 실행한다(write가 섞이면 DB가 거부).
 * - 집계는 서버측 GROUP BY로만 한다 — 행을 끌어오지 않는다(SUPABASE_EGRESS_P0_FIX_V1).
 * - 외부 API 호출 0회. geocode·sync·backfill 없음.
 * - 지역 구분은 5자리 시군구 코드 앞 2자리: 11 서울 · 41 경기 · 26 부산(기준선).
 *
 * 실행:
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/audit-seoul-gyeonggi-expansion.ts > out.json
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { PrismaClient, Prisma } from '@prisma/client';
import { assertProductionDbAccessAllowed } from './_prod-db-guard';

const prisma = new PrismaClient();

/** 시군구 코드 컬럼 → 지역 라벨 SQL. */
const region = (col: string) =>
  `CASE LEFT(${col}, 2) WHEN '11' THEN 'SEOUL' WHEN '41' THEN 'GYEONGGI' WHEN '26' THEN 'BUSAN' ELSE 'OTHER' END`;

/** 대략적인 행정 경계 박스(좌표 이상치 판정용, 정밀 경계 아님). */
const BBOX_SQL = (lat: string, lng: string, r: string) => `CASE ${r}
  WHEN 'SEOUL' THEN (${lat} BETWEEN 37.40 AND 37.72 AND ${lng} BETWEEN 126.73 AND 127.28)
  WHEN 'GYEONGGI' THEN (${lat} BETWEEN 36.89 AND 38.30 AND ${lng} BETWEEN 126.37 AND 127.86)
  WHEN 'BUSAN' THEN (${lat} BETWEEN 34.90 AND 35.45 AND ${lng} BETWEEN 128.60 AND 129.35)
  ELSE TRUE END`;

type Q = { key: string; sql: string };

const QUERIES: Q[] = [
  {
    key: 'tableSizes',
    sql: `SELECT c.relname AS table, c.reltuples::bigint AS est_rows,
            pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
            pg_total_relation_size(c.oid) AS total_bytes
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r'
          ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 25`,
  },
  {
    key: 'dbSize',
    sql: `SELECT pg_size_pretty(pg_database_size(current_database())) AS size, pg_database_size(current_database()) AS bytes`,
  },
  {
    key: 'connections',
    sql: `SELECT current_setting('max_connections') AS max_connections,
            (SELECT COUNT(*) FROM pg_stat_activity WHERE datname = current_database())::int AS current_connections`,
  },
  // ── 3. 단지 마스터 ─────────────────────────────────────────────────────
  {
    key: 'masterCoverage',
    sql: `WITH m AS (SELECT *, ${region('sgg_cd')} AS r FROM apartment_masters)
          SELECT r,
            COUNT(*)::int AS rows,
            COUNT(apt_seq)::int AS apt_seq_nonnull,
            COUNT(DISTINCT apt_seq)::int AS apt_seq_distinct,
            COUNT(*) FILTER (WHERE apt_seq IS NOT NULL AND apt_seq !~ '^[0-9]{5}-[0-9]+$')::int AS apt_seq_invalid_format,
            COUNT(*) FILTER (WHERE apt_seq IS NOT NULL AND LEFT(apt_seq, 5) <> sgg_cd)::int AS apt_seq_sgg_mismatch,
            COUNT(*) FILTER (WHERE COALESCE(TRIM(name), '') <> '')::int AS name_ok,
            COUNT(DISTINCT sgg_cd)::int AS distinct_sgg,
            COUNT(umd_name)::int AS umd_name,
            COUNT(umd_cd)::int AS umd_cd,
            COUNT(jibun)::int AS jibun,
            COUNT(road_address)::int AS road_address,
            COUNT(build_year)::int AS build_year,
            COUNT(total_households)::int AS households,
            COUNT(parking_count)::int AS parking,
            COUNT(*) FILTER (WHERE latitude IS NOT NULL AND longitude IS NOT NULL)::int AS coord_nonnull,
            COUNT(*) FILTER (WHERE latitude = 0 OR longitude = 0)::int AS coord_zero,
            COUNT(*) FILTER (WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND latitude <> 0 AND longitude <> 0
                               AND NOT (${BBOX_SQL('latitude', 'longitude', 'r')}))::int AS coord_out_of_bbox
          FROM m WHERE r <> 'OTHER' OR sgg_cd IS NULL GROUP BY r ORDER BY r`,
  },
  {
    key: 'masterNullSgg',
    sql: `SELECT COUNT(*)::int AS rows, COUNT(*) FILTER (WHERE apt_seq IS NOT NULL)::int AS with_apt_seq,
            COUNT(*) FILTER (WHERE LEFT(apt_seq,2) IN ('11','41'))::int AS apt_seq_seoul_gyeonggi
          FROM apartment_masters WHERE sgg_cd IS NULL`,
  },
  {
    key: 'masterOtherRegions',
    sql: `SELECT LEFT(sgg_cd, 2) AS prefix, COUNT(*)::int AS rows FROM apartment_masters
          WHERE LEFT(sgg_cd, 2) NOT IN ('11','41','26') GROUP BY 1 ORDER BY 2 DESC LIMIT 20`,
  },
  {
    key: 'masterGeocodeQuality',
    sql: `SELECT ${region('sgg_cd')} AS r, COALESCE(geocode_quality, '(null)') AS quality, COUNT(*)::int AS rows
          FROM apartment_masters WHERE LEFT(sgg_cd,2) IN ('11','41','26') GROUP BY 1,2 ORDER BY 1,3 DESC`,
  },
  {
    key: 'masterBasicSpecSource',
    sql: `SELECT ${region('sgg_cd')} AS r, basic_spec_source::text AS source, COUNT(*)::int AS rows
          FROM apartment_masters WHERE LEFT(sgg_cd,2) IN ('11','41','26') GROUP BY 1,2 ORDER BY 1,3 DESC`,
  },
  {
    key: 'masterDuplicateCoords',
    sql: `WITH m AS (SELECT ${region('sgg_cd')} AS r, ROUND(latitude::numeric, 6) AS la, ROUND(longitude::numeric, 6) AS lo
                     FROM apartment_masters WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND LEFT(sgg_cd,2) IN ('11','41','26')),
               g AS (SELECT r, la, lo, COUNT(*) AS n FROM m GROUP BY 1,2,3 HAVING COUNT(*) > 1)
          SELECT r, COUNT(*)::int AS shared_points, SUM(n)::int AS masters_on_shared_points, MAX(n)::int AS max_on_one_point
          FROM g GROUP BY r ORDER BY r`,
  },
  {
    key: 'masterSggList',
    sql: `SELECT sgg_cd, MAX(sigungu) AS sigungu, COUNT(*)::int AS masters,
            COUNT(*) FILTER (WHERE latitude IS NOT NULL AND latitude <> 0)::int AS with_coord
          FROM apartment_masters WHERE LEFT(sgg_cd,2) IN ('11','41') GROUP BY 1 ORDER BY 1`,
  },
  // ── 4. canonical identity ─────────────────────────────────────────────
  {
    key: 'sameNameSameSgg',
    sql: `WITH g AS (SELECT ${region('sgg_cd')} AS r, sgg_cd, normalized_name, COUNT(DISTINCT apt_seq) AS n
                     FROM apartment_masters WHERE apt_seq IS NOT NULL AND LEFT(sgg_cd,2) IN ('11','41','26')
                     GROUP BY 1,2,3 HAVING COUNT(DISTINCT apt_seq) > 1)
          SELECT r, COUNT(*)::int AS name_groups, SUM(n)::int AS apt_seqs_in_groups FROM g GROUP BY r ORDER BY r`,
  },
  {
    key: 'sameNameAcrossRegions',
    sql: `WITH g AS (SELECT normalized_name, COUNT(DISTINCT sgg_cd) AS sggs,
                       BOOL_OR(LEFT(sgg_cd,2)='26') AS busan, BOOL_OR(LEFT(sgg_cd,2) IN ('11','41')) AS sg
                     FROM apartment_masters WHERE apt_seq IS NOT NULL GROUP BY 1)
          SELECT COUNT(*) FILTER (WHERE sggs > 1)::int AS names_in_multiple_sgg,
                 COUNT(*) FILTER (WHERE busan AND sg)::int AS names_shared_busan_and_seoul_gyeonggi FROM g`,
  },
  {
    key: 'sameJibunCollision',
    sql: `WITH g AS (SELECT ${region('sgg_cd')} AS r, umd_cd, jibun, COUNT(DISTINCT apt_seq) AS n
                     FROM apartment_masters WHERE apt_seq IS NOT NULL AND umd_cd IS NOT NULL AND jibun IS NOT NULL
                       AND LEFT(sgg_cd,2) IN ('11','41','26') GROUP BY 1,2,3 HAVING COUNT(DISTINCT apt_seq) > 1)
          SELECT r, COUNT(*)::int AS jibun_groups, SUM(n)::int AS apt_seqs_in_groups FROM g GROUP BY r ORDER BY r`,
  },
  {
    key: 'tradeOrphanAptSeq',
    sql: `WITH t AS (SELECT ${region('lawd_cd')} AS r, apt_seq, COUNT(*) AS rows FROM apartment_trade_histories
                     WHERE LEFT(lawd_cd,2) IN ('11','41','26') GROUP BY 1,2)
          SELECT t.r,
            COUNT(*) FILTER (WHERE t.apt_seq IS NULL)::int AS null_apt_seq_groups,
            COALESCE(SUM(t.rows) FILTER (WHERE t.apt_seq IS NULL), 0)::int AS null_apt_seq_rows,
            COUNT(*) FILTER (WHERE t.apt_seq IS NOT NULL)::int AS distinct_apt_seq,
            COUNT(*) FILTER (WHERE t.apt_seq IS NOT NULL AND m.apt_seq IS NULL)::int AS apt_seq_not_in_master,
            COALESCE(SUM(t.rows) FILTER (WHERE t.apt_seq IS NOT NULL AND m.apt_seq IS NULL), 0)::int AS rows_not_in_master
          FROM t LEFT JOIN apartment_masters m ON m.apt_seq = t.apt_seq GROUP BY t.r ORDER BY t.r`,
  },
  // ── 5. 매매 ────────────────────────────────────────────────────────────
  {
    key: 'saleCoverage',
    sql: `SELECT ${region('lawd_cd')} AS r,
            COUNT(*)::int AS rows,
            MIN(deal_date)::text AS earliest, MAX(deal_date)::text AS latest,
            COUNT(DISTINCT lawd_cd)::int AS distinct_lawd,
            COUNT(DISTINCT apt_seq)::int AS distinct_apt_seq,
            COUNT(*) FILTER (WHERE deal_canceled)::int AS canceled,
            COUNT(*) FILTER (WHERE NOT deal_canceled)::int AS active,
            COUNT(*) FILTER (WHERE apt_seq IS NULL)::int AS null_apt_seq,
            COUNT(*) FILTER (WHERE deal_amount <= 0 OR exclusive_area <= 0)::int AS malformed,
            COUNT(*) FILTER (WHERE deal_canceled AND cancel_date IS NULL)::int AS canceled_without_date,
            COUNT(*) FILTER (WHERE deal_date >= CURRENT_DATE - INTERVAL '12 months')::int AS rows_12m,
            COUNT(*) FILTER (WHERE deal_date >= CURRENT_DATE - INTERVAL '3 years')::int AS rows_3y,
            COUNT(*) FILTER (WHERE deal_date >= CURRENT_DATE - INTERVAL '5 years')::int AS rows_5y
          FROM apartment_trade_histories GROUP BY 1 ORDER BY 1`,
  },
  {
    key: 'saleLawdSeoulGyeonggi',
    sql: `SELECT lawd_cd, COUNT(*)::int AS rows, MIN(deal_date)::text AS earliest, MAX(deal_date)::text AS latest,
            COUNT(DISTINCT apt_seq)::int AS apt_seqs, COUNT(*) FILTER (WHERE deal_canceled)::int AS canceled
          FROM apartment_trade_histories WHERE LEFT(lawd_cd,2) IN ('11','41') GROUP BY 1 ORDER BY 1`,
  },
  {
    key: 'saleSources',
    sql: `SELECT ${region('lawd_cd')} AS r, source, COUNT(*)::int AS rows FROM apartment_trade_histories GROUP BY 1,2 ORDER BY 1,3 DESC`,
  },
  // ── 6. 취소 신뢰 ───────────────────────────────────────────────────────
  {
    key: 'cancelRatchetByRegion',
    sql: `WITH g AS (SELECT ${region('lawd_cd')} AS r, group_key, deal_amount, deal_date, floor,
                       COUNT(*)::int AS siblings, COUNT(*) FILTER (WHERE deal_canceled)::int AS canceled
                     FROM apartment_trade_histories GROUP BY 1,2,3,4,5)
          SELECT r,
            COUNT(*) FILTER (WHERE siblings > 1)::int AS multi_sibling_groups,
            COUNT(*) FILTER (WHERE siblings > 1 AND canceled = siblings)::int AS all_canceled_groups,
            COALESCE(SUM(siblings - 1) FILTER (WHERE siblings > 1 AND canceled = siblings), 0)::int AS suspect_over_cancel_rows_upper
          FROM g GROUP BY r ORDER BY r`,
  },
  {
    key: 'reRegistrationPattern',
    sql: `WITH g AS (SELECT ${region('lawd_cd')} AS r, group_key, deal_date, floor, exclusive_area,
                       COUNT(*) FILTER (WHERE deal_canceled) AS c, COUNT(*) FILTER (WHERE NOT deal_canceled) AS a
                     FROM apartment_trade_histories GROUP BY 1,2,3,4,5)
          SELECT r, COUNT(*) FILTER (WHERE c > 0 AND a > 0)::int AS canceled_and_active_same_unit_day
          FROM g GROUP BY r ORDER BY r`,
  },
  // ── 7. 전월세 ──────────────────────────────────────────────────────────
  {
    key: 'rentCoverage',
    sql: `SELECT ${region('lawd_cd')} AS r, COUNT(*)::int AS rows,
            MIN(deal_date)::text AS earliest, MAX(deal_date)::text AS latest,
            COUNT(DISTINCT lawd_cd)::int AS distinct_lawd,
            COUNT(*) FILTER (WHERE apt_seq IS NOT NULL)::int AS with_apt_seq,
            COUNT(*) FILTER (WHERE monthly_rent = 0)::int AS jeonse,
            COUNT(*) FILTER (WHERE monthly_rent > 0)::int AS wolse,
            COUNT(*) FILTER (WHERE deal_date >= CURRENT_DATE - INTERVAL '12 months')::int AS rows_12m
          FROM apartment_rent_histories GROUP BY 1 ORDER BY 1`,
  },
  {
    key: 'syncCoverageCells',
    sql: `SELECT dataset::text AS dataset, ${region('lawd_cd')} AS r, COUNT(*)::int AS cells, COUNT(DISTINCT lawd_cd)::int AS lawd,
            MIN(deal_ymd) AS min_ymd, MAX(deal_ymd) AS max_ymd,
            COUNT(*) FILTER (WHERE status::text IN ('COMPLETE','EMPTY_VALID'))::int AS verified,
            MAX(verified_at)::text AS last_verified
          FROM sync_coverage_cells GROUP BY 1,2 ORDER BY 1,2`,
  },
  // ── 8~12. 좌표·점수 입력 ───────────────────────────────────────────────
  {
    key: 'locationFeatureColumns',
    sql: `SELECT column_name FROM information_schema.columns WHERE table_name = 'apartment_location_features' ORDER BY ordinal_position`,
  },
  {
    key: 'marketFeatureCoverage',
    sql: `SELECT ${region("SPLIT_PART(apt_seq,'-',1)")} AS r, COUNT(*)::int AS rows,
            COUNT(latest_trade_price)::int AS latest_price, MAX(fetched_at)::text AS last_fetched
          FROM apartment_market_features GROUP BY 1 ORDER BY 1`,
  },
  {
    key: 'schoolsBySido',
    sql: `SELECT COALESCE(sido_code,'(null)') AS sido_code, COALESCE(school_level,'(null)') AS level, COUNT(*)::int AS rows,
            COUNT(*) FILTER (WHERE latitude IS NOT NULL)::int AS with_coord
          FROM schools GROUP BY 1,2 ORDER BY 1,2`,
  },
  {
    key: 'educationSources',
    sql: `SELECT column_name FROM information_schema.columns WHERE table_name = 'education_sources' ORDER BY ordinal_position`,
  },
  // ── 13. 검색 ──────────────────────────────────────────────────────────
  {
    key: 'legacyApartmentsByRegion',
    sql: `SELECT ${region('lawd_cd')} AS r, COUNT(*)::int AS rows, COUNT(apt_seq)::int AS with_apt_seq FROM apartments GROUP BY 1 ORDER BY 1`,
  },
  {
    key: 'duplicateDongNamesAcrossSido',
    sql: `WITH d AS (SELECT DISTINCT LEFT(lawd_cd,2) AS p, dong FROM apartment_trade_histories WHERE LEFT(lawd_cd,2) IN ('11','41','26'))
          SELECT COUNT(*)::int AS dong_names_in_multiple_sido FROM (SELECT dong FROM d GROUP BY dong HAVING COUNT(*) > 1) x`,
  },
  // ── 17~19. 오피스텔·분양·재개발 ────────────────────────────────────────
  {
    key: 'officetelMasters',
    sql: `SELECT ${region('sgg_cd')} AS r, COUNT(*)::int AS rows, COUNT(latitude)::int AS with_coord FROM officetel_masters GROUP BY 1 ORDER BY 1`,
  },
  {
    key: 'officetelTrades',
    sql: `SELECT ${region('lawd_cd')} AS r, COUNT(*)::int AS rows, COUNT(officetel_master_id)::int AS linked,
            MIN(deal_date)::text AS earliest, MAX(deal_date)::text AS latest FROM officetel_trade_histories GROUP BY 1 ORDER BY 1`,
  },
  {
    key: 'officetelRents',
    sql: `SELECT ${region('lawd_cd')} AS r, COUNT(*)::int AS rows FROM officetel_rent_histories GROUP BY 1 ORDER BY 1`,
  },
  {
    key: 'presalesByArea',
    sql: `SELECT COALESCE(subscription_area_name,'(null)') AS area, COUNT(*)::int AS rows,
            COUNT(latitude)::int AS with_coord,
            COUNT(*) FILTER (WHERE receipt_end_date >= CURRENT_DATE)::int AS open_or_upcoming,
            MIN(announcement_date)::text AS earliest, MAX(announcement_date)::text AS latest, MAX(updated_at)::text AS last_updated
          FROM presales GROUP BY 1 ORDER BY 2 DESC`,
  },
  {
    key: 'redevelopmentBySido',
    sql: `SELECT sido, COUNT(*)::int AS rows, COUNT(lat)::int AS with_coord, COUNT(DISTINCT primary_source)::int AS sources,
            STRING_AGG(DISTINCT primary_source, ',') AS source_list, MAX(source_updated_at)::text AS source_updated, MAX(collected_at)::text AS collected
          FROM redevelopment_projects GROUP BY 1 ORDER BY 2 DESC`,
  },
  // ── 21. 사이트맵 규모 ─────────────────────────────────────────────────
  {
    key: 'sitemapScale',
    sql: `WITH y AS (SELECT lawd_cd, dong, COUNT(*) AS n FROM apartment_trade_histories
                     WHERE NOT deal_canceled AND deal_date >= CURRENT_DATE - INTERVAL '366 days' AND LEFT(lawd_cd,2) IN ('11','41','26')
                     GROUP BY 1,2)
          SELECT ${region('lawd_cd')} AS r,
            COUNT(DISTINCT lawd_cd)::int AS lawd_with_trades_1y,
            COUNT(*)::int AS dongs_with_trades_1y,
            COUNT(*) FILTER (WHERE n >= 10)::int AS dongs_ge10_1y,
            COUNT(DISTINCT lawd_cd) FILTER (WHERE n >= 10)::int AS lawd_with_ge10_dong
          FROM y GROUP BY 1 ORDER BY 1`,
  },
  {
    key: 'marker30dPayloadProxy',
    sql: `SELECT ${region('lawd_cd')} AS r, COUNT(DISTINCT apt_seq)::int AS complexes_traded_12m
          FROM apartment_trade_histories WHERE NOT deal_canceled AND deal_date >= CURRENT_DATE - INTERVAL '12 months'
            AND LEFT(lawd_cd,2) IN ('11','41','26') GROUP BY 1 ORDER BY 1`,
  },
  // ── 23. 인덱스 ────────────────────────────────────────────────────────
  {
    key: 'indexes',
    sql: `SELECT tablename, indexname, indexdef FROM pg_indexes
          WHERE schemaname = 'public' AND tablename IN ('apartment_masters','apartment_trade_histories','apartment_rent_histories',
            'apartment_location_features','apartment_market_features','sync_coverage_cells','officetel_masters','schools')
          ORDER BY 1,2`,
  },
];

const EXPLAINS: Q[] = [
  {
    key: 'explainRegionReportDongWindow',
    sql: `EXPLAIN SELECT apt_seq, lawd_cd, dong, apt_name, exclusive_area, deal_amount, deal_date FROM apartment_trade_histories
          WHERE lawd_cd = '11680' AND dong = '대치동' AND deal_date BETWEEN CURRENT_DATE - 30 AND CURRENT_DATE AND deal_canceled = false`,
  },
  {
    key: 'explainMasterBounds',
    sql: `EXPLAIN SELECT apt_seq, name, latitude, longitude FROM apartment_masters
          WHERE latitude BETWEEN 37.49 AND 37.53 AND longitude BETWEEN 127.02 AND 127.08`,
  },
  {
    key: 'explainApt12mHistory',
    sql: `EXPLAIN SELECT deal_amount, deal_date, exclusive_area FROM apartment_trade_histories
          WHERE apt_seq = '11680-1' AND deal_date >= CURRENT_DATE - 365 ORDER BY deal_date DESC`,
  },
  {
    key: 'explainDongGroupBy1y',
    sql: `EXPLAIN SELECT lawd_cd, dong, COUNT(*) FROM apartment_trade_histories
          WHERE lawd_cd IN ('11680','11710','11440') AND deal_canceled = false AND deal_date >= CURRENT_DATE - 365 GROUP BY 1,2`,
  },
];

function toJsonSafe(v: unknown): unknown {
  return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? Number(x) : x instanceof Prisma.Decimal ? Number(x) : x)));
}

async function main() {
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'audit-seoul-gyeonggi-expansion.ts');
  const out: Record<string, unknown> = { generatedAt: new Date().toISOString() };
  const timings: Record<string, number> = {};
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '120s'");
      for (const q of [...QUERIES, ...EXPLAINS]) {
        const t0 = Date.now();
        try {
          out[q.key] = toJsonSafe(await tx.$queryRawUnsafe(q.sql));
        } catch (e) {
          out[q.key] = { error: e instanceof Error ? e.message.slice(0, 300) : String(e) };
        }
        timings[q.key] = Date.now() - t0;
      }
    },
    { timeout: 1_800_000, maxWait: 30_000 }
  );
  out.timingsMs = timings;
  console.log(JSON.stringify(out, null, 1));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
