/**
 * RENT_TRADE_HISTORY_V1 PHASE B §36/§37 — correction policy 실측 실험.
 *
 * PHASE A §17은 RTMSDataSvcAptRent 응답에 취소/정정 신호가 전혀 없어(§7) 이미 공개된
 * rent 레코드를 MOLIT가 나중에 그 자리에서 고쳐 쓰는지, 아니면 새 레코드만 추가하는지
 * source만으로는 판단할 수 없다고 결론지었다. 이 스크립트는 실제로 같은 지역-월
 * cell을 시차를 두고 두 번 raw 조회해 자연키 단위로 diff한다 — 절대 추측하지 않는다
 * (§37: 관측 안 됐다고 "correction 없음"이라 단정 금지, OBSERVED/NOT_OBSERVED_IN_SAMPLE/
 * UNKNOWN으로 구분).
 *
 * 읽기 전용(DB write 없음) — 순수 raw item 스냅샷을 로컬 JSON에 저장하고 비교한다.
 *
 * 사용법:
 *   # 1) 스냅샷 A 캡처(세션 시작 시점)
 *   ...ts-node correction-experiment.ts --capture --lawdCd=26140,26230,26350 \
 *     --dealYmd=202607,202607,202412
 *     (lawdCd와 dealYmd는 순서대로 1:1 페어링 — 서로 다른 구/월 조합을 각각 지정)
 *
 *   # 2) 스냅샷 B 캡처(같은 인자, 시간이 지난 뒤 재실행)
 *
 *   # 3) 두 스냅샷 비교
 *   ...ts-node correction-experiment.ts --diff --lawdCd=26140,26230,26350 \
 *     --dealYmd=202607,202607,202412
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { fetchRentRegionMonth } from './rent-molit-fetch';
import { normalizeMolitRentItemsToRentRows, type RentRowInput } from './rent-history-logic';

const SNAPSHOT_DIR = path.resolve(__dirname, '_correction_experiment_snapshots');

function parseArgs() {
  const args = process.argv.slice(2);
  const has = (flag: string) => args.includes(flag);
  const get = (flag: string) => {
    const prefix = `${flag}=`;
    const hit = args.find((a) => a.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : undefined;
  };
  const lawdCdArg = get('--lawdCd');
  const dealYmdArg = get('--dealYmd');
  if (!lawdCdArg || !dealYmdArg) throw new Error('--lawdCd, --dealYmd는 필수입니다(콤마로 구분된 1:1 페어 목록).');
  const lawdCdList = lawdCdArg.split(',').map((s) => s.trim());
  const dealYmdList = dealYmdArg.split(',').map((s) => s.trim());
  if (lawdCdList.length !== dealYmdList.length) throw new Error('--lawdCd와 --dealYmd 개수가 일치해야 합니다.');
  return { capture: has('--capture'), diff: has('--diff'), cells: lawdCdList.map((lawdCd, i) => ({ lawdCd, dealYmd: dealYmdList[i] })) };
}

interface Snapshot {
  lawdCd: string;
  dealYmd: string;
  capturedAt: string;
  status: string;
  rawItemCount: number;
  rows: RentRowInput[];
}

function snapshotPath(lawdCd: string, dealYmd: string, at: string): string {
  return path.join(SNAPSHOT_DIR, `${lawdCd}_${dealYmd}_${at.replace(/[:.]/g, '-')}.json`);
}

function listSnapshotsFor(lawdCd: string, dealYmd: string): string[] {
  if (!fs.existsSync(SNAPSHOT_DIR)) return [];
  return fs
    .readdirSync(SNAPSHOT_DIR)
    .filter((f) => f.startsWith(`${lawdCd}_${dealYmd}_`))
    .sort() // 파일명에 ISO timestamp 포함 — 문자열 정렬 = 시간순 정렬
    .map((f) => path.join(SNAPSHOT_DIR, f));
}

function naturalKeyStrOf(row: RentRowInput): string {
  return `${row.groupKeyStr}::${row.deposit}::${row.monthlyRent}::${row.dealDate}::${row.floor}::${row.occurrenceIndex}`;
}

const CONTENT_FIELDS = ['aptName', 'dong', 'jibun', 'buildYear', 'contractType', 'contractTerm', 'preDeposit', 'preMonthlyRent', 'useRenewalRight'] as const;

async function capture(cells: { lawdCd: string; dealYmd: string }[]) {
  if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const capturedAt = new Date().toISOString();
  for (const { lawdCd, dealYmd } of cells) {
    const result = await fetchRentRegionMonth(lawdCd, dealYmd);
    const { rows } = normalizeMolitRentItemsToRentRows(result.items, lawdCd, dealYmd);
    const snapshot: Snapshot = { lawdCd, dealYmd, capturedAt, status: result.status, rawItemCount: result.collectedCount, rows };
    const outPath = snapshotPath(lawdCd, dealYmd, capturedAt);
    fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
    console.log(`CAPTURED ${lawdCd}:${dealYmd} status=${result.status} rows=${rows.length} -> ${outPath}`);
  }
}

function diffOne(lawdCd: string, dealYmd: string) {
  const files = listSnapshotsFor(lawdCd, dealYmd);
  if (files.length < 2) {
    console.log(`SKIP ${lawdCd}:${dealYmd} — 스냅샷이 ${files.length}개뿐(최소 2개 필요, --capture를 두 번 실행).`);
    return { lawdCd, dealYmd, verdict: 'UNKNOWN' as const, reason: 'INSUFFICIENT_SNAPSHOTS' };
  }
  const older: Snapshot = JSON.parse(fs.readFileSync(files[0], 'utf-8'));
  const newer: Snapshot = JSON.parse(fs.readFileSync(files[files.length - 1], 'utf-8'));
  const gapMs = new Date(newer.capturedAt).getTime() - new Date(older.capturedAt).getTime();

  const olderMap = new Map(older.rows.map((r) => [naturalKeyStrOf(r), r]));
  const newerMap = new Map(newer.rows.map((r) => [naturalKeyStrOf(r), r]));

  const added: string[] = [];
  const removed: string[] = [];
  const changed: { key: string; diffFields: string[] }[] = [];

  for (const [k, row] of newerMap) {
    if (!olderMap.has(k)) added.push(k);
  }
  for (const [k, row] of olderMap) {
    if (!newerMap.has(k)) removed.push(k);
  }
  for (const [k, oldRow] of olderMap) {
    const newRow = newerMap.get(k);
    if (!newRow) continue;
    const diffFields = CONTENT_FIELDS.filter((f) => (oldRow as any)[f] !== (newRow as any)[f]);
    if (diffFields.length > 0) changed.push({ key: k, diffFields });
  }

  const observed = added.length > 0 || removed.length > 0 || changed.length > 0;
  console.log(
    `DIFF ${lawdCd}:${dealYmd} gap=${(gapMs / 60000).toFixed(1)}min older=${older.capturedAt}(${older.rows.length}행) newer=${newer.capturedAt}(${newer.rows.length}행) added=${added.length} removed=${removed.length} changed=${changed.length}`
  );
  if (changed.length > 0) console.log(`  CHANGED sample:`, changed.slice(0, 5));
  if (removed.length > 0) console.log(`  REMOVED sample:`, removed.slice(0, 5));
  if (added.length > 0) console.log(`  ADDED sample:`, added.slice(0, 5));

  return {
    lawdCd,
    dealYmd,
    gapMinutes: gapMs / 60000,
    olderCapturedAt: older.capturedAt,
    newerCapturedAt: newer.capturedAt,
    olderRowCount: older.rows.length,
    newerRowCount: newer.rows.length,
    added: added.length,
    removed: removed.length,
    changed: changed.length,
    verdict: observed ? ('OBSERVED' as const) : ('NOT_OBSERVED_IN_SAMPLE' as const),
  };
}

async function main() {
  const args = parseArgs();
  if (args.capture) {
    await capture(args.cells);
    return;
  }
  if (args.diff) {
    const results = args.cells.map((c) => diffOne(c.lawdCd, c.dealYmd));
    const outPath = path.resolve(__dirname, 'output-phase-b-correction-experiment.json');
    fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
    console.log(`\n결과 저장: ${outPath}`);
    return;
  }
  throw new Error('--capture 또는 --diff 중 하나를 지정해야 합니다.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
