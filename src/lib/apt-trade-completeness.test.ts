import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyMolitMonthResult,
  summarizeTradeCompleteness,
  foldMonthResults,
  resolveTradeApiError,
  type MonthCellResult,
} from './apt-trade-completeness';

// APT_DETAIL_MOLIT_PARTIAL_FAILURE_TRUST_FIX
// 핵심 규칙: 실패한 월(FAILED)은 절대 "그 달 거래 0건"(SUCCESS_EMPTY)과 같이 취급하지
// 않는다. 한 달이라도 실패하면 집계는 완전하지 않다(partial).

const cells = (spec: Array<[string, MonthCellResult['status']]>): MonthCellResult[] =>
  spec.map(([dealYmd, status]) => ({ dealYmd, status }));

test('classifyMolitMonthResult: 거래가 있는 정상 월은 SUCCESS_WITH_DATA', () => {
  assert.equal(
    classifyMolitMonthResult([{ name: '해운대경동제이드', typeLabel: '실거래' }]),
    'SUCCESS_WITH_DATA'
  );
});

test('classifyMolitMonthResult: 성공했지만 거래가 0건인 월은 SUCCESS_EMPTY (실패 아님)', () => {
  assert.equal(classifyMolitMonthResult([]), 'SUCCESS_EMPTY');
});

test('classifyMolitMonthResult: fetchMolitData의 에러 플레이스홀더는 FAILED', () => {
  const placeholder = [{ id: 'error-apt-26140-202608', name: 'API 에러: 초당 서비스 요청제한 횟수 초과 에러', typeLabel: '에러' }];
  assert.equal(classifyMolitMonthResult(placeholder), 'FAILED');
});

test('classifyMolitMonthResult: 배열이 아닌 값(예외/미상 응답)은 FAILED로 본다 — 0건으로 낙관하지 않는다', () => {
  assert.equal(classifyMolitMonthResult(null), 'FAILED');
  assert.equal(classifyMolitMonthResult(undefined), 'FAILED');
  assert.equal(classifyMolitMonthResult({} as unknown), 'FAILED');
});

test('A. 12개월 전부 성공 → 완전한 결과(partial=false, allFailed=false)', () => {
  const summary = summarizeTradeCompleteness(
    cells(Array.from({ length: 12 }, (_, i) => [`2026${String(i + 1).padStart(2, '0')}`, 'SUCCESS_WITH_DATA'] as [string, MonthCellResult['status']]))
  );
  assert.equal(summary.monthsRequested, 12);
  assert.equal(summary.monthsSucceeded, 12);
  assert.deepEqual(summary.failedMonths, []);
  assert.equal(summary.partial, false);
  assert.equal(summary.allFailed, false);
});

test('B. 12개월 중 1개월 실패 → 완전한 결과와 구분된다(partial=true)', () => {
  const spec = Array.from({ length: 12 }, (_, i) => [`2026${String(i + 1).padStart(2, '0')}`, 'SUCCESS_WITH_DATA'] as [string, MonthCellResult['status']]);
  spec[3][1] = 'FAILED';
  const summary = summarizeTradeCompleteness(cells(spec));
  assert.equal(summary.partial, true, '1개월만 실패해도 완전한 결과처럼 보이면 안 된다');
  assert.equal(summary.allFailed, false);
  assert.equal(summary.monthsSucceeded, 11);
  assert.deepEqual(summary.failedMonths, ['202604']);
});

test('C. 12개월 중 6개월 실패 → partial=true, 실패 월이 전부 보존된다', () => {
  const spec = Array.from({ length: 12 }, (_, i) => [`2026${String(i + 1).padStart(2, '0')}`, i % 2 === 0 ? 'FAILED' : 'SUCCESS_WITH_DATA'] as [string, MonthCellResult['status']]);
  const summary = summarizeTradeCompleteness(cells(spec));
  assert.equal(summary.partial, true);
  assert.equal(summary.allFailed, false);
  assert.equal(summary.monthsSucceeded, 6);
  assert.equal(summary.failedMonths.length, 6);
});

