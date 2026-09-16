/**
 * CANCELLATION_RATCHET_PREVENTION_FIX_V1 §13 — 실제 sync core dry-run (쓰기 없음).
 * mode='dry-run'이라 sale-sync-core는 어떤 UPDATE/INSERT도 실행하지 않는다.
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/qa-cancel-reconcile-dryrun.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

async function main() {
  const { syncOneSaleCell } = await import('../src/lib/sync/sale-sync-core');
  // REPAIR_AUDIT_V1이 확정한 false-cancel이 몰려 있는 셀들 + 대조군(과다 취소 없는 셀).
  const cells: Array<[string, string, number]> = [
    ['26350', '202608', 3], ['26230', '202608', 2], ['26260', '202609', 1],
    ['26380', '202609', 1], ['26110', '202608', 1], ['26410', '202602', 1],
    ['26140', '202603', 0], ['26470', '202608', 0],
  ];
  const lines: string[] = [];
  const log = (l: string) => lines.push(l);
  console.log('lawdCd\tdealYmd\tstatus\texpectedRestore\tcancelRestorePending\tcancelRestored\tflips\tinserted\treconcileSkipped\tverdict');
  let pass = true;
  for (const [lawdCd, dealYmd, expected] of cells) {
    const r = await syncOneSaleCell(lawdCd, dealYmd, 'dry-run', log);
    const pending = r.cancelRestorePending ?? 0;
    const ok = r.status === 'COMPLETE' && pending === expected && (r.cancelRestored ?? 0) === 0 && r.inserted === 0;
    if (!ok) pass = false;
    console.log([lawdCd, dealYmd, r.status, expected, pending, r.cancelRestored ?? 0, r.updated, r.inserted, r.cancelReconcileSkipped ?? 0, ok ? 'PASS' : 'FAIL'].join('\t'));
  }
  console.log('\n--- sync log ---');
  for (const l of lines) console.log(l);
  console.log(`\nVERDICT: ${pass ? 'PASS' : 'FAIL'}`);
  process.exit(pass ? 0 : 1);
}
main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
