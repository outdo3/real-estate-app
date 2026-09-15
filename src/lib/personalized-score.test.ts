import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import { calculateScoreV2 } from './score-v2/engine';
import type { ScoreV2Input } from './score-v2/types';
import { PARKING_ERA_NEUTRAL } from './score-v2/types';
import type { FitImportance } from './fit-importance';
import {
  PERSONAL_FIT_GOOD_MIN_SCORE,
  PERSONAL_FIT_LIMITED_BELOW_COVERAGE,
  PERSONAL_FIT_PHRASES,
  PERSONAL_FIT_WEAK_MAX_SCORE,
  calculatePersonalFit,
  extractPersonalAxisScores,
  isCommonScoreAvailable,
  type PersonalFitResult,
} from './personalized-score';

/**
 * PERSONALIZED_SCORE_V1 P2-B — 개인화 점수 계산 엔진 계약.
 * 합성 V2 결과(엔진 출력 모양)와 **실제 V2 엔진 출력**을 모두 사용한다.
 */

const ROOT = resolve(__dirname, '../..');
const IMP_ALL3: FitImportance = { transport: 3, living: 3, newness: 3, parking: 3, elementarySchoolAccess: 3 };

/** 엔진 출력 모양의 합성 결과. parking: number = 실측, 'NEUTRAL' = 공통 점수가 중립값을 쓴 결측. */
function shadow(axes: { transport?: number | null; living?: number | null; newness?: number | null; parking?: number | 'NEUTRAL' | null; school?: number | null }, overall: number | null = 60, eligibility = 'SCORE_AVAILABLE') {
  const parkingKnown = typeof axes.parking === 'number';
  return {
    scoreVersion: 'EJIP_SCORE_V2_1',
    overallScore: overall,
    eligibility,
    domains: {
      transport: { score: axes.transport ?? null, coverage: 1, usedFactors: [], missingFactors: [], evidence: {} },
      living: { score: axes.living ?? null, coverage: 1, usedFactors: [], missingFactors: [], evidence: {} },
      education: { score: axes.school ?? null, coverage: 1, usedFactors: [], missingFactors: [], evidence: {} },
      complex: {
        score: 50,
        coverage: 1,
        usedFactors: [],
        missingFactors: parkingKnown ? [] : ['parking'],
        evidence: {
          ageScore: axes.newness ?? null,
          parkingRawStatus: parkingKnown ? 'KNOWN' : 'MISSING',
          parkingScore: parkingKnown ? (axes.parking as number) : null,
          parkingModelTreatment: parkingKnown ? 'KNOWN_VALUE' : 'P-D_ERA_CONDITIONED',
          parkingEraNeutralUsed: parkingKnown ? null : 53,
        },
      },
    },
  };
}
const full = (o: Partial<Record<'transport' | 'living' | 'newness' | 'parking' | 'school', number>> = {}) =>
  shadow({ transport: 80, living: 70, newness: 60, parking: 50, school: 90, ...o });

