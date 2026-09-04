/**
 * TRADE_REGISTRY_DATA_V1.1 §8 — registryDate self-heal DRY-RUN (READ ONLY).
 *
 * cron route와 **완전히 같은 core**(`runSaleSync` / `runSaleRecheckSweep`)를
 * mode='dry-run'으로 돌려 다음을 확인한다:
 *   - updateRegistryOnly 후보가 몇 건 잡히는가(daily 0~3개월 / recheck 4~12개월 각각)
 *   - 형제 occurrence 모호성으로 몇 건을 건너뛰는가(§4)
 *   - 기존 insert / cancellation flip / blocked / conflict 수치가 그대로인가
 *
 * dry-run이므로 write는 구조적으로 발생하지 않는다:
 *   - syncOneSaleCell은 mode!=='apply'면 createMany/update를 전혀 호출하지 않는다
 *   - recordCoverageCells는 mode==='dry-run'이면 즉시 반환한다(이중 안전장치)
 *
 * 사용법:
 *   ALLOW_PROD_DB_READ=1 npx ts-node --transpile-only \
 *     --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js scripts/trade-registry-data/registry-selfheal-dryrun.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { runSaleSync } from '../../src/lib/sync/sale-sync-core';
import { runSaleRecheckSweep } from '../../src/lib/sync/sale-recheck-core';
import { prisma } from '../../src/lib/prisma';
import { assertProductionDbAccessAllowed } from '../_prod-db-guard';

function perMonth(reports: { dealYmd: string; registryUpdated: number; registryAmbiguousSkipped: number; inserted: number; updated: number; blocked: number; reviewCandidates: number }[]) {
  const m: Record<string, { registry: number; ambiguous: number; inserted: number; flips: number; blocked: number; review: number }> = {};
  for (const r of reports) {
    m[r.dealYmd] ??= { registry: 0, ambiguous: 0, inserted: 0, flips: 0, blocked: 0, review: 0 };
    m[r.dealYmd].registry += r.registryUpdated;
    m[r.dealYmd].ambiguous += r.registryAmbiguousSkipped;
    m[r.dealYmd].inserted += r.inserted;
    m[r.dealYmd].flips += r.updated;
    m[r.dealYmd].blocked += r.blocked;
    m[r.dealYmd].review += r.reviewCandidates;
  }
  return m;
}

async function main() {
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'trade-registry-data/registry-selfheal-dryrun.ts');
  console.log('TRADE REGISTRY DATA V1.1 — registryDate self-heal DRY-RUN\n');

  const before = await prisma.apartmentTradeHistory.count({
    where: { lawdCd: { in: ['26110','26140','26170','26200','26230','26260','26290','26320','26350','26380','26410','26440','26470','26500','26530','26710'] }, dealYmd: { gte: '202301' }, dealCanceled: false, registryDate: null },
  });
  console.log(`부산 2023+ 활성 row 중 registryDate NULL (보충 후보 모집단): ${before}\n`);

  console.log('──────── (1) DAILY sale-sync scope (0~3개월) ────────');
  const daily = await runSaleSync({ mode: 'dry-run' }, (l) => console.log(`  [daily] ${l}`));
  console.log('\n' + JSON.stringify({ ...daily, reports: undefined, needsReview: daily.needsReview.length }, null, 2));
  console.log('월별:', JSON.stringify(perMonth(daily.reports), null, 2));

  console.log('\n──────── (2) RECHECK sweep scope (4~12개월) ────────');
  const sweep = await runSaleRecheckSweep({ mode: 'dry-run', budgetMs: Number(process.env.SCC_BUDGET_MS ?? '45000') }, (l) => console.log(`  [sweep] ${l}`));
  console.log('\n' + JSON.stringify({ ...sweep, reports: undefined }, null, 2));
  console.log('월별:', JSON.stringify(perMonth(sweep.reports), null, 2));

  console.log('\n================ COMBINED ================');
  console.log(JSON.stringify({
    registryUpdatedCandidates: daily.registryUpdated + sweep.registryUpdated,
    registryAmbiguousSkipped: daily.registryAmbiguousSkipped + sweep.registryAmbiguousSkipped,
    cancellationFlips: daily.updated + sweep.updated,
    inserts: daily.inserted + sweep.inserted,
    blocked: daily.blocked + sweep.blocked,
    conflictsOrReview: daily.reports.reduce((a, r) => a + r.reviewCandidates, 0) + sweep.reports.reduce((a, r) => a + r.reviewCandidates, 0),
  }, null, 2));

  const coverageNow = await prisma.syncCoverageCell.count({ where: { dataset: 'SALE' } });
  console.log(`\nSALE coverage cells (dry-run이 바꾸면 안 됨): ${coverageNow}`);
  console.log(`coverageRecorded — daily ${daily.coverageRecorded} / sweep ${sweep.coverageRecorded} (둘 다 반드시 0)`);
  const after = await prisma.apartmentTradeHistory.count({
    where: { lawdCd: { in: ['26110','26140','26170','26200','26230','26260','26290','26320','26350','26380','26410','26440','26470','26500','26530','26710'] }, dealYmd: { gte: '202301' }, dealCanceled: false, registryDate: null },
  });
  console.log(`보충 후보 모집단 재확인(변하면 안 됨): ${after} ${after === before ? 'OK' : '*** CHANGED ***'}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
