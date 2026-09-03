// RENT 검증범위(verified range) 계산 — **순수 로직만** 둔다(fs/DB/네트워크 없음).
//
// DATA_FRESHNESS_AUTOMATION_V1_PHASE2 §24/§25 — 이전 버전은 이 파일이 module load 시점에
// data/rent-trade-history/coverage-manifest.json을 fs.readFileSync로 읽어 RENT_VERIFIED_FROM/TO를
// **상수로 고정**했다. 그 구조는 Vercel에서 durable할 수 없다는 것이 Phase 2 감사에서
// 실측으로 확인됐다(빌드 산출물 .nft.json 기준, manifest는 이를 읽는 함수마다 각자의 사본이
// 번들에 복사되는 **빌드 입력**이다 — cron 함수가 파일을 써도 dashboard 함수는 자기 사본만
// 본다. 게다가 module load 시점 상수는 warm instance에서 다시 읽히지도 않는다).
//
// 이제 coverage cell은 DB(sync_coverage_cells)에 있고, 그 I/O는 src/lib/sync-coverage.ts가
// 담당한다. 이 파일은 "cell 집합 -> 검증범위"라는 판정 규칙만 갖는다. 그 덕분에 이 파일은
// prisma를 import하지 않고, 테스트가 DB 없이 합성 입력으로 규칙 전체를 검증할 수 있다.
//
// 검증범위는 "오늘 기준 최근 N개월"이 아니라 **실제 sync/completeness 증거로 확정된 범위**다
// — sale(2006-01~, nationwide incremental sync 존재)과 근본적으로 다르다.

export interface VerifiedRange {
  from: string; // YYYYMM
  to: string; // YYYYMM
}

export interface CoverageCellStatusMap {
  // key = `${lawdCd}:${dealYmd}`
  [key: string]: { status: string } | undefined;
}

export const BUSAN_LAWDCD_16 = [
  '26110', '26140', '26170', '26200', '26230', '26260', '26290', '26320',
  '26350', '26380', '26410', '26440', '26470', '26500', '26530', '26710',
];

/**
 * DATA_FRESHNESS_AUTOMATION_V1_PHASE2 §14 — "검증됨"으로 인정되는 cell 상태.
 *
 * COMPLETE와 EMPTY_VALID 둘 다 포함한다. 이전 버전은 reader가 `status === 'COMPLETE'`만
 * 인정했는데, writer(shouldRecordCoverageCell)는 EMPTY_VALID도 기록했다 — 이 불일치 때문에
 * **실제로 전월세 거래가 0건인 구-월**(EMPTY_VALID)이 하나라도 있으면 coverage가 그 달에서
 * 영구히 멈추는 잠재 버그가 있었다(Phase 2 감사에서 발견).
 *
 * EMPTY_VALID는 "확인 실패"가 아니라 "API 정상 응답 + totalCount=0 + pagination 완료"로
 * 검증된 **신뢰할 수 있는 진짜 0건**이다(rent-completeness-logic.ts 참고). 프로젝트의 데이터
 * 진실성 원칙("성공적이고 신뢰할 수 있는 0 결과만 '거래 없음'이다")상 이것은 검증된 상태가
 * 맞다. PARTIAL/INVALID는 절대 포함하지 않는다 — 그건 "아직 확인되지 않음"이다.
 */
export const VERIFIED_CELL_STATUSES: readonly string[] = ['COMPLETE', 'EMPTY_VALID'];

export function isVerifiedCellStatus(status: string | undefined | null): boolean {
  return status != null && VERIFIED_CELL_STATUSES.includes(status);
}

/**
 * 파일/DB를 전혀 읽을 수 없는 극단적 상황의 최후 안전값 — 임의 추측이 아니라 이 프로젝트가
 * 실제로 검증해 두었던 마지막 값(과거 하드코딩 상수와 동일)이다.
 */
export const LEGACY_BOOTSTRAP_FALLBACK: VerifiedRange = { from: '202408', to: '202608' };

export function nextMonth(ym: string): string {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(4, 6));
  return m === 12 ? `${y + 1}01` : `${y}${String(m + 1).padStart(2, '0')}`;
}

