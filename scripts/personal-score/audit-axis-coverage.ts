/**
 * PERSONALIZED_SCORE_V1 PHASE 1 — 개인화 후보 축 데이터 coverage 감사 (STRICT READ ONLY).
 *
 * 모든 쿼리는 `SET TRANSACTION READ ONLY` 트랜잭션 안에서 실행한다. 출력은 개수·비율·분위수뿐이다.
 * 단지명·주소·사용자 id·선호 내용 원문은 출력하지 않는다(user_preferences는 행 수와 키 이름 집계만).
 *
 * 실행: ALLOW_PROD_DB_READ=1 npx tsx scripts/personal-score/audit-axis-coverage.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { PrismaClient, Prisma } from '@prisma/client';
import { assertProductionDbAccessAllowed } from '../_prod-db-guard';

const prisma = new PrismaClient();
type Row = Record<string, unknown>;
const toJson = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? Number(x) : x)));

const SQL: Record<string, string> = {
  // 기준 모집단: 부산(26) aptSeq 보유 master
  universe: `
    SELECT count(*)::int AS masters_total,
           count(*) FILTER (WHERE apt_seq IS NOT NULL)::int AS with_apt_seq,
           count(*) FILTER (WHERE apt_seq IS NOT NULL AND sgg_cd LIKE '26%')::int AS busan_with_apt_seq,
           count(*) FILTER (WHERE apt_seq IS NOT NULL AND sgg_cd LIKE '26%' AND latitude IS NOT NULL)::int AS busan_geocoded
    FROM apartment_masters`,

  newness: `
    SELECT count(*)::int AS n,
           count(*) FILTER (WHERE build_year IS NOT NULL)::int AS build_year,
           count(*) FILTER (WHERE use_approval_date ~ '^[0-9]{8}$')::int AS use_approval_date_valid,
           count(*) FILTER (WHERE build_year IS NOT NULL OR use_approval_date ~ '^[0-9]{8}$')::int AS any_age,
           count(*) FILTER (WHERE build_year IS NOT NULL AND use_approval_date ~ '^[0-9]{8}$'
                              AND abs(build_year - substr(use_approval_date,1,4)::int) > 1)::int AS year_mismatch_gt1,
           count(*) FILTER (WHERE build_year IS NOT NULL AND (build_year < 1960 OR build_year > extract(year from now())::int + 1))::int AS build_year_out_of_range,
           percentile_disc(ARRAY[0.1,0.25,0.5,0.75,0.9]) WITHIN GROUP (ORDER BY extract(year from now())::int - build_year) FILTER (WHERE build_year IS NOT NULL) AS age_years_p10_25_50_75_90
    FROM apartment_masters WHERE apt_seq IS NOT NULL AND sgg_cd LIKE '26%'`,

  parking: `
    SELECT count(*)::int AS n,
           count(*) FILTER (WHERE total_households IS NOT NULL AND total_households > 0)::int AS households,
           count(*) FILTER (WHERE parking_count IS NOT NULL)::int AS parking_count,
           count(*) FILTER (WHERE parking_per_household IS NOT NULL)::int AS parking_per_household,
           count(*) FILTER (WHERE parking_per_household IS NOT NULL AND parking_per_household > 0)::int AS pph_positive,
           count(*) FILTER (WHERE parking_per_household IS NOT NULL AND (parking_per_household <= 0.05 OR parking_per_household > 5))::int AS pph_implausible,
           percentile_disc(ARRAY[0.1,0.25,0.5,0.75,0.9]) WITHIN GROUP (ORDER BY parking_per_household) FILTER (WHERE parking_per_household > 0) AS pph_p10_25_50_75_90
    FROM apartment_masters WHERE apt_seq IS NOT NULL AND sgg_cd LIKE '26%'`,

  basicSpecSource: `
    SELECT basic_spec_source::text AS source, count(*)::int AS n
    FROM apartment_masters WHERE apt_seq IS NOT NULL AND sgg_cd LIKE '26%' GROUP BY 1 ORDER BY 2 DESC`,

  transport: `
    SELECT count(m.apt_seq)::int AS busan_masters,
           count(f.apt_seq)::int AS with_location_feature,
           count(f.nearest_subway_distance_m)::int AS subway_distance,
           count(f.subway_count_1000m)::int AS subway_count_1000m,
           count(f.nearest_bus_stop_distance_m)::int AS bus_stop_distance,
           count(f.bus_stop_count_300m)::int AS bus_stop_count_300m,
           count(f.nearest_elementary_distance_m)::int AS elementary_distance,
           count(*) FILTER (WHERE f.apt_seq IS NOT NULL AND f.valid_until IS NOT NULL AND f.valid_until < now())::int AS location_expired,
           percentile_disc(ARRAY[0.1,0.25,0.5,0.75,0.9]) WITHIN GROUP (ORDER BY f.nearest_subway_distance_m) FILTER (WHERE f.nearest_subway_distance_m IS NOT NULL) AS subway_m_p10_25_50_75_90,
           percentile_disc(ARRAY[0.1,0.25,0.5,0.75,0.9]) WITHIN GROUP (ORDER BY f.nearest_bus_stop_distance_m) FILTER (WHERE f.nearest_bus_stop_distance_m IS NOT NULL) AS bus_m_p10_25_50_75_90
    FROM apartment_masters m LEFT JOIN apartment_location_features f ON f.apt_seq = m.apt_seq
    WHERE m.apt_seq IS NOT NULL AND m.sgg_cd LIKE '26%'`,

  locationQuality: `
    SELECT f.quality_flag, f.source, count(*)::int AS n
    FROM apartment_location_features f JOIN apartment_masters m ON m.apt_seq = f.apt_seq
    WHERE m.sgg_cd LIKE '26%' GROUP BY 1, 2 ORDER BY 3 DESC`,

  market: `
    SELECT count(m.apt_seq)::int AS busan_masters,
           count(f.apt_seq)::int AS with_market_feature,
           count(f.latest_trade_price)::int AS latest_trade_price,
           count(*) FILTER (WHERE f.latest_trade_date > now() - interval '12 months')::int AS latest_trade_within_12m,
           count(f.median_price_per_m2_12m)::int AS median_ppm2_12m,
           count(f.median_price_per_m2_36m)::int AS median_ppm2_36m,
           count(*) FILTER (WHERE f.transaction_count_12m > 0)::int AS txn_12m_positive,
           count(*) FILTER (WHERE f.transaction_count_12m >= 5)::int AS txn_12m_ge5,
           count(f.price_change_12m)::int AS price_change_12m,
           count(*) FILTER (WHERE f.apt_seq IS NOT NULL AND f.valid_until IS NOT NULL AND f.valid_until < now())::int AS market_expired,
           max(f.fetched_at) AS market_fetched_latest,
           min(f.fetched_at) AS market_fetched_oldest
    FROM apartment_masters m LEFT JOIN apartment_market_features f ON f.apt_seq = m.apt_seq
    WHERE m.apt_seq IS NOT NULL AND m.sgg_cd LIKE '26%'`,

  // 실거래 원장에서 직접 산출 가능한지(단지 단위 aptSeq 기준)
  tradeLedger: `
    SELECT count(DISTINCT apt_seq)::int AS apt_seq_with_any_trade,
           count(DISTINCT apt_seq) FILTER (WHERE deal_date >= now() - interval '12 months')::int AS apt_seq_trade_12m,
           count(DISTINCT apt_seq) FILTER (WHERE deal_date >= now() - interval '36 months')::int AS apt_seq_trade_36m
    FROM apartment_trade_histories WHERE lawd_cd LIKE '26%'`,

  school: `
    SELECT (SELECT count(*) FROM schools)::int AS schools,
           (SELECT count(*) FROM school_stats)::int AS school_stats,
           (SELECT count(*) FROM education_sources)::int AS education_sources,
           (SELECT count(*) FROM kindergartens)::int AS kindergartens,
           (SELECT count(*) FROM childcares)::int AS childcares`,

  redevelopment: `
    SELECT (SELECT count(*) FROM redevelopment_projects)::int AS projects,
           (SELECT count(*) FROM redevelopment_source_records)::int AS source_records`,

  presales: `SELECT count(*)::int AS presales FROM presales`,

  preferences: `
    SELECT (SELECT count(*) FROM user_preferences)::int AS rows,
           (SELECT count(*) FROM users)::int AS users,
           (SELECT count(*) FROM user_preferences WHERE jsonb_typeof(purposes::jsonb) = 'array')::int AS purposes_array,
           (SELECT count(*) FROM user_preferences WHERE jsonb_typeof(purposes::jsonb) = 'array' AND jsonb_array_length(purposes::jsonb) > 0)::int AS purposes_nonempty`,
};

async function main() {
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'personal-score/audit-axis-coverage');
  const out: Record<string, unknown> = { generatedAt: new Date().toISOString() };
  await prisma.$transaction(
    async (tx: Prisma.TransactionClient) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      for (const [k, sql] of Object.entries(SQL)) {
        try {
          out[k] = toJson(await tx.$queryRawUnsafe<Row[]>(sql));
        } catch (e) {
          out[k] = { error: (e as { code?: string }).code ?? (e as Error).name, message: String((e as Error).message).split('\n').slice(-1)[0].slice(0, 160) };
          throw e;
        }
      }
    },
    { timeout: 120_000 }
  );
  console.log(JSON.stringify(out, null, 1));
}

main()
  .catch((e) => {
    console.error('failed:', (e as { code?: string }).code ?? (e as Error).name, String((e as Error).message).split('\n').slice(-1)[0].slice(0, 200));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
