/**
 * E-JIP 서울 V3.8-B — seoul-c 캐시 무결성 및 SHA-256 자동화 테스트
 */

import { test } from 'node:test';
import * as assert from 'node:assert';
import { verifySeoulCCacheIntegrity } from './seoul-rent-c-cache-integrity';

test('verifySeoulCCacheIntegrity: 96개 캐시 파일 전수 무결성 및 107,427건 정합성 검증', () => {
  const report = verifySeoulCCacheIntegrity();

  // 1. 파일 개수 검증 (96개)
  assert.strictEqual(report.totalFiles, 96, '총 96개 캐시 파일이 존재해야 함');
  assert.strictEqual(report.allFilesExist, true, '96개 파일 누락 없이 모두 존재해야 함');
  assert.strictEqual(report.mismatchedCells.length, 0, '파라미터/건수 불일치 셀이 0건이어야 함');

  // 2. 거래 건수 검증 (107,427건)
  assert.strictEqual(report.totalRawItems, 107427, '원천 XML 아이템 총합이 107,427건이어야 함');
  assert.strictEqual(report.totalNormalizedRows, 107427, '정규화 행 총합이 107,427건이어야 함');

  // 3. 전세 / 월세 건수 검증 (52,791건 / 54,636건)
  assert.strictEqual(report.totalJeonse, 52791, '전세 건수가 52,791건이어야 함');
  assert.strictEqual(report.totalWolse, 54636, '월세 건수가 54,636건이어야 함');
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
    '11680': 22695, // 강남구
    '11710': 19952, // 송파구
    '11650': 14079, // 서초구
    '11740': 14011, // 강동구
    '11560': 11187, // 영등포구
    '11530': 10886, // 구로구
    '11590': 8759,  // 동작구
    '11620': 5858,  // 관악구
  };

  for (const [lawdCd, expectedTotal] of Object.entries(expectedDistricts)) {
    const d = report.districtSummary[lawdCd];
    assert.ok(d, `${lawdCd} 구가 요약에 존재해야 함`);
    assert.strictEqual(d.cellCount, 12, `${d.districtName} 셀 수가 12개여야 함`);
    assert.strictEqual(d.rawItems, expectedTotal, `${d.districtName} 총 건수가 ${expectedTotal}건이어야 함`);
  }
});
