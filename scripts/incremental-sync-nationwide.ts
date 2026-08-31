/**
 * TRADE_DB_FIRST_V1 STEP F — 전국 확장 가능한 incremental sync engine.
 *
 * 이 스크립트는 "전국 20년치를 한 번에 채우는" 도구가 아니다(§4 명시적 금지).
 * 정상 운영 시 각 지역이 "마지막으로 완료된 달" 이후만 처리하고, 신고/취소 반영
 * 지연(§9 실측: dealDate 대비 cancelDate lag p50=1개월/p90=3개월/p99=12개월,
 * 855,045건 이상 유효 부산 실거래 기준)을 흡수하기 위해 최근 N개월(기본 3개월,
 * sync-trade-history.ts의 DEFAULT_ROLLING_MONTHS와 동일값 재사용 — 새로 발명한
 * 숫자가 아니다)을 매 실행마다 재검증한다. 지역이 처음(manifest에 기록 없음)이면
 * 이 overlap 구간만 처리하고 전체 과거 이력은 건드리지 않는다 — 딥 백필은 여전히
 * `backfill-trade-history.ts`의 명시적 책임(별도 실행/승인)으로 남긴다.
 *
 * 재사용(새로 만들지 않음):
 *  - `fetchOneRegionMonth()`(backfill-trade-history.ts) — 동시 1, 최소 간격
 *    350ms + 스로틀 감지 지수 백오프. 순차 루프로만 호출해 "bounded concurrency"를
 *    이미 검증된 방식(동시성=1)으로 만족한다(§21) — 새 concurrency pool 없음.
 *  - `normalizeMolitItemsToTradeRows()`(trade-history-logic.ts, cdealType/cdealDay
 *    파서 포함) — 그대로.
 *  - `classifyAndWrite()`(resync-cancellation-v2.ts) — dealCanceled는 false→true만
 *    반영하고 true→false는 절대 되돌리지 않는 §14 가드, 자연키 dedupe, aptName/dong
 *    불일치 시 CONFLICT 분류까지 전부 그대로 재사용(region/dealYmd 인자만 받는 순수
 *    오케스트레이션 함수라 이 STEP에도 그대로 맞는다). CHUNK_SIZE=500 트랜잭션
 *    batching도 그대로 상속(§22 row-by-row 금지 요건 충족).
 *  - `getSidoList()`/`getSigunguListForSido()`(region-utils.ts) — RegionSelectModal이
 *    이미 쓰는 전국 법정동코드 프록시 기반 동적 조회. 하드코딩된 지역 목록/이름
 *    substring 매칭 없음(§7 금지 사항 충족).
 *
 * 신규로 작성한 부분: (a) 전국 지역 enumeration 오케스트레이션, (b) 지역별
 * "마지막 완료 달" 기반 incremental month 계산(§8), (c) 전용 manifest
 * (`data/trade-history/nationwide-sync-manifest.json`, busan-manifest.json과
 * 완전히 분리 — 기존 부산 backfill 상태를 건드리지 않음).
 *
 * 사용법:
 *   # dry-run, QA 범위(부산 서구 + 서울 강남구 + 대구 중구, 최근 1개월)
 *   npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     scripts/incremental-sync-nationwide.ts --lawdCd=26140,11680,27110 --overlapMonths=1
 *
 *   # 실제 반영(같은 범위)
 *   ... --apply --lawdCd=26140,11680,27110 --overlapMonths=1
 *
 *   # 전국 전체(향후, 이번 STEP에서는 실행하지 않음 — §4)
 *   ... --apply
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { fetchOneRegionMonth, makeLogger } from './backfill-trade-history';
import { normalizeMolitItemsToTradeRows } from './trade-history-logic';
import { classifyAndWrite, prisma } from './resync-cancellation-v2';
import { getSidoList, getSigunguListForSido } from '../src/lib/region-utils';
import { computeMonthsForRegion, DEFAULT_OVERLAP_MONTHS, type CellStatus, type NationwideManifest } from './incremental-sync-logic';

export { computeMonthsForRegion, DEFAULT_OVERLAP_MONTHS };
export type { CellStatus, NationwideManifest };

export const NATIONWIDE_MANIFEST_DIR = path.resolve(__dirname, '../data/trade-history');
export const NATIONWIDE_MANIFEST_PATH = path.join(NATIONWIDE_MANIFEST_DIR, 'nationwide-sync-manifest.json');

export function loadNationwideManifest(): NationwideManifest {
  if (!fs.existsSync(NATIONWIDE_MANIFEST_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(NATIONWIDE_MANIFEST_PATH, 'utf-8'));
  } catch {
    return {};
  }
}
export function saveNationwideManifest(m: NationwideManifest) {
  if (!fs.existsSync(NATIONWIDE_MANIFEST_DIR)) fs.mkdirSync(NATIONWIDE_MANIFEST_DIR, { recursive: true });
  fs.writeFileSync(NATIONWIDE_MANIFEST_PATH, JSON.stringify(m, null, 0));
}

/** §7 — 전국 지역 enumeration. 하드코딩 목록 없음, 기존 RegionSelectModal과 동일한
 * 프록시 기반 동적 조회(getSidoList/getSigunguListForSido)만 재사용한다. */
