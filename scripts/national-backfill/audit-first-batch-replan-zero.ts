/**
 * NATIONAL_FIRST_BATCH_APPLY_V1 — apply 후 재계획 0 확인 (READ ONLY · MOLIT 0콜).
 *
 * 권위 checkpoint는 건드리지 않는다: 구 디렉터리를 복사하고, 복사본의 APPLIED 셀만 FETCHED로 바꿔
 * 계획이 실제로 다시 돌게 한 뒤, raw 캐시 + Production 읽기로 dry-run 한다. fetcher는 호출되면 실패한다.
 *
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/national-backfill/audit-first-batch-replan-zero.ts 41111,41113,...
 */
import * as fs from 'fs';
import * as path from 'path';
import { runBackfill, realReadDb } from '../backfill-seoul-sale';
import { loadInventory } from './orchestrator';

const SRC = path.resolve(__dirname, '../../tmp/national-backfill/districts');
const COPY = path.resolve(__dirname, '../../tmp/national-backfill-replan-zero/districts');

async function main() {
  const districts = (process.argv[2] ?? '').split(',').filter(Boolean);
  const inv = loadInventory();
  const leaves = new Set(inv.entries.filter((e) => e.isMolitLeaf).map((e) => e.lawdCd));
  const known = new Set(inv.entries.map((e) => e.lawdCd));
  const out: Record<string, unknown> = {};
  let fetches = 0;
  for (const d of districts) {
    const dst = path.join(COPY, d);
    fs.rmSync(dst, { recursive: true, force: true });
    fs.cpSync(path.join(SRC, d), dst, { recursive: true });
    const cpFile = path.join(dst, 'checkpoints', `${d}.json`);
    const cells = JSON.parse(fs.readFileSync(cpFile, 'utf8'));
    let relabeled = 0;
    for (const c of Object.values(cells) as { state: string }[]) if (c.state === 'APPLIED') { c.state = 'FETCHED'; relabeled++; }
    fs.writeFileSync(cpFile, JSON.stringify(cells));
    const res = await runBackfill({
      outDir: dst, districts: [d], from: '200507', to: '202609', apply: false, env: {}, expectInserts: null, approveExistingUpdates: false,
      reserveCalls: 2000, maxCalls: null, refetch: false, allowedDistricts: leaves, knownCodes: known, retryPartial: false,
    }, {
      fetchPage: async () => { fetches++; return { kind: 'NETWORK', detail: 'REPLAN_ZERO_NO_FETCH' }; },
      quotaRemaining: () => null, readDb: realReadDb,
      applyCell: async () => { throw new Error('REPLAN_ZERO_NEVER_APPLIES'); }, now: () => new Date(), log: () => {},
    });
    const s = res.summary;
    out[d] = { relabeled, cellsByState: s.cellsByState, sourceRows: s.source.rows, pendingInserts: s.plan.inserts, existingMatched: s.plan.existingMatched, existingUpdates: s.plan.existingUpdates, review: s.plan.review, calls: s.calls, writes: s.writes };
    console.error(`${d} done`);
  }
  console.log(JSON.stringify({ at: new Date().toISOString(), mode: 'REPLAN_ZERO_ON_COPY', molitFetchAttempts: fetches, districts: out }, null, 1));
}

main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
