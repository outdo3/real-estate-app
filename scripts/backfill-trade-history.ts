/**
 * TRADE_HISTORY_DATA_V1 — 아파트 매매 실거래 영구 이력 backfill.
 *
 * 절대 원칙:
 *  - `--apply` 없이는 DB에 절대 쓰지 않는다(기본은 dry-run).
 *  - resumable: manifest(region-month 단위 SUCCESS/FAILED/EMPTY_VALID)를 읽어
 *    이미 SUCCESS/EMPTY_VALID인 조합은 건너뛴다(--resume). --resume 없이 실행하면
 *    멱등 upsert이므로 처음부터 다시 돌아도 안전(재검증용).
 *  - idempotent: 같은 fetch를 몇 번 실행해도 row 수가 늘지 않는다(자연키 upsert).
 *  - 한 트랜잭션에 대량 row를 넣지 않는다(청크 단위 upsert, §25).
 *  - RATE LIMIT — 최초 구현은 기존 라이브 세마포어(src/lib/molit-stats-helpers.ts,
 *    동시 6 + 200ms pacing, 인터랙티브 사용자 트래픽 기준으로 튜닝됨)를 그대로
 *    재사용했으나, 실측(2026-08-29) 결과 대량 backfill 연속 호출에서는 이 페이싱도
 *    data.go.kr의 "초당 서비스 요청제한 횟수 초과" 실제 스로틀을 유발해 이후 요청이
 *    연쇄적으로 전부 실패하는 것을 확인했다(라이브 트래픽 볼륨 가정이 대량 backfill
 *    시나리오에는 맞지 않음). 그래서 backfill/sync 스크립트 전용으로 훨씬 보수적인
 *    자체 순차 fetcher(동시 1, 요청 간 최소 간격 + 스로틀 감지 시 지수 백오프)를 따로
 *    둔다 — 기존 라이브 세마포어(다른 모든 통계 API가 쓰는)는 전혀 건드리지 않는다.
 *

 * 사용법:
 *   # 1) 읽기 전용 dry-run(부산 서구 1개월 소표본)
 *   npx ts-node --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     scripts/backfill-trade-history.ts --lawdCd=26140 --from=202606 --to=202606
 *
 *   # 2) 부산 전체 실제 backfill(재개 가능)
 *   npx ts-node --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     scripts/backfill-trade-history.ts --sido=26 --from=200601 --to=202608 --apply --resume
 *
 *   # 3) 한 번 실행에서 처리할 region-month 수 제한(시간 예산 관리용)
 *   ... --apply --resume --maxBatches=500
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// api-molit.ts가 모듈 로드 시점에 process.env.DATA_GO_KR_API_KEY를 top-level const로
// 읽기 때문에(지연 평가 아님), 그 모듈을 import보다 반드시 먼저 dotenv를 로드해야 한다
// (TS의 commonjs emit은 import를 위치 그대로 require()로 변환하므로 순서가 보장됨).
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { PrismaClient, Prisma } from '@prisma/client';
import { getSigunguListForSido } from '../src/lib/region-utils';
import { normalizeMolitItemsToTradeRows, type TradeRowInput } from './trade-history-logic';
import { buildCancellationUpdateFields } from './cancellation-write-guard';
import { fetchSaleRegionMonth } from './sale-molit-fetch';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// DATA_FRESHNESS_AUTOMATION_V1_PHASE1_5 §3 — 내부 구현을 pagination-aware
// fetchSaleRegionMonth()(sale-molit-fetch.ts)로 교체했다. 외부 시그니처
// `{items, failed}`는 완전히 그대로 유지해, 이 함수를 재사용하는 3곳(이 파일의
// backfill 본체, resync-cancellation-v2.ts, incremental-sync-nationwide.ts) 전부
// 코드 변경 없이 그대로 동작한다. COMPLETE가 아닌 모든 경우(PARTIAL 포함 — 일부
// 페이지는 성공했지만 totalCount만큼 다 모으지 못한 경우)를 failed:true로 취급한다
// — 부분 수집분을 "완료"로 오판하는 대신, 기존 각 소비자가 이미 갖고 있는 "실패한
// region-month는 다음 실행에서 재시도" 로직을 그대로 타게 한다(새 상태를 소비자마다
// 추가로 처리하게 만들지 않는 가장 안전한 방법).
export async function fetchOneRegionMonth(lawdCd: string, dealYmd: string): Promise<{ items: any[]; failed: boolean }> {
  const result = await fetchSaleRegionMonth(lawdCd, dealYmd);
  if (result.status === 'COMPLETE' || result.status === 'EMPTY_VALID') {
    return { items: result.items, failed: false };
  }
  // PARTIAL 또는 INVALID — 완전한 데이터가 아니므로 items를 비워 반환한다(부분 수집분을
  // 실수로 신뢰하는 다운스트림 코드가 생기지 않도록).
  return { items: [], failed: true };
}

export const prisma = new PrismaClient();

export const MANIFEST_DIR = path.resolve(__dirname, '../data/trade-history');
export const MANIFEST_PATH = path.join(MANIFEST_DIR, 'busan-manifest.json');

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
    resume: has('--resume'),
    sido: get('--sido') || '26',
    lawdCdFilter: get('--lawdCd') ? get('--lawdCd')!.split(',').map((s) => s.trim()) : undefined,
    from: get('--from') || '200601',
    to: get('--to') || new Date().toISOString().slice(0, 7).replace('-', ''),
    maxBatches: get('--maxBatches') ? parseInt(get('--maxBatches')!, 10) : Infinity,
  };
}

export type ManifestStatus = 'SUCCESS' | 'FAILED' | 'EMPTY_VALID';
export interface ManifestEntry {
  status: ManifestStatus;
  fetched: number;
  invalid: number;
  persisted: number;
  updated: number;
  canceled: number;
  at: string;
}
export type Manifest = Record<string, ManifestEntry>; // key = `${lawdCd}:${dealYmd}`

export function loadManifest(): Manifest {
  if (!fs.existsSync(MANIFEST_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

export function saveManifest(m: Manifest) {
  if (!fs.existsSync(MANIFEST_DIR)) fs.mkdirSync(MANIFEST_DIR, { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(m, null, 0));
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

const CHUNK_SIZE = 500; // §25 — 한 트랜잭션에 대량 row 금지

async function upsertRows(rows: TradeRowInput[]): Promise<{ persisted: number }> {
  let persisted = 0;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    await prisma.$transaction(
      chunk.map((row) =>
        prisma.apartmentTradeHistory.upsert({
          where: {
            trade_natural_key: {
              groupKeyStr: row.groupKeyStr,
              dealAmount: row.dealAmount,
              dealDate: new Date(`${row.dealDate}T00:00:00.000Z`),
              floor: row.floor,
              occurrenceIndex: row.occurrenceIndex,
            },
          },
          create: {
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
          update: {
            // §9 CORRECTION — 자연키 밖 필드만 갱신(취소 상태/등기일자/최근 확인 시각).
            // 자연키 자체(금액/일자/층/그룹)가 바뀌면 새 row로 취급한다(모델 주석 근거).
            //
            // SALE_CANCELLATION_COVERAGE_V1 §8 FAIL-SAFE — 예전에는 여기서
            // `dealCanceled: row.dealCanceled`를 무조건 써서 이미 보정된 true를 원천이
            // false로 되돌릴 수 있었다(V1 §3에서 지적된 repo의 유일한 역전 경로).
            // 이제 원천이 비취소면 cancellation 필드를 **생략**해 기존 값을 보존한다 —
            // write-policy-logic의 `updateTrueToFalseSkipped` 정책과 같은 결과를 legacy
            // upsert 경로에서도 구조적으로 보장한다.
            ...buildCancellationUpdateFields(row),
            aptName: row.aptName, // 표기 오타 정정 등 사소한 갱신 허용(자연키 아님)
            jibun: row.jibun ?? undefined,
            buildYear: row.buildYear ?? undefined,
            sourceFetchedAt: new Date(),
          },
        })
      )
    );
    persisted += chunk.length; // upsert가 insert/update 중 무엇을 했는지는 개별 구분하지 않음(§26 합산치로 보고)
  }
  return { persisted };
}

export interface TradeHistoryJobOptions {
  apply: boolean;
  resume: boolean;
  sido: string;
  lawdCdFilter?: string[];
  from: string;
  to: string;
  maxBatches: number;
}

export async function runTradeHistoryJob(opts: TradeHistoryJobOptions, log: (line: string) => void) {
  log(`START apply=${opts.apply} resume=${opts.resume} sido=${opts.sido} from=${opts.from} to=${opts.to} maxBatches=${opts.maxBatches}`);

  let lawdCdList: { code: string; name: string }[];
  if (opts.lawdCdFilter) {
    lawdCdList = opts.lawdCdFilter.map((code) => ({ code, name: code }));
  } else {
    // region-utils.ts의 getSigunguListForSido()는 원본 법정동코드 전체(10자리, 예:
    // "2611000000")를 그대로 돌려준다(내부적으로는 5자리 접두만 필터에 쓰지만 반환값은
    // 자르지 않음 — resolveLawdCd()류 다른 함수들만 .substring(0,5)를 적용한다).
    // MOLIT LAWD_CD 파라미터는 정확히 5자리여야 하므로 여기서 직접 잘라야 한다 — 자르지
    // 않으면 MOLIT가 조용히 "정상 0건"을 반환해 실제 데이터가 있는 지역이 전부
    // EMPTY_VALID로 잘못 기록된다(실측: 최초 구현에서 발견하고 이 자리에서 수정).
    const raw = await getSigunguListForSido(opts.sido);
    lawdCdList = raw.map((r) => ({ code: r.code.substring(0, 5), name: r.name }));
    if (lawdCdList.length === 0) throw new Error(`sido=${opts.sido} 시군구 목록을 가져오지 못했습니다(REGCODE_PROXY 실패).`);
  }
  log(`REGIONS resolved=${lawdCdList.length}: ${lawdCdList.map((r) => `${r.name}(${r.code})`).join(', ')}`);

  const months = monthsInRange(opts.from, opts.to);
  log(`MONTHS ${months.length} (${months[0]} ~ ${months[months.length - 1]})`);

  const manifest = loadManifest();

  let allTasks: { lawdCd: string; dealYmd: string }[] = [];
  for (const region of lawdCdList) {
    for (const dealYmd of months) {
      const key = `${region.code}:${dealYmd}`;
      if (opts.resume) {
        const entry = manifest[key];
        if (entry && (entry.status === 'SUCCESS' || entry.status === 'EMPTY_VALID')) continue;
      }
      allTasks.push({ lawdCd: region.code, dealYmd });
    }
  }
  if (allTasks.length > opts.maxBatches) {
    log(`LIMIT applying maxBatches=${opts.maxBatches} out of pending=${allTasks.length}`);
    allTasks = allTasks.slice(0, opts.maxBatches);
  }
  log(`PENDING region-months this run: ${allTasks.length}`);

  let totalFetched = 0;
  let totalInvalid = 0;
  let totalPersisted = 0;
  let totalCanceled = 0;
  let totalFailedBatches = 0;
  const startedAt = Date.now();

  // 위 파일 헤더 RATE LIMIT 실측 근거 — 동시 1, 최소 간격 fetchOneRegionMonth()로
  // 완전 순차 처리한다(병렬 배치 없음).
  const LOG_EVERY = 20;
  for (let i = 0; i < allTasks.length; i++) {
    const t = allTasks[i];
    const key = `${t.lawdCd}:${t.dealYmd}`;
    const result = await fetchOneRegionMonth(t.lawdCd, t.dealYmd);

    if (result.failed) {
      manifest[key] = { status: 'FAILED', fetched: 0, invalid: 0, persisted: 0, updated: 0, canceled: 0, at: new Date().toISOString() };
      totalFailedBatches++;
      log(`FAILED ${key}`);
    } else {
      const { rows, invalid } = normalizeMolitItemsToTradeRows(result.items as any[], t.lawdCd, t.dealYmd);
      totalFetched += result.items.length;
      totalInvalid += invalid.length;
      const canceledCount = rows.filter((r) => r.dealCanceled).length;
      totalCanceled += canceledCount;

      if (rows.length === 0) {
        manifest[key] = { status: 'EMPTY_VALID', fetched: result.items.length, invalid: invalid.length, persisted: 0, updated: 0, canceled: 0, at: new Date().toISOString() };
      } else if (opts.apply) {
        const { persisted } = await upsertRows(rows);
        totalPersisted += persisted;
        manifest[key] = { status: 'SUCCESS', fetched: result.items.length, invalid: invalid.length, persisted, updated: 0, canceled: canceledCount, at: new Date().toISOString() };
      } else {
        totalPersisted += rows.length; // dry-run 예상치(실제 upsert 없음, manifest도 갱신하지 않음)
      }
    }

    if (opts.apply && (i + 1) % LOG_EVERY === 0) saveManifest(manifest);
    if ((i + 1) % LOG_EVERY === 0 || i === allTasks.length - 1) {
      const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
      log(
        `PROGRESS ${i + 1}/${allTasks.length} fetched=${totalFetched} invalid=${totalInvalid} persisted(expected)=${totalPersisted} canceled=${totalCanceled} failedBatches=${totalFailedBatches} elapsed=${elapsedSec}s`
      );
    }
  }

  if (opts.apply) saveManifest(manifest);

  const summary = {
    regionMonthsProcessed: allTasks.length,
    fetched: totalFetched,
    invalid: totalInvalid,
    persisted: totalPersisted,
    canceled: totalCanceled,
    failedBatches: totalFailedBatches,
    elapsedSec: (Date.now() - startedAt) / 1000,
  };
  log(
    `DONE mode=${opts.apply ? 'APPLY' : 'DRY_RUN'} regionMonthsProcessed=${summary.regionMonthsProcessed} fetched=${summary.fetched} invalid=${summary.invalid} persisted(expected)=${summary.persisted} canceled=${summary.canceled} failedBatches=${summary.failedBatches} elapsedSec=${summary.elapsedSec.toFixed(1)}`
  );
  return summary;
}

// CLI 진입점 — 이 파일이 직접 실행될 때만 동작(sync-trade-history.ts가 import할 때는
// 실행되지 않음).
if (require.main === module) {
  const opts = parseArgs();
  const log = makeLogger(path.resolve(__dirname, '_backfill_trade_history_results'));
  runTradeHistoryJob(opts, log)
    .then(() => prisma.$disconnect())
    .then(() => process.exit(0))
    .catch(async (e) => {
      console.error(e);
      await prisma.$disconnect();
      process.exit(1);
    });
}
