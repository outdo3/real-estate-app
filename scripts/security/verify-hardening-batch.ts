/**
 * SUPABASE_DB_SECURITY_HARDENING_V2 — 배치 적용 전/후 비교(읽기 전용, 파일 입력만).
 *
 * 실행:
 *   npx tsx scripts/security/verify-hardening-batch.ts --batch=A --before=<before.json> --after=<after.json>
 * before/after는 `audit-db-grants-rls.ts --json` 출력(저장소 밖에 보관). 출력은 테이블 이름·항목·PASS/FAIL뿐.
 */
import { readFileSync } from 'fs';
import { HARDENING_BATCHES, verifyBatch, type AuditJson, type BatchName } from './hardening-batches';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

function main() {
  const batch = arg('batch') as BatchName | undefined;
  const beforePath = arg('before');
  const afterPath = arg('after');
  if (!batch || !(batch in HARDENING_BATCHES) || !beforePath || !afterPath) {
    console.error('usage: --batch=A --before=<json> --after=<json>');
    process.exitCode = 2;
    return;
  }
  const before = JSON.parse(readFileSync(beforePath, 'utf8')) as AuditJson;
  const after = JSON.parse(readFileSync(afterPath, 'utf8')) as AuditJson;
  const result = verifyBatch(before, after, HARDENING_BATCHES[batch]);
  console.log(`BATCH ${batch}: ${result.ok ? 'PASS' : 'FAIL'}  targets=${result.checkedTargets} others=${result.checkedOthers}`);
  for (const v of result.targetViolations) console.log(`  TARGET  ${v}`);
  for (const v of result.unrelatedChanges) console.log(`  UNRELATED  ${v}`);
  if (!result.ok) process.exitCode = 1;
}

main();