export async function enumerateNationwideRegions(sidoFilter?: string[]): Promise<{ code: string; name: string }[]> {
  const sidoList = await getSidoList();
  const targets = sidoFilter ? sidoList.filter((s) => sidoFilter.includes(s.code)) : sidoList;
  const all: { code: string; name: string }[] = [];
  for (const sido of targets) {
    const sigunguList = await getSigunguListForSido(sido.code);
    for (const s of sigunguList) all.push({ code: s.code.substring(0, 5), name: s.name });
  }
  return all;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const has = (flag: string) => args.includes(flag);
  const get = (flag: string) => {
    const prefix = `${flag}=`;
    const hit = args.find((a) => a.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : undefined;
  };
  return {
    apply: has('--apply'),
    lawdCdFilter: get('--lawdCd') ? get('--lawdCd')!.split(',').map((s) => s.trim()) : undefined,
    sidoFilter: get('--sido') ? get('--sido')!.split(',').map((s) => s.trim()) : undefined,
    overlapMonths: get('--overlapMonths') ? parseInt(get('--overlapMonths')!, 10) : DEFAULT_OVERLAP_MONTHS,
    maxCells: get('--maxCells') ? parseInt(get('--maxCells')!, 10) : Infinity,
  };
}

async function main() {
  const opts = parseArgs();
  const log = makeLogger(path.resolve(__dirname, '_incremental_sync_nationwide_results'));

  let regions: { code: string; name: string }[];
  if (opts.lawdCdFilter) {
    regions = opts.lawdCdFilter.map((code) => ({ code, name: code }));
  } else {
    regions = await enumerateNationwideRegions(opts.sidoFilter);
  }
  log(`REGIONS resolved=${regions.length}${opts.sidoFilter ? ` (sido=${opts.sidoFilter.join(',')})` : ''}`);

  const manifest = loadNationwideManifest();
  const now = new Date();

  let allTasks: { lawdCd: string; dealYmd: string }[] = [];
  for (const region of regions) {
    const months = computeMonthsForRegion(region.code, manifest, now, opts.overlapMonths);
    for (const dealYmd of months) allTasks.push({ lawdCd: region.code, dealYmd });
  }
  if (allTasks.length > opts.maxCells) {
    log(`LIMIT applying maxCells=${opts.maxCells} out of total=${allTasks.length}`);
    allTasks = allTasks.slice(0, opts.maxCells);
  }
  log(`START apply=${opts.apply} regions=${regions.length} overlapMonths=${opts.overlapMonths} cells=${allTasks.length}`);

  let totalFetched = 0;
  let totalInvalidRows = 0;
  let totalInsert = 0;
  let totalFlip = 0;
  let totalSkippedTrueToFalse = 0;
  let totalConflicts = 0;
  let totalReviewRequired = 0;
  let cellComplete = 0;
  let cellEmptyValid = 0;
  let cellFailed = 0;
  let cellInvalid = 0;
  const startedAt = Date.now();

  const LOG_EVERY = 20;
  // §21 bounded concurrency — fetchOneRegionMonth 자체가 이미 동시 1 + 최소 간격을
  // 강제하므로(backfill-trade-history.ts §RATE LIMIT), 여기서도 순차 for-loop만
  // 쓴다. 새 concurrency pool을 만들지 않는다.
  for (let i = 0; i < allTasks.length; i++) {
    const t = allTasks[i];
    const key = `${t.lawdCd}:${t.dealYmd}`;
    const result = await fetchOneRegionMonth(t.lawdCd, t.dealYmd);

    if (result.failed) {
      manifest[key] = { status: 'FAILED', fetched: 0, invalidRows: 0, insertCount: 0, updateFalseToTrue: 0, updateTrueToFalseSkipped: 0, conflicts: 0, reviewRequired: 0, at: new Date().toISOString() };
      cellFailed++;
    } else {
      const { rows, invalid } = normalizeMolitItemsToTradeRows(result.items as any[], t.lawdCd, t.dealYmd);
      totalFetched += result.items.length;
      totalInvalidRows += invalid.length;

      if (rows.length === 0) {
        manifest[key] = { status: 'EMPTY_VALID', fetched: result.items.length, invalidRows: invalid.length, insertCount: 0, updateFalseToTrue: 0, updateTrueToFalseSkipped: 0, conflicts: 0, reviewRequired: 0, at: new Date().toISOString() };
        cellEmptyValid++;
      } else {
        const { insertCount, updateFalseToTrue, updateTrueToFalseSkipped, conflicts, reviewRequired } = await classifyAndWrite(t.lawdCd, t.dealYmd, rows, opts.apply);
        totalInsert += insertCount;
        totalFlip += updateFalseToTrue;
        totalSkippedTrueToFalse += updateTrueToFalseSkipped;
        totalConflicts += conflicts;
        totalReviewRequired += reviewRequired;
        const status: CellStatus = conflicts > 0 ? 'INVALID' : 'COMPLETE';
        if (status === 'INVALID') cellInvalid++;
        else cellComplete++;
        manifest[key] = { status, fetched: result.items.length, invalidRows: invalid.length, insertCount, updateFalseToTrue, updateTrueToFalseSkipped, conflicts, reviewRequired, at: new Date().toISOString() };
      }
    }

    if (opts.apply && (i + 1) % LOG_EVERY === 0) saveNationwideManifest(manifest);
    if ((i + 1) % LOG_EVERY === 0 || i === allTasks.length - 1) {
      const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
      log(
        `PROGRESS ${i + 1}/${allTasks.length} fetched=${totalFetched} invalidRows=${totalInvalidRows} insert=${totalInsert} flipFalseToTrue=${totalFlip} skippedTrueToFalse=${totalSkippedTrueToFalse} conflicts=${totalConflicts} reviewRequired=${totalReviewRequired} COMPLETE=${cellComplete} EMPTY_VALID=${cellEmptyValid} FAILED=${cellFailed} INVALID=${cellInvalid} elapsed=${elapsedSec}s`
      );
    }
  }

  if (opts.apply) saveNationwideManifest(manifest);

  const safe = cellFailed === 0 && cellInvalid === 0;
  log(
    `DONE mode=${opts.apply ? 'APPLY' : 'DRY_RUN'} regions=${regions.length} cells=${allTasks.length} COMPLETE=${cellComplete} EMPTY_VALID=${cellEmptyValid} FAILED=${cellFailed} INVALID=${cellInvalid} ` +
      `insert=${totalInsert} flipFalseToTrue=${totalFlip} skippedTrueToFalse=${totalSkippedTrueToFalse} conflicts=${totalConflicts} reviewRequired=${totalReviewRequired} SAFE_GATE=${safe} elapsedSec=${((Date.now() - startedAt) / 1000).toFixed(1)}`
  );

  return { regions: regions.length, cells: allTasks.length, cellComplete, cellEmptyValid, cellFailed, cellInvalid, totalFetched, totalInvalidRows, totalInsert, totalFlip, totalSkippedTrueToFalse, totalConflicts, totalReviewRequired, safe };
}

if (require.main === module) {
  main()
    .then(() => prisma.$disconnect())
    .then(() => process.exit(0))
    .catch(async (e) => {
      console.error(e);
      await prisma.$disconnect();
      process.exit(1);
    });
}

export { main, parseArgs };
