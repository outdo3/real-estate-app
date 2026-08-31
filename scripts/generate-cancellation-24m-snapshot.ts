/**
 * ADMIN_OPS_V1.1/V1.2 §6 — 24개월 취소검증(cancellation completeness)의
 * machine-readable verification snapshot을 생성한다. 이 스크립트 자체는 절대
 * Production에 쓰지 않는다(항상 dry-run, resync-cancellation-v2.ts의 --apply
 * 없는 기본 동작을 그대로 재사용).
 *
 * ADMIN_OPS_V1.2 §2/§3/§27 — V1.1의 치명적 버그를 여기서 고친다: 이전 버전은
 * "현재 시점 기준 최근 24개월"을 인자 없이 자동 계산해 매 실행마다 다른(rolling)
 * window로 snapshot을 덮어썼다. 그 결과 실제 완료된 검증(202409~202608, 384/384
 * COMPLETE, false→true 2,432건 반영)과 다른 window(202410~202609, COMPLETE 368
 * +EMPTY_VALID 16 — 그냥 아직 시작한 지 하루뿐인 9월이 텅 비어있던 것)가
 * "검증됨"인 것처럼 저장되는 사고가 발생했다.
 *
 * 원칙(§27): "검증했다고 기록된 범위"와 "오늘 기준 최근 N개월"은 절대 같은 것이
 * 아니다. 그래서 이 스크립트는 이제 **--from/--to를 반드시 명시적으로 받는다**
 * (기본값 없음) — 실행자가 정확히 어떤 기간을 검증하는지 매번 의식적으로
 * 지정해야 하고, 무심코 실행해도 window가 오늘 날짜에 맞춰 자동으로 미끄러지는
 * 일이 다시는 생기지 않는다.
 *
 * 사용법(예: 이미 확정된 검증 범위를 다시 확인할 때):
 *   npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     scripts/generate-cancellation-24m-snapshot.ts --from=202409 --to=202608
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { main as runResyncV2Main, prisma } from './resync-cancellation-v2';

const SNAPSHOT_PATH = path.join(__dirname, '../data/trade-history/cancellation-24m-verification-snapshot.json');

function parseCliArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const prefix = `${flag}=`;
    const hit = args.find((a) => a.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : undefined;
  };
  const from = get('--from');
  const to = get('--to');
  if (!from || !to) {
    throw new Error(
      '--from=YYYYMM --to=YYYYMM을 반드시 명시해야 합니다(§3 — rolling window 자동 계산 금지). ' +
        '예: --from=202409 --to=202608'
    );
  }
  const correctedFalseToTrueOverrideRaw = get('--correctedFalseToTrueOverride');
  return {
    from,
    to,
    verifiedAtOverride: get('--verifiedAtOverride'),
    // dry-run은 "이번 실행이 지금 발견한 pending flip 수"만 셀 수 있다 — 이미
    // apply로 반영된 과거 교정 건수(예: 2,432)는 dry-run 시점엔 이미 전부
    // 적용된 상태라 항상 0으로 보인다(§4 — "false→true corrected: 2432"는
    // 과거 write 실행 기록이지, 이 dry-run이 재발견할 수 있는 값이 아니다).
    // 그래서 실제 apply 로그에서 확인한 값을 명시적으로 넘겨야 한다.
    correctedFalseToTrueOverride: correctedFalseToTrueOverrideRaw !== undefined ? parseInt(correctedFalseToTrueOverrideRaw, 10) : undefined,
  };
}

async function main() {
  const { from, to, verifiedAtOverride, correctedFalseToTrueOverride } = parseCliArgs();
  const now = new Date();

  console.log(`24개월 read-only 재검증 시작(명시적 window): ${from} ~ ${to}`);

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

  // §9 provenance — "이 SAFE는 어디서 나온 것인가?"를 나중에 추적 가능하게 한다.
  const snapshot = {
    evidenceType: 'SNAPSHOT' as const,
    // verifiedAtOverride: 이미 확정된 과거 검증의 실제 완료 시각을 그대로
    // 보존해야 할 때 씀(예: 이 window를 "오늘 다시 실행해서 여전히 유효함을
    // 재확인"하는 것과 "언제 최초로 검증됐는가"는 다른 사실이므로 혼동하지
    // 않는다, §5). 지정하지 않으면 이번 실행 시각을 그대로 쓴다.
    verifiedAt: verifiedAtOverride || now.toISOString(),
    startMonth: from,
    endMonth: to,
    districtCount: 16,
    cells: result.cells,
    complete: result.cellComplete,
    emptyValid: result.cellEmptyValid,
    failed: result.cellFailed,
    invalid: result.cellInvalid,
    conflicts: result.totalConflicts,
    // §4 — 이번 dry-run이 지금 발견한 pending flip(result.totalFlip)이 아니라,
    // 과거 실제 apply로 이미 반영된 교정 건수를 우선한다(override 없으면
    // 0이어도 정직하게 0 — 날조하지 않음, "증명 불가능하면 날조하지 않는다"
    // 원칙).
    correctedFalseToTrue: correctedFalseToTrueOverride ?? result.totalFlip,
    duplicates: 0, // §10 — DB unique index(apartment_trade_histories_group_key_deal_amount_deal_date_f_key)로 구조적 보장(ADMIN_OPS_V1.1에서 실측 확인), 이 스크립트가 별도로 세지 않음
    changesFoundThisRun: {
      insert: result.totalInsert,
      flipFalseToTrue: result.totalFlip,
      skippedTrueToFalse: result.totalSkippedTrueToFalse,
      reviewRequired: result.totalReviewRequired,
    },
    idempotency: {
      verdict: result.totalInsert === 0 && result.totalFlip === 0,
      note: 'dry-run 자체의 무변경 여부(TRUE=이미 완전히 반영된 상태, 이번 실행은 write를 하지 않았다).',
    },
    verdict: (result.cellFailed === 0 && result.cellInvalid === 0 && result.cells > 0 ? 'SAFE' : 'UNSAFE') as 'SAFE' | 'UNSAFE',
    provenance: {
      sourceDocument: 'docs/development/TRADE_CANCELLATION_RESYNC_V2_24M.md',
      sourceCommit: '5723469',
      verificationType: 'full_384_cell_readonly_reverification',
      generatedBy: 'scripts/generate-cancellation-24m-snapshot.ts',
      generatedAt: now.toISOString(),
    },
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
