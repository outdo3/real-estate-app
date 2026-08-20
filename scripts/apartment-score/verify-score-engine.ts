/**
 * STEP SCORE S2C — Score/Explanation/Briefing Engine 단위 검증(§53). 이 프로젝트에는
 * 별도 테스트 러너가 없어(package.json에 test 스크립트 없음) 기존 관례
 * (scripts/apartment-score/verify-collectors.ts와 동일한 assert 기반)를 따른다.
 * 순수 로직만 검증한다(DB/API 호출 없음) — DB 기반 pilot 검증은 run-score-pilot.ts.
 *
 * 사용법:
 *   npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js scripts/apartment-score/verify-score-engine.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import assert from 'assert';
import { rankFeature, scoreFromPercentile } from '@/lib/apartment-score/server/percentile';
import { resolvePeerPool, resolvePeerPoolLevels, type PeerCandidate } from '@/lib/apartment-score/server/peer-groups';
import { computeCategoryFromSubMetrics, type SubMetricSpec } from '@/lib/apartment-score/server/category-helper';
import { computeCategoryWithFallback } from '@/lib/apartment-score/server/calculate';
import { computeMarketInfo } from '@/lib/apartment-score/server/categories/market';
import { computeRegionalStrengths } from '@/lib/apartment-score/server/regional-premium';
import { buildBriefing } from '@/lib/apartment-score/server/briefing';
import { explainCategory } from '@/lib/apartment-score/server/explain';
import { absoluteSchoolDistanceBand } from '@/lib/apartment-score/server/school-distance-band';
import { classifyPreparingReason } from '@/lib/apartment-score/server/preparing-reason';
import { regionLabelForPeerLevel } from '@/lib/apartment-score/server/region-label';
import type { CategoryResult, RawLocationFeature, RawMarketFeature } from '@/lib/apartment-score/server/types';
import { aptNamesMatch, normalizeAptName } from '@/lib/apt-name-match';

let passed = 0;
function check(label: string, fn: () => void) {
  try {
    fn();
    console.log(`  PASS  ${label}`);
    passed++;
  } catch (e: any) {
    console.error(`  FAIL  ${label}: ${e.message}`);
    process.exitCode = 1;
  }
}

// ---- 1. percentile: 방향/순위 ----
console.log('--- percentile ---');
check('higherIsBetter: 값이 클수록 percentile 높음', () => {
  const rows = [1, 2, 3, 4, 5].map((v, i) => ({ aptSeq: `a${i}`, value: v, isComplete: true }));
  const ranked = rankFeature(rows, 'x', 'higherIsBetter', false);
  assert.ok(ranked.get('a0')!.percentile! < ranked.get('a4')!.percentile!);
  assert.strictEqual(ranked.get('a4')!.percentile, 100);
  assert.strictEqual(ranked.get('a0')!.percentile, 0);
});
check('lowerIsBetter: 값이 작을수록 percentile 높음(역방향 확인)', () => {
  const rows = [1, 2, 3, 4, 5].map((v, i) => ({ aptSeq: `a${i}`, value: v, isComplete: true }));
  const ranked = rankFeature(rows, 'x', 'lowerIsBetter', false);
  assert.strictEqual(ranked.get('a0')!.percentile, 100); // 최솟값(가장 가까운 거리)이 1등
  assert.strictEqual(ranked.get('a4')!.percentile, 0);
});
check('동점(45-cap 등)은 동일 percentile(평균순위)', () => {
  const rows = [10, 45, 45, 45, 5].map((v, i) => ({ aptSeq: `a${i}`, value: v, isComplete: true }));
  const ranked = rankFeature(rows, 'x', 'higherIsBetter', false);
  const capped = ['a1', 'a2', 'a3'].map((k) => ranked.get(k)!.percentile);
  assert.strictEqual(capped[0], capped[1]);
  assert.strictEqual(capped[1], capped[2]);
});
check('score-scale 완화: percentile 0→5, 100→95', () => {
  assert.strictEqual(scoreFromPercentile(0), 5);
  assert.strictEqual(scoreFromPercentile(100), 95);
});
check('qualityFlag=complete + null(§8 확인된 부재)는 최하위로 순위에 포함', () => {
  const rows = [
    { aptSeq: 'near', value: 200, isComplete: true },
    { aptSeq: 'far', value: 900, isComplete: true },
    { aptSeq: 'none', value: null, isComplete: true }, // 반경 내 없음(실제 사각지대)
    { aptSeq: 'other1', value: 300, isComplete: true },
    { aptSeq: 'other2', value: 400, isComplete: true },
  ];
  const ranked = rankFeature(rows, 'nearestSubwayDistanceM', 'lowerIsBetter', true);
  assert.ok(ranked.get('none')!.included);
  assert.ok(ranked.get('none')!.isConfirmedAbsent);
  assert.ok(ranked.get('none')!.percentile! < ranked.get('far')!.percentile!, 'sentinel이 관측된 최댓값(far)보다도 나빠야 함');
});
check('qualityFlag=partial + null은 순위에서 제외(재분배 대상)', () => {
  const rows = [
    { aptSeq: 'near', value: 200, isComplete: true },
    { aptSeq: 'unknown', value: null, isComplete: false },
    { aptSeq: 'other1', value: 300, isComplete: true },
    { aptSeq: 'other2', value: 400, isComplete: true },
    { aptSeq: 'other3', value: 500, isComplete: true },
  ];
  const ranked = rankFeature(rows, 'x', 'lowerIsBetter', true);
  assert.strictEqual(ranked.get('unknown')!.included, false);
  assert.strictEqual(ranked.get('unknown')!.percentile, null);
});

// ---- 2. peer group fallback ----
console.log('--- peer-groups ---');
check('LOCAL(동) 표본이 충분하면 LOCAL 채택', () => {
  const target = { aptSeq: 't', sggCd: '26140', umdName: 'A동', buildYear: 2000 };
  const cohort = [
    target,
    ...Array.from({ length: 6 }, (_, i) => ({ aptSeq: `p${i}`, sggCd: '26140', umdName: 'A동', buildYear: 2000 })),
    ...Array.from({ length: 20 }, (_, i) => ({ aptSeq: `q${i}`, sggCd: '26140', umdName: 'B동', buildYear: 2010 })),
  ];
  const pool = resolvePeerPool(target, cohort, false);
  assert.strictEqual(pool.level, 'LOCAL');
  assert.strictEqual(pool.tier, 'MEDIUM'); // 7건(target+6) → 5~9
});
check('LOCAL 표본 부족(서구 dong 실측처럼) → SIGUNGU로 폴백', () => {
  const target = { aptSeq: 't', sggCd: '26140', umdName: '외딴동', buildYear: 2000 };
  const cohort = [target, ...Array.from({ length: 15 }, (_, i) => ({ aptSeq: `p${i}`, sggCd: '26140', umdName: `동${i}`, buildYear: 2000 }))];
  const pool = resolvePeerPool(target, cohort, false);
  assert.strictEqual(pool.level, 'SIGUNGU');
  assert.strictEqual(pool.tier, 'HIGH');
});
check('SIGUNGU까지도 5 미만이면 NOT_SCORED', () => {
  const target = { aptSeq: 't', sggCd: '26140', umdName: 'A동', buildYear: 2000 };
  const cohort = [target, { aptSeq: 'p1', sggCd: '26140', umdName: 'B동', buildYear: 2000 }];
  const pool = resolvePeerPool(target, cohort, false);
  assert.strictEqual(pool.tier, 'NOT_SCORED');
});
check('주차: sigungu+buildYear decade band를 LOCAL로 사용', () => {
  const target = { aptSeq: 't', sggCd: '26140', umdName: 'A동', buildYear: 2015 };
  const cohort = [
    target,
    ...Array.from({ length: 6 }, (_, i) => ({ aptSeq: `p${i}`, sggCd: '26140', umdName: `동${i}`, buildYear: 2011 + i })), // 2010s
    ...Array.from({ length: 6 }, (_, i) => ({ aptSeq: `q${i}`, sggCd: '26140', umdName: `동${i}`, buildYear: 1990 + i })), // 1990s
  ];
  const pool = resolvePeerPool(target, cohort, true);
  assert.strictEqual(pool.level, 'LOCAL');
  assert.ok(pool.aptSeqs.every((s) => s === 't' || s.startsWith('p')));
});

// ---- 3. missing-data 재분배(category-helper) ----
console.log('--- missing-data redistribution ---');
check('sub-metric 하나가 결측이면 나머지로 비례 재분배', () => {
  const peerPool = { level: 'SIGUNGU' as const, tier: 'HIGH' as const, aptSeqs: ['t', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9'] };
  const rowsByFeature = {
    a: peerPool.aptSeqs.map((s, i) => ({ aptSeq: s, value: i + 1, isComplete: true })), // 전부 값 있음
    b: peerPool.aptSeqs.map((s) => ({ aptSeq: s, value: null, isComplete: false })), // 전부 결측
  };
  const result = computeCategoryFromSubMetrics(
    'transport',
    't',
    [
      { key: 'a', weight: 60, direction: 'higherIsBetter', treatCompleteNullAsWorst: false },
      { key: 'b', weight: 40, direction: 'higherIsBetter', treatCompleteNullAsWorst: false },
    ],
    peerPool,
    rowsByFeature
  );
  assert.strictEqual(result.status, 'PARTIAL');
  assert.deepStrictEqual(result.usedSubMetrics, ['a']);
  // b가 전부 결측이라 a만으로 100% 재분배 → a의 percentile(t=1등, index0=최솟값이면 0)로 그대로 score 결정
  assert.ok(result.score !== null);
});
check('모든 sub-metric 결측이면 카테고리 NOT_SCORED', () => {
  const peerPool = { level: 'SIGUNGU' as const, tier: 'HIGH' as const, aptSeqs: ['t', 'p1', 'p2', 'p3', 'p4'] };
  const rowsByFeature = { a: peerPool.aptSeqs.map((s) => ({ aptSeq: s, value: null, isComplete: false })) };
  const result = computeCategoryFromSubMetrics(
    'parking',
    't',
    [{ key: 'a', weight: 100, direction: 'higherIsBetter', treatCompleteNullAsWorst: false }],
    peerPool,
    rowsByFeature
  );
  assert.strictEqual(result.status, 'NOT_SCORED');
  assert.strictEqual(result.score, null);
});

// ---- 4. 최소 표본(§30 거래) ----
console.log('--- market minimum sample ---');
check('transactionCount12m=1은 activityLabel 없음(LOW_SAMPLE), 가격은 그대로 노출', () => {
  const info = computeMarketInfo({ aptSeq: 'x', transactionCount12m: 1, medianPricePerM2_12m: 500, qualityFlag: 'complete' } as RawMarketFeature);
  assert.strictEqual(info.status, 'LOW_SAMPLE');
  assert.strictEqual(info.activityLabel, null);
  assert.strictEqual(info.medianPricePerM2_12m, 500);
});
check('transactionCount12m=3 이상은 AVAILABLE + activityLabel 생성', () => {
  const info = computeMarketInfo({ aptSeq: 'x', transactionCount12m: 5, medianPricePerM2_12m: 500, qualityFlag: 'complete' } as RawMarketFeature);
  assert.strictEqual(info.status, 'AVAILABLE');
  assert.ok(info.activityLabel);
});

// ---- 5. Regional Premium ----
console.log('--- regional premium ---');
check('상위 10% 값은 STRONG strength 생성', () => {
  const loc = new Map<string, RawLocationFeature>();
  for (let i = 0; i < 30; i++) {
    loc.set(`p${i}`, mkLocation(`p${i}`, { beachDistanceM: 5000 - i * 100 })); // p0=5000(멀다,나쁨) ... p29=2100(가깝다,좋음)
  }
  loc.set('target', mkLocation('target', { beachDistanceM: 50 })); // 압도적으로 가까움
  const strengths = computeRegionalStrengths('target', loc);
  const beach = strengths.find((s) => s.type === 'BEACH_ACCESS');
  assert.ok(beach);
  assert.strictEqual(beach!.level, 'STRONG');
});
check('분포에 변별력이 없으면(전부 동일값) strength 생성 안 함', () => {
  const loc = new Map<string, RawLocationFeature>();
  for (let i = 0; i < 30; i++) loc.set(`p${i}`, mkLocation(`p${i}`, { beachDistanceM: 1000 }));
  loc.set('target', mkLocation('target', { beachDistanceM: 1000 }));
  const strengths = computeRegionalStrengths('target', loc);
  assert.strictEqual(strengths.find((s) => s.type === 'BEACH_ACCESS'), undefined);
});
check('표본(§25 min 20) 미달이면 strength 생성 안 함', () => {
  const loc = new Map<string, RawLocationFeature>();
  for (let i = 0; i < 5; i++) loc.set(`p${i}`, mkLocation(`p${i}`, { beachDistanceM: 3000 + i * 100 }));
  loc.set('target', mkLocation('target', { beachDistanceM: 50 }));
  const strengths = computeRegionalStrengths('target', loc);
  assert.strictEqual(strengths.length, 0);
});

// ---- 6. Briefing 결정론 + 자연스러움 ----
console.log('--- briefing determinism & naturalness ---');
check('같은 입력 → 같은 briefing(random 없음)', () => {
  const categories = mkCategories({ transport: 90, living: 88, parking: 40, complex: 60, schoolAccess: 55 });
  const b1 = buildBriefing(categories, [], '서구', null);
  const b2 = buildBriefing(categories, [], '서구', null);
  assert.deepStrictEqual(b1, b2);
});
check('강점 최대 2개, 확인사항 최대 1개', () => {
  const categories = mkCategories({ transport: 95, living: 92, parking: 90, complex: 88, schoolAccess: 20 });
  const b = buildBriefing(categories, [], '해운대구', null)!;
  assert.ok(b.strengths.length <= 2);
  assert.ok(b.caution === null || typeof b.caution === 'string');
});
check('과장 표현 금지 어휘 미포함', () => {
  const categories = mkCategories({ transport: 95, living: 92, parking: 90, complex: 88, schoolAccess: 20 });
  const b = buildBriefing(categories, [], '해운대구', null)!;
  const text = [b.summary, ...b.strengths, b.caution ?? ''].join(' ');
  for (const banned of ['최고', '완벽', '반드시', '명문', '강력 추천', '투자가치가 높']) {
    assert.ok(!text.includes(banned), `banned word found: ${banned}`);
  }
});
check('카테고리 전부 NOT_SCORED면 briefing null', () => {
  const categories: CategoryResult[] = ['transport', 'living', 'parking', 'complex', 'schoolAccess'].map((key) => ({
    key: key as any,
    status: 'NOT_SCORED',
    score: null,
    baseWeight: 0,
    peerLevel: null,
    peerTier: null,
    peerSampleSize: 0,
    usedSubMetrics: [],
    missingSubMetrics: [],
  }));
  assert.strictEqual(buildBriefing(categories, [], '서구', null), null);
});

// ---- 7. API 응답 보안(§44): route.ts가 내부 config를 직접 import하지 않는지 정적 확인 ----
console.log('--- API secrecy (static check) ---');
check('score API route는 config(weight/threshold)를 직접 import하지 않음', () => {
  const routeSrc = fs.readFileSync(
    path.resolve(__dirname, '../../src/app/api/apt/[name]/score/route.ts'),
    'utf-8'
  );
  for (const forbidden of ['CATEGORY_WEIGHTS', 'PEER_SAMPLE', 'KAKAO_COUNT_CAP', 'SCORE_FLOOR', 'SUBWEIGHTS', "from './config'", "server/config"]) {
    assert.ok(!routeSrc.includes(forbidden), `route.ts references internal config: ${forbidden}`);
  }
});
check('score API route는 RegionalStrength.percentileInSigungu를 응답에 넣지 않음', () => {
  const routeSrc = fs.readFileSync(
    path.resolve(__dirname, '../../src/app/api/apt/[name]/score/route.ts'),
    'utf-8'
  );
  assert.ok(!routeSrc.includes('percentileInSigungu'));
});

// ---- 8. 오매칭 방지(§41/§52) — aptNamesMatch 기반 identity 필터 로직 재현 ----
console.log('--- wrong apartment prevention ---');
check('동일 이름이 여러 dong에 있으면(=여러 후보) 매칭 로직은 다중 결과를 반환해야 함(route가 AMBIGUOUS 처리)', () => {
  const candidates = [
    { aptSeq: 'a1', name: '금호어울림' },
    { aptSeq: 'a2', name: '금호어울림' },
  ];
  const matched = candidates.filter((c) => aptNamesMatch(c.name, '금호어울림'));
  assert.strictEqual(matched.length, 2, '두 후보 모두 매칭되어야 route단에서 AMBIGUOUS로 처리됨');
});
check('다른 차수(1차/2차)는 매칭되지 않음', () => {
  assert.strictEqual(aptNamesMatch('대신푸르지오1차', '대신푸르지오2차'), false);
});
check('[S3 QA에서 실측 발견] 짧은 이름이 부분포함으로 걸려도 정확히 같은 이름이 있으면 그것만 채택(불필요한 AMBIGUOUS 방지)', () => {
  // 실측 사례: 서구 서대신동3가에 "구덕"과 "구덕하이츠"가 공존 — aptNamesMatch만 쓰면
  // "구덕하이츠" 검색이 "구덕"에도 부분포함으로 걸려 2건 매칭(AMBIGUOUS)됐었다(2026-08-20 발견).
  const candidates = [
    { aptSeq: '26140-38', name: '구덕' },
    { aptSeq: '26140-209', name: '구덕하이츠' },
  ];
  const aptName = '구덕하이츠';
  const fuzzy = candidates.filter((c) => aptNamesMatch(c.name, aptName));
  assert.strictEqual(fuzzy.length, 2, '수정 전에는 2건이 fuzzy 매칭됐어야 재현 조건이 맞음');
  const exact = candidates.filter((c) => normalizeAptName(c.name) === normalizeAptName(aptName));
  const matched = exact.length > 0 ? exact : fuzzy;
  assert.strictEqual(matched.length, 1);
  assert.strictEqual(matched[0].aptSeq, '26140-209');
});

// ---- 9. [SCORE V1.1] 학교 접근성 절대/상대 분리 + 모순 방지(§34 A~F, §41) ----
console.log('--- SCORE V1.1: school access absolute/relative calibration ---');

function mkSchoolCategory(score: number): CategoryResult {
  return {
    key: 'schoolAccess', status: 'SCORED', score, baseWeight: 15,
    peerLevel: 'SIGUNGU', peerTier: 'HIGH', peerSampleSize: 150,
    usedSubMetrics: ['nearestElementaryDistanceM'], missingSubMetrics: [],
  };
}

check('§6 절대 거리 band는 실측 percentile에 앵커링된 threshold를 따른다', () => {
  assert.strictEqual(absoluteSchoolDistanceBand(150), 'VERY_CLOSE');
  assert.strictEqual(absoluteSchoolDistanceBand(200), 'VERY_CLOSE');
  assert.strictEqual(absoluteSchoolDistanceBand(201), 'CLOSE');
  assert.strictEqual(absoluteSchoolDistanceBand(400), 'CLOSE');
  assert.strictEqual(absoluteSchoolDistanceBand(401), 'NORMAL');
  assert.strictEqual(absoluteSchoolDistanceBand(650), 'NORMAL');
  assert.strictEqual(absoluteSchoolDistanceBand(651), 'FAR');
  assert.strictEqual(absoluteSchoolDistanceBand(933), 'FAR');
  assert.strictEqual(absoluteSchoolDistanceBand(934), 'VERY_FAR');
  assert.strictEqual(absoluteSchoolDistanceBand(null), 'UNKNOWN');
});

check('시나리오 A: 실거리 250m(CLOSE) + 상대 낮음(BELOW_AVERAGE)이어도 단독 "아쉽다"가 아니라 절대 긍정을 먼저 말한다(실제 버그 재현 케이스, aptSeq 26140-11 구덕금호 기준)', () => {
  const explained = explainCategory('t', mkSchoolCategory(41), '서구', null, 250);
  assert.ok(explained.explanation!.startsWith('초등학교까지 가까운'), '절대 사실(가깝다)을 먼저 말해야 함');
  assert.ok(!/^초등학교[^.]*아쉬운 편/.test(explained.explanation!), '문장이 "아쉽다"로 단독 시작하면 안 됨');
  assert.ok(explained.explanation!.includes('더 가까운 단지도 있습니다'), '상대는 부드러운 caveat로만 붙어야 함');
});

check('시나리오 B: 실거리 900m(FAR) + 상대 높음(GOOD)이어도 "매우 좋다"로 단독 과장하지 않고 거리 caveat를 남긴다', () => {
  const explained = explainCategory('t', mkSchoolCategory(75), '해운대구', null, 900);
  assert.ok(explained.explanation!.startsWith('초등학교까지 거리가 있는'), '절대 사실(멀다)을 먼저 말해야 함');
  assert.ok(explained.explanation!.includes('다만'), '상대가 좋아도 절대적으로 먼 사실에 대한 caveat가 있어야 함');
});

check('시나리오 C: 실거리 250m(CLOSE) + 상대 높음(EXCELLENT)은 강한 긍정 문장이어도 됨(모순 없음)', () => {
  const explained = explainCategory('t', mkSchoolCategory(90), '서구', null, 250);
  assert.ok(explained.explanation!.includes('가까운'));
  assert.ok(explained.explanation!.includes('상대적으로 좋은 편'));
  assert.ok(!explained.explanation!.includes('아쉬운'));
});

check('시나리오 D: 실거리 900m(FAR) + 상대 낮음(BELOW_AVERAGE)은 caution을 포함해도 된다(절대도 이미 멀다는 사실과 일치)', () => {
  const explained = explainCategory('t', mkSchoolCategory(20), '서구', null, 900);
  assert.ok(explained.explanation!.startsWith('초등학교까지 거리가 있는'));
  assert.ok(explained.explanation!.includes('아쉬운'));
});

check('시나리오 E: 학교 데이터 자체가 없으면(UNKNOWN) 품질/거리 추정을 하지 않고, briefing caution 후보에서도 제외된다', () => {
  const explained = explainCategory('t', mkSchoolCategory(20), '서구', null, null);
  assert.strictEqual(explained.explanation, '인근 1000m 이내에서 초등학교 접근성 정보가 확인되지 않았습니다.');
  assert.ok(!explained.explanation!.includes('아쉬운'), '없는 데이터로 품질을 추정하면 안 됨');

  // schoolAccess가 유일한 BELOW_AVERAGE 후보라도, 거리 UNKNOWN이면 caution에 뽑히지 않아야 한다.
  const categories: CategoryResult[] = [
    { key: 'transport', status: 'SCORED', score: 70, baseWeight: 30, peerLevel: 'SIGUNGU', peerTier: 'HIGH', peerSampleSize: 100, usedSubMetrics: [], missingSubMetrics: [] },
    mkSchoolCategory(20),
  ];
  const briefing = buildBriefing(categories, [], '서구', null, null);
  assert.strictEqual(briefing?.caution, null, 'UNKNOWN 거리인 schoolAccess가 caution으로 선택되면 안 됨');
});

check('§11 briefing caution도 explain과 동일하게 절대 우선 + 상대 caveat 구조를 쓴다(구덕금호 실제 재현)', () => {
  const categories: CategoryResult[] = [mkSchoolCategory(41)];
  const briefing = buildBriefing(categories, [], '서구', null, 201);
  assert.ok(briefing?.caution?.startsWith('초등학교까지 가까운'));
  assert.ok(briefing?.caution?.includes('더 가까운 단지도 있습니다'));
});

check('§34 F: schoolAccess 문장은 middle/high 관련 어휘를 절대 포함하지 않는다(수집 자체가 elementary 전용이라 문장에도 섞이지 않아야 함)', () => {
  for (const [score, dist] of [[41, 201], [90, 250], [20, 900], [75, 900]] as const) {
    const explained = explainCategory('t', mkSchoolCategory(score), '서구', null, dist);
    for (const banned of ['중학교', '고등학교', '중·고']) {
      assert.ok(!explained.explanation!.includes(banned), `schoolAccess 문장에 ${banned} 혼입`);
    }
  }
});

check('§35 금지 어휘(좋은 학군/교육 수준/명문)는 schoolAccess 문장 어디에도 없다', () => {
  for (const [score, dist] of [[41, 201], [90, 250], [20, 900], [75, 900], [20, null]] as const) {
    const explained = explainCategory('t', mkSchoolCategory(score), '서구', null, dist);
    for (const banned of ['좋은 학군', '교육 수준', '명문', '학군']) {
      assert.ok(!explained.explanation!.includes(banned), `금지 어휘 발견: ${banned}`);
    }
  }
});

// ---- 10. [SCORE V1.1 §18] 준비중 reason taxonomy ----
console.log('--- SCORE V1.1: preparing-reason taxonomy ---');

function mkCat(key: string, score: number | null): CategoryResult {
  return { key: key as any, status: score == null ? 'NOT_SCORED' : 'SCORED', score, baseWeight: 20, peerLevel: score == null ? null : 'SIGUNGU', peerTier: score == null ? null : 'HIGH', peerSampleSize: 0, usedSubMetrics: [], missingSubMetrics: [] };
}

check('transport+living+schoolAccess 전부 NOT_SCORED면 FEATURE_CACHE_MISSING(실측 14/16 구·군의 실제 지배적 원인)', () => {
  const categories = [mkCat('transport', null), mkCat('living', null), mkCat('parking', 50), mkCat('complex', 60), mkCat('schoolAccess', null)];
  assert.strictEqual(classifyPreparingReason(categories), 'FEATURE_CACHE_MISSING');
});
check('parking 하나만 NOT_SCORED면 MISSING_PARKING(실측 75.4% 케이스)', () => {
  const categories = [mkCat('transport', 60), mkCat('living', 55), mkCat('parking', null), mkCat('complex', 50), mkCat('schoolAccess', 70)];
  assert.strictEqual(classifyPreparingReason(categories), 'MISSING_PARKING');
});
check('여러 카테고리가 부분적으로 NOT_SCORED면 INSUFFICIENT_TOTAL_COVERAGE', () => {
  const categories = [mkCat('transport', 60), mkCat('living', null), mkCat('parking', null), mkCat('complex', 50), mkCat('schoolAccess', 70)];
  assert.strictEqual(classifyPreparingReason(categories), 'INSUFFICIENT_TOTAL_COVERAGE');
});

// ---- 11. [BUSAN SCORE DATA V1 §3] regionLabel이 실제 peerLevel을 반영하는지 ----
console.log('--- BUSAN SCORE DATA V1: regionLabel accuracy ---');

check('LOCAL(동)은 동 이름을, SIGUNGU는 구 이름을, REGION_WIDE는 "부산 전체"를 쓴다', () => {
  assert.strictEqual(regionLabelForPeerLevel('LOCAL', '서구', '동대신동3가', false), '동대신동3가');
  assert.strictEqual(regionLabelForPeerLevel('SIGUNGU', '서구', '동대신동3가', false), '서구');
  assert.strictEqual(regionLabelForPeerLevel('REGION_WIDE', '서구', '동대신동3가', false), '부산 전체');
});
check('주차(decade-band LOCAL)는 동 이름이 아니라 "{구} 유사 연식"을 쓴다(주차 LOCAL은 동 단위가 아니므로)', () => {
  assert.strictEqual(regionLabelForPeerLevel('LOCAL', '서구', '동대신동3가', true), '서구 유사 연식');
});
check('umdName이 없으면 LOCAL이어도 sigungu로 안전 폴백', () => {
  assert.strictEqual(regionLabelForPeerLevel('LOCAL', '서구', null, false), '서구');
});

check('explainCategory: 실제로 LOCAL(동) 비교면 문장에 동 이름이 나오고 구 이름은 나오지 않는다(구덕금호 실측 재현)', () => {
  const cat: CategoryResult = { key: 'transport', status: 'SCORED', score: 55, baseWeight: 30, peerLevel: 'LOCAL', peerTier: 'MEDIUM', peerSampleSize: 6, usedSubMetrics: [], missingSubMetrics: [] };
  const explained = explainCategory('t', cat, '서구', '동대신동3가');
  assert.ok(explained.explanation!.includes('동대신동3가'), 'LOCAL 비교인데 동 이름이 없음');
  assert.ok(!explained.explanation!.includes('서구'), 'LOCAL 비교인데 구 이름("서구")이 나오면 실제보다 넓은 비교처럼 보임');
});
check('explainCategory: SIGUNGU 비교면 구 이름을 쓴다(기존 동작 유지)', () => {
  const cat: CategoryResult = { key: 'transport', status: 'SCORED', score: 55, baseWeight: 30, peerLevel: 'SIGUNGU', peerTier: 'HIGH', peerSampleSize: 150, usedSubMetrics: [], missingSubMetrics: [] };
  const explained = explainCategory('t', cat, '서구', '동대신동3가');
  assert.ok(explained.explanation!.includes('서구'));
});
check('explainCategory: parking은 LOCAL이어도 동 이름이 아니라 "유사 연식" 표현을 쓴다', () => {
  const cat: CategoryResult = { key: 'parking', status: 'SCORED', score: 60, baseWeight: 15, peerLevel: 'LOCAL', peerTier: 'HIGH', peerSampleSize: 12, usedSubMetrics: [], missingSubMetrics: [] };
  const explained = explainCategory('t', cat, '서구', '동대신동3가');
  assert.ok(explained.explanation!.includes('유사 연식'));
  assert.ok(!explained.explanation!.includes('동대신동3가'), 'parking LOCAL은 동 단위 비교가 아니므로 동 이름을 쓰면 안 됨');
});
check('buildBriefing: caution 후보가 LOCAL이면 caution 문장에 동 이름이 쓰인다(전체 briefing 하나에 카테고리별로 다른 peerLevel이 섞여도 각자 정확해야 함)', () => {
  const categories: CategoryResult[] = [
    { key: 'transport', status: 'SCORED', score: 20, baseWeight: 30, peerLevel: 'LOCAL', peerTier: 'MEDIUM', peerSampleSize: 6, usedSubMetrics: [], missingSubMetrics: [] },
  ];
  const briefing = buildBriefing(categories, [], '서구', '동대신동3가', null);
  assert.ok(briefing?.caution?.includes('동대신동3가'));
});

// ---- 12. [BUSAN SCORE DATA V1 §18/§28] 확장 배치의 구조적 안전장치 ----
// DB/네트워크 의존 동작(idempotent upsert, freshness-skip resume, 429 STOP)은
// 이 프로젝트 관례대로 실제 스크립트 실행으로 검증하고 보고서에 남긴다(순수
// 로직만 assert로 검증 — verify-score-engine.ts 파일 맨 위 설명과 동일 원칙).
// 여기서는 정적으로 검증 가능한 부분만 assert로 고정한다: district 목록에 중복/
// 이미-완료 구가 섞이면 안 된다는 불변식.
console.log('--- BUSAN SCORE DATA V1: district batch list invariants ---');
check('확장 대상 구 목록에 중복 sggCd가 없다', () => {
  const mod = fs.readFileSync(path.resolve(__dirname, 'expand-busan-location-features.ts'), 'utf-8');
  const sggCds = [...mod.matchAll(/sggCd:\s*'(\d+)'/g)].map((m) => m[1]);
  assert.ok(sggCds.length >= 13, `구 목록이 너무 적음: ${sggCds.length}`);
  assert.strictEqual(new Set(sggCds).size, sggCds.length, '중복 sggCd 발견');
});
check('확장 대상 구 목록에 이미 완료된 서구(26140)/해운대(26350)가 다시 섞여있지 않다(중복 수집 방지)', () => {
  const mod = fs.readFileSync(path.resolve(__dirname, 'expand-busan-location-features.ts'), 'utf-8');
  assert.ok(!mod.includes("sggCd: '26140'"), '서구가 확장 목록에 다시 포함됨');
  assert.ok(!mod.includes("sggCd: '26350'"), '해운대가 확장 목록에 다시 포함됨');
});

// ---- 13. [PEER FALLBACK HOTFIX] resolvePeerPoolLevels + computeCategoryWithFallback ----
console.log('--- PEER FALLBACK HOTFIX: category-level LOCAL→SIGUNGU→REGION_WIDE retry ---');

function mkCandidate(aptSeq: string, umdName: string, buildYear = 2000): PeerCandidate {
  return { aptSeq, sggCd: '26110', umdName, buildYear };
}

// 대청동4가/일광읍 이천리 실측 재현: 같은 동 후보가 정확히 5명(target 포함)이고,
// SIGUNGU 전체는 훨씬 크다.
function mkLocalExact5Cohort(): PeerCandidate[] {
  return [
    mkCandidate('t', '대청동4가'),
    mkCandidate('p1', '대청동4가'),
    mkCandidate('p2', '대청동4가'),
    mkCandidate('p3', '대청동4가'),
    mkCandidate('p4', '대청동4가'),
    ...Array.from({ length: 50 }, (_, i) => mkCandidate(`q${i}`, `기타동${i % 10}`)),
  ];
}

const SINGLE_SUB_METRIC: SubMetricSpec[] = [
  { key: 'x', weight: 100, direction: 'higherIsBetter', treatCompleteNullAsWorst: false },
];

check('resolvePeerPool()과 resolvePeerPoolLevels()[0]이 항상 동일하다(기존 동작 100% 보존, LOCAL 충족)', () => {
  const target = mkCandidate('t', '대청동4가');
  const cohort = mkLocalExact5Cohort();
  const single = resolvePeerPool(target, cohort, false);
  const levels = resolvePeerPoolLevels(target, cohort, false);
  assert.deepStrictEqual(single, levels[0]);
  assert.strictEqual(single.level, 'LOCAL');
});
check('resolvePeerPool()과 resolvePeerPoolLevels()[0]이 항상 동일하다(LOCAL 미충족 → SIGUNGU)', () => {
  const target = mkCandidate('t', '외딴동');
  const cohort = [target, ...Array.from({ length: 20 }, (_, i) => mkCandidate(`p${i}`, `동${i}`))];
  const single = resolvePeerPool(target, cohort, false);
  const levels = resolvePeerPoolLevels(target, cohort, false);
  assert.deepStrictEqual(single, levels[0]);
  assert.strictEqual(single.level, 'SIGUNGU');
});

// [실측 프로덕션 패턴 재현] transport.ts/living.ts 등 실제 category 파일은
// computeCategoryFromSubMetrics를 호출하기 "직전"에 그때 시도 중인 peerPool.aptSeqs
// 기준으로 rowsByFeature를 매번 새로 만든다(§2 trace 확인) — computeCategoryFromSubMetrics
// 자체는 넘겨받은 rows를 그대로 쓸 뿐 peerPool.aptSeqs로 필터링하지 않는다. 그래서
// fallback을 재현하는 테스트도 "ground-truth 값 맵 → 시도 중인 pool.aptSeqs 기준으로
// 매번 새로 rows 생성"이라는 실제 프로덕션 패턴을 그대로 따라야 한다.
function buildRowsFn(valueByAptSeq: Map<string, number | null>) {
  return (pool: { aptSeqs: string[] }) => ({
    x: pool.aptSeqs.map((seq) => ({
      aptSeq: seq,
      value: valueByAptSeq.has(seq) ? valueByAptSeq.get(seq)! : null,
      isComplete: valueByAptSeq.has(seq) ? valueByAptSeq.get(seq) !== null : false,
    })),
  });
}

check('[A] LOCAL 5명 전원 usable → LOCAL 유지, fallback 발생 안 함', () => {
  const cohort = mkLocalExact5Cohort();
  const levels = resolvePeerPoolLevels(mkCandidate('t', '대청동4가'), cohort, false);
  const values = new Map<string, number | null>(cohort.map((c, i) => [c.aptSeq, 100 + i])); // 전원 값 있음
  const buildRows = buildRowsFn(values);
  const result = computeCategoryWithFallback(
    (aptSeq, pool) => computeCategoryFromSubMetrics('transport', aptSeq, SINGLE_SUB_METRIC, pool, buildRows(pool)),
    't',
    levels,
    null
  );
  assert.strictEqual(result.status, 'SCORED');
  assert.strictEqual(result.peerLevel, 'LOCAL', 'usable 표본이 충분하면 LOCAL을 그대로 써야 함');
});

check('[B] LOCAL 5명 중 1명 결측(usable 4명, §18-A 실측 재현) → SIGUNGU로 fallback, peerLevel=SIGUNGU 정확히 반환', () => {
  const cohort = mkLocalExact5Cohort();
  const levels = resolvePeerPoolLevels(mkCandidate('t', '대청동4가'), cohort, false);
  assert.strictEqual(levels[0].level, 'LOCAL');
  assert.strictEqual(levels[0].aptSeqs.length, 5);

  // LOCAL 5명(t,p1,p2,p3,p4) 중 p1만 결측, 나머지(SIGUNGU 전체 포함)는 전부 값 있음
  // — §18-A 실측(새들맨션 등)과 동일 패턴: 대상 단지 자신의 값은 멀쩡하지만 같은
  // 동의 다른 1명이 결측이라 LOCAL 전체가 죽는 경우.
  const values = new Map<string, number | null>(cohort.map((c, i) => [c.aptSeq, 100 + i]));
  values.set('p1', null);
  const buildRows = buildRowsFn(values);
  const result = computeCategoryWithFallback(
    (aptSeq, pool) => computeCategoryFromSubMetrics('transport', aptSeq, SINGLE_SUB_METRIC, pool, buildRows(pool)),
    't',
    levels,
    null
  );
  assert.strictEqual(result.status, 'SCORED', 'SIGUNGU 표본으로는 충분히 계산 가능해야 함');
  assert.strictEqual(result.peerLevel, 'SIGUNGU', 'fallback 후 CategoryResult.peerLevel이 실제 사용된 레벨(SIGUNGU)을 정확히 반영해야 함');
  assert.ok(result.score !== null, 'SIGUNGU fallback으로 실제 점수가 나와야 함(§18-A 8건이 이걸로 복구됨)');
});

check('[C] LOCAL 4명(문턱 미달) → 처음부터 SIGUNGU 채택(기존 resolvePeerPool 동작 그대로)', () => {
  const target = mkCandidate('t', '소규모동');
  const cohort = [
    target,
    mkCandidate('p1', '소규모동'),
    mkCandidate('p2', '소규모동'),
    mkCandidate('p3', '소규모동'),
    ...Array.from({ length: 20 }, (_, i) => mkCandidate(`q${i}`, `기타동${i}`)),
  ];
  const levels = resolvePeerPoolLevels(target, cohort, false);
  assert.strictEqual(levels[0].level, 'SIGUNGU', 'LOCAL 4명은 문턱(5) 미달이라 처음부터 SIGUNGU');
});

check('[D] SIGUNGU도 usable 부족 → REGION_WIDE로 재시도(REGION_WIDE 현재 구현상 SIGUNGU와 동일 후보라 결과도 동일하게 유지됨을 확인)', () => {
  const target = mkCandidate('t', '대청동4가');
  const cohort = mkLocalExact5Cohort();
  const levels = resolvePeerPoolLevels(target, cohort, false);
  assert.strictEqual(levels.length, 3, 'LOCAL/SIGUNGU/REGION_WIDE 3단계 전부 존재해야 함');
  assert.strictEqual(levels[2].level, 'REGION_WIDE');
  // [추가 확인 1] REGION_WIDE가 cohortOtherRegions 미지정 시 SIGUNGU와 완전히 동일한 후보 집합인지 확인
  assert.deepStrictEqual(
    [...levels[1].aptSeqs].sort(),
    [...levels[2].aptSeqs].sort(),
    'cohortOtherRegions 없이 호출하면 REGION_WIDE는 이름과 달리 SIGUNGU와 동일한 후보 집합이어야 함(실제 동작 확인)'
  );

  // SIGUNGU 표본 전체가 결측이어도 REGION_WIDE(=동일 후보)도 마찬가지로 결측 → 최종 NOT_SCORED
  const buildRowsAllNull = (pool: { aptSeqs: string[] }) => ({
    x: pool.aptSeqs.map((seq) => ({ aptSeq: seq, value: null, isComplete: false })),
  });
  const result = computeCategoryWithFallback(
    (aptSeq, pool) => computeCategoryFromSubMetrics('transport', aptSeq, SINGLE_SUB_METRIC, pool, buildRowsAllNull(pool)),
    't',
    levels,
    null
  );
  assert.strictEqual(result.status, 'NOT_SCORED');
  assert.strictEqual(result.peerLevel, 'REGION_WIDE', '전부 실패하면 마지막으로 시도한 레벨(REGION_WIDE)을 반환해야 함');
});

check('[E] 표본 자체가 5 미만(REGION_WIDE까지도 부족) → NOT_SCORED, 0으로 채우지 않음', () => {
  const target = mkCandidate('t', 'X동');
  const cohort = [target, mkCandidate('p1', 'X동'), mkCandidate('p2', 'Y동')]; // 총 3명뿐
  const levels = resolvePeerPoolLevels(target, cohort, false);
  assert.strictEqual(levels.length, 1, 'LOCAL/SIGUNGU 둘 다 미충족이면 REGION_WIDE 하나만 남아야 함');
  assert.strictEqual(levels[0].tier, 'NOT_SCORED');
  const buildRows = buildRowsFn(new Map(cohort.map((c) => [c.aptSeq, 100])));
  const result = computeCategoryWithFallback(
    (aptSeq, pool) => computeCategoryFromSubMetrics('transport', aptSeq, SINGLE_SUB_METRIC, pool, buildRows(pool)),
    't',
    levels,
    null
  );
  assert.strictEqual(result.status, 'NOT_SCORED');
  assert.strictEqual(result.score, null, '표본 부족을 0점으로 대체하면 안 됨');
});

check('[F/H] 카테고리마다 다른 레벨로 fallback되어도(mixed) 서로 영향 없음 — 카테고리 A는 LOCAL 성공, 카테고리 B는 SIGUNGU로 fallback', () => {
  const cohort = mkLocalExact5Cohort();
  const levels = resolvePeerPoolLevels(mkCandidate('t', '대청동4가'), cohort, false);

  const buildRowsFullyUsable = buildRowsFn(new Map(cohort.map((c, i) => [c.aptSeq, 100 + i])));
  const categoryA = computeCategoryWithFallback(
    (aptSeq, pool) => computeCategoryFromSubMetrics('living', aptSeq, SINGLE_SUB_METRIC, pool, buildRowsFullyUsable(pool)),
    't',
    levels,
    null
  );
  assert.strictEqual(categoryA.peerLevel, 'LOCAL');

  const valuesMissingOne = new Map<string, number | null>(cohort.map((c, i) => [c.aptSeq, 100 + i]));
  valuesMissingOne.set('p1', null);
  const buildRowsMissingOne = buildRowsFn(valuesMissingOne);
  const categoryB = computeCategoryWithFallback(
    (aptSeq, pool) => computeCategoryFromSubMetrics('schoolAccess', aptSeq, SINGLE_SUB_METRIC, pool, buildRowsMissingOne(pool)),
    't',
    levels,
    null
  );
  assert.strictEqual(categoryB.peerLevel, 'SIGUNGU', '카테고리마다 독립적으로 다른 레벨에 착지할 수 있어야 함(사용자 확인 #2)');
});

check('[결정론] 동일 입력 → computeCategoryWithFallback도 항상 동일 결과(random 없음)', () => {
  const cohort = mkLocalExact5Cohort();
  const levels = resolvePeerPoolLevels(mkCandidate('t', '대청동4가'), cohort, false);
  const values = new Map<string, number | null>(cohort.map((c, i) => [c.aptSeq, 100 + i]));
  values.set('p1', null);
  const buildRows = buildRowsFn(values);
  const run = () =>
    computeCategoryWithFallback(
      (aptSeq, pool) => computeCategoryFromSubMetrics('transport', aptSeq, SINGLE_SUB_METRIC, pool, buildRows(pool)),
      't',
      levels,
      null
    );
  assert.deepStrictEqual(run(), run());
});

function mkLocation(aptSeq: string, overrides: Partial<RawLocationFeature>): RawLocationFeature {
  return {
    aptSeq,
    nearestSubwayDistanceM: null,
    subwayCount1000m: null,
    nearestBusStopDistanceM: null,
    busStopCount300m: null,
    martCount1000m: null,
    convenienceCount500m: null,
    pharmacyCount500m: null,
    hospitalCount1000m: null,
    parkCount1000m: null,
    daycareKindergartenCount500m: null,
    nearestElementaryDistanceM: null,
    elementaryCount1000m: null,
    beachDistanceM: null,
    qualityFlag: 'complete',
    ...overrides,
  };
}

function mkCategories(scores: Record<string, number>): CategoryResult[] {
  return Object.entries(scores).map(([key, score]) => ({
    key: key as any,
    status: 'SCORED',
    score,
    baseWeight: 20,
    peerLevel: 'SIGUNGU',
    peerTier: 'HIGH',
    peerSampleSize: 150,
    usedSubMetrics: ['x'],
    missingSubMetrics: [],
  }));
}

console.log(`\n${passed} checks passed.`);
if (process.exitCode) {
  console.error('SOME CHECKS FAILED');
} else {
  console.log('ALL CHECKS PASSED');
}
