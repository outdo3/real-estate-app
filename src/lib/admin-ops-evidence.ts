// ADMIN_OPS_V1.1 — 순수 함수만 모아둔 파일(DB/네트워크 호출 없음, 테스트 대상).
// admin/ops/route.ts가 이 파일의 결과를 그대로 쓴다 — 결정 로직(누가 SAFE인가,
// 언제 CRITICAL/WARNING/UNKNOWN인가)과 I/O(DB 쿼리, manifest 파일 읽기)를
// 분리해 로직만 독립적으로 테스트 가능하게 한다.

export type EvidenceType = 'LIVE' | 'SNAPSHOT' | 'CONFIG' | 'UNKNOWN';

export interface ManifestCellEntry {
  status: 'COMPLETE' | 'EMPTY_VALID' | 'FAILED' | 'INVALID';
  insertCount: number;
  updateFalseToTrue: number;
  updateTrueToFalseSkipped: number;
  conflicts: number;
  reviewRequired?: number; // 이전 STEP의 manifest entry는 이 필드가 없을 수 있음
  at: string;
}
export type Manifest = Record<string, ManifestCellEntry>;

export interface ManifestSummary {
  cells: number;
  regionsInScope: number;
  complete: number;
  emptyValid: number;
  failed: number;
  invalid: number;
  rowsInserted: number;
  cancellationsUpdated: number;
  reviewRequired: number;
  lastSyncAt: string | null;
}

/** manifest(region-month → cell 상태) 파일 하나를 집계한다. key 형식은
 * `${lawdCd}:${dealYmd}` — regionsInScope는 lawdCd 종류 수(distinct). */
export function summarizeManifest(manifest: Manifest): ManifestSummary {
  const entries = Object.values(manifest);
  let complete = 0, emptyValid = 0, failed = 0, invalid = 0;
  let rowsInserted = 0, cancellationsUpdated = 0, reviewRequired = 0;
  let lastSyncAt: string | null = null;
  const regions = new Set<string>();
  for (const key of Object.keys(manifest)) regions.add(key.split(':')[0]);
  for (const e of entries) {
    if (e.status === 'COMPLETE') complete++;
    else if (e.status === 'EMPTY_VALID') emptyValid++;
    else if (e.status === 'FAILED') failed++;
    else if (e.status === 'INVALID') invalid++;
    rowsInserted += e.insertCount || 0;
    cancellationsUpdated += e.updateFalseToTrue || 0;
    reviewRequired += e.reviewRequired || 0;
    if (!lastSyncAt || e.at > lastSyncAt) lastSyncAt = e.at;
  }
  return { cells: entries.length, regionsInScope: regions.size, complete, emptyValid, failed, invalid, rowsInserted, cancellationsUpdated, reviewRequired, lastSyncAt };
}

export interface CancellationVerdictInput {
  cells: number;
  complete: number;
  emptyValid: number;
  failed: number;
  invalid: number;
  conflicts: number;
  idempotent: boolean;
}

// ADMIN_OPS_V1.2 §7 — API는 snapshot 파일에 저장된 verdict 문자열을 그대로
// 신뢰하지 않고, 매번 원본 필드에서 이 함수로 재계산한다(저장된 문자열이
// 손상/변조돼도 걸러낸다). SAFE 조건: cells가 0건(아무것도 검증되지 않음)이면
// SAFE 금지(incomplete snapshot). FAILED/INVALID/conflicts가 하나라도 있으면
// SAFE 금지. idempotency가 확인되지 않았으면(재실행 시 변경이 발견됐다면)
// SAFE 금지. cells != complete+emptyValid(내부 정합성 깨짐, 예: 파일 수기
// 조작이나 버그)면 SAFE 금지.
export function computeCancellationVerdict(input: CancellationVerdictInput): 'SAFE' | 'UNSAFE' {
  if (input.cells <= 0) return 'UNSAFE';
  if (input.failed > 0) return 'UNSAFE';
  if (input.invalid > 0) return 'UNSAFE';
  if (input.conflicts > 0) return 'UNSAFE';
  if (!input.idempotent) return 'UNSAFE';
  if (input.cells !== input.complete + input.emptyValid) return 'UNSAFE';
  return 'SAFE';
}

export type OverallStatusCode = 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'UNKNOWN';

export interface OverallHealthInput {
  aptSeqMissing: number;
  nationwideManifestStatus: 'ok' | 'missing' | 'unreadable';
  nationwideFailed: number;
  nationwideInvalid: number;
  nationwideReviewRequired: number;
  cancellation24mStatus: 'ok' | 'missing' | 'unreadable';
  cancellation24mVerdict: 'SAFE' | 'UNSAFE' | null;
  sejongInRegionModel: boolean;
}

export interface OverallHealthResult {
  statusCode: OverallStatusCode;
  criticalReasons: string[];
  warningReasons: string[];
}

// §18 — 개발 단계상 정상적으로 미완성인 상태(전국 DB coverage 미완성, 스케줄러
// OFF)는 여기서 아예 입력으로 받지 않는다 — 애초에 warning 후보가 될 수 없게
// 설계했다(자동으로 경고화되는 것을 원천 차단). §2 "확인 불가능 → 정상" 금지 —
// 핵심 evidence(manifest/snapshot)를 읽지 못하면(unreadable) UNKNOWN이고,
// CRITICAL 사유가 하나라도 있으면 UNKNOWN보다 CRITICAL이 우선한다(더 급한 사실을
// 숨기지 않는다).
export function computeOverallHealth(input: OverallHealthInput): OverallHealthResult {
  const criticalReasons: string[] = [];
  const warningReasons: string[] = [];
  let unknown = false;

  if (input.aptSeqMissing > 0) criticalReasons.push(`부산 aptSeq 없는 row ${input.aptSeqMissing}건 발견(LIVE)`);
  if (input.nationwideManifestStatus === 'unreadable') unknown = true;
  if (input.nationwideManifestStatus === 'ok') {
    if (input.nationwideFailed > 0) criticalReasons.push(`최근 sync에 FAILED cell ${input.nationwideFailed}건(SNAPSHOT)`);
    if (input.nationwideInvalid > 0) criticalReasons.push(`최근 sync에 INVALID(identity conflict) cell ${input.nationwideInvalid}건(SNAPSHOT)`);
    if (input.nationwideReviewRequired > 0) warningReasons.push(`REVIEW_REQUIRED 거래 ${input.nationwideReviewRequired}건(aptSeq 없어 미반영, SNAPSHOT)`);
  }
  if (input.cancellation24mStatus === 'unreadable' || input.cancellation24mStatus === 'missing') unknown = true;
  else if (input.cancellation24mVerdict !== 'SAFE') criticalReasons.push('24개월 취소검증 snapshot이 SAFE가 아님');
  if (!input.sejongInRegionModel) warningReasons.push('세종특별자치시가 region model에서 조회되지 않음');

  let statusCode: OverallStatusCode;
  if (criticalReasons.length > 0) statusCode = 'CRITICAL';
  else if (unknown) statusCode = 'UNKNOWN';
  else if (warningReasons.length > 0) statusCode = 'WARNING';
  else statusCode = 'HEALTHY';

  return { statusCode, criticalReasons, warningReasons };
}

export const OVERALL_STATUS_LABELS: Record<OverallStatusCode, string> = {
  HEALTHY: '정상',
  WARNING: '확인 필요',
  CRITICAL: '문제',
  UNKNOWN: '확인 불가',
};
