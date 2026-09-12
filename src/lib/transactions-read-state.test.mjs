import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  resolveTransactionsReadState,
  TRADE_API_UNAVAILABLE_MESSAGE,
  TRADE_PARTIAL_MESSAGE,
} from './trade-read-state.ts';
import { classifyMolitMonthResult, foldMonthResults, summarizeTradeCompleteness } from './apt-trade-completeness.ts';

// TRANSACTIONS_API_TRUST_V1 — /api/transactions 완전성 계약.
//
// 이 라우트는 저장소에서 유일하게 bare array를 내려주던 곳이라 "몇 개 월을 실제로
// 읽었는가"를 담을 자리가 없었다. 실패한 달의 에러 플레이스홀더가 배열에 섞여 나간 뒤
// 소비자에서 좌표/평형이 없다는 이유로 조용히 걸러져 결과가 그냥 적어 보였다.

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..');
const read = (rel) => readFileSync(join(SRC, rel), 'utf8');

const ERROR_PLACEHOLDER = { id: 'error-apt', name: 'API 에러: 초당 서비스 요청제한 횟수 초과 에러', typeLabel: '에러', lat: null, lng: null };
const ROW = (n) => ({ name: n, typeLabel: '실거래', dealAmount: 60000, lat: 35.1, lng: 129.0 });

// ── A~F: 월별 실패 시나리오 (라우트가 쓰는 판정 함수 그대로) ──────────────────

function foldMonths(monthResults) {
  const outcomes = monthResults.map(([dealYmd, items]) => ({ dealYmd, items, status: classifyMolitMonthResult(items) }));
  const folded = foldMonthResults(outcomes);
  return { items: folded.items, summary: summarizeTradeCompleteness(folded.cells) };
}

test('A. 모든 월 성공 + 데이터 있음 → 완전', () => {
  const { items, summary } = foldMonths([['202601', [ROW('가')]], ['202602', [ROW('나')]]]);
  assert.equal(summary.partial, false);
  assert.equal(summary.monthsSucceeded, 2);
  assert.equal(items.length, 2);
});

test('B. 모든 월 성공 + 전부 0건 → 완전한 "검증된 0건"(실패 아님)', () => {
  const { items, summary } = foldMonths([['202601', []], ['202602', []]]);
  assert.equal(summary.partial, false, 'SUCCESS_EMPTY를 실패로 접으면 모든 무거래가 오류로 보인다');
  assert.equal(summary.monthsSucceeded, 2);
  assert.equal(items.length, 0);
});

test('C. 한 달 실패 → partial, 에러 플레이스홀더는 결과에서 제거된다', () => {
  const { items, summary } = foldMonths([['202601', [ROW('가')]], ['202602', [ERROR_PLACEHOLDER]]]);
  assert.equal(summary.partial, true);
  assert.deepEqual(summary.failedMonths, ['202602']);
  assert.equal(summary.monthsSucceeded, 1);
  assert.equal(items.length, 1, '가짜 에러 행이 거래 배열에 남으면 안 된다');
  assert.ok(!items.some((i) => i.typeLabel === '에러'));
});

test('D. 여러 달 실패 → 실패 월이 모두 보고된다', () => {
  const { summary } = foldMonths([
    ['202601', [ROW('가')]], ['202602', [ERROR_PLACEHOLDER]], ['202603', [ERROR_PLACEHOLDER]],
  ]);
  assert.equal(summary.partial, true);
  assert.deepEqual(summary.failedMonths, ['202602', '202603']);
  assert.equal(summary.monthsRequested, 3);
  assert.equal(summary.monthsSucceeded, 1);
});

test('E. 전 월 실패 → allFailed (0건과 절대 구분된다)', () => {
  const { items, summary } = foldMonths([['202601', [ERROR_PLACEHOLDER]], ['202602', [ERROR_PLACEHOLDER]]]);
  assert.equal(summary.allFailed, true);
  assert.equal(summary.monthsSucceeded, 0);
  assert.equal(items.length, 0);
  // B(전부 0건)와 값이 같아 보이지만 완전성이 정반대다 — 이 구분이 이 STEP의 핵심이다.
  const zero = foldMonths([['202601', []], ['202602', []]]);
  assert.equal(zero.items.length, items.length);
  assert.notEqual(zero.summary.partial, summary.partial, 'FAILED와 ZERO가 같은 상태가 되면 안 된다');
});

test('F. 실패 후 재조회 성공 → 완전으로 회복된다', () => {
  const first = foldMonths([['202601', [ROW('가')]], ['202602', [ERROR_PLACEHOLDER]]]);
  assert.equal(first.summary.partial, true);
  const retry = foldMonths([['202601', [ROW('가')]], ['202602', [ROW('나')]]]);
  assert.equal(retry.summary.partial, false, '이전 실패가 다음 조회에 남으면 안 된다');
  assert.equal(retry.items.length, 2);
});

// ── 클라이언트 리더 ─────────────────────────────────────────────────────────

test('envelope의 완전성이 소비자까지 그대로 전달된다', () => {
  const s = resolveTransactionsReadState(true, {
    transactions: [ROW('가')], partial: true, failedMonths: ['202602'], monthsRequested: 12, monthsSucceeded: 11,
  });
  assert.equal(s.partial, true);
  assert.equal(s.apiError, null);
  assert.equal(s.incompleteMessage, TRADE_PARTIAL_MESSAGE);
  assert.deepEqual(s.failedMonths, ['202602']);
  assert.equal(s.monthsSucceeded, 11);
});

