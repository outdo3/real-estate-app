/**
 * OFFICETEL INCREMENTAL SYNC V1 — 1회성 catch-up (202609 ~ 현재월).
 *
 * STEP 3B는 2026-09-04 스윕 파일을 한 번 적재하고 끝난 최초 backfill이다. 그 이후 달(202609 잔여분, 202610)은
 * 이 도구가 따라잡는다. 같은 sync core(src/lib/officetel/sync)를 쓰므로 cron과 판정 규칙이 갈라지지 않는다.
 *
 * 기본은 DRY-RUN이다: MOLIT를 GET으로 읽고 DB를 읽기만 하며, 쓰기는 0이다.
 * APPLY는 --apply 외에 확인 토큰과 범위 지정이 모두 필요하다(catchup-guard.ts).
 *
 * 실행 순서(권장):
 *   1. 전체 dry-run   : npx tsx scripts/officetel/incremental-catchup.ts
 *   2. 대표 1구 apply : npx tsx scripts/officetel/incremental-catchup.ts --apply --confirm=WRITE_PRODUCTION_OFFICETEL_HISTORY --lawd=26350
 *   3. read-only 검증 : (건수/최신 거래일/sourceFetchedAt/unresolved 확인)
 *   4. 16구 apply     : ... --apply --confirm=WRITE_PRODUCTION_OFFICETEL_HISTORY --all-districts
 *   5. 최신성 확인    : GET /api/officetel/nearby 의 freshness
 *   6. cron 활성화    : vercel.json에 OFFICETEL_CRON_PLAN 항목 추가
 *
 * 옵션: --dataset=SALE|RENT|ALL  --from=YYYYMM  --to=YYYYMM  --lawd=26350[,26230]  --all-districts
 *
 * 이 파일은 작성만 했고 이번 STEP에서 실행하지 않았다.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { PrismaClient } from '@prisma/client';
import { createPrismaOfficetelDb } from '../../src/lib/officetel/sync/db';
import { fetchOfficetelCell } from '../../src/lib/officetel/sync/molit-fetch';
import { runOfficetelSync } from '../../src/lib/officetel/sync/run';
import { newRunId } from '../../src/lib/sync/shared';
import {
  APPLY_CONFIRM_TOKEN,
  catchupConfirmOf,
  catchupLawdExplicit,
  checkApplyGuard,
  parseCatchupArgs,
} from '../../src/lib/officetel/sync/catchup-guard';
import type { OfficetelSyncDataset } from '../../src/lib/officetel/sync/types';

const CATCHUP_BUDGET_MS = 30 * 60 * 1000; // 서버리스 한도가 없는 CLI. 요청별 타임아웃·재시도는 그대로 적용된다.

async function main() {
  const argv = process.argv.slice(2);
  const parsed = parseCatchupArgs(argv, new Date());
  if (!parsed.ok) throw new Error(`ABORT: ${parsed.error}`);
  const { args } = parsed;
  const guard = checkApplyGuard(args, catchupConfirmOf(argv), catchupLawdExplicit(argv));
  if (guard) throw new Error(`ABORT: ${guard}`);

  console.log(`OFFICETEL INCREMENTAL CATCH-UP  [${args.apply ? 'APPLY' : 'DRY-RUN'}]  dataset=${args.dataset} months=${args.months.join(',')} districts=${args.lawdCds.length}`);
  if (args.apply) console.log(`  confirm token accepted (${APPLY_CONFIRM_TOKEN.length} chars)`);

  const prisma = new PrismaClient();
  try {
    const [{ sale, rent, masters }] = await prisma.$queryRawUnsafe<{ sale: number; rent: number; masters: number }[]>(
      `SELECT (SELECT COUNT(*) FROM officetel_trade_histories)::int AS sale,
              (SELECT COUNT(*) FROM officetel_rent_histories)::int  AS rent,
              (SELECT COUNT(*) FROM officetel_masters)::int         AS masters`
    );
    console.log(`  DB 현재: sale=${sale} rent=${rent} masters=${masters}`);

    const db = createPrismaOfficetelDb(prisma);
    const datasets: OfficetelSyncDataset[] =
      args.dataset === 'SALE' ? ['OFFICETEL_SALE'] : args.dataset === 'RENT' ? ['OFFICETEL_RENT'] : ['OFFICETEL_SALE', 'OFFICETEL_RENT'];

    for (const dataset of datasets) {
      const started = Date.now();
      const summary = await runOfficetelSync(
        {
          dataset,
          mode: args.apply ? 'apply' : 'dry-run',
          lawdCds: args.lawdCds,
          months: args.months,
          runId: newRunId('officetel-catchup'),
          budgetMs: CATCHUP_BUDGET_MS,
        },
        {
          db,
          fetchCell: (ds, lawdCd, dealYmd) => fetchOfficetelCell(ds, lawdCd, dealYmd, { deadline: { remainingMs: () => CATCHUP_BUDGET_MS - (Date.now() - started) } }),
          log: (line) => console.log(`  ${line}`),
        }
      );
      const { reports, ...rest } = summary;
      console.log(`\n── ${dataset} 요약`);
      console.log(JSON.stringify(rest, null, 2));
      const problem = reports.filter((r) => r.status !== 'COMPLETE');
      if (problem.length) console.log(`  COMPLETE가 아닌 셀 ${problem.length}개:`, problem.map((r) => `${r.lawdCd}/${r.dealYmd}:${r.status}${r.failureReason ? `(${r.failureReason})` : ''}`).join(' '));
    }
    console.log(args.apply ? '\n완료(APPLY).' : '\n완료(DRY-RUN — DB 쓰기 0).');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(String(e instanceof Error ? e.message : e).replace(/postgres(ql)?:\/\/\S+/g, '<db-url>'));
  process.exit(1);
});
