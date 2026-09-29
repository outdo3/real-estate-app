import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  evaluateMatch,
  haversineKm,
  MATCH_ENGINE_VERSION,
  MIN_COMPARABLE_WEIGHT,
  rankMatches,
  SOFT_WEIGHTS,
  summarizeMatch,
  type MatchListingInput,
  type MatchPreferenceInput,
} from './matching';

// REALTOR_PRO_MVP_V1 — 결정적·설명 가능한 매칭 엔진(합성 입력).

const NOW = new Date('2026-09-30T03:00:00Z');
const d = (s: string) => new Date(`${s}T00:00:00Z`);

const L = (over: Partial<MatchListingInput> = {}): MatchListingInput => ({
  id: 'L1', dealType: 'SALE', askingPriceManwon: 89000, depositManwon: null, monthlyRentManwon: null, lawdCd: '26350', aptSeq: '26350-1',
  exclusiveAreaM2: 84.97, moveInAvailableAt: d('2026-11-01'), moveInNegotiable: false, floor: 15, floorBand: null, parkingAvailable: true, petAllowed: null,
  isActive: true, closedAt: null, deletedAt: null, buildYear: 2020, lat: 35.169, lng: 129.13, ...over,
});
const P = (over: Partial<MatchPreferenceInput> = {}): MatchPreferenceInput => ({
  id: 'P1', dealTypes: ['SALE'], budgetMinManwon: 80000, budgetMaxManwon: 95000, budgetTolerancePct: 0, monthlyRentMaxManwon: null, lawdCds: [], aptSeqs: [],
  areaMinM2: 80, areaMaxM2: 90, moveInTargetAt: d('2026-10-28'), commuteLabel: '센텀시티역', commuteLat: 35.1692, commuteLng: 129.1318, schoolIds: [],
  preferNewBuild: null, parkingRequired: null, floorPreference: null, petRequired: null, mustHaveKeys: [], ...over,
});

test('가중치 합은 100', () => {
  assert.equal(Object.values(SOFT_WEIGHTS).reduce((a, b) => a + b, 0), 100);
});

test('전부 맞으면 100% · 사유별 설명', () => {
  const r = evaluateMatch(L(), P(), NOW);
  assert.equal(r.passedHard, true);
  assert.equal(r.confidence, 'SUFFICIENT');
  assert.equal(r.score, 100);
  const keys = r.reasons.map((x) => x.key);
  assert.deepEqual(keys, ['budget', 'area', 'moveIn', 'commute']);
  assert.ok(r.reasons.every((x) => x.verdict === 'MATCH' && x.detail.length > 0));
  assert.match(r.reasons.find((x) => x.key === 'commute')!.detail, /직선거리 기준/);
  assert.equal(summarizeMatch('박OO 고객', r), '박OO 고객과 100% 일치');
});

test('입주 2주 늦음 → PARTIAL, 점수는 가중 평균', () => {
  const r = evaluateMatch(L({ moveInAvailableAt: d('2026-11-11') }), P(), NOW);
  const mv = r.reasons.find((x) => x.key === 'moveIn')!;
  assert.equal(mv.verdict, 'PARTIAL');
  assert.match(mv.detail, /2주 늦음/);
  // 14일 늦음: 1 - (14-7)/23 = 0.6957 → 0.7
  const expected = Math.round((100 * (25 + 20 + 15 * 0.7 + 10)) / 70);
  assert.equal(r.score, expected);
});

