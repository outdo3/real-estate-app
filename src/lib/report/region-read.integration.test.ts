// REPORT-1 §14 — Production 읽기 전용 통합 확인.
// 실행: npx tsx --test src/lib/report/region-read.integration.test.ts
//
// **SELECT만 한다.** 쓰기/스키마 변경 없음. DB에 접근할 수 없으면 스킵한다
// (CI/오프라인에서 실패로 잡히지 않게).
import assert from 'node:assert/strict';
import test from 'node:test';
import 'dotenv/config';
import { prisma } from '@/lib/prisma';
import { readRegionReport } from './region-read';
import { BUSAN_CURRENT_LAWD_CODES } from './region-scope';

const START = '2026-08-01';
const END = '2026-08-31';
const hasDb = !!process.env.DATABASE_URL;

test('부산 전체 — 원시 쿼리와 건수가 일치하고 스코프 밖이 섞이지 않는다', { skip: !hasDb }, async () => {
  const env = await readRegionReport({ level: 'CITY', start: START, end: END });
  const count = env.metrics.find((m) => m.key === 'transactionCount')!.value as number;

  // 독립적으로 다시 센다(리포트 코드 경로를 쓰지 않는다).
  const raw = await prisma.apartmentTradeHistory.count({
    where: { lawdCd: { in: [...BUSAN_CURRENT_LAWD_CODES] }, dealCanceled: false,
             dealDate: { gte: new Date(`${START}T00:00:00.000Z`), lte: new Date(`${END}T00:00:00.000Z`) } },
  });
  assert.equal(count, raw, '리포트 건수 == 원시 건수');

  // 스코프 밖 코드가 결과 어디에도 없어야 한다.
  assert.equal(env.trust.scopeLawdCds.length, 16);
  assert.ok(!env.trust.scopeLawdCds.includes('27110'));
  assert.ok(!env.trust.scopeLawdCds.includes('11680'));
  const distRows = env.sections.find((s) => s.key === 'districtDistribution')!.rows;
  for (const r of distRows) {
    assert.ok(BUSAN_CURRENT_LAWD_CODES.includes(String(r.cells.lawdCd)), `스코프 밖 코드 혼입: ${r.cells.lawdCd}`);
  }
  console.log(`   [부산 전체] 거래 ${count}건 / 구 ${distRows.length}개 / completeness=${env.trust.completeness} / dataAsOf=${env.dataAsOf}`);
});

test('부산 전체 — 취소 거래가 한 건도 포함되지 않는다', { skip: !hasDb }, async () => {
  const canceled = await prisma.apartmentTradeHistory.count({
    where: { lawdCd: { in: [...BUSAN_CURRENT_LAWD_CODES] }, dealCanceled: true,
             dealDate: { gte: new Date(`${START}T00:00:00.000Z`), lte: new Date(`${END}T00:00:00.000Z`) } },
  });
  const env = await readRegionReport({ level: 'CITY', start: START, end: END });
  const withCanceled = await prisma.apartmentTradeHistory.count({
    where: { lawdCd: { in: [...BUSAN_CURRENT_LAWD_CODES] },
             dealDate: { gte: new Date(`${START}T00:00:00.000Z`), lte: new Date(`${END}T00:00:00.000Z`) } },
  });
  const count = env.metrics.find((m) => m.key === 'transactionCount')!.value as number;
  assert.equal(count, withCanceled - canceled, '취소건만큼 정확히 빠져 있어야 한다');
  console.log(`   [취소 검증] 전체 ${withCanceled} - 취소 ${canceled} = ${count}`);
});

test('해운대구 — 건수 일치 + LEFT JOIN 패리티(보강이 행을 지우지 않음)', { skip: !hasDb }, async () => {
  const env = await readRegionReport({ level: 'DISTRICT', lawdCd: '26350', start: START, end: END });
  const raw = await prisma.apartmentTradeHistory.count({
    where: { lawdCd: '26350', dealCanceled: false,
             dealDate: { gte: new Date(`${START}T00:00:00.000Z`), lte: new Date(`${END}T00:00:00.000Z`) } },
  });
  const count = env.metrics.find((m) => m.key === 'transactionCount')!.value as number;
  assert.equal(count, raw);
  assert.deepEqual(env.trust.scopeLawdCds, ['26350']);

  // 최근 실거래 섹션은 master 유무와 무관하게 행이 유지돼야 한다.
  const recent = env.sections.find((s) => s.key === 'recentTrades')!;
  assert.equal(recent.rows.length, Math.min(8, count), 'LEFT JOIN 패리티: 보강 여부와 무관하게 행 수 유지');
  const unenriched = recent.rows.filter((r) => !r.enriched).length;
  console.log(`   [해운대구] 거래 ${count}건 / 최근 ${recent.rows.length}행(미보강 ${unenriched}) / completeness=${env.trust.completeness}`);
});

test('우동 — 동 스코프 + 표본 게이트가 실제 값으로 동작', { skip: !hasDb }, async () => {
  const env = await readRegionReport({ level: 'DONG', lawdCd: '26350', dong: '우동', start: START, end: END });
  const raw = await prisma.apartmentTradeHistory.count({
    where: { lawdCd: '26350', dong: '우동', dealCanceled: false,
             dealDate: { gte: new Date(`${START}T00:00:00.000Z`), lte: new Date(`${END}T00:00:00.000Z`) } },
  });
  const count = env.metrics.find((m) => m.key === 'transactionCount')!.value as number;
  assert.equal(count, raw);
  assert.equal(env.scope.level, 'DONG');
  assert.equal(env.scope.dong, '우동');

  // 모든 행이 우동인지.
  for (const r of env.sections.find((s) => s.key === 'recentTrades')!.rows) {
    assert.equal(r.cells.dong, '우동');
  }
  const med = env.metrics.find((m) => m.key === 'medianDealAmount')!;
  console.log(`   [우동] 거래 ${count}건 / 중앙가 ${med.displayValue} (trust=${med.trust}) / 해석=${env.interpretation.source}`);
});

test('스코프 밖 코드는 조용히 걸러지지 않고 거부된다', { skip: !hasDb }, async () => {
  await assert.rejects(
    () => readRegionReport({ level: 'DISTRICT', lawdCd: '27110', start: START, end: END }),
    /REPORT_SCOPE_INVALID/,
  );
  await assert.rejects(
    () => readRegionReport({ level: 'DISTRICT', lawdCd: '11680', start: START, end: END }),
    /REPORT_SCOPE_INVALID/,
  );
});

test.after(async () => { await prisma.$disconnect(); });
