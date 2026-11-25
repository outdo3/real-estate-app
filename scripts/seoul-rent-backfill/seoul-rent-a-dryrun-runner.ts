/**
 * E-JIP 서울 V3.7-A — seoul-a 8개 구 전월세 12개월 실제 Dry-run 실행 모듈
 *
 * 엄격한 제약 준수:
 * - 대상: seoul-a (종로, 중구, 용산, 광진, 동대문, 서대문, 마포, 금천) 8개 구
 * - 기간: 202511 ~ 202610 (12개월, 총 96셀)
 * - 최대 MOLIT API 호출: 127회 절대 상한 (Circuit Breaker)
 * - 호출 간 페이싱: 최소 350ms 이상
 * - 자동 재시도: 최대 1회로 제한 (무제한 재시도 금지)
 * - 운영 DB 쓰기: 엄격히 0건 (`dryRun: true`, `allowLiveDbWrite: false`)
 * - 체크포인트: `tmp/qa-seoul-rent/seoul-a-dryrun-checkpoint.json` (`executionMode: 'DRY_RUN'`)
 * - 원본 캐시: `tmp/qa-seoul-rent/seoul-a-cache/${lawdCd}-${dealYmd}.json` (향후 Apply 시 100% 재사용 가능)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { XMLParser } from 'fast-xml-parser';
import {
  RawMolitRentItem,
  classifyRentType,
  normalizeMolitRentItemsToRentRows,
  RentRowInput,
} from '../rent-trade-history/rent-history-logic';
import {
  classifyRentCellCompleteness,
  RentCellStatus,
  CompletenessInput,
} from '../rent-trade-history/rent-completeness-logic';
import {
  SEOUL_RENT_SYNC_LAWDCDS_A,
  resolveRentSyncScope,
} from '../../src/lib/sync/rent-sync-scope';
import {
  SEOUL_DISTRICT_NAMES,
  generateMonthList,
} from './seoul-rent-backfill-engine';

// 환경변수 안전 로드
const envSearchPaths = [
  path.resolve(process.cwd(), '.env.local'),
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../../.env.local'),
  path.resolve(process.cwd(), '../../.env'),
  path.resolve(__dirname, '../../.env.local'),
  path.resolve(__dirname, '../../.env'),
  path.resolve(__dirname, '../../../../.env.local'),
  path.resolve(__dirname, '../../../../.env'),
];

for (const p of envSearchPaths) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p, override: false });
  }
}

const ENDPOINT = 'http://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent';
export const HARD_CAP_API_CALLS = 127;
export const MIN_INTERVAL_MS = 350;
export const PAGE_SIZE = 1000;

export const QA_DIR = path.resolve(process.cwd(), 'tmp/qa-seoul-rent');
export const CACHE_DIR = path.join(QA_DIR, 'seoul-a-cache');
export const CHECKPOINT_FILE = path.join(QA_DIR, 'seoul-a-dryrun-checkpoint.json');

export interface CellDryRunResult {
  lawdCd: string;
  districtName: string;
  dealYmd: string;
  status: RentCellStatus;
  executionMode: 'DRY_RUN';
  totalCount: number | null;
  collectedCount: number;
  pageCount: number;
  apiCallsMade: number;
  fromCache: boolean;
  jeonseCount: number;
  wolseCount: number;
  normalizationSuccessCount: number;
  normalizationInvalidCount: number;
  aptSeqMissingCount: number;
  siblingTradeCount: number;
  maxOccurrenceIndex: number;
  durationMs: number;
  dbWritesAttempted: number;
  errorMessage?: string;
  processedAt: string;
}

export interface ShardDryRunSummary {
  shard: 'seoul-a';
  districtsCount: number;
  targetMonths: string[];
  totalPlannedCells: number;
  executedCells: number;
  completedCells: number;
  partialCells: number;
  invalidCells: number;
  emptyValidCells: number;
  totalApiCalls: number;
  apiCallLimit: number;
  hitCallLimit: boolean;
  totalCollectedRows: number;
  totalJeonseRows: number;
  totalWolseRows: number;
  totalNormSuccess: number;
  totalNormInvalid: number;
  totalMissingAptSeq: number;
  totalSiblingTrades: number;
  totalDbWritesAttempted: number;
  districtAggregates: Record<
    string,
    {
      name: string;
      cells: number;
      collected: number;
      jeonse: number;
      wolse: number;
      apiCalls: number;
    }
  >;
  cellResults: CellDryRunResult[];
  checkpointSaved: boolean;
  canReuseInApplyPhase: boolean;
  totalDurationMs: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class SeoulADryRunRunner {
  private totalApiCalls = 0;
  private lastCallTime = 0;
  private parser = new XMLParser({ ignoreAttributes: false, parseTagValue: true });

  constructor() {
    if (!fs.existsSync(QA_DIR)) fs.mkdirSync(QA_DIR, { recursive: true });
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  }

  public getApiCallsCount(): number {
    return this.totalApiCalls;
  }

  /**
   * 단일 페이지 MOLIT API 호출 (페이싱 및 타임아웃, 최대 1회 재시도)
   */
  private async fetchPageWithRetry(
    lawdCd: string,
    dealYmd: string,
    pageNo: number
  ): Promise<{ ok: boolean; items: RawMolitRentItem[]; totalCount: number | null; durationMs: number; isRateLimited: boolean; error?: string }> {
    if (this.totalApiCalls >= HARD_CAP_API_CALLS) {
      return { ok: false, items: [], totalCount: null, durationMs: 0, isRateLimited: false, error: 'HARD_CAP_API_CALLS reached' };
    }

    const rawApiKey = process.env.DATA_GO_KR_API_KEY;
    if (!rawApiKey) throw new Error('DATA_GO_KR_API_KEY is not defined in environment.');

    const cleanKey = rawApiKey.trim().replace(/['"]/g, '');
    const decodedKey = decodeURIComponent(cleanKey);
    const finalKey = encodeURIComponent(decodedKey);
    const url = `${ENDPOINT}?serviceKey=${finalKey}&LAWD_CD=${lawdCd}&DEAL_YMD=${dealYmd}&pageNo=${pageNo}&numOfRows=${PAGE_SIZE}`;

    for (let attempt = 0; attempt <= 1; attempt++) {
      if (this.totalApiCalls >= HARD_CAP_API_CALLS) {
        return { ok: false, items: [], totalCount: null, durationMs: 0, isRateLimited: false, error: 'HARD_CAP_API_CALLS reached' };
      }

      // 페이싱 대기
      const elapsedSinceLast = Date.now() - this.lastCallTime;
      if (elapsedSinceLast < MIN_INTERVAL_MS) {
        await sleep(MIN_INTERVAL_MS - elapsedSinceLast);
      }

      const startTime = Date.now();
      this.totalApiCalls++;
      this.lastCallTime = Date.now();

      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: { Accept: 'application/xml, text/xml, */*' },
          signal: AbortSignal.timeout(12000),
        });
        const durationMs = Date.now() - startTime;
        const textData = await res.text();
        const jsonObj = this.parser.parse(textData);

        const errMsg = jsonObj?.OpenAPI_ServiceResponse?.cmmMsgHeader?.errMsg;
        if (errMsg) {
          const isRateLimited = String(jsonObj?.OpenAPI_ServiceResponse?.cmmMsgHeader?.returnAuthMsg || '').includes('요청제한');
          if (attempt === 0 && isRateLimited) {
            await sleep(2000);
            continue;
          }
          return { ok: false, items: [], totalCount: null, durationMs, isRateLimited, error: errMsg };
        }

        const header = jsonObj?.response?.header;
        const resultCode = String(header?.resultCode ?? '');
        if (resultCode !== '00' && resultCode !== '0') {
          return { ok: false, items: [], totalCount: null, durationMs, isRateLimited: false, error: `resultCode: ${resultCode}` };
        }

        const body = jsonObj?.response?.body;
        const totalCount = body?.totalCount != null ? Number(body.totalCount) : 0;
        const rawItemsNode = body?.items?.item;
        const items: RawMolitRentItem[] = rawItemsNode
          ? Array.isArray(rawItemsNode)
            ? rawItemsNode
            : [rawItemsNode]
          : [];

        return { ok: true, items, totalCount, durationMs, isRateLimited: false };
      } catch (err: any) {
        const durationMs = Date.now() - startTime;
        if (attempt === 0) {
          await sleep(1000);
          continue;
        }
        return { ok: false, items: [], totalCount: null, durationMs, isRateLimited: false, error: err?.message || String(err) };
      }
    }

    return { ok: false, items: [], totalCount: null, durationMs: 0, isRateLimited: false, error: 'Max attempts exhausted' };
  }

  /**
   * 단일 셀(lawdCd + dealYmd) 수집 및 정규화
   */
  public async executeCell(lawdCd: string, dealYmd: string): Promise<CellDryRunResult> {
    const startTime = Date.now();
    const districtName = SEOUL_DISTRICT_NAMES[lawdCd] || '알수없음';
    const cacheFile = path.join(CACHE_DIR, `${lawdCd}-${dealYmd}.json`);

    let rawItems: RawMolitRentItem[] = [];
    let totalCount: number | null = null;
    let pageCount = 0;
    let fromCache = false;
    let anyLaterPageFailed = false;
    let firstPageFailed = false;
    let initialApiCalls = this.totalApiCalls;

    // 1. 캐시 확인 (기존 캐시 파일이 있으면 API 호출 없이 재사용)
    if (fs.existsSync(cacheFile)) {
      try {
        const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
        if (cached.items && cached.totalCount !== undefined) {
          rawItems = cached.items;
          totalCount = cached.totalCount;
          pageCount = cached.pageCount || (rawItems.length > 1000 ? 2 : 1);
          fromCache = true;
        }
      } catch {}
    }

    // 2. 캐시 미존재 시 실제 MOLIT API 호출
    if (!fromCache) {
      if (this.totalApiCalls >= HARD_CAP_API_CALLS) {
        return {
          lawdCd,
          districtName,
          dealYmd,
          status: 'PARTIAL',
          executionMode: 'DRY_RUN',
          totalCount: null,
          collectedCount: 0,
          pageCount: 0,
          apiCallsMade: 0,
          fromCache: false,
          jeonseCount: 0,
          wolseCount: 0,
          normalizationSuccessCount: 0,
          normalizationInvalidCount: 0,
          aptSeqMissingCount: 0,
          siblingTradeCount: 0,
          maxOccurrenceIndex: 0,
          durationMs: Date.now() - startTime,
          dbWritesAttempted: 0,
          errorMessage: 'Stopped: HARD_CAP_API_CALLS reached before cell execution',
          processedAt: new Date().toISOString(),
        };
      }

      let curPage = 1;
      while (true) {
        const res = await this.fetchPageWithRetry(lawdCd, dealYmd, curPage);
        pageCount++;

        if (!res.ok) {
          if (curPage === 1) {
            firstPageFailed = true;
          } else {
            anyLaterPageFailed = true;
          }
          break;
        }

        if (curPage === 1) {
          totalCount = res.totalCount;
        }
        rawItems.push(...res.items);

        // 다음 페이지 여부 확인
        if (totalCount === null || rawItems.length >= totalCount || res.items.length < PAGE_SIZE) {
          break;
        }

        if (this.totalApiCalls >= HARD_CAP_API_CALLS) {
          anyLaterPageFailed = true;
          break;
        }

        curPage++;
      }
    }

    const apiCallsMade = this.totalApiCalls - initialApiCalls;

    // 3. Completeness 판정
    const completenessInput: CompletenessInput = {
      firstPageFailed,
      totalCount,
      collectedCount: rawItems.length,
      anyLaterPageFailed: anyLaterPageFailed || (totalCount !== null && rawItems.length < totalCount),
    };
    const status = classifyRentCellCompleteness(completenessInput);

    // 4. 통계 및 정규화
    let jeonseCount = 0;
    let wolseCount = 0;
    let aptSeqMissingCount = 0;

    for (const it of rawItems) {
      const monthlyRent = it.monthlyRent != null ? parseInt(String(it.monthlyRent).replace(/,/g, ''), 10) || 0 : 0;
      const dealType = classifyRentType(monthlyRent);
      if (dealType === 'jeonse') jeonseCount++;
      else wolseCount++;

      if (it.aptSeq == null || String(it.aptSeq).trim() === '') {
        aptSeqMissingCount++;
      }
    }

    const normResult = normalizeMolitRentItemsToRentRows(rawItems, lawdCd, dealYmd);
    let siblingTradeCount = 0;
    let maxOccurrenceIndex = 0;

    for (const r of normResult.rows) {
      if (r.occurrenceIndex > maxOccurrenceIndex) maxOccurrenceIndex = r.occurrenceIndex;
      if (r.occurrenceIndex > 0) siblingTradeCount++;
    }

    // 5. 완전 수집된 셀은 로컬 QA 캐시에 영속화 (향후 Apply 시 100% 재사용 가능)
    if (status === 'COMPLETE' || status === 'EMPTY_VALID') {
      const cachePayload = {
        lawdCd,
        dealYmd,
        totalCount,
        pageCount,
        items: rawItems,
        normalizedRows: normResult.rows,
        timestamp: new Date().toISOString(),
      };
      fs.writeFileSync(cacheFile, JSON.stringify(cachePayload, null, 2), 'utf-8');
    }

    return {
      lawdCd,
      districtName,
      dealYmd,
      status,
      executionMode: 'DRY_RUN',
      totalCount,
      collectedCount: rawItems.length,
      pageCount,
      apiCallsMade,
      fromCache,
      jeonseCount,
      wolseCount,
      normalizationSuccessCount: normResult.rows.length,
      normalizationInvalidCount: normResult.invalid.length,
      aptSeqMissingCount,
      siblingTradeCount,
      maxOccurrenceIndex,
      durationMs: Date.now() - startTime,
      dbWritesAttempted: 0,
      processedAt: new Date().toISOString(),
    };
  }

  /**
   * seoul-a 8개 구 12개월 (총 96셀) 순차 실행
   */
  public async executeShardDryRun(fromYmd = '202511', toYmd = '202610'): Promise<ShardDryRunSummary> {
    const startTime = Date.now();
    const months = generateMonthList(fromYmd, toYmd);
    const districts = [...SEOUL_RENT_SYNC_LAWDCDS_A];
    const totalPlannedCells = districts.length * months.length;

    const cellResults: CellDryRunResult[] = [];
    const checkpointMap: Record<string, CellDryRunResult> = {};

    let completedCells = 0;
    let partialCells = 0;
    let invalidCells = 0;
    let emptyValidCells = 0;
    let totalCollectedRows = 0;
    let totalJeonseRows = 0;
    let totalWolseRows = 0;
    let totalNormSuccess = 0;
    let totalNormInvalid = 0;
    let totalMissingAptSeq = 0;
    let totalSiblingTrades = 0;
    let hitCallLimit = false;

    const districtAggregates: Record<
      string,
      { name: string; cells: number; collected: number; jeonse: number; wolse: number; apiCalls: number }
    > = {};

    for (const code of districts) {
      districtAggregates[code] = {
        name: SEOUL_DISTRICT_NAMES[code] || code,
        cells: 0,
        collected: 0,
        jeonse: 0,
        wolse: 0,
        apiCalls: 0,
      };
    }

    for (const code of districts) {
      for (const ymd of months) {
        if (this.totalApiCalls >= HARD_CAP_API_CALLS) {
          hitCallLimit = true;
        }

        const res = await this.executeCell(code, ymd);
        cellResults.push(res);
        checkpointMap[`${code}:${ymd}`] = res;

        // 원자적 체크포인트 저장 (진행 상태 영속화)
        this.saveCheckpoint(checkpointMap, totalPlannedCells, cellResults.length);

        // 집계 갱신
        districtAggregates[code].cells++;
        districtAggregates[code].collected += res.collectedCount;
        districtAggregates[code].jeonse += res.jeonseCount;
        districtAggregates[code].wolse += res.wolseCount;
        districtAggregates[code].apiCalls += res.apiCallsMade;

        totalCollectedRows += res.collectedCount;
        totalJeonseRows += res.jeonseCount;
        totalWolseRows += res.wolseCount;
        totalNormSuccess += res.normalizationSuccessCount;
        totalNormInvalid += res.normalizationInvalidCount;
        totalMissingAptSeq += res.aptSeqMissingCount;
        totalSiblingTrades += res.siblingTradeCount;

        if (res.status === 'COMPLETE') completedCells++;
        else if (res.status === 'EMPTY_VALID') emptyValidCells++;
        else if (res.status === 'PARTIAL') partialCells++;
        else invalidCells++;

        // 콘솔 진행률 로그 (1줄)
        process.stdout.write(
          `\r[Dry-Run seoul-a] ${cellResults.length}/${totalPlannedCells} (${res.districtName} ${ymd}: ${res.status}, ${res.collectedCount}건, API calls: ${this.totalApiCalls}/${HARD_CAP_API_CALLS})   `
        );
      }
    }
    process.stdout.write('\n');

    return {
      shard: 'seoul-a',
      districtsCount: districts.length,
      targetMonths: months,
      totalPlannedCells,
      executedCells: cellResults.length,
      completedCells,
      partialCells,
      invalidCells,
      emptyValidCells,
      totalApiCalls: this.totalApiCalls,
      apiCallLimit: HARD_CAP_API_CALLS,
      hitCallLimit,
      totalCollectedRows,
      totalJeonseRows,
      totalWolseRows,
      totalNormSuccess,
      totalNormInvalid,
      totalMissingAptSeq,
      totalSiblingTrades,
      totalDbWritesAttempted: 0,
      districtAggregates,
      cellResults,
      checkpointSaved: fs.existsSync(CHECKPOINT_FILE),
      canReuseInApplyPhase: true,
      totalDurationMs: Date.now() - startTime,
    };
  }

  private saveCheckpoint(cells: Record<string, CellDryRunResult>, totalPlanned: number, currentExecuted: number) {
    const payload = {
      version: 1,
      shard: 'seoul-a',
      executionMode: 'DRY_RUN',
      totalPlannedCells: totalPlanned,
      executedCells: currentExecuted,
      totalApiCalls: this.totalApiCalls,
      lastUpdated: new Date().toISOString(),
      cells,
    };
    const tmp = `${CHECKPOINT_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf-8');
    fs.renameSync(tmp, CHECKPOINT_FILE);
  }
}

// 직접 실행 지원
if (require.main === module || process.argv[1]?.endsWith('seoul-rent-a-dryrun-runner.ts')) {
  const runner = new SeoulADryRunRunner();
  runner.executeShardDryRun('202511', '202610').then((summary) => {
    // 요약 결과 출력
    const { cellResults, ...overview } = summary;
    console.log('\n=== DRY-RUN SUMMARY (seoul-a 96 Cells) ===');
    console.log(JSON.stringify(overview, null, 2));
  }).catch((err) => {
    console.error('\nDry-run runner failed:', err);
    process.exit(1);
  });
}
