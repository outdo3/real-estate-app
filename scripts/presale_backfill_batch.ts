/**
 * PRESALE P2-C2 초기 백필 실행용 스크립트.
 *
 * syncApplyhomeListings()를 mode:'initial'로, 지정된 날짜 구간(fromDate~toDate) 안에서
 * 1회 호출한다. 각 배치의 matchCount가 MAX_SYNC_LIMIT(200) 이하가 되도록 사전에
 * presale_backfill_probe.ts로 구간을 나눠뒀다는 전제로 limit=200을 고정 사용한다(서비스
 * 내부에서 어차피 200으로 클램프되므로 이 값을 넘겨도 위험하지 않다).
 *
 * 전체 결과(JSON)는 scripts/_backfill_results/<label>.json 에 저장하고, 콘솔에는 요약만
 * 출력한다(1046건 전체를 터미널에 그대로 찍으면 가독성이 떨어짐).
 *
 * 사용법:
 *   npx ts-node --compiler-options '{"module":"commonjs"}' -r ./scripts/_register-paths.js \
 *     scripts/presale_backfill_batch.ts <label> <fromDate> [toDate] [dryRun]
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { syncApplyhomeListings } from '../src/services/cheongyakService';

dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

async function main() {
  const label = process.argv[2];
  const fromDate = process.argv[3];
  const toDate = process.argv[4] || undefined;
  const dryRun = process.argv[5] === 'true';

  if (!label || !fromDate) {
    console.error('사용법: presale_backfill_batch.ts <label> <fromDate> [toDate] [dryRun]');
    process.exitCode = 1;
    return;
  }

  console.log(`[${label}] syncApplyhomeListings({ mode: 'initial', fromDate: '${fromDate}', toDate: ${toDate ? `'${toDate}'` : 'null'}, limit: 200, dryRun: ${dryRun} }) 실행...`);
  const result = await syncApplyhomeListings({ mode: 'initial', fromDate, toDate, limit: 200, dryRun });

  const outDir = path.resolve(__dirname, '_backfill_results');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${label}.json`);
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));

  const failedItems = result.items.filter((i) => i.status === 'failed');
  const summary = {
    label,
    fromDate,
    toDate: toDate ?? null,
    dryRun,
    matchCount: result.matchCount,
    fetched: result.fetched,
    created: result.created,
    updated: result.updated,
    skipped: result.skipped,
    failed: result.failed,
    houseTypeDetailsUpserted: result.houseTypeDetailsUpserted,
    mdlFailedCount: result.mdlFailedCount,
    geocodeExact: result.geocodeExact,
    geocodeNormalized: result.geocodeNormalized,
    geocodeAreaOnly: result.geocodeAreaOnly,
    geocodeFailed: result.geocodeFailed,
    fatalError: result.error ?? null,
    failedItems: failedItems.map((i) => ({ houseManageNo: i.houseManageNo, houseName: i.houseName, error: i.error })),
  };
  console.log(JSON.stringify(summary, null, 2));
  console.log(`전체 결과 저장: ${outPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
