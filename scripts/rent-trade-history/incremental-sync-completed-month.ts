/**
 * RENT_TRADE_HISTORY_V1 PHASE D.2 — completed-month incremental sync runner.
 *
 * PHASE C/D.2까지 rent verified coverage는 사람이 수동으로 실행한 백필/추가 sync로만
 * 전진했다(202408~202607 → 202608). 이 스크립트는 그 작업을 반복 가능한 CLI로
 * 만든다 — 진행 중인 현재월은 절대 COMPLETE로 sync하지 않고(§20/§23), 항상
 * "직전 완료월"만 대상으로 한다.
 *
 * § LATEST COMPLETE MONTH RULE(§23) — 단순 "오늘 달 - 1"로 충분한지 검토했다.
 * MOLIT reporting lag가 존재하지만(§24, 지도/매매 쪽 14~19% lag 관찰 + rent 쪽
 * 자체 append 관측 — PHASE C의 부산진구 11시간 관측, PHASE D.2의 202608 직후
 * idempotency 재확인에서도 unchanged=2889/2889, append 0건), "완전 안정화까지
 * N일 걸린다"는 근거는 아직 없다 — 근거 없는 과도한 delay(예: "완료 후 30일
 * 대기")는 넣지 않는다. 대신 매 실행마다 최신 완료월 하나만이 아니라 최근
 * overlapMonths개월(기본 2)을 재동기화해 늦게 들어온 정정을 안전하게 흡수한다
 * (§25 OVERLAP POLICY) — 기존 sync engine이 이미 idempotent upsert이므로 재실행
 * 비용은 "새 행 있으면 추가, 없으면 그대로"뿐이고 광범위 UPDATE는 발생하지 않는다
 * (§46 correction-safe upsert, PHASE B/D.2 실측으로 이미 검증됨).
 *
 * § SCHEDULER READINESS(§26) — 이 스크립트 자체는 안전하게 반복 실행 가능한
 * idempotent CLI다. 하지만 Vercel Cron 등 실제 스케줄러 등록은 외부 infra/plan
 * 변경(새 cron job, 함수 timeout 설정 등)이 필요해 이번 STEP 승인 범위 밖이다 —
 * 이 스크립트는 "수동 실행" 또는 "향후 승인된 스케줄러가 호출할 대상"으로만
 * 준비해둔다(SCHEDULER_READY 판정, 실제 등록은 하지 않음).
 *
 * § NO AUTO COVERAGE UPDATE — 이 스크립트는 RENT_VERIFIED_FROM/TO
 * (src/lib/rent-verified-range.ts)를 자동으로 갱신하지 않는다. 검증범위는
 * "오늘 기준 계산값"이 아니라 사람이 sync 결과(completeness/idempotency)를 확인한
 * 뒤 의도적으로 갱신하는 값이라는 이 프로젝트의 반복 원칙(PHASE C §34, PHASE D.2
 * DECISIONS.md #10)을 그대로 따른다 — 이 스크립트는 데이터만 채우고, 결과를
 * 사람이 검토해 알맞으면 rent-verified-range.ts를 별도로 수정한다.
 *
 * 사용법:
 *   # 1) dry-run(기본, 필수 선행 단계)
 *   npx ts-node --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js \
 *     scripts/rent-trade-history/incremental-sync-completed-month.ts
 *
 *   # 2) 실제 반영
 *   ... --apply
 *
 *   # 3) overlap 개월 수 조정(기본 2)
 *   ... --apply --overlap=3
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { runRentSyncJob, makeLogger, prisma } from './sync-rent-history';
import { latestCompleteMonth, subtractMonths } from './incremental-sync-completed-month-logic';

export { latestCompleteMonth, subtractMonths } from './incremental-sync-completed-month-logic';

const BUSAN_LAWDCD = ['26110', '26140', '26170', '26200', '26230', '26260', '26290', '26320', '26350', '26380', '26410', '26440', '26470', '26500', '26530', '26710'];

function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const overlapArg = args.find((a) => a.startsWith('--overlap='));
  const overlap = overlapArg ? parseInt(overlapArg.split('=')[1], 10) : 2;
  if (!Number.isFinite(overlap) || overlap < 1) {
    throw new Error('--overlap은 1 이상의 정수여야 합니다.');
  }
  return { apply, overlap };
}

async function main() {
  const { apply, overlap } = parseArgs();
  const now = new Date();
  const latest = latestCompleteMonth(now);
  const from = subtractMonths(latest, overlap - 1);
  const to = latest;

  const log = makeLogger(path.resolve(__dirname, '_incremental_sync_results'));
  log(`INCREMENTAL_SYNC latestCompleteMonth=${latest} overlap=${overlap} range=[${from},${to}] apply=${apply}`);

  const outcomes = await runRentSyncJob({ apply, lawdCdList: BUSAN_LAWDCD, from, to }, log);

  const resolved = outcomes.filter((o) => o.status === 'COMPLETE' || o.status === 'EMPTY_VALID');
  const failed = outcomes.filter((o) => o.status === 'PARTIAL' || o.status === 'INVALID');
  const observedMutations = outcomes.filter((o) => o.wouldUpdate > 0);

  log(`INCREMENTAL_SYNC_SUMMARY total=${outcomes.length} resolved=${resolved.length} failed=${failed.length} cellsWithContentDiff=${observedMutations.length}`);
  if (failed.length > 0) {
    log(`FAILED_CELLS: ${failed.map((f) => `${f.lawdCd}:${f.dealYmd}`).join(', ')} — retry these specific cells only, not the whole range.`);
  }
  if (observedMutations.length > 0) {
    // §17 CORRECTION HANDLING — mutation(내용 변경)이 처음 발견되면 정책을
    // 함부로 확장하지 않고 사람이 검토하도록 눈에 띄게 로그만 남긴다.
    log(`OBSERVED_CONTENT_DIFF: ${observedMutations.map((o) => `${o.lawdCd}:${o.dealYmd}(wouldUpdate=${o.wouldUpdate})`).join(', ')} — review before trusting silently, do not expand auto-update policy.`);
  }
  if (apply && failed.length === 0) {
    log(
      `REMINDER: 이 스크립트는 RENT_VERIFIED_TO(src/lib/rent-verified-range.ts)를 자동으로 갱신하지 않는다 — ` +
        `위 결과(resolved=${resolved.length}/${outcomes.length}, mutation=${observedMutations.length})를 사람이 확인한 뒤 ` +
        `필요하면 수동으로 RENT_VERIFIED_TO를 "${to}"로 갱신한다.`
    );
  }

  await prisma.$disconnect();
  process.exit(failed.length > 0 ? 1 : 0);
}

if (require.main === module) {
  main().catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
}
