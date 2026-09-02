// RENT_TRADE_HISTORY_V1 PHASE D — DB/네트워크 없음(zero-DB, zero-network). 이 repo의
// `.test.mjs` 관례(`node --experimental-strip-types --test`)는 `./prisma`처럼 확장자
// 없는 상대 import를 해석하지 못한다(trade-history-read.ts도 동일 문제, EJIP_SCORE_V2_
// PHASE2의 score-card-presenter.ts와 같은 이유로 순수 로직만 분리) — rent-history-read.ts는
// 이 파일에서 상수/함수를 그대로 re-export해서 쓴다. 이 제약을 피하기 위해 아래 계산
// 로직은 다른 로컬 .ts 파일을 import하지 않고 이 파일 안에 그대로 둔다(fs/path는
// Node 내장 모듈이라 이 제약과 무관 — 확장자 없는 "상대" import만 문제였다).
//
// 검증범위는 "오늘 기준 최근 N개월"이 아니라 **실제 sync/completeness 증거로 확정된
// 범위**다 — sale(2006-01~, 매일 갱신되는 nationwide incremental sync 존재)과 근본적으로
// 다르다. dashboard의 `last12Months`는 항상 `now` 기준 rolling window라서, 이 범위가
// 고정된 채로 시간이 흐르면 window 뒤쪽(현재월 + 아직 sync 안 된 완료월)이 검증범위
// 밖으로 밀려난다.
//
// DATA_FRESHNESS_AUTOMATION_V1_PHASE1_5 §8/§9/§10 — 이전에는 이 값들이 사람이 sync
// 성공 후 직접 편집하는 리터럴 상수였다(Phase 1 감사에서 P0로 확정된 문제: "hardcoded
// month 업데이트가 필요한 구조"). 이제는 data/rent-trade-history/coverage-manifest.json을
// 읽어 자동으로 계산한다 — legacyBootstrap(아래 히스토리 그대로, 재검증 없이 그대로
// 계승)에서 시작해, cells에 부산 16개 구 전부 status:'COMPLETE'로 기록된 연속된 달만큼
// TO를 앞으로 전진시킨다(16/16 미만이면 그 달에서 멈춘다 — partial coverage를 verified로
// 확장하지 않음, §10/§13). 이번 STEP은 실제 --apply를 수행하지 않았으므로(§0 STOP 조건)
// cells는 비어 있고, 계산 결과는 legacyBootstrap과 정확히 같다 — 이는 의도된 동작이며,
// 새 메커니즘이 기존 값을 그대로 재현함을 보여주는 회귀 증거이기도 하다. 파일을 읽을 수
// 없는 극단적 상황에서만 동일한 legacyBootstrap 값으로 안전하게 폴백한다(추측 생성 아님
// — 이전에 실제로 쓰이던 값 그대로).
import * as fs from 'fs';
import * as path from 'path';

const BUSAN_LAWDCD_16 = ['26110', '26140', '26170', '26200', '26230', '26260', '26290', '26320', '26350', '26380', '26410', '26440', '26470', '26500', '26530', '26710'];

interface RentCoverageManifest {
  legacyBootstrap: { from: string; to: string };
  cells: Record<string, { status: string }>;
}

function nextMonth(ym: string): string {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(4, 6));
  return m === 12 ? `${y + 1}01` : `${y}${String(m + 1).padStart(2, '0')}`;
}

