/**
 * TRADE_REGISTRY_DATA_V1.1 §10 — controlled supervised APPLY (사용자 승인 완료).
 *
 * cron이 호출하는 것과 **완전히 같은 함수**(`syncOneSaleCell`)를 mode='apply'로 돌린다.
 * 판정/쓰기 로직을 복제하지 않는다 — 이 스크립트가 하는 일은 셀 목록을 정하고,
 * 안전 한계를 감시하고, 전후를 측정하는 것뿐이다.
 *
 * 범위: daily sale-sync와 동일한 정상 scope(latestComplete-2 ~ 현재월) × 부산 16구.
 *   - §10 금지사항 준수: 69,424행 historical backfill 아님(2023-01~2025-07은 건드리지 않는다).
 *   - coverage는 기록하지 않는다 — 이 실행은 검증 범위를 전진시키는 실행이 아니고,
 *     /admin/ops의 "daily 마지막 실행" runId를 사람 손 실행으로 덮어써서 무인 cron
 *     모니터링을 흐리지 않기 위함이다(ADMIN_OPS_V1.2에서 배운 것과 같은 원칙).
 *
 * 안전 한계: registryDate-only update 누계가 STOP_THRESHOLD를 넘으면 다음 셀을 시작하지
 * 않고 즉시 중단한다(감사 예상치 455건 대비 큰 이탈 감지).
 *
 * 사용법:
 *   ALLOW_PROD_DB_READ=1 npx ts-node --transpile-only \
 *     --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js scripts/trade-registry-data/registry-selfheal-apply.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { syncOneSaleCell, resolveSaleRange } from '../../src/lib/sync/sale-sync-core';
import { monthsInRange } from '../../src/lib/sync/shared';
import { BUSAN_LAWDCD_16 } from '../../src/lib/rent-verified-range';
import { prisma } from '../../src/lib/prisma';

const STOP_THRESHOLD = 1000;

const BUSAN_WHERE = { lawdCd: { in: [...BUSAN_LAWDCD_16] }, dealYmd: { gte: '202301' } };

async function measure() {
  const [nullActive, withValue, canceledWithValue] = await Promise.all([
    prisma.apartmentTradeHistory.count({ where: { ...BUSAN_WHERE, dealCanceled: false, registryDate: null } }),
    prisma.apartmentTradeHistory.count({ where: { ...BUSAN_WHERE, registryDate: { not: null } } }),
    prisma.apartmentTradeHistory.count({ where: { ...BUSAN_WHERE, dealCanceled: true, registryDate: { not: null } } }),
  ]);
  return { nullActive, withValue, canceledWithValue };
}

async function main() {
  console.log('TRADE REGISTRY DATA V1.1 — SUPERVISED APPLY\n');

  const { from, to, latestComplete } = resolveSaleRange({ mode: 'apply' });
  const months = monthsInRange(from, to);
  console.log(`scope: [${from}..${to}] latestComplete=${latestComplete} districts=${BUSAN_LAWDCD_16.length} cells=${BUSAN_LAWDCD_16.length * months.length}`);
  console.log('coverage는 기록하지 않는다(이 실행은 검증범위를 전진시키지 않는다).\n');

  const before = await measure();
  console.log('BEFORE:', JSON.stringify(before));

  const totals = { registryUpdated: 0, registryAmbiguousSkipped: 0, inserted: 0, updated: 0, blocked: 0, review: 0, cells: 0 };
  let stopped = false;

  for (const lawdCd of BUSAN_LAWDCD_16) {
    for (const dealYmd of months) {
      if (totals.registryUpdated > STOP_THRESHOLD) {
        console.error(`\n*** STOP — registryUpdated=${totals.registryUpdated} > ${STOP_THRESHOLD}. 남은 셀을 처리하지 않는다.`);
        stopped = true;
        break;
      }
      const r = await syncOneSaleCell(lawdCd, dealYmd, 'apply', (l) => console.log(`  ${l}`));
      totals.cells++;
      totals.registryUpdated += r.registryUpdated;
      totals.registryAmbiguousSkipped += r.registryAmbiguousSkipped;
      totals.inserted += r.inserted;
      totals.updated += r.updated;
      totals.blocked += r.blocked;
      totals.review += r.reviewCandidates;
    }
    if (stopped) break;
  }

  const after = await measure();
  console.log('\n================ RESULT ================');
  console.log(JSON.stringify({ ...totals, stopped }, null, 2));
  console.log('BEFORE:', JSON.stringify(before));
  console.log('AFTER :', JSON.stringify(after));
  console.log(JSON.stringify({
    nullActiveDelta: after.nullActive - before.nullActive,
    withValueDelta: after.withValue - before.withValue,
    canceledWithValueDelta: after.canceledWithValue - before.canceledWithValue,
    matchesReportedUpdates: after.withValue - before.withValue === totals.registryUpdated,
  }, null, 2));

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
