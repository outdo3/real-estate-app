/**
 * E-JIP 서울 V3.2 — 종로구(11110) 전월세 실제 MOLIT API 1회 실측 스크립트
 *
 * 엄격한 제약 준수:
 * - 최대 호출: 1회 (pageNo=1, numOfRows=1000)
 * - 자동 재시도: 0회
 * - 추가 페이지 호출: 0회
 * - DB 쓰기: 0건 (DB 연결 없음)
 * - API 키 출력/로깅 엄격 금지
 */

import * as path from 'path';
import * as dotenv from 'dotenv';
import { XMLParser } from 'fast-xml-parser';
import {
  RawMolitRentItem,
  classifyRentType,
  normalizeMolitRentItemsToRentRows,
} from '../rent-trade-history/rent-history-logic';
import { classifyRentCellCompleteness } from '../rent-trade-history/rent-completeness-logic';

// 1. 환경변수 안전 로드 (.env.local 우선)
dotenv.config({ path: path.resolve(process.cwd(), '../../.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

const ENDPOINT = 'http://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent';
const LAWD_CD = '11110';
const DEAL_YMD = '202610';
const PAGE_NO = 1;
const NUM_OF_ROWS = 1000;

interface ProbeReport {
  apiSuccess: boolean;
  httpStatus: number | null;
  durationMs: number;
  resultCode: string | null;
  resultMsg: string | null;
  totalCount: number | null;
  returnedItemCount: number;
  appliedNumOfRows: number | null;
  appliedPageNo: number | null;
  needsAdditionalPages: boolean;
  rawFieldKeys: string[];
  hasCancelFields: boolean;
  cancelFieldNamesFound: string[];
  jeonseCount: number;
  wolseCount: number;
  hasAptSeqCount: number;
  missingAptSeqCount: number;
  normalizationSuccessCount: number;
  normalizationInvalidCount: number;
  invalidReasons: Record<string, number>;
  occurrenceMaxIndex: number;
  occurrenceDuplicateCount: number;
  completenessStatus: string;
  dbWritesAttempted: number;
  errorMessage?: string;
}

async function runSingleProbe(): Promise<ProbeReport> {
  const rawApiKey = process.env.DATA_GO_KR_API_KEY;
  if (!rawApiKey) {
    return {
      apiSuccess: false,
      httpStatus: null,
      durationMs: 0,
      resultCode: null,
      resultMsg: null,
      totalCount: null,
      returnedItemCount: 0,
      appliedNumOfRows: null,
      appliedPageNo: null,
      needsAdditionalPages: false,
      rawFieldKeys: [],
      hasCancelFields: false,
      cancelFieldNamesFound: [],
      jeonseCount: 0,
      wolseCount: 0,
      hasAptSeqCount: 0,
      missingAptSeqCount: 0,
      normalizationSuccessCount: 0,
      normalizationInvalidCount: 0,
      invalidReasons: {},
      occurrenceMaxIndex: 0,
      occurrenceDuplicateCount: 0,
      completenessStatus: 'BLOCKED_NO_API_KEY',
      dbWritesAttempted: 0,
      errorMessage: 'DATA_GO_KR_API_KEY is not defined in environment.',
    };
  }

  // URL 안전 인코딩
  const cleanKey = rawApiKey.trim().replace(/['"]/g, '');
  const decodedKey = decodeURIComponent(cleanKey);
  const finalKey = encodeURIComponent(decodedKey);
  const url = `${ENDPOINT}?serviceKey=${finalKey}&LAWD_CD=${LAWD_CD}&DEAL_YMD=${DEAL_YMD}&pageNo=${PAGE_NO}&numOfRows=${NUM_OF_ROWS}`;

  const startTime = Date.now();
  let httpStatus = 0;
  let textData = '';

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/xml, text/xml, */*' },
      signal: AbortSignal.timeout(10000), // 10초 타임아웃
    });
    httpStatus = res.status;
    textData = await res.text();
  } catch (err: any) {
    return {
      apiSuccess: false,
      httpStatus: httpStatus || null,
      durationMs: Date.now() - startTime,
      resultCode: null,
      resultMsg: null,
      totalCount: null,
      returnedItemCount: 0,
      appliedNumOfRows: null,
      appliedPageNo: null,
      needsAdditionalPages: false,
      rawFieldKeys: [],
      hasCancelFields: false,
      cancelFieldNamesFound: [],
      jeonseCount: 0,
      wolseCount: 0,
      hasAptSeqCount: 0,
      missingAptSeqCount: 0,
      normalizationSuccessCount: 0,
      normalizationInvalidCount: 0,
      invalidReasons: {},
      occurrenceMaxIndex: 0,
      occurrenceDuplicateCount: 0,
      completenessStatus: 'INVALID',
      dbWritesAttempted: 0,
      errorMessage: `Fetch failed: ${err?.message || String(err)}`,
    };
  }

  const durationMs = Date.now() - startTime;

  // XML 파싱
  const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: true });
  let jsonObj: any;
  try {
    jsonObj = parser.parse(textData);
  } catch (err: any) {
    return {
      apiSuccess: false,
      httpStatus,
      durationMs,
      resultCode: null,
      resultMsg: null,
      totalCount: null,
      returnedItemCount: 0,
      appliedNumOfRows: null,
      appliedPageNo: null,
      needsAdditionalPages: false,
      rawFieldKeys: [],
      hasCancelFields: false,
      cancelFieldNamesFound: [],
      jeonseCount: 0,
      wolseCount: 0,
      hasAptSeqCount: 0,
      missingAptSeqCount: 0,
      normalizationSuccessCount: 0,
      normalizationInvalidCount: 0,
      invalidReasons: {},
      occurrenceMaxIndex: 0,
      occurrenceDuplicateCount: 0,
      completenessStatus: 'INVALID',
      dbWritesAttempted: 0,
      errorMessage: `XML parsing failed: ${err?.message || String(err)}`,
    };
  }

  const header = jsonObj?.response?.header;
  const resultCode = String(header?.resultCode ?? '');
  const resultMsg = String(header?.resultMsg ?? '');

  if (resultCode !== '00' && resultCode !== '0') {
    const errMsg = jsonObj?.OpenAPI_ServiceResponse?.cmmMsgHeader?.errMsg || resultMsg;
    return {
      apiSuccess: false,
      httpStatus,
      durationMs,
      resultCode,
      resultMsg: errMsg,
      totalCount: null,
      returnedItemCount: 0,
      appliedNumOfRows: null,
      appliedPageNo: null,
      needsAdditionalPages: false,
      rawFieldKeys: [],
      hasCancelFields: false,
      cancelFieldNamesFound: [],
      jeonseCount: 0,
      wolseCount: 0,
      hasAptSeqCount: 0,
      missingAptSeqCount: 0,
      normalizationSuccessCount: 0,
      normalizationInvalidCount: 0,
      invalidReasons: {},
      occurrenceMaxIndex: 0,
      occurrenceDuplicateCount: 0,
      completenessStatus: 'INVALID',
      dbWritesAttempted: 0,
      errorMessage: `MOLIT API returned non-zero code: ${resultCode} (${errMsg})`,
    };
  }

  const body = jsonObj?.response?.body;
  const totalCount = body?.totalCount != null ? Number(body.totalCount) : null;
  const appliedNumOfRows = body?.numOfRows != null ? Number(body.numOfRows) : null;
  const appliedPageNo = body?.pageNo != null ? Number(body.pageNo) : null;

  const rawItemsNode = body?.items?.item;
  const rawItems: RawMolitRentItem[] = rawItemsNode
    ? Array.isArray(rawItemsNode)
      ? rawItemsNode
      : [rawItemsNode]
    : [];

  const returnedItemCount = rawItems.length;
  const needsAdditionalPages = totalCount !== null && totalCount > NUM_OF_ROWS;

  // 필드 분석
  const fieldKeySet = new Set<string>();
  const cancelFieldsFound: string[] = [];
  let jeonseCount = 0;
  let wolseCount = 0;
  let hasAptSeqCount = 0;
  let missingAptSeqCount = 0;

  for (const item of rawItems) {
    for (const key of Object.keys(item)) {
      fieldKeySet.add(key);
      const lower = key.toLowerCase();
      if (lower.includes('cancel') || lower.includes('cdeal') || lower === 'cdealtype' || lower === 'cdealday') {
        if (!cancelFieldsFound.includes(key)) cancelFieldsFound.push(key);
      }
    }

    // 전월세 분류
    const monthlyRent = item.monthlyRent != null ? parseInt(String(item.monthlyRent).replace(/,/g, ''), 10) || 0 : 0;
    const dealType = classifyRentType(monthlyRent);
    if (dealType === 'jeonse') jeonseCount++;
    else wolseCount++;

    // aptSeq 확인
    if (item.aptSeq != null && String(item.aptSeq).trim() !== '') {
      hasAptSeqCount++;
    } else {
      missingAptSeqCount++;
    }
  }

  // 정규화 실행 (normalizeMolitRentItemsToRentRows)
  const normResult = normalizeMolitRentItemsToRentRows(rawItems, LAWD_CD, DEAL_YMD);
  const normalizationSuccessCount = normResult.rows.length;
  const normalizationInvalidCount = normResult.invalid.length;

  const invalidReasons: Record<string, number> = {};
  for (const inv of normResult.invalid) {
    invalidReasons[inv.reason] = (invalidReasons[inv.reason] || 0) + 1;
  }

  // occurrenceIndex 분석
  let occurrenceMaxIndex = 0;
  let occurrenceDuplicateCount = 0;
  for (const row of normResult.rows) {
    if (row.occurrenceIndex > occurrenceMaxIndex) {
      occurrenceMaxIndex = row.occurrenceIndex;
    }
    if (row.occurrenceIndex > 0) {
      occurrenceDuplicateCount++;
    }
  }

  // Completeness 판정
  const completenessStatus = classifyRentCellCompleteness({
    firstPageFailed: false,
    totalCount,
    collectedCount: returnedItemCount,
    anyLaterPageFailed: false,
  });

  return {
    apiSuccess: true,
    httpStatus,
    durationMs,
    resultCode,
    resultMsg,
    totalCount,
    returnedItemCount,
    appliedNumOfRows,
    appliedPageNo,
    needsAdditionalPages,
    rawFieldKeys: Array.from(fieldKeySet).sort(),
    hasCancelFields: cancelFieldsFound.length > 0,
    cancelFieldNamesFound: cancelFieldsFound,
    jeonseCount,
    wolseCount,
    hasAptSeqCount,
    missingAptSeqCount,
    normalizationSuccessCount,
    normalizationInvalidCount,
    invalidReasons,
    occurrenceMaxIndex,
    occurrenceDuplicateCount,
    completenessStatus,
    dbWritesAttempted: 0,
  };
}

runSingleProbe()
  .then((report) => {
    // 안전하게 결과 JSON 출력 (비밀값/개인정보 없음)
    console.log('--- PROBE_REPORT_START ---');
    console.log(JSON.stringify(report, null, 2));
    console.log('--- PROBE_REPORT_END ---');
    process.exit(0);
  })
  .catch((err) => {
    console.error('PROBE_FATAL_ERROR:', err?.message || String(err));
    process.exit(1);
  });
