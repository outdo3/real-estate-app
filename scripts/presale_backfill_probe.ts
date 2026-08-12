/**
 * PRESALE P2-C2 초기 백필 준비용 프로브 스크립트.
 *
 * syncApplyhomeListings()를 dryRun + limit=1로 호출해 주어진 날짜 구간의 matchCount만
 * 저비용으로 확인한다(limit=1이면 내부 while 루프가 첫 페이지 조회 직후 종료되므로 API
 * 호출 1회로 끝난다 — cheongyakService.ts의 페이지네이션 로직 참고). DB에 쓰지 않는다
 * (dryRun이므로 findUnique만 최대 1건 호출, upsert 없음).
 *
 * 이 스크립트는 P2-C2 백필의 배치 경계를 정하기 위한 일회성 도구다. 기존
 * scripts/sync_presales_test.ts와 달리 임의의 fromDate/toDate 구간을 지정할 수 있어야
 * 배치별 matchCount를 사전에 확인할 수 있다.
 *
 * 사용법:
 *   npx ts-node --compiler-options '{"module":"commonjs"}' -r ./scripts/_register-paths.js \
 *     scripts/presale_backfill_probe.ts <fromDate> [toDate]
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import { syncApplyhomeListings } from '../src/services/cheongyakService';

dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

async function main() {
  const fromDate = process.argv[2];
  const toDate = process.argv[3];
  if (!fromDate) {
    console.error('사용법: presale_backfill_probe.ts <fromDate:YYYY-MM-DD> [toDate:YYYY-MM-DD]');
    process.exitCode = 1;
    return;
  }
  const result = await syncApplyhomeListings({ mode: 'initial', fromDate, toDate, limit: 1, dryRun: true });
  console.log(JSON.stringify({ fromDate, toDate: toDate ?? null, matchCount: result.matchCount, error: result.error ?? null }));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