function currentCalendarMonth(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

// 순수 함수로 분리해 파일 I/O 없이 직접 단위 테스트할 수 있게 한다(§12/§29 — dry-run이
// coverage를 절대 전진시키지 않음, 15/16 미만이면 전진하지 않음, 현재월은 절대 포함하지
// 않음을 synthetic manifest로 증명).
export function computeVerifiedRangeFromManifest(
  manifest: RentCoverageManifest,
  districts: string[] = BUSAN_LAWDCD_16,
  now: Date = new Date()
): { from: string; to: string } {
  const from = manifest.legacyBootstrap.from;
  let to = manifest.legacyBootstrap.to;
  const nowMonth = currentCalendarMonth(now);
  let cursor = nextMonth(to);
  // 안전장치: 무한루프 방지(최대 600개월=50년 전진이면 충분히 넉넉하고, 정상 운영에서는
  // cells에 없는 달을 만나는 즉시 멈추므로 몇 회 반복으로 끝난다).
  for (let i = 0; i < 600; i++) {
    // §17 절대 원칙 — manifest에 무엇이 있든 현재 달(그리고 그 이후)은 절대 verified로
    // 포함하지 않는다. 정상 운영에서는 sync 엔진 자체가 현재월을 절대 COMPLETE로 기록하지
    // 않지만, 이 함수 자체도 방어적으로 같은 규칙을 강제한다(단일 실패 지점에 의존하지 않음).
    if (cursor >= nowMonth) break;
    const allComplete = districts.every((code) => manifest.cells[`${code}:${cursor}`]?.status === 'COMPLETE');
    if (!allComplete) break;
    to = cursor;
    cursor = nextMonth(cursor);
  }
  return { from, to };
}

function deriveVerifiedRange(): { from: string; to: string } {
  // 파일을 읽을 수 없을 때의 최후 안전값 — 임의 추측이 아니라 이 프로젝트가 실제로
  // 검증해 두었던 마지막 값(이전 하드코딩 상수와 동일)이다.
  const fallback = { from: '202408', to: '202608' };
  try {
    const manifestPath = path.join(process.cwd(), 'data/rent-trade-history/coverage-manifest.json');
    const manifest: RentCoverageManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    return computeVerifiedRangeFromManifest(manifest);
  } catch {
    return fallback;
  }
}

const { from: DERIVED_RENT_VERIFIED_FROM, to: DERIVED_RENT_VERIFIED_TO } = deriveVerifiedRange();
export const RENT_VERIFIED_FROM = DERIVED_RENT_VERIFIED_FROM;
export const RENT_VERIFIED_TO = DERIVED_RENT_VERIFIED_TO;

/** 요청된 월(YYYYMM) 목록을 검증범위 안/밖으로 나눈다. 입력이 정렬돼 있지 않아도
 * 안전하다 — 각 원소를 독립적으로 판정한다. */
export function splitVerifiedMonths(months: string[]): { verified: string[]; unverified: string[] } {
  const verified: string[] = [];
  const unverified: string[] = [];
  for (const m of months) {
    if (m >= RENT_VERIFIED_FROM && m <= RENT_VERIFIED_TO) verified.push(m);
    else unverified.push(m);
  }
  return { verified, unverified };
}

/** RENT_VERIFIED_TO 월의 마지막 날짜(UTC 자정) — SQL 쿼리 범위를 검증범위로 clip할 때
 * 쓴다(예: 오늘까지 뻗는 "최근 7일" 구간의 일부만 verified). trade-history-read.ts의
 * `candidateFromDate()`와 동일하게 UTC 자정 고정(§BOUNDARY-FIX와 같은 클래스의 day
 * 경계 버그를 피하기 위함). */
export function verifiedToDateInclusive(): Date {
  const y = Number(RENT_VERIFIED_TO.slice(0, 4));
  const m = Number(RENT_VERIFIED_TO.slice(4, 6));
  return new Date(Date.UTC(y, m, 0)); // m(1-based)의 다음 달 0일 = m월의 마지막 날
}

/** RENT_VERIFIED_FROM 월의 첫째 날짜(UTC 자정). */
export function verifiedFromDateInclusive(): Date {
  const y = Number(RENT_VERIFIED_FROM.slice(0, 4));
  const m = Number(RENT_VERIFIED_FROM.slice(4, 6));
  return new Date(Date.UTC(y, m - 1, 1));
}

/** 임의의 [from,to] 날짜 range를 검증범위 [verifiedFrom,verifiedTo]로 clip한다. 겹치는
 * 부분이 전혀 없으면 null(호출부가 "이 range는 DB에서 셀 수 있는 부분이 0"으로 처리).
 * PHASE D.2 §16 hybrid routing(verified 부분=SQL aggregate, 나머지=MOLIT row count)의
 * 핵심 유틸 — 대시보드의 7일/30일/3개월 비교처럼 "현재"쪽 range가 항상 오늘(=현재
 * 진행중이라 미검증)까지 뻗는 경우, clip된 부분만 DB에 묻고 나머지는 호출부가 이미
 * 갖고 있는 미검증월 MOLIT row에서 직접 세도록 경계를 알려준다. */
export function clipDateRangeToVerified(from: Date, to: Date): { from: Date; to: Date } | null {
  const vFrom = verifiedFromDateInclusive();
  const vTo = verifiedToDateInclusive();
  const clippedFrom = from < vFrom ? vFrom : from;
  const clippedTo = to > vTo ? vTo : to;
  if (clippedFrom > clippedTo) return null;
  return { from: clippedFrom, to: clippedTo };
}
