/**
 * MASTER_COVERAGE_SYNC_V1 — repeatable ApartmentMaster ↔ TradeHistory coverage
 * sync. Generalizes the one-off RECENT_MASTER_MISSING_16_AUDIT_V1 →
 * MASTER_MISSING_REPAIR_V1 pipeline into a tool that can be re-run any time new
 * aptSeq show up in TradeHistory without a Master row yet.
 *
 * Absolute principles (same as the 16-case repair, generalized, §26 of the spec):
 *  - Dry-run by default. Only `--apply` writes to the DB.
 *  - INSERT only — never UPDATE an existing Master row (duplicate aptSeq = skip).
 *  - Only HIGH_CONFIDENCE candidates (masterCreateReadiness=READY_FOR_MASTER_CREATE)
 *    are ever inserted. REVIEW_REQUIRED/INVALID candidates are reported, never
 *    auto-created.
 *  - Secondary metadata(totalHouseholds/좌표/parking/FAR·BCR/...) is never filled —
 *    identical field set to buildMasterRowPlan() in repair-recent-missing-masters-
 *    logic.ts, reused unchanged here (one INSERT path in the whole codebase).
 *
 * Usage:
 *   npx ts-node --compiler-options '{"module":"commonjs"}' \
 *     scripts/master-coverage-sync.ts                 # dry-run, 24-month window
 *   npx ts-node --compiler-options '{"module":"commonjs"}' \
 *     scripts/master-coverage-sync.ts --months=12      # custom window
 *   npx ts-node --compiler-options '{"module":"commonjs"}' \
 *     scripts/master-coverage-sync.ts --apply          # actually insert HIGH_CONFIDENCE rows
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { prisma } from '../src/lib/prisma';
import { buildAllPlans } from './repair-recent-missing-masters-logic';
import {
  BUSAN_LAWD_CODES,
  computeCoverage,
  buildForensicProfile,
  classifyCandidateProfile,
  profileToRepairCandidate,
  type TradeRecord,
  type MasterAliasRow,
} from './master-coverage-sync-logic';

function parseMonthsArg(): number {
  const arg = process.argv.find((a) => a.startsWith('--months='));
  if (!arg) return 24;
  const n = Number(arg.split('=')[1]);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`--months 값이 올바르지 않습니다: ${arg}`);
  }
  return n;
}

async function main() {
  const startedAt = Date.now();
  const apply = process.argv.includes('--apply');
  const months = parseMonthsArg();
  const windowStart = new Date(Date.now() - months * 30 * 24 * 3600 * 1000);

  console.log('MASTER COVERAGE SYNC V1');
  console.log(`window: ${months} months (>= ${windowStart.toISOString().slice(0, 10)})`);
  console.log(`mode: ${apply ? 'APPLY' : 'DRY_RUN'}\n`);

  // STEP 1 — distinct traded aptSeq in window, batch groupBy (no N+1).
  const tradeGroups = await prisma.apartmentTradeHistory.groupBy({
    by: ['aptSeq'],
    where: {
      lawdCd: { in: BUSAN_LAWD_CODES },
      dealType: 'sale',
      dealCanceled: false,
      aptSeq: { not: null },
      dealDate: { gte: windowStart },
    },
  });
  const tradedAptSeqs = tradeGroups.map((g) => g.aptSeq!) as string[];

  // STEP 2 — batch matched-Master lookup (single findMany, not per-aptSeq).
  const matchedMasters = await prisma.apartmentMaster.findMany({
    where: { aptSeq: { in: tradedAptSeqs } },
    select: { aptSeq: true },
  });
  const existingAptSeqs = new Set(matchedMasters.map((m) => m.aptSeq!));

  const coverage = computeCoverage(tradedAptSeqs, existingAptSeqs);

  console.log('TradeHistory distinct aptSeq:', coverage.tradedAptSeqCount);
  console.log('ApartmentMaster matched:', coverage.masterMatchedCount);
  console.log('Missing:', coverage.missingCount);
  console.log(`Coverage: ${coverage.coveragePercent.toFixed(2)}%\n`);

  const report: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    windowMonths: months,
    mode: apply ? 'APPLY' : 'DRY_RUN',
    coverage: {
      tradedAptSeqCount: coverage.tradedAptSeqCount,
      masterMatchedCount: coverage.masterMatchedCount,
      missingCount: coverage.missingCount,
      coveragePercent: Number(coverage.coveragePercent.toFixed(2)),
    },
    candidates: [] as unknown[],
    productionWrite: { executed: false, insertedCount: 0, reason: '' },
  };

  if (coverage.missingCount === 0) {
    console.log('HIGH_CONFIDENCE: 0');
    console.log('REVIEW_REQUIRED: 0');
    console.log('INVALID: 0');
    console.log('\nProduction write: NOT EXECUTED (missing=0, no candidate to act on)');
    (report.productionWrite as { executed: boolean; insertedCount: number; reason: string }).reason =
      'missing=0 — no candidate to evaluate';
    writeReport(report);
    console.log(`\nexecution time: ${Date.now() - startedAt}ms`);
    await prisma.$disconnect();
    return;
  }

  // STEP 3 — batch trade-history fetch for ALL missing aptSeq in ONE query
  // (avoids the per-aptSeq findMany loop the original 16-case audit script used —
  // fine at N=16, but this tool must stay batch-safe at any missing count).
  const missingTrades = await prisma.apartmentTradeHistory.findMany({
    where: { aptSeq: { in: coverage.missingAptSeqs } },
    select: { aptSeq: true, aptName: true, dong: true, jibun: true, lawdCd: true, buildYear: true, dealDate: true },
    orderBy: { dealDate: 'asc' },
  });
  const tradesByAptSeq = new Map<string, TradeRecord[]>();
  for (const t of missingTrades) {
    const list = tradesByAptSeq.get(t.aptSeq!) ?? [];
    list.push({ aptName: t.aptName, dong: t.dong, jibun: t.jibun, lawdCd: t.lawdCd, buildYear: t.buildYear });
    tradesByAptSeq.set(t.aptSeq!, list);
  }

  // STEP 4 — batch fetch all Busan Master rows once for alias/address collision
  // checks (same pattern as audit-recent-master-missing-16.ts).
  const allMasters: MasterAliasRow[] = await prisma.apartmentMaster.findMany({
    where: { sggCd: { in: BUSAN_LAWD_CODES } },
    select: { aptSeq: true, name: true, normalizedName: true, umdName: true, jibun: true },
  });

  // STEP 5 — build profile + classify per missing aptSeq (pure, in-memory).
  const profiles = coverage.missingAptSeqs.map((aptSeq) =>
    buildForensicProfile(aptSeq, tradesByAptSeq.get(aptSeq) ?? [], allMasters)
  );
  const classifications = profiles.map((p) => classifyCandidateProfile(p));

  const highConfidence = classifications.filter((c) => c.decision === 'HIGH_CONFIDENCE');
  const reviewRequired = classifications.filter((c) => c.decision === 'REVIEW_REQUIRED');
  const invalid = classifications.filter((c) => c.decision === 'INVALID');

  console.log(`HIGH_CONFIDENCE: ${highConfidence.length}`);
  console.log(`REVIEW_REQUIRED: ${reviewRequired.length}`);
  console.log(`INVALID: ${invalid.length}\n`);

  for (let i = 0; i < profiles.length; i++) {
    const p = profiles[i];
    const c = classifications[i];
    console.log(
      `  ${p.aptSeq} ${p.canonicalName}(${p.dong}) buildYear=${p.buildYear} trades=${p.totalTradeCount} -> ${c.decision}(${c.classification}) — ${c.reason}`
    );
  }

  report.candidates = profiles.map((p, i) => ({
    aptSeq: p.aptSeq,
    name: p.canonicalName,
    dong: p.dong,
    jibun: p.jibun,
    buildYear: p.buildYear,
    totalTradeCount: p.totalTradeCount,
    decision: classifications[i].decision,
    classification: classifications[i].classification,
    evidenceStrength: classifications[i].evidenceStrength,
    reason: classifications[i].reason,
    evidence: classifications[i].evidence,
    conflicts: {
      masterNameAliasMatches: p.masterNameAliasMatches,
      masterAddressMatch: p.masterAddressMatch,
      aptSeqLawdMismatch: p.aptSeqLawdMismatch,
    },
  }));

  // STEP 6 — build INSERT plans via the SAME reused write-path logic as
  // MASTER_MISSING_REPAIR_V1 (repair-recent-missing-masters-logic.ts). Only
  // masterCreateReadiness=READY_FOR_MASTER_CREATE (i.e. HIGH_CONFIDENCE) rows
  // can ever become an INSERT plan.
  const repairCandidates = profiles.map((p, i) => profileToRepairCandidate(p, classifications[i]));
  const plans = buildAllPlans(repairCandidates, existingAptSeqs);
  const willInsert = plans.filter((pl) => pl.action === 'INSERT');

  if (!apply) {
    console.log(`\nProduction write: NOT EXECUTED (dry-run; would insert ${willInsert.length} row(s) with --apply)`);
    (report.productionWrite as { executed: boolean; insertedCount: number; reason: string }).reason =
      willInsert.length > 0
        ? `DRY_RUN — PRODUCTION_WRITE_APPROVAL_REQUIRED for ${willInsert.length} HIGH_CONFIDENCE insert(s)`
        : 'DRY_RUN — no HIGH_CONFIDENCE candidate ready for insert';
    writeReport(report);
    console.log(`\nexecution time: ${Date.now() - startedAt}ms`);
    await prisma.$disconnect();
    return;
  }

  if (willInsert.length === 0) {
    console.log('\n[APPLY] insert 대상 0건 — 종료.');
    (report.productionWrite as { executed: boolean; insertedCount: number; reason: string }).reason =
      'APPLY requested but no HIGH_CONFIDENCE candidate to insert';
    writeReport(report);
    await prisma.$disconnect();
    return;
  }

  // STEP 7 — re-verify aptSeq duplicates immediately before writing (idempotency
  // guard against races between the read above and this write).
  const recheck = await prisma.apartmentMaster.findMany({
    where: { aptSeq: { in: willInsert.map((pl) => pl.aptSeq) } },
    select: { aptSeq: true },
  });
  const recheckSet = new Set(recheck.map((r) => r.aptSeq!));
  const finalInsertPlans = willInsert.filter((pl) => !recheckSet.has(pl.aptSeq));

  console.log(`\n=== APPLYING ${finalInsertPlans.length}건 ===`);
  const results: { aptSeq: string; id: number; name: string }[] = [];
  const failures: { aptSeq: string; error: string }[] = [];
  for (const plan of finalInsertPlans) {
    const data = plan.data!;
    try {
      const created = await prisma.apartmentMaster.create({ data });
      results.push({ aptSeq: created.aptSeq!, id: created.id, name: created.name });
      console.log(`  CREATED id=${created.id} aptSeq=${created.aptSeq} name="${created.name}"`);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      failures.push({ aptSeq: plan.aptSeq, error: message });
      console.error(`  [ERROR] aptSeq=${plan.aptSeq}: ${message}`);
    }
  }

  console.log(`\ninserted: ${results.length}, failed: ${failures.length}`);
  (report.productionWrite as { executed: boolean; insertedCount: number; reason: string }).executed = true;
  (report.productionWrite as { executed: boolean; insertedCount: number; reason: string }).insertedCount = results.length;
  (report.productionWrite as { executed: boolean; insertedCount: number; reason: string }).reason = 'APPLY executed';
  report.applyResults = { inserted: results, failed: failures };

  writeReport(report);
  console.log(`\nexecution time: ${Date.now() - startedAt}ms`);
  await prisma.$disconnect();
}

function writeReport(report: Record<string, unknown>) {
  const resultsDir = path.resolve(__dirname, '_master_coverage_sync_results');
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
  const file = path.join(resultsDir, `sync-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(`\n저장: ${path.relative(path.resolve(__dirname, '..'), file)}`);
}

main()
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error('FATAL:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
