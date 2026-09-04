/**
 * TRADE_CANCELLATION_RESYNC_V2 — 부산 최근 24개월 cancellation completeness 보강.
 *
 * TRADE_CANCELLATION_RESYNC_V1(2026-08-30)이 검증한 범위는 "현재월+직전12개월"(13개월)
 * 뿐이다. 이 스크립트는 그 이전 구간(13~24개월 전, 약 11개월)의 dealCanceled 정확성을
 * 보강해 24개월 전체를 검증 범위로 확대한다.
 *
 * 절대 원칙(V1과 동일 + 신규):
 *  - `--apply` 없이는 DB에 절대 쓰지 않는다(기본은 dry-run).
 *  - idempotent: 같은 fetch를 몇 번 실행해도 자연키 upsert라 row 수가 늘지 않는다.
 *  - §14 비대칭 가드(V1에는 없던 신규 요구) — dealCanceled는 false→true로만 갱신한다.
 *    기존에 이미 true인 row를 최신 fetch가 false라고 보고해도 **절대 덮어쓰지 않는다**
 *    (source가 취소를 "취소"하는 semantics가 명확히 증명되지 않았으므로 보수적으로
 *    기존 값을 보존 — 스펙 §14 그대로). 이 판단이 이 스크립트를
 *    backfill-trade-history.ts의 범용 upsertRows()를 그대로 쓰지 않고 별도로 작성한
 *    유일한 이유다 — fetch/parse/rate-limit 로직 자체는 전부 재사용.
 *  - 자연키 매칭이 모호하면(같은 자연키인데 aptName/dong이 기존 row와 다름 — occurrence
 *    ordering이 fetch마다 달라질 수 있는 알려진 edge case) CONFLICT로 분류하고 건드리지
 *    않는다(§10 안전하지 않은 매칭 금지).
 *
 * 사용법:
 *   # dry-run, older 11개월(기본 범위)
 *   npx ts-node --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     scripts/resync-cancellation-v2.ts
 *
 *   # 실제 반영
 *   ... scripts/resync-cancellation-v2.ts --apply
 *
 *   # 범위 직접 지정(예: 전체 24개월 read-only 검증)
 *   ... scripts/resync-cancellation-v2.ts --from=202409 --to=202608
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { PrismaClient, Prisma } from '@prisma/client';
import { fetchOneRegionMonth, monthsInRange, makeLogger } from './backfill-trade-history';
import { normalizeMolitItemsToTradeRows, type TradeRowInput } from './trade-history-logic';
import { classifyRow, type RowClassificationKind } from './write-policy-logic';

export const prisma = new PrismaClient();

// TRADE_CANCELLATION_RESYNC_V1과 동일 원칙 — getSigunguListForSido() 자동 조회 대신
// 승인된 고정 목록을 쓴다(외부 REGCODE_PROXY 의존 최소화, §7 범위 명시).
const BUSAN_16 = [
  '26110', '26140', '26170', '26200', '26230', '26260', '26290', '26320',
  '26350', '26380', '26410', '26440', '26470', '26500', '26530', '26710',
];

export const RESYNC_MANIFEST_DIR = path.resolve(__dirname, '../data/trade-history');
export const RESYNC_MANIFEST_PATH = path.join(RESYNC_MANIFEST_DIR, 'cancellation-resync-v2-manifest.json');

type CellStatus = 'COMPLETE' | 'EMPTY_VALID' | 'FAILED' | 'INVALID';
interface CellEntry {
  status: CellStatus;
  fetched: number;
  invalidRows: number;
  insertCount: number;
  updateFalseToTrue: number;
  updateTrueToFalseSkipped: number;
  conflicts: number;
  reviewRequired: number;
  at: string;
}
type ResyncManifest = Record<string, CellEntry>; // key = `${lawdCd}:${dealYmd}`

function loadResyncManifest(): ResyncManifest {
  if (!fs.existsSync(RESYNC_MANIFEST_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(RESYNC_MANIFEST_PATH, 'utf-8'));
  } catch {
    return {};
  }
}
function saveResyncManifest(m: ResyncManifest) {
  if (!fs.existsSync(RESYNC_MANIFEST_DIR)) fs.mkdirSync(RESYNC_MANIFEST_DIR, { recursive: true });
  fs.writeFileSync(RESYNC_MANIFEST_PATH, JSON.stringify(m, null, 0));
}

function parseArgs() {
  const args = process.argv.slice(2);
  const has = (flag: string) => args.includes(flag);
  const get = (flag: string) => {
    const prefix = `${flag}=`;
    const hit = args.find((a) => a.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : undefined;
  };
  // §4 — 이미 검증된 최근 13개월(recentMonths(13)와 동일 계산, 2026-08-30 실행)을
  // 재작성하지 않기 위해 기본 범위는 "older 11개월"(13~24개월 전)로 고정한다.
  // recentMonths(n)과 동일한 month-arithmetic 스타일을 그대로 재사용한 계산식.
  const now = new Date();
  const olderToDate = new Date(now.getFullYear(), now.getMonth() - 13, 1); // 13개월 전 달(=older 구간의 마지막 달)
  const olderToStr = `${olderToDate.getFullYear()}${String(olderToDate.getMonth() + 1).padStart(2, '0')}`;
  const olderFromDate = new Date(now.getFullYear(), now.getMonth() - 23, 1); // 24개월 전 달(=older 구간의 첫 달)
  const olderFromStr = `${olderFromDate.getFullYear()}${String(olderFromDate.getMonth() + 1).padStart(2, '0')}`;

  return {
    apply: has('--apply'),
    lawdCdFilter: get('--lawdCd') ? get('--lawdCd')!.split(',').map((s) => s.trim()) : BUSAN_16,
    from: get('--from') || olderFromStr,
    to: get('--to') || olderToStr,
    maxBatches: get('--maxBatches') ? parseInt(get('--maxBatches')!, 10) : Infinity,
  };
}

const CHUNK_SIZE = 500;

interface RowClassification {
  // 유니온을 여기서 다시 적지 않고 write-policy-logic의 정의를 그대로 쓴다 — 분류가
  // 추가될 때마다 이 파일이 조용히 어긋나는 것을 막는다(TRADE_REGISTRY_DATA_V1.1에서 실제 발생).
  kind: RowClassificationKind;
  fresh: TradeRowInput;
  existingId?: number;
}

function naturalKeyStr(r: { groupKeyStr: string; dealAmount: number; dealDate: string; floor: number; occurrenceIndex: number }): string {
  return `${r.groupKeyStr}|${r.dealAmount}|${r.dealDate}|${r.floor}|${r.occurrenceIndex}`;
}

async function classifyAndWrite(
  lawdCd: string,
  dealYmd: string,
  freshRows: TradeRowInput[],
  apply: boolean
): Promise<{ insertCount: number; updateFalseToTrue: number; updateTrueToFalseSkipped: number; conflicts: number; reviewRequired: number }> {
  const existing = await prisma.apartmentTradeHistory.findMany({
    where: { lawdCd, dealYmd },
    // TRADE_REGISTRY_DATA_V1.1 — classifyRow가 registryDate를 요구한다(select 누락과 실제 NULL을
    // 구분하기 위해 필수 필드). 이 스크립트는 취소 resync 전용이라 `updateRegistryOnly` 분류는
    // 아래 필터에서 어느 쪽에도 잡히지 않아 **아무 것도 쓰지 않는다**(기존 'noop'과 동일 동작).
    select: { id: true, groupKeyStr: true, dealAmount: true, dealDate: true, floor: true, occurrenceIndex: true, dealCanceled: true, aptName: true, dong: true, registryDate: true },
  });
  const existingMap = new Map<string, (typeof existing)[number]>();
  for (const e of existing) {
    if (e.floor == null) continue; // 자연키에 floor가 필수라 null row는 매칭 대상 아님(기존 정책과 동일)
    const key = naturalKeyStr({ groupKeyStr: e.groupKeyStr, dealAmount: e.dealAmount, dealDate: e.dealDate.toISOString().slice(0, 10), floor: e.floor, occurrenceIndex: e.occurrenceIndex });
    existingMap.set(key, e);
  }

  // §11/§12/§14 결정 로직은 write-policy-logic.ts의 순수 함수 classifyRow()로
  // 분리했다(테스트 가능 — resync-cancellation-v2.ts 자체는 DB I/O 때문에
  // 순수하지 않음). aptSeq 없는 새 row를 name+dong fallback만으로 canonical
  // apartment identity에 편입시키지 않는다는 §11/§12 가드가 이 함수 안에 있다
  // (부산 서구 등 7개 지역 654건 실측 aptSeq missing=0%로, 기존 부산 데이터
  // 동작에는 영향 없음을 확인했다 — §12 STOP 조건 미해당).
  const classified: RowClassification[] = freshRows.map((fresh) => {
    const match = existingMap.get(naturalKeyStr(fresh));
    const kind = classifyRow(fresh, match);
    return { kind, fresh, existingId: match?.id };
  });

  const inserts = classified.filter((c) => c.kind === 'insert');
  const flips = classified.filter((c) => c.kind === 'updateFalseToTrue');
  const skipped = classified.filter((c) => c.kind === 'updateTrueToFalseSkipped');
  const conflicts = classified.filter((c) => c.kind === 'conflict');
  const reviewRequired = classified.filter((c) => c.kind === 'reviewRequired');

  if (apply) {
    // §17 — small batch(CHUNK_SIZE), region-month 단위가 이미 자연스러운 batch 경계.
    const toWrite = [...inserts, ...flips];
    for (let i = 0; i < toWrite.length; i += CHUNK_SIZE) {
      const chunk = toWrite.slice(i, i + CHUNK_SIZE);
      await prisma.$transaction(
        chunk.map((c) => {
          const row = c.fresh;
          if (c.kind === 'insert') {
            return prisma.apartmentTradeHistory.create({
              data: {
                source: 'MOLIT_APT_TRADE',
                lawdCd: row.lawdCd,
                dealYmd: row.dealYmd,
                aptSeq: row.aptSeq,
                identityKey: row.identityKey,
                dealType: row.dealType,
                groupKeyStr: row.groupKeyStr,
                aptName: row.aptName,
                dong: row.dong,
                jibun: row.jibun,
                exclusiveArea: new Prisma.Decimal(row.exclusiveArea),
                dealAmount: row.dealAmount,
                dealYear: row.dealYear,
                dealMonth: row.dealMonth,
                dealDay: row.dealDay,
                dealDate: new Date(`${row.dealDate}T00:00:00.000Z`),
                floor: row.floor,
                buildYear: row.buildYear,
                dealCanceled: row.dealCanceled,
                cancelDate: row.cancelDate,
                registryDate: row.registryDate,
                occurrenceIndex: row.occurrenceIndex,
                rawUid: row.rawUid,
                sourceFetchedAt: new Date(),
              },
            });
          }
          // updateFalseToTrue — dealCanceled/cancelDate/registryDate만 갱신(자연키 불변).
          return prisma.apartmentTradeHistory.update({
            where: { id: c.existingId! },
            data: {
              dealCanceled: true,
              cancelDate: row.cancelDate,
              registryDate: row.registryDate,
              sourceFetchedAt: new Date(),
            },
          });
        })
      );
    }
  }

  return { insertCount: inserts.length, updateFalseToTrue: flips.length, updateTrueToFalseSkipped: skipped.length, conflicts: conflicts.length, reviewRequired: reviewRequired.length };
}

async function main() {
  const opts = parseArgs();
  const log = makeLogger(path.resolve(__dirname, '_resync_cancellation_v2_results'));
  log(`START apply=${opts.apply} lawdCds=${opts.lawdCdFilter.length} from=${opts.from} to=${opts.to} maxBatches=${opts.maxBatches}`);

  const months = monthsInRange(opts.from, opts.to);
  log(`MONTHS ${months.length} (${months[0]} ~ ${months[months.length - 1]})`);

  let allTasks: { lawdCd: string; dealYmd: string }[] = [];
  for (const lawdCd of opts.lawdCdFilter) {
    for (const dealYmd of months) allTasks.push({ lawdCd, dealYmd });
  }
  if (allTasks.length > opts.maxBatches) {
    log(`LIMIT applying maxBatches=${opts.maxBatches} out of total=${allTasks.length}`);
    allTasks = allTasks.slice(0, opts.maxBatches);
  }
  log(`TOTAL district-month cells this run: ${allTasks.length}`);

  const manifest = loadResyncManifest();

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

  const LOG_EVERY = 10;
  for (let i = 0; i < allTasks.length; i++) {
    const t = allTasks[i];
    const key = `${t.lawdCd}:${t.dealYmd}`;
    const result = await fetchOneRegionMonth(t.lawdCd, t.dealYmd);

    if (result.failed) {
      manifest[key] = { status: 'FAILED', fetched: 0, invalidRows: 0, insertCount: 0, updateFalseToTrue: 0, updateTrueToFalseSkipped: 0, conflicts: 0, reviewRequired: 0, at: new Date().toISOString() };
      cellFailed++;
      log(`FAILED ${key}`);
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
        // §7-INVALID(cell-level) — 자연키 매칭 자체가 모호한 conflict가 있으면 이 cell은
        // 완전한 SAFE 판정 대상이 아니다(개별 row invalid는 §8 원칙대로 별도 카운트만).
        const status: CellStatus = conflicts > 0 ? 'INVALID' : 'COMPLETE';
        if (status === 'INVALID') cellInvalid++;
        else cellComplete++;
        manifest[key] = { status, fetched: result.items.length, invalidRows: invalid.length, insertCount, updateFalseToTrue, updateTrueToFalseSkipped, conflicts, reviewRequired, at: new Date().toISOString() };
      }
    }

    if (opts.apply && (i + 1) % LOG_EVERY === 0) saveResyncManifest(manifest);
    if ((i + 1) % LOG_EVERY === 0 || i === allTasks.length - 1) {
      const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
      log(
        `PROGRESS ${i + 1}/${allTasks.length} fetched=${totalFetched} invalidRows=${totalInvalidRows} insert=${totalInsert} flipFalseToTrue=${totalFlip} skippedTrueToFalse=${totalSkippedTrueToFalse} conflicts=${totalConflicts} reviewRequired=${totalReviewRequired} COMPLETE=${cellComplete} EMPTY_VALID=${cellEmptyValid} FAILED=${cellFailed} INVALID=${cellInvalid} elapsed=${elapsedSec}s`
      );
    }
  }

  if (opts.apply) saveResyncManifest(manifest);

  const safe = cellFailed === 0 && cellInvalid === 0;
  log(
    `DONE mode=${opts.apply ? 'APPLY' : 'DRY_RUN'} cells=${allTasks.length} COMPLETE=${cellComplete} EMPTY_VALID=${cellEmptyValid} FAILED=${cellFailed} INVALID=${cellInvalid} ` +
      `insert=${totalInsert} flipFalseToTrue=${totalFlip} skippedTrueToFalse=${totalSkippedTrueToFalse} conflicts=${totalConflicts} reviewRequired=${totalReviewRequired} SAFE_GATE=${safe} elapsedSec=${((Date.now() - startedAt) / 1000).toFixed(1)}`
  );

  return {
    cells: allTasks.length,
    cellComplete,
    cellEmptyValid,
    cellFailed,
    cellInvalid,
    totalFetched,
    totalInvalidRows,
    totalInsert,
    totalFlip,
    totalSkippedTrueToFalse,
    totalConflicts,
    totalReviewRequired,
    safe,
  };
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

export { main, parseArgs, classifyAndWrite };
