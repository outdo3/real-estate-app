/**
 * ADMIN_OPS_V1.1 §6 — 24개월 취소검증(cancellation completeness)의 machine-readable
 * verification snapshot을 생성한다. 이 스크립트 자체는 절대 Production에 쓰지
 * 않는다(항상 dry-run, resync-cancellation-v2.ts의 --apply 없는 기본 동작을 그대로
 * 재사용) — 이미 검증된 read-only 384-cell 전체 24개월 재검증 로직(TRADE_
 * CANCELLATION_RESYNC_V2 §10에서 실행한 것과 동일)을 그대로 다시 실행해 현재
 * 시점 기준 최신 snapshot을 만든다.
 *
 * 사용법:
 *   npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     scripts/generate-cancellation-24m-snapshot.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { main as runResyncV2Main, prisma } from './resync-cancellation-v2';

const SNAPSHOT_PATH = path.join(__dirname, '../data/trade-history/cancellation-24m-verification-snapshot.json');

// STEP F-2/§4 계산과 동일한 month-arithmetic으로 "현재 기준 24개월 전 달"부터
// "현재월"까지의 범위를 매번 새로 계산한다(하드코딩된 202409~202608을 그대로
// 재사용하지 않음 — 실행 시점이 달라지면 창도 그만큼 이동해야 정확하다).
function compute24mWindow(now: Date): { from: string; to: string } {
  const toStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const fromDate = new Date(now.getFullYear(), now.getMonth() - 23, 1);
  const fromStr = `${fromDate.getFullYear()}${String(fromDate.getMonth() + 1).padStart(2, '0')}`;
  return { from: fromStr, to: toStr };
}

async function main() {
  const now = new Date();
  const { from, to } = compute24mWindow(now);

  console.log(`24개월 전체 read-only 재검증 시작: ${from} ~ ${to}`);

  // resync-cancellation-v2.ts의 parseArgs()는 process.argv.slice(2)를 읽는다 —
  // main() 호출 직전에만 argv를 이 스크립트 목적에 맞게 바꿔치기한다(--apply 없음,
  // 항상 dry-run — Production write 0 원칙 준수).
  const originalArgv = process.argv;
  process.argv = [originalArgv[0], originalArgv[1], `--from=${from}`, `--to=${to}`];
  let result: Awaited<ReturnType<typeof runResyncV2Main>>;
  try {
    result = await runResyncV2Main();
  } finally {
    process.argv = originalArgv;
  }

  const snapshot = {
    verifiedAt: now.toISOString(),
    startMonth: from,
    endMonth: to,
    districtCount: 16,
    cells: result.cells,
    complete: result.cellComplete,
    emptyValid: result.cellEmptyValid,
    failed: result.cellFailed,
    invalid: result.cellInvalid,
    conflicts: result.totalConflicts,
    duplicates: 0, // §11 — DB unique index(apartment_trade_histories_group_key_deal_amount_deal_date_f_key)로 구조적 보장, 이 스크립트가 별도로 세지 않음(CONFIG 근거는 route.ts에서 별도 표시)
    changesFoundThisRun: {
      insert: result.totalInsert,
      flipFalseToTrue: result.totalFlip,
      skippedTrueToFalse: result.totalSkippedTrueToFalse,
      reviewRequired: result.totalReviewRequired,
    },
    // idempotency: 이 snapshot 자체는 dry-run이라 매번 재실행 가능하고(부작용
    // 없음), 위 changesFoundThisRun이 전부 0이면 이미 완전히 반영된 상태라는
    // 뜻이다. "실제 apply 후 재실행해도 추가 변경이 없다"는 최초 idempotency
    // 증명 자체는 TRADE_CANCELLATION_RESYNC_V2 STEP(2026-08-31)에서 이미 실측
    // 완료했다(older window 176 cells, 재-dry-run 결과 0건) — 이 필드는 그
    // 기존 증명을 이 snapshot에서도 인용하는 것이지, 이번 실행이 새로 write를
    // 해보고 재확인했다는 뜻이 아니다(이번 실행은 write를 전혀 하지 않았다).
    idempotency: {
      verdict: result.totalInsert === 0 && result.totalFlip === 0,
      note: 'dry-run 자체의 무변경 여부(TRUE=이미 완전히 반영된 상태). apply 후 재-dry-run 0건이라는 최초 증명은 TRADE_CANCELLATION_RESYNC_V2(2026-08-31) 문서 참고 — 이번 실행은 write를 하지 않았다.',
    },
    verdict: (result.cellFailed === 0 && result.cellInvalid === 0 && result.cells > 0 ? 'SAFE' : 'UNSAFE') as 'SAFE' | 'UNSAFE',
    generatedBy: 'scripts/generate-cancellation-24m-snapshot.ts',
  };

  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2));
  console.log('Snapshot 저장 완료:', SNAPSHOT_PATH);
  console.log(JSON.stringify(snapshot, null, 2));
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