test('hard filter — 거래유형·예산 상한·월세 상한·지역·비활성은 제외(점수 없음)', () => {
  const cases: [Partial<MatchListingInput>, Partial<MatchPreferenceInput>, string][] = [
    [{ dealType: 'JEONSE', depositManwon: 40000 }, {}, 'dealType'],
    [{ askingPriceManwon: 99000 }, {}, 'budgetMax'],
    [{ dealType: 'MONTHLY', depositManwon: 5000, monthlyRentManwon: 150 }, { dealTypes: ['MONTHLY'], budgetMinManwon: null, budgetMaxManwon: 10000, monthlyRentMaxManwon: 100 }, 'monthlyRentMax'],
    [{ lawdCd: '26350', aptSeq: '26350-1' }, { lawdCds: ['11680'] }, 'region'],
    [{ isActive: false }, {}, 'active'],
    [{ closedAt: NOW }, {}, 'active'],
  ];
  for (const [l, p, key] of cases) {
    const r = evaluateMatch(L(l), P(p), NOW);
    assert.equal(r.passedHard, false, key);
    assert.equal(r.score, null, key);
    assert.ok(r.exclusions.some((e) => e.key === key && e.hard), key);
    assert.match(summarizeMatch('박OO 고객', r), /조건 밖/);
  }
});

test('예산 허용 범위(tolerance) 안이면 통과하되 PARTIAL로 감점', () => {
  const r = evaluateMatch(L({ askingPriceManwon: 97000 }), P({ budgetTolerancePct: 5 }), NOW);
  assert.equal(r.passedHard, true);
  const b = r.reasons.find((x) => x.key === 'budget')!;
  assert.equal(b.verdict, 'PARTIAL');
  assert.ok(b.score! >= 0.5 && b.score! < 1);
});

test('지역 미연결 매물(aptSeq·lawdCd 없음)은 희망 지역이 있으면 제외 — 이름으로 추측하지 않는다', () => {
  const r = evaluateMatch(L({ aptSeq: null, lawdCd: null }), P({ lawdCds: ['26350'] }), NOW);
  assert.equal(r.passedHard, false);
  assert.match(r.exclusions[0].detail, /확인할 수 없습니다/);
  // 희망 단지(aptSeq) 일치면 lawdCd가 달라도 통과
  assert.equal(evaluateMatch(L({ lawdCd: '26350', aptSeq: '26350-1' }), P({ aptSeqs: ['26350-1'], lawdCds: ['11680'] }), NOW).passedHard, true);
});

test('값이 없는 항목은 UNKNOWN("확인 필요")이고 분모에서 빠진다 — 유리/불리 가정 없음', () => {
  const full = evaluateMatch(L(), P({ parkingRequired: true }), NOW);
  const noParkingInfo = evaluateMatch(L({ parkingAvailable: null }), P({ parkingRequired: true }), NOW);
  const pk = noParkingInfo.reasons.find((x) => x.key === 'parking')!;
  assert.equal(pk.verdict, 'UNKNOWN');
  assert.equal(pk.score, null);
  assert.match(pk.detail, /확인 필요/);
  assert.equal(noParkingInfo.comparableWeight, full.comparableWeight - SOFT_WEIGHTS.parking);
  assert.equal(noParkingInfo.score, 100); // 나머지가 전부 일치 — 모르는 항목 때문에 깎이지 않음
});

test('비교 가능 가중치 < 50 이면 % 없음(정보 부족)', () => {
  const r = evaluateMatch(
    L({ exclusiveAreaM2: null, moveInAvailableAt: null, lat: null, lng: null }),
    P({ areaMinM2: 80, areaMaxM2: 90 }),
    NOW
  );
  assert.ok(r.comparableWeight < MIN_COMPARABLE_WEIGHT);
  assert.equal(r.passedHard, true);
  assert.equal(r.score, null);
  assert.equal(r.confidence, 'INSUFFICIENT');
  assert.match(summarizeMatch('박OO 고객', r), /정보 부족/);
});

test('학교 조건은 V1에서 데이터 미연결 → 확인 필요(가짜 판정 없음)', () => {
  const r = evaluateMatch(L(), P({ schoolIds: [123] }), NOW);
  const s = r.reasons.find((x) => x.key === 'school')!;
  assert.equal(s.verdict, 'UNKNOWN');
  assert.equal(s.score, null);
});

