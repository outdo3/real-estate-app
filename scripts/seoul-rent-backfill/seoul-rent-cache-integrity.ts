/**
 * E-JIP 서울 V3.7-B — seoul-a 96개 캐시 파일 무결성 및 SHA-256 해시 검증
 *
 * 검증 항목:
 * 1. 96개 캐시 파일 전수 존재 확인
 * 2. 각 파일의 lawdCd와 dealYmd가 해당 셀과 일치하는가?
 * 3. 전체 원천 거래 건수가 47,817건인가?
 * 4. 전세 21,918건과 월세 25,899건이 일치하는가?
 * 5. totalCount와 페이지 수집 건수가 셀별로 일치하는가?
 * 6. 각 셀의 COMPLETE 판정 근거가 존재하는가?
 * 7. 파일별 SHA-256을 기록하여 이후 변조·손상을 감지할 수 있는가?
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { RentRowInput } from '../rent-trade-history/rent-history-logic';

export interface CacheFileEntry {
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

export interface CacheIntegrityReport {
  totalFiles: number;
  expectedFiles: number;
  allFilesExist: boolean;
  totalRawItems: number;
  totalNormalizedRows: number;
  totalJeonse: number;
  totalWolse: number;
  expectedTotalRows: number;
  expectedJeonse: number;
  expectedWolse: number;
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
  fileEntries: CacheFileEntry[];
}

export const SEOUL_A_DISTRICTS: Record<string, string> = {
  '11110': '종로구',
  '11140': '중구',
  '11170': '용산구',
  '11215': '광진구',
  '11230': '동대문구',
  '11410': '서대문구',
  '11440': '마포구',
  '11545': '금천구',
};

export const MONTHS_12 = [
  '202511', '202512',
  '202601', '202602', '202603', '202604', '202605', '202606', '202607', '202608', '202609', '202610'
];

export function computeFileSha256(filePath: string): string {
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = crypto.createHash('sha256');
  hashSum.update(fileBuffer);
  return hashSum.digest('hex');
}

export function verifySeoulACacheIntegrity(cacheDir?: string): CacheIntegrityReport {
  const dir = cacheDir || path.resolve(process.cwd(), 'tmp/qa-seoul-rent/seoul-a-cache');
  if (!fs.existsSync(dir)) {
    throw new Error(`Cache directory not found: ${dir}`);
  }

  const expectedLawdCds = Object.keys(SEOUL_A_DISTRICTS);
  const fileEntries: CacheFileEntry[] = [];
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
      districtName: SEOUL_A_DISTRICTS[lawdCd],
      cellCount: 0,
      rawItems: 0,
      jeonse: 0,
      wolse: 0,
    };
  }

  for (const lawdCd of expectedLawdCds) {
    for (const dealYmd of MONTHS_12) {
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

      // 1. lawdCd / dealYmd 일치 검증
      if (parsed.lawdCd !== lawdCd || parsed.dealYmd !== dealYmd) {
        mismatchedCells.push(`PARAM_MISMATCH: ${fileName} (expected ${lawdCd}-${dealYmd}, got ${parsed.lawdCd}-${parsed.dealYmd})`);
        allCellsComplete = false;
      }

      const rawItemsCount = Array.isArray(parsed.items) ? parsed.items.length : 0;
      const normalizedRows: RentRowInput[] = Array.isArray(parsed.normalizedRows) ? parsed.normalizedRows : [];
      const normalizedRowsCount = normalizedRows.length;
      const totalCount = typeof parsed.totalCount === 'number' ? parsed.totalCount : -1;
      const pageCount = typeof parsed.pageCount === 'number' ? parsed.pageCount : 1;

      // 2. totalCount와 수집 건수 일치 검증
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
  const totalCountMatch = totalRawItems === 47817 && totalNormalizedRows === 47817 && totalJeonse === 21918 && totalWolse === 25899;

  return {
    totalFiles: fileEntries.length,
    expectedFiles: 96,
    allFilesExist,
    totalRawItems,
    totalNormalizedRows,
    totalJeonse,
    totalWolse,
    expectedTotalRows: 47817,
    expectedJeonse: 21918,
    expectedWolse: 25899,
    totalCountMatch,
    allCellsComplete,
    mismatchedCells,
    districtSummary,
    fileEntries,
  };
}
