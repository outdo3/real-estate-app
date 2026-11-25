/**
 * E-JIP 서울 V3.8-A — seoul-b 캐시 무결성 및 SHA-256 자동화 테스트
 */

import { test } from 'node:test';
import * as assert from 'node:assert';
import { verifySeoulBCacheIntegrity } from './seoul-rent-b-cache-integrity';

test('verifySeoulBCacheIntegrity: 108개 캐시 파일 전수 무결성 및 85,612건 정합성 검증', () => {
  const report = verifySeoulBCacheIntegrity();

  // 1. 파일 개수 검증 (108개)
  assert.strictEqual(report.totalFiles, 108, '총 108개 캐시 파일이 존재해야 함');
  assert.strictEqual(report.allFilesExist, true, '108개 파일 누락 없이 모두 존재해야 함');
  assert.strictEqual(report.mismatchedCells.length, 0, '파라미터/건수 불일치 셀이 0건이어야 함');

  // 2. 거래 건수 검증 (85,612건)
  assert.strictEqual(report.totalRawItems, 85612, '원천 XML 아이템 총합이 85,612건이어야 함');
  assert.strictEqual(report.totalNormalizedRows, 85612, '정규화 행 총합이 85,612건이어야 함');

  // 3. 전세 / 월세 건수 검증 (44,801건 / 40,811건)
  assert.strictEqual(report.totalJeonse, 44801, '전세 건수가 44,801건이어야 함');
  assert.strictEqual(report.totalWolse, 40811, '월세 건수가 40,811건이어야 함');
  assert.strictEqual(report.totalCountMatch, true, '모든 거래 건수 집계가 정확히 일치해야 함');

  // 4. 전 셀 COMPLETE 판정 검증
  assert.strictEqual(report.allCellsComplete, true, '108개 셀 모두 COMPLETE 판정이어야 함');

  // 5. SHA-256 해시 검증
  for (const entry of report.fileEntries) {
    assert.ok(entry.sha256, `${entry.fileName}의 SHA-256 해시가 존재해야 함`);
    assert.strictEqual(entry.sha256.length, 64, `${entry.fileName}의 SHA-256 해시 길이는 64자여야 함`);
    assert.strictEqual(entry.isComplete, true, `${entry.fileName}은 COMPLETE 상태여야 함`);
  }

  // 6. 9개 자치구별 건수 검증
  const expectedDistricts: Record<string, number> = {
    '11350': 17606, // 노원구
    '11500': 13679, // 강서구
    '11470': 10621, // 양천구
    '11200': 9650,  // 성동구
    '11380': 9500,  // 은평구
    '11260': 8643,  // 중랑구
    '11290': 7823,  // 성북구
    '11320': 5209,  // 도봉구
    '11305': 2881,  // 강북구
  };

  for (const [lawdCd, expectedTotal] of Object.entries(expectedDistricts)) {
    const d = report.districtSummary[lawdCd];
    assert.ok(d, `${lawdCd} 구가 요약에 존재해야 함`);
    assert.strictEqual(d.cellCount, 12, `${d.districtName} 셀 수가 12개여야 함`);
    assert.strictEqual(d.rawItems, expectedTotal, `${d.districtName} 총 건수가 ${expectedTotal}건이어야 함`);
  }
});
