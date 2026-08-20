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
import { resolvePeerPool } from '@/lib/apartment-score/server/peer-groups';
import { computeCategoryFromSubMetrics } from '@/lib/apartment-score/server/category-helper';
import { computeMarketInfo } from '@/lib/apartment-score/server/categories/market';
import { computeRegionalStrengths } from '@/lib/apartment-score/server/regional-premium';
import { buildBriefing } from '@/lib/apartment-score/server/briefing';
import type { CategoryResult, RawLocationFeature, RawMarketFeature } from '@/lib/apartment-score/server/types';
import { aptNamesMatch } from '@/lib/apt-name-match';

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
  const b1 = buildBriefing(categories, [], '서구');
  const b2 = buildBriefing(categories, [], '서구');
  assert.deepStrictEqual(b1, b2);
});
check('강점 최대 2개, 확인사항 최대 1개', () => {
  const categories = mkCategories({ transport: 95, living: 92, parking: 90, complex: 88, schoolAccess: 20 });
  const b = buildBriefing(categories, [], '해운대구')!;
  assert.ok(b.strengths.length <= 2);
  assert.ok(b.caution === null || typeof b.caution === 'string');
});
check('과장 표현 금지 어휘 미포함', () => {
  const categories = mkCategories({ transport: 95, living: 92, parking: 90, complex: 88, schoolAccess: 20 });
  const b = buildBriefing(categories, [], '해운대구')!;
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
  assert.strictEqual(buildBriefing(categories, [], '서구'), null);
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