test('완전한 envelope은 경고 없이 그대로 통과한다', () => {
  const s = resolveTransactionsReadState(true, { transactions: [ROW('가')], partial: false, failedMonths: [], monthsRequested: 12, monthsSucceeded: 12 });
  assert.equal(s.partial, false);
  assert.equal(s.incompleteMessage, null);
  assert.equal(s.trades.length, 1);
});

test('검증된 0건 envelope은 "거래 없음"이지 실패가 아니다', () => {
  const s = resolveTransactionsReadState(true, { transactions: [], partial: false, failedMonths: [], monthsRequested: 12, monthsSucceeded: 12 });
  assert.equal(s.apiError, null);
  assert.equal(s.partial, false);
  assert.equal(s.trades.length, 0);
});

test('예전 bare array 응답도 계속 받아들인다(배포 중 버전 어긋남 대비)', () => {
  const s = resolveTransactionsReadState(true, [ROW('가'), ROW('나')]);
  assert.equal(s.trades.length, 2);
  assert.equal(s.partial, false);
  assert.equal(s.apiError, null);
});

test('{ error } 응답은 빈 목록이 아니라 실패로 읽힌다', () => {
  const s = resolveTransactionsReadState(false, { error: 'Failed to fetch data' });
  assert.equal(s.apiError, TRADE_API_UNAVAILABLE_MESSAGE);
  assert.equal(s.trades.length, 0);
  assert.equal(s.partial, false, '전체 실패는 partial이 아니라 실패다');
});

test('200인데 body가 예상 밖(문자열/null)이어도 0건으로 낙관하지 않는다', () => {
  for (const bad of [null, 'oops', 42, undefined]) {
    const s = resolveTransactionsReadState(true, bad);
    assert.equal(s.apiError, TRADE_API_UNAVAILABLE_MESSAGE, `${JSON.stringify(bad)}를 무거래로 접으면 안 된다`);
  }
});

// ── 구현 가드 ───────────────────────────────────────────────────────────────

test('라우트가 월별 판정을 실제로 수행하고 완전성을 응답에 싣는다', () => {
  const src = read('app/api/transactions/route.ts');
  assert.ok(src.includes('classifyMolitMonthResult'), '월별 성공/실패 판정이 없다');
  assert.ok(src.includes('foldMonthResults'), '에러 플레이스홀더가 거래 배열에서 제거되지 않는다');
  assert.ok(src.includes('summarizeTradeCompleteness'));
  assert.ok(
    /NextResponse\.json\(\s*\{\s*transactions:\s*data,\s*\.\.\.completeness\s*\}/.test(src),
    '완전성이 응답에 실리지 않는다'
  );
  assert.ok(
    !/const results = await Promise\.all\(promises\);\s*\n\s*data = results\.flat\(\);/.test(src),
    '월별 결과를 그대로 flat하면 실패 월이 결과에 섞인다'
  );
});

test('DB 경로는 부분 상태가 없다(단일 쿼리 — 성공 아니면 예외)', () => {
  const src = read('app/api/transactions/route.ts');
  assert.ok(
    /completeness = \{ partial: false, failedMonths: \[\], monthsRequested: 12, monthsSucceeded: 12 \}/.test(src),
    'DB 경로의 완전성이 명시되지 않았다'
  );
});

test('분위 지도는 불완전하면 분위 색을 쓰지 않는다', () => {
  const src = read('app/stats/[type]/type-client.tsx');
  assert.ok(src.includes('resolveTransactionsReadState'), '공유 리더를 쓰지 않는다');
  assert.ok(
    src.includes('incomplete ? \'#94a3b8\' : QUINTILE_COLORS[m.tier]'),
    '불완전한 원본에서도 분위 색을 그대로 칠하고 있다'
  );
  assert.ok(src.includes('평당가 분위(1~5분위)를 계산할 수 없습니다'), '이유를 설명하는 안내가 없다');
});

test('지도 마커 캐시는 partial 플래그를 함께 저장한다', () => {
  const src = read('app/map/page.tsx');
  assert.ok(
    /markers: AptMarker\[\]; partial: boolean; ts: number/.test(src),
    'partial을 빼고 markers만 캐시하면 캐시 히트에서 불완전이 완전으로 둔갑한다'
  );
  assert.ok(/markerCacheRef\.current\.set\(lawdCd, \{ markers, partial: txState\.partial/.test(src));
  assert.ok(/setAptPartial\(cached\.partial\)/.test(src), '캐시 히트에서 partial이 복원되지 않는다');
});

test('AI 조건검색은 빈 목록의 이유(실패/부분/진짜 없음)를 구분한다', () => {
  const src = read('app/api/ai-search/route.ts');
  assert.ok(src.includes('conditionResult.unavailable'), '조회 실패를 "조건에 맞는 단지 없음"으로 접고 있다');
  assert.ok(src.includes('conditionResult.partial'));
  assert.ok(src.includes('summaryWithTrust'), '부분 실패가 브리핑 입력에 전달되지 않는다');
});

test('사용자 문구에 내부 용어가 노출되지 않는다', () => {
  const mapSrc = read('app/map/page.tsx');
  const statsSrc = read('app/stats/[type]/type-client.tsx');
  for (const src of [mapSrc, statsSrc]) {
    for (const forbidden of ['MOLIT', '초당 서비스', 'serviceKey', 'DATA_GO_KR']) {
      assert.ok(!src.includes(`'${forbidden}`), `사용자 문구에 ${forbidden}가 들어가면 안 된다`);
    }
  }
});
