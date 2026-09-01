/**
 * RENT_TRADE_HISTORY_V1 PHASE B — 전월세(jeonse/wolse) sync 엔진 + CLI.
 *
 * 절대 원칙(§0/§1/§50):
 *  - `--apply` 없이는 DB에 절대 쓰지 않는다(기본 dry-run).
 *  - `--lawdCd`/`--from`/`--to`는 전부 필수다 — 실수로 전국/전체기간이 돌아가는 것을
 *    막기 위해 무인 default를 두지 않는다(sale의 backfill-trade-history.ts는 sido 전체
 *    기본값이 있지만, 이번 PHASE는 "부산 24개월 backfill은 PHASE C" 원칙이라 여기서는
 *    범위를 항상 명시적으로 요구한다).
 *  - idempotent: 자연키(occurrenceIndex 포함) upsert. 같은 fetch를 반복 실행해도 row
 *    수가 늘지 않는다.
 *  - 한 트랜잭션에 대량 row를 넣지 않는다(청크 500, sale과 동일 관례, §53).
 *  - correction 정책이 아직 미검증(§17/§36)이므로, 이번 PHASE의 write는 "안전한
 *    insert/idempotency" 중심이다 — sale의 upsert 패턴(자연키 밖 필드만 갱신)을 그대로
 *    따르되, dry-run/검증 리포트에서는 실제 내용 변경(wouldUpdate)과 단순 확인-시각
 *    갱신을 구분해서 보고한다(§46).
 *
 * 사용법:
 *   # 1) dry-run(필수)
 *   npx ts-node --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js scripts/rent-trade-history/sync-rent-history.ts \
 *     --lawdCd=26140,26230,26350 --from=202608 --to=202608
 *
 *   # 2) 실제 반영(승인된 validation write 범위 내에서만)
 *   ... --apply --lawdCd=26140,26230,26350 --from=202608 --to=202608
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { PrismaClient, Prisma } from '@prisma/client';
import { fetchRentRegionMonth } from './rent-molit-fetch';
import { normalizeMolitRentItemsToRentRows, type RentRowInput } from './rent-history-logic';

export const prisma = new PrismaClient();

export const MANIFEST_DIR = path.resolve(__dirname, '../../data/rent-trade-history');
export const MANIFEST_PATH = path.join(MANIFEST_DIR, 'busan-manifest.json');

function parseArgs() {
  const args = process.argv.slice(2);
  const has = (flag: string) => args.includes(flag);
  const get = (flag: string) => {
    const prefix = `${flag}=`;
    const hit = args.find((a) => a.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : undefined;
  };
  const lawdCdArg = get('--lawdCd');
  const fromArg = get('--from');
  const toArg = get('--to');
  // §50 GUARDRAILS — 무인 default 전체 history/전체 지역 금지. 셋 다 명시하지 않으면
  // 즉시 에러로 중단한다(부분 실행 방지).
  if (!lawdCdArg || !fromArg || !toArg) {
    throw new Error('§50 GUARDRAILS: --lawdCd, --from, --to는 모두 필수입니다. 예: --lawdCd=26140,26230 --from=202608 --to=202608');
  }
  return {
    apply: has('--apply'),
    lawdCdList: lawdCdArg.split(',').map((s) => s.trim()).filter(Boolean),
    from: fromArg,
    to: toArg,
  };
}

export function monthsInRange(from: string, to: string): string[] {
  const months: string[] = [];
  let y = parseInt(from.slice(0, 4), 10);
  let m = parseInt(from.slice(4, 6), 10);
  const toY = parseInt(to.slice(0, 4), 10);
  const toM = parseInt(to.slice(4, 6), 10);
  while (y < toY || (y === toY && m <= toM)) {
    months.push(`${y}${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return months;
}

export function makeLogger(resultsDir: string) {
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
  const logPath = path.join(resultsDir, `run-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
  const stream = fs.createWriteStream(logPath, { flags: 'a' });
  return (line: string) => {
    const stamped = `[${new Date().toISOString()}] ${line}`;
    console.log(stamped);
    stream.write(stamped + '\n');
  };
}

type ManifestStatus = 'COMPLETE' | 'EMPTY_VALID' | 'PARTIAL' | 'INVALID';
interface ManifestEntry {
  status: ManifestStatus;
  fetched: number;
  invalid: number;
  blockedMissingAptSeq: number;
  wouldInsert: number;
  wouldUpdate: number;
  unchanged: number;
  persisted: number;
  at: string;
}
type Manifest = Record<string, ManifestEntry>; // key = `${lawdCd}:${dealYmd}`

function loadManifest(): Manifest {
  if (!fs.existsSync(MANIFEST_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function saveManifest(m: Manifest) {
  if (!fs.existsSync(MANIFEST_DIR)) fs.mkdirSync(MANIFEST_DIR, { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(m, null, 0));
}

const CHUNK_SIZE = 500; // §53 — 한 트랜잭션에 대량 row 금지(sale과 동일 관례)

function naturalKeyStrOf(row: {
  groupKeyStr: string;
  deposit: number;
  monthlyRent: number;
  dealDate: string;
  floor: number;
  occurrenceIndex: number;
}): string {
  return `${row.groupKeyStr}::${row.deposit}::${row.monthlyRent}::${row.dealDate}::${row.floor}::${row.occurrenceIndex}`;
}

// §46 CORRECTION-SAFE UPSERT — 자연키 밖 필드 중 실제로 값이 다른 row만 "wouldUpdate"로
// 분류한다(무조건 update-all 금지). 비교 대상은 sale의 upsertRows()가 갱신 허용한
// 필드군과 같은 성격(표기 정정/메타데이터 보강)이다.
const COMPARE_FIELDS = [
  'aptName',
  'dong',
  'jibun',
  'buildYear',
  'contractType',
  'contractTerm',
  'preDeposit',
  'preMonthlyRent',
  'useRenewalRight',
] as const;

interface ExistingRow {
  aptName: string;
  dong: string;
  jibun: string | null;
  buildYear: number | null;
  contractType: string | null;
  contractTerm: string | null;
  preDeposit: number | null;
  preMonthlyRent: number | null;
  useRenewalRight: boolean | null;
}

function hasContentDiff(existing: ExistingRow, incoming: RentRowInput): boolean {
  return COMPARE_FIELDS.some((f) => (existing as any)[f] !== (incoming as any)[f]);
}

export interface CellOutcome {
  lawdCd: string;
  dealYmd: string;
  status: ManifestStatus;
  fetched: number;
  invalid: number;
  invalidByReason: Record<string, number>;
  blockedMissingAptSeq: number;
  masterMatched: number;
  masterUnmatched: number;
  wouldInsert: number;
  wouldUpdate: number;
  unchanged: number;
  persisted: number; // apply 모드에서 실제 insert+update된 행 수
  duplicateWithinBatch: number;
}

async function classifyAndMaybeWrite(rows: RentRowInput[], lawdCd: string, dealYmd: string, apply: boolean): Promise<{
  wouldInsert: number;
  wouldUpdate: number;
  unchanged: number;
  persisted: number;
  duplicateWithinBatch: number;
}> {
  // 배치 내부 자연키 중복 sanity check(§43 UNIQUE CONSTRAINT PROOF의 사전 점검 — 정상
  // 정규화라면 항상 0이어야 한다. occurrenceIndex가 이미 배치 내 충돌을 구분하므로).
  const keySet = new Set<string>();
  let duplicateWithinBatch = 0;
  for (const r of rows) {
    const k = naturalKeyStrOf(r);
    if (keySet.has(k)) duplicateWithinBatch++;
    keySet.add(k);
  }

  // 같은 lawdCd+dealYmd 응답 안의 row는 항상 이 두 필드가 고정이므로, DB에서도 이
  // 범위로 기존 row를 한 번에 불러와 자연키 문자열로 매핑한다(개별 findUnique 대신
  // 배치 조회 — 셀당 최대 수백~1천 건 규모라 findMany 1회로 충분).
  const existing = await prisma.apartmentRentHistory.findMany({
    where: { lawdCd, dealYmd },
    select: {
      groupKeyStr: true,
      deposit: true,
      monthlyRent: true,
      dealDate: true,
      floor: true,
      occurrenceIndex: true,
      aptName: true,
      dong: true,
      jibun: true,
      buildYear: true,
      contractType: true,
      contractTerm: true,
      preDeposit: true,
      preMonthlyRent: true,
      useRenewalRight: true,
    },
  });
  const existingMap = new Map<string, ExistingRow>();
  for (const e of existing) {
    const k = naturalKeyStrOf({
      groupKeyStr: e.groupKeyStr,
      deposit: e.deposit,
      monthlyRent: e.monthlyRent,
      dealDate: e.dealDate.toISOString().slice(0, 10),
      floor: e.floor as number,
      occurrenceIndex: e.occurrenceIndex,
    });
    existingMap.set(k, e);
  }

  let wouldInsert = 0;
  let wouldUpdate = 0;
  let unchanged = 0;
  const toWrite: RentRowInput[] = [];

  for (const row of rows) {
    const k = naturalKeyStrOf(row);
    const existingRow = existingMap.get(k);
    if (!existingRow) {
      wouldInsert++;
      toWrite.push(row);
    } else if (hasContentDiff(existingRow, row)) {
      wouldUpdate++;
      toWrite.push(row);
    } else {
      unchanged++; // 내용 변화 없음 — apply 모드에서도 쓰기를 발생시키지 않는다(§42 idempotency 증명을 흐리지 않기 위해)
    }
  }

  let persisted = 0;
  if (apply && toWrite.length > 0) {
    for (let i = 0; i < toWrite.length; i += CHUNK_SIZE) {
      const chunk = toWrite.slice(i, i + CHUNK_SIZE);
      await prisma.$transaction(
        chunk.map((row) =>
          prisma.apartmentRentHistory.upsert({
            where: {
              rent_natural_key: {
                groupKeyStr: row.groupKeyStr,
                deposit: row.deposit,
                monthlyRent: row.monthlyRent,
                dealDate: new Date(`${row.dealDate}T00:00:00.000Z`),
                floor: row.floor,
                occurrenceIndex: row.occurrenceIndex,
              },
            },
            create: {
              source: 'MOLIT_APT_RENT',
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
              deposit: row.deposit,
              monthlyRent: row.monthlyRent,
              dealYear: row.dealYear,
              dealMonth: row.dealMonth,
              dealDay: row.dealDay,
              dealDate: new Date(`${row.dealDate}T00:00:00.000Z`),
              floor: row.floor,
              buildYear: row.buildYear,
              contractType: row.contractType,
              contractTerm: row.contractTerm,
              preDeposit: row.preDeposit,
              preMonthlyRent: row.preMonthlyRent,
              useRenewalRight: row.useRenewalRight,
              occurrenceIndex: row.occurrenceIndex,
              sourceFetchedAt: new Date(),
            },
            update: {
              // §46 — 자연키 밖 필드만 갱신(표기 정정/메타데이터 보강). deposit/monthlyRent/
              // dealDate/floor/groupKeyStr/occurrenceIndex가 바뀌면 그건 이미 다른 자연키라
              // update가 아니라 별도 create로 들어간다(모델 주석과 동일 원칙).
              aptName: row.aptName,
              dong: row.dong,
              jibun: row.jibun,
              buildYear: row.buildYear,
              contractType: row.contractType,
              contractTerm: row.contractTerm,
              preDeposit: row.preDeposit,
              preMonthlyRent: row.preMonthlyRent,
              useRenewalRight: row.useRenewalRight,
              sourceFetchedAt: new Date(),
            },
          })
        )
      );
      persisted += chunk.length;
    }
  } else if (!apply) {
    persisted = toWrite.length; // dry-run 예상치
  }

  return { wouldInsert, wouldUpdate, unchanged, persisted, duplicateWithinBatch };
}

export interface RentSyncJobOptions {
  apply: boolean;
  lawdCdList: string[];
  from: string;
  to: string;
}

export async function runRentSyncJob(opts: RentSyncJobOptions, log: (line: string) => void): Promise<CellOutcome[]> {
  log(`START apply=${opts.apply} lawdCd=${opts.lawdCdList.join(',')} from=${opts.from} to=${opts.to}`);
  const months = monthsInRange(opts.from, opts.to);
  const manifest = loadManifest();
  const outcomes: CellOutcome[] = [];

  for (const lawdCd of opts.lawdCdList) {
    for (const dealYmd of months) {
      const key = `${lawdCd}:${dealYmd}`;
      const fetchResult = await fetchRentRegionMonth(lawdCd, dealYmd);

      if (fetchResult.status === 'INVALID') {
        manifest[key] = { status: 'INVALID', fetched: 0, invalid: 0, blockedMissingAptSeq: 0, wouldInsert: 0, wouldUpdate: 0, unchanged: 0, persisted: 0, at: new Date().toISOString() };
        outcomes.push({ lawdCd, dealYmd, status: 'INVALID', fetched: 0, invalid: 0, invalidByReason: {}, blockedMissingAptSeq: 0, masterMatched: 0, masterUnmatched: 0, wouldInsert: 0, wouldUpdate: 0, unchanged: 0, persisted: 0, duplicateWithinBatch: 0 });
        log(`INVALID ${key} (fetch failed after retries — NOT recorded as EMPTY_VALID)`);
        continue;
      }

      const { rows, invalid } = normalizeMolitRentItemsToRentRows(fetchResult.items, lawdCd, dealYmd);
      const invalidByReason: Record<string, number> = {};
      for (const iv of invalid) invalidByReason[iv.reason] = (invalidByReason[iv.reason] || 0) + 1;
      const blockedMissingAptSeq = invalidByReason['MISSING_APTSEQ'] || 0;

      // §13 MASTER MATCH POLICY — 저장 여부와 무관하게 참고용으로만 계산(별도 status
      // 컬럼 없음, schema 최소화). aptSeq가 ApartmentMaster에 있는지 조회 시점에 판단.
      const uniqueAptSeqs = [...new Set(rows.map((r) => r.aptSeq))];
      const masters = uniqueAptSeqs.length
        ? await prisma.apartmentMaster.findMany({ where: { aptSeq: { in: uniqueAptSeqs } }, select: { aptSeq: true } })
        : [];
      const matchedSet = new Set(masters.map((m) => m.aptSeq));
      const masterMatched = uniqueAptSeqs.filter((s) => matchedSet.has(s)).length;
      const masterUnmatched = uniqueAptSeqs.length - masterMatched;

      let wouldInsert = 0;
      let wouldUpdate = 0;
      let unchanged = 0;
      let persisted = 0;
      let duplicateWithinBatch = 0;

      if (fetchResult.status === 'EMPTY_VALID' || rows.length === 0) {
        manifest[key] = { status: fetchResult.status, fetched: fetchResult.collectedCount, invalid: invalid.length, blockedMissingAptSeq, wouldInsert: 0, wouldUpdate: 0, unchanged: 0, persisted: 0, at: new Date().toISOString() };
      } else {
        const result = await classifyAndMaybeWrite(rows, lawdCd, dealYmd, opts.apply);
        wouldInsert = result.wouldInsert;
        wouldUpdate = result.wouldUpdate;
        unchanged = result.unchanged;
        persisted = result.persisted;
        duplicateWithinBatch = result.duplicateWithinBatch;
        manifest[key] = {
          status: fetchResult.status,
          fetched: fetchResult.collectedCount,
          invalid: invalid.length,
          blockedMissingAptSeq,
          wouldInsert,
          wouldUpdate,
          unchanged,
          persisted,
          at: new Date().toISOString(),
        };
      }

      outcomes.push({
        lawdCd,
        dealYmd,
        status: fetchResult.status,
        fetched: fetchResult.collectedCount,
        invalid: invalid.length,
        invalidByReason,
        blockedMissingAptSeq,
        masterMatched,
        masterUnmatched,
        wouldInsert,
        wouldUpdate,
        unchanged,
        persisted,
        duplicateWithinBatch,
      });

      log(
        `${fetchResult.status} ${key} fetched=${fetchResult.collectedCount} invalid=${invalid.length} blockedAptSeq=${blockedMissingAptSeq} masterMatched=${masterMatched} masterUnmatched=${masterUnmatched} wouldInsert=${wouldInsert} wouldUpdate=${wouldUpdate} unchanged=${unchanged} persisted=${persisted} dupWithinBatch=${duplicateWithinBatch}`
      );
    }
  }

  if (opts.apply) saveManifest(manifest);

  const totals = outcomes.reduce(
    (acc, o) => ({
      fetched: acc.fetched + o.fetched,
      invalid: acc.invalid + o.invalid,
      blockedMissingAptSeq: acc.blockedMissingAptSeq + o.blockedMissingAptSeq,
      wouldInsert: acc.wouldInsert + o.wouldInsert,
      wouldUpdate: acc.wouldUpdate + o.wouldUpdate,
      unchanged: acc.unchanged + o.unchanged,
      persisted: acc.persisted + o.persisted,
      duplicateWithinBatch: acc.duplicateWithinBatch + o.duplicateWithinBatch,
    }),
    { fetched: 0, invalid: 0, blockedMissingAptSeq: 0, wouldInsert: 0, wouldUpdate: 0, unchanged: 0, persisted: 0, duplicateWithinBatch: 0 }
  );
  log(
    `DONE mode=${opts.apply ? 'APPLY' : 'DRY_RUN'} cells=${outcomes.length} fetched=${totals.fetched} invalid=${totals.invalid} blockedMissingAptSeq=${totals.blockedMissingAptSeq} wouldInsert=${totals.wouldInsert} wouldUpdate=${totals.wouldUpdate} unchanged=${totals.unchanged} persisted=${totals.persisted} duplicateWithinBatch=${totals.duplicateWithinBatch}`
  );

  return outcomes;
}

if (require.main === module) {
  const opts = parseArgs();
  const log = makeLogger(path.resolve(__dirname, '_sync_rent_history_results'));
  runRentSyncJob(opts, log)
    .then(() => prisma.$disconnect())
    .then(() => process.exit(0))
    .catch(async (e) => {
      console.error(e);
      await prisma.$disconnect();
      process.exit(1);
    });
}
