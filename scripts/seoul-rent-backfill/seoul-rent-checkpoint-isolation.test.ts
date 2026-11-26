/**
 * E-JIP 서울 V3.8-A — Checkpoint 환경 격리 안전장치 검증 테스트
 *
 * 검증 항목:
 * 1. 로컬 Docker QA DB의 APPLIED Checkpoint는 운영 Supabase Apply 실행 시 결코 스킵으로 인정되지 않아야 함 (false 반환)
 * 2. 환경 정보가 없는 레거시 또는 UNKNOWN Checkpoint 역시 운영 Supabase Apply 실행 시 스킵 거부
 * 3. 운영 환경에서 생성된 APPLIED Checkpoint만 운영 Supabase Apply 실행 시 스킵 인정
 * 4. QA 환경에서는 QA APPLIED Checkpoint만 스킵 인정
 * 5. Dry-run 모드에서는 환경과 무관하게 데이터 수집 완료 여부만으로 안전하게 스킵 허용
 */

import { test } from 'node:test';
import * as assert from 'node:assert';
import {
  SeoulRentBackfillEngine,
  CellExecutionRecord,
} from './seoul-rent-backfill-engine';

test('Checkpoint 환경 격리 안전장치: QA와 운영 간 APPLIED Checkpoint 혼용 원천 차단 검증', () => {
  const dummyFetcher = {
    fetchCell: async () => ({
      items: [],
      totalCount: 0,
      firstPageFailed: false,
      anyLaterPageFailed: false,
    }),
  };

  // 1. 운영 DB 엔진 생성 (targetDbEnv: 'OPERATIONAL_SUPABASE', dryRun: false)
  const prodEngine = new SeoulRentBackfillEngine(
    {
      scope: ['11200'],
      fromYmd: '202610',
      toYmd: '202610',
      dryRun: false,
      targetDbEnv: 'OPERATIONAL_SUPABASE',
    },
    dummyFetcher
  );

  // 로컬 Docker QA에서 성공한 Checkpoint 레코드
  const qaAppliedRecord: CellExecutionRecord = {
    cellKey: '11200:202610',
    lawdCd: '11200',
    districtName: '성동구',
    dealYmd: '202610',
    executionMode: 'APPLIED',
    targetDbEnv: 'LOCAL_DOCKER_QA',
    status: 'COMPLETE',
    totalCount: 500,
    collectedCount: 500,
    plannedInserts: 500,
    skippedGuarded: 0,
    unchanged: 0,
    reviewDiffCount: 0,
    persistedCount: 500,
    durationMs: 120,
    processedAt: new Date().toISOString(),
  };

  // 환경 정보가 없는 레거시 Checkpoint 레코드
  const legacyRecord: CellExecutionRecord = {
    ...qaAppliedRecord,
    targetDbEnv: undefined,
  };

  // 실제 운영 DB에서 성공한 Checkpoint 레코드
  const prodAppliedRecord: CellExecutionRecord = {
    ...qaAppliedRecord,
    targetDbEnv: 'OPERATIONAL_SUPABASE',
  };

  // [검증 1] 운영 DB 엔진은 QA Checkpoint를 스킵하지 않고 재수집/재적재를 요구해야 함!
  assert.strictEqual(
    prodEngine.isCellEligibleForSkip(qaAppliedRecord, false, 'OPERATIONAL_SUPABASE'),
    false,
    '운영 DB 엔진에서 QA Checkpoint는 절대 스킵되지 않아야 함'
  );

  // [검증 2] 환경 정보가 없는 UNKNOWN/레거시 Checkpoint도 운영 DB 엔진에서 스킵 거부
  assert.strictEqual(
    prodEngine.isCellEligibleForSkip(legacyRecord, false, 'OPERATIONAL_SUPABASE'),
    false,
    '환경 식별자가 없는 Checkpoint는 운영 DB에서 스킵 거부되어야 함'
  );

  // [검증 3] 오직 동일한 OPERATIONAL_SUPABASE 환경의 Checkpoint만 운영 DB 엔진에서 스킵 허용
  assert.strictEqual(
    prodEngine.isCellEligibleForSkip(prodAppliedRecord, false, 'OPERATIONAL_SUPABASE'),
    true,
    '운영 DB에서 적재 완료된 Checkpoint만 운영 스킵 허용'
  );

  // [검증 4] QA DB 엔진에서도 운영 Checkpoint나 UNKNOWN Checkpoint를 격리
  const qaEngine = new SeoulRentBackfillEngine(
    {
      scope: ['11200'],
      fromYmd: '202610',
      toYmd: '202610',
      dryRun: false,
      targetDbEnv: 'LOCAL_DOCKER_QA',
    },
    dummyFetcher
  );

  assert.strictEqual(
    qaEngine.isCellEligibleForSkip(prodAppliedRecord, false, 'LOCAL_DOCKER_QA'),
    false,
    'QA DB 엔진에서 운영 Checkpoint는 격리되어 스킵 거부'
  );
  assert.strictEqual(
    qaEngine.isCellEligibleForSkip(qaAppliedRecord, false, 'LOCAL_DOCKER_QA'),
    true,
    'QA DB 엔진에서는 QA Checkpoint 정상 스킵'
  );

  // [검증 5] Dry-run 수집 모드에서는 환경 무관하게 데이터 수집 완료 시 스킵 허용
  assert.strictEqual(
    prodEngine.isCellEligibleForSkip(qaAppliedRecord, true),
    true,
    'Dry-run 수집 단계에서는 완료된 셀 스킵 허용'
  );
});