test('필수(mustHave) 항목은 값이 없거나 틀리면 hard 제외', () => {
  assert.equal(evaluateMatch(L({ parkingAvailable: null }), P({ parkingRequired: true, mustHaveKeys: ['parking'] }), NOW).passedHard, false);
  assert.equal(evaluateMatch(L({ parkingAvailable: false }), P({ parkingRequired: true, mustHaveKeys: ['parking'] }), NOW).passedHard, false);
  assert.equal(evaluateMatch(L({ parkingAvailable: true }), P({ parkingRequired: true, mustHaveKeys: ['parking'] }), NOW).passedHard, true);
  assert.equal(evaluateMatch(L({ exclusiveAreaM2: 59.9 }), P({ mustHaveKeys: ['area'] }), NOW).passedHard, false);
  assert.equal(evaluateMatch(L({ moveInAvailableAt: d('2027-03-01') }), P({ mustHaveKeys: ['moveIn'] }), NOW).passedHard, false);
});

test('면적 ±10% 이내는 PARTIAL, 그 밖 MISS — ㎡ 그대로(평형 환산 없음)', () => {
  const near = evaluateMatch(L({ exclusiveAreaM2: 95 }), P(), NOW).reasons.find((x) => x.key === 'area')!;
  const far = evaluateMatch(L({ exclusiveAreaM2: 120 }), P(), NOW).reasons.find((x) => x.key === 'area')!;
  assert.equal(near.verdict, 'PARTIAL');
  assert.equal(far.verdict, 'MISS');
  assert.match(near.detail, /㎡/);
  assert.ok(!/평/.test(near.detail));
});

test('결정적: 같은 입력 → 같은 결과·같은 입력 해시, 입력이 바뀌면 해시가 바뀐다', () => {
  const a = evaluateMatch(L(), P(), NOW);
  const b = evaluateMatch(L(), P(), NOW);
  assert.deepEqual(a, b);
  assert.equal(a.engineVersion, MATCH_ENGINE_VERSION);
  assert.notEqual(evaluateMatch(L({ askingPriceManwon: 90000 }), P(), NOW).inputHash, a.inputHash);
});

test('정렬: 통과·점수 높은 순 → 정보 부족 → 제외', () => {
  const ok90 = evaluateMatch(L({ id: 'A', moveInAvailableAt: d('2026-11-15') }), P(), NOW);
  const ok100 = evaluateMatch(L({ id: 'B' }), P(), NOW);
  const insufficient = evaluateMatch(L({ id: 'C', exclusiveAreaM2: null, moveInAvailableAt: null, lat: null }), P(), NOW);
  const excluded = evaluateMatch(L({ id: 'D', dealType: 'JEONSE', depositManwon: 1 }), P(), NOW);
  assert.deepEqual(rankMatches([excluded, insufficient, ok90, ok100]).map((r) => r.listingId), ['B', 'A', 'C', 'D']);
});

test('거리 계산 · 통근 구간', () => {
  assert.ok(Math.abs(haversineKm(35.1692, 129.1318, 35.1692, 129.1318)) < 1e-9);
  const r = evaluateMatch(L({ lat: 35.3, lng: 129.3 }), P(), NOW);
  const c = r.reasons.find((x) => x.key === 'commute')!;
  assert.equal(c.verdict, 'PARTIAL');
  assert.equal(c.score, 0.2);
});

test('E-JIP Score·개인화 점수와 분리 — 엔진은 그 모듈을 import하지 않는다', () => {
  const src = readFileSync(resolve(__dirname, 'matching.ts'), 'utf8');
  assert.ok(!/apartment-score|personalized-score|ejip-score|score-v2/i.test(src.replace(/^\s*\/\/.*$/gm, '')));
  assert.ok(!/prisma|fetch\(|openai|gemini/i.test(src.replace(/^\s*\/\/.*$/gm, '')));
});