function ok(r: PersonalFitResult) {
  assert.notEqual(r.status, 'UNAVAILABLE', JSON.stringify(r));
  return r as Exclude<PersonalFitResult, { status: 'UNAVAILABLE' }>;
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    Object.values(o as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
}

/** 실제 V2 엔진 입력(부산 단지 모양의 합성 raw fact). */
function v2Input(over: Partial<ScoreV2Input> = {}): ScoreV2Input {
  return {
    aptSeq: '26000-1',
    buildYear: 1998,
    totalHouseholds: 800,
    parkingRatio: 1.1,
    parkingRawStatus: 'KNOWN',
    subwayStatus: 'VALUE',
    nearestSubwayDistanceM: 420,
    nearestBusStopDistanceM: 90,
    busStopCount300m: 6,
    nearestElementaryDistanceM: 380,
    attendanceZoneStatus: 'AVAILABLE',
    living: { martCount1000m: 2, convenienceCount500m: 10, pharmacyCount500m: 4, hospitalCount1000m: 20, parkCount1000m: 3, daycareKindergartenCount500m: 5 },
    identityEligible: true,
    ...over,
  };
}

// ── 1~4 ──────────────────────────────────────────────────────────────────────

test('1. 같은 입력 → 항상 같은 결과(시간·난수 무관)', () => {
  const a = calculatePersonalFit({ shadowV2: full(), fitImportance: IMP_ALL3 });
  const b = calculatePersonalFit({ shadowV2: full(), fitImportance: IMP_ALL3 });
  assert.deepEqual(a, b);
  const src = readFileSync(join(ROOT, 'src/lib/personalized-score.ts'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/Date\.now|new Date|Math\.random|process\.env|fetch\(|prisma|from 'react'/.test(src));
});

test('2. 같은 단지·다른 중요도 → 다른 점수', () => {
  const transit = ok(calculatePersonalFit({ shadowV2: full(), fitImportance: { transport: 5, living: 1, newness: 1, parking: 1, elementarySchoolAccess: 1 } }));
  const parking = ok(calculatePersonalFit({ shadowV2: full(), fitImportance: { transport: 1, living: 1, newness: 1, parking: 5, elementarySchoolAccess: 1 } }));
  assert.notEqual(transit.score, parking.score);
  assert.equal(transit.rawScore, (80 * 5 + 70 + 60 + 50 + 90) / 9);
  assert.equal(parking.rawScore, (80 + 70 + 60 + 50 * 5 + 90) / 9);
});

test('3. 중요도 없음·무효 → 계산 안 함', () => {
  assert.deepEqual(calculatePersonalFit({ shadowV2: full(), fitImportance: null }), { status: 'UNAVAILABLE', reason: 'NO_PREFERENCE' });
  assert.deepEqual(calculatePersonalFit({ shadowV2: full(), fitImportance: undefined }), { status: 'UNAVAILABLE', reason: 'NO_PREFERENCE' });
  assert.deepEqual(calculatePersonalFit({ shadowV2: full(), fitImportance: {} }), { status: 'UNAVAILABLE', reason: 'NO_PREFERENCE' });
  assert.deepEqual(calculatePersonalFit({ shadowV2: full(), fitImportance: { ...IMP_ALL3, living: 0 } }), { status: 'UNAVAILABLE', reason: 'NO_PREFERENCE' });
});

test('4. 공통 점수 없음(응답 없음·NOT_ENOUGH_DATA·overallScore null) → 계산 안 함', () => {
  for (const s of [null, undefined, {}, shadow({ transport: 80 }, null), shadow({ transport: 80 }, 70, 'NOT_ENOUGH_DATA'), 'x']) {
    assert.deepEqual(calculatePersonalFit({ shadowV2: s, fitImportance: IMP_ALL3 }), { status: 'UNAVAILABLE', reason: 'NO_COMMON_SCORE' });
  }
  assert.equal(isCommonScoreAvailable(shadow({}, 55, 'LIMITED')), true, '공통 LIMITED도 표시 가능 점수(비교 화면 기준과 동일)');
});

// ── 5~10 ─────────────────────────────────────────────────────────────────────

test('5·6. 결측 축은 0점이 아니라 분모에서 제외하고 재정규화(예: 주차 5 제외 → 나머지 15)', () => {
  const imp: FitImportance = { transport: 5, living: 4, newness: 3, parking: 5, elementarySchoolAccess: 3 };
  const r = ok(calculatePersonalFit({ shadowV2: shadow({ transport: 80, living: 70, newness: 60, parking: null, school: 90 }), fitImportance: imp }));
  assert.equal(r.rawScore, (80 * 5 + 70 * 4 + 60 * 3 + 90 * 3) / 15);
  assert.notEqual(r.rawScore, (80 * 5 + 70 * 4 + 60 * 3 + 0 * 5 + 90 * 3) / 20, '0점 처리 아님');
  assert.deepEqual(r.excludedAxes, ['parking']);
  assert.deepEqual(r.includedAxes, ['transport', 'living', 'newness', 'elementarySchoolAccess']);
  assert.equal(r.coverage, 15 / 20);
  assert.equal(r.axisResults.find((a) => a.axis === 'parking')!.exclusion, 'PARKING_NOT_MEASURED');
});

test('5b. 교통 결측·여러 축 결측', () => {
  const t = ok(calculatePersonalFit({ shadowV2: shadow({ transport: null, living: 70, newness: 60, parking: 50, school: 90 }), fitImportance: IMP_ALL3 }));
  assert.deepEqual(t.excludedAxes, ['transport']);
  assert.equal(t.axisResults[0].exclusion, 'NO_DATA');
  assert.equal(t.rawScore, (70 + 60 + 50 + 90) / 4);
  const m = ok(calculatePersonalFit({ shadowV2: shadow({ transport: null, living: 70, newness: null, parking: 'NEUTRAL', school: 90 }), fitImportance: IMP_ALL3 }));
  assert.deepEqual(m.excludedAxes, ['transport', 'newness', 'parking']);
  assert.equal(m.rawScore, (70 + 90) / 2);
  assert.equal(m.status, 'LIMITED');
});

test('7·19. 주차 신뢰 회귀(실제 V2 엔진): 공통 점수는 주차 결측에 연식대 중립값을 쓰지만, 개인화는 주차를 제외한다', () => {
  const missing = calculateScoreV2(v2Input({ parkingRatio: null, parkingRawStatus: 'MISSING' }), 2026);
  const complex = missing.domains.complex;
  assert.equal(complex.evidence.parkingModelTreatment, 'P-D_ERA_CONDITIONED');
  assert.equal(complex.evidence.parkingEraNeutralUsed, PARKING_ERA_NEUTRAL['21-30']);
  assert.ok(complex.usedFactors.includes('parking'), '공통 단지 점수 합성에는 중립값이 들어갔다');

  const r = ok(calculatePersonalFit({ shadowV2: missing, fitImportance: { transport: 1, living: 1, newness: 1, parking: 5, elementarySchoolAccess: 1 } }));
  assert.deepEqual(r.excludedAxes, ['parking']);
  const p = r.axisResults.find((a) => a.axis === 'parking')!;
  assert.equal(p.score, null);
  assert.equal(p.exclusion, 'PARKING_NOT_MEASURED');
  assert.ok(!r.axisResults.some((a) => a.score === PARKING_ERA_NEUTRAL['21-30'] && a.axis === 'parking'));
  assert.equal(r.coverage, 4 / 9);
  assert.equal(r.status, 'LIMITED');

  // 실측이면 포함
  const known = calculateScoreV2(v2Input(), 2026);
  const k = ok(calculatePersonalFit({ shadowV2: known, fitImportance: IMP_ALL3 }));
  assert.ok(k.includedAxes.includes('parking'));
  assert.equal(k.axisResults.find((a) => a.axis === 'parking')!.score, known.domains.complex.evidence.parkingScore);

  // 표식이 어긋나면(값만 있고 상태가 실측이 아님) 쓰지 않는다
  const forged = structuredClone(known) as unknown as { domains: { complex: { evidence: Record<string, unknown> } } };
  forged.domains.complex.evidence.parkingModelTreatment = 'P-D_ERA_CONDITIONED';
  assert.equal(extractPersonalAxisScores(forged).parking.score, null);
});

test('실제 V2 엔진 출력에서 축 매핑: 교통·생활·교육 도메인 점수, 신축=ageScore, 주차=parkingScore', () => {
  const v2 = calculateScoreV2(v2Input(), 2026);
  const axes = extractPersonalAxisScores(v2);
  assert.equal(axes.transport.score, v2.domains.transport.score);
  assert.equal(axes.living.score, v2.domains.living.score);
  assert.equal(axes.elementarySchoolAccess.score, v2.domains.education.score);
  assert.equal(axes.newness.score, v2.domains.complex.evidence.ageScore);
  assert.equal(axes.parking.score, v2.domains.complex.evidence.parkingScore);
  // JSON 왕복(API 응답) 후에도 같다
  assert.deepEqual(extractPersonalAxisScores(JSON.parse(JSON.stringify(v2))), axes);
});

test('8·9·10. coverage 계산, 0.60 미만 LIMITED, 정확히 0.60은 FULL', () => {
  // 전체 20: 교통5 생활5 신축4 주차3 초등3. 교통+생활+초등(13) 포함 → 0.65 FULL
  const imp: FitImportance = { transport: 5, living: 5, newness: 4, parking: 3, elementarySchoolAccess: 3 };
  const a = ok(calculatePersonalFit({ shadowV2: shadow({ transport: 80, living: 70, newness: null, parking: null, school: 60 }), fitImportance: imp }));
  assert.equal(a.coverage, 13 / 20);
  assert.equal(a.status, 'FULL');
  // 정확히 0.60: 12/20 (교통5 생활4 초등3 포함, 신축4 주차4 제외)
  const exact = ok(calculatePersonalFit({ shadowV2: shadow({ transport: 80, living: 70, newness: null, parking: null, school: 60 }), fitImportance: { transport: 5, living: 4, newness: 4, parking: 4, elementarySchoolAccess: 3 } }));
  assert.equal(exact.coverage, 0.6);
  assert.equal(exact.coverage >= PERSONAL_FIT_LIMITED_BELOW_COVERAGE, true);
  assert.equal(exact.status, 'FULL');
  // 0.60 미만: 11/20
  const below = ok(calculatePersonalFit({ shadowV2: shadow({ transport: 80, living: 70, newness: null, parking: null, school: 60 }), fitImportance: { transport: 5, living: 4, newness: 4, parking: 5, elementarySchoolAccess: 2 } }));
  assert.equal(below.coverage, 11 / 20);
  assert.equal(below.status, 'LIMITED');
  assert.equal(ok(calculatePersonalFit({ shadowV2: full(), fitImportance: IMP_ALL3 })).coverage, 1);
});

test('포함 축 0개 → 계산 불가', () => {
  assert.deepEqual(calculatePersonalFit({ shadowV2: shadow({}, 60), fitImportance: IMP_ALL3 }), { status: 'UNAVAILABLE', reason: 'NO_INCLUDED_AXES' });
});

// ── 설명 ─────────────────────────────────────────────────────────────────────

test('11·12. 설명은 중요도 4~5만(3 이하 제외)', () => {
  const r = ok(calculatePersonalFit({ shadowV2: full({ transport: 90, living: 90, newness: 20, parking: 20, school: 90 }), fitImportance: { transport: 4, living: 3, newness: 5, parking: 3, elementarySchoolAccess: 5 } }));
  assert.deepEqual(r.goodFit.map((g) => g.axis), ['elementarySchoolAccess', 'transport'], '중요도 내림차순');
  assert.deepEqual(r.weakFit.map((w) => w.axis), ['newness']);
  const low = ok(calculatePersonalFit({ shadowV2: full({ transport: 95, living: 5 }), fitImportance: { transport: 3, living: 3, newness: 1, parking: 2, elementarySchoolAccess: 1 } }));
  assert.deepEqual([low.goodFit, low.weakFit], [[], []]);
});

test('13·14·15·16. 경계: 75 GOOD, 74 중립, 45 WEAK, 46 중립(표시 정수 기준, 74.5→75)', () => {
  const imp: FitImportance = { transport: 5, living: 5, newness: 5, parking: 5, elementarySchoolAccess: 5 };
  const r = ok(calculatePersonalFit({ shadowV2: shadow({ transport: 75, living: 74, newness: 45, parking: 46, school: 74.5 }), fitImportance: imp }));
  // 중요도·표시 점수가 같으면 축 고정 순서(교통 → … → 초등학교 접근성)
  assert.deepEqual(r.goodFit.map((g) => [g.axis, g.displayScore]), [['transport', 75], ['elementarySchoolAccess', 75]]);
  assert.ok(!r.goodFit.some((g) => g.axis === 'living'));
  assert.deepEqual(r.weakFit.map((w) => w.axis), ['newness']);
  assert.ok(!r.weakFit.some((w) => w.axis === 'parking'));
  assert.equal(PERSONAL_FIT_GOOD_MIN_SCORE, 75);
  assert.equal(PERSONAL_FIT_WEAK_MAX_SCORE, 45);
  const r2 = ok(calculatePersonalFit({ shadowV2: shadow({ transport: 45.4, living: 45.5, newness: 74.4 }), fitImportance: imp }));
  assert.deepEqual(r2.weakFit.map((w) => w.axis), ['transport'], '45.4→45 WEAK, 45.5→46 중립');
  assert.deepEqual(r2.goodFit, [], '74.4→74 중립');
});

test('17. 결측 축·전부 중립 점수는 설명하지 않는다', () => {
  const r = ok(calculatePersonalFit({ shadowV2: shadow({ transport: 60, living: 50, newness: 70, parking: 'NEUTRAL', school: null }), fitImportance: { transport: 5, living: 5, newness: 5, parking: 5, elementarySchoolAccess: 5 } }));
  assert.deepEqual([r.goodFit, r.weakFit], [[], []]);
});

test('문구: 승인된 규칙 문장만, 과장·학군 표현 없음', () => {
  const r = ok(calculatePersonalFit({ shadowV2: full({ transport: 90, living: 10, newness: 90, parking: 10, school: 90 }), fitImportance: { transport: 5, living: 5, newness: 5, parking: 5, elementarySchoolAccess: 5 } }));
  assert.deepEqual(r.goodFit.map((g) => g.text).sort(), ['교통 접근성이 선호에 잘 맞아요', '신축 선호에 잘 맞아요', '초등학교 접근성이 선호에 잘 맞아요'].sort());
  assert.deepEqual(r.weakFit.map((w) => w.text).sort(), ['생활편의시설 접근성은 선호보다 아쉬워요', '주차 여건은 선호보다 아쉬워요'].sort());
  const all = JSON.stringify(PERSONAL_FIT_PHRASES);
  for (const banned of ['최고', '우수', '투자', '미래가치', '추천', '학군']) assert.ok(!all.includes(banned), banned);
});

test('18. 개인화 모듈·타입·테스트 문구에 "학군"을 새로 쓰지 않는다(금지어 검사 문자열 제외)', () => {
  for (const f of ['src/lib/personalized-score.ts', 'src/lib/fit-importance.ts']) {
    const code = readFileSync(join(ROOT, f), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!code.includes('학군'), f);
  }
  // 표시 문구·라벨 전체에도 없음
  const labels = JSON.stringify(ok(calculatePersonalFit({ shadowV2: full(), fitImportance: IMP_ALL3 })).axisResults.map((a) => a.label));
  assert.ok(!labels.includes('학군') && labels.includes('초등학교 접근성'));
});

// ── 공통 점수 불변·타입·범위 ───────────────────────────────────────────────────

test('19. 공통 점수 객체를 바꾸지 않는다(동결 객체로 계산, 전후 동일)', () => {
  const v2 = calculateScoreV2(v2Input({ parkingRatio: null, parkingRawStatus: 'MISSING' }), 2026);
  const snapshot = JSON.stringify(v2);
  deepFreeze(v2);
  const r = calculatePersonalFit({ shadowV2: v2, fitImportance: IMP_ALL3 });
  assert.equal(JSON.stringify(v2), snapshot);
  assert.notEqual(r.status, 'UNAVAILABLE');
  assert.equal(calculateScoreV2(v2Input({ parkingRatio: null, parkingRawStatus: 'MISSING' }), 2026).overallScore, v2.overallScore, '엔진 결과 자체도 불변');
});

test('20. 상세·비교 호환: API 응답의 _shadowV2(JSON) 그대로 입력 가능, React·DB 의존 없음', () => {
  const apiLike = JSON.parse(JSON.stringify({ _shadowV2: calculateScoreV2(v2Input(), 2026) }));
  const r = ok(calculatePersonalFit({ shadowV2: apiLike._shadowV2, fitImportance: IMP_ALL3 }));
  assert.equal(r.includedAxes.length, 5);
  assert.ok(Number.isInteger(r.score) && r.score >= 0 && r.score <= 100);
  const compare = readFileSync(join(ROOT, 'src/lib/compare-v2/metrics.ts'), 'utf8');
  assert.match(compare, /const shadow = scoreJson\?\._shadowV2;/, '비교 화면도 같은 _shadowV2를 받는다');
});

test('점수 범위: 포함 축이 전부 0 → 0, 전부 100 → 100, 범위 밖·NaN·문자열 축은 INVALID_SCORE로 제외', () => {
  assert.equal(ok(calculatePersonalFit({ shadowV2: shadow({ transport: 0, living: 0, newness: 0, parking: 0, school: 0 }), fitImportance: IMP_ALL3 })).score, 0);
  assert.equal(ok(calculatePersonalFit({ shadowV2: shadow({ transport: 100, living: 100, newness: 100, parking: 100, school: 100 }), fitImportance: IMP_ALL3 })).score, 100);
  const bad = shadow({ transport: 80, living: 70, newness: 60, parking: 50, school: 90 }) as unknown as { domains: Record<string, { score: unknown }> };
  bad.domains.transport.score = 120;
  bad.domains.living.score = Number.NaN;
  bad.domains.education.score = '90';
  const r = ok(calculatePersonalFit({ shadowV2: bad, fitImportance: IMP_ALL3 }));
  assert.deepEqual(r.excludedAxes, ['transport', 'living', 'elementarySchoolAccess']);
  assert.ok(r.axisResults.filter((a) => !a.included).every((a) => a.exclusion === 'INVALID_SCORE'));
});

test('중요도 전부 5 / 전부 1: 모든 축 포함이면 같은 점수(비율만 의미), 반올림은 Math.round', () => {
  const s = full();
  const hi = ok(calculatePersonalFit({ shadowV2: s, fitImportance: { transport: 5, living: 5, newness: 5, parking: 5, elementarySchoolAccess: 5 } }));
  const lo = ok(calculatePersonalFit({ shadowV2: s, fitImportance: { transport: 1, living: 1, newness: 1, parking: 1, elementarySchoolAccess: 1 } }));
  assert.equal(hi.rawScore, lo.rawScore);
  assert.equal(hi.score, Math.round((80 + 70 + 60 + 50 + 90) / 5));
  assert.deepEqual(lo.goodFit, [], '중요도 1은 설명하지 않는다');
  assert.ok(hi.goodFit.length > 0);
});

// ── PHASE 1 시뮬레이션 동등성 ──────────────────────────────────────────────────

/** PHASE 1 감사 프로토타입(scripts/personal-score/simulate-personal-fit.ts personalFit)을 그대로 옮긴 비교 기준. */
type ProtoAxis = 'TRANSPORT' | 'LIVING' | 'SCHOOL' | 'NEWNESS' | 'PARKING';
function phase1Prototype(scores: Record<ProtoAxis, number | null>, importance: Record<ProtoAxis, number>, minCoverage = 0.6) {
  const axes = Object.keys(importance) as ProtoAxis[];
  const total = axes.reduce((s, a) => s + importance[a], 0);
  const present = axes.filter((a) => scores[a] != null);
  const presentWeight = present.reduce((s, a) => s + importance[a], 0);
  const coverage = presentWeight / total;
  if (present.length === 0) return { score: null, coverage, state: 'NOT_ENOUGH_DATA' as const };
  const score = present.reduce((s, a) => s + (scores[a] as number) * importance[a], 0) / presentWeight;
  return { score, coverage, state: coverage >= minCoverage ? ('AVAILABLE' as const) : ('LIMITED' as const) };
}

test('21. PHASE 1 프로토타입과 동등(대표 프로필 × 실제 엔진 출력 여러 단지)', () => {
  const profiles: Record<string, FitImportance> = {
    transit_first: { transport: 5, living: 3, elementarySchoolAccess: 1, newness: 2, parking: 1 },
    family_school: { transport: 2, living: 4, elementarySchoolAccess: 5, newness: 3, parking: 3 },
    car_newbuild: { transport: 1, living: 2, elementarySchoolAccess: 1, newness: 5, parking: 5 },
    all_equal: IMP_ALL3,
  };
  const apartments = [
    v2Input(),
    v2Input({ parkingRatio: null, parkingRawStatus: 'MISSING' }),
    v2Input({ subwayStatus: 'CONFIRMED_ABSENT', nearestSubwayDistanceM: null, buildYear: 2019 }),
    v2Input({ subwayStatus: 'MISSING', nearestSubwayDistanceM: null, nearestBusStopDistanceM: null, busStopCount300m: null }),
    v2Input({ nearestElementaryDistanceM: null, buildYear: 1985, parkingRatio: 0.4 }),
  ].map((i) => calculateScoreV2(i, 2026));
  let compared = 0;
  for (const v2 of apartments) {
    const d = v2.domains;
    const protoScores: Record<ProtoAxis, number | null> = {
      TRANSPORT: d.transport.score,
      LIVING: d.living.score,
      SCHOOL: d.education.score,
      NEWNESS: (d.complex.evidence.ageScore as number | null) ?? null,
      PARKING: (d.complex.evidence.parkingScore as number | null) ?? null,
    };
    for (const imp of Object.values(profiles)) {
      const proto = phase1Prototype(protoScores, { TRANSPORT: imp.transport, LIVING: imp.living, SCHOOL: imp.elementarySchoolAccess, NEWNESS: imp.newness, PARKING: imp.parking });
      const mod = calculatePersonalFit({ shadowV2: v2, fitImportance: imp });
      if (proto.state === 'NOT_ENOUGH_DATA') {
        assert.equal(mod.status, 'UNAVAILABLE');
      } else {
        const m = ok(mod);
        // 수식은 같고 더하는 축 순서만 다르다(프로토타입: 교통·생활·초등·신축·주차 / 모듈: 교통·생활·신축·주차·초등)
        // → 부동소수 합산 순서 차이로 1e-14 수준 오차가 날 수 있어 1e-9 이내 + 표시 정수·상태 완전 일치로 비교한다.
        assert.ok(Math.abs(m.rawScore - (proto.score as number)) < 1e-9, `${m.rawScore} vs ${proto.score}`);
        assert.equal(m.score, Math.round(proto.score as number));
        assert.equal(m.coverage, proto.coverage);
        assert.equal(m.status === 'FULL' ? 'AVAILABLE' : 'LIMITED', proto.state);
      }
      compared++;
    }
  }
  assert.equal(compared, 20);
});

test('22. 성능: 단지 1개 계산 ≪ 1ms (1만 회 평균)', () => {
  const v2 = JSON.parse(JSON.stringify(calculateScoreV2(v2Input(), 2026)));
  const imp: FitImportance = { transport: 5, living: 4, newness: 3, parking: 5, elementarySchoolAccess: 2 };
  for (let i = 0; i < 500; i++) calculatePersonalFit({ shadowV2: v2, fitImportance: imp });
  const n = 10_000;
  const t0 = performance.now();
  for (let i = 0; i < n; i++) calculatePersonalFit({ shadowV2: v2, fitImportance: imp });
  const perCallMs = (performance.now() - t0) / n;
  assert.ok(perCallMs < 0.1, `per call ${perCallMs}ms`);
});
