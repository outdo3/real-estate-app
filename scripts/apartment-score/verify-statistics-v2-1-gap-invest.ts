/**
 * STATISTICS V2.1 — Gap Investment Data Correctness Hotfix 검증.
 * 기존 관례(assert 기반, 테스트 러너 없음)를 따른다.
 *
 * 사용법:
 *   npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js scripts/apartment-score/verify-statistics-v2-1-gap-invest.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import assert from 'assert';
import { buildGapCandidates, normalizeAptName, GapTrade } from '@/lib/gap-invest-calc';

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

function readSrc(rel: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../', rel), 'utf-8');
}

function trade(overrides: Partial<GapTrade>): GapTrade {
  return {
    name: '테스트단지',
    dong: '테스트동',
    dealAmount: 50000,
    excluUseArea: 84.99,
    dealDate: '2026-08-01',
    dealCanceled: false,
    monthlyRent: 0,
    aptSeq: 'TEST-1',
    ...overrides,
  };
}

// ---- A. same apt + same area → pair ----
console.log('--- §15-A same apt + same area -> pair ---');
check('같은 단지, 같은 정확한 전용면적이면 pair가 만들어짐', () => {
  const apts = [trade({ excluUseArea: 84.99, dealAmount: 70000 })];
  const rents = [trade({ excluUseArea: 84.99, dealAmount: 40000 })];
  const candidates = buildGapCandidates(apts, rents);
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].gap, 30000);
});

// ---- B. same apt + different area → no pair ----
console.log('--- §15-B same apt + different area -> no pair ---');
check('같은 단지라도 전용면적이 다르면 pair가 만들어지지 않음', () => {
  const apts = [trade({ excluUseArea: 84.99, dealAmount: 70000 })];
  const rents = [trade({ excluUseArea: 59.99, dealAmount: 40000 })];
  const candidates = buildGapCandidates(apts, rents);
  assert.strictEqual(candidates.length, 0);
});

// ---- C. multiple sale → newest date ----
console.log('--- §15-C multiple sale -> newest date selected ---');
check('매매가 여러 건이면 dealDate가 가장 최신인 거래를 씀(배열 순서 무관)', () => {
  const apts = [
    trade({ excluUseArea: 84.99, dealAmount: 60000, dealDate: '2026-05-01' }),
    trade({ excluUseArea: 84.99, dealAmount: 75000, dealDate: '2026-08-10' }),
    trade({ excluUseArea: 84.99, dealAmount: 68000, dealDate: '2026-07-01' }),
  ];
  const rents = [trade({ excluUseArea: 84.99, dealAmount: 40000, dealDate: '2026-08-01' })];
  const candidates = buildGapCandidates(apts, rents);
  assert.strictEqual(candidates[0].latestSale.amount, 75000);
  assert.strictEqual(candidates[0].latestSale.date, '2026-08-10');
  assert.strictEqual(candidates[0].latestSale.tradeCount, 3);
});

// ---- D. multiple jeonse → newest date ----
console.log('--- §15-D multiple jeonse -> newest date selected ---');
check('전세가 여러 건이면 dealDate가 가장 최신인 거래를 씀', () => {
  const apts = [trade({ excluUseArea: 84.99, dealAmount: 70000, dealDate: '2026-08-01' })];
  const rents = [
    trade({ excluUseArea: 84.99, dealAmount: 35000, dealDate: '2026-06-01' }),
    trade({ excluUseArea: 84.99, dealAmount: 42000, dealDate: '2026-08-15' }),
  ];
  const candidates = buildGapCandidates(apts, rents);
  assert.strictEqual(candidates[0].latestJeonse.amount, 42000);
  assert.strictEqual(candidates[0].latestJeonse.date, '2026-08-15');
  assert.strictEqual(candidates[0].latestJeonse.tradeCount, 2);
});

// ---- E. unsorted API input -> newest 선택 ----
console.log('--- §15-E unsorted API input -> newest still selected ---');
check('입력 배열이 날짜순이 아니어도(최신이 맨 앞) 정확한 최신 거래를 고름', () => {
  const apts = [
    trade({ excluUseArea: 84.99, dealAmount: 99000, dealDate: '2026-08-19' }), // 배열 맨 앞이지만 실제로도 최신
    trade({ excluUseArea: 84.99, dealAmount: 60000, dealDate: '2026-05-01' }),
  ];
  const shuffled = [apts[1], apts[0]]; // 순서를 뒤섞어도 결과는 동일해야 함
  const rents = [trade({ excluUseArea: 84.99, dealAmount: 40000 })];
  const a = buildGapCandidates(apts, rents)[0];
  const b = buildGapCandidates(shuffled, rents)[0];
  assert.strictEqual(a.latestSale.amount, 99000);
  assert.strictEqual(b.latestSale.amount, 99000);
  assert.deepStrictEqual(a, b);
});

// ---- F. missing sale → no gap ----
console.log('--- §15-F missing sale -> no gap ---');
check('매매 거래가 없으면(전세만 있음) 후보 자체가 생기지 않음', () => {
  const candidates = buildGapCandidates([], [trade({ excluUseArea: 84.99 })]);
  assert.strictEqual(candidates.length, 0);
});

// ---- G. missing jeonse → no gap ----
console.log('--- §15-G missing jeonse -> no gap ---');
check('전세 거래가 없으면(매매만 있음) 후보 자체가 생기지 않음', () => {
  const candidates = buildGapCandidates([trade({ excluUseArea: 84.99 })], []);
  assert.strictEqual(candidates.length, 0);
});

// ---- H. raw precision different → no forced merge ----
console.log('--- §15-H raw precision different -> no forced merge (AREA MODEL V1) ---');
check('84.99와 84.996처럼 근접한 값도 병합하지 않음 — 각자 자기 짝이 있을 때만 별도 pair', () => {
  const apts = [
    trade({ excluUseArea: 84.99, dealAmount: 70000, name: 'A단지' }),
    trade({ excluUseArea: 84.996, dealAmount: 71000, name: 'A단지' }),
  ];
  const rents = [trade({ excluUseArea: 84.99, dealAmount: 40000, name: 'A단지' })]; // 84.996 쪽은 전세가 없음
  const candidates = buildGapCandidates(apts, rents);
  assert.strictEqual(candidates.length, 1, '84.996 매매는 짝(전세)이 없으니 후보가 되면 안 됨 — 병합되면 안 됨');
  assert.strictEqual(candidates[0].exclusiveAreaM2, 84.99);
});
check('84.99와 84.996 양쪽 다 짝이 있으면 서로 섞이지 않고 별개 후보 2건', () => {
  const apts = [
    trade({ excluUseArea: 84.99, dealAmount: 70000, name: 'A단지' }),
    trade({ excluUseArea: 84.996, dealAmount: 71000, name: 'A단지' }),
  ];
  const rents = [
    trade({ excluUseArea: 84.99, dealAmount: 40000, name: 'A단지' }),
    trade({ excluUseArea: 84.996, dealAmount: 41000, name: 'A단지' }),
  ];
  const candidates = buildGapCandidates(apts, rents);
  assert.strictEqual(candidates.length, 2);
  const areas = candidates.map((c) => c.exclusiveAreaM2).sort();
  assert.deepStrictEqual(areas, [84.99, 84.996]);
});

// ---- 추가: 취소 거래 / excluUseArea 없는 거래 제외 ----
// ---- FINAL IDENTITY CHECK: aptSeq 우선 identity(부산 4개구 5,695건 실측 근거) ----
console.log('--- FINAL IDENTITY CHECK: aptSeq-first identity ---');
check('같은 이름 + 다른 동 + 같은 면적이지만 aptSeq가 다르면(진짜 다른 단지) pair 금지', () => {
  // 실측 사례 축소판: "삼익" 같은 흔한 이름이 서로 다른 동에 각각 존재하는 경우
  const apts = [trade({ name: '삼익', dong: 'A동', aptSeq: '26260-68', excluUseArea: 59.99, dealAmount: 70000 })];
  const rents = [trade({ name: '삼익', dong: 'B동', aptSeq: '26260-129', excluUseArea: 59.99, dealAmount: 40000 })];
  assert.strictEqual(buildGapCandidates(apts, rents).length, 0, '이름+면적이 같아도 aptSeq가 다르면 다른 단지 — pair 금지');
});
check('같은 이름 + 같은 동인데도 aptSeq가 다르면(실측: "수목하우스" 양정동 사례) pair 금지', () => {
  // 실측 사례: 부산진구 양정동에 "수목하우스"라는 이름의 서로 다른 두 단지가
  // 존재(jibun 343-3 vs 141-10, aptSeq 26230-2325 vs 26230-2485). 동만으로는
  // 이 충돌을 못 잡는다는 것을 이 테스트가 증명한다.
  const apts = [trade({ name: '수목하우스', dong: '양정동', aptSeq: '26230-2325', excluUseArea: 49.8, dealAmount: 30000 })];
  const rents = [trade({ name: '수목하우스', dong: '양정동', aptSeq: '26230-2485', excluUseArea: 49.8, dealAmount: 20000 })];
  assert.strictEqual(buildGapCandidates(apts, rents).length, 0, '동이 같아도 aptSeq가 다르면 pair 금지 — dong만으로는 불충분함을 증명');
});
check('같은 aptSeq + 같은 면적이면 이름/동 표기가 살짝 달라도 정상 pair(실제 단지 식별이 이름 문자열보다 우선)', () => {
  const apts = [trade({ name: '경동', dong: '우동', aptSeq: '26350-2', excluUseArea: 84.95, dealAmount: 73500 })];
  const rents = [trade({ name: '경동', dong: '우동', aptSeq: '26350-2', excluUseArea: 84.95, dealAmount: 38000 })];
  const candidates = buildGapCandidates(apts, rents);
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].gap, 35500);
});
check('aptSeq가 없는 거래는 (동, 정규화된 이름)으로 폴백 — 실측 4개구 전체에서 aptSeq 누락 0건이었지만 방어적으로 동작 확인', () => {
  const apts = [trade({ aptSeq: null, name: '폴백단지', dong: 'X동', excluUseArea: 59.9, dealAmount: 60000 })];
  const rents = [trade({ aptSeq: null, name: '폴백단지', dong: 'X동', excluUseArea: 59.9, dealAmount: 35000 })];
  assert.strictEqual(buildGapCandidates(apts, rents).length, 1, 'aptSeq가 둘 다 없으면 동+이름 폴백으로 정상 pair되어야 함');
});
check('aptSeq가 한쪽만 없으면(폴백 key와 seq key가 서로 다른 네임스페이스) pair되지 않음 — 데이터 불확실 시 억지 생성 금지(§12)', () => {
  const apts = [trade({ aptSeq: 'REAL-1', name: '혼합단지', dong: 'Y동', excluUseArea: 59.9, dealAmount: 60000 })];
  const rents = [trade({ aptSeq: null, name: '혼합단지', dong: 'Y동', excluUseArea: 59.9, dealAmount: 35000 })];
  assert.strictEqual(buildGapCandidates(apts, rents).length, 0);
});

console.log('--- extra: cancelled trades and area-less trades excluded ---');
check('해제(취소)된 매매 거래는 pairing에서 제외됨', () => {
  const apts = [trade({ excluUseArea: 84.99, dealAmount: 70000, dealCanceled: true })];
  const rents = [trade({ excluUseArea: 84.99, dealAmount: 40000 })];
  assert.strictEqual(buildGapCandidates(apts, rents).length, 0);
});
check('excluUseArea가 null인 거래는 pairing에서 제외됨(null끼리 뭉치지 않음)', () => {
  const apts = [trade({ excluUseArea: null, dealAmount: 70000 }), trade({ excluUseArea: null, dealAmount: 71000 })];
  const rents = [trade({ excluUseArea: null, dealAmount: 40000 })];
  assert.strictEqual(buildGapCandidates(apts, rents).length, 0);
});
check('normalizeAptName은 공백/"아파트" 접미사를 제거해 동일 단지로 인식', () => {
  assert.strictEqual(normalizeAptName('경동 아파트'), normalizeAptName('경동아파트'));
});

// ---- API route wiring 정적 확인 ----
console.log('--- dashboard/route.ts wiring (static check) ---');
check('dashboard/route.ts가 buildGapCandidates를 사용하고, 인라인 pairing 로직이 남아있지 않음', () => {
  const src = readSrc('src/app/api/stats/dashboard/route.ts');
  assert.ok(src.includes("from '@/lib/gap-invest-calc'"));
  assert.ok(src.includes('buildGapCandidates('));
  assert.ok(!src.includes('const latestApt = apts[0]'), '옛 인라인 pairing 로직이 아직 남아있음');
});
check('전세 쪽은 반전세/월세(monthlyRent>0)를 걸러낸 뒤에만 buildGapCandidates에 넘김', () => {
  const src = readSrc('src/app/api/stats/dashboard/route.ts');
  assert.ok(/recentPureJeonseTrades[\s\S]{0,80}monthlyRent/.test(src));
  assert.ok(src.includes('buildGapCandidates(recentAptTrades, recentPureJeonseTrades)'));
});
check('§6 전세가율 계산(단지명 단위, 면적 무관)은 그대로 유지됨 — 이번 STEP 감사 대상 아님', () => {
  const src = readSrc('src/app/api/stats/dashboard/route.ts');
  assert.ok(src.includes('전세가율'));
  assert.ok(/jeonseRatios\.push/.test(src));
});
check('gap-invest-calc.ts가 aptSeq를 최우선 identity로 쓰고, 없을 때만 폴백함(FINAL IDENTITY CHECK)', () => {
  const src = readSrc('src/lib/gap-invest-calc.ts');
  assert.ok(src.includes('function complexIdentityKey'));
  assert.ok(/if\s*\(t\.aptSeq\)\s*return\s*`seq:/.test(src), 'aptSeq가 있으면 최우선으로 써야 함');
  assert.ok(src.includes('fallback:'), 'aptSeq 없을 때 폴백 경로가 있어야 함');
});

console.log(`\n${passed} checks passed.`);
if (process.exitCode) {
  console.error('SOME CHECKS FAILED');
} else {
  console.log('ALL CHECKS PASSED');
}
