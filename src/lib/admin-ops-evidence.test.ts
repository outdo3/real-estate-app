import assert from 'node:assert/strict';
import test from 'node:test';
import {
  summarizeManifest,
  computeCancellationVerdict,
  computeOverallHealth,
  OVERALL_STATUS_LABELS,
  type Manifest,
} from './admin-ops-evidence';

function cell(overrides: Partial<Manifest[string]> = {}): Manifest[string] {
  return {
    status: 'COMPLETE',
    insertCount: 0,
    updateFalseToTrue: 0,
    updateTrueToFalseSkipped: 0,
    conflicts: 0,
    at: '2026-08-31T00:00:00.000Z',
    ...overrides,
  };
}

// ── summarizeManifest ──────────────────────────────────────────────────────

test('summarizeManifest: 상태별 개수를 정확히 센다', () => {
  const manifest: Manifest = {
    '26140:202608': cell({ status: 'COMPLETE' }),
    '26140:202607': cell({ status: 'EMPTY_VALID' }),
    '11680:202608': cell({ status: 'FAILED' }),
    '27110:202608': cell({ status: 'INVALID' }),
  };
  const s = summarizeManifest(manifest);
  assert.equal(s.cells, 4);
  assert.equal(s.complete, 1);
  assert.equal(s.emptyValid, 1);
  assert.equal(s.failed, 1);
  assert.equal(s.invalid, 1);
});

test('summarizeManifest: lawdCd 종류 수(regionsInScope)를 distinct로 센다', () => {
  const manifest: Manifest = {
    '26140:202608': cell(),
    '26140:202607': cell(),
    '11680:202608': cell(),
  };
  const s = summarizeManifest(manifest);
  assert.equal(s.regionsInScope, 2); // 26140, 11680
});

test('summarizeManifest: reviewRequired 필드가 없는(구버전) entry는 0으로 취급한다', () => {
  const manifest: Manifest = {
    '26140:202608': cell({ reviewRequired: undefined }),
  };
  const s = summarizeManifest(manifest);
  assert.equal(s.reviewRequired, 0);
});

test('summarizeManifest: reviewRequired/insertCount/updateFalseToTrue를 합산한다', () => {
  const manifest: Manifest = {
    a: cell({ insertCount: 5, updateFalseToTrue: 2, reviewRequired: 1 }),
    b: cell({ insertCount: 3, updateFalseToTrue: 0, reviewRequired: 4 }),
  };
  const s = summarizeManifest(manifest);
  assert.equal(s.rowsInserted, 8);
  assert.equal(s.cancellationsUpdated, 2);
  assert.equal(s.reviewRequired, 5);
});

test('summarizeManifest: 가장 최근 at를 lastSyncAt으로 고른다', () => {
  const manifest: Manifest = {
    a: cell({ at: '2026-08-01T00:00:00.000Z' }),
    b: cell({ at: '2026-08-31T23:59:59.000Z' }),
    c: cell({ at: '2026-08-15T00:00:00.000Z' }),
  };
  const s = summarizeManifest(manifest);
  assert.equal(s.lastSyncAt, '2026-08-31T23:59:59.000Z');
});

test('summarizeManifest: 빈 manifest는 전부 0/null이다', () => {
  const s = summarizeManifest({});
  assert.equal(s.cells, 0);
  assert.equal(s.lastSyncAt, null);
});

// ── computeCancellationVerdict — ADMIN_OPS_V1.2 §8: "실제 검증 기록과 일치하지
// 않거나 incomplete/FAILED/INVALID/conflicts/non-idempotent → SAFE 금지" ──

function verdictInput(overrides: Partial<Parameters<typeof computeCancellationVerdict>[0]> = {}) {
  return { cells: 384, complete: 384, emptyValid: 0, failed: 0, invalid: 0, conflicts: 0, idempotent: true, ...overrides };
}

