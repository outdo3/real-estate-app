// TRADE_DB_FIRST_V1 STEP F — 순수 함수만 모아둔 파일(DB/네트워크 호출 없음, 다른
// scripts/*.ts를 import하지 않음 — trade-history-logic.ts와 동일 원칙, 파일 상단
// 주석 참고: tsc allowImportingTsExtensions 미설정 상태에서 scripts/*.ts가 서로를
// 확장자 없이 import하면 Node 네이티브 ESM 테스트 러너(--experimental-strip-types)가
// 해석하지 못하는 도구 제약이 있어, 테스트 가능한 순수 로직은 의존성 없는 별도
// 파일로 분리한다).

export type CellStatus = 'COMPLETE' | 'EMPTY_VALID' | 'FAILED' | 'INVALID';
export interface NationwideCellEntry {
  status: CellStatus;
  fetched: number;
  invalidRows: number;
  insertCount: number;
  updateFalseToTrue: number;
  updateTrueToFalseSkipped: number;
  conflicts: number;
  reviewRequired: number;
  at: string;
}
export type NationwideManifest = Record<string, NationwideCellEntry>; // key = `${lawdCd}:${dealYmd}`

// sync-trade-history.ts §40 LATE REPORTING 주석과 동일 근거(실거래 신고 지연
// 30~60일 + 취소 반영 지연) + STEP F §9 실측(부산 4,709건 취소 샘플: dealDate
// 대비 cancelDate lag p50=1개월, p75=2개월, **p90=3개월**, p95=4개월, p99=12개월).
// 3개월 overlap이면 취소 반영의 92.1%를 매 실행마다 흡수한다 — 나머지 긴 꼬리
// (7.9%, 최대 21개월)는 이 상시 incremental 엔진이 아니라 TRADE_CANCELLATION_
// RESYNC_V1/V2 같은 별도 주기적 광범위 재검증의 몫으로 남긴다.
export const DEFAULT_OVERLAP_MONTHS = 3;

function ymToIndex(ym: string): number {
  return parseInt(ym.slice(0, 4), 10) * 12 + parseInt(ym.slice(4, 6), 10);
}
function indexToYm(idx: number): string {
  const y = Math.floor((idx - 1) / 12);
  const m = idx - y * 12;
  return `${y}${String(m).padStart(2, '0')}`;
}

/**
 * §8 incremental month 계산.
 * - manifest에 이 지역의 완료 기록(COMPLETE/EMPTY_VALID)이 있으면: 그 중 가장
 *   최근 달에서 overlapMonths만큼 뒤로 물러난 지점부터 현재월까지 재처리한다
 *   (재확인 구간 + 그 사이 새로 생겼을 수 있는 달 전부 포함).
 * - 기록이 전혀 없으면(첫 실행): 최근 overlapMonths개월만 처리한다(딥 백필 아님,
 *   §4 명시적 범위 제한 — 전체 과거 이력은 backfill-trade-history.ts의 별도
 *   명시적 실행 책임으로 남긴다).
 * - FAILED은 완료로 인정하지 않는다(완료 지점을 앞당기지 않음).
 */
export function computeMonthsForRegion(lawdCd: string, manifest: NationwideManifest, now: Date, overlapMonths: number = DEFAULT_OVERLAP_MONTHS): string[] {
  const nowYm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const nowIdx = ymToIndex(nowYm);

  let lastCompleteIdx: number | null = null;
  for (const key of Object.keys(manifest)) {
    const [keyLawdCd, ym] = key.split(':');
    if (keyLawdCd !== lawdCd) continue;
    const entry = manifest[key];
    if (entry.status !== 'COMPLETE' && entry.status !== 'EMPTY_VALID') continue;
    const idx = ymToIndex(ym);
    if (lastCompleteIdx === null || idx > lastCompleteIdx) lastCompleteIdx = idx;
  }

  const fromIdx = lastCompleteIdx === null ? nowIdx - (overlapMonths - 1) : Math.min(lastCompleteIdx - (overlapMonths - 1), nowIdx - (overlapMonths - 1));
  const months: string[] = [];
  for (let idx = fromIdx; idx <= nowIdx; idx++) months.push(indexToYm(idx));
  return months;
}
