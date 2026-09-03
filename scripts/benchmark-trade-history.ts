/**
 * TRADE_HISTORY_DATA_V1 — §35/§36 PERFORMANCE BENCHMARK. 같은 질의를 (A) 기존 라이브
 * MOLIT 재조회 경로(src/lib/molit-stats-helpers.ts의 실제 라이브 헬퍼, 동시 6 +
 * 200ms pacing — 실제 프로덕션이 쓰는 것과 동일)와 (B) 새 DB 이력 조회로 각각 실행해
 * 실측 wall-clock 시간을 비교한다. 추정치를 쓰지 않는다(실제 fetch 실행). DB에 쓰지
 * 않는다(읽기 전용).
 *
 * backfill이 완료된 뒤 실행할 것. 라이브 쪽은 실제 프로덕션 헬퍼를 그대로 쓰므로
 * data.go.kr 요청제한에 걸리지 않도록 각 시나리오 사이에 대기를 둔다.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { PrismaClient } from '@prisma/client';
import { fetchMonthsThrottledWithStatus, type MonthTask } from '../src/lib/molit-stats-helpers';
import { getSigunguListForSido } from '../src/lib/region-utils';
import { assertProductionDbAccessAllowed } from './_prod-db-guard';

const prisma = new PrismaClient();

function monthsBack(n: number, endYmd?: string): string[] {
  const end = endYmd ? new Date(parseInt(endYmd.slice(0, 4)), parseInt(endYmd.slice(4, 6)) - 1, 1) : new Date();
  const months: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end.getFullYear(), end.getMonth() - i, 1);
    months.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

async function time<T>(label: string, fn: () => Promise<T>): Promise<{ ms: number; result: T }> {
  const start = Date.now();
  const result = await fn();
  const ms = Date.now() - start;
  console.log(`  [${label}] ${ms}ms`);
  return { ms, result };
}

async function scenario1_aptHistory() {
  console.log('\n=== 1. 대신롯데캐슬(26140-1164) 84㎡ 전체 이력 ===');
  const aptSeq = '26140-1164';
  const row = await prisma.apartmentTradeHistory.findFirst({ where: { aptSeq, exclusiveArea: { gte: 84, lt: 85 } } });
  if (!row) {
    console.log('  DB에 84㎡대 거래 없음 — 스킵');
    return;
  }
  const area = row.exclusiveArea;

  const db = await time('DB 이력 조회(전체 기간, exact area)', async () =>
    prisma.apartmentTradeHistory.findMany({ where: { aptSeq, exclusiveArea: area, dealType: 'sale' }, orderBy: { dealDate: 'asc' } })
  );

  // 라이브 MOLIT 비교는 §33 원칙상 24개월 lookback만 실제 서비스가 조회하는 범위이므로
  // 그 범위로 동일하게 맞춰 공정 비교한다(DB는 전체 기간 vs 라이브는 24개월 — 이 차이
  // 자체가 §36 EXPECTED BENEFIT의 핵심).
  const months = monthsBack(24);
  const tasks: MonthTask[] = months.map((m) => ({ key: m, lawdCd: '26140', dealYmd: m, type: 'apt' }));
  const live = await time('라이브 MOLIT 재조회(24개월, 서구 전체 재조회 후 클라이언트 필터)', async () => fetchMonthsThrottledWithStatus(tasks));

  console.log(`  DB rows(전체 기간)=${db.result.length}, 라이브 24개월 fetch 성공=${Object.values(live.result).filter((r) => !r.failed).length}/${months.length}`);
}

async function scenario2_seoguRecent(months: number) {
  console.log(`\n=== 2. 부산 서구(26140) 최근 ${months}개월 ===`);
  const from = new Date();
  from.setMonth(from.getMonth() - months);

  const db = await time('DB 지역+기간 조회', async () =>
    prisma.apartmentTradeHistory.findMany({ where: { lawdCd: '26140', dealDate: { gte: from } } })
  );

  const monthList = monthsBack(months);
  const tasks: MonthTask[] = monthList.map((m) => ({ key: m, lawdCd: '26140', dealYmd: m, type: 'apt' }));
  const live = await time('라이브 MOLIT 재조회', async () => fetchMonthsThrottledWithStatus(tasks));

  console.log(`  DB rows=${db.result.length}, 라이브 fetch 성공=${Object.values(live.result).filter((r) => !r.failed).length}/${monthList.length}`);
}

async function scenario3_busanWide(months: number) {
  console.log(`\n=== 3. 부산 전체 16개 구 최근 ${months}개월 ===`);
  const regions = (await getSigunguListForSido('26')).map((r) => r.code.substring(0, 5));
  const from = new Date();
  from.setMonth(from.getMonth() - months);

  const db = await time('DB 지역+기간 조회(IN 16개 구)', async () =>
    prisma.apartmentTradeHistory.findMany({ where: { lawdCd: { in: regions }, dealDate: { gte: from } } })
  );

  const monthList = monthsBack(months);
  const tasks: MonthTask[] = [];
  for (const lawdCd of regions) for (const m of monthList) tasks.push({ key: `${lawdCd}:${m}`, lawdCd, dealYmd: m, type: 'apt' });
  const live = await time(`라이브 MOLIT 재조회(${tasks.length}건 region-month)`, async () => fetchMonthsThrottledWithStatus(tasks));

  console.log(`  DB rows=${db.result.length}, 라이브 fetch 성공=${Object.values(live.result).filter((r) => !r.failed).length}/${tasks.length}`);
}

async function scenario4_area84Input() {
  console.log('\n=== 4. 84㎡ 순위 입력(부산 전체, 24개월) ===');
  const regions = (await getSigunguListForSido('26')).map((r) => r.code.substring(0, 5));
  const from = new Date();
  from.setMonth(from.getMonth() - 24);

  const db = await time('DB 84㎡ band + 24개월 조회', async () =>
    prisma.apartmentTradeHistory.findMany({
      where: { lawdCd: { in: regions }, dealDate: { gte: from }, exclusiveArea: { gte: 84, lt: 85 }, dealCanceled: false },
    })
  );
  console.log(`  DB rows=${db.result.length} (기존 라이브 경로는 84㎡ 필터 전 전체 24개월 fetch가 필요 — scenario 3과 동일한 fetch 비용을 공유하므로 별도 재실행하지 않음)`);
}

async function main() {
  // SUPABASE_EGRESS_P0_FIX_V1 §3 — 이 스크립트는 DIAGNOSTIC(QA/benchmark)이라
  // Production DB에 대해서는 기본 차단된다(ALLOW_PROD_DB_READ=1로만 해제).
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'benchmark-trade-history.ts');
  await scenario1_aptHistory();
  await new Promise((r) => setTimeout(r, 2000));
  await scenario2_seoguRecent(12);
  await new Promise((r) => setTimeout(r, 2000));
  await scenario3_busanWide(12);
  await new Promise((r) => setTimeout(r, 2000));
  await scenario4_area84Input();
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
