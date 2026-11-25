/**
 * E-JIP 서울 V3.7-B — 캐시 무결성 및 SHA-256 자동화 테스트
 */

import { test } from 'node:test';
import * as assert from 'node:assert';
import { verifySeoulACacheIntegrity } from './seoul-rent-cache-integrity';

test('verifySeoulACacheIntegrity: 96개 캐시 파일 전수 무결성 및 47,817건 정합성 검증', () => {
  const report = verifySeoulACacheIntegrity();

  // 1. 파일 개수 검증 (96개)
  assert.strictEqual(report.totalFiles, 96, '총 96개 캐시 파일이 존재해야 함');
  assert.strictEqual(report.allFilesExist, true, '96개 파일 누락 없이 모두 존재해야 함');
  assert.strictEqual(report.mismatchedCells.length, 0, '파라미터/건수 불일치 셀이 0건이어야 함');

  // 2. 거래 건수 검증 (47,817건)
  assert.strictEqual(report.totalRawItems, 47817, '원천 XML 아이템 총합이 47,817건이어야 함');
  assert.strictEqual(report.totalNormalizedRows, 47817, '정규화 행 총합이 47,817건이어야 함');

  // 3. 전세 / 월세 건수 검증 (21,918건 / 25,899건)
  assert.strictEqual(report.totalJeonse, 21918, '전세 건수가 21,918건이어야 함');
  assert.strictEqual(report.totalWolse, 25899, '월세 건수가 25,899건이어야 함');
  assert.strictEqual(report.totalCountMatch, true, '모든 거래 건수 집계가 정확히 일치해야 함');

  // 4. 전 셀 COMPLETE 판정 검증
  assert.strictEqual(report.allCellsComplete, true, '96개 셀 모두 COMPLETE 판정이어야 함');

  // 5. SHA-256 해시 검증
  for (const entry of report.fileEntries) {
    assert.ok(entry.sha256, `${entry.fileName}의 SHA-256 해시가 존재해야 함`);
    assert.strictEqual(entry.sha256.length, 64, `${entry.fileName}의 SHA-256 해시 길이는 64자여야 함`);
    assert.strictEqual(entry.isComplete, true, `${entry.fileName}은 COMPLETE 상태여야 함`);
  }

  // 6. 8개 자치구별 건수 검증
  const expectedDistricts: Record<string, number> = {
    '11440': 11723, // 마포구
    '11230': 9192,  // 동대문구
    '11410': 7069,  // 서대문구
    '11170': 6192,  // 용산구
    '11215': 4705,  // 광진구
    '11140': 3639,  // 중구
    '11545': 3064,  // 금천구
    '11110': 2233,  // 종로구
  };

  for (const [lawdCd, expectedTotal] of Object.entries(expectedDistricts)) {
    const d = report.districtSummary[lawdCd];
    assert.ok(d, `${lawdCd} 구가 요약에 존재해야 함`);
    assert.strictEqual(d.cellCount, 12, `${d.districtName} 셀 수가 12개여야 함`);
    assert.strictEqual(d.rawItems, expectedTotal, `${d.districtName} 총 건수가 ${expectedTotal}건이어야 함`);
  }
});
