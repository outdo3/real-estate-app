/**
 * STEP SCORE S2B — ApartmentMarketFeature 실제 수집(MOLIT). §19 지시대로 아파트마다
 * 개별 호출하지 않고 구·군+월 단위로 호출한다(fetchMolitData 재사용).
 *
 * priceChange12m은 이번 STEP에서 계산하지 않는다 — 12개월치만 수집하는 pilot
 * 범위에서는 "12개월 전 대비" 비교에 필요한 이전 기준선(t-24~t-12) 데이터가 없다.
 * 거래 1건으로 증감률을 계산하는 것과 같은 성격의 무리한 통계이므로 null로 남기고
 * S2C에 EXTERNAL_VERIFICATION_REQUIRED로 넘긴다(§20 12개월 우선 허용, §24 최소 표본
 * 원칙).
 *
 * 사용법:
 *   npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js scripts/apartment-score/collect-market-features.ts [--dry-run]
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { prisma } from '@/lib/prisma';
import { fetchRegionMonthTrades, aggregateByAptSeq, recentMonths, type MolitTradeRaw } from '@/lib/apartment-score/collectors/market';

const REGIONS = [
  { label: '서구', lawdCd: '26140' },
  { label: '해운대', lawdCd: '26350' },
];
const MONTHS_BACK = 12;

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const months = recentMonths(new Date(), MONTHS_BACK);

  console.log(`=== S2B Market Feature Collection ===`);
  console.log(`regions: ${REGIONS.map((r) => r.label).join(', ')}`);
  console.log(`months (${months.length}): ${months[months.length - 1]} ~ ${months[0]}`);
  console.log(`estimated MOLIT calls: ${REGIONS.length * months.length}`);

  if (dryRun) {
    console.log('--dry-run: no API calls, no DB writes.');
    return;
  }

  let totalCalls = 0;
  let failedCalls = 0;
  const allTrades: MolitTradeRaw[] = [];
  let totalRawItems = 0;
  let areaNonNull = 0;
  let priceNonNull = 0;

  for (const region of REGIONS) {
    for (const dealYmd of months) {
      totalCalls++;
      const { ok, trades, errorDetail } = await fetchRegionMonthTrades(region.lawdCd, dealYmd);
      if (!ok) {
        failedCalls++;
        console.error(`[FAIL] ${region.label} ${dealYmd}: ${errorDetail}`);
        continue;
      }
      totalRawItems += trades.length;
      areaNonNull += trades.filter((t) => t.excluUseArea != null && t.excluUseArea > 0).length;
      priceNonNull += trades.filter((t) => t.dealAmount > 0).length;
      allTrades.push(...trades);
    }
  }

  console.log(`\n=== MOLIT raw coverage ===`);
  console.log(`total calls: ${totalCalls}, failed: ${failedCalls}`);
  console.log(`total raw trade rows: ${totalRawItems}`);
  console.log(`area(excluUseArea) non-null: ${areaNonNull} (${totalRawItems ? ((areaNonNull / totalRawItems) * 100).toFixed(1) : 0}%)`);
  console.log(`price(dealAmount) non-null: ${priceNonNull} (${totalRawItems ? ((priceNonNull / totalRawItems) * 100).toFixed(1) : 0}%)`);
  const aptSeqNonNull = allTrades.filter((t) => t.aptSeq != null).length;
  console.log(`aptSeq non-null: ${aptSeqNonNull} (${totalRawItems ? ((aptSeqNonNull / totalRawItems) * 100).toFixed(1) : 0}%)`);

  const aggregated = aggregateByAptSeq(allTrades);
  console.log(`\naptSeq groups with matched trades: ${aggregated.size}`);

  // ApartmentMaster에 실제 존재하는 aptSeq만 upsert — MOLIT aptSeq가 오탈자/구버전이라
  // ApartmentMaster와 매칭되지 않는 값을 그대로 저장하지 않는다(§23 AMBIGUOUS skip 원칙).
  const knownAptSeqs = new Set(
    (
      await prisma.apartmentMaster.findMany({
        where: { sggCd: { in: REGIONS.map((r) => r.lawdCd) }, aptSeq: { not: null } },
        select: { aptSeq: true },
      })
    ).map((m) => m.aptSeq as string)
  );

  let upserted = 0;
  let skippedUnknownAptSeq = 0;
  const fetchedAt = new Date();
  const validUntil = new Date(fetchedAt.getTime() + 7 * 24 * 60 * 60 * 1000); // 시세는 위치보다 자주 바뀌므로 7일

  for (const [aptSeq, agg] of aggregated) {
    if (!knownAptSeqs.has(aptSeq)) {
      skippedUnknownAptSeq++;
      continue;
    }
    await prisma.apartmentMarketFeature.upsert({
      where: { aptSeq },
      create: {
        aptSeq,
        latestTradePrice: agg.latestTradePrice,
        latestTradeDate: agg.latestTradeDate ? new Date(agg.latestTradeDate) : null,
        medianPricePerM2_12m: agg.medianPricePerM2_12m,
        transactionCount12m: agg.transactionCount12m,
        priceChange12m: null,
        source: 'molit',
        fetchedAt,
        validUntil,
        qualityFlag: 'complete',
      },
      update: {
        latestTradePrice: agg.latestTradePrice,
        latestTradeDate: agg.latestTradeDate ? new Date(agg.latestTradeDate) : null,
        medianPricePerM2_12m: agg.medianPricePerM2_12m,
        transactionCount12m: agg.transactionCount12m,
        priceChange12m: null,
        fetchedAt,
        validUntil,
        qualityFlag: 'complete',
      },
    });
    upserted++;
  }

  console.log(`\nupserted ApartmentMarketFeature rows: ${upserted}`);
  console.log(`skipped (aptSeq not found in target ApartmentMaster set): ${skippedUnknownAptSeq}`);

  // 샘플 5개
  const samples = [...aggregated.entries()].filter(([seq]) => knownAptSeqs.has(seq)).slice(0, 5);
  console.log('\n=== Samples ===');
  for (const [aptSeq, agg] of samples) {
    console.log(JSON.stringify(agg));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