function currentCalendarMonth(now: Date): string {
  return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * coverage cell 집합에서 검증범위를 계산한다.
 *
 * - `from`은 항상 bootstrap.from — 절대 역방향으로 확장하지 않는다.
 * - `to`는 bootstrap.to에서 한 달씩 전진하되, 그 달에 **모든 district**가 검증된 상태
 *   (COMPLETE 또는 EMPTY_VALID)일 때만 전진하고 첫 gap에서 멈춘다(§14 — 16/16 미만이면
 *   전진 금지, partial coverage를 verified로 확장하지 않는다).
 * - 현재(진행 중) 달과 그 이후는 무엇이 기록돼 있든 절대 포함하지 않는다(§15). 정상
 *   운영에서는 sync 엔진이 애초에 현재월을 완료로 기록하지 않지만, 이 함수도 독립적으로
 *   같은 규칙을 강제한다 — 단일 실패 지점에 의존하지 않기 위함.
 */
export function computeVerifiedRangeFromCoverage(
  bootstrap: VerifiedRange,
  cells: CoverageCellStatusMap,
  districts: string[] = BUSAN_LAWDCD_16,
  now: Date = new Date()
): VerifiedRange {
  const from = bootstrap.from;
  let to = bootstrap.to;
  const nowMonth = currentCalendarMonth(now);
  let cursor = nextMonth(to);
  // 안전장치: 무한루프 방지(최대 600개월=50년이면 충분히 넉넉하고, 정상 운영에서는 cells에
  // 없는 달을 만나는 즉시 멈추므로 몇 회 반복으로 끝난다).
  for (let i = 0; i < 600; i++) {
    if (cursor >= nowMonth) break;
    const allVerified = districts.every((code) => isVerifiedCellStatus(cells[`${code}:${cursor}`]?.status));
    if (!allVerified) break;
    to = cursor;
    cursor = nextMonth(cursor);
  }
  return { from, to };
}

/** 요청된 월(YYYYMM) 목록을 검증범위 안/밖으로 나눈다. 입력이 정렬돼 있지 않아도 안전하다
 * — 각 원소를 독립적으로 판정한다. */
export function splitVerifiedMonths(months: string[], range: VerifiedRange): { verified: string[]; unverified: string[] } {
  const verified: string[] = [];
  const unverified: string[] = [];
  for (const m of months) {
    if (m >= range.from && m <= range.to) verified.push(m);
    else unverified.push(m);
  }
  return { verified, unverified };
}

/** range.to 월의 마지막 날짜(UTC 자정) — SQL 쿼리 범위를 검증범위로 clip할 때 쓴다.
 * trade-history-read.ts의 `candidateFromDate()`와 동일하게 UTC 자정 고정(§BOUNDARY-FIX와
 * 같은 클래스의 day 경계 버그를 피하기 위함). */
export function verifiedToDateInclusive(range: VerifiedRange): Date {
  const y = Number(range.to.slice(0, 4));
  const m = Number(range.to.slice(4, 6));
  return new Date(Date.UTC(y, m, 0)); // m(1-based)의 다음 달 0일 = m월의 마지막 날
}

/** range.from 월의 첫째 날짜(UTC 자정). */
export function verifiedFromDateInclusive(range: VerifiedRange): Date {
  const y = Number(range.from.slice(0, 4));
  const m = Number(range.from.slice(4, 6));
  return new Date(Date.UTC(y, m - 1, 1));
}

/** 임의의 [from,to] 날짜 range를 검증범위로 clip한다. 겹치는 부분이 전혀 없으면 null
 * (호출부가 "이 range는 DB에서 셀 수 있는 부분이 0"으로 처리). PHASE D.2 §16 hybrid
 * routing(verified 부분=SQL aggregate, 나머지=MOLIT row count)의 핵심 유틸 — 대시보드의
 * 7일/30일/3개월 비교처럼 "현재"쪽 range가 항상 오늘(=진행중이라 미검증)까지 뻗는 경우,
 * clip된 부분만 DB에 묻고 나머지는 호출부가 이미 갖고 있는 미검증월 MOLIT row에서 직접
 * 세도록 경계를 알려준다. */
export function clipDateRangeToVerified(from: Date, to: Date, range: VerifiedRange): { from: Date; to: Date } | null {
  const vFrom = verifiedFromDateInclusive(range);
  const vTo = verifiedToDateInclusive(range);
  const clippedFrom = from < vFrom ? vFrom : from;
  const clippedTo = to > vTo ? vTo : to;
  if (clippedFrom > clippedTo) return null;
  return { from: clippedFrom, to: clippedTo };
}
