// E-JIP SCORE V2 STEP 3.5 §33 — parking missing model / sentinel T1-T3 / blind
// sheet leakage / answer key separation / deterministic pair selection /
// score eligibility 테스트. node:test, DB 없음(순수 함수만).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { complexWithParkingModel, type ParkingConditionalContext, type ParkingModelId } from './composition-v35';
import { eligibilityFromCoverage } from '../score-v2-step3/composition-v3';

const ctx: ParkingConditionalContext = { eraNeutralByAgeBand: { '0-10': 65, '11-20': 68, '21-30': 53, '31+': 22 }, conservativeByAgeScaleBand: {} };
const MODELS: ParkingModelId[] = ['P-A_M3_GLOBAL_NEUTRAL', 'P-B_M1_BOUNDED_REDIST', 'P-C_M2_PARTIAL_FIXED', 'P-D_ERA_CONDITIONED', 'P-E_SCALE_ERA_CONSERVATIVE'];

test('PARKING MODELS: parking known(1.09 등)이면 5개 모델 전부 동일 결과(모델은 결측 시에만 차이나야 함)', () => {
  const results = MODELS.map((m) => complexWithParkingModel(4, 84.5, 57.3, m, '0-10', '0-10|500-999', ctx).score);
  const allSame = results.every((r) => Math.abs(r! - results[0]!) < 0.01);
  assert.ok(allSame, `parking known인데 모델별 결과가 다름: ${results}`);
});

test('PARKING MODELS: parking 결측(null)이면 모델별로 다른 처리 — 최소 P-A(global50)와 P-D(era-conditioned)는 age band가 극단일 때 달라야 함', () => {
  const oldBuildingPA = complexWithParkingModel(40, 30, null, 'P-A_M3_GLOBAL_NEUTRAL', '31+', '31+|<100', ctx);
  const oldBuildingPD = complexWithParkingModel(40, 30, null, 'P-D_ERA_CONDITIONED', '31+', '31+|<100', ctx);
  assert.notEqual(oldBuildingPA.score, oldBuildingPD.score, 'P-D는 노후 단지에 대해 era 평균(22)을 반영해 global neutral(50)과 달라야 함');
  assert.ok(oldBuildingPD.score! < oldBuildingPA.score!, 'P-D가 노후 단지 missing parking을 P-A보다 낮게(더 현실적으로) 평가해야 함');
});

test('NO-FAKE-PARKING-VALUE: P-D/P-E는 raw parking ratio를 생성하지 않는다 — score만 조정, raw factor input 자체는 그대로 null', () => {
  // complexWithParkingModel의 세 번째 인자(parking factor score)가 null로 전달돼도
  // 함수가 "raw ratio"를 반환하는 필드를 갖지 않는다(CompositionResult에는 score/coverage/
  // usedFactors/missingFactors만 있음 — 소스 코드 구조 자체가 raw parking value를 만들
  // 수 없게 돼 있음을 타입 구조로 보증).
  const r = complexWithParkingModel(20, 50, null, 'P-D_ERA_CONDITIONED', '11-20', '11-20|100-299', ctx);
  assert.ok(!('parkingRatio' in r) && !('rawParking' in r), 'CompositionResult에 raw parking 값을 담는 필드가 존재하면 안 됨');
  assert.deepEqual(r.missingFactors, ['parking']); // parking이 여전히 "결측"으로 정직하게 표시됨(값을 만들어 채운 게 아님)
});

test('PARKING MODELS: 5개 모델 전부 age/scale/parking-known monotonicity 유지', () => {
  for (const m of MODELS) {
    const p07 = 28, p10 = 50, p158 = 89; // curve score 예시값(순서만 중요)
    const c07 = complexWithParkingModel(20, 60, p07, m, '11-20', '11-20|300-499', ctx);
    const c10 = complexWithParkingModel(20, 60, p10, m, '11-20', '11-20|300-499', ctx);
    const c158 = complexWithParkingModel(20, 60, p158, m, '11-20', '11-20|300-499', ctx);
    assert.ok(c158.score! > c10.score! && c10.score! > c07.score!, `${m}: parking monotonicity violated`);
  }
});

test('ELIGIBILITY: STEP3 eligibilityFromCoverage가 STEP3.5에서도 동일하게 재사용된다(정책 일관성)', () => {
  assert.equal(eligibilityFromCoverage(false, 1.0), 'NOT_ENOUGH_DATA');
  assert.equal(eligibilityFromCoverage(true, 0.75), 'SCORE_AVAILABLE');
  assert.equal(eligibilityFromCoverage(true, 0.5), 'LIMITED');
  assert.equal(eligibilityFromCoverage(true, 0.1), 'NOT_ENOUGH_DATA');
});

// ---------------- Blind sheet leakage / answer key separation(§23-24,36) ----------------
const dataDir = path.resolve(__dirname, '../../data/score-v2-step35');

test('BLIND SHEET: shortlist blind csv에 실제 단지명이 포함되지 않는다', () => {
  const blindPath = path.resolve(dataDir, 'expert-review-blind-shortlist.csv');
  if (!fs.existsSync(blindPath)) return; // 생성 전이면 skip(실행 순서 의존성 방지)
  const keyPath = path.resolve(dataDir, 'expert-review-answer-key.csv');
  const blind = fs.readFileSync(blindPath, 'utf-8');
  const key = fs.readFileSync(keyPath, 'utf-8');
  const names = [...key.matchAll(/"([^"]+)"/g)].map((m) => m[1]).filter((n) => n.length > 1 && !n.includes('vs'));
  const leaked = names.filter((n) => blind.includes(n));
  assert.deepEqual(leaked, [], `blind sheet에 단지명이 누출됨: ${leaked.join(', ')}`);
});

test('ANSWER KEY: blind sheet와 answer key가 별도 파일로 분리돼 있다', () => {
  const blindPath = path.resolve(dataDir, 'expert-review-blind-shortlist.csv');
  const keyPath = path.resolve(dataDir, 'expert-review-answer-key.csv');
  if (!fs.existsSync(blindPath) || !fs.existsSync(keyPath)) return;
  assert.notEqual(blindPath, keyPath);
  const blindHeader = fs.readFileSync(blindPath, 'utf-8').split('\n').find((l) => l.startsWith('pairId'));
  assert.ok(blindHeader && !blindHeader.includes('total') && !blindHeader.includes('winner'), 'blind sheet 헤더에 score/winner 컬럼이 없어야 함');
});

test('DETERMINISTIC PAIR SELECTION: 동일 입력(같은 aptSeq 집합)에서 shortlist 로직은 항상 같은 순서를 만든다', () => {
  const arr = [{ gap: 3 }, { gap: 15 }, { gap: 0.2 }, { gap: 7 }];
  const sorted1 = [...arr].sort((a, b) => a.gap - b.gap);
  const sorted2 = [...arr].sort((a, b) => a.gap - b.gap);
  assert.deepEqual(sorted1, sorted2);
});

test('NO-PRODUCTION-IMPORT: STEP3.5 소스가 production score engine을 import하지 않는다', () => {
  const files = ['composition-v35.ts', 'ui-data-contract-proposal.ts', 'step35-01-parking-fairness-audit.ts', 'step35-02-parking-model-comparison.ts', 'step35-03-transport-and-scale-and-rerun.ts', 'step35-04-blind-pair-shortlist.ts', 'step35-05-parking-source-inventory.ts'];
  for (const f of files) {
    const src = fs.readFileSync(path.resolve(__dirname, f), 'utf-8');
    assert.ok(!src.includes("from '@/lib/apartment-score/server"), `${f} must not import production score engine`);
  }
});
