/**
 * E-JIP 서울 V3.6 — 실제 다중 페이지 API 소량 실측 스크립트
 *
 * 엄격한 제약 준수:
 * - 대상: 송파구(11710) 2026년 10월(202610)
 * - 최대 MOLIT API 호출: 3회 (pageNo 1..3, numOfRows=1000)
 * - 자동 재시도 금지 (0회)
 * - 운영 DB 쓰기 0건 (DB 연결 없음)
 * - 3회로 미완료 시 PARTIAL로 안전 종료
 * - API 키 출력/로깅 엄격 금지
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
import { classifyRentCellCompleteness } from '../rent-trade-history/rent-completeness-logic';

// 1. 환경변수 안전 로드
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
export const PROBE_LAWD_CD = '11710'; // 송파구 (서울 최대 대단지 밀집)
export const PROBE_DEAL_YMD = '202610'; // 2026년 10월
export const MAX_ALLOWED_CALLS = 3;
export const PAGE_SIZE = 1000;
export const CALL_DELAY_MS = 350;

const QA_DIR = path.resolve(process.cwd(), 'tmp/qa-seoul-rent');
const RAW_CACHE_FILE = path.join(QA_DIR, 'songpa-202610-raw.json');
const NORM_CACHE_FILE = path.join(QA_DIR, 'songpa-202610-normalized.json');

export interface PageCallResult {
  pageNo: number;
  httpStatus: number;
  durationMs: number;
  returnedCount: number;
  totalCountReported: number | null;
  resultCode: string;
}

export interface MultipageProbeReport {
  target: {
    lawdCd: string;
    districtName: string;
    dealYmd: string;
  };
  callsExecuted: number;
  pageResults: PageCallResult[];
  totalDurationMs: number;
  totalCount: number | null;
  totalCollectedCount: number;
  fromCache: boolean;
  jeonseCount: number;
  wolseCount: number;
  hasAptSeqCount: number;
  missingAptSeqCount: number;
  normalizationSuccessCount: number;
  normalizationInvalidCount: number;
  occurrenceMaxIndex: number;
  siblingTradeCount: number;
  completenessStatus: string;
  isMultipageDemonstrated: boolean;
  hasMorePagesUncollected: boolean;
  dbWritesAttempted: number;
  errorMessage?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runMultipageProbe(options?: { forceFresh?: boolean }): Promise<MultipageProbeReport> {
  if (!fs.existsSync(QA_DIR)) {
    fs.mkdirSync(QA_DIR, { recursive: true });
  }

  // 1. 캐시 확인
  if (!options?.forceFresh && fs.existsSync(RAW_CACHE_FILE) && fs.existsSync(NORM_CACHE_FILE)) {
    const rawCache = JSON.parse(fs.readFileSync(RAW_CACHE_FILE, 'utf-8'));
    const allRawItems: RawMolitRentItem[] = rawCache.items;
    const pageResults: PageCallResult[] = rawCache.report.pageResults;

    let jeonseCount = 0;
    let wolseCount = 0;
    let hasAptSeqCount = 0;
    let missingAptSeqCount = 0;

    for (const item of allRawItems) {
      const monthlyRent = item.monthlyRent != null ? parseInt(String(item.monthlyRent).replace(/,/g, ''), 10) || 0 : 0;
      const dealType = classifyRentType(monthlyRent);
      if (dealType === 'jeonse') jeonseCount++;
      else wolseCount++;

      if (item.aptSeq != null && String(item.aptSeq).trim() !== '') {
        hasAptSeqCount++;
      } else {
        missingAptSeqCount++;
      }
    }

    const normResult = normalizeMolitRentItemsToRentRows(allRawItems, PROBE_LAWD_CD, PROBE_DEAL_YMD);
    let occurrenceMaxIndex = 0;
    let siblingTradeCount = 0;
    for (const row of normResult.rows) {
      if (row.occurrenceIndex > occurrenceMaxIndex) occurrenceMaxIndex = row.occurrenceIndex;
      if (row.occurrenceIndex > 0) siblingTradeCount++;
    }

    const firstPageOk = pageResults.length > 0 && (pageResults[0].resultCode === '00' || pageResults[0].resultCode === '0');
    const completenessStatus = classifyRentCellCompleteness({
      firstPageFailed: !firstPageOk,
      totalCount: rawCache.report.totalCount,
      collectedCount: allRawItems.length,
      anyLaterPageFailed: false,
    });

    const updatedReport: MultipageProbeReport = {
      ...rawCache.report,
      completenessStatus,
      fromCache: true,
      jeonseCount,
      wolseCount,
      hasAptSeqCount,
      missingAptSeqCount,
      normalizationSuccessCount: normResult.rows.length,
      normalizationInvalidCount: normResult.invalid.length,
      occurrenceMaxIndex,
      siblingTradeCount,
    };
    return updatedReport;
  }

  const rawApiKey = process.env.DATA_GO_KR_API_KEY;
  if (!rawApiKey) {
    throw new Error('DATA_GO_KR_API_KEY is not defined in environment.');
  }

  const cleanKey = rawApiKey.trim().replace(/['"]/g, '');
  const decodedKey = decodeURIComponent(cleanKey);
  const finalKey = encodeURIComponent(decodedKey);

  const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: true });
  const allRawItems: RawMolitRentItem[] = [];
  const pageResults: PageCallResult[] = [];
  let totalReportedCount: number | null = null;
  let totalApiDurationMs = 0;
  let hasMorePagesUncollected = false;
  let anyLaterPageFailed = false;

  let pageNo = 1;
  while (pageNo <= MAX_ALLOWED_CALLS) {
    if (pageNo > 1) {
      await sleep(CALL_DELAY_MS);
    }

    const url = `${ENDPOINT}?serviceKey=${finalKey}&LAWD_CD=${PROBE_LAWD_CD}&DEAL_YMD=${PROBE_DEAL_YMD}&pageNo=${pageNo}&numOfRows=${PAGE_SIZE}`;
    const startTime = Date.now();
    let httpStatus = 0;
    let textData = '';

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/xml, text/xml, */*' },
        signal: AbortSignal.timeout(12000), // 12초 타임아웃
      });
      httpStatus = res.status;
      textData = await res.text();
    } catch (err: any) {
      const callDuration = Date.now() - startTime;
      totalApiDurationMs += callDuration;
      pageResults.push({
        pageNo,
        httpStatus: httpStatus || 0,
        durationMs: callDuration,
        returnedCount: 0,
        totalCountReported: null,
        resultCode: `FETCH_ERROR: ${err?.message || String(err)}`,
      });
      if (pageNo > 1) anyLaterPageFailed = true;
      break;
    }

    const callDuration = Date.now() - startTime;
    totalApiDurationMs += callDuration;

    let jsonObj: any;
    try {
      jsonObj = parser.parse(textData);
    } catch (err: any) {
      pageResults.push({
        pageNo,
        httpStatus,
        durationMs: callDuration,
        returnedCount: 0,
        totalCountReported: null,
        resultCode: `XML_PARSE_ERROR: ${err?.message || String(err)}`,
      });
      if (pageNo > 1) anyLaterPageFailed = true;
      break;
    }

    const header = jsonObj?.response?.header;
    const resultCode = String(header?.resultCode ?? '');
    const resultMsg = String(header?.resultMsg ?? '');

    if (resultCode !== '00' && resultCode !== '0') {
      pageResults.push({
        pageNo,
        httpStatus,
        durationMs: callDuration,
        returnedCount: 0,
        totalCountReported: null,
        resultCode: `MOLIT_ERROR_${resultCode}: ${resultMsg}`,
      });
      if (pageNo > 1) anyLaterPageFailed = true;
      break;
    }

    const body = jsonObj?.response?.body;
    const totalCount = body?.totalCount != null ? Number(body.totalCount) : 0;
    if (totalReportedCount === null) {
      totalReportedCount = totalCount;
    }

    const rawItemsNode = body?.items?.item;
    const rawItems: RawMolitRentItem[] = rawItemsNode
      ? Array.isArray(rawItemsNode)
        ? rawItemsNode
        : [rawItemsNode]
      : [];

    allRawItems.push(...rawItems);

    pageResults.push({
      pageNo,
      httpStatus,
      durationMs: callDuration,
      returnedCount: rawItems.length,
      totalCountReported: totalCount,
      resultCode,
    });

    // 다음 페이지 필요 여부 계산
    const currentCollected = allRawItems.length;
    if (currentCollected >= totalCount || rawItems.length < PAGE_SIZE) {
      // 모든 데이터 수집 완료
      break;
    }

    pageNo++;
  }

  // 3회 호출 후에도 데이터가 남은 경우 확인
  if (totalReportedCount !== null && allRawItems.length < totalReportedCount) {
    hasMorePagesUncollected = true;
  }

  // 통계 계산
  let jeonseCount = 0;
  let wolseCount = 0;
  let hasAptSeqCount = 0;
  let missingAptSeqCount = 0;

  for (const item of allRawItems) {
    const monthlyRent = item.monthlyRent != null ? parseInt(String(item.monthlyRent).replace(/,/g, ''), 10) || 0 : 0;
    const dealType = classifyRentType(monthlyRent);
    if (dealType === 'jeonse') jeonseCount++;
    else wolseCount++;

    if (item.aptSeq != null && String(item.aptSeq).trim() !== '') {
      hasAptSeqCount++;
    } else {
      missingAptSeqCount++;
    }
  }

  // 정규화 실행 (동일 조건 다중 세대 occurrenceIndex 부여)
  const normResult = normalizeMolitRentItemsToRentRows(allRawItems, PROBE_LAWD_CD, PROBE_DEAL_YMD);

  let occurrenceMaxIndex = 0;
  let siblingTradeCount = 0;
  for (const row of normResult.rows) {
    if (row.occurrenceIndex > occurrenceMaxIndex) {
      occurrenceMaxIndex = row.occurrenceIndex;
    }
    if (row.occurrenceIndex > 0) {
      siblingTradeCount++;
    }
  }

  // Completeness 판정
  const firstPageOk = pageResults.length > 0 && (pageResults[0].resultCode === '00' || pageResults[0].resultCode === '0');
  const completenessStatus = classifyRentCellCompleteness({
    firstPageFailed: !firstPageOk,
    totalCount: totalReportedCount,
    collectedCount: allRawItems.length,
    anyLaterPageFailed: anyLaterPageFailed || hasMorePagesUncollected,
  });

  const report: MultipageProbeReport = {
    target: {
      lawdCd: PROBE_LAWD_CD,
      districtName: '송파구',
      dealYmd: PROBE_DEAL_YMD,
    },
    callsExecuted: pageResults.length,
    pageResults,
    totalDurationMs: totalApiDurationMs,
    totalCount: totalReportedCount,
    totalCollectedCount: allRawItems.length,
    fromCache: false,
    jeonseCount,
    wolseCount,
    hasAptSeqCount,
    missingAptSeqCount,
    normalizationSuccessCount: normResult.rows.length,
    normalizationInvalidCount: normResult.invalid.length,
    occurrenceMaxIndex,
    siblingTradeCount,
    completenessStatus,
    isMultipageDemonstrated: pageResults.length > 1,
    hasMorePagesUncollected,
    dbWritesAttempted: 0,
  };

  // 캐시 파일 저장 (git-ignored tmp/qa-seoul-rent/)
  fs.writeFileSync(RAW_CACHE_FILE, JSON.stringify({ report, items: allRawItems }, null, 2), 'utf-8');
  fs.writeFileSync(NORM_CACHE_FILE, JSON.stringify({ report, rows: normResult.rows }, null, 2), 'utf-8');

  return report;
}

if (require.main === module || process.argv[1]?.endsWith('seoul-rent-multipage-probe.ts')) {
  runMultipageProbe().then((res) => {
    console.log(JSON.stringify(res, null, 2));
  }).catch((err) => {
    console.error('Probe failed:', err);
    process.exit(1);
  });
}