test('D. 12개월 전부 실패 → allFailed=true (apiError 조건), partial도 true', () => {
  const summary = summarizeTradeCompleteness(
    cells(Array.from({ length: 12 }, (_, i) => [`2026${String(i + 1).padStart(2, '0')}`, 'FAILED'] as [string, MonthCellResult['status']]))
  );
  assert.equal(summary.allFailed, true);
  assert.equal(summary.partial, true);
  assert.equal(summary.monthsSucceeded, 0);
});

test('E. 전부 성공했는데 거래가 0건인 경우는 완전한 결과다 — 실패로 분류하지 않는다', () => {
  const summary = summarizeTradeCompleteness(
    cells(Array.from({ length: 12 }, (_, i) => [`2026${String(i + 1).padStart(2, '0')}`, 'SUCCESS_EMPTY'] as [string, MonthCellResult['status']]))
  );
  assert.equal(summary.partial, false, '진짜 무거래는 API 실패처럼 보이면 안 된다');
  assert.equal(summary.allFailed, false);
  assert.equal(summary.monthsSucceeded, 12);
  assert.deepEqual(summary.failedMonths, []);
});

test('SUCCESS_EMPTY와 FAILED가 섞이면 성공 0건 월은 성공으로, 실패 월만 실패로 센다', () => {
  const summary = summarizeTradeCompleteness(
    cells([
      ['202601', 'SUCCESS_EMPTY'],
      ['202602', 'FAILED'],
      ['202603', 'SUCCESS_WITH_DATA'],
    ])
  );
  assert.equal(summary.monthsRequested, 3);
  assert.equal(summary.monthsSucceeded, 2);
  assert.deepEqual(summary.failedMonths, ['202602']);
  assert.equal(summary.partial, true);
  assert.equal(summary.allFailed, false);
});

test('요청 월이 0개면 partial/allFailed 모두 false (실패로 단정하지 않는다)', () => {
  const summary = summarizeTradeCompleteness([]);
  assert.equal(summary.partial, false);
  assert.equal(summary.allFailed, false);
  assert.equal(summary.monthsRequested, 0);
});

test('failedMonths는 요청 순서가 아니라 월 오름차순으로 정렬해 로그/응답이 안정적이다', () => {
  const summary = summarizeTradeCompleteness(
    cells([
      ['202612', 'FAILED'],
      ['202601', 'FAILED'],
      ['202606', 'SUCCESS_WITH_DATA'],
    ])
  );
  assert.deepEqual(summary.failedMonths, ['202601', '202612']);
});

// ── 라우트가 실제로 쓰는 접기(fold) 계약 ─────────────────────────────────────────
// 월별 조회 결과를 "거래 목록 + 완전성 판정 + 원본 실패 사유"로 접는다. 여기서 실패 월의
// 에러 플레이스홀더가 거래 목록에 새어 들어가면 안 되고, 실패 월이 0건으로 흡수돼서도 안 된다.

const okMonth = (dealYmd: string, count: number) => ({
  dealYmd,
  items: Array.from({ length: count }, (_, i) => ({ name: '해운대경동제이드', typeLabel: '실거래', id: `${dealYmd}-${i}` })),
  status: 'SUCCESS_WITH_DATA' as const,
});
const emptyMonth = (dealYmd: string) => ({ dealYmd, items: [], status: 'SUCCESS_EMPTY' as const });
const failedMonth = (dealYmd: string, reason = 'API 에러: 초당 서비스 요청제한 횟수 초과 에러') => ({
  dealYmd,
  items: [{ id: `error-${dealYmd}`, name: reason, typeLabel: '에러' }],
  status: 'FAILED' as const,
});

test('A. 12/12 성공 — 모든 거래가 모이고 apiError도 partial도 없다', () => {
  const months = Array.from({ length: 12 }, (_, i) => okMonth(`2026${String(i + 1).padStart(2, '0')}`, 2));
  const folded = foldMonthResults(months);
  const summary = summarizeTradeCompleteness(folded.cells);
  assert.equal(folded.items.length, 24);
  assert.equal(summary.partial, false);
  assert.equal(resolveTradeApiError(summary, folded.upstreamFailureMessage), null);
});

