/**
 * TRADE_HISTORY_DATA_V1 — 최근 실거래 rolling refresh(§39/§40/§41).
 *
 * 과거 backfill만 하고 끝내면 데이터가 다시 오래된다. 실거래는 신고 지연/취소/정정이
 * 존재해서(§40) 오늘 하루만 재조회해서는 부족하다 — 최근 N개월을 계속 다시 훑어야
 * 늦게 등록된 거래나 새로 취소된 거래를 반영할 수 있다.
 *
 * backfill-trade-history.ts의 runTradeHistoryJob()을 그대로 재사용한다(로직 중복
 * 없음) — 유일한 차이는 (a) from/to를 "최근 N개월"로 자동 계산하고, (b) resume을 항상
 * false로 강제한다는 점이다(최근 구간은 manifest가 SUCCESS여도 매번 다시 확인해야
 * 늦은 신고/취소를 잡아낼 수 있음 — backfill의 resume=건너뛰기 의미와 반대).
 *
 * 사용법:
 *   # 최근 3개월(기본) 부산 전체 dry-run
 *   npx ts-node --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js scripts/sync-trade-history.ts
 *
 *   # 실제 반영, 최근 2개월만
 *   ... scripts/sync-trade-history.ts --apply --months=2
 *
 *   # 특정 구만
 *   ... scripts/sync-trade-history.ts --apply --lawdCd=26140
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { runTradeHistoryJob, makeLogger, prisma, type TradeHistoryJobOptions } from './backfill-trade-history';

// §40 LATE REPORTING — 실거래 신고는 계약일로부터 최대 30일 이내(공인중개사 경유) ~
// 60일(직거래, 2026년 기준 제도)까지 지연될 수 있고, 취소/정정도 그 이후 발생할 수
// 있다. 3개월 rolling window면 신고 지연과 취소 반영 모두 여유 있게 커버된다(월
// 단위로만 조회 가능한 MOLIT 특성상 이번 달+지난달+지지난달 재조회).
const DEFAULT_ROLLING_MONTHS = 3;

function parseArgs() {
  const args = process.argv.slice(2);
  const has = (flag: string) => args.includes(flag);
  const get = (flag: string) => {
    const prefix = `${flag}=`;
    const hit = args.find((a) => a.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : undefined;
  };
  return {
    apply: has('--apply'),
    sido: get('--sido') || '26',
    lawdCdFilter: get('--lawdCd') ? get('--lawdCd')!.split(',').map((s) => s.trim()) : undefined,
    months: get('--months') ? parseInt(get('--months')!, 10) : DEFAULT_ROLLING_MONTHS,
  };
}

function recentMonths(n: number, now = new Date()): { from: string; to: string } {
  const to = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const fromDate = new Date(now.getFullYear(), now.getMonth() - (n - 1), 1);
  const from = `${fromDate.getFullYear()}${String(fromDate.getMonth() + 1).padStart(2, '0')}`;
  return { from, to };
}

async function main() {
  const args = parseArgs();
  const { from, to } = recentMonths(args.months);
  const opts: TradeHistoryJobOptions = {
    apply: args.apply,
    resume: false, // 최근 구간은 항상 재확인(늦은 신고/취소 반영, 위 주석 참고)
    sido: args.sido,
    lawdCdFilter: args.lawdCdFilter,
    from,
    to,
    maxBatches: Infinity,
  };
  const log = makeLogger(path.resolve(__dirname, '_sync_trade_history_results'));
  log(`SYNC rolling window months=${args.months} (${from}~${to})`);
  await runTradeHistoryJob(opts, log);
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
