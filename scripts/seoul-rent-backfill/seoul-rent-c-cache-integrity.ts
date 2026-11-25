/**
 * E-JIP 서울 V3.8-B — seoul-c 96개 캐시 파일 무결성 및 SHA-256 검증 모듈
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { RentRowInput } from '../rent-trade-history/rent-history-logic';
import { SEOUL_RENT_SYNC_LAWDCDS_C } from '../../src/lib/sync/rent-sync-scope';
import { SEOUL_DISTRICT_NAMES, generateMonthList } from './seoul-rent-backfill-engine';

export interface CacheFileEntryC {
  fileName: string;
  filePath: string;
  lawdCd: string;
  dealYmd: string;
  sha256: string;
  fileSizeBytes: number;
  totalCount: number;
  pageCount: number;
  rawItemsCount: number;
  normalizedRowsCount: number;
  jeonseCount: number;
  wolseCount: number;
  isComplete: boolean;
  completionReason: string;
}

export interface CacheIntegrityReportC {
  totalFiles: number;
  expectedFiles: number;
  allFilesExist: boolean;
  totalRawItems: number;
  totalNormalizedRows: number;
  totalJeonse: number;
  totalWolse: number;
  totalCountMatch: boolean;
  allCellsComplete: boolean;
  mismatchedCells: string[];
  districtSummary: Record<string, {
    districtName: string;
    cellCount: number;
    rawItems: number;
    jeonse: number;
    wolse: number;
  }>;
  fileEntries: CacheFileEntryC[];
}

export function computeFileSha256(filePath: string): string {
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = crypto.createHash('sha256');
  hashSum.update(fileBuffer);
  return hashSum.digest('hex');
}

export function verifySeoulCCacheIntegrity(cacheDir?: string): CacheIntegrityReportC {
  const dir = cacheDir || path.resolve(process.cwd(), 'tmp/qa-seoul-rent/seoul-c-cache');
  if (!fs.existsSync(dir)) {
    throw new Error(`Cache directory not found: ${dir}`);
  }

  const expectedLawdCds = SEOUL_RENT_SYNC_LAWDCDS_C;
  const months = generateMonthList('202511', '202610');
  const fileEntries: CacheFileEntryC[] = [];
  const mismatchedCells: string[] = [];

  let totalRawItems = 0;
  let totalNormalizedRows = 0;
  let totalJeonse = 0;
  let totalWolse = 0;
  let allCellsComplete = true;

  const districtSummary: Record<string, {
    districtName: string;
    cellCount: number;
    rawItems: number;
    jeonse: number;
    wolse: number;
  }> = {};

  for (const lawdCd of expectedLawdCds) {
    districtSummary[lawdCd] = {
      districtName: SEOUL_DISTRICT_NAMES[lawdCd] || lawdCd,
      cellCount: 0,
      rawItems: 0,
      jeonse: 0,
      wolse: 0,
    };
  }

  for (const lawdCd of expectedLawdCds) {
    for (const dealYmd of months) {
      const fileName = `${lawdCd}-${dealYmd}.json`;
      const filePath = path.join(dir, fileName);

      if (!fs.existsSync(filePath)) {
        mismatchedCells.push(`MISSING_FILE: ${fileName}`);
        allCellsComplete = false;
        continue;
      }

      const fileStats = fs.statSync(filePath);
      const sha256 = computeFileSha256(filePath);
      const rawContent = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(rawContent);

      if (parsed.lawdCd !== lawdCd || parsed.dealYmd !== dealYmd) {
        mismatchedCells.push(`PARAM_MISMATCH: ${fileName} (expected ${lawdCd}-${dealYmd}, got ${parsed.lawdCd}-${parsed.dealYmd})`);
        allCellsComplete = false;
      }

      const rawItemsCount = Array.isArray(parsed.items) ? parsed.items.length : 0;
      const normalizedRows: RentRowInput[] = Array.isArray(parsed.normalizedRows) ? parsed.normalizedRows : [];
      const normalizedRowsCount = normalizedRows.length;
      const totalCount = typeof parsed.totalCount === 'number' ? parsed.totalCount : -1;
      const pageCount = typeof parsed.pageCount === 'number' ? parsed.pageCount : 1;

      const countMatches = totalCount === rawItemsCount && rawItemsCount === normalizedRowsCount;
      if (!countMatches) {
        mismatchedCells.push(`COUNT_MISMATCH: ${fileName} (totalCount=${totalCount}, items=${rawItemsCount}, norm=${normalizedRowsCount})`);
        allCellsComplete = false;
      }

      let cellJeonse = 0;
      let cellWolse = 0;
      for (const row of normalizedRows) {
        if (row.dealType === 'jeonse' || row.dealType === '전세') cellJeonse++;
        else if (row.dealType === 'wolse' || row.dealType === '월세') cellWolse++;
      }

      const isComplete = countMatches && rawItemsCount > 0;
      const completionReason = isComplete
        ? `COMPLETE: totalCount(${totalCount}) == items(${rawItemsCount}) == norm(${normalizedRowsCount})`
        : `INCOMPLETE_OR_EMPTY: countMatches=${countMatches}`;

      if (!isComplete) {
        allCellsComplete = false;
      }

      fileEntries.push({
        fileName,
        filePath,
        lawdCd,
        dealYmd,
        sha256,
        fileSizeBytes: fileStats.size,
        totalCount,
        pageCount,
        rawItemsCount,
        normalizedRowsCount,
        jeonseCount: cellJeonse,
        wolseCount: cellWolse,
        isComplete,
        completionReason,
      });

      totalRawItems += rawItemsCount;
      totalNormalizedRows += normalizedRowsCount;
      totalJeonse += cellJeonse;
      totalWolse += cellWolse;

      districtSummary[lawdCd].cellCount += 1;
      districtSummary[lawdCd].rawItems += rawItemsCount;
      districtSummary[lawdCd].jeonse += cellJeonse;
      districtSummary[lawdCd].wolse += cellWolse;
    }
  }

  const allFilesExist = fileEntries.length === 96 && mismatchedCells.length === 0;
  const totalCountMatch = totalRawItems === totalNormalizedRows && totalRawItems === totalJeonse + totalWolse;

  return {
    totalFiles: fileEntries.length,
    expectedFiles: 96,
    allFilesExist,
    totalRawItems,
    totalNormalizedRows,
    totalJeonse,
    totalWolse,
    totalCountMatch,
    allCellsComplete,
    mismatchedCells,
    districtSummary,
    fileEntries,
  };
}
