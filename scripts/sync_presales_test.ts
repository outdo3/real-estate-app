/**
 * PRESALE P2-B/P2-C 검증용 소량 테스트 스크립트.
 *
 * syncApplyhomeListings()를 제한된 limit으로 1회 호출해 실제 청약홈 공고 몇 건을
 * Presale/PresaleHouseTypeDetail에 저장한다. 관리자 UI 버튼이나 cron으로 연결하지 않고,
 * 수동으로 한 번 실행해 저장 결과를 검증하기 위한 용도다(scripts/backfill_apt_details.ts와
 * 같은 성격의 일회성 검증 스크립트). 운영 중에는 관리자 대시보드의 "분양정보 동기화" 버튼
 * (src/app/api/admin/presales/sync/route.ts)을 사용한다 — 이 스크립트는 개발/디버깅용이다.
 *
 * 사용법:
 *   npx ts-node --compiler-options '{"module":"commonjs"}' -r ./scripts/_register-paths.js \
 *     scripts/sync_presales_test.ts [limit] [mode] [dryRun]
 *
 *   limit: 처리할 최대 공고 수 (기본 8, MAX_SYNC_LIMIT=200으로 서버 측에서 강제 클램프됨)
 *   mode: incremental(기본, 최근 90일) | initial(최근 3년)
 *   dryRun: "true"면 DB에 쓰지 않고 무엇이 생성/갱신될지만 미리 계산
 *
 *   전국 2,843건 전체를 수집하지 않는다 — limit을 임의로 크게 늘려 대량 수집 용도로 쓰지
 *   않는다(P2-C 작업 범위 밖, 자동 전체 동기화는 아직 구현하지 않음).
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import { syncApplyhomeListings } from '../src/services/cheongyakService';

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

async function main() {
  const limit = parseInt(process.argv[2] || '8', 10);
  const mode = (process.argv[3] === 'initial' ? 'initial' : 'incremental') as 'initial' | 'incremental';
  const dryRun = process.argv[4] === 'true';
  console.log(`syncApplyhomeListings({ limit: ${limit}, mode: '${mode}', dryRun: ${dryRun} }) 실행...`);
  const result = await syncApplyhomeListings({ limit, mode, dryRun });
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
