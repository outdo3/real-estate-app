/**
 * TRADE_DB_FIRST_V1 STEP A — Production DB 실측 QA + benchmark for
 * src/lib/trade-history-read.ts의 queryTrades() (신규 general read core).
 * Read-only, DB write 없음. §24/§25 test case를 실제 Production 데이터로 검증한다.
 *
 * Usage: npx ts-node --compiler-options '{"module":"commonjs"}' scripts/qa-trade-history-read-core.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { prisma } from '../src/lib/prisma';
import { queryTrades, TradeQueryValidationError } from '../src/lib/trade-history-read';

let passCount = 0;
let failCount = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passCount++;
    console.log(`  PASS ${label}`);
  } else {
    failCount++;
    console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`);
  }
}

async function time<T>(label: string, fn: () => Promise<T>): Promise<{ ms: number; result: T }> {
  const start = Date.now();
  const result = await fn();
  const ms = Date.now() - start;
  console.log(`  [${label}] ${ms}ms`);
  return { ms, result };
}

const BUSAN_LAWD_CODES = [
  '26110', '26140', '26170', '26200', '26230', '26260', '26290', '26320',
  '26350', '26380', '26410', '26440', '26470', '26500', '26530', '26710',
];

async function main() {
  console.log('TRADE_DB_FIRST_V1 STEP A — Read Core QA + Benchmark\n');

  // 실제 Production에서 거래가 많은 aptSeq 하나를 동적으로 찾는다(하드코딩 대신 —
  // 특정 단지 전용 로직 금지 원칙과 동일하게, 이 QA 스크립트도 임의 단지에 결합하지 않음).
  const sample = await prisma.apartmentTradeHistory.groupBy({
    by: ['aptSeq'],
    where: { lawdCd: { in: BUSAN_LAWD_CODES }, dealType: 'sale', dealCanceled: false, aptSeq: { not: null } },
    _count: { _all: true },
    orderBy: { _count: { aptSeq: 'desc' } },
    take: 1,
  });
  const sampleAptSeq = sample[0]?.aptSeq;
  if (!sampleAptSeq) {
    console.log('샘플 aptSeq를 찾지 못함 — QA 중단');
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log(`샘플 aptSeq(최다 거래): ${sampleAptSeq} (${sample[0]._count._all}건)\n`);

  // ===== A. 단일 aptSeq =====
  console.log('=== A. 단일 aptSeq ===');
  const a = await queryTrades({ aptSeq: sampleAptSeq });
  check('A: 결과가 반환됨', a.trades.length > 0, `count=${a.trades.length}`);
  check('A: 모든 row가 요청한 aptSeq', a.trades.every((t) => t.aptSeq === sampleAptSeq));
  check('A: meta.dataSource=DB', a.meta.dataSource === 'DB');

  // ===== B. 취소 거래 제외(기본) =====
  console.log('\n=== B. 취소 거래 기본 제외 ===');
  const cancelSample = await prisma.apartmentTradeHistory.findFirst({
    where: { lawdCd: { in: BUSAN_LAWD_CODES }, dealCanceled: true, aptSeq: { not: null } },
  });
  if (cancelSample) {
    const b1 = await queryTrades({ aptSeq: cancelSample.aptSeq! });
    check('B: 기본 쿼리에 취소 row 없음', b1.trades.every((t) => !t.dealCanceled));
    const b2 = await queryTrades({ aptSeq: cancelSample.aptSeq!, includeCanceled: true });
    check('B: includeCanceled:true면 취소 row가 나타남', b2.trades.some((t) => t.id === cancelSample.id));
  } else {
    console.log('  SKIP (Production에 취소 거래 샘플 없음)');
  }

  // ===== C. 기간 필터 =====
  console.log('\n=== C. 기간 필터 ===');
  const from = new Date('2026-01-01T00:00:00.000Z');
  const to = new Date('2026-06-30T00:00:00.000Z');
  const c = await queryTrades({ aptSeq: sampleAptSeq, from, to });
  check('C: 범위 밖 row 없음', c.trades.every((t) => t.dealDate >= from && t.dealDate <= to));

  // ===== D. 전용면적 filter =====
  console.log('\n=== D. 전용면적 filter ===');
  const anyRow = await prisma.apartmentTradeHistory.findFirst({
    where: { lawdCd: { in: BUSAN_LAWD_CODES }, dealCanceled: false },
  });
  if (anyRow) {
    const exactArea = Number(anyRow.exclusiveArea);
    const d1 = await queryTrades({ aptSeq: anyRow.aptSeq ?? undefined, identity: anyRow.aptSeq ? undefined : { aptSeq: null, name: anyRow.aptName, dong: anyRow.dong }, exclusiveArea: exactArea });
    check('D: exact area 결과에 원본 row 포함', d1.trades.some((t) => t.id === anyRow.id), `exactArea=${exactArea}`);
  }
  const d2 = await queryTrades({ lawdCd: BUSAN_LAWD_CODES, exclusiveAreaRange: { gte: 84, lt: 85 }, limit: 100 });
  check('D-2: 84㎡대 range filter가 전부 84<=x<85', d2.trades.every((t) => {
    const n = Number(t.exclusiveArea);
    return n >= 84 && n < 85;
  }), `count=${d2.trades.length}`);

  // ===== E. 지역 filter =====
  console.log('\n=== E. 지역 filter ===');
  const e = await queryTrades({ lawdCd: '26140', limit: 200 });
  check('E: 모든 row가 lawdCd=26140', e.trades.every((t) => t.lawdCd === '26140'));
  const eMulti = await queryTrades({ lawdCd: ['26140', '26350'], limit: 200 });
  check('E-2: 다중 lawdCd IN 쿼리가 두 지역만 포함', eMulti.trades.every((t) => t.lawdCd === '26140' || t.lawdCd === '26350'));

  // ===== F. empty / no fallback =====
  console.log('\n=== F. empty / no fallback ===');
  const f = await queryTrades({ aptSeq: 'NONEXISTENT-AVOID-COLLISION-99999' });
  check('F: 존재하지 않는 aptSeq는 빈 배열', f.trades.length === 0);
  check('F: meta.returnedCount=0', f.meta.returnedCount === 0);
  check('F: meta.latestDealDate=null', f.meta.latestDealDate === null);

  // ===== F-2. 필수 scoping 없는 호출은 검증 에러 =====
  let threw = false;
  try {
    await queryTrades({});
  } catch (e) {
    threw = e instanceof TradeQueryValidationError;
  }
  check('F-2: scoping 없는 쿼리는 TradeQueryValidationError', threw);

  // ===== G. deterministic ordering =====
  console.log('\n=== G. deterministic ordering ===');
  const g1 = await queryTrades({ aptSeq: sampleAptSeq });
  const g2 = await queryTrades({ aptSeq: sampleAptSeq });
  check('G: 같은 쿼리를 두 번 실행해도 동일 순서', JSON.stringify(g1.trades.map((t) => t.id)) === JSON.stringify(g2.trades.map((t) => t.id)));
  const isDescending = g1.trades.every((t, i) => i === 0 || g1.trades[i - 1].dealDate >= t.dealDate);
  check('G-2: 기본 정렬이 dealDate 내림차순', isDescending);

  // ===== H. bounded limit =====
  console.log('\n=== H. bounded limit ===');
  const h = await queryTrades({ lawdCd: BUSAN_LAWD_CODES, limit: 50 });
  check('H: limit=50이면 결과가 최대 50건', h.trades.length <= 50, `count=${h.trades.length}`);
  check('H: possiblyTruncated 플래그가 정확', h.meta.possiblyTruncated === (h.trades.length === 50));

  console.log(`\n=== QA RESULT: ${passCount} PASS / ${failCount} FAIL ===\n`);

  // ===== Production Benchmark =====
  console.log('########## PRODUCTION BENCHMARK ##########\n');

  console.log(`1. 단일 단지 최근 거래(${sampleAptSeq})`);
  await time('cold', async () => queryTrades({ aptSeq: sampleAptSeq, limit: 50 }));
  await time('warm', async () => queryTrades({ aptSeq: sampleAptSeq, limit: 50 }));

  console.log('\n2. 구 단위(서구 26140) 최근 12개월');
  const twelveMonthsAgo = new Date(Date.now() - 365 * 24 * 3600 * 1000);
  await time('cold', async () => queryTrades({ lawdCd: '26140', from: twelveMonthsAgo }));
  await time('warm', async () => queryTrades({ lawdCd: '26140', from: twelveMonthsAgo }));

  console.log('\n3. 부산 전체 16개 구 최근 12개월(84㎡대, STEP B 84㎡ 순위 입력 형태)');
  await time('cold', async () => queryTrades({ lawdCd: BUSAN_LAWD_CODES, from: twelveMonthsAgo, exclusiveAreaRange: { gte: 84, lt: 85 } }));
  await time('warm', async () => queryTrades({ lawdCd: BUSAN_LAWD_CODES, from: twelveMonthsAgo, exclusiveAreaRange: { gte: 84, lt: 85 } }));

  console.log('\n4. 부산 전체 16개 구 최근 12개월(전체, 거래량 STEP B 입력 형태 — 최대 부하)');
  await time('cold', async () => queryTrades({ lawdCd: BUSAN_LAWD_CODES, from: twelveMonthsAgo }));

  await prisma.$disconnect();
  if (failCount > 0) process.exit(1);
}

main().catch(async (e) => {
  console.error('FATAL:', e);
  await prisma.$disconnect();
  process.exit(1);
});
