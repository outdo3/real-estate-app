// RENT_TRADE_HISTORY_V1 PHASE C — 백필 완료 후 read-only 검증 스크립트.
// §17(중복) §21(money) §22(contract) §23(area) §24(date) §25(floor) §26(storage)
// §20(source-vs-DB) §37(dashboard SQL preview)를 한 번에 점검한다. DB에 쓰기 없음.
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });
import { PrismaClient } from '@prisma/client';
import { fetchRentRegionMonth } from './rent-molit-fetch';
import { normalizeMolitRentItemsToRentRows } from './rent-history-logic';

const prisma = new PrismaClient();

const BUSAN_LAWDCD = ['26110','26140','26170','26200','26230','26260','26290','26320','26350','26380','26410','26440','26470','26500','26530','26710'];
const FROM = '202408';
const TO = '202607';

async function main() {
  console.log('=== §33 FULL COUNT CONSISTENCY ===');
  const totalCount = await prisma.apartmentRentHistory.count();
  const scopedCount = await prisma.apartmentRentHistory.count({ where: { lawdCd: { in: BUSAN_LAWDCD }, dealYmd: { gte: FROM, lte: TO } } });
  console.log(`DB 전체 row 수: ${totalCount}`);
  console.log(`이번 스코프(부산16구 x 202408~202607) row 수: ${scopedCount}`);
  console.log(`기대값(dry-run+apply manifest 합계): 122431 (신규 121193 + 기존 Phase B 1238)`);

  console.log('\n=== §17 STRUCTURAL DUPLICATE CHECK (natural key) ===');
  const dupRows: { cnt: bigint }[] = await prisma.$queryRaw`
    SELECT COUNT(*) as cnt FROM (
      SELECT group_key, deposit, monthly_rent, deal_date, floor, occurrence_index, COUNT(*) as c
      FROM apartment_rent_histories
      GROUP BY group_key, deposit, monthly_rent, deal_date, floor, occurrence_index
      HAVING COUNT(*) > 1
    ) sub`;
  console.log(`natural key 중복 그룹 수(기대값 0): ${dupRows[0].cnt}`);

  console.log('\n=== §14 IDENTITY ===');
  const nullAptSeq = await prisma.apartmentRentHistory.count({ where: { lawdCd: { in: BUSAN_LAWDCD }, dealYmd: { gte: FROM, lte: TO }, aptSeq: null } });
  const nameFallback = await prisma.apartmentRentHistory.count({ where: { lawdCd: { in: BUSAN_LAWDCD }, dealYmd: { gte: FROM, lte: TO }, identityKey: { startsWith: 'nd:' } } });
  console.log(`aptSeq NULL row(기대값 0): ${nullAptSeq}`);
  console.log(`identityKey nd: fallback row(기대값 0): ${nameFallback}`);

  console.log('\n=== §21 MONEY QA ===');
  const negDeposit = await prisma.apartmentRentHistory.count({ where: { lawdCd: { in: BUSAN_LAWDCD }, dealYmd: { gte: FROM, lte: TO }, deposit: { lt: 0 } } });
  const negRent = await prisma.apartmentRentHistory.count({ where: { lawdCd: { in: BUSAN_LAWDCD }, dealYmd: { gte: FROM, lte: TO }, monthlyRent: { lt: 0 } } });
  const jeonseWithRent = await prisma.apartmentRentHistory.count({ where: { lawdCd: { in: BUSAN_LAWDCD }, dealYmd: { gte: FROM, lte: TO }, dealType: 'jeonse', monthlyRent: { not: 0 } } });
  const wolseZeroRent = await prisma.apartmentRentHistory.count({ where: { lawdCd: { in: BUSAN_LAWDCD }, dealYmd: { gte: FROM, lte: TO }, dealType: 'wolse', monthlyRent: { lte: 0 } } });
  const wolseZeroDeposit = await prisma.apartmentRentHistory.count({ where: { lawdCd: { in: BUSAN_LAWDCD }, dealYmd: { gte: FROM, lte: TO }, dealType: 'wolse', deposit: 0 } });
  console.log(`deposit<0(기대값 0): ${negDeposit}, monthlyRent<0(기대값 0): ${negRent}`);
  console.log(`jeonse인데 monthlyRent!=0(기대값 0): ${jeonseWithRent}`);
  console.log(`wolse인데 monthlyRent<=0(기대값 0): ${wolseZeroRent}`);
  console.log(`wolse 중 deposit=0(순수월세, edge case 허용, 참고치): ${wolseZeroDeposit}`);

  console.log('\n=== §24 DATE QA ===');
  const dateMismatch: { cnt: bigint }[] = await prisma.$queryRaw`
    SELECT COUNT(*) as cnt FROM apartment_rent_histories
    WHERE lawd_cd = ANY(${BUSAN_LAWDCD}) AND deal_ymd >= ${FROM} AND deal_ymd <= ${TO}
    AND (EXTRACT(YEAR FROM deal_date) != deal_year OR EXTRACT(MONTH FROM deal_date) != deal_month OR EXTRACT(DAY FROM deal_date) != deal_day)`;
  console.log(`deal_date와 deal_year/month/day 불일치(기대값 0): ${dateMismatch[0].cnt}`);

  console.log('\n=== §25 FLOOR QA ===');
  const nullFloor = await prisma.apartmentRentHistory.count({ where: { lawdCd: { in: BUSAN_LAWDCD }, dealYmd: { gte: FROM, lte: TO }, floor: null } });
  console.log(`floor NULL row(기대값 0, MISSING_FLOOR는 정규화 단계에서 blocked): ${nullFloor}`);

  console.log('\n=== §26 STORAGE ===');
  const sizeRows: { table_size: string; index_size: string; total_size: string }[] = await prisma.$queryRaw`
    SELECT pg_size_pretty(pg_relation_size('apartment_rent_histories')) as table_size,
           pg_size_pretty(pg_indexes_size('apartment_rent_histories')) as index_size,
           pg_size_pretty(pg_total_relation_size('apartment_rent_histories')) as total_size`;
  console.log(sizeRows[0]);

  console.log('\n=== §20 SOURCE VS DB (대표 5개구) ===');
  const sampleDistricts = [
    { code: '26140', name: '서구' },
    { code: '26350', name: '해운대구' },
    { code: '26230', name: '부산진구' },
    { code: '26260', name: '동래구' },
    { code: '26710', name: '기장군' },
  ];
  const sampleMonth = '202607';
  for (const d of sampleDistricts) {
    const fetchResult = await fetchRentRegionMonth(d.code, sampleMonth);
    const { rows, invalid } = normalizeMolitRentItemsToRentRows(fetchResult.items, d.code, sampleMonth);
    const dbCount = await prisma.apartmentRentHistory.count({ where: { lawdCd: d.code, dealYmd: sampleMonth } });
    console.log(`${d.name}(${d.code}) ${sampleMonth}: MOLIT fetched=${fetchResult.collectedCount} normalized=${rows.length} invalid=${invalid.length} DB stored=${dbCount} mismatch=${rows.length !== dbCount ? 'YES' : 'no'}`);
  }

  console.log('\n=== §39 SAMPLE DATA CHECK (30 contracts, 서구 202607) ===');
  const sample30 = await prisma.apartmentRentHistory.findMany({
    where: { lawdCd: '26140', dealYmd: '202607' },
    take: 30,
    select: { dealType: true, deposit: true, monthlyRent: true, contractType: true, useRenewalRight: true, preDeposit: true, preMonthlyRent: true, aptSeq: true, floor: true, exclusiveArea: true, dealDate: true },
  });
  let jeonseN = 0, wolseN = 0, depositZeroWolse = 0, renewalN = 0, prevPresentN = 0, prevNullN = 0;
  const uniqueAptSeqsSample = new Set(sample30.map((r) => r.aptSeq));
  for (const r of sample30) {
    if (r.dealType === 'jeonse') jeonseN++; else wolseN++;
    if (r.dealType === 'wolse' && r.deposit === 0) depositZeroWolse++;
    if (r.useRenewalRight === true) renewalN++;
    if (r.preDeposit !== null || r.preMonthlyRent !== null) prevPresentN++;
    if (r.preDeposit === null && r.preMonthlyRent === null) prevNullN++;
  }
  const masters30 = await prisma.apartmentMaster.findMany({ where: { aptSeq: { in: [...uniqueAptSeqsSample] as string[] } }, select: { aptSeq: true } });
  const matchedSet30 = new Set(masters30.map((m) => m.aptSeq));
  const unmatchedInSample = [...uniqueAptSeqsSample].filter((s) => s && !matchedSet30.has(s)).length;
  console.log(`샘플 ${sample30.length}건: jeonse=${jeonseN} wolse=${wolseN} deposit=0 wolse(edge)=${depositZeroWolse} renewalRight=true=${renewalN} previous값 present=${prevPresentN} previous값 all-null=${prevNullN} unmatched aptSeq 포함=${unmatchedInSample}`);

  console.log('\n=== §37 DASHBOARD SQL PREVIEW (raw materialization 없이 aggregate만) ===');
  const t0 = Date.now();
  const preview: { lawd_cd: string; deal_type: string; cnt: bigint; avg_deposit: number }[] = await prisma.$queryRaw`
    SELECT lawd_cd, deal_type, COUNT(*) as cnt, AVG(deposit)::float as avg_deposit
    FROM apartment_rent_histories
    WHERE lawd_cd = ANY(${BUSAN_LAWDCD}) AND deal_ymd >= ${FROM} AND deal_ymd <= ${TO}
    GROUP BY lawd_cd, deal_type
    ORDER BY lawd_cd, deal_type`;
  const t1 = Date.now();
  console.log(`SQL aggregate 실행시간: ${t1 - t0}ms, 반환된 row(그룹) 수: ${preview.length} (raw materialization 아님, GROUP BY 결과만)`);
  console.log(preview.slice(0, 6));

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
