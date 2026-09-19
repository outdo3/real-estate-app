import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyMaster, monthRange, naturalKey, occurrenceGroup, orderSensitivity } from './audit-seoul-sale-backfill-plan';
import { fetchSaleCell, type PageFetcher } from './seed-seoul-apartment-master-logic';
import { mapMolitItems } from '../src/lib/api-molit';
import { normalizeMolitItemsToTradeRows } from './trade-history-logic';

// SEOUL_SALE_BACKFILL_PLAN_V1 — read-only 분석 로직(운영 정규화 경로 재사용)의 규칙 고정.

const raw = (o: Record<string, string> = {}) => ({
  aptSeq: '11680-218', aptNm: '은마', umdNm: '대치동', jibun: '316', sggCd: '11680', excluUseAr: '84.43', dealAmount: '250,000',
  dealYear: '2026', dealMonth: '8', dealDay: '3', floor: '5', buildYear: '1979', cdealType: ' ', cdealDay: ' ', rgstDate: ' ', ...o,
});
const norm = (items: any[], lawd = '11680', ym = '202608') => normalizeMolitItemsToTradeRows(mapMolitItems(items, 'apt', lawd, ym) as any, lawd, ym);

test('월 범위 — 양끝 포함, 연도 넘김', () => {
  assert.deepEqual(monthRange('200511', '200602'), ['200511', '200512', '200601', '200602']);
  assert.equal(monthRange('200601', '202609').length, 249);
});

test('master 분류 — aptSeq로만(이름·지번 추정 없음)', () => {
  const masters = new Set(['11680-218']);
  assert.equal(classifyMaster({ aptSeq: '11680-218', lawdCd: '11680' }, masters), 'EXACT_MASTER');
  assert.equal(classifyMaster({ aptSeq: '11680-573', lawdCd: '11680' }, masters), 'MASTER_MISSING');
  assert.equal(classifyMaster({ aptSeq: null, lawdCd: '11680' }, masters), 'INVALID_APTSEQ');
  assert.equal(classifyMaster({ aptSeq: '26350-2', lawdCd: '11680' }, masters), 'INVALID_APTSEQ');
  assert.equal(classifyMaster({ aptSeq: '11140-1012', lawdCd: '11200' }, masters), 'REVIEW_REQUIRED', '이웃 구 응답에 실린 행');
});

test('자연키 문자열 = DB 자연키(group_key|금액|계약일|층|occurrence) 형식', () => {
  const r = norm([raw()]).rows[0];
  assert.equal(naturalKey(r), `${r.groupKeyStr}|250000|2026-08-03|5|0`);
  assert.equal(occurrenceGroup(r), `${r.groupKeyStr}|250000|2026-08-03|5`);
});

test('같은 조건의 실제 복수 거래는 접지 않는다 — occurrenceIndex로 서로 다른 자연키', () => {
  const rows = norm([raw(), raw(), raw()]).rows;
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.occurrenceIndex), [0, 1, 2]);
  assert.equal(new Set(rows.map(naturalKey)).size, 3);
});

test('취소 — 그룹 건수·취소 수는 응답 순서와 무관, 취소가 붙는 슬롯은 순서에 따라 달라진다', () => {
  const items = [raw({ cdealType: 'O', cdealDay: '26.08.20' }), raw()];
  const os = orderSensitivity(items, '11680', '202608');
  assert.deepEqual(os, { groups: 1, countsDiffer: 0, slotDiffer: 1 });
  const a = norm(items).rows;
  assert.equal(a.filter((r) => r.dealCanceled).length, 1);
});

test('페이지 완전성 — 1000행 초과 셀은 모든 페이지, 수집 수 ≠ totalCount면 PARTIAL(보류)', async () => {
  const pages: PageFetcher = async (_l, _y, p) => ({ kind: 'OK', totalCount: 1500, items: Array.from({ length: p === 1 ? 1000 : 500 }, () => raw()) });
  const c = await fetchSaleCell(pages, '11350', '200611');
  assert.deepEqual([c.status, c.pages, c.collected], ['COMPLETE', 2, 1500]);
  const short: PageFetcher = async (_l, _y, p) => ({ kind: 'OK', totalCount: 1500, items: Array.from({ length: p === 1 ? 1000 : 400 }, () => raw()) });
  assert.equal((await fetchSaleCell(short, '11350', '200611')).status, 'PARTIAL');
  const err: PageFetcher = async () => ({ kind: 'TIMEOUT', detail: 'x' });
  assert.equal((await fetchSaleCell(err, '11350', '200611')).status, 'ERROR');
});
