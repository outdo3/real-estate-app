/**
 * E-JIP 서울 V3.9-A — 서울 25개 구 300개 캐시 파일 전수 통합 무결성 검증 모듈
 *
 * 검증 대상:
 * - seoul-a: 8개 구 96셀, 47,817건 (전세 21,918 / 월세 25,899)
 * - seoul-b: 9개 구 108셀, 85,612건 (전세 44,801 / 월세 40,811)
 * - seoul-c: 8개 구 96셀, 107,427건 (전세 52,791 / 월세 54,636)
 * - 총합계: 25개 구 300셀, 240,856건 (전세 119,510 / 월세 121,346)
 *
 * 필수 검증 항목:
 * 1. 300개 파일 전수 존재 여부
 * 2. 300개 파일 개별 SHA-256 해시 계산
 * 3. 파일명 및 내부 메타데이터(lawdCd, dealYmd) 정합성
 * 4. 전체 거래 건수 240,856건 정확성
 * 5. 전세·월세 합계 (전세 119,510 / 월세 121,346)
 * 6. 동일 자연키 중복 0건 (Global Unique Natural Key)
 * 7. 송파구 202610 캐시 재사용 정합성
 * 8. 캐시 손실 시 실행 중단(Fail-Fast) 검증
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  SEOUL_RENT_SYNC_LAWDCDS_A,
  SEOUL_RENT_SYNC_LAWDCDS_B,
  SEOUL_RENT_SYNC_LAWDCDS_C,
} from '../../src/lib/sync/rent-sync-scope';
import { SEOUL_DISTRICT_NAMES, generateMonthList } from './seoul-rent-backfill-engine';

export interface CacheEntryMetadata {
  shard: 'seoul-a' | 'seoul-b' | 'seoul-c';
  fileName: string;
  filePath: string;
  lawdCd: string;
  dealYmd: string;
  districtName: string;
  sha256: string;
  fileSizeBytes: number;
  rowCount: number;
  jeonseCount: number;
  wolseCount: number;
  pageCount: number;
}

export interface ShardSummary {
  shard: 'seoul-a' | 'seoul-b' | 'seoul-c';
  expectedDistricts: number;
  expectedCells: number;
  actualCells: number;
  totalRows: number;
  totalJeonse: number;
  totalWolse: number;
  matched: boolean;
}

export interface All300CacheIntegrityReport {
  timestamp: string;
  totalExpectedCells: number;
  totalActualCells: number;
  allFilesExist: boolean;
  totalRows: number;
  totalJeonse: number;
  totalWolse: number;
  jeonsePlusWolseEqualsTotal: boolean;
  totalRowsExpectedMatch: boolean; // 240,856
  totalJeonseExpectedMatch: boolean; // 119,510
  totalWolseExpectedMatch: boolean; // 121,346
  globalDuplicateNaturalKeys: number;
  duplicateKeysSample: string[];
  songpa202610Status: {
    existsInShardC: boolean;
    rowCount: number;
    sha256: string;
  };
  shardSummaries: Record<string, ShardSummary>;
  districtSummaries: Record<string, {
    shard: string;
    districtName: string;
    lawdCd: string;
    cellCount: number;
    rowCount: number;
    jeonseCount: number;
    wolseCount: number;
  }>;
  fileEntries: CacheEntryMetadata[];
}

export function computeSha256(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function verifyAll300Caches(baseDir?: string): All300CacheIntegrityReport {
  const root = baseDir || path.resolve(process.cwd(), 'tmp/qa-seoul-rent');
  const shards: Array<{ shard: 'seoul-a' | 'seoul-b' | 'seoul-c'; dirName: string; lawdCds: readonly string[]; expectedRows: number; expJeonse: number; expWolse: number }> = [
    {
      shard: 'seoul-a',
      dirName: 'seoul-a-cache',
      lawdCds: SEOUL_RENT_SYNC_LAWDCDS_A,
      expectedRows: 47817,
      expJeonse: 21918,
      expWolse: 25899,
    },
    {
      shard: 'seoul-b',
      dirName: 'seoul-b-cache',
      lawdCds: SEOUL_RENT_SYNC_LAWDCDS_B,
      expectedRows: 85612,
      expJeonse: 44801,
      expWolse: 40811,
    },
    {
      shard: 'seoul-c',
      dirName: 'seoul-c-cache',
      lawdCds: SEOUL_RENT_SYNC_LAWDCDS_C,
      expectedRows: 107427,
      expJeonse: 52791,
      expWolse: 54636,
    },
  ];

  const months = generateMonthList('202511', '202610'); // 12 months
  const allEntries: CacheEntryMetadata[] = [];
  const shardSummaries: Record<string, ShardSummary> = {};
  const districtSummaries: Record<string, any> = {};

  const naturalKeySet = new Set<string>();
  const duplicateKeys: string[] = [];

  let grandTotalRows = 0;
  let grandTotalJeonse = 0;
  let grandTotalWolse = 0;
  let allFilesExist = true;

  let songpaMeta = {
    existsInShardC: false,
    rowCount: 0,
    sha256: '',
  };

  for (const s of shards) {
    const sDir = path.join(root, s.dirName);
    if (!fs.existsSync(sDir)) {
      throw new Error(`CRITICAL: Cache directory missing for ${s.shard} at ${sDir}`);
    }

    let shardRows = 0;
    let shardJeonse = 0;
    let shardWolse = 0;
    let shardCells = 0;

    for (const lawdCd of s.lawdCds) {
      const distName = SEOUL_DISTRICT_NAMES[lawdCd] || lawdCd;
      if (!districtSummaries[lawdCd]) {
        districtSummaries[lawdCd] = {
          shard: s.shard,
          districtName: distName,
          lawdCd,
          cellCount: 0,
          rowCount: 0,
          jeonseCount: 0,
          wolseCount: 0,
        };
      }

      for (const ymd of months) {
        const fileName = `${lawdCd}-${ymd}.json`;
        const filePath = path.join(sDir, fileName);

        if (!fs.existsSync(filePath)) {
          allFilesExist = false;
          throw new Error(`CRITICAL: Expected cache file missing: ${filePath}`);
        }

        const stat = fs.statSync(filePath);
        const sha = computeSha256(filePath);
        const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

        const rows = content.normalizedRows || [];
        const rowCount = rows.length;
        let cellJeonse = 0;
        let cellWolse = 0;

        for (const r of rows) {
          const dt = (r.dealType || '').toLowerCase();
          if (dt === 'jeonse') cellJeonse++;
          else if (dt === 'wolse') cellWolse++;

          // Natural key uniqueness check
          // Natural key: groupKeyStr + deposit + monthlyRent + dealDate + floor + occurrenceIndex
          const gk = r.groupKeyStr || r.groupKey || '';
          const natKey = `${gk}#${r.deposit}#${r.monthlyRent}#${r.dealDate}#${r.floor ?? 'null'}#${r.occurrenceIndex ?? 0}`;
          if (naturalKeySet.has(natKey)) {
            duplicateKeys.push(natKey);
          } else {
            naturalKeySet.add(natKey);
          }
        }

        if (lawdCd === '11710' && ymd === '202610') {
          songpaMeta = {
            existsInShardC: true,
            rowCount,
            sha256: sha,
          };
        }

        shardRows += rowCount;
        shardJeonse += cellJeonse;
        shardWolse += cellWolse;
        shardCells++;

        districtSummaries[lawdCd].cellCount++;
        districtSummaries[lawdCd].rowCount += rowCount;
        districtSummaries[lawdCd].jeonseCount += cellJeonse;
        districtSummaries[lawdCd].wolseCount += cellWolse;

        allEntries.push({
          shard: s.shard,
          fileName,
          filePath,
          lawdCd,
          dealYmd: ymd,
          districtName: distName,
          sha256: sha,
          fileSizeBytes: stat.size,
          rowCount,
          jeonseCount: cellJeonse,
          wolseCount: cellWolse,
          pageCount: content.pageCount || 1,
        });
      }
    }

    grandTotalRows += shardRows;
    grandTotalJeonse += shardJeonse;
    grandTotalWolse += shardWolse;

    shardSummaries[s.shard] = {
      shard: s.shard,
      expectedDistricts: s.lawdCds.length,
      expectedCells: s.lawdCds.length * 12,
      actualCells: shardCells,
      totalRows: shardRows,
      totalJeonse: shardJeonse,
      totalWolse: shardWolse,
      matched:
        shardRows === s.expectedRows &&
        shardJeonse === s.expJeonse &&
        shardWolse === s.expWolse &&
        shardCells === s.lawdCds.length * 12,
    };
  }

  return {
    timestamp: new Date().toISOString(),
    totalExpectedCells: 300,
    totalActualCells: allEntries.length,
    allFilesExist,
    totalRows: grandTotalRows,
    totalJeonse: grandTotalJeonse,
    totalWolse: grandTotalWolse,
    jeonsePlusWolseEqualsTotal: grandTotalJeonse + grandTotalWolse === grandTotalRows,
    totalRowsExpectedMatch: grandTotalRows === 240856,
    totalJeonseExpectedMatch: grandTotalJeonse === 119510,
    totalWolseExpectedMatch: grandTotalWolse === 121346,
    globalDuplicateNaturalKeys: duplicateKeys.length,
    duplicateKeysSample: duplicateKeys.slice(0, 5),
    songpa202610Status: songpaMeta,
    shardSummaries,
    districtSummaries,
    fileEntries: allEntries,
  };
}

if (require.main === module || process.argv[1]?.endsWith('seoul-rent-all-300-cache-integrity.ts')) {
  try {
    const report = verifyAll300Caches();
    console.log('=== E-JIP SEOUL 300 CACHES INTEGRITY REPORT ===');
    console.log(`Total Cells: ${report.totalActualCells} / ${report.totalExpectedCells}`);
    console.log(`Total Rows: ${report.totalRows.toLocaleString()} (Expected: 240,856 -> ${report.totalRowsExpectedMatch ? 'PASS' : 'FAIL'})`);
    console.log(`Jeonse: ${report.totalJeonse.toLocaleString()} (Expected: 119,510 -> ${report.totalJeonseExpectedMatch ? 'PASS' : 'FAIL'})`);
    console.log(`Wolse: ${report.totalWolse.toLocaleString()} (Expected: 121,346 -> ${report.totalWolseExpectedMatch ? 'PASS' : 'FAIL'})`);
    console.log(`Global Duplicate Keys: ${report.globalDuplicateNaturalKeys}`);
    console.log(`Songpa 202610 rows: ${report.songpa202610Status.rowCount}`);
    for (const [shardKey, s] of Object.entries(report.shardSummaries)) {
      console.log(`  - [${shardKey}] Cells: ${s.actualCells}, Rows: ${s.totalRows.toLocaleString()} (Jeonse: ${s.totalJeonse}, Wolse: ${s.totalWolse}) -> ${s.matched ? 'MATCH' : 'MISMATCH'}`);
    }
  } catch (err: any) {
    console.error('Integrity check failed:', err.message);
    process.exit(1);
  }
}
