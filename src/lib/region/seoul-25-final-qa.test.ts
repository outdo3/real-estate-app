// SEOUL25_FINAL_QA_V1 — 최종 공개 전 QA에서 찾은 두 가지 회귀 방지.
//  1) 서울 신규 17구 전월세(DB 미적재)는 live MOLIT 없이 닫히고, 화면은 '조회 중'이 아니라 '준비 중'으로 끝난다.
//  2) 불가능한 사용승인일(미래 연도 — 은마 11680-218 총괄표제부 2034년)은 준공연도로 보이지 않는다.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveTradeReadState, TRADE_API_UNAVAILABLE_MESSAGE, TRADE_PREPARING_MESSAGE } from '../trade-read-state';
import { DB_ONLY_MOLIT_MESSAGE } from '../api-molit';
import { plausibleApprovalYearLabel } from '../apt-building-info';

const ROOT = resolve(__dirname, '..', '..', '..');

test('DB 전용 지역의 차단 문구는 화면의 준비 중 문구와 같은 값이다(서버·클라이언트 단일 출처)', () => {
  assert.equal(DB_ONLY_MOLIT_MESSAGE, TRADE_PREPARING_MESSAGE);
});

test('준비 중 응답은 실패·0건이 아니라 preparing으로 읽힌다', () => {
  const s = resolveTradeReadState(true, { trades: [], apiError: TRADE_PREPARING_MESSAGE, partial: true, monthsRequested: 12, monthsSucceeded: 0 });
  assert.equal(s.preparing, true);
  assert.equal(s.incompleteMessage, TRADE_PREPARING_MESSAGE);
  assert.equal(s.trades.length, 0);
  // 일반 실패는 기존 그대로(요청 실패 문구, preparing 아님)
  const f = resolveTradeReadState(true, { trades: [], apiError: '초당 서비스 요청제한 횟수 초과 에러' });
  assert.equal(f.preparing, undefined);
  assert.equal(f.incompleteMessage, TRADE_API_UNAVAILABLE_MESSAGE);
  // 정상 응답에는 preparing 필드 자체가 없다
  assert.equal('preparing' in resolveTradeReadState(true, { trades: [], apiError: null }), false);
});

test('상세 Hero는 준비 중이면 조회 중에 머물지 않는다', () => {
  const src = readFileSync(resolve(ROOT, 'src/app/(public)/apt/[name]/apt-client.tsx'), 'utf8');
  assert.match(src, /tradeIncompleteMessage === TRADE_PREPARING_MESSAGE \? '준비 중' : '조회 중\.\.\.'/);
});

test('사용승인일: 미래·1900년 이전·형식 불명은 표시하지 않는다', () => {
  const now = new Date('2026-09-30T03:00:00Z');
  assert.equal(plausibleApprovalYearLabel('2034년', now), null);
  assert.equal(plausibleApprovalYearLabel('2027년', now), null);
  assert.equal(plausibleApprovalYearLabel('1979년', now), '1979년');
  assert.equal(plausibleApprovalYearLabel('2026년', now), '2026년');
  assert.equal(plausibleApprovalYearLabel('1850년', now), null);
  assert.equal(plausibleApprovalYearLabel('정보 없음', now), null);
  assert.equal(plausibleApprovalYearLabel(null, now), null);
  // KST 기준: 12/31 16:00Z = 1/1 01:00 KST → 새해 연도 허용
  assert.equal(plausibleApprovalYearLabel('2027년', new Date('2026-12-31T16:00:00Z')), '2027년');
});

test('info 라우트는 모든 출처의 사용승인일에 같은 검사를 쓴다', () => {
  const src = readFileSync(resolve(ROOT, 'src/app/api/apt/[name]/info/route.ts'), 'utf8');
  assert.match(src, /plausibleApprovalYearLabel\(registry\?\.approvalDate\) \?\? plausibleApprovalYearLabel\(naverApprovalYear\)/);
  assert.ok(!/info\['사용승인일'\] = registry\.approvalDate/.test(src));
});

test('실거래 타임라인 요약도 준비 중이면 "총 0건"(검증된 0으로 읽힘)을 쓰지 않는다', () => {
  const src = readFileSync(resolve(ROOT, 'src/app/(public)/apt/[name]/apt-client.tsx'), 'utf8');
  assert.match(src, /filteredTrades\.length === 0 && tradeIncompleteMessage === TRADE_PREPARING_MESSAGE \? '준비 중' : `총 \$\{filteredTrades\.length\}건`/);
});
