import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });
process.env.NEXT_PUBLIC_SEOUL_25_BETA_PREVIEW = 'true';

import { prisma } from '../src/lib/prisma';
import {
  SEOUL_RENT_SYNC_LAWDCDS_A,
  SEOUL_RENT_SYNC_LAWDCDS_B,
  SEOUL_RENT_SYNC_LAWDCDS_C,
} from '../src/lib/sync/rent-sync-scope';
import { SEOUL_DISTRICT_NAMES } from './seoul-rent-backfill/seoul-rent-backfill-engine';
import { GET as getFeed } from '../src/app/api/stats/feed/route';

interface DistrictStat {
  shard: 'seoul-a' | 'seoul-b' | 'seoul-c';
  lawdCd: string;
  name: string;
  dbTotal: number;
  dbJeonse: number;
  dbWolse: number;
  feed12mTotal: number;
  feed12mVerified: number;
  feed12mCancelled: number;
  feed12mSale: number;
  feed12mJeonse: number;
  feed12mWolse: number;
}

async function main() {
  console.log('=== E-JIP 서울 V4.4 샤드 원천 정의 기준 25개 구 정합 집계 (1,994건 취소 거래 분리 반영) ===\n');

  const shards: Array<{ shard: 'seoul-a' | 'seoul-b' | 'seoul-c'; codes: readonly string[] }> = [
    { shard: 'seoul-a', codes: SEOUL_RENT_SYNC_LAWDCDS_A },
    { shard: 'seoul-b', codes: SEOUL_RENT_SYNC_LAWDCDS_B },
    { shard: 'seoul-c', codes: SEOUL_RENT_SYNC_LAWDCDS_C },
  ];

  const results: DistrictStat[] = [];

  for (const { shard, codes } of shards) {
    for (const code of codes) {
      const name = SEOUL_DISTRICT_NAMES[code] || code;

      // 1. Raw DB count
      const dbRentRows = await prisma.apartmentRentHistory.findMany({
        where: { lawdCd: code },
        select: { dealType: true },
      });
      const dbTotal = dbRentRows.length;
      let dbJeonse = 0;
      let dbWolse = 0;
      for (const r of dbRentRows) {
        if (r.dealType === 'jeonse') dbJeonse++;
        else if (r.dealType === 'wolse') dbWolse++;
      }

      // 2. 12m Rolling Feed API
      const req = new Request(`http://localhost:3000/api/stats/feed?lawdCd=${code}&period=12m`);
      const res = await getFeed(req);
      const json = await res.json();
      const s = json.summary || {};
      const feed12mTotal = s.totalCount ?? 0;
      const feed12mVerified = s.verifiedCount ?? 0;
      const feed12mCancelled = s.cancelledCount ?? 0;
      const feed12mSale = s.byDealType?.sale ?? 0;
      const feed12mJeonse = s.byDealType?.jeonse ?? 0;
      const feed12mWolse = s.byDealType?.wolse ?? 0;

      results.push({
        shard,
        lawdCd: code,
        name,
        dbTotal,
        dbJeonse,
        dbWolse,
        feed12mTotal,
        feed12mVerified,
        feed12mCancelled,
        feed12mSale,
        feed12mJeonse,
        feed12mWolse,
      });

      console.log(`[${shard}] ${name}(${code}): DB 총 ${dbTotal.toLocaleString()}건 (전세 ${dbJeonse.toLocaleString()}, 월세 ${dbWolse.toLocaleString()}) | 12m 피드: 유효 ${feed12mVerified.toLocaleString()}건 (매매 ${feed12mSale.toLocaleString()}, 전세 ${feed12mJeonse.toLocaleString()}, 월세 ${feed12mWolse.toLocaleString()}) + 취소 ${feed12mCancelled.toLocaleString()}건 = 총 ${feed12mTotal.toLocaleString()}건`);
    }
  }

  // Print Markdown Table
  console.log('\n--- MARKDOWN OUTPUT ---\n');
  console.log('| 샤드 | 자치구명 | 법정동코드 | DB 전월세 총건수 | DB 전세 | DB 월세 | 12m 피드 유효 합계 | 12m 피드 매매 | 12m 피드 전세 | 12m 피드 월세 | 12m 피드 취소 | 12m 피드 전체 총계 |');
  console.log('| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |');

  let currentShard = '';
  let subDbTotal = 0;
  let subDbJeonse = 0;
  let subDbWolse = 0;
  let subFeedTotal = 0;
  let subFeedVerified = 0;
  let subFeedCancelled = 0;
  let subFeedSale = 0;
  let subFeedJeonse = 0;
  let subFeedWolse = 0;

  let grandDbTotal = 0;
  let grandDbJeonse = 0;
  let grandDbWolse = 0;
  let grandFeedTotal = 0;
  let grandFeedVerified = 0;
  let grandFeedCancelled = 0;
  let grandFeedSale = 0;
  let grandFeedJeonse = 0;
  let grandFeedWolse = 0;

  for (const r of results) {
    if (currentShard && currentShard !== r.shard) {
      console.log(`| **${currentShard} 소계** | **${currentShard === 'seoul-a' ? '8개 구' : currentShard === 'seoul-b' ? '9개 구' : '8개 구'}** | - | **${subDbTotal.toLocaleString()}건** | **${subDbJeonse.toLocaleString()}건** | **${subDbWolse.toLocaleString()}건** | **${subFeedVerified.toLocaleString()}건** | **${subFeedSale.toLocaleString()}건** | **${subFeedJeonse.toLocaleString()}건** | **${subFeedWolse.toLocaleString()}건** | **${subFeedCancelled.toLocaleString()}건** | **${subFeedTotal.toLocaleString()}건** |`);
      subDbTotal = 0;
      subDbJeonse = 0;
      subDbWolse = 0;
      subFeedTotal = 0;
      subFeedVerified = 0;
      subFeedCancelled = 0;
      subFeedSale = 0;
      subFeedJeonse = 0;
      subFeedWolse = 0;
    }
    currentShard = r.shard;
    subDbTotal += r.dbTotal;
    subDbJeonse += r.dbJeonse;
    subDbWolse += r.dbWolse;
    subFeedTotal += r.feed12mTotal;
    subFeedVerified += r.feed12mVerified;
    subFeedCancelled += r.feed12mCancelled;
    subFeedSale += r.feed12mSale;
    subFeedJeonse += r.feed12mJeonse;
    subFeedWolse += r.feed12mWolse;

    grandDbTotal += r.dbTotal;
    grandDbJeonse += r.dbJeonse;
    grandDbWolse += r.dbWolse;
    grandFeedTotal += r.feed12mTotal;
    grandFeedVerified += r.feed12mVerified;
    grandFeedCancelled += r.feed12mCancelled;
    grandFeedSale += r.feed12mSale;
    grandFeedJeonse += r.feed12mJeonse;
    grandFeedWolse += r.feed12mWolse;

    console.log(`| ${r.shard} | ${r.name} | \`${r.lawdCd}\` | ${r.dbTotal.toLocaleString()}건 | ${r.dbJeonse.toLocaleString()}건 | ${r.dbWolse.toLocaleString()}건 | ${r.feed12mVerified.toLocaleString()}건 | ${r.feed12mSale.toLocaleString()}건 | ${r.feed12mJeonse.toLocaleString()}건 | ${r.feed12mWolse.toLocaleString()}건 | ${r.feed12mCancelled.toLocaleString()}건 | ${r.feed12mTotal.toLocaleString()}건 |`);
  }
  // Last shard subtotal
  console.log(`| **${currentShard} 소계** | **8개 구** | - | **${subDbTotal.toLocaleString()}건** | **${subDbJeonse.toLocaleString()}건** | **${subDbWolse.toLocaleString()}건** | **${subFeedVerified.toLocaleString()}건** | **${subFeedSale.toLocaleString()}건** | **${subFeedJeonse.toLocaleString()}건** | **${subFeedWolse.toLocaleString()}건** | **${subFeedCancelled.toLocaleString()}건** | **${subFeedTotal.toLocaleString()}건** |`);

  // Grand Total
  console.log(`| **서울 전체 합계** | **25개 구** | - | **${grandDbTotal.toLocaleString()}건** | **${grandDbJeonse.toLocaleString()}건** | **${grandDbWolse.toLocaleString()}건** | **${grandFeedVerified.toLocaleString()}건** | **${grandFeedSale.toLocaleString()}건** | **${grandFeedJeonse.toLocaleString()}건** | **${grandFeedWolse.toLocaleString()}건** | **${grandFeedCancelled.toLocaleString()}건** | **${grandFeedTotal.toLocaleString()}건** |`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