test('B. 11 성공 + 1 실패 — 거래는 성공분만, partial=true, apiError는 여전히 null', () => {
  const months = [
    ...Array.from({ length: 11 }, (_, i) => okMonth(`2026${String(i + 1).padStart(2, '0')}`, 2)),
    failedMonth('202612'),
  ];
  const folded = foldMonthResults(months);
  const summary = summarizeTradeCompleteness(folded.cells);
  assert.equal(folded.items.length, 22);
  assert.ok(!folded.items.some((item: any) => item.typeLabel === '에러'), '에러 플레이스홀더가 거래 목록에 들어가면 안 된다');
  assert.equal(summary.partial, true);
  assert.deepEqual(summary.failedMonths, ['202612']);
  assert.equal(resolveTradeApiError(summary, folded.upstreamFailureMessage), null, '일부 실패는 전체 실패로 승격하지 않는다');
});

test('C. 6 성공 + 6 실패 — 절반이 빠졌다는 사실이 응답 계약에 남는다', () => {
  const months = Array.from({ length: 12 }, (_, i) => {
    const ym = `2026${String(i + 1).padStart(2, '0')}`;
    return i % 2 === 0 ? failedMonth(ym) : okMonth(ym, 3);
  });
  const folded = foldMonthResults(months);
  const summary = summarizeTradeCompleteness(folded.cells);
  assert.equal(folded.items.length, 18);
  assert.equal(summary.partial, true);
  assert.equal(summary.monthsSucceeded, 6);
  assert.equal(summary.failedMonths.length, 6);
  assert.equal(resolveTradeApiError(summary, folded.upstreamFailureMessage), null);
});

test('D. 12/12 실패 — 거래 0건 + apiError(원본 사유에서 "API 에러: " 접두어 제거)', () => {
  const months = Array.from({ length: 12 }, (_, i) => failedMonth(`2026${String(i + 1).padStart(2, '0')}`));
  const folded = foldMonthResults(months);
  const summary = summarizeTradeCompleteness(folded.cells);
  assert.equal(folded.items.length, 0);
  assert.equal(summary.allFailed, true);
  assert.equal(resolveTradeApiError(summary, folded.upstreamFailureMessage), '초당 서비스 요청제한 횟수 초과 에러');
});

test('D-2. 전 월 실패인데 원본 사유를 못 읽었으면 일반 실패 문구를 쓴다(0건으로 두지 않는다)', () => {
  const months = [{ dealYmd: '202601', items: [], status: 'FAILED' as const }];
  const folded = foldMonthResults(months);
  const summary = summarizeTradeCompleteness(folded.cells);
  assert.equal(resolveTradeApiError(summary, folded.upstreamFailureMessage), '공공데이터 API 호출에 실패했습니다.');
});

test('E. 12/12 성공 + 전부 0건 — 진짜 무거래는 apiError도 partial도 아니다', () => {
  const months = Array.from({ length: 12 }, (_, i) => emptyMonth(`2026${String(i + 1).padStart(2, '0')}`));
  const folded = foldMonthResults(months);
  const summary = summarizeTradeCompleteness(folded.cells);
  assert.equal(folded.items.length, 0);
  assert.equal(summary.partial, false);
  assert.equal(summary.allFailed, false);
  assert.equal(resolveTradeApiError(summary, folded.upstreamFailureMessage), null);
});

test('원본 실패 사유는 처음 만난 것 하나만 보존한다(로그/응답이 장황해지지 않게)', () => {
  const folded = foldMonthResults([
    failedMonth('202601', 'API 에러: 초당 서비스 요청제한 횟수 초과 에러'),
    failedMonth('202602', 'API 에러: SERVICE_KEY_IS_NOT_REGISTERED_ERROR'),
  ]);
  assert.equal(folded.upstreamFailureMessage, '초당 서비스 요청제한 횟수 초과 에러');
});
