// CRON ACTIVATION §8 — scheduler 표시 판정 로직 테스트(파일/네트워크 없음).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeDailyUtcCronInKst, findCronForRoute } from './cron-schedule.ts';

// --- UTC -> KST 변환 -------------------------------------------------------

test('실제 등록된 SALE/RENT 표현식이 의도한 KST 시각으로 해석된다', () => {
  assert.equal(describeDailyUtcCronInKst('0 19 * * *'), '매일 04:00 KST'); // SALE
  assert.equal(describeDailyUtcCronInKst('0 21 * * *'), '매일 06:00 KST'); // RENT (spacing patch)
  assert.equal(describeDailyUtcCronInKst('0 20 * * *'), '매일 05:00 KST'); // 이전 RENT 값 — 변환 자체는 여전히 맞다
});

test('자정을 넘어가는 UTC 시각도 KST로 정확히 감싼다', () => {
  assert.equal(describeDailyUtcCronInKst('30 16 * * *'), '매일 01:30 KST');
  assert.equal(describeDailyUtcCronInKst('0 15 * * *'), '매일 00:00 KST');
  assert.equal(describeDailyUtcCronInKst('0 23 * * *'), '매일 08:00 KST');
});

test('매일 1회 형태가 아니면 억지로 해석하지 않고 null이다(틀린 시각 표시 금지)', () => {
  assert.equal(describeDailyUtcCronInKst('0 19 1 * *'), null); // 매월 1일
  assert.equal(describeDailyUtcCronInKst('0 19 * * 1'), null); // 매주 월요일
  assert.equal(describeDailyUtcCronInKst('*/5 * * * *'), null); // 5분마다
  assert.equal(describeDailyUtcCronInKst('0 19 * *'), null); // 필드 부족
  assert.equal(describeDailyUtcCronInKst('0 99 * * *'), null); // 범위 초과
});

// --- 등록 판정 -------------------------------------------------------------

const CRONS = [
  { path: '/api/cron/sale-sync?mode=apply', schedule: '0 19 * * *' },
  { path: '/api/cron/rent-sync?mode=apply', schedule: '0 21 * * *' },
];

test('쿼리스트링이 붙은 path도 route와 매칭된다', () => {
  const r = findCronForRoute(CRONS, '/api/cron/sale-sync');
  assert.equal(r.state, 'SCHEDULED');
  assert.equal(r.scheduleUtc, '0 19 * * *');
  assert.equal(r.scheduleKst, '매일 04:00 KST');
});

test('등록되지 않은 route는 OFF다', () => {
  assert.equal(findCronForRoute(CRONS, '/api/cron/other-sync').state, 'OFF');
});

test('crons 배열이 아예 없으면 OFF다(등록 전 상태)', () => {
  assert.equal(findCronForRoute(undefined, '/api/cron/sale-sync').state, 'OFF');
  assert.equal(findCronForRoute([], '/api/cron/sale-sync').state, 'OFF');
});

test('schedule 없는 항목은 등록으로 인정하지 않는다', () => {
  assert.equal(findCronForRoute([{ path: '/api/cron/sale-sync' }], '/api/cron/sale-sync').state, 'OFF');
});

test('SCHEDULED는 "등록됨"일 뿐 "무인 실행 성공"이 아니다 — 상태값이 둘을 섞지 않는다', () => {
  const r = findCronForRoute(CRONS, '/api/cron/rent-sync');
  assert.equal(r.state, 'SCHEDULED');
  assert.equal(r.scheduleKst, '매일 06:00 KST'); // Hobby 1시간 window에서도 SALE과 겹치지 않는 간격
  assert.ok(!('lastRunSucceeded' in r), 'cron 등록 판정이 실행 결과를 주장하면 안 된다');
});
