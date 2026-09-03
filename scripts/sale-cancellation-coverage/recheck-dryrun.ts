/**
 * SALE_CANCELLATION_COVERAGE_V1 — recheck sweep DRY-RUN (READ ONLY).
 *
 * cron route와 **완전히 같은 core**(`runSaleRecheckSweep`)를 mode='dry-run'으로 돌려
 * 다음을 확인한다:
 *   - band 계산 / least-recently-verified 정렬이 실제 DB coverage 위에서 동작하는가
 *   - 60초 Function 예산 안에서 몇 셀을 처리하는가(실측)
 *   - 예상 INSERT / cancellation flip 건수
 *
 * dry-run이므로 write는 구조적으로 발생하지 않는다:
 *   - syncOneSaleCell은 mode!=='apply'면 createMany/update를 호출하지 않는다
 *   - recordCoverageCells는 mode==='dry-run'이면 즉시 반환한다(이중 안전장치)
 *
 * 사용법:
 *   ALLOW_PROD_DB_READ=1 npx ts-node --transpile-only \
 *     --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js scripts/sale-cancellation-coverage/recheck-dryrun.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { runSaleRecheckSweep } from '../../src/lib/sync/sale-recheck-core';
import { prisma } from '../../src/lib/prisma';
import { assertProductionDbAccessAllowed } from '../_prod-db-guard';

async function main() {
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'sale-cancellation-coverage/recheck-dryrun.ts');

  const budgetMs = Number(process.env.SCC_BUDGET_MS ?? '45000');
  console.log(`SALE CANCELLATION COVERAGE V1 — RECHECK SWEEP DRY-RUN (budgetMs=${budgetMs})\n`);

  const summary = await runSaleRecheckSweep({ mode: 'dry-run', budgetMs }, (l) => console.log(`[dry-run] ${l}`));

  console.log('\n================ SUMMARY ================');
  console.log(
    JSON.stringify(
      {
        ...summary,
        reports: undefined,
        cellStatusCounts: summary.reports.reduce<Record<string, number>>((a, r) => {
          a[r.status] = (a[r.status] ?? 0) + 1;
          return a;
        }, {}),
        msPerCell: summary.cellsProcessed ? Math.round(summary.durationMs / summary.cellsProcessed) : null,
        daysToFullSweep: summary.cellsProcessed ? +(summary.bandCells / summary.cellsProcessed).toFixed(2) : null,
      },
      null,
      2
    )
  );

  // dry-run이 coverage를 절대 기록하지 않았음을 DB로 직접 확인한다.
  const coverageNow = await prisma.syncCoverageCell.count({ where: { dataset: 'SALE' } });
  console.log(`\nSALE coverage cells in DB (dry-run은 이 값을 바꾸지 않아야 한다): ${coverageNow}`);
  console.log(`coverageRecorded reported by run: ${summary.coverageRecorded} (반드시 0)`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
