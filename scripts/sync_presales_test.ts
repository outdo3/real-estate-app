/**
 * PRESALE P2-B 검증용 소량 테스트 스크립트.
 *
 * syncApplyhomeListings()를 아주 작은 perPage로 1회 호출해 실제 청약홈 공고 몇 건을
 * Presale/PresaleHouseTypeDetail에 저장한다. 관리자 UI 버튼이나 cron으로 연결하지 않고,
 * 수동으로 한 번 실행해 저장 결과를 검증하기 위한 용도다(scripts/backfill_apt_details.ts와
 * 같은 성격의 일회성 검증 스크립트).
 *
 * 사용법:
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/sync_presales_test.ts [perPage]
 *
 *   perPage를 생략하면 기본값 8을 사용한다. 전국 2,843건 전체를 수집하지 않는다 — 이 값을
 *   임의로 크게 늘려 대량 수집 용도로 쓰지 않는다(P2-B 작업 범위 밖).
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import { syncApplyhomeListings } from '../src/services/cheongyakService';

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

async function main() {
  const perPage = parseInt(process.argv[2] || '8', 10);
  console.log(`syncApplyhomeListings(page=1, perPage=${perPage}) 실행...`);
  const result = await syncApplyhomeListings(1, perPage);
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