// §8 "실제 Snapshot" — TRADE_CANCELLATION_RESYNC_V2의 실제 검증 결과
// (202409~202608, 384/384 COMPLETE, FAILED 0, INVALID 0)와 정확히 같은 형태.
test('computeCancellationVerdict: 실제 검증 기록(384/384 완료, FAILED/INVALID 0)이면 SAFE', () => {
  assert.equal(computeCancellationVerdict(verdictInput()), 'SAFE');
});

test('computeCancellationVerdict: cells=0(검증된 적 없음)이면 SAFE 금지', () => {
  assert.equal(computeCancellationVerdict(verdictInput({ cells: 0, complete: 0 })), 'UNSAFE');
});

test('computeCancellationVerdict: FAILED가 1건이라도 있으면 SAFE 금지', () => {
  assert.equal(computeCancellationVerdict(verdictInput({ failed: 1, complete: 383 })), 'UNSAFE');
});

test('computeCancellationVerdict: INVALID가 1건이라도 있으면 SAFE 금지', () => {
  assert.equal(computeCancellationVerdict(verdictInput({ invalid: 1, complete: 383 })), 'UNSAFE');
});

test('computeCancellationVerdict: FAILED와 INVALID가 둘 다 있어도 UNSAFE(중복 문제 아님)', () => {
  assert.equal(computeCancellationVerdict(verdictInput({ failed: 2, invalid: 3, complete: 379 })), 'UNSAFE');
});

// §8 "cell mismatch" — cells 합계가 complete+emptyValid와 다르면(내부 정합성
// 깨짐 — 예: 파일 수기 조작, 계산 버그) SAFE 금지. 이 케이스 자체는 FAILED/
// INVALID가 0이라도 막아야 한다("논리적으로 complete일 수 있지만 실제
// verification record와 다르면 SAFE 금지").
test('computeCancellationVerdict: cells != complete+emptyValid(내부 정합성 깨짐)면 SAFE 금지', () => {
  assert.equal(computeCancellationVerdict(verdictInput({ cells: 384, complete: 368, emptyValid: 16 - 1 })), 'UNSAFE');
});

test('computeCancellationVerdict: conflicts가 1건이라도 있으면 SAFE 금지', () => {
  assert.equal(computeCancellationVerdict(verdictInput({ conflicts: 1 })), 'UNSAFE');
});

test('computeCancellationVerdict: idempotent가 false이면(재검증 시 변경 발견) SAFE 금지', () => {
  assert.equal(computeCancellationVerdict(verdictInput({ idempotent: false })), 'UNSAFE');
});

test('computeCancellationVerdict: EMPTY_VALID가 섞여 있어도 complete+emptyValid=cells면 정합성 통과', () => {
  assert.equal(computeCancellationVerdict(verdictInput({ complete: 368, emptyValid: 16 })), 'SAFE');
});

// ── computeOverallHealth ────────────────────────────────────────────────────

const HEALTHY_INPUT = {
  aptSeqMissing: 0,
  nationwideManifestStatus: 'ok' as const,
  nationwideFailed: 0,
  nationwideInvalid: 0,
  nationwideReviewRequired: 0,
  cancellation24mStatus: 'ok' as const,
  cancellation24mVerdict: 'SAFE' as const,
  sejongInRegionModel: true,
};

test('computeOverallHealth: 전부 정상이면 HEALTHY', () => {
  const r = computeOverallHealth(HEALTHY_INPUT);
  assert.equal(r.statusCode, 'HEALTHY');
  assert.equal(r.criticalReasons.length, 0);
  assert.equal(r.warningReasons.length, 0);
});

test('computeOverallHealth: live aptSeq missing > 0이면 CRITICAL', () => {
  const r = computeOverallHealth({ ...HEALTHY_INPUT, aptSeqMissing: 3 });
  assert.equal(r.statusCode, 'CRITICAL');
  assert.ok(r.criticalReasons.some((s) => s.includes('aptSeq')));
});

test('computeOverallHealth: 최근 sync에 FAILED cell이 있으면 CRITICAL', () => {
  const r = computeOverallHealth({ ...HEALTHY_INPUT, nationwideFailed: 1 });
  assert.equal(r.statusCode, 'CRITICAL');
});

test('computeOverallHealth: 최근 sync에 INVALID(identity conflict) cell이 있으면 CRITICAL', () => {
  const r = computeOverallHealth({ ...HEALTHY_INPUT, nationwideInvalid: 1 });
  assert.equal(r.statusCode, 'CRITICAL');
});

test('computeOverallHealth: 24개월 취소검증 verdict가 SAFE가 아니면 CRITICAL', () => {
  const r = computeOverallHealth({ ...HEALTHY_INPUT, cancellation24mVerdict: 'UNSAFE' });
  assert.equal(r.statusCode, 'CRITICAL');
});

test('computeOverallHealth: 24개월 snapshot 파일이 없으면(missing) UNKNOWN — 정상으로 표시하지 않는다', () => {
  const r = computeOverallHealth({ ...HEALTHY_INPUT, cancellation24mStatus: 'missing', cancellation24mVerdict: null });
  assert.equal(r.statusCode, 'UNKNOWN');
});

test('computeOverallHealth: 24개월 snapshot 파일이 손상되면(unreadable) UNKNOWN', () => {
  const r = computeOverallHealth({ ...HEALTHY_INPUT, cancellation24mStatus: 'unreadable', cancellation24mVerdict: null });
  assert.equal(r.statusCode, 'UNKNOWN');
});

test('computeOverallHealth: nationwide manifest가 손상되면(unreadable) UNKNOWN', () => {
  const r = computeOverallHealth({ ...HEALTHY_INPUT, nationwideManifestStatus: 'unreadable' });
  assert.equal(r.statusCode, 'UNKNOWN');
});

test('computeOverallHealth: nationwide manifest가 아직 없으면(missing, 첫 실행 전) 정상적 무상태 — UNKNOWN 아님', () => {
  const r = computeOverallHealth({ ...HEALTHY_INPUT, nationwideManifestStatus: 'missing' });
  assert.equal(r.statusCode, 'HEALTHY');
});

test('computeOverallHealth: CRITICAL 사유가 있으면 UNKNOWN보다 CRITICAL이 우선한다', () => {
  const r = computeOverallHealth({ ...HEALTHY_INPUT, aptSeqMissing: 1, cancellation24mStatus: 'missing', cancellation24mVerdict: null });
  assert.equal(r.statusCode, 'CRITICAL');
});

test('computeOverallHealth: 세종이 region model에 없으면 WARNING(CRITICAL 아님)', () => {
  const r = computeOverallHealth({ ...HEALTHY_INPUT, sejongInRegionModel: false });
  assert.equal(r.statusCode, 'WARNING');
});

test('computeOverallHealth: REVIEW_REQUIRED > 0이면 WARNING(CRITICAL 아님)', () => {
  const r = computeOverallHealth({ ...HEALTHY_INPUT, nationwideReviewRequired: 2 });
  assert.equal(r.statusCode, 'WARNING');
});

test('computeOverallHealth: 개발 단계상 정상적으로 미완성인 상태(전국 DB coverage, 스케줄러 OFF)는 입력에 없으므로 자동으로 경고화되지 않는다', () => {
  // HEALTHY_INPUT 자체가 이미 이런 필드를 받지 않는 설계임을 타입으로 보장한다 —
  // 이 테스트는 그 설계 의도를 명시적으로 문서화한다.
  const r = computeOverallHealth(HEALTHY_INPUT);
  assert.equal(r.statusCode, 'HEALTHY');
});

test('OVERALL_STATUS_LABELS: 4개 상태 모두 한국어 라벨을 갖는다', () => {
  assert.equal(OVERALL_STATUS_LABELS.HEALTHY, '정상');
  assert.equal(OVERALL_STATUS_LABELS.WARNING, '확인 필요');
  assert.equal(OVERALL_STATUS_LABELS.CRITICAL, '문제');
  assert.equal(OVERALL_STATUS_LABELS.UNKNOWN, '확인 불가');
});
